// Main application initialization
import { gameState, updatePlayer, setStaticMonsters, getStaticMonsters, STATIC_MONSTER_KEY, recalculateStats } from './gameState.js';
import { ITEMS_DB, MONSTER_LIBRARY, CITY_ANCHORS } from './data.js';
import { initFirebase, savePlayerToCloud, loadPlayerFromCloud, getCurrentUser, subscribeToPlayersRTDB, saveCharacter, getCharacter, logout, subscribeToSpawnedObjects } from './firebase-service.js';
import { updateHUD, showNotification, addEventLog, updateEventLogDisplay, renderInventory, updateAdminPlayersList, renderOnlinePlayersList } from './ui-controller.js';
import { initMap, updatePlayerPosition, getDistance, updateOtherPlayers, renderStaticMonsters, updateDebugCoords, centerOnPlayer } from './map.js';
import { loadStaticMonsters, buildStaticMonsters } from './monsters.js';
import { initCharacterSelection } from './character-selection.js';
import './combat.js'; // Combat system (exports to window)

window.logout = logout;

console.log('✅ app.js module loaded - setting up window functions...');



import { initPvP } from './pvp.js';
import { initKingdom } from './kingdom.js';


import { initLogger } from './logger.js';

// Init logger early to catch all startup logs
initLogger();

