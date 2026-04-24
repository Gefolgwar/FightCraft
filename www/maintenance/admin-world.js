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


// Generates objects and creates World Snapshots (Templates) for each city
window.generateGlobalWorld = async () => {
    const maxCities = CITY_ANCHORS.length;
    const input = prompt(`⚠️ This will generate a World Snapshot Template for each city based on population.\n\nHow many cities do you want to generate? (1-${maxCities})`, maxCities);
    if (!input) return;

    let totalCities = parseInt(input, 10);
    if (isNaN(totalCities) || totalCities < 1) return;
    if (totalCities > maxCities) totalCities = maxCities;

    const container = document.getElementById('world-progress-container');
    const text = document.getElementById('world-progress-text');
    const bar = document.getElementById('world-progress-bar');
    const status = document.getElementById('world-progress-status');

    if (!container || !text || !bar || !status) return;

    container.classList.remove('hidden');

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

            // 2. Build remaining objects using Zone Quotas
            const turf = window.turf || window.Turf;

            const placementOrder = [
                { type: 'castle',  count: counts.castle,  templatesList: castles },
                { type: 'vault',   count: counts.vault,   templatesList: vaults },
                { type: 'shop',    count: counts.shop,    templatesList: shops },
                { type: 'monster', count: counts.monster, templatesList: monsters }
            ];

            // Build a flat, shuffled pool of all objects to place
            const objectPool = [];
            for (const { type, count, templatesList } of placementOrder) {
                if (!templatesList || templatesList.length === 0) continue;
                for (let j = 0; j < count; j++) {
                    const template = getRandomTemplate(templatesList);
                    if (template) objectPool.push({ type, template });
                }
            }
            objectPool.sort(() => Math.random() - 0.5);

            const buildObject = (type, template, lat, lng) => {
                const obj = {
                    id: `${city.id}_${type}_${Math.random().toString(36).substring(2, 9)}`,
                    type, templateId: template.id, name: template.name, icon: template.icon,
                    lat, lng, cityId: city.id, spawnedAt: Date.now()
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

            const zones = (zonesGeoJson && zonesGeoJson.features) ? zonesGeoJson.features : [];
            
            if (zones.length > 0 && turf) {
                const quotaPerZone = Math.ceil(objectPool.length / zones.length);
                
                for (const zone of zones) {
                    const bbox = turf.bbox(zone);
                    let placedInThisZone = 0;
                    let attempts = 0;
                    
                    while (placedInThisZone < quotaPerZone && objectPool.length > 0 && attempts < 10000) {
                        attempts++;
                        const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
                        const lng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
                        
                        if (turf.booleanPointInPolygon([lng, lat], zone)) {
                            const { type, template } = objectPool.pop();
                            cityObjects.push(buildObject(type, template, lat, lng));
                            placedInThisZone++;
                        }
                    }
                }
            }

            // Fallback for any remaining objects (if no zones or leftover rounding)
            const radiusMeters = 9000;
            let fallbackAttempts = 0;
            while (objectPool.length > 0 && fallbackAttempts < 10000) {
                fallbackAttempts++;
                const { type, template } = objectPool.pop();
                let randomAngle = Math.random() * Math.PI * 2;
                let randomDist = Math.random() * radiusMeters;
                const lat = city.lat + (randomDist / 111320) * Math.cos(randomAngle);
                const lng = city.lng + (randomDist / (111320 * Math.cos(city.lat * Math.PI / 180))) * Math.sin(randomAngle);
                
                if (cityBoundary && turf) {
                    try {
                        if (!turf.booleanPointInPolygon([lng, lat], cityBoundary)) {
                            objectPool.push({ type, template });
                            continue;
                        }
                    } catch(e) {}
                }
                cityObjects.push(buildObject(type, template, lat, lng));
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
