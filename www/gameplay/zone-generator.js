/**
 * Zone Generator — Deterministic City Layout Engine
 *
 * Pure functions for generating citadels, zones, and monsters
 * based on city population. Same input → same output for all players.
 *
 * Key invariants:
 *   - citadelCount = max(2, ceil(population / 100_000))
 *   - Each zone gets exactly MONSTERS_PER_ZONE (250) monsters
 *   - All randomness uses seeded Mulberry32 PRNG
 *   - Zone membership determined by weighted Voronoi (getOwner from territory-math.js)
 *
 * Depends on: core/territory-math.js (pure math, no side effects)
 */

import {
  haversineMeters,
  getOwner,
  estimateTerritoryBoundary,
  moveAlongBearing,
} from '../core/territory-math.js';

/** Default number of monsters generated per citadel zone. */
export const MONSTERS_PER_ZONE = 250;

/**
 * Create a seeded pseudo-random number generator using the Mulberry32 algorithm.
 *
 * @param {number} seed - Integer seed value.
 * @returns {() => number} A function that returns the next random value in [0, 1).
 */
export function createRNG(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * DJB2 hash — converts an arbitrary string into a deterministic unsigned 32-bit seed.
 *
 * @param {string} str - The string to hash (e.g. a city ID).
 * @returns {number} Unsigned 32-bit integer hash.
 */
export function hashSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Derive the number of citadels a city should have from its population.
 *
 * Formula: max(2, ceil(population / 100_000)).
 * Minimum of 2 ensures meaningful zone boundaries even for tiny cities.
 *
 * @param {number} population - City population (inhabitants).
 * @returns {number} Number of citadels (≥ 2).
 */
export function citadelCountFromPopulation(population) {
  if (!population || population <= 0) return 2;
  return Math.max(2, Math.ceil(population / 100_000));
}

/**
 * Compute the axis-aligned bounding box for a list of geographic points.
 *
 * @param {Array<{lat: number, lng: number}>} points - Array of coordinate objects.
 * @returns {{minLat: number, maxLat: number, minLng: number, maxLng: number} | null}
 *   Bounding box, or null if the input is empty / falsy.
 */
export function computeBBox(points) {
  if (!points || points.length === 0) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  return { minLat, maxLat, minLng, maxLng };
}

/**
 * Select `count` well-spaced points from `candidates` using Farthest Point Sampling.
 *
 * Greedy algorithm:
 *   1. Start with the candidate nearest to `center`.
 *   2. Maintain a Float64Array of each candidate's minimum distance to any selected point.
 *   3. At each step, pick the candidate whose min-distance is largest.
 *
 * @param {Array<{lat: number, lng: number}>} candidates - Pool of candidate positions.
 * @param {number} count - How many points to select.
 * @param {{lat: number, lng: number}} center - Reference center (used to pick the first point).
 * @returns {Array<{id: string, lat: number, lng: number, powerMultiplier: number}>}
 */
export function farthestPointSampling(candidates, count, center) {
  if (!candidates || candidates.length === 0) return [];

  if (candidates.length <= count) {
    return candidates.map((c, i) => ({
      id: `citadel_${i}`,
      lat: c.lat,
      lng: c.lng,
      powerMultiplier: 1,
    }));
  }

  const n = candidates.length;
  const selected = [];
  const used = new Uint8Array(n);
  const minDists = new Float64Array(n).fill(Infinity);

  /* --- Pick first: candidate nearest to center --- */
  let firstIdx = 0;
  let firstDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = haversineMeters(center.lat, center.lng, candidates[i].lat, candidates[i].lng);
    if (d < firstDist) {
      firstDist = d;
      firstIdx = i;
    }
  }

  used[firstIdx] = 1;
  selected.push(firstIdx);

  /* Update minDists relative to the first selected point */
  for (let i = 0; i < n; i++) {
    if (!used[i]) {
      const d = haversineMeters(
        candidates[firstIdx].lat, candidates[firstIdx].lng,
        candidates[i].lat, candidates[i].lng,
      );
      if (d < minDists[i]) minDists[i] = d;
    }
  }

  /* --- Greedy loop: pick candidate with max(minDists) --- */
  while (selected.length < count) {
    let bestIdx = -1;
    let bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (!used[i] && minDists[i] > bestDist) {
        bestDist = minDists[i];
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;

    used[bestIdx] = 1;
    selected.push(bestIdx);

    /* Update minDists with the newly selected point */
    for (let i = 0; i < n; i++) {
      if (!used[i]) {
        const d = haversineMeters(
          candidates[bestIdx].lat, candidates[bestIdx].lng,
          candidates[i].lat, candidates[i].lng,
        );
        if (d < minDists[i]) minDists[i] = d;
      }
    }
  }

  return selected.map((idx, i) => ({
    id: `citadel_${i}`,
    lat: candidates[idx].lat,
    lng: candidates[idx].lng,
    powerMultiplier: 1,
  }));
}

/**
 * Place `count` citadels around `center` within `radiusKm`, maximising spacing.
 *
 * 1. Generate candidates on a Fibonacci / Sunflower spiral (golden angle = 137.508°).
 * 2. Down-select via {@link farthestPointSampling}.
 *
 * @param {{lat: number, lng: number}} center - City center.
 * @param {number} radiusKm - Maximum radius from center in kilometres.
 * @param {number} count - Number of citadels to place.
 * @param {number} seed - PRNG seed (unused here — spiral is deterministic by design).
 * @returns {Array<{id: string, lat: number, lng: number, powerMultiplier: number}>}
 */
export function placeCitadels(center, radiusKm, count, seed) {
  if (count <= 0) return [];

  const candidateCount = Math.max(count * 4, 50);
  const goldenAngle = 137.508;
  const candidates = [];

  for (let i = 0; i < candidateCount; i++) {
    const r = radiusKm * Math.sqrt((i + 0.5) / candidateCount);
    const angle = i * goldenAngle;
    const pos = moveAlongBearing(center.lat, center.lng, angle % 360, r * 1000);
    candidates.push(pos);
  }

  return farthestPointSampling(candidates, count, center);
}

/**
 * Interleave two 4-bit values into an 8-bit Morton (Z-curve) code.
 *
 * @param {number} x - Column index (0–15).
 * @param {number} y - Row index (0–15).
 * @returns {number} Morton code.
 */
function interleave(x, y) {
  let z = 0;
  for (let i = 0; i < 4; i++) {
    z |= ((x >> i) & 1) << (2 * i);
    z |= ((y >> i) & 1) << (2 * i + 1);
  }
  return z;
}

/**
 * Generate exactly `count` evenly-distributed points inside a citadel's Voronoi zone.
 *
 * Algorithm overview:
 *   1. Estimate zone boundary via ray-casting.
 *   2. Compute bounding box.
 *   3. Probe fill ratio on a 25×25 coarse grid.
 *   4. Over-sample on a jittered regular grid, filter to zone-owned points.
 *   5. Stride-select along Morton Z-curve order for even spatial coverage.
 *
 * @param {{id: string, lat: number, lng: number, powerMultiplier: number}} citadel
 *   The target citadel whose zone we are filling.
 * @param {Array<{id: string, lat: number, lng: number, powerMultiplier: number}>} allCitadels
 *   Every citadel in the city (needed for ownership tests).
 * @param {number} count - Exact number of points desired.
 * @param {number} seed - PRNG seed for deterministic jitter.
 * @returns {Array<{lat: number, lng: number}>} Generated positions.
 */
export function distributePointsInZone(citadel, allCitadels, count, seed) {
  if (count <= 0) return [];

  const rng = createRNG(seed);

  /* --- Step 1: Estimate zone boundary --- */
  const boundary = estimateTerritoryBoundary(citadel, allCitadels, 36, 30);
  if (!boundary || boundary.length === 0) return [];

  /* --- Step 2: Bounding box --- */
  const bbox = computeBBox(boundary);
  if (!bbox) return [];

  /* --- Step 3: Probe fill ratio (25×25 coarse grid) --- */
  const probeRows = 25;
  const probeCols = 25;
  const probeLatStep = (bbox.maxLat - bbox.minLat) / probeRows;
  const probeLngStep = (bbox.maxLng - bbox.minLng) / probeCols;
  let insideCount = 0;

  for (let r = 0; r < probeRows; r++) {
    const lat = bbox.minLat + (r + 0.5) * probeLatStep;
    for (let c = 0; c < probeCols; c++) {
      const lng = bbox.minLng + (c + 0.5) * probeLngStep;
      const owner = getOwner(lat, lng, allCitadels);
      if (owner && owner.citadel && owner.citadel.id === citadel.id) {
        insideCount++;
      }
    }
  }

  const totalProbes = probeRows * probeCols; // 625
  const fillRatio = insideCount / totalProbes;
  if (fillRatio < 0.005) return [];

  /* --- Step 4: Grid density --- */
  const oversampled = Math.ceil((count * 1.2) / fillRatio);
  const gridSide = Math.ceil(Math.sqrt(oversampled));

  const latStep = (bbox.maxLat - bbox.minLat) / gridSide;
  const lngStep = (bbox.maxLng - bbox.minLng) / gridSide;

  /* --- Step 5: Jittered grid candidates filtered by ownership --- */
  const candidates = [];

  for (let i = 0; i < gridSide; i++) {
    const baseLat = bbox.minLat + (i + 0.5) * latStep;
    for (let j = 0; j < gridSide; j++) {
      const baseLng = bbox.minLng + (j + 0.5) * lngStep;
      const jLat = baseLat + (rng() - 0.5) * latStep * 0.3;
      const jLng = baseLng + (rng() - 0.5) * lngStep * 0.3;
      const owner = getOwner(jLat, jLng, allCitadels);
      if (owner && owner.citadel && owner.citadel.id === citadel.id) {
        candidates.push({ lat: jLat, lng: jLng, _gi: i, _gj: j });
      }
    }
  }

  if (candidates.length === 0) return [];

  /* --- Step 6: Morton Z-curve stride selection --- */
  /* Assign Morton code based on 16×16 virtual grid within bbox */
  const latRange = bbox.maxLat - bbox.minLat;
  const lngRange = bbox.maxLng - bbox.minLng;

  for (let k = 0; k < candidates.length; k++) {
    const c = candidates[k];
    const mx = Math.min(15, Math.floor(((c.lng - bbox.minLng) / lngRange) * 16));
    const my = Math.min(15, Math.floor(((c.lat - bbox.minLat) / latRange) * 16));
    c._morton = interleave(mx, my);
  }

  candidates.sort((a, b) => a._morton - b._morton || a._gi - b._gi || a._gj - b._gj);

  const resultCount = Math.min(count, candidates.length);
  const stride = candidates.length / resultCount;
  const result = [];

  for (let k = 0; k < resultCount; k++) {
    const idx = Math.floor(k * stride);
    const c = candidates[idx];
    result.push({ lat: c.lat, lng: c.lng });
  }

  return result;
}

/**
 * Assign monster templates to a list of world positions using seeded weighted random selection.
 *
 * @param {Array<{lat: number, lng: number}>} positions - Spawn locations.
 * @param {Array<{id?: string, templateId?: string, name: string, icon: string, weight: number,
 *   level: number, hp: number, damage: number, defense: number, xpReward: number, loot: *}>} templates
 *   Available monster templates with selection weights.
 * @param {string} cityId - Owning city identifier.
 * @param {string} zoneId - Owning zone / citadel identifier.
 * @param {number} seed - PRNG seed for deterministic selection.
 * @returns {Array<Object>} Fully-formed monster objects ready for the game world.
 */
export function assignTemplates(positions, templates, cityId, zoneId, seed) {
  if (!positions || positions.length === 0 || !templates || templates.length === 0) return [];

  const rng = createRNG(seed);

  /* Pre-compute cumulative weight array for O(log n) selection */
  const cumWeights = [];
  let totalWeight = 0;
  for (let i = 0; i < templates.length; i++) {
    totalWeight += (templates[i].weight || 1);
    cumWeights.push(totalWeight);
  }

  const monsters = [];

  for (let p = 0; p < positions.length; p++) {
    const roll = rng() * totalWeight;

    /* Binary search for the selected template */
    let lo = 0;
    let hi = cumWeights.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumWeights[mid] <= roll) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const selected = templates[lo];

    monsters.push({
      type: 'monster',
      lat: positions[p].lat,
      lng: positions[p].lng,
      cityId,
      zoneId,
      templateId: selected.id || selected.templateId,
      name: selected.name,
      icon: selected.icon,
      level: selected.level,
      hp: selected.hp,
      maxHp: selected.hp,
      damage: selected.damage,
      defense: selected.defense,
      xpReward: selected.xpReward,
      loot: selected.loot,
      respawnAt: null,
    });
  }

  return monsters;
}