// ==================== INITIALIZATION ====================
async function init() {
    const bar = document.getElementById('loading-bar');
    const status = document.getElementById('loading-status');

    const updateProgress = (phase, percent) => {
        if (bar) bar.style.width = percent + '%';
        if (status) status.textContent = phase;
        console.log(`[INIT] ${percent}% - ${phase}`);
    };

    updateProgress('Initializing modules...', 5);

    // Initialize character selection (includes Firebase init)
    updateProgress('Connecting to servers...', 10);
    const charResult = await initCharacterSelection();

    if (!charResult) {
        // User needs to select/create character
        console.log('⏸️ Waiting for character selection...');

        // Hide loading screen but keep logic ready
        const loadingScreen = document.getElementById('loading-screen');
        if (loadingScreen) loadingScreen.classList.add('hidden');
        return;
    }

    // Character selected - load data
    const { characterId, data } = charResult;
    updateProgress(`Syncing ${data.player.name}...`, 25);

    // Store character ID globally
    const user = getCurrentUser();
    window._currentUserId = user?.uid;
    window._currentCharacterId = characterId;
    window._currentlyPlayingCharacterId = characterId;

    // Load character data into gameState
    Object.assign(gameState, data);

    // CRITICAL: Restore BigInts (Firestore converts them to strings)
    if (gameState.player) {
        gameState.player.xp = BigInt(gameState.player.xp || '0');
        gameState.player.xpToNext = BigInt(gameState.player.xpToNext || '500');

        // Ensure stats are present
        const stats = ['strength', 'agility', 'intuition', 'vitality', 'intellect', 'wisdom'];
        stats.forEach(s => {
            if (gameState.player[s] === undefined) gameState.player[s] = 5;
        });
        if (gameState.player.statPoints === undefined) gameState.player.statPoints = 0;
    }

    // Restore debug mode preference
    const savedDebug = localStorage.getItem('debugModeEnabled');
    if (savedDebug !== null) {
        gameState.debug.enabled = savedDebug === 'true';
    }

    // Store User Nickname separately for Map display
    const currentUser = getCurrentUser();
    if (currentUser) {
        gameState.player.userName = currentUser.displayName;
    }

    updateProgress('Loading world data...', 40);
    // Subscribe to other players (LIVE version via RTDB)
    subscribeToPlayersRTDB((players) => {
        updateOtherPlayers(players);
        renderOnlinePlayersList(players);
    });

    // Try to get real GPS coordinates
    const defaultCoords = { lat: 52.484512, lng: 13.449876 }; // Berlin by default

    updateProgress('Acquiring location...', 50);
    try {
        if ('geolocation' in navigator) {
            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    pos => resolve(pos),
                    err => reject(err),
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            });

            gameState.player.position = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            addEventLog(`GPS acquired: ${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)}`, 'success');
        } else {
            throw new Error('Geolocation not supported');
        }
    } catch (error) {
        console.warn('GPS unavailable, using default coordinates:', error.message);
        // If we have a last known position in character data, use that instead of default Berlin
        if (data.position && data.position.lat) {
            gameState.player.position = data.position;
            addEventLog(`GPS unavailable, using last known location`, 'warning');
        } else {
            gameState.player.position = defaultCoords;
            addEventLog(`GPS unavailable, using Berlin`, 'warning');
        }
    }

    updateProgress('Reticulating splines...', 70);

    // Only init map if map container exists
    const mapEl = document.getElementById('map');
    if (mapEl) {
        await initMap();

        updateProgress('Spawning monsters...', 80);
        // Clear old local cache to ensure we only see database monsters
        localStorage.removeItem(STATIC_MONSTER_KEY);
        loadStaticMonsters();
        renderStaticMonsters();

        updateProgress('Syncing world data...', 85);
        const { fetchSpawnedObjectsOnce, getCityZones, getTemplates } = await import('./firebase-service.js');

        // Consolidate startup reads here too (for auto-loaded characters)
        console.log('🌍 Bundling startup reads (Auto-load)...');
        await Promise.all([
            fetchSpawnedObjectsOnce(),
            getCityZones('berlin'),
            getTemplates('monster'),
            getTemplates('shop'),
            getTemplates('castle')
        ]);

        updateProgress('Scanning landmarks...', 90);
        const { checkAndFetchPOIs } = await import('./poi.js');
        await checkAndFetchPOIs();

        // Load test players to map immediately (if admin in debug mode)
        if (gameState.debug.enabled) {
            const { loadTestPlayersToMap, isAdmin } = await import('./firebase-service.js');
            if (isAdmin()) {
                loadTestPlayersToMap();
            }
        }

        // Start World Sync (Admin Spawns)
        setupWorldSync();

        // Initialize PvP & Stats
        initPvP();
        initKingdom();
    }

    const p = recalculateStats();
    if (!p.hp) p.hp = p.maxHp;


    updateProgress('Finalizing UI...', 95);

    // Update setting toggles
    ['sound', 'notifications', 'fog', 'vibration'].forEach(setting => {
        const toggle = document.getElementById(`${setting}-toggle`);
        if (toggle) {
            if (gameState.settings[setting]) {
                toggle.classList.add('on');
                toggle.classList.remove('off');
            } else {
                toggle.classList.add('off');
                toggle.classList.remove('on');
            }
        }
    });

    if (!gameState.settings.fog) {
        const fogEl = document.getElementById('fog');
        if (fogEl) fogEl.style.display = 'none';
    }

    updateProgress('Ready!', 100);
    await new Promise(r => setTimeout(r, 500));

    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.classList.add('hidden');

    updateHUD();

    // Initialize debug mode UI based on gameState.debug.enabled
    initializeDebugMode();

    // Start Loops
    import('./poi.js').then(({ processIncome }) => {
        setInterval(() => {
            updateRegeneration();
            processIncome();
            setupWorldSync(); // Check for city changes
        }, 1000);
    });

    // Save Logic Optimization: Remove 60s timer and use debounced events
    let saveTimeout = null;
    window.triggerSave = (immediate = false) => {
        if (immediate) {
            saveGame();
            return;
        }
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveGame();
        }, 5000); // Wait 5s after last change before saving
    };

    // Show multiplayer panel
    const mpPanel = document.getElementById('multiplayer-panel');
    if (mpPanel) mpPanel.classList.remove('hidden');

    updateEventLogDisplay();
    console.log('✅ Game fully initialized');

    // Run diagnostics after 10s to ensure everything caught up
    import('./diagnostics.js').then(({ runStartupDiagnostics }) => {
        setTimeout(runStartupDiagnostics, 10000);
    });
}

/**
 * Start game with selected character
 * Called from character-selection.js when user picks/creates a character
 */
