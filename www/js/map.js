// Map module - Leaflet map, markers, movement, fog of war
import { gameState, updatePlayer, getStaticMonsters, setStaticMonsters, STATIC_MONSTER_KEY } from './gameState.js';
import { CITY_ANCHORS, GRID_SETTINGS } from './data.js';
import { showNotification, addEventLog } from './ui-controller.js';
import { checkAndFetchPOIs, renderPOIs } from './poi.js';
import { districtLayers } from './districts.js';

// ==================== MAP VARIABLES ====================
export let map, playerMarker, playerRangeCircle;
export let monsterMarkers = [];
export let monsterCluster;
export let poiCluster;
let currentCityId = null;
let lastPlayerPos = null;
export let otherPlayerMarkers = {};  // Export for character switching
let controlledPlayerCircle = null;   // Range circle for controlled player
let lastKnownOtherPlayers = [];      // Track other players for debug logging

// Sync Throttling — Leading + Trailing Edge
// Leading: миттєва відправка першого руху (швидкий відгук)
// Trailing: гарантована відправка ОСТАННЬОЇ позиції (актуальність)
let lastSharedPosSync = 0;
let _pendingSyncPosition = null;   // Буфер останньої позиції
let _trailingEdgeTimer = null;     // Таймер trailing edge
const POSITION_SYNC_THROTTLE = 2000; // 2 секунди (знижено з 3с для живого відчуття)

// ==================== MULTIPLAYER ====================

/**
 * Generate unique avatar emoji for each player based on their ID
 */
/**
 * Generate unique avatar emoji for each player based on their ID
 */
export function getPlayerAvatar(playerId, playerName) {
    const avatars = ['😊', '😎', '🤠', '👨‍🚀', '👨‍🔬', '👨‍🎨', '👨‍🍳', '👨‍💻', '🧙‍♂️', '🦸‍♂️', '🥷', '👨‍⚕️'];

    // Use player ID to pick consistent avatar
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
        hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
        hash = hash & hash;
    }
    const index = Math.abs(hash) % avatars.length;
    return avatars[index];
}

export function updateOtherPlayers(players) {
    if (!map) return;

    // console.log(`[MAP] 👥 updateOtherPlayers called with ${players.length} players`);

    // Get current controlled character ID
    const currentCharId = window._currentlyPlayingCharacterId || window._currentCharacterId || (window._controllingPlayer ? window._controllingPlayer.id : null);

    const activeIds = new Set(players.filter(p => p.id !== currentCharId).map(p => p.id));

    // Remove markers for players no longer online (excluding test players and self)
    Object.keys(otherPlayerMarkers).forEach(id => {
        if (!activeIds.has(id)) {
            const marker = otherPlayerMarkers[id];
            const isTestPlayer = marker && marker.options && marker.options.isTestPlayer;

            if (!isTestPlayer) {
                marker.remove();
                delete otherPlayerMarkers[id];
                // console.log(`🗑️ Removed offline player marker: ${id}`);
            }
        }
    });

    // Update or create markers for online players
    players.forEach(p => {
        try {
            // SKIP SELF: Your own marker is handled by updatePlayerPosition
            if (p.id === currentCharId) {
                if (typeof updatePlayerMarkerIcon === 'function') {
                    updatePlayerMarkerIcon(p.avatar || '🧙', p.level || 1, p.name || 'YOU');
                }
                return;
            }

            if (otherPlayerMarkers[p.id]) {
                const marker = otherPlayerMarkers[p.id];
                marker.setLatLng([p.position.lat, p.position.lng]);

                // Update level/visuals if changed
                const currentLevel = Number(p.level || 1);
                const lastLevel = Number(marker.options.lastLevel || 0);

                if (currentLevel !== lastLevel) {
                    const iconHtml = `<div class="relative">
                        <div class="player-marker">${p.avatar || '🧙'}</div>
                        <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/50 whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000;">
                            ${p.name} (Lv.${currentLevel})
                        </div>
                    </div>`;

                    marker.setIcon(L.divIcon({
                        html: iconHtml,
                        className: 'custom-div-icon',
                        iconSize: [40, 40],
                        iconAnchor: [20, 20]
                    }));
                    marker.options.lastLevel = currentLevel;
                }
            } else {
                // CREATE NEW MARKER
                const newMarker = createPlayerMarker(
                    p.position.lat,
                    p.position.lng,
                    p.name,
                    p.avatar || '🧙',
                    p.id,
                    p.level || 1,
                    p.isTestPlayer,
                    p.userId
                );

                if (newMarker) {
                    otherPlayerMarkers[p.id] = newMarker;
                }
            }
        } catch (e) {
            console.error(`Error updating player ${p.id}:`, e);
        }
    });
}

