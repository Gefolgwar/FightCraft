// H3 Territory Computation Engine — pure functions, no Firebase/DOM.
// Replaces ray-casting Voronoi boundaries with H3 hexagonal spatial indexing.
// Ownership math preserved from territory-math.js; H3 is only for bucketing.
// Requires window.h3 (h3-js v4.1.0 UMD). Callers must await ensureH3Loaded().

import {
  haversineMeters,
  effectiveDistance,
  getOwner,
  isContested,
  getNearestCitadels,
} from "./territory-math.js";
import {
  ensureH3Loaded,
  latLngToH3,
  h3ToLatLng,
  h3ToBoundary,
} from "./h3-spatial.js";

/** ~1.22 km edge, ~5.16 km² per cell — city-level territory display. */
export const H3_RES_TERRITORY = 7;
/** ~8.54 km edge — zoomed-out / continental overview. */
export const H3_RES_TERRITORY_COARSE = 5;

/** Deterministic HSL color from a citadel ID. Same hash as TerritoryCanvasLayer.
 * @param {string} id  @returns {string} CSS hsl() string */
export function citadelColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360}, 65%, 45%)`;
}

/**
 * Assign every H3 cell inside a bounding box to its owning citadel.
 * @param {Array<{id:string, lat:number, lng:number, powerMultiplier?:number}>} citadels
 * @param {{north:number, south:number, east:number, west:number}} bounds
 * @param {number} [resolution=H3_RES_TERRITORY]
 * @returns {Map<string,string>} h3Index → citadelId
 */
export function computeH3Territory(
  citadels,
  bounds,
  resolution = H3_RES_TERRITORY,
) {
  if (!citadels || citadels.length === 0) return new Map();
  const h3 = window.h3;
  if (!h3) throw new Error("h3-js not loaded — call ensureH3Loaded() first");

  const { north, south, east, west } = bounds;
  const polygon = [
    [north, west],
    [north, east],
    [south, east],
    [south, west],
    [north, west],
  ];
  const cells = h3.polygonToCells(polygon, resolution);
  const territoryMap = new Map();

  for (const cell of cells) {
    const [lat, lng] = h3.cellToLatLng(cell);
    const result = getOwner(lat, lng, citadels);
    if (result) territoryMap.set(cell, result.citadel.id);
  }
  return territoryMap;
}

/**
 * Derives bounding box from citadel positions + padding, then computes territory.
 * @param {Array<{id:string, lat:number, lng:number, powerMultiplier?:number}>} citadels
 * @param {number} [resolution=H3_RES_TERRITORY]
 * @param {number} [paddingKm=5]
 * @returns {{territoryMap: Map<string,string>, bounds: Object, cellCount: number}}
 */
export function computeH3TerritoryFromCitadels(
  citadels,
  resolution = H3_RES_TERRITORY,
  paddingKm = 5,
) {
  if (!citadels || citadels.length === 0) {
    return { territoryMap: new Map(), bounds: null, cellCount: 0 };
  }
  // ~0.009° latitude ≈ 1 km; longitude varies but close enough for padding.
  const padDeg = paddingKm * 0.009;
  const lats = citadels.map((c) => c.lat);
  const lngs = citadels.map((c) => c.lng);
  const bounds = {
    north: Math.max(...lats) + padDeg,
    south: Math.min(...lats) - padDeg,
    east: Math.max(...lngs) + padDeg,
    west: Math.min(...lngs) - padDeg,
  };
  const territoryMap = computeH3Territory(citadels, bounds, resolution);
  return { territoryMap, bounds, cellCount: territoryMap.size };
}

/**
 * Return all H3 cell indices owned by a given citadel.
 * @param {string} citadelId
 * @param {Map<string,string>} territoryMap — from computeH3Territory
 * @returns {string[]}
 */
export function getCitadelCells(citadelId, territoryMap) {
  const cells = [];
  for (const [cell, owner] of territoryMap) {
    if (owner === citadelId) cells.push(cell);
  }
  return cells;
}

/**
 * Point-query: which citadel owns a lat/lng?
 * Primary path: coordinate → H3 cell → lookup in territory map (O(1)).
 * Falls back to full {@link getOwner} if the cell is outside the map.
 * @param {number} lat
 * @param {number} lng
 * @param {Map<string,string>} territoryMap
 * @param {Array} citadels — needed for fallback + distance calc
 * @param {number} [resolution=H3_RES_TERRITORY]
 * @returns {{citadel:Object, distance:number, h3Index:string}|null}
 */
export function getOwnerH3(
  lat,
  lng,
  territoryMap,
  citadels,
  resolution = H3_RES_TERRITORY,
) {
  if (!citadels || citadels.length === 0) return null;

  const h3Index = latLngToH3(lat, lng, resolution);
  const cachedId = territoryMap.get(h3Index);

  if (cachedId) {
    const citadel = citadels.find((c) => c.id === cachedId);
    if (citadel) {
      return {
        citadel,
        distance: effectiveDistance(lat, lng, citadel),
        h3Index,
      };
    }
  }
  // Fallback: cell not in map (point is outside precomputed bounds)
  const result = getOwner(lat, lng, citadels);
  if (!result) return null;
  return { citadel: result.citadel, distance: result.distance, h3Index };
}

/**
 * Compute per-citadel hex boundaries suitable for rendering.
 * Returns one descriptor per citadel that owns ≥1 cell. Each contains
 * individual hex polygons (`hexBoundaries`) the canvas layer can draw.
 *
 * @param {Array<{id:string, lat:number, lng:number, powerMultiplier?:number,
 *   ownerId?:string, ownerName?:string}>} citadels
 * @param {number} [resolution=H3_RES_TERRITORY]
 * @param {number} [paddingKm=5]
 * @returns {Array<{citadelId: string, cells: string[],
 *   hexBoundaries: Array<Array<{lat:number, lng:number}>>,
 *   outerBoundary: null, ownerId?: string, ownerName?: string, color: string}>}
 */
export function computeH3Boundaries(
  citadels,
  resolution = H3_RES_TERRITORY,
  paddingKm = 5,
) {
  if (!citadels || citadels.length === 0) return [];

  const { territoryMap } = computeH3TerritoryFromCitadels(
    citadels,
    resolution,
    paddingKm,
  );

  // Group cells by owning citadel
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const [cell, cId] of territoryMap) {
    let arr = groups.get(cId);
    if (!arr) {
      arr = [];
      groups.set(cId, arr);
    }
    arr.push(cell);
  }

  const results = [];
  let totalCells = 0;

  for (const citadel of citadels) {
    const cells = groups.get(citadel.id);
    if (!cells || cells.length === 0) continue;
    totalCells += cells.length;
    results.push({
      citadelId: citadel.id,
      cells,
      hexBoundaries: cells.map((cell) => h3ToBoundary(cell)),
      outerBoundary: null, // V1: individual hexes only
      ownerId: citadel.ownerId,
      ownerName: citadel.ownerName,
      color: citadelColor(citadel.id),
    });
  }

  console.log(
    `🗺️ H3 Territory: ${citadels.length} citadels, ${totalCells} cells at res ${resolution}`,
  );
  return results;
}

/**
 * Number of distinct citadel zones (unique owners) in the territory map.
 * @param {Map<string,string>} territoryMap
 * @returns {number}
 */
export function getZoneCount(territoryMap) {
  return new Set(territoryMap.values()).size;
}

/**
 * Log a human-readable breakdown of territory ownership to the console.
 * @param {Array<{id:string, ownerName?:string}>} citadels
 * @param {Map<string,string>} territoryMap
 */
export function logTerritoryStats(citadels, territoryMap) {
  const resolution =
    territoryMap.size > 0
      ? (window.h3?.getResolution([...territoryMap.keys()][0]) ?? "?")
      : "?";
  const zones = getZoneCount(territoryMap);
  console.log(
    `📊 Territory Stats: ${citadels.length} citadels, ${zones} zones (${territoryMap.size} H3 cells), Res ${resolution}`,
  );

  const counts = new Map();
  for (const cId of territoryMap.values()) {
    counts.set(cId, (counts.get(cId) || 0) + 1);
  }
  const parts = citadels.map((c) => {
    const name = c.ownerName || c.id;
    return `${name}: ${counts.get(c.id) || 0} cells`;
  });
  console.log(`📊 Per-citadel: ${parts.join(" | ")}`);
}