window.startGameWithCharacter = async function (characterId, data) {
    console.log(`🚀 Starting game with: ${data.player.name}`);

    const bar = document.getElementById('loading-bar');
    const status = document.getElementById('loading-status');

    const updateProgress = (phase, percent) => {
        if (bar) bar.style.width = percent + '%';
        if (status) status.textContent = phase;
        console.log(`[START] ${percent}% - ${phase}`);
    };

    // Show loading screen again
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) loadingScreen.classList.remove('hidden');

    updateProgress('Loading character...', 20);

    const user = getCurrentUser();
    window._currentUserId = user.uid;
    window._currentCharacterId = characterId;

    // Load character data into gameState (safe merge to preserve defaults)
    Object.assign(gameState, data);
    gameState.player = { ...gameState.player, ...data.player };
    gameState.equipment = { ...gameState.equipment, ...data.equipment };
    gameState.inventory = data.inventory || [];
    gameState.position = data.position || { lat: 52.484512, lng: 13.449876 };
    gameState.quests = data.quests || gameState.quests;
    gameState.settings = data.settings || gameState.settings;
    gameState.inactiveMonsters = data.inactiveMonsters || {};

    // CRITICAL: Restore BigInts (Firestore converts them to strings)
    if (gameState.player) {
        gameState.player.xp = BigInt(gameState.player.xp || '0');
        gameState.player.xpToNext = BigInt(gameState.player.xpToNext || '500');

        // Ensure stats are present
        const stats = ['strength', 'agility', 'intuition', 'vitality', 'intellect', 'wisdom'];
        stats.forEach(s => {
            if (gameState.player[s] === undefined) gameState.player[s] = 5;
        });
        if (gameState.player.statPoints === undefined) gameState.player.statPoints = 0;
    }

    // Restore debug mode preference
    const savedDebug = localStorage.getItem('debugModeEnabled');
    if (savedDebug !== null) {
        gameState.debug.enabled = savedDebug === 'true';
    }

    // Ensure player has position
    if (!gameState.player.position) {
        gameState.player.position = gameState.position;
    }

    updateProgress('Initializing map...', 40);
    await new Promise(r => setTimeout(r, 200));

    // ONE-TIME WORLD FETCH (Optimized Billing - Consolidate everything here)
    const { fetchSpawnedObjectsOnce, getCityZones, getTemplates } = await import('./firebase-service.js');
    updateProgress('Syncing world data...', 50);

    // Fire all initial fetches concurrently to speed up but consolidate tracking
    console.log('🌍 Bundling startup reads...');
    await Promise.all([
        fetchSpawnedObjectsOnce(),
        getCityZones('berlin'), // Initial city
        // Only fetch templates if admin (logic inside getTemplates handles it)
        getTemplates('monster'),
        getTemplates('shop'),
        getTemplates('castle')
    ]);

    // Subscribe to other players
    subscribeToPlayersRTDB((players) => {
        const currentCharId = window._currentCharacterId || (window._currentlyPlayingCharacterId) || (window._controllingPlayer ? window._controllingPlayer.id : null);

        // 1. Update Map Markers
        updateOtherPlayers(players);

        // 1.5. Update Online Players List UI
        renderOnlinePlayersList(players);

        // 2. Sync local gameState level 
        const selfData = players.find(p => p.id === currentCharId);
        if (selfData) {
            const serverLevel = Number(selfData.level);
            const localLevel = Number(gameState.player.level);
            if (serverLevel > localLevel) {
                gameState.player.level = serverLevel;
                if (selfData.xp) gameState.player.xp = BigInt(selfData.xp);
                gameState.player.xpToNext = BigInt(500 * serverLevel * serverLevel);
                updateHUD();
            }
        }

        // 3. Update Admin UI Lists
        updateAdminPlayersList(players);
    });

    // INITIAL POSITION SYNC
    const { updatePlayerLocationRTDB } = await import('./firebase-service.js');
    updatePlayerLocationRTDB(gameState.player.position.lat, gameState.player.position.lng);

    // Init map
    const mapEl = document.getElementById('map');
    if (mapEl) {
        initMap();
        updateProgress('Spawning monsters...', 80);
        localStorage.removeItem(STATIC_MONSTER_KEY);
        loadStaticMonsters();
        renderStaticMonsters();
        initPvP();
        initKingdom();
    }

    const p = recalculateStats();
    if (!p.hp) p.hp = p.maxHp;


    updateProgress('Configuring...', 70);

    // Update setting toggles
    ['sound', 'notifications', 'fog', 'vibration'].forEach(setting => {
        const toggle = document.getElementById(`${setting}-toggle`);
        if (toggle) {
            if (gameState.settings[setting]) {
                toggle.classList.add('on');
                toggle.classList.remove('off');
            } else {
                toggle.classList.add('off');
                toggle.classList.remove('on');
            }
        }
    });

    if (!gameState.settings.fog) {
        const fogEl = document.getElementById('fog');
        if (fogEl) fogEl.style.display = 'none';
    }

    updateProgress('Ready!', 100);
    await new Promise(r => setTimeout(r, 300));

    if (loadingScreen) loadingScreen.classList.add('hidden');

    updateHUD();
    initializeDebugMode();

    if (window.refreshSettingsVisibility) {
        window.refreshSettingsVisibility();
    }

    // Start game loops
    setInterval(() => updateRegeneration(), 1000);

    const mpPanel = document.getElementById('multiplayer-panel');
    if (mpPanel) mpPanel.classList.remove('hidden');

    updateEventLogDisplay();
    console.log('✅ Game started successfully!');
    showNotification(`Welcome, ${data.player.name}!`, 'success');
};

