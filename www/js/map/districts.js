
import { OverpassService } from './overpass-service.js';
import { gameState } from '../core/gameState.js';
import { isPointInPolygon } from '../core/geometry-utils.js';
import { getTerritoryZones } from './territory-service.js';

// ==================== STATE ====================
let mapRef = null;
export let districtLayers = null;
let districtData = [];
// Export static placeholder for backwards compatibility with kingdom.js
export const DISTRICTS = [];
let areDistrictsVisible = false;

/**
 * Initialize District System
 * @param {L.Map} mapInstance - Leaflet map instance
 */
export function initDistricts(mapInstance) {
    if (mapRef) return; // Already initialized
    mapRef = mapInstance;

    // Create a LayerGroup to hold all district elements (polygons, labels, citadels)
    districtLayers = L.layerGroup().addTo(mapRef);

    // Expose toggle function globally for the UI button
    window.toggleDistrictVisibility = toggleDistrictVisibility;

    // Initial load based on player position
    if (gameState.player && gameState.player.position) {
        console.log("🏙️ Initializing Districts...");
        fetchAndDrawDistricts(gameState.player.position.lat, gameState.player.position.lng);
    }
}

/**
 * Toggle visibility of district polygons and labels
 */
export function toggleDistrictVisibility() {
    areDistrictsVisible = !areDistrictsVisible;

    // Update Map/Body class for CSS transitions
    const mapEl = document.getElementById('map');
    if (mapEl) {
        if (areDistrictsVisible) {
            mapEl.classList.add('districts-visible');
        } else {
            mapEl.classList.remove('districts-visible');
        }
    }

    // Update Polygon Fill Opacity (Smooth transition)
    if (districtLayers) {
        districtLayers.eachLayer(layer => {
            if (layer instanceof L.Polygon) {
                // Animate Opacity: 0 -> 0.4
                // Leaflet doesn't animate setStyle natively nicely, handled by CSS on path if possible,
                // but setStyle works for functional change.
                layer.setStyle({
                    fillOpacity: areDistrictsVisible ? 0.4 : 0,
                    opacity: areDistrictsVisible ? 1 : 0 // Also hide borders if needed, or keep them? Prompt says "Layer... transparency 0 to 0.4"
                });
            }
        });
    }

    // Update UI Button
    const btn = document.getElementById('district-toggle-btn');
    const icon = document.getElementById('district-toggle-icon');
    if (btn && icon) {
        if (areDistrictsVisible) {
            btn.classList.add('bg-purple-600');
            btn.classList.remove('bg-black/60');
            icon.textContent = '🗺️';
        } else {
            btn.classList.remove('bg-purple-600');
            btn.classList.add('bg-black/60');
            icon.textContent = '🗺️'; // Keep it the same or change? The user asked to change 👓 to 🗺️. 
            // Usually toggle icons change state, but the user asked for 🗺️ specifically.
            // I'll keep 🗺️ as requested but maybe use opacity/color for state.
        }
        // Actually, the user might want a "show/hide" visual. 
        // But I will follow the "change 👓 to 🗺️" instruction.
    }

    console.log(`Districts visibility: ${areDistrictsVisible}`);
}

/**
 * Fetch district data (prefers Custom Game Zones, falls back to OSM)
 */
export async function fetchAndDrawDistricts(lat, lng) {
    if (!mapRef) return;

    const cityId = gameState.currentCityId || 'berlin'; // Default to berlin for testing

    try {
        console.log(`🗺️ Checking for custom Game Zones for city: ${cityId}...`);
        const gameZonesCollection = await getTerritoryZones(cityId);

        if (gameZonesCollection && gameZonesCollection.features && gameZonesCollection.features.length > 0) {
            console.log(`✅ Found ${gameZonesCollection.features.length} custom Game Zones. Loading...`);

            // Convert GeoJSON Features to our internal district format
            const districts = gameZonesCollection.features.map(f => {
                let coordsArray = f.geometry.coordinates;

                // VALIDATION: Reject flat number arrays (e.g. BBox or single point)
                if (!Array.isArray(coordsArray) || coordsArray.length === 0 || typeof coordsArray[0] === 'number') {
                    console.warn(`⚠️ Skipped invalid zone geometry (flat array or empty):`, f.id || 'unknown');
                    return null;
                }

                // Recursively drill down until we find a Ring (Array of Points)
                // This handles Polygon (depth 3) and MultiPolygon (depth 4+) by taking the first outer ring
                while (Array.isArray(coordsArray) && coordsArray.length > 0
                    && Array.isArray(coordsArray[0])
                    && Array.isArray(coordsArray[0][0])) {
                    coordsArray = coordsArray[0];
                }

                // Map points safely
                const points = coordsArray.map(coord => {
                    if (Array.isArray(coord) && coord.length >= 2) {
                        return { lat: coord[1], lng: coord[0] };
                    }
                    return null;
                }).filter(p => p !== null);

                if (points.length < 3) return null;

                // Calculate Centroid Fallback (Average of all points)
                const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
                const centroidFallback = { lat: sum.lat / points.length, lng: sum.lng / points.length };

                return {
                    id: f.properties.citadelId || f.id || `zone_${Math.random().toString(36).substr(2, 5)}`,
                    name: f.properties.name || ("Zone " + (f.properties.citadelId ? f.properties.citadelId.substring(0, 5) : "Unknown")),
                    points: points,
                    // PRIORITY: 1. DB Stored Coords | 2. Calculated Centroid Fallback
                    center: {
                        lat: f.properties.lat || centroidFallback.lat,
                        lng: f.properties.lng || centroidFallback.lng
                    },
                    kingId: f.properties.kingId || null,
                    kingName: f.properties.kingName || 'Unclaimed'
                };
            }).filter(d => d !== null);

            districtData = districts;
            console.log(`🏰 Rendering ${districts.length} custom city zones from DB.`);
            renderDistricts(districts);

            // Update current district immediately after load
            if (gameState.player && gameState.player.position) {
                const current = getDistrictByCoords(gameState.player.position.lat, gameState.player.position.lng);
                if (current) {
                    gameState.currentDistrict = current;
                    if (window.updateDistrictHUD) window.updateDistrictHUD();
                }
            }
            return;
        }

        // FALLBACK: Overpass API (DISABLED to prevent unwanted "torn" zones)
        /*
        console.log("ℹ️ No custom zones found. Falling back to Overpass OSM districts...");
        const bounds = {
            south: lat - 0.04,
            west: lng - 0.06,
            north: lat + 0.04,
            east: lng + 0.06
        };

        const districts = await OverpassService.fetchDistricts(bounds);
        const limit = parseInt(localStorage.getItem('max_districts')) || 50;

        if (districts.length > 0) {
            districtData = districts.slice(0, limit);
            renderDistricts(districtData);
        } else {
            console.warn("⚠️ No districts found from Overpass.");
        }
        */
        console.log("ℹ️ No custom zones found. Zones will remain empty until generated via Admin Template.");

        // Update current district immediately after load
        if (gameState.player && gameState.player.position) {
            const current = getDistrictByCoords(gameState.player.position.lat, gameState.player.position.lng);
            if (current) {
                gameState.currentDistrict = current;
                if (window.updateDistrictHUD) window.updateDistrictHUD();
            }
        }

    } catch (e) {
        console.error("Error loading districts:", e);
    }
}

