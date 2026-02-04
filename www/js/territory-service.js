/**
 * Territory Service - Generates and manages game zones around Citadels.
 * Powered by Turf.js (Voronoi Diagrams)
 */

// Import Firebase dependencies via Dynamic Import to maintain compatibility with existing module structure
import { saveCityZones, getCityZones, isAdmin } from './firebase-service.js';

// Turf.js Full Bundle (Browser Compatible)
const TURF_CDN = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";

/**
 * Main function to generate and save zones for a city.
 * @param {string} cityId - ID of the city (e.g. 'kyiv')
 * @param {Array} citadels - Array of objects { id, lat, lng }
 * @param {Array} bbox - Optional Bounding Box [minLon, minLat, maxLon, maxLat]
 */
/**
 * CLEAN MASK: Fixes topology, self-intersections, and removes holes
 * for high-quality solid clipping. Follows Senior GIS Developer best practices.
 */
export function getCleanCityMask(rawGeoJSON) {
    const turf = window.turf;
    if (!rawGeoJSON) return null;

    try {
        // 1. Gather all Polygon/MultiPolygon features
        let features = [];
        if (rawGeoJSON.type === 'FeatureCollection') features = rawGeoJSON.features;
        else if (rawGeoJSON.type === 'Feature') features = [rawGeoJSON];
        else features = [{ type: 'Feature', geometry: rawGeoJSON, properties: {} }];

        // 2. Filter only valid area geometries
        const polys = features.filter(f =>
            f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
        );
        if (polys.length === 0) return null;

        // 3. Union all parts into a single MultiPolygon/Polygon
        let united = polys[0];
        for (let i = 1; i < polys.length; i++) {
            united = turf.union(united, polys[i]);
        }

        // 4. Remove ALL internal holes (keep only the outer ring for each polygon)
        // This ensures a solid contiguous area for game zones.
        if (united.geometry.type === 'Polygon') {
            united.geometry.coordinates = [united.geometry.coordinates[0]];
        } else if (united.geometry.type === 'MultiPolygon') {
            united.geometry.coordinates = united.geometry.coordinates.map(poly => [poly[0]]);
        }

        // 5. Rewind for correct winding order (RHR)
        united = turf.rewind(united, { reverse: true, mutate: true });

        // 6. Simplify slightly to remove micro-nodes/jitter
        united = turf.simplify(united, { tolerance: 0.0001, highQuality: true });

        // 7. Final closure check (Turf simplify usually handles this, but safety first)
        return united;
    } catch (e) {
        console.warn("⚠️ Mask Cleaning Failed:", e.message);
        return rawGeoJSON;
    }
}

/**
 * Main function to generate and save zones for a city.
 */
export async function generateCityTerritory(cityId, citadels, bbox, rawMask = null) {
    if (!isAdmin()) throw new Error("Unauthorized: Admin access required.");

    console.log(`🗺️ Calculation Territory for ${cityId} using ${citadels.length} citadels...`);

    // 1. Load Turf.js (Global Script Approach for reliability)
    if (!window.turf) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = TURF_CDN;
            script.onload = resolve;
            script.onerror = () => reject(new Error("Failed to load Turf.js"));
            document.head.appendChild(script);
        });
    }
    const turf = window.turf;

    // 2. Prepare Point Collection
    // Turf expects [lon, lat]
    const points = turf.featureCollection(
        citadels.map(c => turf.point([c.lng, c.lat], { id: c.id }))
    );

    // 3. Define Bounding Box if not provided (±0.5 deg around the average point)
    let center = { lat: 0, lng: 0 };
    if (citadels.length > 0) {
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        let sumLat = 0, sumLng = 0;

        citadels.forEach(c => {
            if (c.lat < minLat) minLat = c.lat;
            if (c.lat > maxLat) maxLat = c.lat;
            if (c.lng < minLng) minLng = c.lng;
            if (c.lng > maxLng) maxLng = c.lng;
            sumLat += c.lat;
            sumLng += c.lng;
        });

        center = { lat: sumLat / citadels.length, lng: sumLng / citadels.length };

        if (!bbox) {
            const buffer = 0.5; // ~55km padding
            bbox = [minLng - buffer, minLat - buffer, maxLng + buffer, maxLat + buffer];
        }
    }

    // 4. Create the Clipping Mask (City Boundary or Organic Cloud)
    let clippingMask = null;

    if (rawMask) {
        // Use Smart Hybrid Mask if we have points to insure they are included
        if (points && points.features.length > 0) {
            console.log("🧠 Using Smart Hybrid Mask (City + Citadels)...");
            clippingMask = generateSmartMapMask(rawMask, points);
        } else {
            console.log("🏙️ Using provided City Boundary for clipping...");
            clippingMask = getCleanCityMask(rawMask);
        }
    } else {
        try {
            console.log("☁️ Generating Organic Cloud mask (Convex Hull + 3km)...");
            // Step 1: Convex Hull
            const hull = turf.convex(points);

            if (hull) {
                // Step 2: 3km Buffer
                const buffered = turf.buffer(hull, 3, { units: 'kilometers' });

                // Step 3: Bezier Spline / Smoothing
                const ring = buffered.geometry.coordinates[0];
                const line = turf.lineString(ring);
                const smoothed = turf.bezierSpline(line);

                // Step 4: Final Mask (Polygon)
                clippingMask = turf.polygon([smoothed.geometry.coordinates]);
            }
        } catch (e) {
            console.warn("Organic shaping failed:", e);
        }
    }

    // 5. Generate Large Voronoi & Intersect with Mask
    const maskBbox = clippingMask ? turf.bbox(clippingMask) : bbox;
    const expandedBbox = [maskBbox[0] - 0.1, maskBbox[1] - 0.1, maskBbox[2] + 0.1, maskBbox[3] + 0.1];

    const finalVoronoi = turf.voronoi(points, { bbox: expandedBbox });

    const zones = finalVoronoi.features.map(polygon => {
        // Find the citadel responsible for this cell. 
        // Voronoi cells are defined by being closer to their seed point than any other.
        let parentCitadelFeature = points.features.find(pt =>
            turf.booleanPointInPolygon(pt, polygon)
        );

        // Fallback: If point is on the boundary or precision fails, find the nearest seed to the cell centroid
        if (!parentCitadelFeature) {
            try {
                const centroid = turf.centroid(polygon);
                parentCitadelFeature = turf.nearestPoint(centroid, points);
            } catch (e) {
                console.warn("Centroid calculation failed for a zone, skipping...");
            }
        }

        if (parentCitadelFeature) {
            const props = {
                citadelId: parentCitadelFeature.properties.id,
                cityId: cityId,
                lat: parentCitadelFeature.geometry.coordinates[1],
                lng: parentCitadelFeature.geometry.coordinates[0],
                generatedAt: new Date().toISOString()
            };

            if (clippingMask) {
                try {
                    const intersected = turf.intersect(polygon, clippingMask);
                    if (intersected) {
                        intersected.properties = props;
                        return intersected;
                    }
                } catch (err) { /* ignore */ }
            }

            polygon.properties = props;
            return polygon;
        }
        return null;
    }).filter(f => f !== null);

    return turf.featureCollection(zones);
}

