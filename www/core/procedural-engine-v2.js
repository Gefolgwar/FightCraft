// ==================== PROCEDURAL ENGINE V2 ====================
// Recipe-driven deterministic generation for ALL object types.
// Extends the V1 pattern (PRNG + H3 grid) to support monsters, shops,
// vaults, castles, and citadels via a "recipe" config object.
//
// Design principles:
//   1. ALL functions are PURE — no DOM, no Firebase, no side effects.
//   2. The engine stores only templateId; the UI layer merges template data.
//   3. combineSeed() ensures different recipes produce different worlds.
//   4. PRNG functions are copied from v1 (no cross-module import) for independence.

import {
  h3ToLatLng,
  latLngToH3,
  getCellsInRadius,
  H3_RES_CITADEL,
} from "./h3-spatial.js";

// ==================== CONSTANTS ====================

/** Per-type seed salts — ensures each object type gets an independent RNG stream per cell. */
const TYPE_SALTS = {
  monster: 0x00000000,
  shop: 0x9e3779b9,
  vault: 0x517cc1b7,
  castle: 0x6c62272e,
  citadel: 0x2545f491,
};

/** Minimum object counts per city (population > 0). */
const MIN_COUNTS = {
  monster: 0,
  shop: 0,
  vault: 0,
  castle: 0,
  citadel: 1,
};

/** Default object types for viewport generation (citadels handled separately). */
const DEFAULT_VIEWPORT_TYPES = ["monster", "shop", "vault", "castle"];

/** Prime multiplier spacing sub-seeds apart for per-object determinism. */
const SUB_SEED_PRIME = 7919;

/** Max lat/lng jitter from H3 cell center (~220 m in each direction). */
const POSITION_JITTER = 0.004;

// ==================== PRNG: Mulberry32 ====================

/**
 * Mulberry32 — fast, high-quality 32-bit PRNG.
 * Returns a function that produces deterministic floats in [0, 1).
 * @param {number} seed - 32-bit integer seed
 * @returns {function(): number} RNG function returning [0, 1)
 */
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================== SEED GENERATION ====================

/**
 * FNV-1a hash of an H3 index string → deterministic 32-bit unsigned integer.
 * @param {string} h3Index - H3 cell index string
 * @returns {number} 32-bit unsigned integer seed
 */