/**
 * Generate a complete deterministic city layout: citadels, zones, and monsters.
 *
 * Pipeline:
 *   1. Derive seed from city ID.
 *   2. Calculate citadel count from population.
 *   3. Place citadels via Fibonacci spiral + FPS.
 *   4. For each citadel zone, distribute monster positions and assign templates.
 *
 * @param {{id: string, name: string, lat: number, lng: number}} city - City definition.
 * @param {number} population - City population.
 * @param {Array<Object>} templates - Monster template pool (see {@link assignTemplates}).
 * @param {number} [monstersPerZone=250] - Monsters to spawn in each zone.
 * @returns {{
 *   citadels: Array<Object>,
 *   monsters: Array<Object>,
 *   meta: {cityId: string, population: number, citadelCount: number,
 *          totalMonsters: number, monstersPerZone: number, seed: number}
 * }}
 */
export function generateCity(city, population, templates, monstersPerZone = MONSTERS_PER_ZONE) {
  const baseSeed = hashSeed(city.id);

  const citadelCount = citadelCountFromPopulation(population);

  let radiusKm;
  if (population > 1_000_000) {
    radiusKm = 15;
  } else if (population > 500_000) {
    radiusKm = 10;
  } else {
    radiusKm = 7;
  }

  const rawCitadels = placeCitadels(
    { lat: city.lat, lng: city.lng },
    radiusKm,
    citadelCount,
    baseSeed,
  );

  /* Enrich citadels with city-specific metadata */
  const citadels = rawCitadels.map((c, i) => ({
    ...c,
    id: `${city.id}_citadel_${i}`,
    cityId: city.id,
    type: 'castle',
    name: `${city.name} Citadel ${i + 1}`,
    icon: '🏯',
  }));

  /* Generate monsters for every zone */
  const allMonsters = [];

  for (let i = 0; i < citadels.length; i++) {
    const zoneSeed = baseSeed + i * 7919; // prime offset per zone
    const positions = distributePointsInZone(citadels[i], citadels, monstersPerZone, zoneSeed);
    const monsters = assignTemplates(positions, templates, city.id, citadels[i].id, zoneSeed + 1);
    for (let m = 0; m < monsters.length; m++) {
      allMonsters.push(monsters[m]);
    }
  }

  return {
    citadels,
    monsters: allMonsters,
    meta: {
      cityId: city.id,
      population,
      citadelCount,
      totalMonsters: allMonsters.length,
      monstersPerZone,
      seed: baseSeed,
    },
  };
}
