// ==================== H3 DISCOVERY SERVICE ====================
// Dynamic world discovery: H3 cells + OSM landmarks → castles
//
// When a player enters an H3 Res 6 cell for the first time,
// query Overpass for historic landmarks and create castle documents.

import { latLngToH3, h3ToLatLng, h3ToBoundary, ensureH3Loaded } from './h3-spatial.js';
import { OverpassService } from '../map/overpass-service.js';

// ── Constants ───────────────────────────────────────────────────
const H3_RES_DISCOVERY = 6;  // ~3.2km edge — discovery granularity
const DISCOVERY_COOLDOWN_MS = 60 * 1000; // 1 min between discovery attempts per cell
const MAX_CASTLES_PER_CELL = 3; // Cap castles per H3 cell

// OSM tags that qualify as "discoverable landmarks"
const LANDMARK_TAGS = [
  'historic=castle',
  'historic=monument',
  'historic=ruins',
  'historic=fort',
  'historic=citadel',
  'amenity=place_of_worship',
  'tourism=attraction',
  'historic=memorial',
  'building=cathedral',
  'building=church',
];

// ── State ───────────────────────────────────────────────────────
/** @type {Set<string>} H3 cells that have been discovered (queried) this session */
const discoveredCells = new Set();

/** @type {Map<string, number>} H3 cell → last attempt timestamp (for cooldown) */
const cellCooldowns = new Map();

/** @type {Array<Object>} All discovered castles/citadels in memory */
let discoveredCastles = [];

// ── Callbacks (injected to avoid circular imports) ─────────────
let _onCastleDiscovered = null; // (castle) => void
let _saveCastleFn = null; // async (castle) => boolean
let _loadDiscoveredCellsFn = null; // async () => Set<string>
let _loadCastlesFn = null; // async () => Array

/**
 * Initialize the discovery service with Firebase callback functions.
 * This avoids circular imports with firebase-service.js.
 * @param {Object} callbacks
 * @param {function} callbacks.onCastleDiscovered - Called when a new castle is found
 * @param {function} callbacks.saveCastle - async fn to persist castle to Firestore
 * @param {function} callbacks.loadDiscoveredCells - async fn to load discovered cell IDs
 * @param {function} callbacks.loadCastles - async fn to load all known castles
 */
export function initDiscoveryService({ onCastleDiscovered, saveCastle, loadDiscoveredCells, loadCastles }) {
  _onCastleDiscovered = onCastleDiscovered || null;
  _saveCastleFn = saveCastle || null;
  _loadDiscoveredCellsFn = loadDiscoveredCells || null;
  _loadCastlesFn = loadCastles || null;
}

/**
 * Load previously discovered cells from persistence.
 */
export async function loadDiscoveryState() {
  if (_loadDiscoveredCellsFn) {
    const cells = await _loadDiscoveredCellsFn();
    if (cells) cells.forEach(c => discoveredCells.add(c));
  }
  if (_loadCastlesFn) {
    discoveredCastles = (await _loadCastlesFn()) || [];
  }
  console.log(`🗺️ Discovery loaded: ${discoveredCells.size} cells, ${discoveredCastles.length} castles`);
}

/**
 * Check if an H3 cell needs discovery. Called on player movement.
 * @param {number} lat - Player latitude
 * @param {number} lng - Player longitude
 * @returns {Promise<Array<Object>>} Newly discovered castles (empty if cell already known)
 */
export async function checkDiscovery(lat, lng) {
  await ensureH3Loaded();

  const cellId = latLngToH3(lat, lng, H3_RES_DISCOVERY);

  // Already discovered
  if (discoveredCells.has(cellId)) return [];

  // Cooldown check
  const lastAttempt = cellCooldowns.get(cellId) || 0;
  if (Date.now() - lastAttempt < DISCOVERY_COOLDOWN_MS) return [];

  cellCooldowns.set(cellId, Date.now());

  // Perform discovery
  console.log(`🔍 Discovering H3 cell ${cellId}...`);
  const newCastles = await discoverCell(cellId);

  // Mark as discovered regardless of results
  discoveredCells.add(cellId);

  return newCastles;
}

/**
 * Query OSM for landmarks within an H3 cell and create castle documents.
 * @param {string} cellId - H3 cell index at RES_DISCOVERY
 * @returns {Promise<Array<Object>>} Array of newly created castle objects
 */
