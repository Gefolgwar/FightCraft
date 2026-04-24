import { getDB, getTemplates, saveCityZones, saveWorldSnapshot } from '../firebase/firebase-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';
import { generateCityTerritory } from '../map/territory-service.js';
import { generateCitadelsAndZones } from './admin-citadel-generator.js';
import { OverpassService } from '../map/overpass-service.js';
import { collection, writeBatch, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Helper for delays
const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchCityPopulation(city) {
    const query = `[out:json][timeout:10];
    (
        node(around:20000, ${city.lat}, ${city.lng})["place"~"city|town|municipality"]["name"="${city.name}"];
        node(around:20000, ${city.lat}, ${city.lng})["place"~"city|town|municipality"]["name:en"="${city.name}"];
    );
    out tags;`;

    const data = await OverpassService.fetchJSON(query);

    if (!data || !data.elements || data.elements.length === 0) {
        throw new Error(`OSM node for ${city.name} not found.`);
    }

    const populationStr = data.elements[0].tags.population;
    if (!populationStr) {
        throw new Error(`Population tag missing for ${city.name}.`);
    }

    const population = parseInt(populationStr, 10);
    if (isNaN(population)) {
        throw new Error(`Invalid population data for ${city.name}: ${populationStr}`);
    }

    return population;
};

// ---------------------------------------------------------------------------
// Haversine distance (meters)
// ---------------------------------------------------------------------------
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1 * Math.PI / 180)
        * Math.cos(lat2 * Math.PI / 180)
        * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function metresToLatDeg(metres) {
    return metres / 111320;
}

function metresToLngDeg(metres, lat) {
    return metres / (111320 * Math.cos(lat * Math.PI / 180));
}

function buildCityGrid(cityAnchor, radiusMetres, spacingMetres) {
    const cells = [];
    const stepsPerAxis = Math.ceil(radiusMetres / spacingMetres);
    const jitterMax = spacingMetres / 4; 

    const innerRadius  = radiusMetres * 0.35;
    const middleRadius = radiusMetres * 0.70;

    for (let row = -stepsPerAxis; row <= stepsPerAxis; row++) {
        for (let col = -stepsPerAxis; col <= stepsPerAxis; col++) {
            const cellLatMetres = row * spacingMetres;
            const cellLngMetres = col * spacingMetres;

            const dist = Math.sqrt(cellLatMetres ** 2 + cellLngMetres ** 2);
            if (dist > radiusMetres) continue;

            const jitterLat = (Math.random() * 2 - 1) * metresToLatDeg(jitterMax);
            const jitterLng = (Math.random() * 2 - 1) * metresToLngDeg(jitterMax, cityAnchor.lat);

            const lat = cityAnchor.lat + metresToLatDeg(cellLatMetres) + jitterLat;
            const lng = cityAnchor.lng + metresToLngDeg(cellLngMetres, cityAnchor.lat) + jitterLng;

            const actualDist = haversineMeters(cityAnchor.lat, cityAnchor.lng, lat, lng);
            const ring = actualDist <= innerRadius  ? 0
                       : actualDist <= middleRadius ? 1
                       :                              2;

            cells.push({ lat, lng, ring, distMetres: actualDist });
        }
    }
    return cells;
}

const ENTITY_RING_PREFERENCE = {
    citadel: 2, 
    castle:  2, 
    vault:   1, 
    shop:    0, 
    monster: 0
};

