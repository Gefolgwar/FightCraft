// Combat module - All combat-related logic
import { gameState, updatePlayer, getStaticMonsters, setStaticMonsters, STATIC_MONSTER_KEY, recalculateStats } from './gameState.js';
import { ITEMS_DB, AFFIXES, GRID_SETTINGS } from './data.js';
import { showNotification, addEventLog, updateHUD } from './ui-controller.js';
import { getDistance, renderStaticMonsters } from './map.js';
import { claimCastle, getCurrentUser } from './firebase-service.js';
import { saveGame } from './app.js';

// ==================== COMBAT STATE ====================
let selectedAttackZone = null;
let selectedDefenseZone = null;
let selectedTargetId = null; // New for multi-target combat

// ==================== COMBAT INITIATION ====================

export function showPreCombatDialog(monster, isStatic = false) {
    let dialog = document.getElementById('poi-dialog');
    if (!dialog) {
        dialog = document.createElement('div');
        dialog.id = 'poi-dialog';
        dialog.className = 'fixed inset-0 z-[5000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm';
        document.body.appendChild(dialog);
    }

    dialog.innerHTML = `
        <div class="menu-panel rounded-2xl p-6 w-full max-w-sm text-center border-2 border-red-600/50 bg-gray-900">
            <div class="text-6xl mb-4 animate-bounce">⚔️</div>
            <h2 class="text-xl font-bold mb-2 text-red-500">Enemy Encounter!</h2>
            <div class="bg-black/40 rounded-xl p-4 mb-6 border border-gray-800">
                <p class="text-lg font-bold text-white">${monster.name}</p>
                <p class="text-sm text-gray-400">Level ${monster.level} ${monster.class || 'Monster'}</p>
                <div class="flex justify-center gap-4 mt-2 text-xs">
                    <span class="text-red-400">⚔️ DMG: ${monster.damage}</span>
                    <span class="text-blue-400">🛡️ HP: ${monster.hp}</span>
                </div>
            </div>

            <p class="text-xs text-yellow-500 mb-6 font-bold">
                ⚠️ Fleeing penalty: -5% XP and monster disappears for 1 hour!
            </p>

            <div class="flex flex-col gap-3">
                <button id="start-combat-btn" class="py-4 bg-red-700 hover:bg-red-600 rounded-xl font-bold uppercase tracking-widest text-xs shadow-lg shadow-red-900/50 transition-all">
                    ⚔️ FIGHT!
                </button>
                <button id="flee-combat-btn" class="py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold uppercase text-xs text-gray-300">
                    🏃 FLEE (-5% XP)
                </button>
            </div>
        </div>
    `;

    dialog.classList.remove('hidden');

    document.getElementById('start-combat-btn').onclick = () => {
        dialog.classList.add('hidden');
        startCombat(monster, isStatic);
    };

    document.getElementById('flee-combat-btn').onclick = () => {
        dialog.classList.add('hidden');
        processFleePenalty(monster);
    };
}

export function processFleePenalty(monster) {
    // 30% Gold Loss
    const goldLoss = Math.floor(gameState.player.gold * 0.3);
    gameState.player.gold -= goldLoss;

    // 1 Item Loss (if any)
    let itemLossMsg = '';
    if (gameState.inventory.length > 0) {
        const idx = Math.floor(Math.random() * gameState.inventory.length);
        const lostItem = gameState.inventory[idx];
        const lostItemName = ITEMS_DB[lostItem.id]?.name || 'Unknown Item';
        gameState.inventory.splice(idx, 1);
        itemLossMsg = `, Item Lost: ${lostItemName}`;
    }

    // -5% XP Loss
    const xpLoss = Math.floor(Number(gameState.player.xp) * 0.05);
    gameState.player.xp = BigInt(gameState.player.xp) - BigInt(xpLoss);
    if (gameState.player.xp < 0n) gameState.player.xp = 0n;

    // 1 Hour Cooldown for Monster
    if (monster.id && !monster.isPlayer) {
        setMonsterInactive(monster.id, 60 * 60 * 1000); // 1 hour
    }

    showNotification(`🏃 Fled! Lost ${goldLoss} Gold${itemLossMsg}, -${xpLoss} XP`, 'warning');
    addEventLog(`Fled from ${monster.name}. Lost ${goldLoss}g${itemLossMsg}, ${xpLoss}xp`, 'warning');

    updateHUD();
    saveGame();
    renderStaticMonsters(true);
}

