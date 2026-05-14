#!/usr/bin/env node
/**
 * Fetch simplified city boundary polygons from Nominatim (OSM).
 *
 * Usage:
 *   node scripts/generators/fetch-city-boundaries.js [--limit N] [--resume] [--delay MS]
 *
 * Options:
 *   --limit N    Process only first N cities (for testing)
 *   --resume     Skip cities already in output file
 *   --delay MS   Delay between requests in ms (default: 1100, Nominatim rate limit)
 *
 * Output: www/gameplay/world_cities_boundaries.json
 *
 * Nominatim usage policy: max 1 request/second, must include User-Agent.
 * https://operations.osmfoundation.org/policies/nominatim/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const CITIES_PATH = path.join(__dirname, '../../www/gameplay/world_cities.json');
const OUTPUT_PATH = path.join(__dirname, '../../www/gameplay/world_cities_boundaries.json');
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'FightCraft-BoundaryFetcher/1.0 (game project)';
const DEFAULT_DELAY = 1100; // ms between requests (Nominatim rate limit: 1/sec)
const POLYGON_THRESHOLD = 0.002; // ~220m tolerance for simplification
const SAVE_INTERVAL = 50; // Save progress every N cities

// ── Parse CLI args ──
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
}
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : Infinity;
const RESUME = args.includes('--resume');
const DELAY = getArg('--delay') ? parseInt(getArg('--delay')) : DEFAULT_DELAY;

// ── HTTP fetch helper ──
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Polygon simplification (Douglas-Peucker) ──
function perpDistance(point, lineStart, lineEnd) {
  const [x, y] = point;
  const [x1, y1] = lineStart;
  const [x2, y2] = lineEnd;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt((x - x1) ** 2 + (y - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.sqrt((x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2);
}

function simplifyDP(points, epsilon) {
  if (points.length <= 2) return points;
  let maxDist = 0, maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = simplifyDP(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyDP(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[points.length - 1]];
}

function simplifyPolygon(coords, epsilon = 0.001) {
  if (!Array.isArray(coords)) return coords;
  // Handle MultiPolygon and Polygon
  if (typeof coords[0][0] === 'number') {
    // This is a ring of [lng, lat] pairs
    return simplifyDP(coords, epsilon);
  }
  return coords.map(ring => simplifyPolygon(ring, epsilon));
}

// ── Extract boundary from Nominatim response ──
function extractBoundary(geojson, cityId) {
  if (!geojson.features || geojson.features.length === 0) return null;

  // Filter out definitely bad types
  const strictlySafeFeatures = geojson.features.filter(f => {
    const at = f.properties?.addresstype;
    // Forbid these entirely
    return !['state', 'country', 'region', 'suburb', 'borough', 'quarter', 'neighbourhood', 'county', 'city_block'].includes(at);
  });

  if (strictlySafeFeatures.length === 0) {
    return null; // Reject completely!
  }

  // Prioritize exact matches for city/town/municipality
  const validFeatures = strictlySafeFeatures.filter(f => {
    const at = f.properties?.addresstype;
    return ['city', 'town', 'municipality', 'village'].includes(at);
  });
  
  const featuresToSearch = validFeatures.length > 0 ? validFeatures : strictlySafeFeatures;

  const feat = featuresToSearch.find(f =>
    f.properties?.category === 'boundary' && f.properties?.type === 'administrative'
  ) || featuresToSearch[0];

  const geom = feat?.geometry;
  if (!geom) return null;

  if (geom.type === 'Polygon') {
    const simplified = simplifyPolygon(geom.coordinates, POLYGON_THRESHOLD);
    const pointCount = simplified[0]?.length || 0;
    return { type: 'Polygon', coordinates: simplified, pointCount };
  }
  if (geom.type === 'MultiPolygon') {
    let largest = geom.coordinates[0];
    let maxLen = largest?.[0]?.length || 0;
    for (const poly of geom.coordinates) {
      if (poly[0] && poly[0].length > maxLen) {
        maxLen = poly[0].length;
        largest = poly;
      }
    }
    const simplified = simplifyPolygon(largest, POLYGON_THRESHOLD);
    const pointCount = simplified[0]?.length || 0;
    return { type: 'Polygon', coordinates: simplified, pointCount };
  }

  return null;
}

// ── Country code to name mapping for better search ──
const COUNTRY_NAMES = {
  'DE': 'Germany', 'UA': 'Ukraine', 'PL': 'Poland', 'FR': 'France',
  'GB': 'United Kingdom', 'US': 'United States', 'JP': 'Japan',
  'CN': 'China', 'IN': 'India', 'BR': 'Brazil', 'RU': 'Russia',
  'IT': 'Italy', 'ES': 'Spain', 'AU': 'Australia', 'CA': 'Canada',
  'KR': 'South Korea', 'TR': 'Turkey', 'MX': 'Mexico', 'ID': 'Indonesia',
  'NG': 'Nigeria', 'EG': 'Egypt', 'ZA': 'South Africa', 'AR': 'Argentina',
  'SA': 'Saudi Arabia', 'TH': 'Thailand', 'PH': 'Philippines',
};

// ── Main ──
async function main() {
  console.log('=== FightCraft City Boundary Fetcher ===\n');

  // Load cities
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
  console.log(`Loaded ${cities.length} cities from ${CITIES_PATH}`);

  // Load existing results if resuming
  let results = {};
  if (RESUME && fs.existsSync(OUTPUT_PATH)) {
    results = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
    console.log(`Resuming: ${Object.keys(results).length} cities already fetched`);
  }

  const toProcess = cities.slice(0, LIMIT);
  let processed = 0, success = 0, failed = 0, skipped = 0;

  console.log(`Processing ${toProcess.length} cities (delay: ${DELAY}ms)\n`);

  for (const city of toProcess) {
    processed++;

    // Skip if already fetched
    if (RESUME && results[city.id]) {
      skipped++;
      continue;
    }

    const pct = ((processed / toProcess.length) * 100).toFixed(1);
    process.stdout.write(`[${pct}%] ${processed}/${toProcess.length} ${city.name} (${city.country})... `);

    try {
      // Search Nominatim
      const query = encodeURIComponent(`${city.name}, ${COUNTRY_NAMES[city.country] || city.country}`);
      const url = `${NOMINATIM_BASE}?q=${query}&format=geojson&polygon_geojson=1&polygon_threshold=${POLYGON_THRESHOLD}&limit=3`;

      const data = await fetchJSON(url);
      const boundary = extractBoundary(data, city.id);

      if (boundary) {
        results[city.id] = {
          boundary: boundary.coordinates,
          type: boundary.type,
          points: boundary.pointCount,
          source: 'nominatim',
        };
        success++;
        console.log(`✓ ${boundary.pointCount} points`);
      } else {
        results[city.id] = { boundary: null, source: 'nominatim', error: 'no_polygon' };
        failed++;
        console.log('✗ no polygon found');
      }
    } catch (e) {
      results[city.id] = { boundary: null, source: 'nominatim', error: e.message.substring(0, 100) };
      failed++;
      console.log(`✗ ${e.message.substring(0, 60)}`);
    }

    // Save progress periodically
    if (processed % SAVE_INTERVAL === 0) {
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results), 'utf8');
      console.log(`  [saved progress: ${Object.keys(results).length} cities]`);
    }

    // Rate limit
    await sleep(DELAY);
  }

  // Final save
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results), 'utf8');

  // Stats
  const totalPoints = Object.values(results).reduce((sum, r) => sum + (r.points || 0), 0);
  const fileSize = (fs.statSync(OUTPUT_PATH).size / 1024 / 1024).toFixed(2);

  console.log('\n=== Done ===');
  console.log(`Total:    ${processed} cities processed`);
  console.log(`Success:  ${success} boundaries found`);
  console.log(`Failed:   ${failed} no polygon / error`);
  console.log(`Skipped:  ${skipped} (already fetched)`);
  console.log(`Points:   ${totalPoints} total coordinate points`);
  console.log(`File:     ${OUTPUT_PATH} (${fileSize} MB)`);
}

main().catch(e => {
  console.error('\nFatal error:', e);
  process.exit(1);
});
