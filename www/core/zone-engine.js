// ==================== ZONE ENGINE ====================
// Generates continuous Voronoi zones within city boundaries.
// Each zone = cluster of H3 cells assigned to one citadel.
// No gaps, no overlaps — every H3 cell inside the boundary belongs to exactly one zone.
//
// Architecture:
//   1. Load city boundary polygon (from world_cities_boundaries.json)
//   2. Enumerate all H3 res-7 cells inside boundary
//   3. Place citadels (count based on population) inside boundary
//   4. Assign each cell to nearest citadel (Voronoi partitioning)
//   5. Return zone objects with id, name, citadel, cells[]

import {
  generateCitadelsForCity,
  calculateCityObjectCount,
  mulberry32,
  getWorldSeed,
  combineSeed,
  pickWeightedTemplate,
} from "./procedural-engine-v2.js";

// ── Constants ────────────────────────────────────────────────────
const ZONE_H3_RESOLUTION = 7; // ~5 km² per cell, neighborhood-level

// ── Boundary Helpers ─────────────────────────────────────────────

/**
 * Point-in-polygon test using ray casting algorithm.
 * @param {number} lng - Test point longitude
 * @param {number} lat - Test point latitude
 * @param {Array<[number, number]>} polygon - Ring of [lng, lat] pairs
 * @returns {boolean}
 */