export function startCombat(monster, isStatic = false) {
    const combatMonster = { ...monster };

    // Ensure HP is numeric
    combatMonster.hp = Number(combatMonster.hp) || 100;
    combatMonster.maxHp = Number(combatMonster.maxHp) || combatMonster.hp;
    combatMonster.damage = Number(combatMonster.damage) || 10;
    combatMonster.defense = Number(combatMonster.defense) || 0;

    if (!Number.isFinite(combatMonster.maxHp) || combatMonster.maxHp <= 0) {
        combatMonster.maxHp = 100;
    }
    if (!Number.isFinite(combatMonster.hp) || combatMonster.hp <= 0) {
        combatMonster.hp = combatMonster.maxHp;
    }

    console.log(`🎮 Combat start with ${combatMonster.name}: HP=${combatMonster.hp}/${combatMonster.maxHp}, DMG=${combatMonster.damage}, DEF=${combatMonster.defense}`);

    gameState.combat = {
        monster: combatMonster,
        enemies: [combatMonster], // Support for multiple enemies
        allies: [], // Will be populated from group
        turn: 'player',
        isStatic,
        resolved: false,
        log: []
    };

    // Populate allies from group if nearby
    if (gameState.currentGroup && gameState.currentGroup.members) {
        gameState.currentGroup.members.forEach(member => {
            if (member.id !== window._currentCharacterId) {
                // Simplified: Assume allies are within range for now
                gameState.combat.allies.push({
                    id: member.id,
                    name: member.name,
                    level: member.level,
                    hp: 100 + (member.level * 10), // Estimate or fetch
                    maxHp: 100 + (member.level * 10)
                });
            }
        });
    }

    selectedAttackZone = null;
    selectedDefenseZone = null;
    selectedTargetId = combatMonster.id;

    addEventLog(`Combat: ${monster.name} (Lv.${monster.level})`, 'combat');

    document.getElementById('combat-screen').classList.remove('hidden');
    document.getElementById('combat-log').innerHTML = '<p class="text-yellow-400">⚔️ Combat started!</p>';

    updateCombatPlayerEquipment();
    updateCombatUI();

    document.querySelectorAll('.enemy-zone').forEach(z => z.classList.remove('selected-attack'));
    document.querySelectorAll('.defense-btn').forEach(b => b.classList.remove('selected-defense'));
    document.getElementById('attack-btn').disabled = true;
}







// ==================== ZONE SELECTION ====================
export function selectAttackZone(zone) {
    selectedAttackZone = zone;
    document.querySelectorAll('.enemy-zone').forEach(z => {
        z.classList.remove('selected-attack');
        if (z.dataset.zone === zone) {
            z.classList.add('selected-attack');
        }
    });
    checkCanAttack();
    addEventLog(`Attack target selected: ${zone}`, 'combat');
}

export function selectDefense(defense) {
    selectedDefenseZone = defense;
    document.querySelectorAll('.defense-btn').forEach(b => {
        b.classList.remove('selected-defense');
        if (b.dataset.defense === defense) {
            b.classList.add('selected-defense');
        }
    });
    checkCanAttack();
}

function checkCanAttack() {
    const btn = document.getElementById('attack-btn');
    if (btn) {
        // If PvP and waiting, always disabled
        if (gameState.combat?.isPvP && gameState.combat?.isWaiting) {
            btn.disabled = true;
            return;
        }
        btn.disabled = !(selectedAttackZone && selectedDefenseZone);
    }
}

// ==================== ATTACK EXECUTION ====================
export async function executeAttack() {
    if (!selectedAttackZone || !selectedDefenseZone || !gameState.combat) return;
    const combat = gameState.combat;
    const target = combat.enemies.find(e => e.id === selectedTargetId) || combat.monster;

    if (combat.resolved) return;

    const p = recalculateStats();
    const logEl = document.getElementById('combat-log');

    console.log(`⚔️ Executing Attack. PvP Mode: ${combat.isPvP}, Zone: ${selectedAttackZone}`);

    if (combat.isPvP) {
        // PvP Sync Logic: Use BattleLogic
        await gameState.combat.logic.submitChoice(selectedAttackZone, selectedDefenseZone || 'head-body');
        return;
    }

    // --- 1. Player Turn (Single Player) ---
    const pResult = calculateDamage(p, target, selectedAttackZone);
    applyDamageToTarget(target, pResult, 'You', selectedAttackZone);

    // --- 2. Allies Turn (AI or simplified sync) ---
    combat.allies.forEach(ally => {
        if (target.hp <= 0) return;
        const allyZone = ['head', 'body', 'belt', 'legs'][Math.floor(Math.random() * 4)];
        const allyStats = { derivedDamage: 10 + (ally.level * 2), hitChance: 75, critChance: 10 };

        const aResult = calculateDamage(allyStats, target, allyZone);
        applyDamageToTarget(target, aResult, ally.name, allyZone);
    });

    // --- 3. Monster(s) Response ---
    if (target.hp > 0) {
        const participants = [{ type: 'player', name: 'You', data: gameState.player }, ...combat.allies.map(a => ({ type: 'ally', name: a.name, data: a }))];
        const victim = participants[Math.floor(Math.random() * participants.length)];

        const mAttackZone = ['head', 'body', 'belt', 'legs'][Math.floor(Math.random() * 4)];
        const mResult = calculateDamage({ derivedDamage: target.damage, hitChance: 75, critChance: 5 }, victim.data, mAttackZone, true);

        if (mResult.hit) {
            if (victim.type === 'player' && Math.random() * 100 < (p.dodgeChance || 0)) {
                logEl.innerHTML += `<p class="text-blue-400">🏃 You DODGED ${target.name}'s attack!</p>`;
            } else {
                victim.data.hp -= mResult.damage;
                if (victim.type === 'player') gameState.player.lastDamageTime = Date.now();
                logEl.innerHTML += `<p class="text-red-400">👹 ${target.name} hit ${victim.name} (${mAttackZone}): ${mResult.damage}</p>`;
            }
        } else {
            logEl.innerHTML += `<p class="text-blue-400">🛡️ ${victim.name} blocked ${target.name}'s attack!</p>`;
        }
    }

    logEl.scrollTop = logEl.scrollHeight;
    updateCombatUI();

    if (target.hp <= 0) {
        victory();
    } else if (gameState.player.hp <= 0) {
        setTimeout(() => defeat(), 500);
    }
}

