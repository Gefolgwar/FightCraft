import { simplify, getCentroid } from './geometry-utils.js';

const OVERPASS_ENDPOINTS = [
    "https://lz4.overpass-api.de/api/interpreter", // Usually more robust
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter"
];
let currentEndpointIndex = 0;
let lastRequestTime = 0;
const MIN_REQUEST_GAP = 1200; // 1.2 seconds between requests to avoid 429

export class OverpassService {

    static getEndpoint() {
        const url = OVERPASS_ENDPOINTS[currentEndpointIndex];
        currentEndpointIndex = (currentEndpointIndex + 1) % OVERPASS_ENDPOINTS.length;
        return url;
    }

    static async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Robust fetch with retries and mirror rotation
     */
    static async fetchJSON(query, attempt = 0) {
        if (attempt > 2) throw new Error("Overpass API failed after multiple retries.");

        const now = Date.now();
        const wait = Math.max(0, MIN_REQUEST_GAP - (now - lastRequestTime));
        if (wait > 0) await this.sleep(wait);
        lastRequestTime = Date.now();

        const endpoint = this.getEndpoint();
        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                body: query,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (resp.status === 429 || resp.status === 504 || resp.status === 502) {
                const nextEndpoint = OVERPASS_ENDPOINTS[currentEndpointIndex];
                console.warn(`⚠️ Overpass Mirror ${endpoint} reported ${resp.status}. Rotating to ${nextEndpoint}...`);
                await this.sleep(2000);
                return this.fetchJSON(query, attempt + 1);
            }

            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const text = await resp.text();
            if (text.trim().startsWith('<')) {
                throw new Error("Overpass returned HTML instead of JSON (Server Overloaded)");
            }

            return JSON.parse(text);
        } catch (e) {
            console.warn(`❌ Overpass Error on ${endpoint}: ${e.message}`);
            if (attempt < 2) {
                await this.sleep(1500);
                return this.fetchJSON(query, attempt + 1);
            }
            throw e;
        }
    }

    /**
     * Unified fetch for city context (Boundary + Districts)
     */
    static async fetchCityContext(cityName, center, options = {}) {
        let attempt = 0;
        let includeDistricts = true;

        if (typeof options === 'number') {
            attempt = options;
        } else {
            attempt = options.attempt || 0;
            if (options.includeDistricts !== undefined) includeDistricts = options.includeDistricts;
        }

        if (attempt > 2) return { boundary: null, districts: [], boundaryId: null };

        let query = `
            [out:json][timeout:40];
            relation["boundary"="administrative"]["admin_level"~"^[468]$"]["name"~"${cityName}",i](around:5000,${center.lat},${center.lng})->.city;
            .city out geom;
        `;

        if (includeDistricts) {
            query += `
            (
              relation["boundary"="administrative"]["admin_level"~"^(8|9|10)$"](around:15000,${center.lat},${center.lng});
            );
            out geom;
            `;
        }

        try {
            const data = await this.fetchJSON(query);

            // Extract boundary - Prioritize exact match and larger areas (lower admin_level)
            const candidates = data.elements.filter(e => e.type === 'relation' && e.tags && e.tags.name && e.tags.name.toLowerCase().includes(cityName.toLowerCase()));

            // Sort by admin_level (4 = State/Capital, 8 = City, 9 = District). We want the lowest (largest area).
            const boundaryRel = candidates.sort((a, b) => (parseInt(a.tags.admin_level || 10) - parseInt(b.tags.admin_level || 10)))[0];

            let boundary = null;
            let boundaryId = null;
            if (boundaryRel) {
                boundaryId = boundaryRel.id;
                const outerWays = boundaryRel.members
                    .filter(m => m.type === 'way' && m.role === 'outer' && m.geometry)
                    .map(m => m.geometry.map(g => [g.lon, g.lat]));

                if (outerWays.length > 0) {
                    const rings = this.stitchWaysToRings(outerWays);
                    if (rings.length > 0) boundary = rings;
                }
            }

            // Extract Districts (only if requested)
            const districts = includeDistricts ? await this.processDistrictData(data) : [];
            return { boundary, districts, boundaryId };
        } catch (e) {
            console.warn(`❌ Overpass Attempt ${attempt} failed:`, e.message);
            return { boundary: null, districts: [], boundaryId: null };
        }
    }

    /**
     * Fetches raw relation geometry and returns it as a GeoJSON FeatureCollection
     */
    static async fetchRelationGeometry(relId) {
        const query = `[out:json][timeout:25]; rel(${relId}); out geom;`;
        try {
            const data = await this.fetchJSON(query);
            if (!data) return null;

            const features = [];
            data.elements.forEach(rel => {
                if (rel.members) {
                    const outerWays = rel.members
                        .filter(m => m.type === 'way' && m.role === 'outer' && m.geometry)
                        .map(m => m.geometry.map(g => [g.lon, g.lat]));

                    if (outerWays.length > 0) {
                        const rings = this.stitchWaysToRings(outerWays);
                        if (rings.length > 0) {
                            features.push({
                                type: 'Feature',
                                geometry: {
                                    type: rings.length > 1 ? 'MultiPolygon' : 'Polygon',
                                    coordinates: rings.length > 1 ? rings.map(r => [r]) : [rings[0]]
                                },
                                properties: rel.tags || {}
                            });
                        }
                    }
                }
            });

            return { type: 'FeatureCollection', features };
        } catch (e) {
            console.error("Failed to fetch relation geometry:", e);
            return null;
        }
    }

    /**
     * Stitches disjoint segments into multiple CLOSED rings.
     */
    static stitchWaysToRings(ways) {
        if (ways.length === 0) return [];
        let segments = [...ways];
        let rings = [];

        while (segments.length > 0) {
            let currentRing = segments.shift();
            let foundMatch = true;

            while (foundMatch && segments.length > 0) {
                foundMatch = false;
                let lastPoint = currentRing[currentRing.length - 1];
                let firstPoint = currentRing[0];
                const eps = 0.0001; // Slightly higher tolerance for complex borders
                const distsq = (p1, p2) => (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2;

                for (let i = 0; i < segments.length; i++) {
                    let seg = segments[i];
                    let sFirst = seg[0];
                    let sLast = seg[seg.length - 1];

                    if (distsq(lastPoint, sFirst) < eps * eps) {
                        currentRing.push(...seg.slice(1));
                        segments.splice(i, 1);
                        foundMatch = true;
                        break;
                    } else if (distsq(lastPoint, sLast) < eps * eps) {
                        currentRing.push(...[...seg].reverse().slice(1));
                        segments.splice(i, 1);
                        foundMatch = true;
                        break;
                    } else if (distsq(firstPoint, sLast) < eps * eps) {
                        currentRing.unshift(...seg.slice(0, -1));
                        segments.splice(i, 1);
                        foundMatch = true;
                        break;
                    } else if (distsq(firstPoint, sFirst) < eps * eps) {
                        currentRing.unshift(...[...seg].reverse().slice(0, -1));
                        segments.splice(i, 1);
                        foundMatch = true;
                        break;
                    }
                }
            }
            if (currentRing.length > 3) {
                const first = currentRing[0];
                const last = currentRing[currentRing.length - 1];
                if ((first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2 > 0.0000001) {
                    currentRing.push([first[0], first[1]]);
                }
                rings.push(currentRing);
            }
        }
        return rings;
    }

    static async fetchDistricts(bounds) {
        const center = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
        const ctx = await this.fetchCityContext("unknown", center);
        return ctx.districts;
    }

    static async fetchCityBoundary(cityName, center) {
        const ctx = await this.fetchCityContext(cityName, center);
        return ctx.boundary;
    }

    static async processDistrictData(data) {
        const results = [];
        for (const element of data.elements) {
            if (element.type === 'relation' && element.members) {
                const name = element.tags.name || element.tags['name:en'] || "Unknown District";
                let points = [];
                element.members.forEach(m => {
                    if (m.type === 'way' && m.role === 'outer' && m.geometry) {
                        m.geometry.forEach(g => points.push({ lat: g.lat, lng: g.lon }));
                    }
                });
                if (points.length < 3) continue;
                const simplifiedPoints = simplify(points, 0.0005);
                if (simplifiedPoints.length < 3) continue;
                results.push({
                    id: `osm-${element.id}`,
                    name: name,
                    points: simplifiedPoints,
                    center: getCentroid(simplifiedPoints),
                    rawTags: element.tags
                });
            }
        }
        return results;
    }

    static async findSafeCitadelLocation(lat, lng) {
        const query = `[out:json][timeout:10]; way(around:300,${lat},${lng})["highway"="footway"]; (._;>;); out body;`;
        try {
            const data = await this.fetchJSON(query);
            if (!data) return { lat, lng };
            let closestNode = null;
            let minDst = Infinity;
            const nodes = new Map();
            data.elements.forEach(e => { if (e.type === 'node') nodes.set(e.id, { lat: e.lat, lng: e.lon }); });
            data.elements.forEach(e => {
                if (e.type === 'way') {
                    e.nodes.forEach(nid => {
                        const n = nodes.get(nid);
                        if (n) {
                            const d = (n.lat - lat) ** 2 + (n.lng - lng) ** 2;
                            if (d < minDst) { minDst = d; closestNode = n; }
                        }
                    });
                }
            });
            return closestNode || { lat, lng };
        } catch (e) { return { lat, lng }; }
    }
}
