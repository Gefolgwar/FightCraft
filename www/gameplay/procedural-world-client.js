/**
 * Procedural World Client
 *
 * Integrates recipe loading, procedural generation, city data,
 * and defeated state into a single player-facing API.
 *
 * This module replaces fetchSpawnedObjectsOnce() for recipe-mode players.
 *
 * Startup cost:
 *   1 Firestore read  — loadActiveRecipe()
 *   1 HTTP fetch       — loadWorldCities() (CDN-cached JSON)
 *
 * Runtime cost per viewport update: 0 Firestore reads (all procedural).
 * Per monster defeat: 1 Firestore write (via SyncEngine).
 */

import { loadActiveRecipe } from "./snapshot-recipe.js";
import { loadWorldCities, getWorldCities } from "./world-cities-loader.js";
import {
  getObjectsForViewport,
  getObjectById,
  generateCitadelsForCity,
  findCityForCell,
  calculateCityObjectCount,
  clearCellCityCache,
} from "../core/procedural-engine-v2.js";
import {
  getViewportCells,
  getCellsInRadius,
  ensureH3Loaded,
} from "../core/h3-spatial.js";
import { SyncEngine } from "./sync-engine.js";

// ── Module State ─────────────────────────────────────────
let _recipe = null;
let _cities = [];
let _initialized = false;
let _lastViewportCells = [];
/** @type {Map<string, Object>} templateId → full template data */
let _templateCache = new Map();

// ── Constants ────────────────────────────────────────────

/** Approximate H3 cell area (km²) by resolution — for totalCells estimation. */
const H3_CELL_AREA_KM2 = {
  7: 5.161,
  8: 0.737,
  9: 0.105,
  10: 0.015,
};

/** Template types to pre-load from IndexedDB. */
const TEMPLATE_TYPES = ["monster", "shop", "vault", "castle", "citadel"];

/** Object types generated at viewport level (citadels are city-level). */
const VIEWPORT_OBJECT_TYPES = ["monster", "shop", "vault", "castle"];

// ── Internal Helpers ─────────────────────────────────────

/**
 * Deterministically estimate the total number of H3 cells covering a city.
 * Uses the same population-scaled radius formula as generateCitadelsForCity()
 * in procedural-engine-v2.js (sqrt(pop / 500), clamped [5, 50] km).
 *
 * MUST be identical across all clients for deterministic generation.
 *
 * @param {Object} city - City with a `population` field
 * @param {number} h3Resolution - H3 resolution from the recipe
 * @returns {number} Estimated cell count (>= 1)
 */
function estimateCityTotalCells(city, h3Resolution) {
  if (!city?.population || city.population <= 0) return 1;
  const radiusKm = Math.max(5, Math.min(50, Math.sqrt(city.population / 500)));
  const cellArea = H3_CELL_AREA_KM2[h3Resolution] || 0.737;
  return Math.max(1, Math.round((Math.PI * radiusKm * radiusKm) / cellArea));
}

/**
 * Build the cityContext object expected by the procedural engine.
 * @param {Object} city - City data
 * @param {number} h3Resolution - H3 resolution from the recipe
 * @returns {Object|null} { cityId, cityName, population, totalCells }
 */
function buildCityContext(city, h3Resolution) {
  if (!city) return null;
  return {
    cityId: city.id,
    cityName: city.name,
    population: city.population,
    totalCells: estimateCityTotalCells(city, h3Resolution),
  };
}

/**
 * Enrich a procedural object stub with cached template data.
 * The engine stores only templateId; this merges name, icon, stats, etc.
 *
 * Merge order: template fields as base, procedural fields override.
 * This ensures id, lat, lng, type, procedural always win.
 *
 * @param {Object} obj - Procedural object from the engine
 * @returns {Object} Enriched object
 */
function enrichWithTemplate(obj) {
  const template = _templateCache.get(obj.templateId);
  if (!template) return obj;
  return {
    ...template,
    ...obj,
    templateData: template,
  };
}

/**
 * Load all templates from SyncEngine's IndexedDB cache into _templateCache.
 * Called once during init and again on recipe refresh.
 */
async function loadTemplateCache() {
  _templateCache.clear();
  for (const type of TEMPLATE_TYPES) {
    try {
      const templates = await SyncEngine.getTemplatesFromIDB(type);
      for (const t of templates) {
        _templateCache.set(t.id, t);
      }
    } catch (e) {
      console.warn(
        `[procedural-world-client] Failed to load ${type} templates:`,
        e,
      );
    }
  }
  console.log(
    `[procedural-world-client] Template cache: ${_templateCache.size} entries`,
  );
}

/**
 * Extract the H3 index embedded in a procedural object ID.
 * ID format: proc_{type}_{h3Index}_{localIndex}
 * @param {string} objectId
 * @returns {string|null}
 */