export function getWorldSeed(h3Index) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < h3Index.length; i++) {
    hash ^= h3Index.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Combine a recipe seed with a cell-derived seed.
 * Uses xorshift-style bit mixing (Murmur3 finalizer) so that different
 * recipes produce completely different worlds for the same H3 cell.
 * @param {number} baseSeed - Recipe-level seed
 * @param {number} h3Seed  - Cell-derived seed (from getWorldSeed)
 * @returns {number} 32-bit unsigned integer
 */
export function combineSeed(baseSeed, h3Seed) {
  let combined = (baseSeed ^ h3Seed) >>> 0;
  combined = Math.imul(combined ^ (combined >>> 16), 0x45d9f3b);
  combined = Math.imul(combined ^ (combined >>> 13), 0x45d9f3b);
  return (combined ^ (combined >>> 16)) >>> 0;
}

// ==================== TEMPLATE SELECTION ====================

/**
 * Pick a template from a weighted list, deterministically.
 * @param {Array<{templateId: string, weight: number}>} templates - Weighted entries
 * @param {function(): number} rng - Seeded RNG function
 * @returns {Object|null} Selected template entry, or null if list is empty
 */
export function pickWeightedTemplate(templates, rng) {
  if (!templates || templates.length === 0) return null;

  const totalWeight = templates.reduce((sum, t) => sum + (t.weight || 1), 0);
  let roll = rng() * totalWeight;

  for (const template of templates) {
    roll -= template.weight || 1;
    if (roll <= 0) return template;
  }

  // Floating-point safety fallback
  return templates[templates.length - 1];
}

// ==================== DENSITY CALCULATION ====================

/**
 * Calculate how many objects of a type a city should contain.
 *   count = max(minCount, round(population / densityRatio))
 *
 * Returns 0 for cities with zero or negative population.
 *
 * @param {Object} city - City data with a `population` field
 * @param {Object} recipe - Recipe config with `densityRatios`
 * @param {string} objectType - 'monster' | 'shop' | 'vault' | 'castle' | 'citadel'
 * @returns {number} Total count for the city
 */
export function calculateCityObjectCount(city, recipe, objectType) {
  const population = city?.population;
  if (!population || population <= 0) return 0;

  const ratio = recipe?.densityRatios?.[objectType];
  if (!ratio || ratio <= 0) return 0;

  const count = Math.round(population / ratio);
  const minCount = MIN_COUNTS[objectType] ?? 0;
  return Math.max(minCount, count);
}

/**
 * Distribute a city's total object count across its H3 cells.
 * Uses the largest-remainder method for integer distribution with
 * deterministic random weights so every client gets identical results.
 *
 * @param {number} totalCount - Total objects for the city
 * @param {string[]} cityCells - H3 cells belonging to this city
 * @param {number} seed - Recipe seed (for deterministic weighting)
 * @returns {Map<string, number>} Cell index → object count
 */
export function distributeObjectsAcrossCells(totalCount, cityCells, seed) {
  const distribution = new Map();
  if (!cityCells || cityCells.length === 0 || totalCount <= 0)
    return distribution;

  const rng = mulberry32(seed);

  // Assign deterministic random weights (biased away from zero)
  const weights = cityCells.map(() => rng() + 0.1);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  // Proportional shares
  const shares = weights.map((w) => (w / totalWeight) * totalCount);

  // Floor-allocate
  const baseCounts = shares.map((s) => Math.floor(s));
  let allocated = baseCounts.reduce((sum, c) => sum + c, 0);
  const remaining = totalCount - allocated;

  // Largest-remainder: award extras to cells with the biggest fractional part
  const fractionals = cityCells.map((_, i) => ({
    index: i,
    frac: shares[i] - baseCounts[i],
  }));
  fractionals.sort((a, b) => b.frac - a.frac);

  for (let j = 0; j < remaining; j++) {
    baseCounts[fractionals[j].index]++;
  }

  // Build the map (only include cells with count > 0)
  for (let i = 0; i < cityCells.length; i++) {
    if (baseCounts[i] > 0) {
      distribution.set(cityCells[i], baseCounts[i]);
    }
  }

  return distribution;
}

// ==================== CITY-CELL MAPPING ====================

/** Internal cache: h3Index → nearest city. Cleared via clearCellCityCache(). */
const _cellCityCache = new Map();

/**
 * Find which city a given H3 cell belongs to (nearest by squared Euclidean
 * distance on lat/lng — sufficient for same-continent comparisons).
 * Results are cached internally for repeat lookups.
 *
 * @param {string} h3Index - H3 cell index
 * @param {Array<{id: string, name: string, lat: number, lng: number, population: number}>} cities
 * @returns {Object|null} Nearest city, or null if no cities provided
 */
export function findCityForCell(h3Index, cities) {
  if (!cities || cities.length === 0) return null;

  if (_cellCityCache.has(h3Index)) return _cellCityCache.get(h3Index);

  const center = h3ToLatLng(h3Index);
  let nearest = null;
  let minDist = Infinity;

  for (const city of cities) {
    const dlat = center.lat - city.lat;
    const dlng = center.lng - city.lng;
    const distSq = dlat * dlat + dlng * dlng;
    if (distSq < minDist) {
      minDist = distSq;
      nearest = city;
    }
  }

  _cellCityCache.set(h3Index, nearest);
  return nearest;
}

/**
 * Clear the internal cell → city cache.
 * Call this if the cities array changes at runtime.
 */
export function clearCellCityCache() {
  _cellCityCache.clear();
}

// ==================== CORE GENERATION ====================

/**
 * Generate objects of a given type for a single H3 cell.
 * Deterministic: same recipe + h3Index always produces identical objects.
 *
 * Per-cell count is derived stochastically from the city-wide density:
 *   avgPerCell = cityTotal / totalCells
 *   count = floor(avg) + (rng() < fractional part ? 1 : 0)
 *
 * Each object gets an independent sub-seed (typeSeed + i * 7919) so that
 * adding/removing one object doesn't cascade changes to its neighbours.
 *
 * @param {string} h3Index - H3 cell index
 * @param {Object} recipe - Recipe config
 * @param {string} objectType - 'monster' | 'shop' | 'vault' | 'castle' | 'citadel'
 * @param {Object} cityContext - { cityId, cityName, population, totalCells }
 * @returns {Array<Object>} Generated objects (may be empty)
 */
export function generateObjectsForCell(
  h3Index,
  recipe,
  objectType,
  cityContext,
) {
  if (!h3Index || !recipe || !objectType || !cityContext) return [];

  // ── Seed derivation ──────────────────────────────────────────
  const h3Seed = getWorldSeed(h3Index);
  const cellSeed = combineSeed(recipe.seed || 0, h3Seed);
  const typeSalt = TYPE_SALTS[objectType] ?? 0;
  const typeSeed = combineSeed(cellSeed, typeSalt);
  const rng = mulberry32(typeSeed);

  // ── Per-cell count ───────────────────────────────────────────
  const totalCount = calculateCityObjectCount(
    { population: cityContext.population },
    recipe,
    objectType,
  );

  const totalCells = Math.max(1, cityContext.totalCells || 1);
  const avgPerCell = totalCount / totalCells;
  const intPart = Math.floor(avgPerCell);
  const fracPart = avgPerCell - intPart;
  const count = intPart + (rng() < fracPart ? 1 : 0);

  if (count <= 0) return [];

  // ── Cell center for position jitter ──────────────────────────
  const center = h3ToLatLng(h3Index);

  // ── Template list from recipe layers ─────────────────────────
  // Layer keys are plural: monsters, shops, vaults, castles, citadels
  const layerKey = objectType + "s";
  const templates = recipe.layers?.[layerKey]?.templates;

  // ── Generate objects ─────────────────────────────────────────
  const objects = [];
  for (let i = 0; i < count; i++) {
    // Independent sub-seed per object (stable under count changes elsewhere)
    const localRng = mulberry32(typeSeed + i * SUB_SEED_PRIME);

    // Deterministic position jitter within cell
    const latOffset = (localRng() - 0.5) * POSITION_JITTER;
    const lngOffset = (localRng() - 0.5) * POSITION_JITTER;

    // Template selection
    const selected = pickWeightedTemplate(templates, localRng);

    objects.push({
      id: `proc_${objectType}_${h3Index}_${i}`,
      type: objectType,
      templateId: selected?.templateId ?? `${objectType}_default`,
      h3Index,
      localIndex: i,
      lat: center.lat + latOffset,
      lng: center.lng + lngOffset,
      procedural: true,
      cityId: cityContext.cityId ?? null,
      seed: recipe.seed,
    });
  }

  return objects;
}

/**
 * Generate citadels for a city. Uses H3_RES_CITADEL (resolution 7, ~1.2 km edge, ~5 km2 zones).
 *
 * Count = max(1, round(city.population / recipe.densityRatios.citadel))
 * Candidate cells are gathered via getCellsInRadius around the city center,
 * shuffled deterministically, and the first `count` cells are selected.
 * Citadels sit exactly at H3 cell centres (no jitter).
 *
 * Radius scales with population to match real city sizes:
 *   Berlin (3.7M) -> ~19 km, Tokyo (13.5M) -> ~37 km, City 100k -> ~3 km
 *
 * @param {Object} city - { id, name, lat, lng, population }
 * @param {Object} recipe - Recipe config
 * @returns {Array<Object>} Citadel objects
 */
export function generateCitadelsForCity(city, recipe) {
  if (!city || !city.population || city.population <= 0) return [];

  const count = calculateCityObjectCount(city, recipe, "citadel");
  if (count <= 0) return [];

  // City-level seed: recipe seed mixed with the city's identity
  const cityHash = getWorldSeed(city.id || city.name || "city");
  const citySeed = combineSeed(recipe.seed || 0, cityHash);
  const rng = mulberry32(citySeed);

  // Gather candidate cells at citadel resolution.
  // Radius scales with population to match real city footprints.
  // Berlin (3.7M) -> 19 km, Tokyo (13.5M) -> 37 km, City 100k -> 3.2 km
  const radiusKm = Math.max(
    2,
    Math.min(40, Math.sqrt(city.population / 10000)),
  );
  const candidateCells = getCellsInRadius(
    city.lat,
    city.lng,
    radiusKm,
    H3_RES_CITADEL,
  );

  if (candidateCells.length === 0) return [];

  // Fisher-Yates shuffle (deterministic via seeded RNG)
  const shuffled = [...candidateCells];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(count, shuffled.length));

  // Optional citadels layer in recipe (forward-compatible)
  const citadelTemplates = recipe.layers?.citadels?.templates;

  return selected.map((h3Index, i) => {
    const center = h3ToLatLng(h3Index);
    const localRng = mulberry32(combineSeed(citySeed, i * SUB_SEED_PRIME));
    const template = pickWeightedTemplate(citadelTemplates, localRng);

    return {
      id: `proc_citadel_${h3Index}_${i}`,
      type: "citadel",
      templateId: template?.templateId ?? "citadel_default",
      h3Index,
      localIndex: i,
      lat: center.lat,
      lng: center.lng,
      procedural: true,
      cityId: city.id ?? null,
      cityName: city.name ?? null,
      seed: recipe.seed,
    };
  });
}

