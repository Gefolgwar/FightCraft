import { getTemplates, saveTemplate, deleteTemplate, saveWorldSnapshot, getWorldSnapshots, getSnapshotById, isAdmin, getCurrentUser, initFirebase } from './firebase-service.js';
import { CITY_ANCHORS } from './data.js';
import { generateCityTerritory } from './territory-service.js';
import { saveCityZones } from './firebase-service.js';
import { OverpassService } from './overpass-service.js';

let templates = [];
let currentEditId = null;
let activeRules = new Map(); // Stores Template ID -> Weight (0-100)
let generatedCount = new Map(); // Stores Template ID -> Count of spawned entities

// Init
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Firebase Auth & Role Sync first
    await initFirebase();

    // Check Status
    if (!isAdmin()) {
        document.getElementById('admin-lock').classList.remove('hidden');
    } else {
        document.getElementById('admin-lock').classList.add('hidden');
        document.getElementById('admin-panel').classList.remove('hidden');
        const user = getCurrentUser();
        if (user) {
            document.getElementById('admin-status').innerHTML = `<span class="text-orange-400">● Online (${user.email})</span>`;
        }

        // Delay heavy lifting to prevent freeze
        setTimeout(async () => {
            console.log("🚀 Starting Template Load...");
            await loadTemplates();
            renderMappingRules();
            renderTemplateList();
        }, 1000);

        // Add capacity change listener
        const capacityInput = document.getElementById('gen-capacity');
        if (capacityInput) {
            const savedCap = localStorage.getItem('citadel_density') || 25;
            capacityInput.value = savedCap;

            capacityInput.addEventListener('input', () => {
                const val = parseInt(capacityInput.value) || 25;
                localStorage.setItem('citadel_density', val);
                renderMappingRules();
            });
        }

        // Delay snapshot loading
        setTimeout(() => {
            if (window.loadWorldSnapshots) window.loadWorldSnapshots();
        }, 2000);
    }
});

// ==================== TEMPLATE MANAGEMENT ====================

// Global recursion guard
let _isCreatingDefaults = false;

async function loadTemplates() {
    // 1. Double-check Admin Status (Crucial for preventing loops)
    if (!isAdmin()) {
        console.warn("⚠️ loadTemplates called but user is not Admin. Aborting.");
        return;
    }

    const list = document.getElementById('template-list');
    if (!list) return;
    list.innerHTML = '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

    try {
        const allCastles = await getTemplates('castle'); // Citadels are stored as type 'castle'

        // FILTER: Keep ONLY Citadels
        templates = allCastles.filter(t =>
            t.icon === '🏯' ||
            t.name.includes('Citadel') ||
            (t.id && t.id.includes('citadel'))
        );

        // 2. Load templates (But do NOT auto-create anymore)
        const needsDefaults = templates.length === 0;

        if (needsDefaults) {
            console.log("ℹ️ No 'Citadel' template found. Use the Magic Wand to create one.");
        }

    } catch (error) {
        console.error("Template load error:", error);
        list.innerHTML = '<div class="text-center text-red-500 text-xs mt-4">Error loading templates</div>';
    }

    renderTemplateList();
    renderMappingRules();
}

window.createDefaultCitadelTemplates = async function () {
    const defaults = [
        {
            name: "Citadel",
            icon: "🏯",
            osmTag: "historic~castle|monument|memorial; tourism=museum; amenity~townhall|library|university|bus_station|arts_centre|place_of_worship; railway~station|subway_entrance; leisure~park|square|viewpoint|stadium",
            type: "castle",
            level: 15,
            hp: 2000
        }
    ];

    for (const t of defaults) {
        await saveTemplate(t);
    }
    logConsole("🪄 Magic Wand: Created default citadel templates.");

    // Auto-refresh the list so the user sees the new Citadel
    await loadTemplates();

    logConsole("✅ Default Citadel template created.");
}

// ==================== SNAPSHOT & MAP TEMPLATES ====================

