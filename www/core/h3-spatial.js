// ==================== H3 SPATIAL GRID SYSTEM ====================
// Lazy-loads h3-js v4 via CDN and provides spatial query utilities
// for the procedural world engine.

const H3_CDN = "https://unpkg.com/h3-js@4.1.0/dist/h3-js.umd.js";

// ── Resolution Constants ─────────────────────────────────────────

/** Resolution 8: ~460m edge length — individual monster spawn cells */
export const H3_RES_ENTITY = 8;

/** Resolution 7: ~1.2km edge length — neighborhood / district zones (1 citadel = 1 zone ~ 5 km2) */
export const H3_RES_CITADEL = 7;

/** Resolution 6: ~3.2km edge length — visual marker clustering */
export const H3_RES_CLUSTER = 6;

/** Resolution 6: ~3.2km edge length — H3 discovery trigger cells */
export const H3_RES_DISCOVERY = 6;

// ── Internal State ───────────────────────────────────────────────

let _h3LoadPromise = null;

// ── CDN Loader ───────────────────────────────────────────────────

/**
 * Lazy-loads h3-js from CDN via script tag injection.
 * Caches the library on `window.h3`. Subsequent calls resolve immediately.
 * @returns {Promise} Resolves with the h3 namespace object.
 */
export async function ensureH3Loaded() {
  // Already loaded
  if (window.h3) return window.h3;

  // Load in progress — deduplicate
  if (_h3LoadPromise) return _h3LoadPromise;

  _h3LoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = H3_CDN;
    script.onload = () => {
      if (window.h3) {
        console.log("✅ h3-js loaded from CDN");
        resolve(window.h3);
      } else {
        reject(new Error("h3-js loaded but window.h3 is not available"));
      }
    };
    script.onerror = () => {
      _h3LoadPromise = null;
      reject(new Error("Failed to load h3-js from CDN"));
    };
    document.head.appendChild(script);
  });

  return _h3LoadPromise;
}

// ── Core Functions ───────────────────────────────────────────────

/**
 * Convert a lat/lng coordinate to an H3 cell index string.
 * @param {number} lat - Latitude in degrees
 * @param {number} lng - Longitude in degrees
 * @param {number} [resolution=H3_RES_ENTITY] - H3 resolution (0–15)
 * @returns {string} H3 index string (e.g. '882a1070adfffff')
 */
export function latLngToH3(lat, lng, resolution = H3_RES_ENTITY) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");
  return h3.latLngToCell(lat, lng, resolution);
}

/**
 * Get the center coordinates of an H3 cell.
 * @param {string} h3Index - H3 cell index string
 * @returns {{lat: number, lng: number}} Center of the cell
 */
export function h3ToLatLng(h3Index) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");
  const [lat, lng] = h3.cellToLatLng(h3Index);
  return { lat, lng };
}

/**
 * Get the boundary polygon vertices of an H3 cell.
 * @param {string} h3Index - H3 cell index string
 * @returns {Array} Array of {lat, lng} vertex coordinates
 */
export function h3ToBoundary(h3Index) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");
  const boundary = h3.cellToBoundary(h3Index);
  return boundary.map(([lat, lng]) => ({ lat, lng }));
}

/**
 * Get all H3 cells that cover a map viewport rectangle.
 * Uses h3.polygonToCells() with the viewport corners as a polygon.
 * @param {{north: number, south: number, east: number, west: number}} bounds - Viewport bounds
 * @param {number} [resolution=H3_RES_ENTITY] - H3 resolution
 * @returns {string[]} Array of H3 index strings covering the viewport
 */
export function getViewportCells(bounds, resolution = H3_RES_ENTITY) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");

  const { north, south, east, west } = bounds;

  // h3.polygonToCells expects an array of [lat, lng] coordinate rings.
  // First (and only) ring defines the outer boundary; must be closed
  // (h3-js v4 handles auto-closing but we close explicitly for safety).
  const polygon = [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
    [north, west], // close the ring
  ];

  return h3.polygonToCells(polygon, resolution);
}

/**
 * Get all H3 cells within a radius (in km) of a point.
 * Determines the center cell and then expands outward with gridDisk
 * until the disk covers the requested radius.
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {number} radiusKm - Search radius in kilometres
 * @param {number} [resolution=H3_RES_ENTITY] - H3 resolution
 * @returns {string[]} Array of H3 index strings
 */
export function getCellsInRadius(
  lat,
  lng,
  radiusKm,
  resolution = H3_RES_ENTITY,
) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");

  const center = h3.latLngToCell(lat, lng, resolution);

  // Approximate edge length (km) per resolution level
  const edgeLengthKm = {
    0: 1107.712591,
    1: 418.676005,
    2: 158.244655,
    3: 59.810858,
    4: 22.606379,
    5: 8.544408,
    6: 3.229482,
    7: 1.220629,
    8: 0.461354,
    9: 0.174375,
    10: 0.065907,
    11: 0.02491,
    12: 0.009415,
    13: 0.003559,
    14: 0.001348,
    15: 0.000509,
  };

  const edge = edgeLengthKm[resolution] || 0.461;
  // Each ring step covers roughly 2 × edge length in distance.
  // Add 1 to ensure full coverage at the boundary.
  const ringSize = Math.ceil(radiusKm / (edge * 2)) + 1;

  return h3.gridDisk(center, ringSize);
}

/**
 * Get neighboring H3 cells in a k-ring around a given cell.
 * @param {string} h3Index - Center cell index
 * @param {number} [ringSize=1] - Number of rings to expand (1 = immediate neighbors)
 * @returns {string[]} Array of H3 index strings (includes the center cell)
 */
export function getNeighborCells(h3Index, ringSize = 1) {
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");
  return h3.gridDisk(h3Index, ringSize);
}

/**
 * Map a Leaflet map zoom level to the best H3 resolution for display.
 * Lower zoom → coarser resolution (fewer, larger cells).
 * Higher zoom → finer resolution (more, smaller cells).
 * @param {number} zoomLevel - Leaflet map zoom level (typically 1–20)
 * @returns {number} Recommended H3 resolution (3–8)
 */
export function adaptiveResolution(zoomLevel) {
  if (zoomLevel <= 6) return 3;
  if (zoomLevel <= 9) return 4;
  if (zoomLevel <= 12) return 6;
  if (zoomLevel <= 14) return 7;
  return 8; // zoom >= 15
}