function pointInPolygon(lng, lat, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Get all H3 cells at given resolution that fall inside a boundary polygon.
 * @param {Array<[number, number]>} boundaryCoords - Ring of [lng, lat] pairs (GeoJSON format)
 * @param {number} [resolution=ZONE_H3_RESOLUTION]
 * @returns {string[]} Array of H3 cell indices
 */
export function getCellsInBoundary(boundaryCoords, resolution = ZONE_H3_RESOLUTION) {
  const h3 = window.h3;
  if (!h3 || !boundaryCoords || boundaryCoords.length < 3) return [];

  // Convert [lng, lat] (GeoJSON) to [lat, lng] (h3-js format)
  const h3Ring = boundaryCoords.map(([lng, lat]) => [lat, lng]);

  try {
    return h3.polygonToCells(h3Ring, resolution);
  } catch (e) {
    console.warn("getCellsInBoundary failed:", e.message);
    return [];
  }
}

/**
 * Filter citadels to only those inside a boundary polygon.
 * @param {Array} citadels - Citadel objects with lat/lng
 * @param {Array<[number, number]>} boundaryCoords - Ring of [lng, lat] pairs
 * @returns {Array} Filtered citadels
 */
export function filterCitadelsInBoundary(citadels, boundaryCoords) {
  if (!citadels || !boundaryCoords) return [];
  return citadels.filter(c => pointInPolygon(c.lng, c.lat, boundaryCoords));
}

/**
 * Generate citadels that are guaranteed to be inside the city boundary.
 * Uses the existing generateCitadelsForCity and then filters.
 * If too few citadels land inside, generates more with a wider radius.
 *
 * @param {Object} city - { id, name, lat, lng, population }
 * @param {Array<[number, number]>} boundaryCoords - Ring of [lng, lat] pairs
 * @param {Object} recipe - Recipe config
 * @returns {Array} Citadel objects inside boundary
 */
export function generateCitadelsInBoundary(city, boundaryCoords, recipe) {
  if (!city || !boundaryCoords || boundaryCoords.length < 3) return [];

  const targetCount = calculateCityObjectCount(city, recipe, "citadel");
  if (targetCount <= 0) return [];

  // Strategy: generate citadels with increasing radius until we have enough inside boundary
  const citadels = generateCitadelsForCity(city, recipe);
  const inside = filterCitadelsInBoundary(citadels, boundaryCoords);

  // If we got enough, great
  if (inside.length >= targetCount) {
    return inside.slice(0, targetCount);
  }

  // If not enough citadels landed inside, place them at H3 cell centers within boundary
  // This is a fallback: pick cells inside boundary, use them as citadel positions
  if (inside.length < Math.max(1, Math.floor(targetCount * 0.5))) {
    const h3 = window.h3;
    if (!h3) return inside;

    const boundaryCells = getCellsInBoundary(boundaryCoords);
    if (boundaryCells.length === 0) return inside;

    // Deterministic shuffle of boundary cells
    const cityHash = getWorldSeed(city.id || city.name || "city");
    const citySeed = combineSeed(recipe.seed || 0, cityHash);
    const rng = mulberry32(citySeed + 999); // different sub-seed to avoid collision

    const shuffled = [...boundaryCells];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Use existing inside citadels + fill remaining from shuffled cells
    const usedCells = new Set(inside.map(c => c.h3Index));
    const result = [...inside];
    const citadelTemplates = recipe.layers?.citadels?.templates;

    for (const cell of shuffled) {
      if (result.length >= targetCount) break;
      if (usedCells.has(cell)) continue;
      usedCells.add(cell);

      const [lat, lng] = h3.cellToLatLng(cell);
      const localRng = mulberry32(combineSeed(citySeed, result.length * 7919));
      const template = pickWeightedTemplate(citadelTemplates, localRng);

      result.push({
        id: `proc_citadel_${cell}_${result.length}`,
        type: "citadel",
        templateId: template?.templateId ?? "citadel_default",
        h3Index: cell,
        localIndex: result.length,
        lat,
        lng,
        procedural: true,
        cityId: city.id ?? null,
        cityName: city.name ?? null,
        seed: recipe.seed,
      });
    }

    return result;
  }

  return inside;
}

// ── Voronoi Assignment ───────────────────────────────────────────

/**
 * Assign each H3 cell to its nearest citadel (Voronoi partitioning).
 *
 * @param {string[]} cells - H3 cell indices (all cells within city boundary)
 * @param {Array} citadels - Citadel objects with lat/lng
 * @returns {Map<string, {citadel: Object, cells: string[]}>} citadelId → zone data
 */
export function assignCellsToZones(cells, citadels) {
  const h3 = window.h3;
  const zones = new Map();

  // Initialize zone entries
  for (const citadel of citadels) {
    zones.set(citadel.id, { citadel, cells: [] });
  }

  if (!h3 || citadels.length === 0) return zones;

  // Assign each cell to nearest citadel
  for (const cell of cells) {
    const [clat, clng] = h3.cellToLatLng(cell);
    let nearest = null;
    let minDist = Infinity;

    for (const c of citadels) {
      const dlat = clat - c.lat;
      const dlng = clng - c.lng;
      const d = dlat * dlat + dlng * dlng;
      if (d < minDist) {
        minDist = d;
        nearest = c;
      }
    }

    if (nearest) {
      zones.get(nearest.id).cells.push(cell);
    }
  }

  return zones;
}

// ── Zone Generation (Full Pipeline) ─────────────────────────────

/**
 * Generate complete Voronoi zones for a city.
 * This is the main entry point — combines boundary enumeration,
 * citadel placement, and Voronoi assignment.
 *
 * @param {Object} city - { id, name, lat, lng, population }
 * @param {Array<[number, number]>} boundaryCoords - Outer ring [lng, lat] pairs
 * @param {Object} recipe - Recipe config with seed, densityRatios, layers
 * @returns {{
 *   cityId: string,
 *   cityName: string,
 *   totalCells: number,
 *   zones: Array<{
 *     id: string,
 *     name: string,
 *     citadel: Object,
 *     cells: string[],
 *     areaKm2: number,
 *     color: string
 *   }>
 * }}
 */
export function generateZonesForCity(city, boundaryCoords, recipe) {
  if (!city || !boundaryCoords || boundaryCoords.length < 3) {
    return { cityId: city?.id, cityName: city?.name, totalCells: 0, zones: [] };
  }

  // 1. Get all H3 cells inside boundary
  const cells = getCellsInBoundary(boundaryCoords);
  if (cells.length === 0) {
    return { cityId: city.id, cityName: city.name, totalCells: 0, zones: [] };
  }

  // 2. Generate citadels inside boundary
  const citadels = generateCitadelsInBoundary(city, boundaryCoords, recipe);
  if (citadels.length === 0) {
    return { cityId: city.id, cityName: city.name, totalCells: cells.length, zones: [] };
  }

  // 3. Voronoi assignment
  const zoneMap = assignCellsToZones(cells, citadels);

  // 4. Build zone objects with names and colors
  const zones = [];
  let zoneIndex = 0;

  for (const [id, zone] of zoneMap) {
    if (zone.cells.length === 0) continue;
    zoneIndex++;

    // Golden angle hue for maximum color separation between adjacent zones
    const hue = (zoneIndex * 137.508) % 360;
    const color = `hsl(${Math.round(hue)}, 70%, 50%)`;

    zones.push({
      id: `zone_${city.id}_${zoneIndex}`,
      name: `${city.name} Zone ${zoneIndex}`,
      citadel: zone.citadel,
      cells: zone.cells,
      areaKm2: Math.round(zone.cells.length * 5.161), // H3 res-7 cell area
      color,
    });
  }

  return {
    cityId: city.id,
    cityName: city.name,
    totalCells: cells.length,
    zones,
  };
}

// ── GeoJSON Rendering ────────────────────────────────────────────

/**
 * Convert zones to a GeoJSON FeatureCollection for map rendering.
 * Each H3 cell in each zone becomes a Feature with zone metadata.
 *
 * @param {Array} zones - Zone objects from generateZonesForCity().zones
 * @returns {{ type: 'FeatureCollection', features: Array }}
 */
export function zonesToGeoJSON(zones) {
  const h3 = window.h3;
  if (!h3 || !zones) return { type: "FeatureCollection", features: [] };

  const features = [];

  for (const zone of zones) {
    for (const cell of zone.cells) {
      try {
        const boundary = h3.cellToBoundary(cell);
        const coords = boundary.map(([lat, lng]) => [lng, lat]);
        coords.push(coords[0]); // close ring

        features.push({
          type: "Feature",
          properties: {
            zoneId: zone.id,
            zoneName: zone.name,
            citadelId: zone.citadel.id,
            cityId: zone.citadel.cityId || null,
            color: zone.color,
            areaKm2: zone.areaKm2,
          },
          geometry: {
            type: "Polygon",
            coordinates: [coords],
          },
        });
      } catch (e) {
        // Skip invalid cells
      }
    }
  }

  return { type: "FeatureCollection", features };
}

// ── Boundary Data Loader ─────────────────────────────────────────

/** Cached boundaries data */
let _boundariesCache = null;

/**
 * Load city boundaries from the JSON file.
 * Caches the result for subsequent calls.
 *
 * @param {string} [url='../gameplay/world_cities_boundaries.json']
 * @returns {Promise<Object>} Map of cityId → boundary data
 */
export async function loadBoundaries(url = "../gameplay/world_cities_boundaries.json") {
  if (_boundariesCache) return _boundariesCache;

  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    _boundariesCache = await resp.json();
    return _boundariesCache;
  } catch (e) {
    console.warn("Failed to load city boundaries:", e.message);
    return {};
  }
}

/**
 * Get boundary coordinates for a specific city.
 * Returns the outer ring as [lng, lat] pairs, or null if not found.
 *
 * @param {string} cityId
 * @param {Object} boundaries - Loaded boundaries data
 * @returns {Array<[number, number]>|null}
 */
export function getCityBoundary(cityId, boundaries) {
  const entry = boundaries?.[cityId];
  if (!entry || !entry.boundary) return null;

  // boundary is stored as coordinates array from GeoJSON Polygon
  // For Polygon: [[ring0], [ring1_hole], ...] — we want ring0 (outer ring)
  const coords = entry.boundary;
  if (Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && typeof coords[0][0][0] === "number") {
    return coords[0]; // Polygon coordinates: [[ring]] → ring
  }
  if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
    return coords; // Already a flat ring
  }

  return null;
}