window.loadWorldSnapshots = async function () {
    const selector = document.getElementById('gen-template');
    if (!selector) return;

    if (!isAdmin()) return;

    const currentVal = selector.value;
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.text = '+ Create New Map Template';

    selector.innerHTML = '';
    selector.appendChild(newOpt);

    try {
        const snaps = await getWorldSnapshots();
        snaps.forEach(snap => {
            const option = document.createElement('option');
            const display = snap.name ? snap.name : `${snap.id.substr(0, 10)}...`;
            const typeIcon = snap.type === 'shop' ? '🏪' : (snap.type === 'monster' ? '👾' : (snap.type === 'castle' ? '🏰' : '🌍'));

            option.value = snap.id;
            option.textContent = `${typeIcon} ${display} (${snap.objects?.length || 0} obj)`;
            selector.appendChild(option);
        });

        if (currentVal && currentVal !== 'new') {
            for (let i = 0; i < selector.options.length; i++) {
                if (selector.options[i].value === currentVal) {
                    selector.selectedIndex = i;
                    break;
                }
            }
        }
    } catch (e) {
        logConsole(`❌ Error loading snapshots: ${e.message}`);
    }
}

window.renderTemplateList = function () {
    const list = document.getElementById('template-list');
    if (!list) return;

    const search = document.getElementById('template-search')?.value.toLowerCase() || "";
    list.innerHTML = '';

    templates.forEach(t => {
        // Filter by search and only show Citadel-like templates
        const isMatch = t.name.toLowerCase().includes(search) || t.osmTag?.toLowerCase().includes(search);
        const isCitadel = t.name.includes("Citadel") || t.name.includes("Fortress") || t.icon === "🏯";

        if (!isMatch || !isCitadel) return;

        const el = document.createElement('div');
        const isActive = activeRules.has(t.id);
        const activeClass = isActive ? 'border-orange-500 bg-orange-900/20' : 'border-gray-700 hover:border-orange-500';

        el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;

        el.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0">${t.icon || '🏯'}</span>
                <div class="min-w-0 flex-1">
                    <div class="font-bold text-sm text-gray-300 truncate">${t.name}</div>
                    <div class="text-[10px] text-gray-400 truncate opacity-60">Tags: ${t.osmTag || 'N/A'}</div>
                </div>
            </div>
            <div class="opacity-0 group-hover:opacity-100 flex gap-2 flex-shrink-0 ml-2">
                <button class="text-xs text-green-400 hover:text-white p-1" onclick="event.stopPropagation(); window.copyTemplate('${t.id}')" title="Copy Template">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="text-xs text-blue-400 p-1" onclick="event.stopPropagation(); window.editTemplate('${t.id}')">
                    <i class="fas fa-edit"></i>
                </button>
            </div>
        `;

        el.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                toggleMappingRule(t.id);
            }
        });

        list.appendChild(el);
    });
}

function toggleMappingRule(id) {
    if (activeRules.has(id)) {
        activeRules.delete(id);
    } else {
        const t = templates.find(temp => temp.id === id);
        if (t && t.osmTag) {
            activeRules.set(id, 100);
        } else {
            alert("This template has no OSM Tag to match!");
            return;
        }
    }
    renderMappingRules();
    renderTemplateList();
}

window.updateRuleWeight = (id, val) => {
    let weight = parseInt(val);
    if (isNaN(weight)) weight = 0;
    if (activeRules.has(id)) {
        activeRules.set(id, weight);
    }
    renderMappingRules();
};

function renderMappingRules() {
    const tbody = document.getElementById('rules-table');
    const emptyMsg = document.getElementById('rules-empty');
    if (tbody) {
        tbody.innerHTML = '';
        if (activeRules.size === 0) {
            if (emptyMsg) emptyMsg.classList.remove('hidden');
        } else {
            if (emptyMsg) emptyMsg.classList.add('hidden');
            const totalCap = parseInt(document.getElementById('gen-capacity')?.value) || 25;
            let totalWeight = 0;
            activeRules.forEach((weight) => totalWeight += weight);

            activeRules.forEach((weight, id) => {
                const t = templates.find(temp => temp.id === id);
                if (!t) return;
                const estimatedCount = totalWeight > 0 ? Math.round(totalCap * (weight / totalWeight)) : 0;

                const tr = document.createElement('tr');
                tr.className = 'border-b border-gray-800 hover:bg-gray-800/50';
                tr.innerHTML = `
                    <td class="px-4 py-2 flex items-center gap-2">
                        <span class="text-lg">${t.icon}</span> ${t.name}
                    </td>
                    <td class="px-4 py-2 text-center">
                        <input type="number" min="0" max="100" value="${weight}" 
                            onchange="window.updateRuleWeight('${t.id}', this.value)"
                            class="w-16 bg-gray-900 border border-gray-700 rounded text-center text-xs p-1"> %
                    </td>
                    <td class="px-4 py-2 text-center text-gray-400 font-mono">${estimatedCount}</td>
                    <td class="px-4 py-2 text-center max-w-[250px]">
                         <div class="bg-gray-800 text-orange-400 px-2 py-1 rounded text-[9px] font-mono border border-gray-600 break-words leading-tight shadow-inner">
                            ${t.osmTag}
                         </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                        <button onclick="window.removeMappingRule('${t.id}')" class="text-red-500 hover:text-white"><i class="fas fa-times"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            if (document.getElementById('total-count')) document.getElementById('total-count').textContent = totalCap;
            if (document.getElementById('total-weight')) document.getElementById('total-weight').textContent = `${totalWeight}%`;
        }
    }
}

