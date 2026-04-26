// ==================== TERRITORY MATH ENGINE ====================
// Pure mathematical functions for global territory ownership.
// No Firebase, no DOM, no side effects — fully testable.
//
// Implements a Weighted Voronoi (Power Diagram) system where:
//   EffectiveDistance = RealDistance / CitadelPower
// The citadel with the LOWEST effective distance owns any given point.

const R = 6371000; // Earth radius in meters

const toRad = (deg) => deg * Math.PI / 180;
const toDeg = (rad) => rad * 180 / Math.PI;

/**
 * Haversine distance in meters between two lat/lng points.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number} distance in meters
 */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Weighted (effective) distance = haversine / powerMultiplier.
 * Higher power = citadel "reaches" further.
 * @param {number} lat - query point latitude
 * @param {number} lng - query point longitude
 * @param {{lat: number, lng: number, powerMultiplier?: number}} citadel
 * @returns {number} effective distance in meters
 */
export function effectiveDistance(lat, lng, citadel) {
  const pm = Math.max(citadel.powerMultiplier ?? 1.0, 0.01);
  return haversineMeters(lat, lng, citadel.lat, citadel.lng) / pm;
}

/**
 * Find the citadel that owns a given coordinate.
 * Returns the citadel with the lowest effective distance.
 * @param {number} lat
 * @param {number} lng
 * @param {Array<{id: string, lat: number, lng: number, powerMultiplier?: number, ownerId?: string, ownerName?: string}>} citadels
 * @returns {{citadel: Object, distance: number, rank: Array<{citadel: Object, distance: number}>} | null}
 *   - citadel: the owning citadel object
 *   - distance: the effective distance to it
 *   - rank: array of {citadel, distance} sorted ascending (for tiebreakers/UI)
 */
export function getOwner(lat, lng, citadels) {
  if (!citadels || citadels.length === 0) return null;

  const rank = citadels
    .map((c) => ({ citadel: c, distance: effectiveDistance(lat, lng, c) }))
    .sort((a, b) => a.distance - b.distance);

  return {
    citadel: rank[0].citadel,
    distance: rank[0].distance,
    rank,
  };
}

/**
 * Get the top N citadels sorted by effective distance from a point.
 * Useful for "contested zone" detection and UI display.
 * @param {number} lat
 * @param {number} lng
 * @param {Array} citadels
 * @param {number} [n=3]
 * @returns {Array<{citadel: Object, distance: number}>}
 */
