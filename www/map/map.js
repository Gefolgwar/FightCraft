// Map module - Leaflet map, markers, movement, fog of war
import {
  gameState,
  updatePlayer,
  getStaticMonsters,
  setStaticMonsters,
  STATIC_MONSTER_KEY,
} from "../core/gameState.js";
import { CITY_ANCHORS, GRID_SETTINGS } from "../gameplay/data.js";
import { showNotification, addEventLog } from "../auth-ui/ui-controller.js";
import { checkAndFetchPOIs, renderPOIs } from "./poi.js";
import { CanvasEntityLayer } from "./canvas-renderer.js";
import { TerritoryCanvasLayer } from "./territory-canvas.js";
import {
  checkDiscovery,
  getDiscoveredCastles,
} from "../core/discovery-service.js";
import {
  getGlobalOwner,
  setCitadels,
  getCitadels,
  computeAllTerritoryBoundaries,
} from "./territory-service.js";

// ==================== MAP VARIABLES ====================
export let map, playerMarker, playerRangeCircle;
export let monsterMarkers = [];
export let monsterCluster;
export let poiCluster;
export let citadelLayerGroup = null;
let currentCityId = null;
let lastPlayerPos = null;

// The strict list of H3 cells that make up the visible citadel territories.
// Used to restrict monsters to strictly inside visible zones.
export const validTerritoryCells = new Set();

// Game-themed cluster icon: colored dot with count number
function _gameClusterIcon(cluster) {
  const count = cluster.getChildCount();
  let size, bg, border, shadow;
  if (count < 10) {
    size = 36;
    bg = "rgba(239,68,68,0.85)";
    border = "#fca5a5";
    shadow = "0 0 10px rgba(239,68,68,0.6)";
  } else if (count < 50) {
    size = 44;
    bg = "rgba(245,158,11,0.9)";
    border = "#fcd34d";
    shadow = "0 0 14px rgba(245,158,11,0.6)";
  } else {
    size = 52;
    bg = "rgba(168,85,247,0.9)";
    border = "#c4b5fd";
    shadow = "0 0 18px rgba(168,85,247,0.7)";
  }
  const fs = count >= 100 ? 11 : 13;
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${bg};border:2px solid ${border};border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:${fs}px;box-shadow:${shadow};text-shadow:0 1px 2px rgba(0,0,0,0.8);">${count}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
let lastFetchedPos = null;
export let otherPlayerMarkers = {}; // Export for character switching
// Also expose to window for group proximity checks
window._otherPlayerMarkers = otherPlayerMarkers;
let controlledPlayerCircle = null; // Range circle for controlled player
let lastKnownOtherPlayers = []; // Track other players for debug logging
let arenaLayers = {}; // Active arena circles on map

// Sync Throttling — Leading + Trailing Edge
// Leading: миттєва відправка першого руху (швидкий відгук)
// Trailing: гарантована відправка ОСТАННЬОЇ позиції (актуальність)
let lastSharedPosSync = 0;
let _pendingSyncPosition = null; // Буфер останньої позиції
let _trailingEdgeTimer = null; // Таймер trailing edge
const POSITION_SYNC_THROTTLE = 2000; // 2 секунди (знижено з 3с для живого відчуття)

// ==================== H3 + CANVAS RENDERING STATE ====================
let canvasMonsterLayer = null; // CanvasEntityLayer instance
let loadedH3Cells = new Set(); // Currently loaded H3 cell indices
let proceduralMonsters = new Map(); // id → monster data for combat lookups
let defeatedMonsterIds = new Set(); // IDs of defeated procedural monsters
let territoryCanvasLayer = null; // TerritoryCanvasLayer instance for territory rendering

// Lazy-loaded modules (created by spatial specialist — core/h3-spatial.js, core/procedural-engine.js)
let _h3Spatial = null;
let _proceduralEngine = null;
let _h3Territory = null;
let _lastTerritoryUpdate = 0;
const TERRITORY_UPDATE_THROTTLE = 3000; // 3 seconds

// ==================== MULTIPLAYER ====================

/**
 * Generate unique avatar emoji for each player based on their ID
 */
/**
 * Generate unique avatar emoji for each player based on their ID
 */
export function getPlayerAvatar(playerId, playerName) {
  const avatars = [
    "😊",
    "😎",
    "🤠",
    "👨‍🚀",
    "👨‍🔬",
    "👨‍🎨",
    "👨‍🍳",
    "👨‍💻",
    "🧙‍♂️",
    "🦸‍♂️",
    "🥷",
    "👨‍⚕️",
  ];

  // Use player ID to pick consistent avatar
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash << 5) - hash + playerId.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % avatars.length;
  return avatars[index];
}

