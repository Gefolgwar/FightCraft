// ==================== PROCEDURAL WORLD RENDERER ====================
// Handles rendering the procedural world at any zoom level, from world
// overview to street level. Wraps procedural-engine-v2 with:
//   - Level of Detail (LOD): zoom-dependent object type filtering
//   - Multi-city viewport generation: groups H3 cells by nearest city
//   - Citadel caching: ~80K citadels generated once, reused until recipe changes
//   - Viewport deduplication: cache key avoids redundant regeneration

import {
  generateCitadelsForCity,
  generateCitadelsInBoundary,
  generateObjectsForCell,
  getObjectsForViewport,
  calculateCityObjectCount,
  findCityForCell,
  clearCellCityCache,
  combineSeed,
  getWorldSeed,
} from "./procedural-engine-v2.js";
import { getViewportCells, H3_RES_CITADEL } from "./h3-spatial.js";

// ── Caches ───────────────────────────────────────────────────────
let _allCitadels = null; // Generated once, reused
let _citadelRecipeSeed = null; // Track recipe changes
let _lastViewportKey = null; // Dedup redundant viewport renders
let _viewportObjects = []; // Last viewport generation result

// ── LOD: Zoom to Object Types ───────────────────────────────────

/**
 * Determine which object types to show at a given zoom level.
 *
 * LOD tiers:
 *   zoom 1-7  (world/continent) -> [] (only citadels, generated separately)
 *   zoom 8-10 (country)         -> castles
 *   zoom 11-13 (region)         -> castles + shops + vaults
 *   zoom 14+  (city/street)     -> everything (monsters + castles + shops + vaults)
 *
 * @param {number} zoom - Leaflet map zoom level
 * @returns {string[]} Array of object types to generate
 */
export function getTypesForZoom(zoom) {
  if (zoom <= 7) return [];
  if (zoom <= 10) return ["castle"];
  if (zoom <= 13) return ["castle", "shop", "vault"];
  return ["monster", "castle", "shop", "vault"];
}

// ── LOD: Zoom to H3 Resolution ─────────────────────────────────

/**
 * Determine the best H3 resolution for viewport generation at a zoom level.
 * Lower zoom -> coarser H3 -> fewer cells -> faster generation.
 *
 *   zoom <= 10 -> resolution 7 (~1.2 km edge, ~5.16 km2 cells)
 *   zoom 11-13 -> resolution 8 (~460 m edge, ~0.74 km2 cells)
 *   zoom 14+   -> resolution 9 (~174 m edge, ~0.11 km2 cells)
 *
 * @param {number} zoom
 * @returns {number} H3 resolution (7-9)
 */
export function getResolutionForZoom(zoom) {
  if (zoom <= 10) return 7;
  if (zoom <= 13) return 8;
  return 9;
}

// ── Citadel Generation (World-Level) ────────────────────────────

/**
 * Generate citadels for ALL cities in the world.
 * Called once on startup, cached until recipe seed changes.
 * ~80K citadels for ~4400 cities.
 *
 * @param {Array} cities - Array of city objects
 * @param {Object} recipe - Active recipe
 * @returns {Array} All citadel objects worldwide
 */