/**
 * Generate AND Save (Legacy Helper)
 */
export async function regenerateCityTerritory(cityId, citadels, bbox) {
    const featureCollection = await generateCityTerritory(cityId, citadels, bbox);

    // Save to Firebase
    const success = await saveCityZones(cityId, featureCollection);

    if (success) {
        console.log(`✅ Successfully generated and saved ${featureCollection.features.length} zones for ${cityId}.`);
        return featureCollection;
    } else {
        throw new Error("Failed to save zones to database.");
    }
}

/**
 * Fetch zones for a city with local caching
 */
const _localZoneCache = {};

export async function getTerritoryZones(cityId) {
    // 1. Return from local memory if available
    if (_localZoneCache[cityId]) return _localZoneCache[cityId];

    // 2. Fetch from Database
    const data = await getCityZones(cityId);
    if (data && data.geoJson) {
        _localZoneCache[cityId] = data.geoJson;
        return data.geoJson;
    }

    return null;
}

/**
 * SMART MAP MASK: Hybrid approach
 * Merges City Boundary + Citadel Convex Hull to ensure NO points are cut off.
 * Applies buffer and smoothing for organic game-like feel.
 * 
 * @param {Object} cityBoundary - GeoJSON Polygon/MultiPolygon of the city
 * @param {Object} citadelPoints - GeoJSON FeatureCollection of points
 */
export function generateSmartMapMask(cityBoundary, citadelPoints) {
    const turf = window.turf;
    if (!turf) return cityBoundary;

    console.log("🧠 Calculating Smart Hybrid Mask...");

    // 1. Create Hull for Citadels (The "Game Area")
    const hull = turf.convex(citadelPoints);

    // 2. Prepare City Boundary
    const cleanCity = getCleanCityMask(cityBoundary);

    // 3. Union: City + Game Area
    let combined = cleanCity;
    if (hull) {
        try {
            // Using union to fuse them.
            combined = turf.union(cleanCity, hull);
        } catch (e) {
            console.warn("Union failed, using Hull or City fallback", e);
            combined = hull || cleanCity;
        }
    }

    // 4. Organic Expansion (Buffer) - Add 1.5km breathing room
    // This ensures points on the edge have "territory" behind them
    const buffered = turf.buffer(combined, 1.5, { units: 'kilometers' });

    // 5. Simplify (Reduce vertex count for performance and smoothing prep)
    const simplified = turf.simplify(buffered, { tolerance: 0.005, highQuality: true });

    // 6. Smoothing (Bezier Spline) - Makes it look like a fantasy map
    let finalMask = simplified;
    try {
        if (simplified.geometry.type === 'Polygon') {
            const ring = simplified.geometry.coordinates[0];
            const line = turf.lineString(ring);
            const smoothed = turf.bezierSpline(line, { resolution: 10000, sharpness: 0.85 });
            finalMask = turf.lineToPolygon(smoothed);
        }
    } catch (e) {
        console.warn("Bezier smoothing failed, using simplified mask.", e);
    }

    return finalMask;
}
