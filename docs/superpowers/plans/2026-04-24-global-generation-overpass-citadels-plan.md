# Global Generation Overpass Citadels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `admin-world.js` to strictly generate citadels from real-world OSM data with precise boundaries and exact population ratios, reusing the algorithm from `admin-citadels.js`.

**Architecture:** We will extract the complex OSM fetching, boundary masking (Turf.js), and Furthest Point Sampling algorithm from `admin-citadels.js` into a shared utility file (`admin-citadel-generator.js`). Both `admin-citadels.js` and `admin-world.js` will import and use this. Then, `admin-world.js` will use the precise city boundaries to ensure all other generated objects (monsters, shops) stay perfectly within city limits.

**Tech Stack:** JavaScript (ES6 Modules), Turf.js, Overpass API, Firebase Firestore.

---

### Task 1: Create `admin-citadel-generator.js`

Extract the citadel fetching and generation logic into a reusable utility.

**Files:**
- Create: `www/maintenance/admin-citadel-generator.js`

- [ ] **Step 1: Write the shared generation function**

```javascript
import { OverpassService } from '../map/overpass-service.js';
import { generateCityTerritory } from '../map/territory-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';

/**
 * Ensures Turf is loaded on window
 */
async function ensureTurf() {
    if (window.turf || window.Turf) return window.turf || window.Turf;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
        script.onload = () => resolve(window.turf || window.Turf);
        script.onerror = () => reject(new Error("Failed to load Turf.js"));
        document.head.appendChild(script);
    });
}

/**
 * Fetches citadels from OSM, filters by boundary, applies FPS, and generates zones.
 */
export async function generateCitadelsAndZones(cityKey, capacity, templates, activeRulesMap = null) {
    const city = CITY_ANCHORS.find(c => c.id === cityKey);
    if (!city) throw new Error("Invalid city");

    const turf = await ensureTurf();
    
    // 1. Resolve Area ID & Boundary
    const ctx = await OverpassService.fetchCityContext(city.name, { lat: city.lat, lng: city.lng }, { includeDistricts: false });
    let cityRelId = ctx.boundaryId || null;
    let areaId = cityRelId ? 3600000000 + cityRelId : null;
    let cityBoundary = null;

    if (ctx.boundary) {
        try {
            const rawGeo = turf.multiPolygon(ctx.boundary.map(r => [r]));
            cityBoundary = turf.buffer(rawGeo, 0); // Fix intersections
        } catch (e) {
            console.error("Geometry error:", e);
        }
    }

    // 2. Build Query
    let queryFilters = "";
    const rulesToUse = activeRulesMap || new Map(templates.map(t => [t.id, 100]));
    
    rulesToUse.forEach((weight, id) => {
        if (weight <= 0) return;
        const t = templates.find(temp => temp.id === id);
        if (!t || !t.osmTag) return;

        t.osmTag.split(';').forEach(tagSet => {
            const trimmed = tagSet.trim();
            if (!trimmed) return;
            const isRegex = trimmed.includes('~');
            const parts = trimmed.split(/[=~]/);
            const key = parts[0].trim();
            const val = parts[1] ? parts[1].trim() : '';
            const op = isRegex ? '~' : '=';
            let tagPart = (val && val !== '*') ? `["${key}"${op}"${val}"]` : `["${key}"]`;

            if (key === 'boundary' || val === 'administrative') {
                tagPart += '["admin_level"!~"^[1234567]$"]';
            }

            if (areaId) {
                queryFilters += `nwr${tagPart}(area:${areaId});\n`;
            } else {
                queryFilters += `nwr${tagPart}(around:15000,${city.lat},${city.lng});\n`;
            }
        });
    });

    let processedCitadels = [];
    if (queryFilters) {
        const query = `[out:json][timeout:60]; (\n${queryFilters}); out center;`;
        const data = await OverpassService.fetchJSON(query);
        
        data.elements.forEach(node => {
            const lat = node.lat || (node.center && node.center.lat);
            const lng = node.lon || (node.center && node.center.lon);
            if (!lat || !lng) return;

            const dist = Math.sqrt((lat - city.lat)**2 + (lng - city.lng)**2);
            if (dist > 0.3) return;

            let bestMatch = templates.find(t => t.name.includes("Citadel") || t.icon === "🏯");
            if (bestMatch) {
                processedCitadels.push({
                    type: 'castle', cityId: cityKey, lat, lng,
                    templateId: bestMatch.id,
                    name: node.tags?.name || bestMatch.name,
                    icon: bestMatch.icon,
                    level: bestMatch.level || 15,
                    hp: (bestMatch.level || 15) * 200,
                    maxHp: (bestMatch.level || 15) * 200,
                    realWorldId: node.id
                });
            }
        });
    }

    // 3. Filter by Strict Boundary
    if (cityBoundary) {
        processedCitadels = processedCitadels.filter(c => {
            try { return turf.booleanPointInPolygon([c.lng, c.lat], cityBoundary); } 
            catch (e) { return false; }
        });
    }

    // 4. Synthetic Fill
    if (processedCitadels.length < capacity) {
        let cityBounds = cityBoundary ? {
            minLng: turf.bbox(cityBoundary)[0], minLat: turf.bbox(cityBoundary)[1],
            maxLng: turf.bbox(cityBoundary)[2], maxLat: turf.bbox(cityBoundary)[3]
        } : {
            minLat: city.lat - 0.15, maxLat: city.lat + 0.15,
            minLng: city.lng - 0.25, maxLng: city.lng + 0.25
        };

        let attempts = 0;
        const synthTemplate = templates.find(t => t.name.includes("Citadel") || t.icon === "🏯");
        
        while (processedCitadels.length < capacity && attempts < 1000) {
            attempts++;
            const lat = cityBounds.minLat + Math.random() * (cityBounds.maxLat - cityBounds.minLat);
            const lng = cityBounds.minLng + Math.random() * (cityBounds.maxLng - cityBounds.minLng);

            let isInside = true;
            if (cityBoundary) {
                isInside = turf.booleanPointInPolygon([lng, lat], cityBoundary);
            }

            if (isInside && synthTemplate) {
                processedCitadels.push({
                    type: 'castle', cityId: cityKey, lat, lng,
                    templateId: synthTemplate.id,
                    name: `Synthetic Citadel ${processedCitadels.length + 1}`,
                    icon: synthTemplate.icon,
                    level: synthTemplate.level || 15,
                    hp: (synthTemplate.level || 15) * 200,
                    maxHp: (synthTemplate.level || 15) * 200
                });
            }
        }
    }

    // 5. Furthest Point Sampling
    let finalCitadels = [];
    if (processedCitadels.length > capacity) {
        const candidates = [...processedCitadels];
        finalCitadels.push(candidates.shift());
        
        const distCache = new Array(candidates.length).fill(Infinity);
        const getDistSq = (a, b) => (a.lat - b.lat)**2 + (a.lng - b.lng)**2;

        while (finalCitadels.length < capacity && candidates.length > 0) {
            const lastAdded = finalCitadels[finalCitadels.length - 1];
            let maxDist = -1, bestIdx = -1;

            for (let i = 0; i < candidates.length; i++) {
                const d = getDistSq(candidates[i], lastAdded);
                if (d < distCache[i]) distCache[i] = d;
                if (distCache[i] > maxDist) { maxDist = distCache[i]; bestIdx = i; }
            }

            if (bestIdx !== -1) {
                finalCitadels.push(candidates[bestIdx]);
                candidates.splice(bestIdx, 1);
                distCache.splice(bestIdx, 1);
            } else break;
        }
    } else {
        finalCitadels = processedCitadels;
    }

    // 6. Generate Zones
    let allCitadelsForZones = [...finalCitadels];
    if (cityBoundary) {
        try {
            const safetyMask = turf.buffer(cityBoundary, -0.01, { units: 'kilometers' });
            allCitadelsForZones = allCitadelsForZones.filter(c => turf.booleanPointInPolygon([c.lng, c.lat], safetyMask));
        } catch (e) { /* fallback */ }
    }

    const zonesGeoJson = await generateCityTerritory(cityKey, allCitadelsForZones, null, cityBoundary);

    return { finalCitadels, zonesGeoJson, cityBoundary };
}
```

