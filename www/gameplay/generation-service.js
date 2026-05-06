
// Generation Service - Handles OpenStreetMap Logic
// Call this from admin-monsters.js

const OVERPASS_API = "https://overpass-api.de/api/interpreter";

/**
 * Main function to generate monsters based on OSM data
 * @param {Object} cityCenter {lat, lng}
 * @param {number} radius Radius in meters
 * @param {Array} selectedTemplates List of template objects to spawn
 * @param {Object} options { timeOfDay: 'day'|'night', strictSafety: true }
 */
export async function generateMonstersFromOSM(cityCenter, radius, selectedTemplates, options = {}) {
    console.log(`🌍 Starting OSM Generation for ${cityCenter.lat}, ${cityCenter.lng} (r=${radius}m)`);
    const startTime = Date.now();

    // 1. Build Query
    const query = buildOverpassQuery(cityCenter.lat, cityCenter.lng, radius);

    // 2. Fetch Data
    let elements = [];
    try {
        elements = await fetchOverpassData(query);
        console.log(`📦 Received ${elements.length} OSM elements in ${(Date.now() - startTime) / 1000}s`);
    } catch (e) {
        console.error("OSM Fetch Error", e);
        throw new Error("Failed to fetch map data. Check internet or try smaller radius.");
    }

    // 3. Process & Categorize Points
    const spawnPoints = processOSMElements(elements, options);
    console.log(`📍 Identified ${spawnPoints.length} valid spawn points`);

    if (spawnPoints.length === 0) return [];

    // 4. Assign Monsters to Points
    const monsters = assignMonstersToPoints(spawnPoints, selectedTemplates, options);

    return monsters;
}

function buildOverpassQuery(lat, lng, radius) {
    // Radius in Overpass is meters
    return `
        [out:json][timeout:25];
        (
          // Water (Water Monsters)
          way["natural"="water"](around:${radius},${lat},${lng});
          relation["natural"="water"](around:${radius},${lat},${lng});
          
          // Nature (Forest/Park)
          way["leisure"="park"](around:${radius},${lat},${lng});
          way["landuse"="forest"](around:${radius},${lat},${lng});
          way["natural"="wood"](around:${radius},${lat},${lng});
          
          // Urban
          way["landuse"="residential"](around:${radius},${lat},${lng});
          way["landuse"="commercial"](around:${radius},${lat},${lng});
          
          // Special POIs
          node["amenity"="grave_yard"](around:${radius},${lat},${lng});
          node["historic"="monument"](around:${radius},${lat},${lng});
          node["tourism"="attraction"](around:${radius},${lat},${lng});
          
          // Safety: Paths to snap to
          way["highway"~"footway|pedestrian|path|cycleway"](around:${radius},${lat},${lng});
        );
        out center;
    `;
}