function calculateDamage(attackerStats, target, zone, isMonster = false) {
    let hitChance = attackerStats.hitChance || 75;
    const isCrit = Math.random() * 100 < (attackerStats.critChance || 5);
    let dmg = Math.max(1, (attackerStats.derivedDamage || 10) - (target.defense || 0));
    if (isCrit) dmg *= 2;

    return {
        hit: Math.random() * 100 < hitChance,
        damage: dmg,
        crit: isCrit
    };
}

function applyDamageToTarget(target, result, attackerName, zone) {
    const logEl = document.getElementById('combat-log');
    if (result.hit) {
        target.hp = Math.max(0, target.hp - result.damage);
        logEl.innerHTML += `<p class="text-green-400">⚔️ ${attackerName} ${result.crit ? 'CRIT!' : 'Hit'} ${zone}: ${result.damage} damage</p>`;

        // Visual flash for monster
        if (target.id === gameState.combat.monster.id) {
            const sprite = document.querySelector('.enemy-sprite');
            if (sprite) {
                sprite.classList.add('damage-flash');
                setTimeout(() => sprite.classList.remove('damage-flash'), 300);
            }
        }
    } else {
        logEl.innerHTML += `<p class="text-gray-400">❌ ${attackerName} missed ${target.name}!</p>`;
    }
}