function extractH3FromObjectId(objectId) {
  if (!objectId || typeof objectId !== "string") return null;
  const parts = objectId.split("_");
  // Minimum valid: ['proc', type, h3Index, localIndex]
  if (parts[0] !== "proc" || parts.length < 4) return null;
  // H3 index is everything between type and the last segment
  return parts.slice(2, -1).join("_");
}

// ── Public API ───────────────────────────────────────────

/**
 * Initialize the procedural world client.
 * Should be called once during app startup, after Firebase auth is ready.
 *
 * Steps:
 *   1. Load H3 library (CDN, cached after first load)
 *   2. Load recipe + cities in parallel (1 Firestore read + 1 CDN fetch)
 *   3. Initialize SyncEngine for defeated-object tracking
 *   4. Pre-load template cache from IndexedDB
 *
 * @returns {Promise<{recipe: Object|null, cities: Array}>}
 */
export async function initProceduralWorld() {
  if (_initialized) {
    console.log("[procedural-world-client] Already initialized");
    return { recipe: _recipe, cities: _cities };
  }

  console.log("[procedural-world-client] Initializing...");

  // 1. H3 must be ready before any spatial operations
  await ensureH3Loaded();

  // 2. Recipe + cities load in parallel (independent I/O)
  const [recipe, cities] = await Promise.all([
    loadActiveRecipe(),
    loadWorldCities(),
  ]);

  if (!recipe) {
    console.warn(
      "[procedural-world-client] No active recipe — procedural world unavailable",
    );
    return { recipe: null, cities };
  }

  // 3. SyncEngine for IndexedDB defeated-objects store
  if (!SyncEngine.db) {
    await SyncEngine.init();
  }

  // 4. Template cache (reads only from local IndexedDB — no Firestore cost)
  await loadTemplateCache();

  // 5. Commit module state
  _recipe = recipe;
  _cities = cities;
  _initialized = true;

  console.log(
    `[procedural-world-client] Ready — recipe v${recipe.version}, ` +
      `${cities.length} cities, seed ${recipe.seed}, ` +
      `H3 res ${recipe.h3Resolution}`,
  );

  return { recipe, cities };
}

/**
 * Check if the procedural world is initialized and has an active recipe.
 * @returns {boolean}
 */
export function isProceduralWorldActive() {
  return _initialized && _recipe !== null;
}

/**
 * Get the active recipe.
 * @returns {Object|null}
 */
export function getActiveRecipe() {
  return _recipe;
}

/**
 * Get objects visible in the current map viewport.
 * This is the main function called on map move/zoom.
 * Cost: 0 Firestore reads (procedural generation + IndexedDB defeated check).
 *
 * Internally, H3 cells are grouped by nearest city so each group gets the
 * correct density context. Results are enriched with cached template data.
 *
 * @param {{north: number, south: number, east: number, west: number}} bounds
 * @param {Object} [options]
 * @param {string[]} [options.types] - Object types (default: monster, shop, vault, castle)
 * @param {number} [options.resolution] - H3 resolution (default: from recipe)
 * @returns {Promise<Array<Object>>} Enriched objects in viewport
 */
export async function getViewportObjects(bounds, options = {}) {
  if (!_initialized || !_recipe) return [];

  const types = options.types || VIEWPORT_OBJECT_TYPES;
  const resolution = options.resolution || _recipe.h3Resolution;

  // 1. H3 cells covering the viewport rectangle
  const h3Cells = getViewportCells(bounds, resolution);
  if (h3Cells.length === 0) return [];

  _lastViewportCells = h3Cells;

  // 2. Defeated IDs — IndexedDB first, Firestore fallback (inside SyncEngine)
  let defeatedIds;
  try {
    defeatedIds = await SyncEngine.getDefeatedMonstersForCells(h3Cells);
  } catch (e) {
    console.warn("[procedural-world-client] Defeated state unavailable:", e);
    defeatedIds = new Set();
  }

  // 3. Group viewport cells by their nearest city.
  //    Each group needs its own cityContext for correct density math.
  const cellsByCity = new Map(); // cityId -> { city, cells: string[] }

  for (const h3Index of h3Cells) {
    const city = findCityForCell(h3Index, _cities);
    if (!city) continue;

    const key = city.id;
    if (!cellsByCity.has(key)) {
      cellsByCity.set(key, { city, cells: [] });
    }
    cellsByCity.get(key).cells.push(h3Index);
  }

  // 4. Generate objects per city group, filter defeated, enrich with templates
  const results = [];

  for (const { city, cells } of cellsByCity.values()) {
    const cityCtx = buildCityContext(city, resolution);
    const objects = getObjectsForViewport(
      cells,
      _recipe,
      cityCtx,
      defeatedIds,
      types,
    );
    for (const obj of objects) {
      results.push(enrichWithTemplate(obj));
    }
  }

  return results;
}