/**
 * Create a player marker on the map (for test players or newly spawned players)
 */
export function createPlayerMarker(lat, lng, name, avatar, playerId, level = 1, isTestPlayer = false, userId = null) {
    if (!map) return null;

    const icon = L.divIcon({
        html: `<div class="relative">
                <div class="player-marker" style="width: 40px; height: 40px;">${avatar || '🧙'}</div>
                <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/50 whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000;">
                    ${name} (Lv.${level})
                </div>
               </div>`,
        className: 'custom-div-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    const marker = L.marker([lat, lng], {
        icon: icon,
        zIndexOffset: 500,
        isTestPlayer: isTestPlayer,  // Mark as test player for protection from removal
        lastLevel: Number(level)     // Store level for real-time updates
    }).addTo(map);

    // PvP Interaction
    // PvP Interaction (RTDB)
    marker.on('click', async () => {
        const curPos = marker.getLatLng();
        const from = turf.point([gameState.player.position.lng, gameState.player.position.lat]);
        const to = turf.point([curPos.lng, curPos.lat]);
        const dist = turf.distance(from, to, { units: 'kilometers' }) * 1000; // to meters

        if (dist <= 50) { // 50 meters radius
            const { createBattleRequest } = await import('./firebase-service.js');
            const { showNotification } = await import('./ui-controller.js');

            showNotification(`⚔️ Sending challenge to ${name}...`, 'info');

            // Create RTDB request
            await createBattleRequest(userId, playerId);

        } else {
            import('./ui-controller.js').then(m => m.showNotification(`❌ Too far! (${Math.round(dist)}m)`, 'warning'));
        }
    });

    if (name.includes('TestPlayer103')) {
        console.warn('👻 GHOST DETECTED: TestPlayer103 created!');
        console.trace();
    }

    // Force visibility after DOM renders
    setTimeout(() => {
        if (marker._icon) {
            marker._icon.style.opacity = '1';
            marker._icon.style.visibility = 'visible';
        }
    }, 100);

    console.log(`✅ Created marker for ${name} with avatar ${avatar}${isTestPlayer ? ' (TEST PLAYER)' : ''}`);
    return marker;
}

// ==================== MAP INITIALIZATION ====================
export async function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false,
        renderer: L.canvas() // Optimize for 2600+ objects
    })
        .setView([gameState.player.position.lat, gameState.player.position.lng], 14);

    // Satellite map
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Esri'
    }).addTo(map);

    // Street labels
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        opacity: 0.9,
        attribution: 'CartoDB'
    }).addTo(map);

    monsterCluster = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 16,
        maxClusterRadius: 80,
        chunkedLoading: true,
        chunkInterval: 50,
        chunkDelay: 20,
        animate: false
    });
    map.addLayer(monsterCluster);

    poiCluster = L.markerClusterGroup({
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 17,
        maxClusterRadius: 120, // INCREASED: More items per group
        chunkedLoading: true,
        chunkInterval: 50,
        chunkDelay: 20,
        animate: false
    });
    map.addLayer(poiCluster);

    // --- CLUSTER ZONES REMOVED AS REQUESTED ---


    // Get userName from current auth user (more reliable than gameState after refresh)
    const { getCurrentUser } = await import('./firebase-service.js');
    const currentUser = getCurrentUser();
    const displayName = currentUser?.displayName || gameState.player.userName || gameState.player.name || 'Hero';

    const playerIcon = L.divIcon({
        html: `<div class="relative">
                <div class="player-marker">${gameState.player.avatar || '🧙'}</div>
                <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/50 whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000;">
                    ${displayName}
                </div>
               </div>`,
        className: 'custom-player-icon', iconSize: [40, 40], iconAnchor: [20, 20]
    });
    playerMarker = L.marker([gameState.player.position.lat, gameState.player.position.lng], { icon: playerIcon }).addTo(map);

    // Player interaction radius
    playerRangeCircle = L.circle([gameState.player.position.lat, gameState.player.position.lng], {
        radius: gameState.player.interactionRadius,
        className: 'player-range',
        color: '#8b5cf6',
        weight: 3,
        fillOpacity: 0.05,
        dashArray: '10, 10'
    }).addTo(map);

    map.on('click', (e) => {
        if (gameState.debug.enabled) {
            const targetLat = e.latlng.lat;
            const targetLng = e.latlng.lng;

            // Move player (logging is now handled inside updatePlayerPosition)
            updatePlayerPosition(targetLat, targetLng);
        }
    });

    // Update fog on map movement
    map.on('move', updateFog);
    map.on('zoom', updateFog);
    map.on('zoomend', updateFog);

    initJoystick();

    // Initialize Districts System
    import('./districts.js').then(module => {
        module.initDistricts(map);
    });

    // ==================== OPTIMIZATION HANDLERS ====================
    // Prune distant objects and re-render nearby on move end (Memory Management)
    map.on('moveend', () => {
        const center = map.getCenter();
        pruneDistantObjects(center.lat, center.lng);

        // RE-RENDER to restore pruned markers that are now within range
        renderStaticMonsters(false);
        renderPOIs();
    });
}