export function generateAllCitadels(cities, recipe, cityBoundaries = null) {
  // Check cache: same recipe seed means same citadels
  if (_allCitadels && _citadelRecipeSeed === recipe.seed) {
    return _allCitadels;
  }

  const allCitadels = [];
  const usedCells = new Set();

  for (const city of cities) {
    if (!city.population || city.population <= 0) continue;
    
    let cityCitadels = [];
    if (cityBoundaries && cityBoundaries[city.id] && cityBoundaries[city.id].boundary) {
      const coords = cityBoundaries[city.id].boundary;
      let outerRing = null;
      if (Array.isArray(coords[0]) && Array.isArray(coords[0][0]) && typeof coords[0][0][0] === "number") {
          outerRing = coords[0];
      } else if (Array.isArray(coords[0]) && typeof coords[0][0] === "number") {
          outerRing = coords;
      }
      
      if (outerRing && outerRing.length >= 3) {
          cityCitadels = generateCitadelsInBoundary(city, outerRing, recipe);
      } else {
          cityCitadels = generateCitadelsForCity(city, recipe);
      }
    } else {
      cityCitadels = generateCitadelsForCity(city, recipe);
    }
    
    for (const citadel of cityCitadels) {
      if (!usedCells.has(citadel.h3Index)) {
        usedCells.add(citadel.h3Index);
        allCitadels.push(citadel);
      }
    }
  }

  _allCitadels = allCitadels;
  _citadelRecipeSeed = recipe.seed;
  return allCitadels;
}

/**
 * Invalidate the citadel cache (e.g. on recipe change).
 */
export function invalidateCitadelCache() {
  _allCitadels = null;
  _citadelRecipeSeed = null;
}

// ── City Cell Estimation ────────────────────────────────────────

/**
 * Estimate totalCells for a city based on population and H3 resolution.
 * Consistent formula used by all rendering paths.
 *
 * radiusKm = clamp(sqrt(population / 12000), 3, 50)
 * cityArea = pi * radiusKm^2
 * totalCells = max(1, round(cityArea / cellArea))
 *
 * @param {Object} city - { population }
 * @param {number} resolution - H3 resolution
 * @returns {number} Estimated cell count
 */
export function estimateCityTotalCells(city, resolution) {
  const radiusKm = Math.min(
    50,
    Math.max(3, Math.sqrt(city.population / 12000)),
  );
  // Official H3 cell areas in km2
  const cellAreas = { 7: 5.161, 8: 0.737, 9: 0.105, 10: 0.015 };
  const cellArea = cellAreas[resolution] || 0.737;
  const cityArea = Math.PI * radiusKm * radiusKm;
  return Math.max(1, Math.round(cityArea / cellArea));
}

// ── Viewport Object Generation ──────────────────────────────────

/**
 * Generate objects for the current map viewport, handling multi-city boundaries.
 * Groups viewport H3 cells by nearest city, then generates per-city.
 *
 * @param {{north: number, south: number, east: number, west: number}} bounds - Map viewport bounds
 * @param {Object} recipe - Active recipe
 * @param {Array} cities - All cities
 * @param {number} zoom - Current map zoom level
 * @param {Set<string>} [defeatedIds] - Defeated object IDs
 * @returns {Array} Objects in viewport (appropriate types for zoom level)
 */
export function generateViewportObjects(
  bounds,
  recipe,
  cities,
  zoom,
  defeatedIds = new Set(),
) {
  const types = getTypesForZoom(zoom);
  if (types.length === 0) return [];

  // Use zoom-appropriate H3 resolution
  const resolution = getResolutionForZoom(zoom);

  // Get H3 cells for viewport
  const h3 = window.h3;
  if (!h3) return [];

  const { north, south, east, west } = bounds;
  const polygon = [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
    [north, west],
  ];

  // Safety: limit cell count to prevent freeze at extreme zoom-outs
  let h3Cells;
  try {
    h3Cells = h3.polygonToCells(polygon, resolution);
  } catch (e) {
    console.warn("H3 polygonToCells failed:", e.message);
    return [];
  }

  const MAX_CELLS = 5000;
  if (h3Cells.length > MAX_CELLS) {
    console.warn(
      `Too many H3 cells (${h3Cells.length}), clamping to ${MAX_CELLS}`,
    );
    h3Cells = h3Cells.slice(0, MAX_CELLS);
  }

  // Group cells by nearest city
  const cityGroups = new Map(); // cityId -> { city, cells[] }
  for (const cell of h3Cells) {
    const city = findCityForCell(cell, cities);
    if (!city) continue;
    const key = city.id;
    if (!cityGroups.has(key)) {
      cityGroups.set(key, { city, cells: [] });
    }
    cityGroups.get(key).cells.push(cell);
  }

  // Generate per-city
  const allObjects = [];
  for (const [cityId, { city, cells }] of cityGroups) {
    const totalCells = estimateCityTotalCells(city, resolution);
    const cityContext = {
      cityId: city.id,
      cityName: city.name,
      population: city.population,
      totalCells,
    };
    const objects = getObjectsForViewport(
      cells,
      recipe,
      cityContext,
      defeatedIds,
      types,
    );
    allObjects.push(...objects);
  }

  return allObjects;
}

