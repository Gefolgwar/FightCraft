#!/usr/bin/env node
/**
 * Fetch POIs for Citadel placement from Overpass API.
 *
 * Usage:
 *   node scripts/generators/fetch-city-pois.js [--limit N] [--resume] [--delay MS]
 *
 * Output: www/gameplay/world_cities_pois.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ── Config ──
const CITIES_PATH = path.join(__dirname, '../../www/gameplay/world_cities.json');
const OUTPUT_PATH = path.join(__dirname, '../../www/gameplay/world_cities_pois.json');
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';
const DEFAULT_DELAY = 2000; // Overpass needs generous delays
const SAVE_INTERVAL = 10;

const args = process.argv.slice(2);
function getArg(name) {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : null;
}
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : Infinity;
const RESUME = args.includes('--resume');
const DELAY = getArg('--delay') ? parseInt(getArg('--delay')) : DEFAULT_DELAY;

function fetchOverpass(query) {
    return new Promise((resolve, reject) => {
        const data = "data=" + encodeURIComponent(query);
        const urlObj = new URL(OVERPASS_API);
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(data),
                'User-Agent': 'FightCraft-POIFetcher/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode === 429) {
                    return reject(new Error('Rate Limited (429)'));
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode}`));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log('=== FightCraft City POI Fetcher ===\n');

    const cities = JSON.parse(fs.readFileSync(CITIES_PATH, 'utf8'));
    console.log(`Loaded ${cities.length} cities`);

    let results = {};
    if (RESUME && fs.existsSync(OUTPUT_PATH)) {
        results = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
        console.log(`Resuming: ${Object.keys(results).length} cities already fetched`);
    }

    const toProcess = cities.slice(0, LIMIT);
    let processed = 0, success = 0, failed = 0, skipped = 0;

    for (const city of toProcess) {
        processed++;

        if (RESUME && results[city.id] && !results[city.id].error) {
            skipped++;
            continue;
        }

        const pct = ((processed / toProcess.length) * 100).toFixed(1);
        process.stdout.write(`[${pct}%] ${processed}/${toProcess.length} ${city.name}... `);

        // Calculate a search radius based on population (roughly)
        let baseRadius = 5000;
        if (city.population > 5000000) baseRadius = 20000;
        else if (city.population > 1000000) baseRadius = 15000;
        else if (city.population > 500000) baseRadius = 10000;

        let attempt = 0;
        let successFetch = false;
        let currentRadius = baseRadius;

        while (attempt < 3 && !successFetch) {
            attempt++;
            const query = `
                [out:json][timeout:60];
                (
                    nwr["historic"~"castle|monument|memorial"](around:${currentRadius},${city.lat},${city.lng});
                    nwr["tourism"="museum"](around:${currentRadius},${city.lat},${city.lng});
                    nwr["amenity"~"townhall|library|university|bus_station|arts_centre|place_of_worship"](around:${currentRadius},${city.lat},${city.lng});
                    nwr["railway"~"station|subway_entrance"](around:${currentRadius},${city.lat},${city.lng});
                    nwr["leisure"~"park|square|viewpoint|stadium"](around:${currentRadius},${city.lat},${city.lng});
                );
                out center;
            `;

            try {
                const data = await fetchOverpass(query);
                const elements = data.elements || [];

                const pois = elements.map(e => {
                    const lat = e.center ? e.center.lat : e.lat;
                    const lng = e.center ? e.center.lon : e.lon;
                    const name = e.tags && (e.tags.name || e.tags['name:en'] || "Unknown");
                    let type = "poi";
                    if (e.tags) {
                        if (e.tags.historic) type = "historic_" + e.tags.historic;
                        else if (e.tags.tourism) type = "tourism_" + e.tags.tourism;
                        else if (e.tags.amenity) type = "amenity_" + e.tags.amenity;
                        else if (e.tags.railway) type = "railway_" + e.tags.railway;
                        else if (e.tags.leisure) type = "leisure_" + e.tags.leisure;
                    }
                    return { lat, lng, name, type };
                }).filter(p => p.lat && p.lng);

                results[city.id] = { pois };
                if (results[city.id].error) delete results[city.id].error;

                success++;
                console.log(`✓ ${pois.length} POIs (radius: ${currentRadius}m)`);
                successFetch = true;
            } catch (e) {
                if (e.message.includes('429')) {
                    console.log(`  [Attempt ${attempt}] Rate limited (429). Waiting 15s...`);
                    await sleep(15000);
                } else if (e.message.includes('504') || e.message.includes('502') || e.message.includes('timeout')) {
                    console.log(`  [Attempt ${attempt}] Timeout/Gateway Error (${e.message}). Halving radius and waiting 5s...`);
                    currentRadius = Math.floor(currentRadius / 2);
                    await sleep(5000);
                } else {
                    console.log(`  [Attempt ${attempt}] Hard error: ${e.message}`);
                    break;
                }
            }
        }

        if (!successFetch) {
            results[city.id] = { pois: [], error: "Failed after retries" };
            failed++;
            console.log(`✗ Failed completely after retries.`);
        }

        if (processed % SAVE_INTERVAL === 0) {
            fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results), 'utf8');
        }

        await sleep(DELAY);
    }

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results), 'utf8');
    console.log(`\n=== Done ===\nSuccess: ${success}, Failed: ${failed}, Skipped: ${skipped}`);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});