window.removeMappingRule = (id) => {
    activeRules.delete(id);
    renderMappingRules();
    renderTemplateList();
};

window.openTemplateModal = () => {
    currentEditId = null;
    document.getElementById('tpl-id').value = '';
    ['name', 'icon', 'osm', 'level'].forEach(id => document.getElementById(`tpl-${id}`).value = '');
    document.getElementById('btn-delete').classList.add('hidden');
    document.getElementById('template-modal').classList.remove('hidden');
};

window.editTemplate = (id) => {
    const t = templates.find(t => t.id === id);
    if (!t) return;
    currentEditId = id;
    document.getElementById('tpl-id').value = id;
    document.getElementById('tpl-name').value = t.name;
    document.getElementById('tpl-icon').value = t.icon;
    document.getElementById('tpl-osm').value = t.osmTag || '';
    document.getElementById('tpl-level').value = t.level || 1;

    document.getElementById('btn-delete').classList.remove('hidden');
    document.getElementById('template-modal').classList.remove('hidden');
};

window.copyTemplate = async (id) => {
    const t = templates.find(t => t.id === id);
    if (!t) return;

    const copyName = prompt(`Copy Template "${t.name}"\n\nEnter new name:`, `${t.name} (Copy)`);
    if (!copyName) return;

    const newTemplate = {
        ...t,
        id: undefined,
        name: copyName
    };

    const success = await saveTemplate(newTemplate);
    if (success) {
        await loadTemplates();
        logConsole(`✅ Template "${copyName}" created from "${t.name}"`);
    }
};

window.closeTemplateModal = () => document.getElementById('template-modal').classList.add('hidden');

window.saveTemplateForm = async () => {
    const template = {
        name: document.getElementById('tpl-name').value,
        icon: document.getElementById('tpl-icon').value,
        osmTag: document.getElementById('tpl-osm').value,
        level: parseInt(document.getElementById('tpl-level').value) || 1,
        hp: (parseInt(document.getElementById('tpl-level').value) || 1) * 200,
        type: 'castle'
    };
    if (currentEditId) template.id = currentEditId;
    const success = await saveTemplate(template);
    if (success) {
        closeTemplateModal();
        loadTemplates();
    }
};

window.deleteTemplate = async () => {
    if (!currentEditId) return;
    if (confirm('Delete this template?')) {
        await deleteTemplate(currentEditId);
        closeTemplateModal();
        loadTemplates();
        logConsole('Template deleted.');
    }
};