// ==================== VIEWPORT AGGREGATION ====================

/**
 * Get all objects for visible H3 cells, filtering out defeated/captured ones.
 * This is the primary function called by the map renderer.
 *
 * Citadels use a different H3 resolution and are generated via
 * generateCitadelsForCity(); they are skipped here even if included in
 * objectTypes.  Call generateCitadelsForCity() separately for citadels.
 *
 * @param {string[]} h3Cells - H3 cells in viewport
 * @param {Object} recipe - Active recipe
 * @param {Object} cityContext - { cityId, cityName, population, totalCells }
 * @param {Set<string>} [defeatedIds=new Set()] - IDs of defeated/captured objects
 * @param {string[]} [objectTypes] - Types to generate (default: monster, shop, vault, castle)
 * @returns {Array<Object>} All non-defeated objects across the given cells
 */
export function getObjectsForViewport(
  h3Cells,
  recipe,
  cityContext,
  defeatedIds = new Set(),
  objectTypes = DEFAULT_VIEWPORT_TYPES,
) {
  const results = [];

  for (const objectType of objectTypes) {
    // Citadels are city-level, not cell-level — skip silently
    if (objectType === "citadel") continue;

    for (const h3Index of h3Cells) {
      const cellObjects = generateObjectsForCell(
        h3Index,
        recipe,
        objectType,
        cityContext,
      );
      for (const obj of cellObjects) {
        if (!defeatedIds.has(obj.id)) {
          results.push(obj);
        }
      }
    }
  }

  return results;
}