- [ ] **Step 2: Commit**
```bash
git add www/maintenance/admin-citadel-generator.js
git commit -m "feat: add admin-citadel-generator utility"
```


### Task 2: Refactor `admin-citadels.js`

Refactor the citadel manual generation tool to use the new shared utility.

**Files:**
- Modify: `www/maintenance/admin-citadels.js`

- [ ] **Step 1: Replace internal logic with the utility call**

Modify the `window.startGeneration` function. Find where it resolves the Area ID (around line 400) and replace the bulk of the logic with:

```javascript
import { generateCitadelsAndZones } from './admin-citadel-generator.js';

window.startGeneration = async (overwrite = false) => {
    const cityKey = document.getElementById('gen-city').value;
    const capacity = parseInt(document.getElementById('gen-capacity')?.value) || 25;
    const city = CITY_ANCHORS.find(c => c.id === cityKey);

    if (!city) return logConsole('❌ Invalid city selected.');

    const targetTemplateId = document.getElementById('gen-template').value;
    let snapName = "";
    let finalId = null;
    let existingObjects = [];
    let preservedCitadels = [];

    logConsole(overwrite ? "🗑️ Mode: Create / Delete + Create (Fresh Start)" : "➕ Mode: Add to Existing");

    if (targetTemplateId === 'new') {
        snapName = prompt("Enter a name for this new Map Template:", `${cityKey}_citadels_${new Date().toLocaleDateString()}`);
        if (!snapName) return;
    } else {
        const selector = document.getElementById('gen-template');
        snapName = selector.options[selector.selectedIndex].text.split(' (')[0].replace(/^..?\s*/, "").trim();
        finalId = targetTemplateId;
        const existingSnap = await getSnapshotById(finalId);

        if (existingSnap && existingSnap.objects) {
            existingObjects = existingSnap.objects;
            if (overwrite) {
                existingObjects = existingObjects.filter(o => {
                    return !(o.icon === '🏯' || (o.name && o.name.includes('Citadel')) || (o.templateId && o.templateId.includes('citadel')));
                });
                logConsole(`🧹 Cleared old citadels. Retaining ${existingObjects.length} other objects.`);
            } else {
                preservedCitadels = existingObjects.filter(o =>
                    o.icon === '🏯' || (o.name && o.name.includes('Citadel')) || (o.templateId && o.templateId.includes('citadel'))
                );
                logConsole(`📦 Preserving ${preservedCitadels.length} existing citadels.`);
            }
        }
    }

    try {
        logConsole(`🔎 Fetching and generating citadels via shared service...`);
        const { finalCitadels, zonesGeoJson, cityBoundary } = await generateCitadelsAndZones(cityKey, capacity, templates, activeRules);
        
        let allCitadelsForZones = [...preservedCitadels, ...finalCitadels];
        
        // Final filter against preserved if needed, or re-run territory gen to merge preserved citadels
        if (preservedCitadels.length > 0) {
            // Note: If preserving, we should ideally re-run generateCityTerritory here
            // For simplicity, we assume generation handles it, but let's re-run strictly
            const finalZonesGeoJson = await generateCityTerritory(cityKey, allCitadelsForZones, null, cityBoundary);
            
            const finalSavedObjects = [...existingObjects, ...finalCitadels];
            await saveWorldSnapshot({
                id: finalId, name: snapName, cityId: cityKey, type: 'mixed',
                objects: finalSavedObjects, zones: JSON.stringify(finalZonesGeoJson)
            });
            await saveCityZones(cityKey, finalZonesGeoJson);
        } else {
            const finalSavedObjects = [...existingObjects, ...finalCitadels];
            await saveWorldSnapshot({
                id: finalId, name: snapName, cityId: cityKey, type: 'mixed',
                objects: finalSavedObjects, zones: JSON.stringify(zonesGeoJson)
            });
            await saveCityZones(cityKey, zonesGeoJson);
        }

        logConsole(`✅ Foundation & Territories Updated!`);
        await window.loadWorldSnapshots();
        alert(`Generation successful!\n- ${finalCitadels.length} Citadels created`);

    } catch (e) {
        logConsole(`❌ Generation Error: ${e.message}`);
    }
};
```
*(Remove the old `processNodesCitadel` and the huge block of geometry code since it's now in `admin-citadel-generator.js`)*

- [ ] **Step 2: Commit**
```bash
git add www/maintenance/admin-citadels.js
git commit -m "refactor: use shared generator in admin-citadels"
```


### Task 3: Refactor `admin-world.js` Global Generation

Apply the precise Citadel logic to the global generator and use the city boundaries to clip other grid-based entities.

**Files:**
- Modify: `www/maintenance/admin-world.js`

- [ ] **Step 1: Import the new utility and update the population math**

```javascript
import { generateCitadelsAndZones } from './admin-citadel-generator.js';
// Add to existing imports
```

- [ ] **Step 2: Modify the `generateGlobalWorld` loop**

Inside the `for (let i = 0; i < totalCities; i++)` loop, replace the current logic with:

```javascript
            const city = CITY_ANCHORS[i];
            const population = city.population || 1000000;
            
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

            // ... (keep the existing availableRings and pickCell logic) ...
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
                    obj.level = template.level || 1; obj.hp = template.maxHp || 20; obj.maxHp = template.maxHp || 20;
                    obj.damage = template.damage || 5; obj.defense = template.defense || 0;
                    obj.xpReward = template.xpReward || 10; obj.goldReward = template.goldReward || 5;
                } else if (type === 'shop') {
                    obj.shopType = template.name; obj.inventory = template.inventory || [];
                }
                return obj;
            };

            const placementOrder = [
                { type: 'castle',  count: counts.castle,  templates: castles },
                { type: 'vault',   count: counts.vault,   templates: vaults },
                { type: 'shop',    count: counts.shop,    templates: shops },
                { type: 'monster', count: counts.monster, templates: monsters }
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
                await saveWorldSnapshot(snapshotData);
                await delay(300); 
            }

            // HUGE DELAY TO PREVENT OVERPASS 429 ON NEXT CITY
            status.textContent = `Cooldown to prevent Overpass limits...`;
            await delay(3000);
```

- [ ] **Step 3: Commit**
```bash
git add www/maintenance/admin-world.js
git commit -m "feat: use real OSM data for global generation of citadels"
```