export function updateOtherPlayers(players) {
  if (!map) return;

  const isAdmin = gameState.player.role === "admin";
  const playerPos = gameState.player.position;
  const playerPoint = turf.point([playerPos.lng, playerPos.lat]);

  players = players.filter((p) => {
    if (isAdmin || p.isSelf) return true;
    if (!p.lng || !p.lat) return false;
    const pPoint = turf.point([p.lng, p.lat]);
    const distance = turf.distance(playerPoint, pPoint, {
      units: "kilometers",
    });
    return distance <= 100;
  });
  if (!map) return;

  // console.log(`[MAP] 👥 updateOtherPlayers called with ${players.length} players`);

  // Get current controlled character ID
  const currentCharId =
    window._currentlyPlayingCharacterId ||
    window._currentCharacterId ||
    (window._controllingPlayer ? window._controllingPlayer.id : null);

  const activeIds = new Set(
    players.filter((p) => p.id !== currentCharId).map((p) => p.id),
  );

  // Remove markers for players no longer online (excluding test players and self)
  Object.keys(otherPlayerMarkers).forEach((id) => {
    if (!activeIds.has(id)) {
      const marker = otherPlayerMarkers[id];
      const isTestPlayer =
        marker && marker.options && marker.options.isTestPlayer;

      if (!isTestPlayer) {
        if (marker.combatArena) {
          marker.combatArena.remove();
        }
        marker.remove();
        delete otherPlayerMarkers[id];
        // console.log(`🗑️ Removed offline player marker: ${id}`);
      }
    }
  });

  // Update or create markers for online players
  players.forEach((p) => {
    try {
      // SKIP SELF: Your own marker is handled by updatePlayerPosition
      if (p.id === currentCharId) {
        if (typeof updatePlayerMarkerIcon === "function") {
          updatePlayerMarkerIcon(
            p.avatar || "🧙",
            p.level || 1,
            p.name || "YOU",
          );
        }
        return;
      }

      const myGroupId = gameState.currentGroup?.id;
      const isGroupMember = !!p.groupId;
      const isInCombat = p.status === "in_combat";

      if (otherPlayerMarkers[p.id]) {
        const marker = otherPlayerMarkers[p.id];
        marker.setLatLng([p.position.lat, p.position.lng]);

        // Manage combat arena for other players
        if (isInCombat) {
          if (!marker.combatArena) {
            marker.combatArena = L.circle([p.position.lat, p.position.lng], {
              color: "#ef4444",
              fillColor: "#ef4444",
              fillOpacity: 0.1,
              radius: 100,
            }).addTo(map);
          } else {
            marker.combatArena.setLatLng([p.position.lat, p.position.lng]);
          }
        } else {
          if (marker.combatArena) {
            marker.combatArena.remove();
            marker.combatArena = null;
          }
        }

        // Update level/visuals if changed
        const currentLevel = Number(p.level || 1);
        const lastLevel = Number(marker.options.lastLevel || 0);
        const lastStatus = marker.options.playerData?.status;
        const lastGroupId = marker.options.playerData?.groupId;

        // Reconstruct icon if level, status, or group changed
        if (
          currentLevel !== lastLevel ||
          p.status !== lastStatus ||
          p.groupId !== lastGroupId
        ) {
          let borderStyle = "border-yellow-500/50";
          let extraClass = "";
          let borderCss = "";

          if (isInCombat) {
            borderStyle = "border-red-500";
            extraClass = "combat-marker-pulse";
          } else if (isGroupMember) {
            const groupColor = gameState.currentGroup?.color || "#22c55e";
            borderStyle = "";
            extraClass = "group-member-glow";
            borderCss = `border-color: ${groupColor}; box-shadow: 0 0 8px ${groupColor}80;`;
          }

          const iconHtml = `<div class="relative">
                        <div class="player-marker ${extraClass}" style="${borderCss}">${p.avatar || "🧙"}</div>
                        <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border ${borderStyle} whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000; ${borderCss}">
                            ${p.name} (Lv.${currentLevel})${isInCombat ? " ⚔️" : ""}
                        </div>
                    </div>`;

          marker.setIcon(
            L.divIcon({
              html: iconHtml,
              className: "custom-div-icon",
              iconSize: [40, 40],
              iconAnchor: [20, 20],
            }),
          );
          marker.options.lastLevel = currentLevel;
          marker.options.playerData = { status: p.status, groupId: p.groupId };
        }
      } else {
        // CREATE NEW MARKER
        const newMarker = createPlayerMarker(
          p.position.lat,
          p.position.lng,
          p.name,
          p.avatar || "🧙",
          p.id,
          p.level || 1,
          p.isTestPlayer,
          p.userId,
          { groupId: p.groupId, status: p.status },
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
 * Force refresh of all other player markers (e.g. when local player joins/leaves a group)
 */
export function refreshAllPlayerMarkers() {
  if (!map) return;

  // We can immediately re-run the reconstruction logic for immediate UI update
  Object.entries(otherPlayerMarkers).forEach(([id, marker]) => {
    try {
      const p = marker.options.playerData || {};
      const currentLevel = Number(marker.options.lastLevel || 1);
      const status = p.status || "idle";
      const groupId = p.groupId || null;

      const isGroupMember = !!groupId;
      const isInCombat = status === "in_combat";

      let borderStyle = "border-yellow-500/50";
      let extraClass = "";
      let borderCss = "";

      if (isInCombat) {
        borderStyle = "border-red-500";
        extraClass = "combat-marker-pulse";
      } else if (isGroupMember) {
        const groupColor = gameState.currentGroup?.color || "#22c55e";
        borderStyle = "";
        extraClass = "group-member-glow";
        borderCss = `border-color: ${groupColor}; box-shadow: 0 0 8px ${groupColor}80;`;
      }

      // To get name and avatar, we can parse the existing HTML or re-fetch from somewhere.
      // A safer and easier way is to just set lastGroupId to null, which forces the
      // next `updateOtherPlayers` call to reconstruct the HTML completely.
      marker.options.playerData.groupId = "FORCE_REFRESH";
    } catch (e) {
      console.error(`Error refreshing marker for ${id}`, e);
    }
  });

  // Also force update of own player marker (so we get the green glow)
  if (playerMarker && typeof updatePlayerMarkerIcon === "function") {
    updatePlayerMarkerIcon(
      gameState.player.avatar || "🧙",
      gameState.player.level || 1,
      gameState.player.name || "YOU",
    );
  }
}

/**
 * Create a player marker on the map (for test players or newly spawned players)
 */
export function createPlayerMarker(
  lat,
  lng,
  name = "Unknown",
  avatar,
  playerId,
  level = 1,
  isTestPlayer = false,
  userId = null,
  playerData = {},
) {
  if (!map) return null;

  // Визначити стилі на основі статусу
  const groupId = playerData.groupId || null;
  const status = playerData.status || "idle";
  const isGroupMember = !!groupId;
  const isInCombat = status === "in_combat";

  // Колір рамки: група → зелений/кольоровий, бій → червоний, звичайний → жовтий
  let borderStyle = "border-yellow-500/50";
  let extraClass = "";
  if (isInCombat) {
    borderStyle = "border-red-500";
    extraClass = "combat-marker-pulse";
  } else if (isGroupMember) {
    borderStyle = "";
    extraClass = "group-member-glow";
  }

  const groupColor = isGroupMember
    ? gameState.currentGroup?.color || "#22c55e"
    : "";
  const borderCss = groupColor
    ? `border-color: ${groupColor}; box-shadow: 0 0 8px ${groupColor}80;`
    : "";

  const icon = L.divIcon({
    html: `<div class="relative">
                <div class="player-marker ${extraClass}" style="width: 40px; height: 40px; ${borderCss}">${avatar || "🧙"}</div>
                <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border ${borderStyle} whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000; ${borderCss}">
                    ${name} (Lv.${level})${isInCombat ? " ⚔️" : ""}
                </div>
               </div>`,
    className: "custom-div-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  const marker = L.marker([lat, lng], {
    icon: icon,
    zIndexOffset: 500,
    isTestPlayer: isTestPlayer,
    lastLevel: Number(level),
    playerData: playerData,
  }).addTo(map);

  if (isInCombat) {
    marker.combatArena = L.circle([lat, lng], {
      color: "#ef4444",
      fillColor: "#ef4444",
      fillOpacity: 0.1,
      radius: 100,
    }).addTo(map);
  }

  // Popup для взаємодії (Challenge / Group)
  marker.on("click", async () => {
    // Якщо гравець в бою — не дозволяти взаємодію
    const currentStatus = marker.options.playerData?.status || "idle";
    if (currentStatus === "in_combat") {
      import("../auth-ui/ui-controller.js").then((m) =>
        m.showNotification("⚔️ This player is in combat!", "warning"),
      );
      return;
    }

    const curPos = marker.getLatLng();
    const from = turf.point([
      gameState.player.position.lng,
      gameState.player.position.lat,
    ]);
    const to = turf.point([curPos.lng, curPos.lat]);
    const dist = turf.distance(from, to, { units: "kilometers" }) * 1000;

    if (dist > 50) {
      import("../auth-ui/ui-controller.js").then((m) =>
        m.showNotification(`❌ Too far! (${Math.round(dist)}m)`, "warning"),
      );
      return;
    }

    // Check if target is in the same group
    const latestGroupId =
      marker.options.playerData?.groupId || playerData.groupId;
    const myGroupId = gameState.currentGroup?.id;
    const isSameGroup =
      myGroupId && latestGroupId && latestGroupId === myGroupId;

    // Show custom interaction menu instead of Leaflet popup
    import("../gameplay/pvp.js").then((m) => {
      if (m.showPlayerInteractionMenu) {
        m.showPlayerInteractionMenu(
          userId,
          playerId,
          name,
          level,
          avatar,
          isSameGroup,
        );
      }
    });
  });

  if (name && name.includes("TestPlayer103")) {
    console.warn("👻 GHOST DETECTED: TestPlayer103 created!");
    console.trace();
  }

  // Force visibility after DOM renders
  setTimeout(() => {
    if (marker._icon) {
      marker._icon.style.opacity = "1";
      marker._icon.style.visibility = "visible";
    }
  }, 100);

  console.log(
    `✅ Created marker for ${name} with avatar ${avatar}${isTestPlayer ? " (TEST PLAYER)" : ""}`,
  );
  return marker;
}

// ==================== MAP INITIALIZATION ====================
export async function initMap() {
  // Destroy previous map instance if it exists (prevents "already initialized" error)
  if (map) {
    map.remove();
    map = null;
  }

  map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
    renderer: L.canvas(), // Optimize for 2600+ objects
  }).setView(
    [gameState.player.position.lat, gameState.player.position.lng],
    14,
  );

  // Satellite map
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Esri",
    },
  ).addTo(map);

  // Street labels
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 19,
      opacity: 0.9,
      attribution: "CartoDB",
    },
  ).addTo(map);

  monsterCluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 300,
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 20,
    animate: false,
    iconCreateFunction: _gameClusterIcon,
  });
  map.addLayer(monsterCluster);

  // Initialize Canvas monster layer (procedural engine — coexists with legacy MarkerCluster)
  canvasMonsterLayer = new CanvasEntityLayer({
    onClick: handleCanvasMonsterClick,
  });
  canvasMonsterLayer.addTo(map);

  // H3-based procedural loading on map move
  map.on("moveend", loadProceduralMonsters);

  poiCluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 300,
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 20,
    animate: false,
    iconCreateFunction: _gameClusterIcon,
  });
  map.addLayer(poiCluster);

  citadelLayerGroup = L.layerGroup();
  map.addLayer(citadelLayerGroup);

  // --- CLUSTER ZONES REMOVED AS REQUESTED ---

  // Get userName from current auth user (more reliable than gameState after refresh)
  const { getCurrentUser } = await import("../firebase/firebase-service.js");
  const currentUser = getCurrentUser();
  const displayName =
    currentUser?.displayName ||
    gameState.player.userName ||
    gameState.player.name ||
    "Hero";

  const playerIcon = L.divIcon({
    html: `<div class="relative">
                <div class="player-marker">${gameState.player.avatar || "🧙"}</div>
                <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border border-yellow-500/50 whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000;">
                    ${displayName}
                </div>
               </div>`,
    className: "custom-player-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
  playerMarker = L.marker(
    [gameState.player.position.lat, gameState.player.position.lng],
    { icon: playerIcon },
  ).addTo(map);

  // Player interaction radius
  playerRangeCircle = L.circle(
    [gameState.player.position.lat, gameState.player.position.lng],
    {
      radius: gameState.player.interactionRadius,
      className: "player-range",
      color: "#8b5cf6",
      weight: 3,
      fillOpacity: 0.05,
      dashArray: "10, 10",
    },
  ).addTo(map);

  map.on("click", (e) => {
    if (gameState.debug.enabled) {
      const targetLat = e.latlng.lat;
      const targetLng = e.latlng.lng;

      // Move player (logging is now handled inside updatePlayerPosition)
      updatePlayerPosition(targetLat, targetLng);
    }
  });

  // Update fog on map movement
  map.on("move", updateFog);
  map.on("zoom", updateFog);
  map.on("zoomend", updateFog);

  initJoystick();

  // Load H3 library and initial procedural monsters
  _loadH3Modules().then((loaded) => {
    if (loaded) {
      loadProceduralMonsters();
      console.log("✅ H3 spatial engine initialized");
      // Initialize H3 territory rendering if citadels are loaded
      _updateTerritoryCanvas();
    }
  });

  // Initialize Districts System
  import("./districts.js").then((module) => {
    module.initDistricts(map);
  });

  // ── Territory Canvas Layer ──────────────────────────────────
  try {
    territoryCanvasLayer = new TerritoryCanvasLayer({ fillOpacity: 0.15 });
    territoryCanvasLayer.addTo(map);
    console.log("🗺️ Territory canvas layer initialized");
  } catch (e) {
    console.warn("⚠️ Territory canvas layer failed to init:", e.message);
  }

  // ==================== OPTIMIZATION HANDLERS ====================
  // Prune distant objects and re-render nearby on move end (Memory Management)
  map.on("moveend", () => {
    const center = map.getCenter();
    pruneDistantObjects(center.lat, center.lng);

    // RE-RENDER to restore pruned markers that are now within range
    renderStaticMonsters(false);
    renderPOIs();

    // Update territory canvas (throttled to avoid expensive recomputes)
    _throttledTerritoryUpdate();
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
  monsterCluster.eachLayer((layer) => {
    const mLat = layer.getLatLng().lat;
    const mLng = layer.getLatLng().lng;
    const dist = getDistance(lat, lng, mLat, mLng); // Using map.js getDistance

    // If too far, remove
    if (dist > MAX_DIST_KM * 1000) {
      // getDistance usually returns meters
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
    poiCluster.eachLayer((layer) => {
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
  // const { fetchNearbyObjects } = await import('../firebase/firebase-service.js');
  // ... logic would go here
}

/**
 * Update Player Marker Icon (e.g. upon character switch)
 */
export function updatePlayerMarkerIcon(
  avatar = "🧙",
  level = 1,
  name = "Player",
) {
  if (!playerMarker) return;

  // Apply group color glow if player is in a group
  const groupColor = gameState.currentGroup?.color || "";
  const extraClass = groupColor ? "group-member-glow" : "";
  const borderCss = groupColor
    ? `border-color: ${groupColor}; box-shadow: 0 0 8px ${groupColor}80;`
    : "";
  const borderStyle = groupColor ? "" : "border-yellow-500/50";

  const iconHtml = `<div class="relative">
        <div class="player-marker ${extraClass}" style="${borderCss}">${avatar}</div>
        <div class="absolute -top-5 left-1/2 -translate-x-1/2 bg-black/60 text-yellow-300 text-[10px] px-2 py-0.5 rounded-full border ${borderStyle} whitespace-nowrap shadow-sm font-bold backdrop-blur-sm" style="z-index: 1000; ${borderCss}">
            ${name} (Lv.${level})
        </div>
    </div>`;

  const newIcon = L.divIcon({
    html: iconHtml,
    className: "custom-div-icon",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  playerMarker.setIcon(newIcon);
}

// Export to window for UI use
window.updatePlayerMarkerIcon = updatePlayerMarkerIcon;

// ==================== PLAYER MOVEMENT ====================
// ==================== PLAYER MOVEMENT ====================
export function updatePlayerPosition(lat, lng) {
  const oldCity = getPlayerCity();
  const oldPos = gameState.player.position
    ? { ...gameState.player.position }
    : { lat: 0, lng: 0 };

  if (lastPlayerPos) {
    const dist = getDistance(lastPlayerPos.lat, lastPlayerPos.lng, lat, lng);
    gameState.quests.distanceTraveled += dist;

    if (dist > 10) {
      addEventLog(`Movement: ${Math.floor(dist)}m`, "move");
    }
  }
  lastPlayerPos = { lat, lng };

  // Update GameState position (always current controlled char)
  // Synchronize both locations where position is stored
  const newPos = { lat, lng };
  gameState.player.position = newPos;
  gameState.position = newPos;

  // 100km Proximity logic: if player moved > 5km from last fetched position, reload objects
  if (!lastFetchedPos) {
    lastFetchedPos = { lat, lng };
  } else if (window.turf) {
    const from = window.turf.point([lastFetchedPos.lng, lastFetchedPos.lat]);
    const to = window.turf.point([lng, lat]);
    const distKm = window.turf.distance(from, to, { units: "kilometers" });

    if (distKm >= 5) {
      console.log(
        `🌍 Player moved ${distKm.toFixed(1)}km, triggering updateVisibility()`,
      );
      lastFetchedPos = { lat, lng };
      if (typeof updateVisibility === "function") {
        updateVisibility();
      }
    }
  }

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
  import("./districts.js").then(({ getDistrictByCoords }) => {
    const district = getDistrictByCoords(lat, lng);
    const oldDistrict = gameState.currentDistrict;

    if (district && (!oldDistrict || oldDistrict.id !== district.id)) {
      console.log(`📍 Entered District: ${district.name}`);
      gameState.currentDistrict = district;
      showNotification(`📍 Entering ${district.name}`, "info");

      // Update HUD
      if (window.updateDistrictHUD) window.updateDistrictHUD();
    } else if (!district && oldDistrict) {
      console.log(`📍 Left District: ${oldDistrict.name}`);
      gameState.currentDistrict = null;
      if (window.updateDistrictHUD) window.updateDistrictHUD();
    }
  });

  // ── H3 Discovery Trigger ────────────────────────────────────
  // Check if entering a new H3 cell triggers landmark discovery
  checkDiscovery(lat, lng)
    .then((newCastles) => {
      if (newCastles && newCastles.length > 0) {
        console.log(`🏰 Discovered ${newCastles.length} new castle(s)!`);
        showNotification(
          `🏰 Discovered ${newCastles.length} new landmark(s)!`,
          "success",
        );
        // Note: We don't need to manually call setCitadels() here because
        // saveDiscoveredCastle writes to Firestore, which immediately triggers
        // our subscribeToCastles listener, updating the map automatically.
      }
    })
    .catch((err) => console.warn("Discovery check failed:", err));

  // Check for new POIs (Castles/Shops)
  checkAndFetchPOIs();

  // Arena boundary check during combat
  if (gameState.combat && gameState.combat.arena) {
    import("../gameplay/combat.js").then(({ checkArenaBoundary }) => {
      checkArenaBoundary(lat, lng);
    });
  }

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

  import("../firebase/firebase-service.js").then(
    ({ updatePlayerLocationRTDB }) => {
      updatePlayerLocationRTDB(lat, lng);
    },
  );
}

export function updateDebugCoords() {
  if (!gameState.debug.enabled) return;
  const pos = gameState.player.position;
  const latEl = document.getElementById("debug-lat");
  const lngEl = document.getElementById("debug-lng");
  if (latEl) latEl.textContent = pos.lat.toFixed(6);
  if (lngEl) lngEl.textContent = pos.lng.toFixed(6);

  const city = getPlayerCity();
  const cityEl = document.getElementById("debug-city");
  if (cityEl) {
    cityEl.textContent = city ? city.name : "Wilderness";
  }
}

// ==================== JOYSTICK CONTROLS ====================
export function initJoystick() {
  const container = document.getElementById("joystick-container");
  const knob = document.getElementById("joystick-knob");
  if (!container || !knob) return;

  let active = false,
    interval = null;
  let dir = { x: 0, y: 0 };

  function move(cx, cy) {
    const rect = container.getBoundingClientRect();
    let dx = cx - rect.left - 60,
      dy = cy - rect.top - 60;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 35) {
      dx = (dx / dist) * 35;
      dy = (dy / dist) * 35;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    dir = { x: dx / 35, y: -dy / 35 };
  }

  function end() {
    active = false;
    knob.style.transform = "translate(-50%, -50%)";
    dir = { x: 0, y: 0 };
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
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
            gameState.player.position.lng + dir.x * speed,
          );
        }
      }, 50);
    }
  }

  knob.addEventListener("mousedown", start);
  knob.addEventListener("touchstart", start, { passive: true });
  document.addEventListener("mousemove", (e) => {
    if (active) move(e.clientX, e.clientY);
  });
  document.addEventListener(
    "touchmove",
    (e) => {
      if (active && e.touches[0])
        move(e.touches[0].clientX, e.touches[0].clientY);
    },
    { passive: true },
  );
  document.addEventListener("mouseup", end);
  document.addEventListener("touchend", end);
}

// ==================== CITY & DISTRICTS ====================
export function getPlayerCity() {
  const pos = gameState.player.position;
  if (!pos) return null;

  let closestCity = null;
  let closestDist = Infinity;

  // Find closest city
  CITY_ANCHORS.forEach((city) => {
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
// ==================== H3 PROCEDURAL MONSTER SYSTEM ====================

/**
 * Dynamically load H3 spatial + procedural engine modules.
 * These are created by the spatial specialist (core/h3-spatial.js, core/procedural-engine.js).
 * Returns true if both modules are available, false otherwise (graceful degradation).
 */
async function _loadH3Modules() {
  if (_h3Spatial && _proceduralEngine) return true;
  try {
    if (!_h3Spatial) _h3Spatial = await import("../core/h3-spatial.js");
    // Load the h3-js CDN library before anything tries to use H3 functions
    await _h3Spatial.ensureH3Loaded();
    if (!_proceduralEngine)
      _proceduralEngine = await import("../core/procedural-engine.js");
    if (!_h3Territory) _h3Territory = await import("../core/h3-territory.js");
    return true;
  } catch {
    // Modules not yet created — canvas layer will remain empty until they are
    return false;
  }
}

/**
 * Bridge canvas entity click to existing combat system.
 * Replicates the same flow as renderStaticMonsters marker.on('click').
 */
function handleCanvasMonsterClick(entity) {
  const monster = proceduralMonsters.get(entity.id);
  if (!monster) return;

  // Check defeated state
  if (entity.inactive) {
    showNotification("⏳ Monster is resting", "warning");
    return;
  }

  // Distance check (same logic as static monster click handler)
  const dist = getDistance(
    gameState.player.position.lat,
    gameState.player.position.lng,
    monster.lat,
    monster.lng,
  );

  if (dist <= gameState.player.interactionRadius) {
    if (gameState.currentGroup && window.startGroupCombat) {
      window.startGroupCombat(monster, true);
    } else if (window.showPreCombatDialog) {
      window.showPreCombatDialog(monster, true);
    } else {
      window.startCombat(monster, true);
    }
  } else {
    showNotification("❌ Get closer!", "warning");
  }
}

/**
 * Load procedural monsters for visible H3 cells and push to canvas layer.
 * Called on map moveend and after H3 module initialization.
 */
async function loadProceduralMonsters() {
  if (!canvasMonsterLayer || !map) return;

  const loaded = await _loadH3Modules();
  if (!loaded) return;

  const { adaptiveResolution, getViewportCells, H3_RES_ENTITY, latLngToH3 } =
    _h3Spatial;
  const { getMonstersForViewport } = _proceduralEngine;

  const bounds = map.getBounds();
  const zoom = map.getZoom();
  const resolution = adaptiveResolution(zoom);

  // Only generate at entity-level resolution when zoomed in enough
  if (resolution < 6) {
    canvasMonsterLayer.clearAll();
    return;
  }

  const cells = getViewportCells(
    {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    },
    H3_RES_ENTITY, // ALWAYS use Res 8 so cluster counts are accurate
  );

  // Generate monsters for visible cells
  const monsters = getMonstersForViewport(cells, defeatedMonsterIds);

  // Update lookup map for combat
  proceduralMonsters.clear();
  const canvasEntities = [];

  const isAdmin = window.gameState?.player?.role === "admin";

  for (const m of monsters) {
    // Strictly restrict monsters to the visible H3 territory hexes of Citadels.
    if (!isAdmin) {
      const cell = latLngToH3(m.lat, m.lng, 7);
      if (!validTerritoryCells.has(cell)) continue;
    }

    proceduralMonsters.set(m.id, m);
    canvasEntities.push({
      id: m.id,
      lat: m.lat,
      lng: m.lng,
      icon: m.icon,
      level: m.level,
      name: m.name,
      class: m.class,
      inactive: defeatedMonsterIds.has(m.id),
      data: m,
    });
  }

  canvasMonsterLayer.setEntities(canvasEntities);
  loadedH3Cells = new Set(cells);
}

/**
 * Mark a procedural monster as defeated.
 * Called from combat.js after victory via window bridge.
 */
export function markProceduralMonsterDefeated(monsterId) {
  defeatedMonsterIds.add(monsterId);
  // Update canvas layer immediately
  const entity = canvasMonsterLayer?.getEntityById(monsterId);
  if (entity) {
    entity.inactive = true;
    canvasMonsterLayer._render();
  }

  // Auto-respawn after cooldown (uses existing DEFEATED_COOLDOWN_MS)
  setTimeout(() => {
    defeatedMonsterIds.delete(monsterId);
    loadProceduralMonsters(); // Refresh view
  }, DEFEATED_COOLDOWN_MS);
}

/**
 * Bulk-set defeated monster IDs (e.g. from SyncEngine persistence).
 */
export function setDefeatedMonsterIds(ids) {
  defeatedMonsterIds = new Set(ids);
  loadProceduralMonsters();
}

/**
 * Get the set of currently loaded H3 cell indices.
 */
export function getLoadedH3Cells() {
  return loadedH3Cells;
}

// ==================== STATIC (LEGACY) MONSTER RENDERING ====================

export function renderStaticMonsters(force = false, center) {
  if (!map) {
    console.log("⚠️ Map is not initialized!");
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
      maxClusterRadius: 300,
      chunkedLoading: true,
      chunkInterval: 50,
      chunkDelay: 20,
      animate: false,
      iconCreateFunction: _gameClusterIcon,
    });
    map.addLayer(monsterCluster);
  }

  // Clear old markers
  monsterCluster.clearLayers();
  monsterMarkers = [];
  _loadedObjectIds.clear(); // Reset tracking for re-rendering prunable objects

  // Filter monsters (Optimization: View-based filtering, increased to 50km to cover whole screen)
  const isAdmin = gameState.player.role === "admin";
  const playerPos = gameState.player.position;
  const playerPoint = turf.point([playerPos.lng, playerPos.lat]);

  // Need latLngToH3 for static monster filtering
  const { latLngToH3 } = _h3Spatial || window.h3Spatial || {};

  const monstersToShow = staticMonsters.filter((m) => {
    if (isAdmin) return true;
    if (!m.lng || !m.lat) return false;

    // Strictly restrict monsters to visible Citadel H3 zones
    if (latLngToH3) {
      const cell = latLngToH3(m.lat, m.lng, 7);
      if (!validTerritoryCells.has(cell)) return false;
    }

    const mPoint = turf.point([m.lng, m.lat]);
    const distance = turf.distance(playerPoint, mPoint, {
      units: "kilometers",
    });
    return distance <= 100;
  });

  // console.log(`🌍 Viewing ${monstersToShow.length} monsters within ${MAX_RENDER_DIST}m of center`);

  if (monstersToShow.length === 0) {
    console.warn("⚠️ No monsters found to display!");
    return;
  }

  // Create markers
  const markersToAdd = [];
  monstersToShow.forEach((monster) => {
    // Skip defeated monsters (old local system)
    if (monster.defeated && monster.respawnAt && monster.respawnAt > Date.now())
      return;

    // Respawn monster if time is up
    if (
      monster.defeated &&
      monster.respawnAt &&
      monster.respawnAt <= Date.now()
    ) {
      monster.defeated = false;
      monster.respawnAt = null;
    }

    // Check Firestore-persisted defeated state (visible to ALL players)
    const defState = getMonsterDefeatedState(monster);
    const isInactive = isMonsterInactive(monster.id) || defState.defeated;
    const inactiveClass = isInactive ? "inactive" : "";
    const opacityStyle = isInactive ? "pointer-events: auto;" : "";

    const icon = L.divIcon({
      html: `<div class="monster-marker ${monster.class} ${inactiveClass}" style="${opacityStyle}">
                <span class="monster-icon">${monster.icon}</span>
                <span class="monster-level">Lv.${monster.level}</span>
            </div>`,
      className: "",
      iconSize: [60, 70],
      iconAnchor: [30, 35],
    });

    const marker = L.marker([monster.lat, monster.lng], {
      icon,
      zIndexOffset: 1200, // Middle layer (indices)
    });
    marker.monsterId = monster.id;

    // Tooltip — show cooldown timer if defeated
    let tooltipExtra = "";
    if (defState.defeated) {
      const mins = Math.floor(defState.remainingMs / 60000);
      const secs = Math.floor((defState.remainingMs % 60000) / 1000);
      tooltipExtra = `<div class="text-yellow-400">⏳ ${mins}:${secs.toString().padStart(2, "0")}</div>`;
    }
    marker.bindTooltip(
      `
            <div class="text-xs">
                <div class="font-bold">${monster.name}</div>
                <div>Lv.${monster.level} · ${monster.class}</div>
                ${tooltipExtra}
            </div>
        `,
      { permanent: false, direction: "top" },
    );

    marker.on("click", () => {
      // Check local inactive OR Firestore-persisted defeated
      const currentDefState = getMonsterDefeatedState(monster);
      if (isMonsterInactive(monster.id) || currentDefState.defeated) {
        let remaining;
        if (currentDefState.defeated) {
          remaining = Math.ceil(currentDefState.remainingMs / 1000);
        } else {
          remaining = Math.ceil(
            (gameState.inactiveMonsters[monster.id] - Date.now()) / 1000,
          );
        }
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        showNotification(
          `⏳ Monster is resting: ${mins}:${secs.toString().padStart(2, "0")}`,
          "warning",
        );
        return;
      }

      const dist = getDistance(
        gameState.player.position.lat,
        gameState.player.position.lng,
        monster.lat,
        monster.lng,
      );
      if (dist <= gameState.player.interactionRadius) {
        // Якщо є група — використати груповий бій
        if (gameState.currentGroup && window.startGroupCombat) {
          window.startGroupCombat(monster, true);
        } else if (window.showPreCombatDialog) {
          window.showPreCombatDialog(monster, true);
        } else {
          window.startCombat(monster, true);
        }
      } else {
        showNotification("❌ Get closer!", "warning");
      }
    });

    markersToAdd.push(marker);
    monsterMarkers.push(marker);
  });

  monsterCluster.addLayers(markersToAdd);
}

// ==================== FOG OF WAR ====================
export function calculateFogRadius() {
  const baseRadiusMeters =
    100 + gameState.player.intuition * 5 + gameState.player.wisdom * 3;
  return baseRadiusMeters;
}

export function metersToPixels(meters) {
  if (!map) return 100;
  const zoom = map.getZoom();
  const lat = gameState.player.position.lat;
  const metersPerPixel =
    (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return meters / metersPerPixel;
}

export function updateFog() {
  if (!gameState.settings.fog) return;
  if (!map) return;

  try {
    const point = map.latLngToContainerPoint([
      gameState.player.position.lat,
      gameState.player.position.lng,
    ]);
    const fog = document.getElementById("fog");
    if (!fog) return;

    fog.style.setProperty("--player-x", point.x + "px");
    fog.style.setProperty("--player-y", point.y + "px");

    const radius = calculateFogRadius();
    const pixels = metersToPixels(radius);

    fog.style.setProperty("--fog-radius-inner", pixels + "px");
    fog.style.setProperty("--fog-radius-mid", pixels * 1.5 + "px");
    fog.style.setProperty("--fog-radius-outer", pixels * 2.25 + "px");
    fog.style.setProperty("--fog-radius-max", pixels * 3.125 + "px");
  } catch (e) {
    console.warn("Fog update error:", e);
  }
}

// ==================== UTILITY FUNCTIONS ====================
export function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

const DEFEATED_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

function isMonsterInactive(monsterId) {
  // Check local cooldown (flee/defeat penalties — local player only)
  if (
    gameState.inactiveMonsters[monsterId] &&
    gameState.inactiveMonsters[monsterId] > Date.now()
  ) {
    return true;
  }
  return false;
}

/**
 * Check if a monster is defeated (Firestore-persisted, visible to ALL players)
 * @param {Object} monster - monster object from spawned_objects (must have .defeatedAt)
 * @returns {{ defeated: boolean, remainingMs: number }}
 */
function getMonsterDefeatedState(monster) {
  if (!monster.defeatedAt) return { defeated: false, remainingMs: 0 };
  const elapsed = Date.now() - monster.defeatedAt;
  if (elapsed < DEFEATED_COOLDOWN_MS) {
    return { defeated: true, remainingMs: DEFEATED_COOLDOWN_MS - elapsed };
  }
  return { defeated: false, remainingMs: 0 };
}

// Глобальний експорт

window.updatePlayerPosition = updatePlayerPosition;
window.getDistance = getDistance;
export function centerOnPlayer() {
  if (map && gameState.player.position) {
    map.setView(
      [gameState.player.position.lat, gameState.player.position.lng],
      16,
    );
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
    className: "other-player-marker",
  });

  const marker = L.marker([currentPos.lat, currentPos.lng], {
    icon: icon,
  }).addTo(map);

  // Store in otherPlayerMarkers
  otherPlayerMarkers[playerId] = marker;

  // Remove current player marker (will be recreated at new position)
  if (playerMarker) {
    playerMarker.remove();
  }
  if (playerRangeCircle) {
    playerRangeCircle.remove();
  }

  console.log(
    `✅ Converted player marker to other player: ${playerName} at`,
    currentPos,
  );
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
    className: "player-marker",
  });

  playerMarker = L.marker([lat, lng], {
    icon: icon,
    draggable: !!gameState.debug?.enabled,
  }).addTo(map);

  // Add interaction range circle
  playerRangeCircle = L.circle([lat, lng], {
    radius: gameState.player.interactionRadius || 25,
    className: "player-range",
    color: "#8b5cf6",
    fillColor: "#8b5cf6",
    fillOpacity: 0.1,
    weight: 3,
    dashArray: "10, 10",
  }).addTo(map);

  // Add drag event if debug mode
  if (gameState.debug?.enabled) {
    playerMarker.on("dragend", function (e) {
      const newPos = e.target.getLatLng();
      updatePlayerPosition(newPos.lat, newPos.lng);
    });
  }

  console.log(
    `✅ Created player marker at: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  );
}

/**
 * Restore original player marker and remove "other player" marker
 * Called when returning to self
 */
export function restorePlayerMarker(
  originalLat,
  originalLng,
  controlledPlayerId,
) {
  if (!map) return;

  // Remove the "other player" marker for the controlled character
  if (controlledPlayerId && otherPlayerMarkers[controlledPlayerId]) {
    otherPlayerMarkers[controlledPlayerId].remove();
    delete otherPlayerMarkers[controlledPlayerId];
    console.log(
      `✅ Removed other player marker: ${controlledPlayerId.substring(0, 12)}`,
    );
  }

  // Create player marker at original position
  createPlayerMarkerAt(originalLat, originalLng);

  // Update range circle
  if (playerRangeCircle) {
    playerRangeCircle.setLatLng([originalLat, originalLng]);
  }

  console.log(
    `✅ Restored player marker at: ${originalLat.toFixed(4)}, ${originalLng.toFixed(4)}`,
  );
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
    playerRangeCircle = L.circle(
      [gameState.player.position.lat, gameState.player.position.lng],
      {
        radius: newRadius,
        className: "player-range",
        color: "#8b5cf6",
        fillColor: "#8b5cf6",
        fillOpacity: 0.1,
        weight: 3,
        dashArray: "10, 10",
      },
    ).addTo(map);
  }
};

// ==================== PLAYER INTERACTION ====================

window._onPlayerAction = async function (action, targetId, charOrUserId, name) {
  if (action === "challenge") {
    // Block PvP against same-group members
    const marker = otherPlayerMarkers[charOrUserId];
    const targetGroupId = marker?.options?.playerData?.groupId;
    if (targetGroupId && targetGroupId === gameState.currentGroup?.id) {
      showNotification("❌ Cannot attack a group member!", "error");
      return;
    }
    const { createBattleRequest } =
      await import("../firebase/firebase-service.js");
    showNotification(`⚔️ Sending challenge to ${name}...`, "info");
    await createBattleRequest(targetId, charOrUserId);
  } else if (action === "group") {
    // Block group invite if already in same group
    const marker = otherPlayerMarkers[charOrUserId];
    const targetGroupId = marker?.options?.playerData?.groupId;
    if (targetGroupId && targetGroupId === gameState.currentGroup?.id) {
      showNotification("❌ Player is already in your group!", "error");
      return;
    }
    if (window.invitePlayerToGroup) {
      window.invitePlayerToGroup(charOrUserId);
      showNotification(`👥 Inviting ${name} to group...`, "info");
    }
  }
};

// ==================== ARENA RENDERING ====================

/**
 * Відобразити арену на мапі
 */
export function renderArena(arenaId, center, radius) {
  if (!map) return;
  removeArenaFromMap(arenaId);

  const arenaCircle = L.circle([center.lat, center.lng], {
    radius: radius,
    className: "arena-circle",
    color: "#ef4444",
    weight: 3,
    fillColor: "#ef4444",
    fillOpacity: 0.08,
    dashArray: "8, 4",
    interactive: false,
  }).addTo(map);

  arenaLayers[arenaId] = arenaCircle;
}

/**
 * Видалити арену з мапи
 */
export function removeArenaFromMap(arenaId) {
  if (arenaLayers[arenaId]) {
    arenaLayers[arenaId].remove();
    delete arenaLayers[arenaId];
  }
}

/**
 * Перевірити, чи гравець всередині арени
 */
export function isInsideArena(lat, lng, arenaCenter, arenaRadius) {
  const dist = getDistance(lat, lng, arenaCenter.lat, arenaCenter.lng);
  return dist <= arenaRadius;
}

/**
 * Оновити всі арени з RTDB
 */
export function updateArenas(arenasData) {
  // Видалити зниклі арени
  Object.keys(arenaLayers).forEach((id) => {
    if (!arenasData[id]) {
      removeArenaFromMap(id);
    }
  });

  // Додати/оновити арени + Garbage Collection
  Object.entries(arenasData).forEach(([id, arena]) => {
    const participants = arena.participants || [];
    const ageMs = Date.now() - (arena.startedAt || 0);
    let shouldCleanUp = false;

    // Cleanup if arena has no participants and is older than 1 minute (to allow creation time)
    if (participants.length === 0 && ageMs > 60000) {
      shouldCleanUp = true;
    }

    // GC Check: If we have live players loaded, verify if participants are actually in combat
    if (!shouldCleanUp && window._livePlayers && participants.length > 0) {
      let bothFoundAndNotInCombat = true;

      participants.forEach((pid) => {
        const p = window._livePlayers.find((player) => player.id === pid);
        if (p && p.status === "in_combat") {
          bothFoundAndNotInCombat = false;
        }
      });

      // Cleanup if no participants are still 'in_combat' (and it's not brand new, to prevent race conditions), or if stringently old
      if ((bothFoundAndNotInCombat && ageMs > 10000) || ageMs > 3600000) {
        shouldCleanUp = true;
      }
    }

    if (shouldCleanUp) {
      console.log(`🧹 Garbage collecting stale arena: ${id}`);
      import("../firebase/firebase-service.js").then(({ removeArenaRTDB }) => {
        removeArenaRTDB(id);
      });
      return; // Skip rendering
    }

    if (!arenaLayers[id] && arena.center) {
      renderArena(id, arena.center, arena.radius || 50);
    }
  });
}

// ==================== TERRITORY CANVAS RENDERING ====================

/**
 * Recompute territory boundaries from the citadel cache and update the canvas layer.
 * Called when citadels change (discovery, capture, power change).
 */
function _throttledTerritoryUpdate() {
  const now = Date.now();
  if (now - _lastTerritoryUpdate < TERRITORY_UPDATE_THROTTLE) return;
  _lastTerritoryUpdate = now;
  _updateTerritoryCanvas();
}

/**
 * Initialize H3 territory system: load citadels from Firestore, compute boundaries.
 * Called from app.js after Firebase is ready.
 */
export async function initH3Territory() {
  try {
    // Ensure H3 modules are loaded
    const loaded = await _loadH3Modules();
    if (!loaded) {
      console.warn("⚠️ H3 modules not available for territory init");
      return;
    }

    // Load citadels from Firestore castles collection
    const { subscribeToCastles } =
      await import("../firebase/firebase-service.js");
    subscribeToCastles((castlesMap) => {
      const citadels = Object.entries(castlesMap)
        .map(([id, data]) => ({
          id,
          lat: data.lat ?? data.position?.lat,
          lng: data.lng ?? data.position?.lng,
          name: data.name || `Citadel ${id.substring(0, 6)}`,
          powerMultiplier: data.powerMultiplier || 1,
          ownerId: data.ownerId || null,
          ownerName: data.ownerName || null,
          cityId: data.cityId || null,
        }))
        .filter(
          (c) =>
            c.lat != null && c.lng != null && !isNaN(c.lat) && !isNaN(c.lng),
        );

      setCitadels(citadels);
      _updateTerritoryCanvas();
      console.log(
        `🏰 Loaded ${citadels.length} citadels from Firestore → H3 territory updated`,
      );
    });

    // Trigger initial H3 discovery on load
    if (gameState && gameState.player && gameState.player.position) {
      const { lat, lng } = gameState.player.position;
      checkDiscovery(lat, lng)
        .then((newCastles) => {
          if (newCastles && newCastles.length > 0) {
            console.log(
              `🏰 Initial discovery: ${newCastles.length} new castle(s)!`,
            );
            showNotification(
              `🏰 Discovered ${newCastles.length} new landmark(s)!`,
              "success",
            );
            // Firebase snapshot listener will handle state update automatically
          }
        })
        .catch(() => {});
    }
  } catch (e) {
    console.warn("⚠️ H3 territory init failed:", e.message);
  }
}

function _updateCitadelMarkers() {
  if (!citadelLayerGroup) return;
  citadelLayerGroup.clearLayers();

  const citadels = getCitadels();
  if (citadels.length === 0) return;

  citadels.forEach((citadel) => {
    if (
      citadel.lat == null ||
      citadel.lng == null ||
      isNaN(citadel.lat) ||
      isNaN(citadel.lng)
    ) {
      console.warn(
        `⚠️ Skipping citadel "${citadel.name || citadel.id}" — invalid coords:`,
        citadel.lat,
        citadel.lng,
      );
      return;
    }

    const iconHtml = `
      <div class="w-12 h-12 flex items-center justify-center relative bg-transparent">
          <div class="absolute inset-0 rounded-full blur-md opacity-40 bg-orange-500"></div>
          <div class="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] z-10 leading-none select-none">🏯</div>
      </div>
    `;

    const markerIcon = L.divIcon({
      html: iconHtml,
      className: "custom-tpl-icon",
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    const marker = L.marker([citadel.lat, citadel.lng], {
      icon: markerIcon,
      zIndexOffset: 3000,
    });

    const ownerText = citadel.ownerName
      ? `<div class="text-yellow-400 font-bold">👑 ${citadel.ownerName}</div>`
      : `<div class="text-gray-400 italic">Unclaimed</div>`;
    marker.bindTooltip(
      `
        <div class="text-center p-1">
            <div class="font-bold text-lg text-orange-300">${citadel.name || "Citadel"}</div>
            ${ownerText}
        </div>
    `,
      { direction: "top", permanent: false },
    );

    marker.on("click", () => {
      const dist = getDistance(
        gameState.player.position.lat,
        gameState.player.position.lng,
        citadel.lat,
        citadel.lng,
      );
      if (dist <= 50) {
        if (window.openCitadelMenu) window.openCitadelMenu();
      } else {
        showNotification(
          "❌ Get closer to interact with the Citadel!",
          "warning",
        );
      }
    });

    citadelLayerGroup.addLayer(marker);
  });
}

function _updateTerritoryCanvas() {
  _updateCitadelMarkers();

  if (!territoryCanvasLayer) return;

  const citadels = getCitadels();

  // If H3 module is loaded and we have citadels, use H3 rendering
  if (_h3Territory && citadels.length > 0) {
    try {
      const h3Territories = _h3Territory.computeH3Boundaries(citadels, 7, 5);
      territoryCanvasLayer.setH3Territories(h3Territories);

      // Save strictly visible cells so monsters only spawn inside them
      validTerritoryCells.clear();
      for (const t of h3Territories) {
        if (t.cells) {
          for (const cell of t.cells) {
            validTerritoryCells.add(cell);
          }
        }
      }

      // Re-evaluate monsters now that the zones have updated
      setTimeout(() => {
        loadProceduralMonsters();
        renderStaticMonsters();
      }, 50);

      // --- Console logging: visible citadels and zones ---
      const visibleCitadels = citadels.length;
      const visibleZones = h3Territories.length;
      const totalCells = h3Territories.reduce(
        (sum, t) => sum + (t.cells?.length || 0),
        0,
      );
      console.log(
        `🏰 H3 Territory Update: ${visibleCitadels} citadels, ${visibleZones} zones, ${totalCells} hex cells on map`,
      );
      return;
    } catch (e) {
      console.warn(
        "⚠️ H3 territory rendering failed, falling back to polygon:",
        e.message,
      );
    }
  }

  // Fallback: legacy raycast polygon rendering
  try {
    const territories = computeAllTerritoryBoundaries(24, 30);
    territoryCanvasLayer.setTerritories(territories);
    if (citadels.length > 0) {
      console.log(
        `🏰 Legacy Territory Update: ${citadels.length} citadels (polygon mode)`,
      );
    }
  } catch (e) {
    console.warn("⚠️ Territory canvas update failed:", e.message);
  }
}

/**
 * Toggle the territory canvas layer visibility.
 * Can be called from the district toggle button via bridge.js.
 */
export function toggleTerritoryCanvas() {
  if (!territoryCanvasLayer) return;
  const isVisible = territoryCanvasLayer._visible;
  territoryCanvasLayer.setVisible(!isVisible);
}

window.toggleTerritoryCanvas = toggleTerritoryCanvas;

// ==================== VISIBILITY MANAGEMENT ====================
export async function updateVisibility() {
  console.log("🔄 Updating visibility (5km boundary crossed)");
  // This will fetch from SyncEngine which now applies the 100km filter
  const { fetchSpawnedObjectsOnce } =
    await import("../firebase/firebase-service.js");
  const objects = await fetchSpawnedObjectsOnce(true); // force reload to apply updated 100km filter

  // Update the game state with the new filtered objects
  import("../core/gameState.js").then(({ setStaticMonsters }) => {
    const monsters = objects.filter((o) => o.type === "monster");
    setStaticMonsters(monsters);

    // Re-render
    renderStaticMonsters(true);
  });

  import("./poi.js").then(({ addExternalPOIs, renderPOIs }) => {
    const pois = objects.filter(
      (o) => o.type === "shop" || o.type === "castle" || o.type === "vault",
    );
    addExternalPOIs(pois);
    if (typeof renderPOIs === "function") renderPOIs();
  });
}

// ==================== PROCEDURAL ENGINE EXPORTS ====================
export { loadProceduralMonsters };