async function discoverCell(cellId) {
  // Get cell boundary for Overpass query
  const boundary = h3ToBoundary(cellId);
  const center = h3ToLatLng(cellId);

  // Calculate bounding box from boundary vertices
  const lats = boundary.map(p => p.lat);
  const lngs = boundary.map(p => p.lng);
  const bbox = {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };

  // Build Overpass query for landmarks
  const tagFilters = LANDMARK_TAGS.map(tag => {
    const [key, value] = tag.split('=');
    return `node["${key}"="${value}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});\n` +
           `way["${key}"="${value}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});\n` +
           `relation["${key}"="${value}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});`;
  }).join('\n');

  const query = `[out:json][timeout:15];\n(\n${tagFilters}\n);\nout center 20;`;

  try {
    const data = await OverpassService.fetchJSON(query);
    if (!data || !data.elements || data.elements.length === 0) {
      console.log(`📍 No landmarks found in cell ${cellId}`);
      return [];
    }

    // Filter and deduplicate
    const landmarks = data.elements
      .filter(el => {
        // Must have a name
        const name = el.tags?.name || el.tags?.['name:en'];
        if (!name) return false;
        // Must have coordinates (node → el.lat/lon, way/relation → el.center)
        const lat = el.lat || el.center?.lat;
        const lng = el.lon || el.center?.lon;
        return lat && lng;
      })
      .slice(0, MAX_CASTLES_PER_CELL);

    const newCastles = [];

    for (const landmark of landmarks) {
      const lmLat = landmark.lat || landmark.center.lat;
      const lmLng = landmark.lon || landmark.center.lon;
      const lmName = landmark.tags.name || landmark.tags['name:en'] || 'Unknown Landmark';

      // Check if castle already exists near this location
      const duplicate = discoveredCastles.find(c => {
        const dist = _quickDist(c.lat, c.lng, lmLat, lmLng);
        return dist < 100; // 100m dedup radius
      });

      if (duplicate) continue;

      // Create castle object
      const castle = {
        id: `castle_${cellId}_${landmark.id}`,
        name: lmName,
        lat: lmLat,
        lng: lmLng,
        h3Cell: cellId,
        osmId: landmark.id,
        osmType: landmark.type,
        osmTags: landmark.tags,
        powerMultiplier: 1.0, // Default power, grows as players invest
        ownerId: null,
        ownerName: null,
        discoveredAt: new Date().toISOString(),
        type: _classifyLandmark(landmark.tags),
      };

      // Persist to Firestore
      if (_saveCastleFn) {
        try {
          await _saveCastleFn(castle);
        } catch (e) {
          console.warn(`⚠️ Failed to save castle ${castle.name}:`, e.message);
          continue;
        }
      }

      discoveredCastles.push(castle);
      newCastles.push(castle);

      // Notify listeners
      if (_onCastleDiscovered) _onCastleDiscovered(castle);

      console.log(`🏰 Discovered: ${castle.name} at ${lmLat.toFixed(4)}, ${lmLng.toFixed(4)}`);
    }

    return newCastles;

  } catch (e) {
    console.warn(`❌ Discovery failed for cell ${cellId}:`, e.message);
    return [];
  }
}

// ── Castle Classification ───────────────────────────────────────

/**
 * Classify a landmark by its OSM tags into a game castle type.
 * @param {Object} tags - OSM tags from the Overpass element
 * @returns {string} One of: 'fortress', 'ruins', 'monument', 'temple', 'landmark', 'outpost'
 */
function _classifyLandmark(tags) {
  if (tags.historic === 'castle' || tags.historic === 'fort' || tags.historic === 'citadel') return 'fortress';
  if (tags.historic === 'ruins') return 'ruins';
  if (tags.historic === 'monument' || tags.historic === 'memorial') return 'monument';
  if (tags.building === 'cathedral' || tags.building === 'church' || tags.amenity === 'place_of_worship') return 'temple';
  if (tags.tourism === 'attraction') return 'landmark';
  return 'outpost';
}

// ── Quick Distance (for dedup, not high precision) ──────────────

/**
 * Haversine distance in meters between two lat/lng points.
 * Used for deduplication — precision is sufficient, performance is prioritized.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} Distance in meters
 */
function _quickDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Public Accessors ────────────────────────────────────────────

/**
 * Get all discovered castles (for territory-math and rendering).
 * @returns {Array<Object>}
 */
export function getDiscoveredCastles() {
  return discoveredCastles;
}

/**
 * Get discovered cells set (for persistence/sync).
 * @returns {Set<string>}
 */
export function getDiscoveredCells() {
  return discoveredCells;
}

/**
 * Add a castle to the in-memory list (e.g., loaded from Firestore at startup).
 * Skips duplicates by castle ID.
 * @param {Object} castle
 */
export function addCastle(castle) {
  const exists = discoveredCastles.find(c => c.id === castle.id);
  if (!exists) discoveredCastles.push(castle);
}

/**
 * Set the full castles array (bulk load from Firestore).
 * @param {Array<Object>} castles
 */
export function setCastles(castles) {
  discoveredCastles = castles || [];
}