async function fetchOverpassData(qlQuery) {
    const body = "data=" + encodeURIComponent(qlQuery);

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
        try {
            const response = await fetch(OVERPASS_API, {
                method: "POST",
                body: body,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            });

            if (response.status === 429) {
                // Too Many Requests - Wait and Retry
                retries++;
                const delay = retries * 2000; // 2s, 4s, 6s
                console.warn(`⏳ Overpass 429 (Rate Limit). Retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }

            if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);
            const data = await response.json();
            return data.elements;

        } catch (e) {
            if (retries >= maxRetries - 1) throw e;
            retries++;
            await new Promise(r => setTimeout(r, 1000)); // Basic network error retry
        }
    }
}

function processOSMElements(elements, options) {
    const points = [];
    const safePaths = []; // Store footways to check distance if needed

    // First pass: Index paths (nodes) if we need strict safety snapping
    // To do strict "10m distance" check properly without Turf.js is hard on just bounding boxes.
    // We will extract nodes from ways if available, or just use the center points of ways.
    // Note: Overpass "out center" gives us the center of ways.

    if (options.strictSafety !== false) { // Default to true if not specified
        elements.forEach(el => {
            if (el.tags && el.tags.highway && (el.tags.highway === 'footway' || el.tags.highway === 'pedestrian' || el.tags.highway === 'path')) {
                // Store the center of the path segment
                const lat = el.lat || (el.center && el.center.lat);
                const lng = el.lon || (el.center && el.center.lon);
                if (lat && lng) safePaths.push({ lat, lng });
            }
        });
    }

    elements.forEach(el => {
        const lat = el.lat || (el.center && el.center.lat);
        const lng = el.lon || (el.center && el.center.lon);

        if (!lat || !lng) return;

        // Categorize Biome
        let biome = 'generic';
        let specialType = null;
        let quality = 1; // 1 = Normal, 2 = Elite, 3 = Boss

        const t = el.tags || {};

        // Biome Logic
        if (t.natural === 'water' || t.waterway) biome = 'water';
        else if (t.leisure === 'park' || t.landuse === 'forest' || t.natural === 'wood') biome = 'park';
        else if (t.landuse === 'residential' || t.landuse === 'commercial') biome = 'city';
        else if (t.amenity === 'grave_yard') { biome = 'dungeon'; specialType = 'undead'; }
        else if (t.historic === 'monument') { biome = 'dungeon'; quality = 2; }
        else if (t.tourism === 'attraction') { biome = 'city'; quality = 2; }

        // Skip highways themselves for basic monster base (unless we want path monsters)
        if (t.highway) return;

        // SAFETY CHECK: 10m from path
        // 10m is roughly 0.0001 degrees
        if (options.strictSafety !== false && safePaths.length > 0) {

            // Simple optimization: check if any path node is within ~0.00015 deg (approx 15m)
            // This is O(N*M) which is bad if N and M are large. 
            // For 2000 elements it is 4,000,000 ops, manageable in modern JS (fraction of a second)
            // But let's verify.

            let isSafe = false;
            for (const pathPoint of safePaths) {
                const dy = Math.abs(lat - pathPoint.lat);
                const dx = Math.abs(lng - pathPoint.lng);
                // quick box check
                if (dy < 0.00015 && dx < 0.00015) {
                    isSafe = true;
                    break;
                }
            }

            if (!isSafe) {
                // Skip this unsafe point
                return;
            }
        }

        points.push({
            lat, lng, biome, specialType, quality
        });
    });

    return points;
}

function assignMonstersToPoints(points, templates, options) {
    const generated = [];
    const { timeOfDay } = options;

    // Group templates by tag/biome
    const templatesByBiome = {
        water: templates.filter(t => t.tag === 'water'),
        park: templates.filter(t => t.tag === 'park'),
        city: templates.filter(t => t.tag === 'city'),
        dungeon: templates.filter(t => t.tag === 'dungeon'),
        generic: templates.filter(t => !t.tag || t.tag === 'generic')
    };

    // Ensure generic fallback exists
    if (templatesByBiome.generic.length === 0) {
        templatesByBiome.generic = templates;
    }

    points.forEach(point => {
        // Find matching templates
        let available = [];

        // Exact match
        if (point.biome && templatesByBiome[point.biome] && templatesByBiome[point.biome].length > 0) {
            available = templatesByBiome[point.biome];
        } else {
            // Fallback to generic
            available = templatesByBiome.generic;
        }

        if (available.length === 0 && templatesByBiome.generic.length > 0) {
            available = templatesByBiome.generic;
        }

        if (available.length === 0) return; // No template fits

        // Pick random template based on weight
        const t = weightedRandom(available);

        // Finalize Monster Object
        // Add random jitter (1-5m) to prevent perfect stacking if multiple spawn on same node
        const jitterLat = (Math.random() - 0.5) * 0.00005;
        const jitterLng = (Math.random() - 0.5) * 0.00005;

        // CRITICAL: Ensure NO undefined values
        const monster = {
            type: 'monster',
            lat: point.lat + jitterLat,
            lng: point.lng + jitterLng,
            templateId: t.id || 'unknown',
            name: t.name || 'Unknown Monster',
            icon: t.icon || '👾',
            level: t.level || 1,
            hp: t.hp || 100,
            maxHp: t.maxHp || t.hp || 100,
            damage: t.damage || 10,
            defense: t.defense || 0,
            xpReward: t.xpReward || 10,
            loot: t.loot || [],
            biome: point.biome || 'generic'
        };

        // Rarity/Quality Buffs
        if (point.quality > 1) {
            monster.level += 2;
            monster.maxHp = Math.round(monster.maxHp * 1.5);
            monster.hp = monster.maxHp;
            monster.name = `Elite ${monster.name}`;
            monster.xpReward = Math.round(monster.xpReward * 1.5);
        }

        // Special Types (Undead)
        if (point.specialType === 'undead') {
            // Try to force undead visuals if we can, or just buff
            monster.name = `Undead ${monster.name}`;
            monster.defense += 2;
        }

        // Time of Day Modifier
        if (timeOfDay === 'night') {
            // Increase shadow monsters or generalize to "+50% stronger" / "Shadow" prefix
            // Here we assume "Shadow" prefix for simplicity as we don't have a "Shadow" tag yet
            if (point.biome === 'dungeon' || point.biome === 'city') {
                if (Math.random() < 0.5) { // 50% chance
                    monster.name = `Shadow ${monster.name}`;
                    monster.damage = Math.round(monster.damage * 1.5);
                }
            }
        }

        generated.push(monster);
    });

    return generated;
}

function weightedRandom(items) {
    if (!items || items.length === 0) return null;

    const total = items.reduce((sum, i) => sum + (i.weight || 10), 0);
    const rnd = Math.random() * total;
    let cur = 0;

    for (const i of items) {
        cur += (i.weight || 10);
        if (rnd <= cur) return i;
    }
    return items[0];
}