export function getNearestCitadels(lat, lng, citadels, n = 3) {
  if (!citadels || citadels.length === 0) return [];

  return citadels
    .map((c) => ({ citadel: c, distance: effectiveDistance(lat, lng, c) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

/**
 * Estimate the boundary point between two citadels along the line connecting them.
 * The boundary occurs where effectiveDistance to citadel A equals effectiveDistance to citadel B.
 * Uses binary search on the lat/lng segment for convergence.
 *
 * NOTE: Interpolates linearly in lat/lng space. Accurate for citadels within
 * the same hemisphere and not straddling the antimeridian. For the 6 European
 * cities in FightCraft this is always valid.
 *
 * @param {{lat: number, lng: number, powerMultiplier?: number}} citadelA
 * @param {{lat: number, lng: number, powerMultiplier?: number}} citadelB
 * @param {number} [steps=20] - binary search iterations for precision
 * @returns {{lat: number, lng: number}} - boundary point coordinates
 */
export function findBoundaryPoint(citadelA, citadelB, steps = 20) {
  // lo starts at A's position (A owns), hi starts at B's position (B owns)
  let loLat = citadelA.lat, loLng = citadelA.lng;
  let hiLat = citadelB.lat, hiLng = citadelB.lng;

  for (let i = 0; i < steps; i++) {
    const midLat = (loLat + hiLat) / 2;
    const midLng = (loLng + hiLng) / 2;

    const dA = effectiveDistance(midLat, midLng, citadelA);
    const dB = effectiveDistance(midLat, midLng, citadelB);

    if (dA < dB) {
      // Midpoint is in A's territory → boundary is between mid and B
      loLat = midLat;
      loLng = midLng;
    } else {
      // Midpoint is in B's territory (or tied) → boundary is between A and mid
      hiLat = midLat;
      hiLng = midLng;
    }
  }

  return {
    lat: (loLat + hiLat) / 2,
    lng: (loLng + hiLng) / 2,
  };
}

/**
 * Move a point along a bearing for a given distance.
 * Uses the geodesic destination formula (spherical approximation).
 * @param {number} lat - start latitude
 * @param {number} lng - start longitude
 * @param {number} bearingDeg - bearing in degrees (0 = North, 90 = East)
 * @param {number} distanceMeters - distance to travel
 * @returns {{lat: number, lng: number}}
 */
export function moveAlongBearing(lat, lng, bearingDeg, distanceMeters) {
  const φ1 = toRad(lat);
  const λ1 = toRad(lng);
  const θ = toRad(bearingDeg);
  const δ = distanceMeters / R; // angular distance in radians

  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) +
    Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
  );

  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

/**
 * Generate approximate territory boundary polygon for a citadel.
 * Casts rays from the citadel center at regular angular intervals,
 * walking outward until effective distance to another citadel becomes lower.
 * When the ownership boundary is found, a 15-step binary search refines
 * the exact crossing point to sub-meter precision.
 *
 * @param {Object} targetCitadel - the citadel to compute boundary for (must have `id`)
 * @param {Array} allCitadels - all citadels in the system
 * @param {number} [numRays=36] - number of angular rays (every 10°)
 * @param {number} [maxDistKm=50] - max search distance per ray in km
 * @returns {Array<{lat: number, lng: number}>} - polygon boundary points
 */
export function estimateTerritoryBoundary(targetCitadel, allCitadels, numRays = 36, maxDistKm = 50) {
  const maxDistM = maxDistKm * 1000;
  const stepM = 500; // walk in 500m increments
  const boundary = [];
  const angleStep = 360 / numRays;

  for (let i = 0; i < numRays; i++) {
    const bearing = i * angleStep;
    let prevPoint = { lat: targetCitadel.lat, lng: targetCitadel.lng };
    let found = false;

    // Walk outward along the ray
    for (let dist = stepM; dist <= maxDistM; dist += stepM) {
      const pt = moveAlongBearing(targetCitadel.lat, targetCitadel.lng, bearing, dist);
      const owner = getOwner(pt.lat, pt.lng, allCitadels);

      if (!owner || owner.citadel.id !== targetCitadel.id) {
        // Ownership changed — binary search between prevPoint and pt
        let lo = { lat: prevPoint.lat, lng: prevPoint.lng };
        let hi = { lat: pt.lat, lng: pt.lng };

        for (let s = 0; s < 15; s++) {
          const mid = {
            lat: (lo.lat + hi.lat) / 2,
            lng: (lo.lng + hi.lng) / 2,
          };
          const midOwner = getOwner(mid.lat, mid.lng, allCitadels);
          if (midOwner && midOwner.citadel.id === targetCitadel.id) {
            lo = mid;
          } else {
            hi = mid;
          }
        }

        boundary.push({
          lat: (lo.lat + hi.lat) / 2,
          lng: (lo.lng + hi.lng) / 2,
        });
        found = true;
        break;
      }

      prevPoint = pt;
    }

    // If no rival found within maxDist, record the max-range endpoint
    if (!found) {
      boundary.push(
        moveAlongBearing(targetCitadel.lat, targetCitadel.lng, bearing, maxDistM),
      );
    }
  }

  return boundary;
}

/**
 * Check if a point is in a "contested zone" — within threshold% of being
 * owned by a different citadel.
 *
 * ratio = (challengerDist − ownerDist) / ownerDist
 * If ratio ≤ threshold → contested.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {Array} citadels
 * @param {number} [threshold=0.15] - 15% means if 2nd-closest is within 15% of 1st, zone is contested
 * @returns {{contested: boolean, owner: Object|null, challenger: Object|null, ratio: number}}
 */
export function isContested(lat, lng, citadels, threshold = 0.15) {
  if (!citadels || citadels.length < 2) {
    const owner = getOwner(lat, lng, citadels);
    return {
      contested: false,
      owner: owner ? owner.citadel : null,
      challenger: null,
      ratio: 0,
    };
  }

  const nearest = getNearestCitadels(lat, lng, citadels, 2);
  const d1 = nearest[0].distance; // owner
  const d2 = nearest[1].distance; // challenger

  let ratio;
  if (d1 < 1e-9) {
    // Standing on (or virtually at) the owner citadel
    ratio = d2 < 1e-9 ? 0 : Infinity;
  } else {
    ratio = (d2 - d1) / d1;
  }

  return {
    contested: ratio <= threshold,
    owner: nearest[0].citadel,
    challenger: nearest[1].citadel,
    ratio,
  };
}
