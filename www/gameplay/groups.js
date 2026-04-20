// Group System — RTDB-synced real-time groups
import { gameState } from '../core/gameState.js';
import { showNotification, addEventLog } from '../auth-ui/ui-controller.js';
import {
    createGroupRTDB, inviteToGroup, acceptGroupInviteRTDB,
    leaveGroupRTDB, disbandGroupRTDB, subscribeToGroupRTDB,
    subscribeToGroupInvites, updatePlayerStatus, getCurrentUser
} from '../firebase/firebase-service.js';

const GROUP_COLORS = ['#22c55e']; // Завжди зелений
let _groupUnsubscribe = null;
let _inviteUnsubscribe = null;

// ==================== INIT ====================

export function initGroups() {
    const charId = window._currentCharacterId;
    if (!charId) return;

    // Підписка на запрошення
    _inviteUnsubscribe = subscribeToGroupInvites(charId, handleGroupInvite);
    console.log('👥 Group system initialized');
}

export function cleanupGroups() {
    if (_groupUnsubscribe) { _groupUnsubscribe(); _groupUnsubscribe = null; }
    if (_inviteUnsubscribe) { _inviteUnsubscribe(); _inviteUnsubscribe = null; }
}

// ==================== GROUP CRUD ====================

export async function createGroup() {
    if (gameState.currentGroup) {
        showNotification('⚠️ You are already in a group!', 'warning');
        return;
    }

    const charId = window._currentCharacterId;
    const user = getCurrentUser();
    if (!charId || !user) return;

    const groupId = 'group_' + Math.random().toString(36).substr(2, 9);
    const color = GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)];

    const success = await createGroupRTDB(groupId, {
        charId,
        name: gameState.player.name || 'Hero',
        level: gameState.player.level || 1,
        avatar: gameState.player.avatar || '🧙',
        color
    });

    if (success) {
        gameState.currentGroup = {
            id: groupId,
            leaderId: charId,
            color,
            members: {
                [charId]: {
                    name: gameState.player.name,
                    level: gameState.player.level,
                    avatar: gameState.player.avatar
                }
            }
        };
        _subscribeToGroupUpdates(groupId);
        showNotification('👥 Group created! Invite players from the online list.', 'success');
        addEventLog('Created a group', 'info');
        updateGroupHUD();
    }
}

export async function invitePlayerToGroup(targetCharId) {
    if (!gameState.currentGroup) {
        // Якщо не в групі — створити
        await createGroup();
        if (!gameState.currentGroup) return;
    }

    const group = gameState.currentGroup;
    const memberCount = Object.keys(group.members || {}).length;
    if (memberCount >= 4) {
        showNotification('⚠️ Group is full (max 4)!', 'warning');
        return;
    }

    const success = await inviteToGroup(
        group.id,
        targetCharId,
        gameState.player.name || 'Hero',
        group.color
    );

    if (success) {
        showNotification('👥 Invite sent!', 'info');
    }
}

export async function acceptGroupInvite(groupId) {
    if (gameState.currentGroup) {
        showNotification('⚠️ Leave your current group first!', 'warning');
        return;
    }

    const charId = window._currentCharacterId;
    if (!charId) return;

    const success = await acceptGroupInviteRTDB(groupId, {
        charId,
        name: gameState.player.name || 'Hero',
        level: gameState.player.level || 1,
        avatar: gameState.player.avatar || '🧙'
    });

    if (success) {
        _subscribeToGroupUpdates(groupId);
        showNotification('👥 Joined the group!', 'success');
        addEventLog('Joined a group', 'info');
    }
}

export async function leaveGroup() {
    if (!gameState.currentGroup) return;

    const charId = window._currentCharacterId;
    const groupId = gameState.currentGroup.id;

    await leaveGroupRTDB(groupId, charId);
    _cleanupLocalGroup();
    showNotification('👥 Left the group', 'info');
    addEventLog('Left the group', 'info');
}

export async function disbandGroup() {
    if (!gameState.currentGroup) return;

    const charId = window._currentCharacterId;
    if (gameState.currentGroup.leaderId !== charId) {
        showNotification('⚠️ Only the leader can disband!', 'warning');
        return;
    }

    await disbandGroupRTDB(gameState.currentGroup.id);
    _cleanupLocalGroup();
    showNotification('👥 Group disbanded', 'info');
}

// ==================== GROUP PROXIMITY CHECK ====================

/**
 * Перевіряє, чи всі члени групи в зоні досяжності цілі.
 * Використовує turf.distance для точного розрахунку.
 * @returns {{ canAttack: boolean, outOfRange: string[] }}
 */