/**
 * Get citadels near a position.
 * Iterates nearby cities (within radiusKm) and generates citadels for each.
 *
 * @param {number} lat - Player latitude
 * @param {number} lng - Player longitude
 * @param {number} [radiusKm=50] - Search radius in kilometres
 * @returns {Array<Object>} Enriched citadel objects
 */
export function getCitadelsNearby(lat, lng, radiusKm = 50) {
  if (!_initialized || !_recipe) return [];

  const results = [];
  const cosLat = Math.cos((lat * Math.PI) / 180);

  for (const city of _cities) {
    // Approximate great-circle distance (sufficient for filtering)
    const dlat = (city.lat - lat) * 111;
    const dlng = (city.lng - lng) * 111 * cosLat;
    const distKm = Math.sqrt(dlat * dlat + dlng * dlng);

    if (distKm <= radiusKm) {
      const citadels = generateCitadelsForCity(city, _recipe);
      for (const c of citadels) {
        results.push(enrichWithTemplate(c));
      }
    }
  }

  return results;
}

/**
 * Look up a single object by its procedural ID.
 * Used for combat reconnection — no Firestore read needed.
 * The ID encodes everything required for regeneration.
 *
 * @param {string} objectId - e.g. "proc_monster_882a1070adfffff_3"
 * @returns {Object|null} Enriched object, or null if ID is invalid
 */
export function lookupObject(objectId) {
  if (!_recipe || !objectId) return null;

  // Resolve city context from the H3 cell embedded in the ID
  const h3Index = extractH3FromObjectId(objectId);
  const city = h3Index ? findCityForCell(h3Index, _cities) : null;
  const cityCtx = city
    ? buildCityContext(city, _recipe.h3Resolution)
    : undefined;

  const obj = getObjectById(objectId, _recipe, cityCtx);
  return obj ? enrichWithTemplate(obj) : null;
}

/**
 * Record a defeated object (monster killed, castle captured, etc.)
 * Writes to both IndexedDB (immediate local state) and Firestore (cross-player).
 *
 * @param {string} objectId - Procedural object ID
 * @param {string} defeatedByUid - Player UID
 * @param {number} [respawnMs=1800000] - Respawn time in ms (default 30 min).
 *   Note: SyncEngine currently uses a fixed 1hr cooldown internally.
 *   The respawnMs parameter is reserved for future SyncEngine extension.
 * @returns {Promise<void>}
 */
export async function recordDefeat(
  objectId,
  defeatedByUid,
  respawnMs = 30 * 60 * 1000,
) {
  const h3Index = extractH3FromObjectId(objectId);
  if (!h3Index) {
    console.warn(
      `[procedural-world-client] Cannot extract H3 from ID: ${objectId}`,
    );
    return;
  }

  await SyncEngine.recordDefeatedMonster(objectId, h3Index, defeatedByUid);
}

/**
 * Force reload the recipe from Firestore.
 * Called when world_metadata changes (e.g. admin activated a new recipe).
 *
 * Limitation: loadActiveRecipe() in snapshot-recipe.js has a module-level
 * in-memory cache (_activeRecipeCache) that cannot be cleared externally.
 * If the recipe actually changed in Firestore, a page reload is required
 * until snapshot-recipe.js exposes a cache-invalidation function.
 *
 * @returns {Promise<Object|null>} Updated recipe (may be stale — see above)
 */
export async function refreshRecipe() {
  console.log("[procedural-world-client] Refreshing recipe...");

  _recipe = null;
  clearCellCityCache();

  const recipe = await loadActiveRecipe();
  if (recipe) {
    _recipe = recipe;
    console.log(
      `[procedural-world-client] Recipe refreshed: v${recipe.version}, seed ${recipe.seed}`,
    );
  } else {
    console.warn("[procedural-world-client] Recipe refresh returned null");
  }

  // Reload templates in case the admin changed them alongside the recipe
  await loadTemplateCache();

  return _recipe;
}

/**
 * Get world statistics for the current recipe.
 * Useful for admin dashboards and debugging.
 *
 * @returns {Object|null} Stats object, or null if not initialized
 */
export function getWorldStats() {
  if (!_recipe) return null;

  const objectTypes = ["monster", "shop", "vault", "castle", "citadel"];

  const perType = {};
  for (const type of objectTypes) {
    let total = 0;
    for (const city of _cities) {
      total += calculateCityObjectCount(city, _recipe, type);
    }
    perType[type] = total;
  }

  const perCity = _cities.map((city) => {
    const entry = {
      cityId: city.id,
      cityName: city.name,
      population: city.population,
    };
    for (const type of objectTypes) {
      entry[type] = calculateCityObjectCount(city, _recipe, type);
    }
    return entry;
  });

  return {
    recipeSeed: _recipe.seed,
    recipeVersion: _recipe.version,
    h3Resolution: _recipe.h3Resolution,
    cityCount: _cities.length,
    templateCount: _templateCache.size,
    perType,
    perCity,
  };
}
