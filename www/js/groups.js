import { gameState, saveGame } from './gameState.js';
import { showNotification, updateHUD } from './ui.js';

export function createGroup() {
    if (gameState.player.groupId) {
        showNotification("⚠️ Ви вже в групі!", "warning");
        return;
    }

    const groupId = 'group_' + Math.random().toString(36).substr(2, 9);
    gameState.player.groupId = groupId;
    gameState.currentGroup = {
        id: groupId,
        leaderId: gameState.activePlayerId || 'player_1',
        members: [
            { id: gameState.activePlayerId || 'player_1', name: gameState.player.name, level: gameState.player.level }
        ]
    };

    showNotification("👥 Групу створено! Тепер ви можете атакувати замки разом.", "success");
    updateHUD();
    saveGame();
}

export function joinGroup(groupId) {
    // В реальності тут буде запит до Firebase
    // Поки що - імітація для дебагу
    showNotification(`👥 Ви приєдналися до групи ${groupId}`, "info");
}

export function getGroupMaxLevel() {
    if (!gameState.currentGroup) return gameState.player.level;
    return Math.max(...gameState.currentGroup.members.map(m => m.level));
}

window.createGroup = createGroup;