// Optimization: Track loaded IDs to prevent re-fetching
const _loadedObjectIds = new Set();

/**
 * Remove objects > 5km from player to free RAM
 */
export function pruneDistantObjects(lat, lng) {
    if (!monsterCluster) return;

    const MAX_DIST_KM = 5;
    let removedCount = 0;

    // Prune Monsters
    monsterCluster.eachLayer(layer => {
        const mLat = layer.getLatLng().lat;
        const mLng = layer.getLatLng().lng;
        const dist = getDistance(lat, lng, mLat, mLng); // Using map.js getDistance

        // If too far, remove
        if (dist > MAX_DIST_KM * 1000) { // getDistance usually returns meters
            monsterCluster.removeLayer(layer);
            removedCount++;
            // Also remove from ID tracker if we were tracking it
            if (layer.options.id) _loadedObjectIds.delete(layer.options.id);
        }
    });

    // --- STOP PRUNING CITADELS ---
    // Citadels are key landmarks and now clustered. Removing them individually
    // without a dynamic re-loader causes them to disappear permanently.
    // Logic removed.


    // Prune POIs (Shops, Castles)
    if (poiCluster) {
        poiCluster.eachLayer(layer => {
            const pLat = layer.getLatLng().lat;
            const pLng = layer.getLatLng().lng;
            const dist = getDistance(lat, lng, pLat, pLng);

            if (dist > MAX_DIST_KM * 1000) {
                poiCluster.removeLayer(layer);
                removedCount++;
            }
        });
    }

    if (removedCount > 0) {
        // console.log(`🧹 Garbage Collector: Removed ${removedCount} distant objects (>5km)`);
    }
}

/**
 * Dynamic loading stub using the new Backend Optimization
 */
export async function setupDynamicLoading() {
    // Determine collections
    // const { fetchNearbyObjects } = await import('./firebase-service.js');
    // ... logic would go here
}

/**
 * Update Player Marker Icon (e.g. upon character switch)
 */
export function updatePlayerMarkerIcon(avatar = '🧙', level = 1, name = 'Player') {
    if (!playerMarker) return;

    const iconHtml = `<div class="relative">
        <div class="player-marker">${avatar}</div>
        <!-- Name Badge -->
        <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/50 whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000;">
            ${name} (Lv.${level})
        </div>
    </div>`;

    const newIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-div-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });

    playerMarker.setIcon(newIcon);
}

// Export to window for UI use
window.updatePlayerMarkerIcon = updatePlayerMarkerIcon;