// ==================== GAME LOOP ====================
function updateRegeneration() {
    if (gameState.combat) return;
    const now = Date.now();
    if (now - gameState.player.lastDamageTime < 5000) return;

    const p = recalculateStats();
    if (p.hp < p.maxHp && p.regenRate > 0) {
        p.hp = Math.min(p.maxHp, p.hp + p.regenRate);
        updateHUD();
    }
}

// ==================== SAVE/LOAD ====================
export async function saveGame() {
    if (window._isSwitching) return;
    const now = Date.now();
    Object.keys(gameState.inactiveMonsters).forEach(id => {
        if (gameState.inactiveMonsters[id] < now) delete gameState.inactiveMonsters[id];
    });

    const data = JSON.parse(JSON.stringify({
        ...gameState,
        combat: null,
        player: {
            ...gameState.player,
            xp: gameState.player.xp.toString(),
            xpToNext: gameState.player.xpToNext.toString()
        }
    }));

    const isTestMode = !!(window._controllingPlayer && window._controllingPlayer.id) ||
        gameState.isTestPlayer === true ||
        gameState.player?.isTestPlayer === true;

    if (isTestMode) {
        const testCharId = (window._controllingPlayer && window._controllingPlayer.id) ||
            (gameState.id && gameState.id !== window._currentCharacterId ? gameState.id : null);

        if (window._currentUserId && testCharId) {
            saveCharacter(window._currentUserId, testCharId, data);
        }
    } else {
        localStorage.setItem('fightcraft_v3', JSON.stringify(data));
        if (window._currentUserId && window._currentCharacterId) {
            saveCharacter(window._currentUserId, window._currentCharacterId, data);
        }
    }
}

export async function loadGame() {
    const cloudData = await loadPlayerFromCloud();
    if (cloudData) return cloudData;
    const localSaved = localStorage.getItem('fightcraft_v3');
    return localSaved ? JSON.parse(localSaved) : null;
}

// resetGame is defined as window.resetGame below (avoiding duplicate)

// ==================== STATS ====================
// getPlayerStats removed and centralized in gameState.js


// ==================== QUEST PROGRESS ====================
export function updateQuestProgress() {
    // Placeholder - will implement quest system later
}

// Global exports (resetGame is defined below as window function)
window.saveGame = saveGame;
window.getPlayerStats = recalculateStats;
window.updateQuestProgress = updateQuestProgress;

