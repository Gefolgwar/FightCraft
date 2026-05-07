/**
 * Territory Service v2 — Distance-Based Ownership
 * Replaces Voronoi/Turf.js GeoJSON with real-time weighted distance checks.
 * No pre-generated polygons. Territory is computed on-the-fly.
 *
 * Key formula:
 *   D_weighted = Distance(point, citadel) / citadel.powerMultiplier
 *   The "King" of any point is the citadel with the lowest D_weighted.
 */

import {
  saveCityZones,
  getCityZones,
  isAdmin,
} from "../firebase/firebase-service.js";

import {
  haversineMeters as _haversineMeters,
  getOwner,
  effectiveDistance,
  estimateTerritoryBoundary,
  isContested,
  getNearestCitadels,
} from "../core/territory-math.js";

// ==================== DELEGATED GEOMETRY HELPERS ====================
// Canonical implementations live in core/territory-math.js.
// These wrappers preserve the legacy signatures for backward compatibility.

/**
 * Weighted distance: raw haversine divided by a power multiplier.
 * Delegates to effectiveDistance() from territory-math.js.
 *
 * @param {number} lat1 - Point latitude
 * @param {number} lng1 - Point longitude
 * @param {number} lat2 - Citadel latitude
 * @param {number} lng2 - Citadel longitude
 * @param {number} powerMultiplier - >= 1; defaults to 1
 * @returns {number} weighted distance in meters
 */
export function weightedDistance(lat1, lng1, lat2, lng2, powerMultiplier = 1) {
  return effectiveDistance(lat1, lng1, {
    lat: lat2,
    lng: lng2,
    powerMultiplier,
  });
}

/**
 * Find the citadel with the lowest weighted distance to a point.
 * Delegates to getOwner() from territory-math.js.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array} citadels - [{id, lat, lng, powerMultiplier, ...}]
 * @returns {{ citadel: Object, distance: number } | null}
 */
export function getNearestCitadel(lat, lng, citadels) {
  const result = getOwner(lat, lng, citadels);
  return result ? { citadel: result.citadel, distance: result.distance } : null;
}

// ==================== CITADEL CACHE ====================

/** @type {Array<{id:string, lat:number, lng:number, powerMultiplier:number, ownerId?:string, ownerName?:string, cityId?:string}>} */
let _citadelCache = [];

/**
 * Set the citadel list for territory calculations.
 * @param {Array} citadels - [{id, lat, lng, powerMultiplier, ownerId, ownerName, cityId}]
 */
export function setCitadels(citadels) {
  _citadelCache = citadels || [];
}

/**
 * Get the current cached citadel list.
 * @returns {Array}
 */
export function getCitadels() {
  return _citadelCache;
}

// ==================== PUBLIC API ====================

/**
 * Get the citadel that controls a given point.
 * @param {number} lat
 * @param {number} lng
 * @returns {{ citadel: Object, distance: number } | null}
 */
export function getZoneOwner(lat, lng) {
  return getNearestCitadel(lat, lng, _citadelCache);
}

/**
 * Get the zone owner for the current player's position.
 * Uses window.gameState to avoid circular imports.
 * @returns {{ citadel: Object, distance: number } | null}
 */
export function getPlayerZoneOwner() {
  const gs = window.gameState;
  if (!gs?.player?.position) return null;
  return getZoneOwner(gs.player.position.lat, gs.player.position.lng);
}

/**
 * Get the owner of any coordinate on Earth using the global citadel cache.
 * This is the primary API for the new global territory system.
 * @param {number} lat
 * @param {number} lng
 * @returns {{citadel: Object, distance: number, rank: Array} | null}
 */
export function getGlobalOwner(lat, lng) {
  return getOwner(lat, lng, _citadelCache);
}

/**
 * Compute territory boundaries for all cached citadels.
 * Returns data suitable for TerritoryCanvasLayer.setTerritories().
 * @param {number} [numRays=36]
 * @param {number} [maxDistKm=50]
 * @returns {Array<{citadelId: string, boundary: Array<{lat: number, lng: number}>, ownerId?: string, ownerName?: string}>}
 */
export function computeAllTerritoryBoundaries(numRays = 36, maxDistKm = 50) {
  if (_citadelCache.length === 0) return [];
  return _citadelCache.map((c) => ({
    citadelId: c.id,
    boundary: estimateTerritoryBoundary(c, _citadelCache, numRays, maxDistKm),
    ownerId: c.ownerId || null,
    ownerName: c.ownerName || null,
  }));
}

/**
 * Check if the player's current position is in a contested zone.
 * @returns {{contested: boolean, owner: Object|null, challenger: Object|null, ratio: number}}
 */
export function isPlayerInContestedZone() {
  const gs = window.gameState;
  if (!gs?.player?.position)
    return { contested: false, owner: null, challenger: null, ratio: 0 };
  return isContested(
    gs.player.position.lat,
    gs.player.position.lng,
    _citadelCache,
  );
}

/**
 * Get all citadels within a raw (unweighted) radius of a point.
 * @param {number} lat
 * @param {number} lng
 * @param {number} radiusMeters
 * @returns {Array}
 */