// ── Viewport Cache Key ──────────────────────────────────────────

/**
 * Get a viewport cache key to avoid redundant regeneration.
 * Truncates coordinates to 4 decimal places (~11m precision).
 *
 * @param {{north: number, south: number, east: number, west: number}} bounds
 * @param {number} zoom
 * @param {number} seed
 * @returns {string}
 */
export function getViewportKey(bounds, zoom, seed) {
  return `${bounds.north.toFixed(4)}_${bounds.south.toFixed(4)}_${bounds.east.toFixed(4)}_${bounds.west.toFixed(4)}_${zoom}_${seed}`;
}

// ── H3 Zone Boundaries ──────────────────────────────────────────

/**
 * Generate GeoJSON FeatureCollection of H3 cell boundaries for citadels.
 * Each citadel's zone is the H3 cell (at H3_RES_CITADEL = 7) it occupies.
 * This replaces Voronoi polygons with regular hexagons — no Turf.js needed.
 *
 * @param {Array} citadels — Array of citadel objects from generateAllCitadels()
 *   Each must have: { h3Index, id, cityId, templateId, lat, lng }
 * @returns {{ type: 'FeatureCollection', features: Array }} GeoJSON
 */
export function generateZoneGeoJSON(citadels) {
  if (!citadels || citadels.length === 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const h3 = window.h3;
  if (!h3) {
    console.warn("h3-js not loaded, cannot generate zones");
    return { type: "FeatureCollection", features: [] };
  }

  const features = [];
  const seenCells = new Set(); // Deduplicate (multiple citadels in same cell)

  for (const citadel of citadels) {
    const cellIndex = citadel.h3Index;
    if (!cellIndex || seenCells.has(cellIndex)) continue;
    seenCells.add(cellIndex);

    try {
      // h3.cellToBoundary returns [[lat, lng], [lat, lng], ...]
      const boundary = h3.cellToBoundary(cellIndex);
      // GeoJSON coordinates are [lng, lat] (opposite of h3)
      const coordinates = boundary.map(([lat, lng]) => [lng, lat]);
      // Close the ring
      coordinates.push(coordinates[0]);

      features.push({
        type: "Feature",
        properties: {
          h3Index: cellIndex,
          citadelId: citadel.id,
          cityId: citadel.cityId || null,
          cityName: citadel.cityName || null,
          templateId: citadel.templateId || null,
        },
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
      });
    } catch (e) {
      // Skip invalid cells silently
    }
  }

  return { type: "FeatureCollection", features };
}

/**
 * Filter citadels to only those visible in a viewport.
 * Used to limit zone rendering to visible area.
 *
 * @param {Array} citadels — All citadels
 * @param {{north, south, east, west}} bounds — Viewport bounds
 * @param {number} [padding=2] — Extra degrees of padding around viewport
 * @returns {Array} Citadels within padded bounds
 */
export function filterCitadelsInBounds(citadels, bounds, padding = 2) {
  if (!citadels || !bounds) return [];
  const { north, south, east, west } = bounds;
  return citadels.filter(
    (c) =>
      c.lat >= south - padding &&
      c.lat <= north + padding &&
      c.lng >= west - padding &&
      c.lng <= east + padding,
  );
}