// ==================== COMBAT UI ====================
export function updateCombatUI() {
    if (!gameState.combat) return;
    const m = gameState.combat.monster;
    const p = recalculateStats();


    if (gameState.combat.resolved && m.hp > 0) gameState.combat.resolved = false;

    if (m.hp <= 0) {
        ensureVictoryIfDead();
        return;
    }

    // --- Player Stats ---
    document.getElementById('combat-player-avatar').textContent = gameState.player.avatar || '🧙';
    // Fix Name Display
    const nameEl = document.getElementById('combat-player-name');
    if (nameEl) nameEl.textContent = gameState.player.name || 'Hero';

    document.getElementById('combat-player-level').textContent = p.level;
    document.getElementById('combat-player-hp').style.width = (p.hp / p.maxHp * 100) + '%';
    document.getElementById('combat-player-hp-text').textContent = `${Math.max(0, Math.floor(p.hp))}/${p.maxHp}`;
    document.getElementById('combat-player-dmg').textContent = p.derivedDamage;
    document.getElementById('combat-player-def').textContent = p.effective.defense || 0;
    document.getElementById('combat-player-hit').textContent = p.hitChance + '%';
    document.getElementById('combat-player-crit').textContent = p.critChance + '%';

    // --- Group Allies ---
    const alliesEl = document.getElementById('combat-allies');
    if (alliesEl) {
        alliesEl.innerHTML = (gameState.combat.allies || []).map(ally => `
            <div class="bg-gray-800/80 border border-blue-500/50 rounded-lg p-2 flex items-center gap-2 min-w-[120px]">
                <div class="text-2xl">👤</div>
                <div class="flex-1">
                    <div class="text-[10px] font-bold text-blue-300 truncate w-20">${ally.name}</div>
                    <div class="h-1.5 bg-black rounded-full overflow-hidden mt-1">
                        <div class="bg-green-500 h-full" style="width: ${(ally.hp / ally.maxHp * 100)}%"></div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // Enemy info
    document.getElementById('combat-enemy-icon').textContent = m.icon;
    document.getElementById('combat-enemy-name').textContent = m.name;
    document.getElementById('combat-enemy-level').textContent = m.level;

    const colors = { normal: 'bg-gray-600', champion: 'bg-blue-600', unique: 'bg-yellow-600', superUnique: 'bg-orange-600' };
    const names = { normal: 'Normal', champion: 'Champion', unique: 'Unique', superUnique: 'Super Unique' };
    const classEl = document.getElementById('combat-enemy-class');
    if (classEl) {
        classEl.className = `text-xs px-1 rounded ${colors[m.class]}`;
        classEl.textContent = names[m.class];
    }

    // Enemy affixes
    const affixesEl = document.getElementById('combat-enemy-affixes');
    if (affixesEl) {
        affixesEl.innerHTML = (m.affixes || []).map(a =>
            `<span class="text-xs px-1 rounded ${AFFIXES[a].class}">${AFFIXES[a].name}</span>`
        ).join('');
    }

    // Enemy HP
    if (m.hp > m.maxHp) m.hp = m.maxHp;
    document.getElementById('enemy-hp-bar').style.width = (m.hp / m.maxHp * 100) + '%';
    document.getElementById('enemy-hp-text').textContent = `${Math.max(0, Math.round(m.hp))}/${m.maxHp}`;

    // Enemy stats
    document.getElementById('combat-enemy-dmg').textContent = m.damage;
    document.getElementById('combat-enemy-def').textContent = m.defense;
    // enemy stats (Updated to match Player UI: Dmg, Def, Hit, Crit)
    document.getElementById('combat-enemy-dmg').textContent = m.damage;
    document.getElementById('combat-enemy-def').textContent = m.defense;

    // Check if we have hit/crit stats, otherwise use defaults
    const hit = m.hitChance || 80;
    const crit = m.critChance || 5;

    // Use existing slots for Health/Type to show Hit/Crit instead
    // We need to change the LABELS first in the HTML which are static?
    // Actually the HTML structure is: 
    // <div class="flex justify-between"><span class="text-gray-400">❤️ Health:</span><span id="combat-enemy-hp-stat" ...></span></div>
    // We should change the INNER HTML of the parent or just change textContent of the label if we could select it.
    // Easier: Just replace the content of the container lines if we can identify them.
    // The previous code selected by ID. I'll just change the text content of the VALUES and assume the labels are static for now, 
    // BUT the user wants the LABELS to match too. 
    // "Ті ж самі параметри треба показувати"

    // I will rewrite the stats block entirely using innerHTML to be safe and correct.
    const statsContainer = document.getElementById('combat-enemy-dmg').parentElement.parentElement;
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="flex justify-between"><span class="text-gray-400">⚔️ Damage:</span><span id="combat-enemy-dmg" class="text-orange-400">${m.damage}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">🛡️ Defense:</span><span id="combat-enemy-def" class="text-blue-400">${m.defense}</span></div>
            <div class="flex justify-between"><span class="text-gray-400">🎯 Hit:</span><span id="combat-enemy-hit" class="text-green-400">${hit}%</span></div>
            <div class="flex justify-between"><span class="text-gray-400">💫 Crit:</span><span id="combat-enemy-crit" class="text-yellow-400">${crit}%</span></div>
        `;
    }
}

export function updateCombatPlayerEquipment() {
    const slots = ['helmet', 'armor', 'shield', 'sword', 'boots', 'gloves', 'belt'];
    const defaults = { helmet: '🪖', armor: '🦺', shield: '🛡️', sword: '⚔️', boots: '👢', gloves: '🧤', belt: '🥋' };

    slots.forEach(slot => {
        const el = document.getElementById(`combat-player-${slot}`);
        if (el) {
            const itemId = gameState.equipment[slot];
            if (itemId && ITEMS_DB[itemId]) {
                el.textContent = ITEMS_DB[itemId].icon;
                el.classList.add('equipped');
            } else {
                el.textContent = defaults[slot];
                el.classList.remove('equipped');
            }
        }
    });

    updateCombatEnemyEquipment();
}

export function updateCombatEnemyEquipment() {
    const m = gameState.combat.monster;
    if (!m || !m.isPlayer) {
        // Clear or Hide if not PvP? Or just leave default.
        // For monsters, maybe hide slots?
        // For now, let's just return.
        return;
    }

    // Opponent equipment should be in m.equipment if passed correctly.
    // In startPvPCombat, we should ensure we attach 'equipment' to pvpEnemy.
    const equipment = m.equipment || {};

    const slots = ['helmet', 'armor', 'shield', 'sword', 'boots', 'gloves', 'belt'];
    const defaults = { helmet: '🪖', armor: '🦺', shield: '🛡️', sword: '⚔️', boots: '👢', gloves: '🧤', belt: '🥋' };

    slots.forEach(slot => {
        const el = document.getElementById(`combat-enemy-${slot}`);
        if (el) {
            const itemId = equipment[slot];
            if (itemId && ITEMS_DB[itemId]) {
                el.textContent = ITEMS_DB[itemId].icon;
                el.classList.add('equipped');
            } else {
                el.textContent = defaults[slot];
                el.classList.remove('equipped');
            }
        }
    });
}

// ==================== VICTORY & DEFEAT ====================
// ==================== VICTORY & DEFEAT ====================
export function victory() {
    if (!gameState.combat) return;

    const m = gameState.combat.monster;
    m.hp = 0;

    document.getElementById('combat-screen').classList.add('hidden');

    // --- PVP VICTORY ---
    if (m.isPlayer) {
        // Update PvP Stats
        if (!gameState.player.pvp) gameState.player.pvp = { wins: 0, losses: 0 };
        gameState.player.pvp.wins++;

        addEventLog(`PvP Victory against ${m.name}!`, 'success');
        showNotification(`🏆 Victory! Added to stats.`, 'success');

        // Update UI
        updateHUD();
        saveGame();

        document.getElementById('victory-screen').classList.remove('hidden');
        document.getElementById('reward-xp').textContent = "0 (PvP)";
        document.getElementById('reward-gold').textContent = "0";
        document.getElementById('reward-items').innerHTML = '';
        document.getElementById('level-up-notice').classList.add('hidden');

        gameState.combat = null;
        return;
    }

    // --- MONSTER VICTORY ---
    // Update static monster state
    if (gameState.combat.isStatic) {
        const staticMonsters = getStaticMonsters();
        const staticRef = staticMonsters.find(mon => mon.id === m.id);
        if (staticRef) {
            staticRef.defeated = true;
            staticRef.respawnAt = Date.now() + GRID_SETTINGS.respawnMs;
            // Will need saveStaticMonsters function
        }
    }

    const leveledUp = window.addXP ? window.addXP(m.xpReward, 'Monster') : false;
    gameState.player.gold += m.goldReward;
    gameState.quests.monstersKilled++;
    if (m.class === 'unique' || m.class === 'superUnique') gameState.quests.uniquesKilled++;

    addEventLog(`Victory! +${m.xpReward} XP, +${m.goldReward} gold`, 'success');

    renderStaticMonsters(true);

    document.getElementById('reward-xp').textContent = m.xpReward;
    document.getElementById('reward-gold').textContent = m.goldReward;
    document.getElementById('level-up-notice').classList.toggle('hidden', !leveledUp);

    const lootItems = Object.keys(ITEMS_DB).filter(k => ITEMS_DB[k].type !== 'consumable');
    if (Math.random() < 0.3) {
        const id = lootItems[Math.floor(Math.random() * lootItems.length)];
        gameState.inventory.push({ id, quantity: 1 });
        gameState.quests.itemsCollected++;
        addEventLog(`Found: ${ITEMS_DB[id].name}`, 'item');
        document.getElementById('reward-items').innerHTML = `<p class="text-purple-400">+ ${ITEMS_DB[id].icon} ${ITEMS_DB[id].name}</p>`;
    } else {
        document.getElementById('reward-items').innerHTML = '';
    }

    document.getElementById('victory-screen').classList.remove('hidden');

    // CASTLE CAPTURE LOGIC
    if (m.isCastleGuard && m.castleId) {
        console.log(`🏰 SIEGE SUCCESS! Claiming castle ${m.castleId}...`);

        const currentUser = getCurrentUser();
        const castleData = {
            id: m.castleId,
            name: m.castleName || 'Captured Castle',
            level: m.level || 1,
            ownerId: currentUser.uid,
            ownerName: currentUser.displayName || gameState.player.name || 'Unknown Hero',
            ownerAvatar: gameState.player.avatar || '🧙',
            lastPay: Date.now(),
            lat: m.lat,
            lng: m.lng
        };

        // 1. Update remote database (Firestore)
        claimCastle(m.castleId, castleData);

        // 2. Update local player state for income processing
        if (!gameState.player.capturedCastles) gameState.player.capturedCastles = [];

        // Remove old entry if exists (overtaking)
        gameState.player.capturedCastles = gameState.player.capturedCastles.filter(c => c.id !== m.castleId);
        gameState.player.capturedCastles.push(castleData);

        addEventLog(`🏰 You have captured ${castleData.name}!`, 'success');
        showNotification(`🏰 Castle Captured! You will now receive gold income.`, 'success');

        // 3. Save local state
        saveGame();
    }

    gameState.combat = null;
    updateHUD();
}

export function defeat() {
    const monsterId = gameState.combat?.monster?.id;
    const isPvP = gameState.combat?.monster?.isPlayer;

    document.getElementById('combat-screen').classList.add('hidden');
    document.getElementById('defeat-screen').classList.remove('hidden');

    if (isPvP) {
        if (!gameState.player.pvp) gameState.player.pvp = { wins: 0, losses: 0 };
        gameState.player.pvp.losses++;

        addEventLog(`PvP Defeat. Added to stats.`, 'error');
        saveGame();

        // No penalty for PvP? Or maybe full heal?
        // Let's keep current HP (which is <= 0) and let 'Revive' button handle it at 30%?
        // Standard defeat flow handles revive logic outside this function (on button click).
        // But here we usually apply penalties immediately.

        // Standard penalty application:
        const stats = getPlayerStats();
        gameState.player.hp = Math.floor(stats.maxHp * 0.1); // Recover to 10% automatically? 
        // Or wait for revive button.
        // Existing logic for monster sets HP to 30% and Gold * 0.9.

        // For PvP - No Gold Penalty
        gameState.player.hp = Math.floor(stats.maxHp * 0.1); // 10% HP left

    } else {
        const p = recalculateStats();
        gameState.player.hp = Math.floor(p.maxHp * 0.3);
        gameState.player.gold = Math.floor(gameState.player.gold * 0.9);


        if (monsterId) {
            setMonsterInactive(monsterId, 5 * 60 * 1000);
            addEventLog(`Defeat! Monster is inactive for 5 minutes`, 'error');
        }
    }

    gameState.combat = null;
}

export function fleeCombat() {
    if (!gameState.combat) {
        console.log('⚠️ No active combat to flee from');
        return;
    }

    const monsterId = gameState.combat.monster?.id;
    const monsterName = gameState.combat.monster?.name || 'monster';

    console.log(`🏃 Fleeing from ${monsterName} (ID: ${monsterId})`);

    // 5% XP Penalty
    const xpPenalty = BigInt(Math.floor(Number(gameState.player.xp) * 0.05));
    if (xpPenalty > 0n) {
        gameState.player.xp -= xpPenalty;
        // Prevent XP from dropping below 0? Assuming BigInt handles it or it's handled elsewhere
        if (gameState.player.xp < 0n) gameState.player.xp = 0n;
    }

    // 1 Hour Cooldown
    if (monsterId) {
        setMonsterInactive(monsterId, 60 * 60 * 1000); // 1 hour
    }

    document.getElementById('combat-screen').classList.add('hidden');

    gameState.combat = null;
    selectedAttackZone = null;
    selectedDefenseZone = null;

    showNotification(`🏃 Escaped! Lost ${xpPenalty} XP`, 'warning');
    addEventLog(`Fled from ${monsterName}. Lost ${xpPenalty} XP.`, 'warning');
    saveGame(); // Save XP loss and cooldown

    renderStaticMonsters(true);
}





function ensureVictoryIfDead() {
    if (!gameState.combat || gameState.combat.resolved) return;
    const m = gameState.combat.monster;
    if (m.hp <= 0) {
        m.hp = 0;
        gameState.combat.resolved = true;
        selectedAttackZone = null;
        selectedDefenseZone = null;
        document.querySelectorAll('.enemy-zone').forEach(z => z.classList.remove('selected-attack'));
        document.querySelectorAll('.defense-btn').forEach(b => b.classList.remove('selected-defense'));
        const btn = document.getElementById('attack-btn');
        if (btn) btn.disabled = true;
        victory();
    }
}

// ==================== HELPERS ====================
export function closeVictory() {
    document.getElementById('victory-screen').classList.add('hidden');
    updateHUD();
}

export function closeDefeat() {
    document.getElementById('defeat-screen').classList.add('hidden');
    updateHUD();
}

// ==================== PVP DRAW ====================

/**
 * Нічия у PvP бою — обидва гравці загинули одночасно
 * Відновлює HP до 30%, не нараховує перемог/поразок
 */
export function pvpDraw() {
    document.getElementById('combat-screen').classList.add('hidden');
    document.getElementById('draw-screen').classList.remove('hidden');

    // Ініціалізуємо pvp stats якщо немає
    if (!gameState.player.pvp) gameState.player.pvp = { wins: 0, losses: 0, draws: 0 };
    if (gameState.player.pvp.draws === undefined) gameState.player.pvp.draws = 0;
    gameState.player.pvp.draws++;

    // Відновлюємо HP до 30% (компроміс — ніхто не виграв)
    const stats = recalculateStats();
    gameState.player.hp = Math.floor(stats.maxHp * 0.3);

    addEventLog(`🤝 PvP Draw! Both fighters fell simultaneously.`, 'warning');
    saveGame();

    gameState.combat = null;
    updateHUD();
}

export function closeDraw() {
    document.getElementById('draw-screen').classList.add('hidden');
    updateHUD();
}

function setMonsterInactive(monsterId, durationMs = 5 * 60 * 1000) {
    const inactiveUntil = Date.now() + durationMs;
    gameState.inactiveMonsters[monsterId] = inactiveUntil;
    console.log(`🚫 Monster ${monsterId} is inactive until ${new Date(inactiveUntil).toLocaleTimeString()}`);
}

// Placeholder - will be imported from stats module
// getPlayerStats removed and centralized in gameState.js



// ==================== PVP HANDLERS ====================

export async function startPvPCombat(battleId) {
    console.log("⚔️ Starting PvP Combat for Battle:", battleId);

    // 1. Fetch Battle Data
    const { getBattleRequest, getCharacter, getCurrentUser } = await import('./firebase-service.js');
    const battleData = await getBattleRequest(battleId);
    if (!battleData) {
        showNotification("❌ Battle data not found!", "error");
        return;
    }

    // 2. Determine Opponent
    const user = getCurrentUser();
    const myUid = user.uid;
    const isAttacker = battleData.attackerId === myUid;
    const opponentId = isAttacker ? battleData.targetId : battleData.attackerId;
    const opponentCharId = isAttacker ? battleData.targetCharId : battleData.attackerCharId;

    console.log(`⚔️ PvP: Opponent identified as ${opponentId} (Char: ${opponentCharId})`);

    // 3. Fetch Opponent Data
    // TRY RTDB FIRST (Public & Fast)
    const { getLivePlayer } = await import('./firebase-service.js');
    let opponent = await getLivePlayer(opponentCharId);

    if (!opponent) {
        console.warn("⚠️ PvP: Opponent not in RTDB, trying Firestore...");
        opponent = await getCharacter(opponentId, opponentCharId);
    }

    console.log("⚔️ PvP: Fetched Opponent Data:", opponent);

    // Fail-safe if permission denied or missing (Mocking for now to ensure UI opens)
    if (!opponent) {
        console.warn("⚠️ PvP: Could not fetch opponent data (Permission/Missing). Using fallback.");
        opponent = {
            name: "Unknown Player",
            level: 1,
            stats: { strength: 5, agility: 5, vitality: 5, intuition: 5 },
            image: "👤"
        };
    }

    // 4. Convert to "Monster" format
    // 5. Convert to "Monster" format
    // Use derived stats from RTDB if available (exact match), otherwise calc fallback
    const s = opponent.stats || {};

    const pvpEnemy = {
        id: opponentId, // Use UID as ID
        name: opponent.name || "Unknown",
        level: opponent.level || 1,
        // Use exact maxHp from source or calc fallback
        hp: s.maxHp || (100 + ((s.vitality || 5) * 10)),
        maxHp: s.maxHp || (100 + ((s.vitality || 5) * 10)),
        // Use exact damage or calc fallback
        damage: s.derivedDamage || (5 + ((s.strength || 5) * 2)),
        defense: s.effective?.defense || 0,
        critChance: s.critChance || 5,
        hitChance: s.hitChance || 80,
        xpReward: 0,
        goldReward: 0,
        class: opponent.class || 'Player',
        type: 'human',
        icon: opponent.avatar || opponent.image || '👤',
        isPlayer: true, // Flag for PvP logic
        equipment: opponent.equipment || {} // Pass equipment
    };

    // 5. Start Combat
    startCombat(pvpEnemy, true);

    // EXPLICITLY SET PVP FLAG
    gameState.combat.isPvP = true;

    // 6. Initialize Battle Logic
    const { BattleLogic } = await import('./battle-logic.js?v=2');
    const { subscribeToPath } = await import('./firebase-service.js');

    // Determine Role
    const role = isAttacker ? 'player1' : 'player2';

    console.log(`⚔️ PvP Init: BattleId=${battleId}, Role=${role}`);

    // Init Logic
    gameState.combat.logic = new BattleLogic(battleId, user, role, {
        onWait: (msg) => {
            console.log(`⚔️ PvP Wait: ${msg}`);

            // 1. Status Text under button (Clean, single instance)
            const statusEl = document.getElementById('combat-status');
            if (statusEl) {
                statusEl.innerHTML = `<span class="animate-pulse">⏳ ${msg}</span>`;
            }

            // 2. Disable Button (Visual Feedback)
            const btn = document.getElementById('attack-btn');
            if (btn) {
                btn.disabled = true;
                // Optional: We can keep the button text as Sword to be cleaner, 
                // or change it. The user said "under the button", so let's revert the button text change 
                // to keep the button looking like a button, and rely on the text below.
                // Reverting button text change for "cleaner" look as requested.
                btn.innerHTML = `⚔️`;
            }

            gameState.combat.isWaiting = true;
            document.querySelectorAll('.combat-zone').forEach(b => b.classList.add('opacity-50', 'pointer-events-none'));
        },
        onRoundResult: (result) => {
            handlePvPRoundResult(result);
        },
        onTimerTick: (time) => {
            const timerEl = document.getElementById('combat-timer');
            if (timerEl) timerEl.textContent = time;
        }
    });

    // Subscribe to Round Updates
    const roundPath = `battles/${battleId}/rounds`;

    gameState.combat.unsub = subscribeToPath(roundPath, (roundsData) => {
        if (!roundsData) return;

        const logic = gameState.combat.logic;
        if (!logic) return;

        // 1. Fast-forward completed rounds (Catch-up)
        let safety = 0;
        while (roundsData[logic.currentRound] && roundsData[logic.currentRound].result && safety < 50) {
            console.log(`⏩ Catching up Round ${logic.currentRound}...`);
            logic.handleRoundUpdate(roundsData[logic.currentRound]);
            safety++;
        }

        // 2. Handle Current/Active Round
        const currentRoundData = roundsData[logic.currentRound];
        if (currentRoundData) {
            logic.handleRoundUpdate(currentRoundData);
        }
    });

    // Create Timer UI
    if (!document.getElementById('combat-timer')) {
        const timer = document.createElement('div');
        timer.id = 'combat-timer';
        timer.className = 'absolute top-2 left-1/2 -translate-x-1/2 text-2xl font-bold text-yellow-500 bg-black/50 px-3 rounded-full border border-yellow-500/30';
        timer.textContent = '20';
        document.getElementById('combat-screen').appendChild(timer);
    }
}

function handlePvPRoundResult(result) {
    console.log("⚔️ Round Resolved:", result);

    // Clear Status Text
    const statusEl = document.getElementById('combat-status');
    if (statusEl) statusEl.textContent = '';

    // Enable All Controls
    const attackBtn = document.getElementById('attack-btn');
    if (attackBtn) {
        attackBtn.disabled = false; // Temporarily enable to remove stuck state
        attackBtn.innerHTML = `⚔️`; // Reset Text to Icon
    }
    gameState.combat.isWaiting = false;

    document.querySelectorAll('.combat-zone').forEach(b => b.classList.remove('opacity-50', 'pointer-events-none'));
    document.querySelectorAll('.defense-btn').forEach(b => b.classList.remove('opacity-50', 'pointer-events-none'));

    // Visual Separator to push "Waiting..." up (No longer needed if we removed waiting from log, but good for rounds)
    const logEl = document.getElementById('combat-log');
    if (logEl) {
        logEl.innerHTML += `<div class="my-1 border-t border-gray-700 w-full opacity-30"></div>`;
    }

    // Clear Selection logic
    selectedAttackZone = null;
    selectedDefenseZone = null;
    document.querySelectorAll('.enemy-zone').forEach(z => z.classList.remove('selected-attack'));
    document.querySelectorAll('.defense-btn').forEach(b => b.classList.remove('selected-defense'));

    // Disable Attack Button until new valid selection
    if (attackBtn) attackBtn.disabled = true;

    // Update HP locally (result should have damage values)
    const { p1_damage, p2_damage } = result;

    const isP1 = gameState.combat.logic.role === 'player1';
    const myDamageTaken = isP1 ? p2_damage : p1_damage; // If I am P1, P2 attacked me
    const enemyDamageTaken = isP1 ? p1_damage : p2_damage; // If I am P1, I attacked P2

    // Apply to UI (Self)
    const playerHpText = document.getElementById('combat-player-hp-text');
    let currentHp = parseInt(playerHpText.textContent.split('/')[0]);
    currentHp = Math.max(0, currentHp - myDamageTaken);
    // Update bar... (omitted for brevity, assume simple update)
    if (currentHp < 0) currentHp = 0;
    const maxHp = parseInt(playerHpText.textContent.split('/')[1]);
    document.getElementById('combat-player-hp').style.width = `${(currentHp / maxHp) * 100}%`;
    playerHpText.textContent = `${currentHp}/${maxHp}`;

    // Apply to UI (Enemy)
    const enemy = gameState.combat.monster;
    enemy.hp = Math.max(0, enemy.hp - enemyDamageTaken);
    document.getElementById('enemy-hp-bar').style.width = `${(enemy.hp / enemy.maxHp) * 100}%`;
    document.getElementById('enemy-hp-text').textContent = `${Math.max(0, Math.round(enemy.hp))}/${enemy.maxHp}`;

    // Logs
    // logEl is already defined above
    logEl.innerHTML += `<p class="text-green-400">⚔️ You dealt ${enemyDamageTaken} damage.</p>`;
    logEl.innerHTML += `<p class="text-red-400">💥 You took ${myDamageTaken} damage.</p>`;
    logEl.scrollTop = logEl.scrollHeight;

    // Check Win/Loss/Draw
    // DRAW перевіряємо ПЕРШИМ — якщо обидва HP <= 0 одночасно
    if (enemy.hp <= 0 && currentHp <= 0) {
        pvpDraw();
    } else if (enemy.hp <= 0) {
        victory();
    } else if (currentHp <= 0) {
        document.getElementById('combat-screen').classList.add('hidden');
        document.getElementById('defeat-screen').classList.remove('hidden');
    }
}

// Global exports for HTML onclick handlers
window.selectAttackZone = selectAttackZone;
window.selectDefense = selectDefense;
window.executeAttack = executeAttack;
window.fleeCombat = fleeCombat;
window.closeVictory = closeVictory;
window.closeDefeat = closeDefeat;
window.closeDraw = closeDraw;

window.startCombat = startCombat;
window.startPvPCombat = startPvPCombat;
window.showPreCombatDialog = showPreCombatDialog;