export function getCitadelsInRange(lat, lng, radiusMeters) {
  return _citadelCache.filter((c) => {
    const d = _haversineMeters(lat, lng, c.lat, c.lng);
    return d <= radiusMeters;
  });
}

/**
 * Generate a deterministic HSL colour for a citadel (stable across sessions).
 * @param {string} citadelId
 * @returns {string} e.g. "hsl(217, 70%, 50%)"
 */
export function getCitadelColor(citadelId) {
  let hash = 0;
  for (let i = 0; i < citadelId.length; i++) {
    hash = citadelId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

// ==================== LEGACY-COMPATIBLE PERSISTENCE ====================

/**
 * LEGACY COMPATIBILITY: Generate territory data for a city.
 * Now stores citadel positions + power instead of Voronoi GeoJSON polygons.
 * Returns a GeoJSON FeatureCollection of Point features (one per citadel)
 * so callers that iterate .features still work.
 *
 * @param {string} cityId
 * @param {Array} citadels - [{id, lat, lng, ...}]
 * @param {Array} bbox - (ignored — kept for signature compat)
 * @param {Object|null} rawMask - (ignored — kept for signature compat)
 * @returns {Object} GeoJSON FeatureCollection
 */
export async function generateCityTerritory(
  cityId,
  citadels,
  bbox,
  rawMask = null,
) {
  if (!isAdmin()) throw new Error("Unauthorized: Admin access required.");

  console.log(
    `🗺️ Generating distance-based territory for ${cityId} with ${citadels.length} citadels`,
  );

  // Enrich with defaults
  const enriched = citadels.map((c) => ({
    ...c,
    cityId,
    powerMultiplier: c.powerMultiplier || 1,
    generatedAt: new Date().toISOString(),
  }));

  // Update local cache (merge: replace same-city entries, keep others)
  _citadelCache = [
    ..._citadelCache.filter((c) => c.cityId !== cityId),
    ...enriched,
  ];

  // Return in a format compatible with the old Voronoi system
  return {
    type: "FeatureCollection",
    features: enriched.map((c) => ({
      type: "Feature",
      properties: {
        citadelId: c.id,
        cityId,
        lat: c.lat,
        lng: c.lng,
        powerMultiplier: c.powerMultiplier,
      },
      geometry: {
        type: "Point",
        coordinates: [c.lng, c.lat],
      },
    })),
  };
}

/**
 * LEGACY COMPATIBILITY: Generate AND save territory to Firestore.
 * @param {string} cityId
 * @param {Array} citadels
 * @param {Array} bbox
 * @returns {Object} GeoJSON FeatureCollection
 */
export async function regenerateCityTerritory(cityId, citadels, bbox) {
  const fc = await generateCityTerritory(cityId, citadels, bbox);

  const success = await saveCityZones(cityId, fc);
  if (success) {
    console.log(`✅ Saved ${fc.features.length} citadel zones for ${cityId}`);
    return fc;
  }
  throw new Error("Failed to save zones to database.");
}

/**
 * LEGACY COMPATIBILITY: Fetch zones for a city with local caching.
 * Also hydrates _citadelCache from the stored features.
 */
const _localZoneCache = {};

export async function getTerritoryZones(cityId) {
  // 1. Return from local memory if available
  if (_localZoneCache[cityId]) return _localZoneCache[cityId];

  // 1.5. Check client-side generated zones
  if (window._clientGeneratedZones) {
     const cityZone = window._clientGeneratedZones.find(z => z.id === cityId);
     if (cityZone && cityZone.features) {
         const geoJson = { type: "FeatureCollection", features: cityZone.features };
         _localZoneCache[cityId] = geoJson;
         return geoJson;
     }
  }

  // 2. Fetch from Database
  const data = await getCityZones(cityId);
  if (data?.geoJson) {
    _localZoneCache[cityId] = data.geoJson;

    // Extract citadels from stored zone data and update runtime cache
    if (data.geoJson.features) {
      const citadels = data.geoJson.features
        .filter((f) => f.properties?.citadelId)
        .map((f) => ({
          id: f.properties.citadelId,
          lat: f.properties.lat || f.geometry?.coordinates?.[1],
          lng: f.properties.lng || f.geometry?.coordinates?.[0],
          powerMultiplier: f.properties.powerMultiplier || 1,
          cityId: f.properties.cityId || cityId,
        }));
      // Merge into cache
      setCitadels([
        ..._citadelCache.filter((c) => c.cityId !== cityId),
        ...citadels,
      ]);
    }

    return data.geoJson;
  }

  return null;
}

// ==================== LEGACY STUBS ====================
// Kept so any code that still references these names won't throw on import.

/**
 * LEGACY STUB: Previously cleaned topology / self-intersections from raw GeoJSON.
 * With distance-based ownership, no polygon cleanup is needed.
 * @param {Object} rawGeoJSON
 * @returns {Object} passthrough
 */
export function getCleanCityMask(rawGeoJSON) {
  return rawGeoJSON;
}

/**
 * LEGACY STUB: Previously merged city boundary + citadel convex hull.
 * With distance-based ownership, no polygon mask is needed.
 * @param {Object} cityBoundary
 * @param {Object} citadelPoints
 * @returns {Object} passthrough
 */
export function generateSmartMapMask(cityBoundary, citadelPoints) {
  return cityBoundary;
}