// Generates objects and creates World Snapshots (Templates) for each city
window.generateGlobalWorld = async () => {
    if (!confirm("⚠️ This will generate a World Snapshot Template for each city based on population. These snapshots will NOT be deployed live automatically. You can review and apply them from the templates menu. Continue?")) return;

    const container = document.getElementById('world-progress-container');
    const text = document.getElementById('world-progress-text');
    const bar = document.getElementById('world-progress-bar');
    const status = document.getElementById('world-progress-status');

    if (!container || !text || !bar || !status) return;

    container.classList.remove('hidden');
    let totalCities = CITY_ANCHORS.length;

    try {
        status.textContent = "Loading templates...";
        bar.style.width = "5%";
        
        const [monsters, shops, vaults, allCastles] = await Promise.all([
            getTemplates('monster'),
            getTemplates('shop'),
            getTemplates('vault'),
            getTemplates('castle')
        ]);

        // Citadels are stored as type 'castle'
        const citadels = allCastles.filter(t =>
            t.icon === '🏯' ||
            (t.name && t.name.includes('Citadel')) ||
            (t.id && t.id.includes('citadel'))
        );
        const castles = allCastles.filter(t => !citadels.includes(t));
        
        const getRandomTemplate = (templatesList) => {
            if (!templatesList || templatesList.length === 0) return null;
            return templatesList[Math.floor(Math.random() * templatesList.length)];
        };

        const radiusMeters = 9000; 

        for (let i = 0; i < totalCities; i++) {
            const city = CITY_ANCHORS[i];

            status.textContent = `Fetching population for ${city.name} from OSM...`;
            const population = await fetchCityPopulation(city);
            await delay(1000); // Throttling for Overpass API

            // STRICT Ratios
            const counts = {
                monster: Math.max(1, Math.round(population / 1000)),
                shop:    Math.max(1, Math.round(population / 16000)),
                vault:   Math.max(1, Math.round(population / 34782.6087)),
                castle:  Math.max(1, Math.round(population / 5000)),
                citadel: Math.max(1, Math.round(population / 190476.1905)) // E.g. Berlin(4m) = 21
            };

            const totalCityObjects = counts.monster + counts.shop + counts.vault + counts.castle;

            text.textContent = `${i + 1} / ${totalCities} Cities`;
            bar.style.width = `${5 + ((i / totalCities) * 90)}%`;
            status.textContent = `Building ${city.name} (${counts.citadel} citadels, ${totalCityObjects} others)...`;

            // 1. Generate Citadels and Zones via Shared Service
            status.textContent = `Fetching OSM data for ${city.name}...`;
            const { finalCitadels, zonesGeoJson, cityBoundary } = await generateCitadelsAndZones(
                city.id,
                counts.citadel,
                citadels // the templates
            );

            const cityObjects = [...finalCitadels];

            // 2. Build remaining objects (Monsters, Shops, Vaults, Castles) using grid
            const radiusMeters = 9000;
            const area = Math.PI * (radiusMeters ** 2);
            let spacingMeters = Math.sqrt(area / (totalCityObjects * 1.5));
            if (spacingMeters > 500) spacingMeters = 500;
            if (spacingMeters < 50) spacingMeters = 50;

            // Fetch Turf locally if needed for boundary checking
            const turf = window.turf || window.Turf;

            const gridCells = buildCityGrid(city, radiusMeters, spacingMeters);
            gridCells.sort(() => Math.random() - 0.5);

            const availableRings = { 0: [], 1: [], 2: [] };
            for (const cell of gridCells) {
                // If we have a true city boundary, throw away grid cells outside of it
                if (cityBoundary && turf) {
                    try {
                        if (!turf.booleanPointInPolygon([cell.lng, cell.lat], cityBoundary)) {
                            continue; // Skip cells outside city
                        }
                    } catch(e) {}
                }
                availableRings[cell.ring].push(cell);
            }

            const pickCell = (preferredRing) => {
                const searchOrder = [preferredRing, (preferredRing + 1) % 3, (preferredRing + 2) % 3];
                for (const ring of searchOrder) {
                    if (availableRings[ring].length > 0) return availableRings[ring].pop();
                }
                // Fallback inside city bounds
                let randomAngle = Math.random() * Math.PI * 2;
                let randomDist = Math.random() * radiusMeters;
                return {
                    lat: city.lat + (randomDist / 111320) * Math.cos(randomAngle),
                    lng: city.lng + (randomDist / (111320 * Math.cos(city.lat * Math.PI / 180))) * Math.sin(randomAngle)
                };
            };

            const buildObject = (type, template, cell) => {
                const obj = {
                    id: `${city.id}_${type}_${Math.random().toString(36).substring(2, 9)}`,
                    type, templateId: template.id, name: template.name, icon: template.icon,
                    lat: cell.lat, lng: cell.lng, cityId: city.id, spawnedAt: Date.now()
                };
                if (type === 'monster') {
                    obj.level = template.level || 1; obj.hp = template.hp || 20; obj.maxHp = template.maxHp || 20;
                    obj.damage = template.damage || 5; obj.defense = template.defense || 0;
                    obj.xpReward = template.xpReward || 10; obj.goldReward = template.goldReward || 5;
                } else if (type === 'shop') {
                    obj.shopType = template.name; obj.inventory = template.inventory || [];
                }
                return obj;
            };

            const placementOrder = [
                { type: 'castle',  count: counts.castle,  templatesList: castles },
                { type: 'vault',   count: counts.vault,   templatesList: vaults },
                { type: 'shop',    count: counts.shop,    templatesList: shops },
                { type: 'monster', count: counts.monster, templatesList: monsters }
            ];
            // Notice: 'citadel' is removed from the loop because they are already in `cityObjects`

            for (const { type, count, templatesList } of placementOrder) {
                if (!templatesList || templatesList.length === 0) continue;
                const preferredRing = ENTITY_RING_PREFERENCE[type];
                for (let j = 0; j < count; j++) {
                    const template = getRandomTemplate(templatesList);
                    if (!template) continue;
                    const cell = pickCell(preferredRing);
                    cityObjects.push(buildObject(type, template, cell));
                }
            }

            // 3. Save Snapshots
            const CHUNK_SIZE = 3000;
            for (let chunkIndex = 0; chunkIndex < cityObjects.length; chunkIndex += CHUNK_SIZE) {
                const chunk = cityObjects.slice(chunkIndex, chunkIndex + CHUNK_SIZE);
                const snapshotName = cityObjects.length <= CHUNK_SIZE
                    ? `Global Generation - ${city.name}`
                    : `Global Generation - ${city.name} (Part ${Math.floor(chunkIndex / CHUNK_SIZE) + 1})`;

                const snapshotData = {
                    id: `GlobalGen_${city.id}_${Date.now()}_${chunkIndex}`,
                    name: snapshotName,
                    description: `Auto-generated from global world algorithm (${chunk.length} objects)`,
                    cityId: city.id, type: 'mixed', objects: chunk,
                    zones: (chunkIndex === 0 && zonesGeoJson) ? JSON.stringify(zonesGeoJson) : null
                };

                status.textContent = `Saving Snapshot Template: ${snapshotName}...`;
                const success = await saveWorldSnapshot(snapshotData);
                if (!success) {
                    console.error(`Failed to save snapshot for ${city.name}`);
                }
                await delay(300);
            }

            // HUGE DELAY TO PREVENT OVERPASS 429 ON NEXT CITY
            status.textContent = `Cooldown to prevent Overpass limits...`;
            await delay(3000);
        }

        bar.style.width = `100%`;
        status.textContent = `✅ GLOBAL TEMPLATES CREATED SUCCESSFULLY!`;
        status.classList.remove('text-gray-500', 'text-gray-400');
        status.classList.add('text-green-400');

        setTimeout(() => {
            container.classList.add('hidden');
            status.classList.remove('text-green-400');
            status.classList.add('text-gray-500');
            status.textContent = `Initializing...`;
            bar.style.width = `0%`;
            text.textContent = ``;
        }, 5000);

    } catch (error) {
        console.error("World Generation Error:", error);
        status.textContent = `❌ Error: ${error.message}`;
        status.classList.remove('text-gray-400');
        status.classList.add('text-red-500');
    }
};