// ==================== DEBUG FUNCTIONS ====================
window.teleportToCoords = function () {
    const lat = parseFloat(document.getElementById('teleport-lat').value);
    const lng = parseFloat(document.getElementById('teleport-lng').value);
    if (!isNaN(lat) && !isNaN(lng)) {
        updatePlayerPosition(lat, lng);
        showNotification(`✈️ Teleported to ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
    } else {
        showNotification('❌ Invalid coordinates', 'error');
    }
};

// Initialize debug mode UI on game load
// Initialize debug mode UI on game load
async function initializeDebugMode() {
    const { isAdmin, isModerator } = await import('./firebase-service.js');
    const isAuthorized = isAdmin() || isModerator();

    const badge = document.getElementById('debug-badge');
    const panel = document.getElementById('debug-panel');
    const joy = document.getElementById('joystick-container');
    const speed = document.getElementById('speed-control');
    const toggle = document.getElementById('debug-toggle');
    const tools = document.getElementById('debug-options');
    const mpDebug = document.getElementById('mp-debug');
    const consoleBtn = document.getElementById('debug-console-btn');

    // FORCE HIDE for non-authorized users
    if (!isAuthorized) {
        console.log("⛔ Access Denied: Debug Mode restricted to Admins/Mods.");
        gameState.debug.enabled = false;
        if (toggle) toggle.style.display = 'none'; // Hide the toggle button itself
    } else {
        if (toggle) toggle.style.display = 'flex'; // Show toggle for auth users
    }

    if (gameState.debug.enabled) {
        // Show all debug elements
        if (badge) badge.classList.remove('hidden');
        if (panel) panel.classList.remove('hidden');
        if (joy) joy.classList.remove('hidden');
        if (speed) speed.classList.remove('hidden');
        if (tools) tools.classList.remove('hidden');
        if (mpDebug) mpDebug.classList.remove('hidden');

        // Console button also depends on Admin (checked in refreshSettingsVisibility)
        // But if debug is OFF, it MUST be hidden.

        if (toggle) {
            toggle.classList.remove('off');
            toggle.classList.add('on');
        }
        if (gameState.debug.enabled) updateDebugCoords();

        // Update speed button states
        const currentSpeed = gameState.debug.moveSpeed || 1;
        document.querySelectorAll('.speed-btn').forEach(btn => {
            if (parseFloat(btn.dataset.speed) === currentSpeed) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update MP Debug UI
        import('./ui-controller.js').then(({ refreshPlayersList, updateMultiplayerDebugUI, refreshSettingsVisibility }) => {
            updateMultiplayerDebugUI();
            refreshPlayersList();
            if (refreshSettingsVisibility) refreshSettingsVisibility();
        });
    } else {
        // Hide all debug elements (default state)
        if (badge) badge.classList.add('hidden');
        if (panel) panel.classList.add('hidden');
        if (joy) joy.classList.add('hidden');
        if (speed) speed.classList.add('hidden');
        if (tools) tools.classList.add('hidden');
        if (mpDebug) mpDebug.classList.add('hidden');
        if (consoleBtn) consoleBtn.classList.add('hidden');
        const consolePanel = document.getElementById('debug-console-panel');
        if (consolePanel) consolePanel.classList.add('hidden');

        if (toggle) {
            toggle.classList.remove('on');
            toggle.classList.add('off');
        }
    }
}

window.toggleDebugMode = function () {
    // Toggle the state
    gameState.debug.enabled = !gameState.debug.enabled;

    // Update UI
    initializeDebugMode();

    // Update Admin panel visibility based on debug state
    if (window.refreshSettingsVisibility) {
        window.refreshSettingsVisibility();
    }

    // Show notification
    if (gameState.debug.enabled) {
        showNotification('🔧 Debug Mode ON', 'warning');

        // Load test players to map immediately
        import('./firebase-service.js').then(({ loadTestPlayersToMap }) => {
            loadTestPlayersToMap();
        });
    } else {
        showNotification('🔧 Debug Mode OFF', 'info');
    }

    // Save state to localStorage (separate from gameState for persistence)
    localStorage.setItem('debugModeEnabled', gameState.debug.enabled.toString());
    saveGame();
};
// Alias for HTML compatibility
window.toggleGameDebug = window.toggleDebugMode;
window.centerOnPlayer = centerOnPlayer;

window.teleportToCoords = function () {
    const latInput = document.getElementById('teleport-lat');
    const lngInput = document.getElementById('teleport-lng');
    const lat = parseFloat(latInput.value);
    const lng = parseFloat(lngInput.value);

    if (isNaN(lat) || isNaN(lng)) {
        showNotification('❌ Invalid coordinates', 'error');
        return;
    }

    updatePlayerPosition(lat, lng);
    showNotification(`📍 Teleported to ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
};

window.resetGame = async function () {
    if (confirm('Are you sure you want to reset all progress? This will reset your Level, Stats, Inventory and Gold!')) {
        // Reset player to defaults
        gameState.player.level = 1;
        gameState.player.xp = BigInt(0);
        gameState.player.xpToNext = BigInt(500);
        gameState.player.gold = 100;
        gameState.player.statPoints = 5;
        gameState.player.strength = 5;
        gameState.player.agility = 5;
        gameState.player.intuition = 5;
        gameState.player.vitality = 5;
        gameState.player.intellect = 5;
        gameState.player.wisdom = 5;

        // Clear equipment
        Object.keys(gameState.equipment).forEach(slot => gameState.equipment[slot] = null);

        // Clear inventory
        gameState.inventory = [];
        gameState.quests = { monstersKilled: 0, itemsCollected: 0, uniquesKilled: 0, distanceTraveled: 0 };

        // Recalculate derived stats
        const stats = getPlayerStats();
        gameState.player.hp = stats.maxHp;
        gameState.player.maxHp = stats.maxHp;

        showNotification('♻️ Resetting progress...', 'info');

        // Save to cloud immediately
        await saveGame();

        // Clear local caches
        localStorage.removeItem('fightcraft_v3');
        localStorage.removeItem(STATIC_MONSTER_KEY);

        location.reload();
    }
};

window.addXP = function (amount, source = 'Debug') {
    gameState.player.xp = BigInt(gameState.player.xp) + BigInt(Math.floor(amount));

    let levelsGained = 0;
    while (gameState.player.xp >= BigInt(gameState.player.xpToNext)) {
        levelUp();
        levelsGained++;
    }

    updateHUD();
    if (source === 'Debug') {
        addEventLog(`🧪 Gained ${amount} XP (Debug)`, 'success');
    }
    return levelsGained > 0;
};

function levelUp() {
    gameState.player.level++;

    // Subtract XP properly with BigInt
    gameState.player.xp = BigInt(gameState.player.xp) - BigInt(gameState.player.xpToNext);

    // Calculate next level XP requirement using a more standard quadratic formula
    // This ensures requirements grow proportionally with level (Level 1: 500, Level 2: 2000, Level 3: 4500...)
    gameState.player.xpToNext = BigInt(500 * gameState.player.level * gameState.player.level);

    // Award stat points
    gameState.player.statPoints += 5;

    // Restore HP to new max
    const stats = getPlayerStats();
    gameState.player.hp = stats.maxHp;
    gameState.player.maxHp = stats.maxHp;

    showNotification(`⭐ LEVEL UP! You are now level ${gameState.player.level}!`, 'success');
    addEventLog(`⭐ Level Up! Reached level ${gameState.player.level}`, 'level');
    updateHUD();

    // INSTANT UI UPDATE: Force Multi-Admin to refresh with new level immediately
    if (window._cachedPlayersList && window.updateAdminPlayersList) {
        const currentCharId = window._currentCharacterId || window._currentlyPlayingCharacterId;
        const selfInCache = window._cachedPlayersList.find(p => p.id === currentCharId || p.isSelf);
        if (selfInCache) {
            console.log(`[INSTANT] ⚡ Multi-Admin updated: Lv.${selfInCache.level} -> Lv.${gameState.player.level}`);
            selfInCache.level = gameState.player.level;
            window.updateAdminPlayersList(window._cachedPlayersList);
        }
    }

    saveGame();
}
window.spawnTestMonsters = function () {
    showNotification('🧪 Regenerating monsters...', 'info');
    buildStaticMonsters();
    renderStaticMonsters();
    showNotification('✅ Monsters regenerated!', 'success');
};

window.healPlayer = function () {
    const p = recalculateStats();
    p.hp = p.maxHp;

    updateHUD();
    showNotification('❤️ Player fully healed', 'success');
};

window.giveTestItems = function () {
    // Use actual item IDs from ITEMS_DB (camelCase)
    const items = ['ironSword', 'leatherArmor', 'leatherBoots', 'leatherGloves'];
    let addedCount = 0;

    items.forEach(id => {
        if (ITEMS_DB[id]) {
            gameState.inventory.push({ id, quantity: 1 });
            addedCount++;
            console.log(`✅ Added: ${ITEMS_DB[id].name}`);
        } else {
            console.warn(`❌ Item not found in DB: ${id}`);
        }
    });

    console.log('🎁 Test items added to inventory:', gameState.inventory.length, 'total items');
    console.log('Inventory contents:', gameState.inventory);

    showNotification(`🎁 Added ${addedCount} test items!`, 'success');
    addEventLog(`Added ${addedCount} test items to inventory`, 'system');

    // Force UI update
    renderInventory();
    saveGame();
};

window.addTestXP = function () {
    // Use the proper addXP function to trigger level-up
    addXP(1000);
};

window.addTestGold = function () {
    gameState.player.gold += 500;
    showNotification('💰 Added 500 Gold', 'success');
    updateHUD();
};

window.setMoveSpeed = function (speed) {
    gameState.debug.moveSpeed = speed;
    showNotification(`🏃 Speed: ${speed}x`, 'info');

    // Update speed button states
    const buttons = document.querySelectorAll('.speed-btn');
    buttons.forEach(btn => {
        if (parseFloat(btn.dataset.speed) === speed) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
};

// Start the game
window.addEventListener('DOMContentLoaded', () => {
    console.log('FightCraft initializing...');
    init();
});

// ==================== WORLD SYNC ====================

let _currentWorldSyncUnsub = null;
let _lastSyncedCityId = null;

export function setupWorldSync() {
    // Find closest city
    const pos = gameState.player.position;
    if (!pos || !pos.lat) return;

    let closest = CITY_ANCHORS[0];
    let minD = Infinity;

    CITY_ANCHORS.forEach(c => {
        const d = getDistance(pos.lat, pos.lng, c.lat, c.lng);
        if (d < minD) {
            minD = d;
            closest = c;
        }
    });

    // Only re-subscribe if city changed
    if (closest.id === _lastSyncedCityId) return;

    // Unsubscribe from old
    if (_currentWorldSyncUnsub) {
        // console.log(`🔌 Unsubscribing from prev city: ${_lastSyncedCityId}`);
        _currentWorldSyncUnsub();
    }

    _lastSyncedCityId = closest.id;
    // console.log(`🌍 Subscribing to World Events for ${closest.name}...`);

    _currentWorldSyncUnsub = subscribeToSpawnedObjects(closest.id, (entities) => {
        // console.log(`📡 World Update: Received ${entities.length} entities for ${closest.name}.`);

        const monsters = entities.filter(o => o.type === 'monster');
        const pois = entities.filter(o => o.type === 'shop' || o.type === 'castle' || o.type === 'vault');

        // Sync Monsters
        import('./gameState.js').then(({ setStaticMonsters }) => {
            setStaticMonsters(monsters);
            import('./map.js').then(({ renderStaticMonsters }) => {
                renderStaticMonsters(true);
            });
        });

        // Sync Shops/Castles
        import('./poi.js').then(({ addExternalPOIs }) => {
            addExternalPOIs(pois);
        });
    });
}