// ==================== SINGLE OBJECT LOOKUP ====================

/**
 * Retrieve a single object by its deterministic ID.
 * The ID encodes type, H3 cell, and local index — everything needed to
 * regenerate the object without any database lookup.
 *
 * ID format: `proc_{type}_{h3Index}_{localIndex}`
 *
 * For non-citadel types the object is regenerated by calling
 * generateObjectsForCell() and indexing into the result.
 * For citadels a minimal reconstruction is returned from the H3 cell centre
 * (since full regeneration requires the city list).
 *
 * @param {string} objectId - e.g. "proc_monster_882a1070adfffff_3"
 * @param {Object} recipe - Active recipe
 * @param {Object} [cityContext] - City info (uses sensible defaults if omitted)
 * @returns {Object|null} The regenerated object, or null if the ID is malformed
 */
export function getObjectById(objectId, recipe, cityContext) {
  if (!objectId || typeof objectId !== "string") return null;

  // ── Parse ID ─────────────────────────────────────────────────
  const parts = objectId.split("_");
  // Minimum valid: ['proc', type, h3Index, localIndex]
  if (parts[0] !== "proc" || parts.length < 4) return null;

  const objectType = parts[1];
  // H3 index is everything between type and the last segment
  const h3Index = parts.slice(2, -1).join("_");
  const localIndex = parseInt(parts[parts.length - 1], 10);

  if (isNaN(localIndex) || localIndex < 0) return null;

  // ── Citadel fast-path ────────────────────────────────────────
  // Citadels are city-level; without the full city list we can only
  // reconstruct a minimal object from the encoded H3 cell centre.
  if (objectType === "citadel") {
    const center = h3ToLatLng(h3Index);
    return {
      id: objectId,
      type: "citadel",
      templateId: "citadel_default",
      h3Index,
      localIndex,
      lat: center.lat,
      lng: center.lng,
      procedural: true,
      cityId: cityContext?.cityId ?? null,
      seed: recipe?.seed,
    };
  }

  // ── Standard regeneration ────────────────────────────────────
  const ctx = cityContext || {
    cityId: "unknown",
    cityName: "Unknown",
    population: 1_000_000,
    totalCells: 1000,
  };

  const cellObjects = generateObjectsForCell(h3Index, recipe, objectType, ctx);
  return cellObjects[localIndex] ?? null;
}