// ==================== PLAYER MOVEMENT ====================
// ==================== PLAYER MOVEMENT ====================
export function updatePlayerPosition(lat, lng) {
    const oldCity = getPlayerCity();
    const oldPos = gameState.player.position ? { ...gameState.player.position } : { lat: 0, lng: 0 };

    if (lastPlayerPos) {
        const dist = getDistance(lastPlayerPos.lat, lastPlayerPos.lng, lat, lng);
        gameState.quests.distanceTraveled += dist;

        if (dist > 10) {
            addEventLog(`Movement: ${Math.floor(dist)}m`, 'move');
        }
    }
    lastPlayerPos = { lat, lng };

    // Update GameState position (always current controlled char)
    // Synchronize both locations where position is stored
    const newPos = { lat, lng };
    gameState.player.position = newPos;
    gameState.position = newPos;

    // Always update playerMarker and playerRangeCircle (whoever is currently playing)
    if (playerMarker) playerMarker.setLatLng([lat, lng]);
    if (playerRangeCircle) playerRangeCircle.setLatLng([lat, lng]);

    // Move camera
    if (map) {
        map.setView([lat, lng], map.getZoom(), { animate: false });
    }

    updateFog();
    updateDebugCoords();

    // Check if city changed
    const newCity = getPlayerCity();
    const oldCityId = oldCity ? oldCity.id : null;
    const newCityId = newCity ? newCity.id : null;

    if (oldCityId !== newCityId) {
        console.log(`🔄 City change: ${oldCityId} → ${newCityId}`);
        renderStaticMonsters(true);
    }

    // --- DISTRICT UPDATE ---
    import('./districts.js').then(({ getDistrictByCoords }) => {
        const district = getDistrictByCoords(lat, lng);
        const oldDistrict = gameState.currentDistrict;

        if (district && (!oldDistrict || oldDistrict.id !== district.id)) {
            console.log(`📍 Entered District: ${district.name}`);
            gameState.currentDistrict = district;
            showNotification(`📍 Entering ${district.name}`, 'info');

            // Update HUD
            if (window.updateDistrictHUD) window.updateDistrictHUD();
        } else if (!district && oldDistrict) {
            console.log(`📍 Left District: ${oldDistrict.name}`);
            gameState.currentDistrict = null;
            if (window.updateDistrictHUD) window.updateDistrictHUD();
        }
    });

    // Check for new POIs (Castles/Shops)
    checkAndFetchPOIs();

    // LIVE MOVEMENT SYNC (RTDB — Leading + Trailing throttle)
    _syncPositionToRTDB(lat, lng);
}

/**
 * Синхронізація позиції до RTDB з Leading + Trailing throttle.
 * - Leading edge: перший рух відправляється миттєво
 * - Trailing edge: ОСТАННЯ позиція серії рухів гарантовано відправляється
 * Це вирішує баг, коли при швидких кліках фінальна позиція втрачалась.
 */
function _syncPositionToRTDB(lat, lng) {
    const now = Date.now();

    // Завжди зберігаємо останню позицію в буфер
    _pendingSyncPosition = { lat, lng };

    // Leading edge: миттєва відправка, якщо throttle-вікно закрите
    if (now - lastSharedPosSync > POSITION_SYNC_THROTTLE) {
        _flushPositionSync();
    } else {
        // Trailing edge: запланувати відправку на кінець throttle-вікна
        if (!_trailingEdgeTimer) {
            const remaining = POSITION_SYNC_THROTTLE - (now - lastSharedPosSync);
            _trailingEdgeTimer = setTimeout(() => {
                _trailingEdgeTimer = null;
                if (_pendingSyncPosition) {
                    _flushPositionSync();
                }
            }, remaining);
        }
        // Якщо таймер вже є — він відправить найновішу позицію з буфера
    }
}

/**
 * Відправити позицію з буфера до RTDB (внутрішня функція)
 */
function _flushPositionSync() {
    if (!_pendingSyncPosition) return;
    const { lat, lng } = _pendingSyncPosition;
    _pendingSyncPosition = null;
    lastSharedPosSync = Date.now();

    import('./firebase-service.js').then(({ updatePlayerLocationRTDB }) => {
        updatePlayerLocationRTDB(lat, lng);
    });
}

export function updateDebugCoords() {
    if (!gameState.debug.enabled) return;
    const pos = gameState.player.position;
    const latEl = document.getElementById('debug-lat');
    const lngEl = document.getElementById('debug-lng');
    if (latEl) latEl.textContent = pos.lat.toFixed(6);
    if (lngEl) lngEl.textContent = pos.lng.toFixed(6);

    const city = getPlayerCity();
    const cityEl = document.getElementById('debug-city');
    if (cityEl) {
        cityEl.textContent = city ? city.name : 'Wilderness';
    }
}

