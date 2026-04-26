// ==================== GEOMETRY UTILITIES ====================

/**
 * Douglas-Peucker simplification algorithm for reducing polygon points
 * @param {Array} points - Array of {lat, lng} objects or [lat, lng] arrays
 * @param {Number} tolerance - Deviation tolerance in degrees (e.g., 0.0001)
 * @returns {Array} Simplified array of points
 */
export function simplify(points, tolerance) {
  if (points.length <= 2) return points;

  const sqTolerance = tolerance * tolerance;
  let maxSqDist = 0;
  let index = 0;

  const end = points.length - 1;

  // Find point with max distance from line segment
  for (let i = 1; i < end; i++) {
    const sqDist = getSqSegDist(points[i], points[0], points[end]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > sqTolerance) {
    if (index - 0 > 1) {
      var firstPart = simplify(points.slice(0, index + 1), tolerance);
    } else {
      var firstPart = [points[0], points[index]];
    }

    if (end - index > 1) {
      var secondPart = simplify(points.slice(index, end + 1), tolerance);
    } else {
      var secondPart = [points[index], points[end]];
    }

    return firstPart.concat(secondPart.slice(1));
  } else {
    return [points[0], points[end]];
  }
}

function getSqSegDist(p, p1, p2) {
  let x = p.lat || p[0];
  let y = p.lng || p[1];
  let x1 = p1.lat || p1[0];
  let y1 = p1.lng || p1[1];
  let x2 = p2.lat || p2[0];
  let y2 = p2.lng || p2[1];

  let dx = x2 - x1;
  let dy = y2 - y1;

  if (dx !== 0 || dy !== 0) {
    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x1 = x2;
      y1 = y2;
    } else if (t > 0) {
      x1 += dx * t;
      y1 += dy * t;
    }
  }

  dx = x - x1;
  dy = y - y1;

  return dx * dx + dy * dy;
}

/**
 * Calculate centroid of a polygon
 * @param {Array} points - Array of {lat, lng}
 * @returns {Object} {lat, lng}
 */
export function getCentroid(points) {
  let x = 0,
    y = 0,
    area = 0;

  // If points are [lat, lng], convert to object for consistency
  const pts = points.map((p) =>
    Array.isArray(p) ? { lat: p[0], lng: p[1] } : p,
  );

  for (let i = 0, len = pts.length, j = len - 1; i < len; j = i++) {
    const p1 = pts[i];
    const p2 = pts[j];
    const f = p1.lat * p2.lng - p2.lat * p1.lng;
    x += (p1.lat + p2.lat) * f;
    y += (p1.lng + p2.lng) * f;
    area += f * 3;
  }

  return { lat: x / area, lng: y / area };
}

/**
 * Check if point is in polygon (Ray casting)
 * @param {Object} point - {lat, lng}
 * @param {Array} vs - Polygon points
 */
export function isPointInPolygon(point, vs) {
  const x = point.lat,
    y = point.lng;
  let inside = false;

  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i].lat || vs[i][0],
      yi = vs[i].lng || vs[i][1];
    const xj = vs[j].lat || vs[j][0],
      yj = vs[j].lng || vs[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

// ==================== TERRITORY / CITADEL HELPERS ====================

/**
 * Weighted distance for territory ownership (Voronoi replacement).
 * D_weighted = haversine(player, citadel) / citadel_power_multiplier
 *
 * @param {number} lat1 - Latitude of point A (e.g. player)
 * @param {number} lng1 - Longitude of point A
 * @param {number} lat2 - Latitude of point B (e.g. citadel)
 * @param {number} lng2 - Longitude of point B
 * @param {number} [powerMultiplier=1] - Citadel power multiplier (higher = closer effective distance)
 * @returns {number} Weighted distance in meters
 */
export function weightedDistance(lat1, lng1, lat2, lng2, powerMultiplier = 1) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) / Math.max(powerMultiplier, 0.01);
}

/**
 * Find the nearest citadel by weighted distance.
 * @param {number} lat - Query latitude
 * @param {number} lng - Query longitude
 * @param {Array<{id: string, lat: number, lng: number, powerMultiplier?: number}>} citadels
 * @returns {{citadel: Object, distance: number}|null} Nearest citadel and its weighted distance, or null
 */
export function getNearestCitadel(lat, lng, citadels) {
  if (!citadels || citadels.length === 0) return null;
  let nearest = null;
  let minDist = Infinity;
  for (const c of citadels) {
    const d = weightedDistance(lat, lng, c.lat, c.lng, c.powerMultiplier || 1);
    if (d < minDist) {
      minDist = d;
      nearest = c;
    }
  }
  return { citadel: nearest, distance: minDist };
}