// ==================== GENERATION LOGIC ====================

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

    // Mode Logging
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

            // Logic for 'Overwrite' vs 'Add'
            if (overwrite) {
                // Remove ALL old citadels, keep other objects (monsters, shops)
                // Filter OUT anything that looks like a citadel
                existingObjects = existingObjects.filter(o => {
                    const isCitadel = o.icon === '🏯' || (o.name && o.name.includes('Citadel')) || (o.templateId && o.templateId.includes('citadel'));
                    return !isCitadel;
                });
                logConsole(`🧹 Cleared old citadels. Retaining ${existingObjects.length} other objects.`);
            } else {
                // Keep everything, but separate existing Citadels for logic
                preservedCitadels = existingObjects.filter(o =>
                    o.icon === '🏯' || (o.name && o.name.includes('Citadel')) || (o.templateId && o.templateId.includes('citadel'))
                );
                logConsole(`📦 Preserving ${preservedCitadels.length} existing citadels.`);
            }
        }
    }

    logConsole(`📡 Connecting to Overpass API for citadels in ${city.name}...`);

    // Step 1: Resolve Area ID
    // Step 1: Resolve Area ID using unified Context Fetcher (Matches Visualization)
    let areaId = null;
    let cityRelId = null;
    let cityBoundary = null; // Will store the GeoJSON for filtering

    try {
        logConsole(`🔎 Resolving strict administrative boundaries for ${city.name} (Unified Context)...`);
        const ctx = await OverpassService.fetchCityContext(city.name, { lat: city.lat, lng: city.lng }, { includeDistricts: false });

        if (ctx.boundaryId) {
            cityRelId = ctx.boundaryId;
            areaId = 3600000000 + cityRelId;
            logConsole(`🎯 Selected boundary: ${city.name} [ID: ${cityRelId}]`);

            // Construct GeoJSON from rings for Filtering
            if (ctx.boundary) {
                // Ensure Turf is loaded
                if (!window.turf && !window.Turf) {
                    logConsole(`⏳ Loading Turf.js...`);
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
                        script.onload = () => {
                            if (window.turf || window.Turf) resolve();
                            else reject(new Error("Turf script loaded but global object missing"));
                        };
                        script.onerror = () => reject(new Error("Failed to load Turf.js"));
                        document.head.appendChild(script);
                    });
                }
                const turf = window.turf || window.Turf;
                if (!turf) throw new Error("Turf.js is not initialized");

                // const { getCleanCityMask } = await import('./territory-service.js'); // Not used for strict filtering
                // ctx.boundary is array of rings [lon, lat]
                let rawGeo = null;
                try {
                    // Normalize: Always treat as MultiPolygon for robustness with disjoint islands
                    // ctx.boundary is [ Ring1, Ring2, ... ] where each ring is [[lon, lat], ...]
                    rawGeo = turf.multiPolygon(ctx.boundary.map(r => [r]));

                    // CRITICAL: buffer(0) fixes self-intersections and other topological errors
                    // that often cause booleanPointInPolygon to return incorrect results.
                    cityBoundary = turf.buffer(rawGeo, 0);

                    logConsole(`🏙️ High-Def boundary loaded [ID: ${cityRelId}]. Poly contains ${ctx.boundary.length} rings.`);
                } catch (geoErr) {
                    console.error("Boundary conversion failed:", geoErr);
                    logConsole(`❌ Geometry error: ${geoErr.message}`);
                }
            }
        } else {
            logConsole(`⚠️ No administrative boundary found. Using simple radius fallback.`);
        }
    } catch (err) {
        logConsole(`⚠️ Boundary resolution failed: ${err.message}`);
    }

    let queryFilters = "";
    activeRules.forEach((weight, id) => {
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

            // CRITICAL: If searching for boundaries, exclude high-level ones (countries/states)
            // This prevents catching "Deutschland" or "Bayern" as a point-of-interest
            if (key === 'boundary' || val === 'administrative') {
                tagPart += '["admin_level"!~"^[1234567]$"]';
            }

            // Use Area filter if available, otherwise radius
            if (areaId) {
                queryFilters += `nwr${tagPart}(area:${areaId});\n`;
            } else {
                queryFilters += `nwr${tagPart}(around:15000,${city.lat},${city.lng});\n`;
            }
        });
    });

    if (!queryFilters) return logConsole('⚠️ No active rules.');

    try {
        const query = `[out:json][timeout:60]; (\n${queryFilters}); out center;`;
        const data = await OverpassService.fetchJSON(query);

        let processedCitadels = processNodesCitadel(data.elements, cityKey);
        logConsole(`✅ Received ${processedCitadels.length} raw POIs from chosen area.`);

        // --- UNIFORM DISTRIBUTION (FPS + SYNTHETIC FILLING) ---
        logConsole(`🔄 Optimizing distribution for ${capacity} foundation points...`);

        // Load Boundary Geometry for Filtering and Synthetic checks
        // Load Boundary Geometry - ALREADY DONE ABOVE
        if (cityBoundary) {
            // Already loaded via fetchCityContext
        } else if (cityRelId) {
            // Fallback if fetchCityContext failed to populate boundary but gave ID
            // ...existing logic skipped for cleaner flow
        }

        // STRICT FILTER: Remove any real POIs that are outside the precise administrative boundary
        if (cityBoundary && window.turf) {
            const initialCount = processedCitadels.length;
            processedCitadels = processedCitadels.filter(c => {
                try {
                    return window.turf.booleanPointInPolygon([c.lng, c.lat], cityBoundary);
                } catch (e) {
                    return false;
                }
            });
            const removed = initialCount - processedCitadels.length;
            logConsole(`🧹 Filtered out ${removed} real-world POIs outside the strict city boundary.`);
        }

        // If we have fewer POIs than capacity, or they are too clustered, we fill with synthetic points
        if (processedCitadels.length < capacity) {
            logConsole(`✨ Supplementing with ${capacity - processedCitadels.length} synthetic points for uniform coverage...`);

            // Use precise BBox of the boundary for synthetic range
            let cityBounds;
            if (cityBoundary && window.turf) {
                const maskBbox = window.turf.bbox(cityBoundary);
                cityBounds = {
                    minLng: maskBbox[0], minLat: maskBbox[1],
                    maxLng: maskBbox[2], maxLat: maskBbox[3]
                };
            } else {
                cityBounds = {
                    minLat: city.lat - 0.15, maxLat: city.lat + 0.15,
                    minLng: city.lng - 0.25, maxLng: city.lng + 0.25
                };
            }

            let attempts = 0;
            while (processedCitadels.length < capacity && attempts < 1000) {
                attempts++;
                const lat = cityBounds.minLat + Math.random() * (cityBounds.maxLat - cityBounds.minLat);
                const lng = cityBounds.minLng + Math.random() * (cityBounds.maxLng - cityBounds.minLng);

                // Check if point is inside city boundary
                let isInside = true;
                if (cityBoundary && window.turf) {
                    isInside = window.turf.booleanPointInPolygon([lng, lat], cityBoundary);
                }

                if (isInside) {
                    processedCitadels.push({
                        type: 'castle', cityId: cityKey, lat, lng,
                        templateId: 'synthetic_citadel',
                        name: `Point ${processedCitadels.length + 1}`,
                        icon: "🏯", level: 15, hp: 3000, maxHp: 3000
                    });
                }
            }
        }

        let finalCitadels = [];
        if (processedCitadels.length > capacity) {
            const selected = [];
            const candidates = [...processedCitadels];

            const firstIdx = 0; // Start with the first real POI (usually most important)
            selected.push(candidates[firstIdx]);
            candidates.splice(firstIdx, 1);

            const distCache = new Array(candidates.length).fill(Infinity);
            const getDistSq = (a, b) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;

            while (selected.length < capacity && candidates.length > 0) {
                const lastAdded = selected[selected.length - 1];
                let maxDist = -1;
                let bestIdx = -1;

                for (let i = 0; i < candidates.length; i++) {
                    const d = getDistSq(candidates[i], lastAdded);
                    if (d < distCache[i]) distCache[i] = d;
                    if (distCache[i] > maxDist) {
                        maxDist = distCache[i];
                        bestIdx = i;
                    }
                }

                if (bestIdx !== -1) {
                    selected.push(candidates[bestIdx]);
                    candidates.splice(bestIdx, 1);
                    distCache.splice(bestIdx, 1);
                } else break;
            }
            finalCitadels = selected;
        } else {
            finalCitadels = processedCitadels;
        }

        // Additive Save: Merge logic is now handled upfront
        // existingObjects already contains what we want to keep (based on overwrite flag)
        const mergedObjects = [...existingObjects, ...finalCitadels];

        // Recalculate Territories (Voronoi) using ALL citadels (preserved + new)
        let allCitadelsForZones = [...preservedCitadels, ...finalCitadels];

        // --- FINAL RESTRAINT: Strict Filter against cleaned mask (with safety margin) ---
        if (cityBoundary && window.turf) {
            const initialAllCount = allCitadelsForZones.length;
            // Shrink boundary by -10m to avoid precision artifacts at the edge
            try {
                const safetyMask = window.turf.buffer(cityBoundary, -0.01, { units: 'kilometers' });
                allCitadelsForZones = allCitadelsForZones.filter(c =>
                    window.turf.booleanPointInPolygon([c.lng, c.lat], safetyMask)
                );
                const lost = initialAllCount - allCitadelsForZones.length;
                if (lost > 0) logConsole(`🛡️ Strictly enforced city boundary: Removed ${lost} leaking citadels.`);
            } catch (e) { console.warn("Safety filter failed, using original mask."); }
        }

        // Additive Save: Update final merged objects to match filtered list
        const finalSavedObjects = [...existingObjects, ...allCitadelsForZones.filter(c => !preservedCitadels.includes(c))];

        // Fetch Boundary Geometry for Clipping (if not already fetched)
        let cityBoundaryGeoJson = cityBoundary;

        logConsole(`📍 Calculating foundation territories (Voronoi) for ${allCitadelsForZones.length} citadels...`);
        // Pass the fetched boundary geometry as rawMask
        const zonesGeoJson = await generateCityTerritory(cityKey, allCitadelsForZones, null, cityBoundaryGeoJson);

        const snapshotData = {
            id: finalId,
            name: snapName,
            cityId: cityKey,
            type: 'mixed',
            objects: finalSavedObjects,
            zones: JSON.stringify(zonesGeoJson)
        };

        logConsole(`💾 Saving Snap & Territories...`);
        const success = await saveWorldSnapshot(snapshotData);
        if (success) {
            await saveCityZones(cityKey, zonesGeoJson);
            logConsole(`✅ Foundation & Territories Updated!`);
            await window.loadWorldSnapshots();
            alert(`Generation successful!\n- ${finalCitadels.length} Citadels created\n- ${zonesGeoJson.features.length} Zones defined`);
        }

    } catch (e) {
        logConsole(`❌ Generation Error: ${e.message}`);
    }
};