export function refreshDistricts() {
    if (districtData.length > 0) {
        renderDistricts(districtData);
    }
}

export function renderDistricts(districts) {
    if (!districtLayers) return;
    districtLayers.clearLayers();

    districts.forEach(d => {
        // Ownership-based coloring
        let color = '#FFFF00'; // Default: Yellow (No King)
        if (d.kingId) {
            if (d.kingId === gameState.player?.id || d.kingId === 'player_me') {
                color = '#00FF00'; // Green (Player)
            } else {
                color = '#FF0000'; // Red (Enemy)
            }
        }

        // 2. Create Polygon
        const polygon = L.polygon(d.points, {
            color: color,
            weight: 3,
            opacity: areDistrictsVisible ? 1 : 0,
            fillColor: color,
            fillOpacity: areDistrictsVisible ? 0.35 : 0,
            className: 'district-polygon',
            interactive: true,
            zIndex: 10 // Base layer
        });

        // Store reference for quick updates
        polygon.districtId = d.id;
        districtLayers.addLayer(polygon);

        // --- CITADEL MARKER REMOVED (Handled by poi.js to ensure Template Alignment) ---
        /*
        const citadelIcon = L.divIcon({
            html: `
                <div class="w-12 h-12 flex items-center justify-center relative bg-transparent">
                    <div class="absolute inset-0 rounded-full blur-md opacity-40" style="background: ${color}"></div>
                    <div class="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] z-10 leading-none select-none">🏯</div>
                </div>
            `,
            className: 'citadel-marker-div',
            iconSize: [48, 48],
            iconAnchor: [24, 24]
        });

        const citadel = L.marker(d.center, {
            icon: citadelIcon,
            zIndexOffset: 3000 // TOP layer (indices)
        });

        // Debug Information in Popup (Persistent for coordinate verification)
        citadel.bindPopup(`
            <div class="text-center select-text">
                <b class="text-yellow-400" style="color: #facc15">${d.name}</b><br>
                <span class="text-[10px] text-gray-400" style="font-size: 10px; color: #9ca3af">#${d.id}</span><br>
                <code class="text-[10px] text-blue-300 font-mono" style="font-size: 10px; color: #93c5fd; background: rgba(0,0,0,0.3); padding: 2px 4px; border-radius: 4px;">${d.center.lat.toFixed(6)}, ${d.center.lng.toFixed(6)}</code><br>
                <hr class="my-1 border-gray-700" style="margin: 4px 0; border: 0; border-top: 1px solid #374151;">
                <span class="text-[10px] text-white" style="font-size: 10px; color: #ffffff">👑 ${d.kingName || 'None'}</span>
            </div>
        `, {
            className: 'citadel-debug-popup',
            offset: [0, -20],
            minWidth: 150
        });

        citadel.on('click', () => {
            console.log(`🏰 Citadel Debug | ID: ${d.id} | Coords: ${d.center.lat}, ${d.center.lng}`);
            if (window.openCitadelMenu) {
                window.openCitadelMenu(d.name, d.kingName || "None");
            }
        });
        districtLayers.addLayer(citadel);
        */

        // 4. District Label (Big Text on Map)
        const labelIcon = L.divIcon({
            html: `<div class="district-label-text">${d.name}</div>`,
            className: 'district-label-container',
            iconSize: [300, 50],
            iconAnchor: [150, 25]
        });

        const labelMarker = L.marker(d.center, {
            icon: labelIcon,
            interactive: false,
            zIndexOffset: -500 // Behind everything
        });
        districtLayers.addLayer(labelMarker);
    });
}

// Helper: Point in Polygon Check for HUD
export function getDistrictByCoords(lat, lng) {
    // Check cached districts first
    for (const d of districtData) {
        if (isPointInPolygon({ lat, lng }, d.points)) {
            return d;
        }
    }
    return null;
}

// Helper: Consistent Color Gen
function stringToColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
}
