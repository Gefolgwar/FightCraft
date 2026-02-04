import { gameState } from './gameState.js';
import { GameData } from './data.js';

export function updateHUD() {
    const player = gameState.player;
    const stats = window.getPlayerStats ? window.getPlayerStats() : { maxHp: player.maxHp };

    document.getElementById('player-level').textContent = player.level;
    document.getElementById('hp-bar').style.width = (player.hp / stats.maxHp * 100) + '%';
    document.getElementById('hp-text').textContent = `${Math.max(0, Math.floor(player.hp))}/${stats.maxHp}`;

    const xpToNext = player.xpToNext || 500n;
    document.getElementById('xp-bar').style.width = (Number(player.xp) / Number(xpToNext) * 100) + '%';
    document.getElementById('xp-text').textContent = `${player.xp}/${xpToNext}`;

    // Update GPS status indicator
    const gpsPill = document.getElementById('gps-pill');
    if (gpsPill) {
        gpsPill.style.opacity = gameState.settings.useGPS ? '1' : '0.5';
        document.getElementById('gps-pill-text').textContent = gameState.settings.useGPS ? 'GPS: ON' : 'GPS: OFF';
        document.getElementById('gps-pill-icon').textContent = gameState.settings.useGPS ? '📡' : '📍';
    }
}

export function openMenu(menu) {
    closeMenu();
    document.getElementById(menu + '-panel').classList.remove('hidden');
    if (menu === 'inventory' && window.renderInventory) window.renderInventory();
    if (menu === 'character' && window.updateCharacterPanel) window.updateCharacterPanel();
}

export function closeMenu() {
    ['character', 'inventory', 'quests', 'settings'].forEach(menu => {
        const el = document.getElementById(menu + '-panel');
        if (el) el.classList.add('hidden');
    });
}

export function showNotification(message, type = 'info') {
    if (!gameState.settings.notifications) return;
    const container = document.getElementById('notifications');
    if (!container) return;

    const colors = {
        info: 'bg-blue-600/90 border-blue-400/50',
        success: 'bg-green-600/90 border-green-400/50',
        warning: 'bg-yellow-600/90 border-yellow-400/50',
        error: 'bg-red-600/90 border-red-400/50'
    };

    const notif = document.createElement('div');
    notif.className = `notification ${colors[type] || colors.info} border-2 px-4 py-2 rounded-xl shadow-2xl text-xs font-bold uppercase tracking-widest backdrop-blur-md`;
    notif.textContent = message;
    container.appendChild(notif);

    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transform = 'translateX(20px)';
        setTimeout(() => notif.remove(), 500);
    }, 3000);
}

export function updateQuestProgress() {
    const q = gameState.quests;
    // Static milestones for demo
    const monstersTarget = 5;
    const itemsTarget = 5;

    const progress1 = document.getElementById('quest-progress-1');
    if (progress1) {
        progress1.style.width = Math.min(100, q.monstersKilled / monstersTarget * 100) + '%';
        document.getElementById('quest-count-1').textContent = `${Math.min(monstersTarget, q.monstersKilled)}/${monstersTarget}`;
    }
}

export function updateDebugUI() {
    const isDebug = gameState.debug.enabled;
    const debugToggle = document.getElementById('debug-toggle');
    if (!debugToggle) return;

    debugToggle.className = `toggle-btn ${isDebug ? 'on' : 'off'}`;

    document.getElementById('debug-badge')?.classList.toggle('hidden', !isDebug);
    document.getElementById('debug-options')?.classList.toggle('hidden', !isDebug);
    document.getElementById('joystick-container')?.classList.toggle('hidden', !isDebug || !gameState.debug.joystick);

    updateToggleButton('click-move-toggle', gameState.debug.clickToMove);
    updateToggleButton('joystick-toggle', gameState.debug.joystick);
}

export function updateToggleButton(id, isActive) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.className = `toggle-btn ${isActive ? 'on' : 'off'}`;
}

export function updateCharacterPanel() {
    const p = gameState.player;
    const stats = window.getPlayerStats();

    document.getElementById('char-level').textContent = p.level;
    document.getElementById('char-xp').textContent = p.xp.toString();
    document.getElementById('char-xp-next').textContent = p.xpToNext.toString();

    document.getElementById('stat-str').textContent = p.strength;
    document.getElementById('stat-agi').textContent = p.agility;
    document.getElementById('stat-int').textContent = p.intuition;
    document.getElementById('stat-vit').textContent = p.vitality;

    document.getElementById('stat-hp').textContent = stats.maxHp;
    document.getElementById('stat-dmg').textContent = stats.damage;
    document.getElementById('stat-def').textContent = stats.defense;
    document.getElementById('stat-hit').textContent = stats.hitChance + '%';
    document.getElementById('stat-crit').textContent = stats.critChance + '%';
    document.getElementById('stat-regen').textContent = '+' + stats.regenRate;

    const pointsHint = document.getElementById('points-hint');
    if (pointsHint) {
        pointsHint.classList.toggle('hidden', p.statPoints <= 0);
        document.getElementById('points-inline').textContent = p.statPoints;
    }

    document.querySelectorAll('.stat-plus-btn').forEach(btn => {
        btn.classList.toggle('hidden', p.statPoints <= 0);
    });
}

window.updateHUD = updateHUD;
window.openMenu = openMenu;
window.closeMenu = closeMenu;
window.showNotification = showNotification;
window.updateQuestProgress = updateQuestProgress;
window.updateDebugUI = updateDebugUI;
window.updateCharacterPanel = updateCharacterPanel;
