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
    const citadelTemplate = templates.find(t => t.name.includes("Citadel") || t.icon === "🏯");
    const cosLat = Math.cos(city.lat * Math.PI / 180);

    if (queryFilters) {
        const query = `[out:json][timeout:60]; (\n${queryFilters}); out center;`;

        try {
            const data = await OverpassService.fetchJSON(query);

            data.elements.forEach(node => {
                const lat = node.lat || (node.center && node.center.lat);
                const lng = node.lon || (node.center && node.center.lon);
                if (!lat || !lng) return;

                const dLat = lat - city.lat;
                const dLng = (lng - city.lng) * cosLat;
                const dist = Math.sqrt(dLat**2 + dLng**2);
                if (dist > 0.3) return;

                if (citadelTemplate) {
                    processedCitadels.push({
                        type: 'castle', cityId: cityKey, lat, lng,
                        templateId: citadelTemplate.id,
                        name: node.tags?.name || citadelTemplate.name,
                        icon: citadelTemplate.icon,
                        level: citadelTemplate.level || 15,
                        hp: (citadelTemplate.level || 15) * 200,
                        maxHp: (citadelTemplate.level || 15) * 200,
                        realWorldId: node.id
                    });
                }
            });
        } catch (e) {
            console.error("Overpass query failed, falling back to synthetic fill:", e);
        }
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

        while (processedCitadels.length < capacity && attempts < 1000) {
            attempts++;
            const lat = cityBounds.minLat + Math.random() * (cityBounds.maxLat - cityBounds.minLat);
            const lng = cityBounds.minLng + Math.random() * (cityBounds.maxLng - cityBounds.minLng);

            let isInside = true;
            if (cityBoundary) {
                isInside = turf.booleanPointInPolygon([lng, lat], cityBoundary);
            }

            if (isInside && citadelTemplate) {
                processedCitadels.push({
                    type: 'castle', cityId: cityKey, lat, lng,
                    templateId: citadelTemplate.id,
                    name: `Synthetic Citadel ${processedCitadels.length + 1}`,
                    icon: citadelTemplate.icon,
                    level: citadelTemplate.level || 15,
                    hp: (citadelTemplate.level || 15) * 200,
                    maxHp: (citadelTemplate.level || 15) * 200
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
        const getDistSq = (a, b) => {
            const dLat = a.lat - b.lat;
            const dLng = (a.lng - b.lng) * cosLat;
            return dLat**2 + dLng**2;
        };

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