function processNodesCitadel(nodes, cityId) {
    const city = CITY_ANCHORS.find(c => c.id === cityId);
    const results = [];
    nodes.forEach(node => {
        const lat = node.lat || (node.center && node.center.lat);
        const lng = node.lon || (node.center && node.center.lon);
        if (!lat || !lng) return;

        // Safety Filter: Ignore points too far from city center (>30km)
        // This stops "Deutschland" or other global relations that might bypass Overpass area filters
        if (city) {
            const dist = Math.sqrt(Math.pow(lat - city.lat, 2) + Math.pow(lng - city.lng, 2));
            if (dist > 0.3) return; // ~33km approx
        }

        let bestMatch = null;
        for (const t of templates) {
            if (!activeRules.has(t.id)) continue;
            // For foundation points, we prioritize the first active Citadel template
            if (t.name.includes("Citadel") || t.icon === "🏯") {
                bestMatch = t;
                break;
            }
        }

        if (bestMatch) {
            results.push({
                type: 'castle', cityId, lat, lng,
                templateId: bestMatch.id,
                name: node.tags.name || bestMatch.name,
                icon: bestMatch.icon,
                level: bestMatch.level || 15,
                hp: (bestMatch.level || 15) * 200,
                maxHp: (bestMatch.level || 15) * 200,
                realWorldId: node.id
            });
        }
    });
    return results;
}

function logConsole(msg) {
    const con = document.getElementById('console-log');
    if (!con) return;
    const div = document.createElement('div');
    div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    con.prepend(div);
}