// ==================== JOYSTICK CONTROLS ====================
export function initJoystick() {
    const container = document.getElementById('joystick-container');
    const knob = document.getElementById('joystick-knob');
    if (!container || !knob) return;

    let active = false, interval = null;
    let dir = { x: 0, y: 0 };

    function move(cx, cy) {
        const rect = container.getBoundingClientRect();
        let dx = cx - rect.left - 60, dy = cy - rect.top - 60;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 35) { dx = dx / dist * 35; dy = dy / dist * 35; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        dir = { x: dx / 35, y: -dy / 35 };
    }

    function end() {
        active = false;
        knob.style.transform = 'translate(-50%, -50%)';
        dir = { x: 0, y: 0 };
        if (interval) { clearInterval(interval); interval = null; }
    }

    function start(e) {
        if (!gameState.debug.enabled) return;
        active = true;
        const t = e.touches ? e.touches[0] : e;
        move(t.clientX, t.clientY);
        if (!interval) {
            interval = setInterval(() => {
                if (active && (dir.x || dir.y)) {
                    const speed = 0.00005 * gameState.debug.moveSpeed;
                    updatePlayerPosition(
                        gameState.player.position.lat + dir.y * speed,
                        gameState.player.position.lng + dir.x * speed
                    );
                }
            }, 50);
        }
    }

    knob.addEventListener('mousedown', start);
    knob.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('mousemove', e => { if (active) move(e.clientX, e.clientY); });
    document.addEventListener('touchmove', e => { if (active && e.touches[0]) move(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
    document.addEventListener('mouseup', end);
    document.addEventListener('touchend', end);
}

// ==================== CITY & DISTRICTS ====================
export function getPlayerCity() {
    const pos = gameState.player.position;
    if (!pos) return null;

    let closestCity = null;
    let closestDist = Infinity;

    // Find closest city
    CITY_ANCHORS.forEach(city => {
        const dist = getDistance(pos.lat, pos.lng, city.lat, city.lng);
        if (dist < closestDist) {
            closestDist = dist;
            closestCity = city;
        }
    });

    // Valid if within 50km? Or just always return closest?
    // For now, return closest to allow testing anywhere
    return closestCity;
}

// ==================== MONSTER RENDERING ====================
export function renderStaticMonsters(force = false, center) {
    if (!map) {
        console.log('⚠️ Map is not initialized!');
        return;
    }

    const staticMonsters = getStaticMonsters();
    if (!staticMonsters || staticMonsters.length === 0) return;

    // Use passed center or current map center
    const renderCenter = center || map.getCenter();
    const city = getPlayerCity();

    currentCityId = city ? city.id : null;
    gameState.currentCityId = currentCityId; // Sync to global state for districts.js

    // Initialize cluster if needed
    if (!monsterCluster) {
        monsterCluster = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            disableClusteringAtZoom: 16,
            maxClusterRadius: 120, // INCREASED: More items per group for performance
            chunkedLoading: true,
            chunkInterval: 50,
            chunkDelay: 20,
            animate: false
        });
        map.addLayer(monsterCluster);
    }

    // Clear old markers
    monsterCluster.clearLayers();
    monsterMarkers = [];
    _loadedObjectIds.clear(); // Reset tracking for re-rendering prunable objects

    // Filter monsters (Optimization: View-based filtering, increased to 50km to cover whole screen)
    const MAX_RENDER_DIST = 50000;
    const monstersToShow = staticMonsters.filter(m => {
        const dist = getDistance(renderCenter.lat, renderCenter.lng, m.lat, m.lng);
        return dist <= MAX_RENDER_DIST;
    });

    // console.log(`🌍 Viewing ${monstersToShow.length} monsters within ${MAX_RENDER_DIST}m of center`);

    if (monstersToShow.length === 0) {
        console.warn('⚠️ No monsters found to display!');
        return;
    }

    // Create markers
    const markersToAdd = [];
    monstersToShow.forEach(monster => {
        // Skip defeated monsters
        if (monster.defeated && monster.respawnAt && monster.respawnAt > Date.now()) return;

        // Respawn monster if time is up
        if (monster.defeated && monster.respawnAt && monster.respawnAt <= Date.now()) {
            monster.defeated = false;
            monster.respawnAt = null;
        }

        const isInactive = isMonsterInactive(monster.id);
        const inactiveClass = isInactive ? 'inactive' : '';

        const icon = L.divIcon({
            html: `<div class="monster-marker ${monster.class} ${inactiveClass}">
                <span class="monster-icon">${monster.icon}</span>
                <span class="monster-level">Lv.${monster.level}</span>
            </div>`,
            className: '',
            iconSize: [60, 70],
            iconAnchor: [30, 35]
        });

        const marker = L.marker([monster.lat, monster.lng], {
            icon,
            zIndexOffset: 1200 // Middle layer (indices)
        });
        marker.monsterId = monster.id;
        marker.bindTooltip(`
            <div class="text-xs">
                <div class="font-bold">${monster.name}</div>
                <div>Lv.${monster.level} · ${monster.class}</div>
            </div>
        `, { permanent: false, direction: 'top' });

        marker.on('click', () => {
            if (isMonsterInactive(monster.id)) {
                const remaining = Math.ceil((gameState.inactiveMonsters[monster.id] - Date.now()) / 1000);
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                showNotification(`⏳ Monster is inactive for ${mins}:${secs.toString().padStart(2, '0')}`, 'warning');
                return;
            }

            const dist = getDistance(gameState.player.position.lat, gameState.player.position.lng, monster.lat, monster.lng);
            if (dist <= gameState.player.interactionRadius) {
                if (window.showPreCombatDialog) {
                    window.showPreCombatDialog(monster, true);
                } else {
                    window.startCombat(monster, true);
                }
            } else {
                showNotification('❌ Get closer!', 'warning');
            }
        });

        markersToAdd.push(marker);
        monsterMarkers.push(marker);
    });

    monsterCluster.addLayers(markersToAdd);
}

// ==================== FOG OF WAR ====================
export function calculateFogRadius() {
    const baseRadiusMeters = 100 + (gameState.player.intuition * 5) + (gameState.player.wisdom * 3);
    return baseRadiusMeters;
}

export function metersToPixels(meters) {
    if (!map) return 100;
    const zoom = map.getZoom();
    const lat = gameState.player.position.lat;
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    return meters / metersPerPixel;
}

export function updateFog() {
    if (!gameState.settings.fog) return;
    if (!map) return;

    try {
        const point = map.latLngToContainerPoint([gameState.player.position.lat, gameState.player.position.lng]);
        const fog = document.getElementById('fog');
        if (!fog) return;

        fog.style.setProperty('--player-x', point.x + 'px');
        fog.style.setProperty('--player-y', point.y + 'px');

        const radius = calculateFogRadius();
        const pixels = metersToPixels(radius);

        fog.style.setProperty('--fog-radius-inner', pixels + 'px');
        fog.style.setProperty('--fog-radius-mid', (pixels * 1.5) + 'px');
        fog.style.setProperty('--fog-radius-outer', (pixels * 2.25) + 'px');
        fog.style.setProperty('--fog-radius-max', (pixels * 3.125) + 'px');
    } catch (e) {
        console.warn('Fog update error:', e);
    }
}

// ==================== UTILITY FUNCTIONS ====================
export function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function isMonsterInactive(monsterId) {
    return gameState.inactiveMonsters[monsterId] && gameState.inactiveMonsters[monsterId] > Date.now();
}

// Глобальний експорт

window.updatePlayerPosition = updatePlayerPosition;
window.getDistance = getDistance;
export function centerOnPlayer() {
    if (map && gameState.player.position) {
        map.setView([gameState.player.position.lat, gameState.player.position.lng], 16);
    }
}
// Also expose globally for compatibility
window.centerOnPlayer = centerOnPlayer;
window.updateOtherPlayers = updateOtherPlayers;

// ==================== CHARACTER SWITCHING ====================

/**
 * Convert current player marker to "other player" marker
 * Called when switching to control another character
 */
export function convertPlayerToOtherMarker(playerId, playerName, playerLevel) {
    if (!map || !playerMarker) return;

    const currentPos = playerMarker.getLatLng();

    // Create "other player" marker at current player position
    const icon = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="font-size: 24px;">👤</div>
                <div style="font-size: 10px; color: white; text-shadow: 1px 1px 2px black; white-space: nowrap;">
                    ${playerName} (Lv.${playerLevel})
                </div>
            </div>
        `,
        iconSize: [40, 50],
        iconAnchor: [20, 50],
        className: 'other-player-marker'
    });

    const marker = L.marker([currentPos.lat, currentPos.lng], { icon: icon }).addTo(map);

    // Store in otherPlayerMarkers
    otherPlayerMarkers[playerId] = marker;

    // Remove current player marker (will be recreated at new position)
    if (playerMarker) {
        playerMarker.remove();
    }
    if (playerRangeCircle) {
        playerRangeCircle.remove();
    }

    console.log(`✅ Converted player marker to other player: ${playerName} at`, currentPos);
}

/**
 * Create new player marker at target position
 * Called when switching to control another character
 */
export function createPlayerMarkerAt(lat, lng) {
    if (!map) return;

    // Remove old player marker if exists
    if (playerMarker) {
        playerMarker.remove();
    }
    if (playerRangeCircle) {
        playerRangeCircle.remove();
    }

    // Create new player marker
    const icon = L.divIcon({
        html: `
            <div style="text-align: center;">
                <div style="font-size: 24px;">😊</div>
                <div style="font-size: 10px; color: yellow; text-shadow: 1px 1px 2px black; white-space: nowrap;">
                    You
                </div>
            </div>
        `,
        iconSize: [40, 50],
        iconAnchor: [20, 50],
        className: 'player-marker'
    });

    playerMarker = L.marker([lat, lng], {
        icon: icon,
        draggable: !!gameState.debug?.enabled
    }).addTo(map);

    // Add interaction range circle
    playerRangeCircle = L.circle([lat, lng], {
        radius: gameState.player.interactionRadius || 25,
        className: 'player-range',
        color: '#8b5cf6',
        fillColor: '#8b5cf6',
        fillOpacity: 0.1,
        weight: 3,
        dashArray: '10, 10'
    }).addTo(map);

    // Add drag event if debug mode
    if (gameState.debug?.enabled) {
        playerMarker.on('dragend', function (e) {
            const newPos = e.target.getLatLng();
            updatePlayerPosition(newPos.lat, newPos.lng);
        });
    }

    console.log(`✅ Created player marker at: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
}

/**
 * Restore original player marker and remove "other player" marker
 * Called when returning to self
 */
export function restorePlayerMarker(originalLat, originalLng, controlledPlayerId) {
    if (!map) return;

    // Remove the "other player" marker for the controlled character
    if (controlledPlayerId && otherPlayerMarkers[controlledPlayerId]) {
        otherPlayerMarkers[controlledPlayerId].remove();
        delete otherPlayerMarkers[controlledPlayerId];
        console.log(`✅ Removed other player marker: ${controlledPlayerId.substring(0, 12)}`);
    }

    // Create player marker at original position
    createPlayerMarkerAt(originalLat, originalLng);

    // Update range circle
    if (playerRangeCircle) {
        playerRangeCircle.setLatLng([originalLat, originalLng]);
    }

    console.log(`✅ Restored player marker at: ${originalLat.toFixed(4)}, ${originalLng.toFixed(4)}`);
}

// Export for use in ui-controller
window.convertPlayerToOtherMarker = convertPlayerToOtherMarker;
window.createPlayerMarkerAt = createPlayerMarkerAt;
window.restorePlayerMarker = restorePlayerMarker;

/**
 * Update the player's interaction radius circle
 * Called from gameState.js when Wisdom changes
 */
window.updatePlayerInteractionRadius = function (newRadius) {
    if (playerRangeCircle) {
        playerRangeCircle.setRadius(newRadius);
        console.log(`⭕ Map Circle Updated: ${newRadius}m`);
    } else if (map && gameState.player.position) {
        // Create if missing
        playerRangeCircle = L.circle([gameState.player.position.lat, gameState.player.position.lng], {
            radius: newRadius,
            className: 'player-range',
            color: '#8b5cf6',
            fillColor: '#8b5cf6',
            fillOpacity: 0.1,
            weight: 3,
            dashArray: '10, 10'
        }).addTo(map);
    }
};