export function checkGroupProximity(targetLat, targetLng) {
    if (!gameState.currentGroup || !gameState.currentGroup.members) {
        return { canAttack: true, outOfRange: [] };
    }

    const outOfRange = [];
    const myCharId = window._currentCharacterId;

    // Потрібні живі позиції всіх членів групи з RTDB
    // Використовуємо кешовані дані з map.js (otherPlayerMarkers)
    const members = gameState.currentGroup.members;

    for (const [charId, member] of Object.entries(members)) {
        let memberPos;

        if (charId === myCharId) {
            memberPos = gameState.player.position;
        } else {
            // Отримати позицію з маркера на карті
            const marker = window._otherPlayerMarkers?.[charId];
            if (marker) {
                const latlng = marker.getLatLng();
                memberPos = { lat: latlng.lat, lng: latlng.lng };
            }
        }

        if (!memberPos) {
            outOfRange.push(member.name || charId);
            continue;
        }

        // Перевірка дистанції — кожен член має бути в своєму interactionRadius
        const from = turf.point([memberPos.lng, memberPos.lat]);
        const to = turf.point([targetLng, targetLat]);
        const dist = turf.distance(from, to, { units: 'meters' });

        // Використовуємо загальний радіус взаємодії (50м за замовчуванням)
        const maxRange = gameState.player.interactionRadius || 50;
        if (dist > maxRange) {
            outOfRange.push(member.name || charId);
        }
    }

    return {
        canAttack: outOfRange.length === 0,
        outOfRange
    };
}

// ==================== INTERNAL ====================

function _subscribeToGroupUpdates(groupId) {
    if (_groupUnsubscribe) _groupUnsubscribe();

    _groupUnsubscribe = subscribeToGroupRTDB(groupId, (data) => {
        if (!data) {
            // Група видалена
            _cleanupLocalGroup();
            showNotification('👥 Group was disbanded', 'warning');
            return;
        }

        const oldCombat = gameState.currentGroup?.activeCombat;
        const newCombat = data.activeCombat;

        gameState.currentGroup = {
            id: data.id,
            leaderId: data.leaderId,
            color: '#22c55e',
            members: data.members || {},
            status: data.status,
            activeCombat: newCombat || null
        };

        updateGroupHUD();
        import('../map/map.js').then(({ refreshAllPlayerMarkers }) => {
            if (refreshAllPlayerMarkers) refreshAllPlayerMarkers();
        });

        // Фаза 2: Якщо з'явився новий activeCombat — затягуємо гравця в бій
        if (newCombat && newCombat !== oldCombat) {
            console.log(`⚔️ Group entered unified combat: ${newCombat}`);
            import('./combat.js').then(({ joinUnifiedCombat }) => {
                if (joinUnifiedCombat) {
                    joinUnifiedCombat(newCombat);
                }
            });
        }
    });
}

function _cleanupLocalGroup() {
    if (_groupUnsubscribe) { _groupUnsubscribe(); _groupUnsubscribe = null; }
    gameState.currentGroup = null;
    // Оновити свій статус у live_players (групу видалено — очищаємо groupId)
    if (window._currentCharacterId) {
        updatePlayerStatus(window._currentCharacterId, 'idle', { groupId: null });
    }
    updateGroupHUD();
    import('../map/map.js').then(({ refreshAllPlayerMarkers }) => {
        if (refreshAllPlayerMarkers) refreshAllPlayerMarkers();
    });
}

function handleGroupInvite(invite) {
    if (!invite || !invite.groupId) return;

    // Показати діалог запрошення
    if (window.showGroupInviteDialog) {
        window.showGroupInviteDialog(invite.groupId, invite.inviterName, invite.groupColor);
    } else {
        // Фолбек — автоприйняття для тестування
        console.log(`👥 Group invite from ${invite.inviterName} — auto-accepting`);
        acceptGroupInvite(invite.groupId);
    }
}

/**
 * Оновити HUD групи (кількість членів, іконки)
 */
export function updateGroupHUD() {
    const container = document.getElementById('group-hud');
    if (!container) return;

    if (!gameState.currentGroup) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    const members = gameState.currentGroup.members || {};
    const color = gameState.currentGroup.color || '#22d3ee';
    const isLeader = gameState.currentGroup.leaderId === window._currentCharacterId;

    container.innerHTML = `
        <div class="flex items-center gap-1" style="border-color: ${color}">
            <div class="flex -space-x-1">
                ${Object.values(members).map(m =>
                    `<div class="w-6 h-6 rounded-full bg-gray-800 border-2 flex items-center justify-center text-xs" style="border-color: ${color}">${m.avatar || '👤'}</div>`
                ).join('')}
            </div>
            <span class="text-[10px] text-gray-400 ml-1">${Object.keys(members).length}/4</span>
            ${isLeader
                ? `<button onclick="disbandGroup()" class="text-[10px] text-red-400 hover:text-red-300 ml-1" title="Disband">✕</button>`
                : `<button onclick="leaveGroup()" class="text-[10px] text-yellow-400 hover:text-yellow-300 ml-1" title="Leave">🚪</button>`
            }
        </div>
    `;
}

// ==================== WINDOW EXPORTS ====================
window.createGroup = createGroup;
window.invitePlayerToGroup = invitePlayerToGroup;
window.acceptGroupInvite = acceptGroupInvite;
window.leaveGroup = leaveGroup;
window.disbandGroup = disbandGroup;
