import { requireAdmin } from './admin-core.js';
import { BulkActions } from './template-bulk-actions.js';
import { getTemplates, saveTemplate, deleteTemplate, clearLocationObjects, saveGeneratedObjects, saveWorldSnapshot, getWorldSnapshots, getSnapshotById, isAdmin, getCurrentUser, initFirebase } from '../firebase/firebase-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';
import { generateCityTerritory, regenerateCityTerritory } from '../map/territory-service.js';
import { saveCityZones } from '../firebase/firebase-service.js';

let templates = [];
let currentEditId = null;
let activeRules = new Map(); // Stores Template ID -> Weight (0-100)
let generatedCount = new Map(); // Stores Template ID -> Count of spawned entities

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await requireAdmin(async () => {
        await loadTemplates();
        // restoreState();
        renderMappingRules();
        renderTemplateList();

        // Add capacity change listener to update counts and save config
        const capacityInput = document.getElementById('gen-capacity');
        if (capacityInput) {
            // Load saved
            const savedCap = localStorage.getItem('max_districts');
            if (savedCap) capacityInput.value = savedCap;

            capacityInput.addEventListener('input', () => {
                const val = parseInt(capacityInput.value) || 10;
                localStorage.setItem('max_districts', val);
                renderMappingRules();
            });
        }

        // Delay snapshot loading slightly
        setTimeout(() => {
            if (window.loadWorldSnapshots) window.loadWorldSnapshots();
        }, 1200);
    });
});

// ==================== TEMPLATE MANAGEMENT ====================

async function loadTemplates() {
    const list = document.getElementById('template-list');
    list.innerHTML = '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

    templates = await getTemplates('castle');

    // EXCLUDE CITADELS (They have their own dedicated admin page)
    templates = templates.filter(t =>
        t.icon !== '🏯' &&
        !t.name.includes('Citadel') &&
        !(t.id && t.id.includes('citadel'))
    );

    // Ensure default templates if none
    if (templates.length === 0) {
        await createDefaultCastleTemplates();
        templates = await getTemplates('castle');
    }

    renderTemplateList();
    renderMappingRules();
}

window.createDefaultCastleTemplates = async function () {
    const defaults = [
        {
            name: "Stone Keep",
            icon: "🏰",
            osmTag: "amenity=pub",
            type: "castle",
            level: 5,
            hp: 500
        },
        {
            name: "Wizard Tower",
            icon: "🧙‍♂️",
            osmTag: "amenity=bar",
            type: "castle",
            level: 8,
            hp: 600
        },
        {
            name: "Outpost",
            icon: "🛡️",
            osmTag: "amenity=cafe",
            type: "castle",
            level: 3,
            hp: 300
        }
    ];

    for (const t of defaults) {
        await saveTemplate(t);
    }
    logConsole("Created 3 default castle templates.");

    // Auto-setup for Template 4
    await loadTemplates(); // Refresh local list
    activeRules.clear();

    // Activate all 3 templates with 100% weight
    templates.forEach(t => {
        if (["Stone Keep", "Wizard Tower", "Outpost"].includes(t.name)) {
            activeRules.set(t.id, 100);
        }
    });

    renderMappingRules();
    renderTemplateList();

    // Start generation automatically
    logConsole("🪄 Magic Wand: Starting 'Template 4' generation...");
    window.autoTargetSnapName = "Template 4";
    const capInput = document.getElementById('gen-capacity');
    if (capInput) capInput.value = 100; // Increased capacity for all types
    startGeneration();
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

    logConsole('🔄 Loading map templates...');

    try {
        const snaps = await getWorldSnapshots();
        logConsole(`📦 Found ${snaps.length} snapshots total.`);

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

const bulk = new BulkActions(deleteTemplate, loadTemplates);

function renderTemplateList() {
    const list = document.getElementById('template-list');
    list.innerHTML = '';

    const visible = [...templates];
    bulk.injectSelectAllHeader(list, visible.map(t => t.id));

    visible.forEach(t => {
        const el = document.createElement('div');
        const isActive = activeRules.has(t.id);
        const activeClass = isActive ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 hover:border-blue-500';

        el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;

        el.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0">${t.icon || '🏰'}</span>
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
        // Prepend bulk checkbox
        el.querySelector('.flex.items-center.gap-2').prepend(bulk.createCheckbox(t.id));

        el.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input[type=checkbox]')) {
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
    saveState();
}

window.updateRuleWeight = (id, val) => {
    let weight = parseInt(val);
    if (isNaN(weight)) weight = 0;
    if (weight < 0) weight = 0;
    if (weight > 100) weight = 100;

    if (activeRules.has(id)) {
        activeRules.set(id, weight);
        saveState();
    }
};

function renderMappingRules() {
    const tbody = document.getElementById('rules-table');
    const emptyMsg = document.getElementById('rules-empty');
    if (tbody) {
        tbody.innerHTML = '';
        if (activeRules.size === 0) {
            if (emptyMsg) emptyMsg.classList.remove('hidden');
            const totalEl = document.getElementById('total-count');
            if (totalEl) totalEl.textContent = '0';
            const totalWeightEl = document.getElementById('total-weight');
            if (totalWeightEl) {
                totalWeightEl.textContent = '0%';
                totalWeightEl.className = "px-4 py-2 text-center";
            }
        } else {
            if (emptyMsg) emptyMsg.classList.add('hidden');

            const totalCap = parseInt(document.getElementById('gen-capacity')?.value) || 1000;
            let totalWeight = 0;

            activeRules.forEach((weight) => {
                totalWeight += weight;
            });

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
                    <td class="px-4 py-2 text-center text-gray-400 font-mono">
                        ${estimatedCount}
                    </td>
                    <td class="px-4 py-2 text-center max-w-[250px]">
                         <div class="bg-gray-800 text-blue-400 px-2 py-1 rounded text-[9px] font-mono border border-gray-600 break-words leading-tight shadow-inner">
                            ${t.osmTag}
                         </div>
                    </td>
                    <td class="px-4 py-2 text-right">
                        <button onclick="removeMappingRule('${t.id}')" class="text-red-500 hover:text-white"><i class="fas fa-times"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            const totalEl = document.getElementById('total-count');
            if (totalEl) totalEl.textContent = totalCap;

            const totalWeightEl = document.getElementById('total-weight');
            if (totalWeightEl) {
                totalWeightEl.textContent = `${totalWeight}%`;
                totalWeightEl.className = totalWeight === 100 ?
                    "px-4 py-2 text-center text-green-400" :
                    "px-4 py-2 text-center text-yellow-500";
            }
        }
    }

    saveState();
}

window.removeMappingRule = (id) => {
    activeRules.delete(id);
    renderMappingRules();
};

window.openTemplateModal = () => {
    currentEditId = null;
    document.getElementById('tpl-id').value = '';
    document.getElementById('btn-delete').classList.add('hidden');

    ['name', 'icon', 'osm', 'level'].forEach(id => document.getElementById(`tpl-${id}`).value = '');
    document.getElementById('template-modal').classList.remove('hidden');
};

window.editTemplate = (id) => {
    const t = templates.find(t => t.id === id);
    if (!t) return;

    currentEditId = id;
    document.getElementById('tpl-id').value = id;
    document.getElementById('btn-delete').classList.remove('hidden');

    document.getElementById('tpl-name').value = t.name;
    document.getElementById('tpl-icon').value = t.icon;
    document.getElementById('tpl-osm').value = t.osmTag || '';
    document.getElementById('tpl-level').value = t.level || 1;

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

    delete newTemplate.id;

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
        hp: (parseInt(document.getElementById('tpl-level').value) || 1) * 100,
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

// ==================== STATE PERSISTENCE ====================

function saveState() {
    // Disabled persistence as per user request
}

function restoreState() {
    try {
        const saved = localStorage.getItem('admin_castles_state');
        if (!saved) return;

        const state = JSON.parse(saved);

        if (state.consoleLog) {
            document.getElementById('console-log').innerHTML = state.consoleLog;
        }
        if (state.city) document.getElementById('gen-city').value = state.city;
        if (document.getElementById('gen-capacity')) {
            document.getElementById('gen-capacity').value = state.capacity || '1000';
        }
        if (state.activeRules) {
            activeRules = new Map(state.activeRules);
        }

    } catch (e) {
        console.error('Failed to restore state:', e);
    }
}

// ==================== GENERATION LOGIC ====================

window.startGeneration = async (overwrite = true) => {
    const cityKey = document.getElementById('gen-city').value;
    const capacity = parseInt(document.getElementById('gen-capacity')?.value) || 1000;
    const city = CITY_ANCHORS.find(c => c.id === cityKey);

    if (!city) return logConsole('❌ Invalid city selected.');

    // Mode Logging
    logConsole(overwrite ? "🗑️ Mode: Create / Delete + Create (Replenish Castles)" : "➕ Mode: Add if exist");

    const targetTemplateId = document.getElementById('gen-template').value;
    let snapName = "";
    let finalId = null;
    let existingObjects = [];
    let zonesGeoJson = null;

    generatedCount.clear();
    renderMappingRules();

    if (targetTemplateId === 'new') {
        if (window.autoTargetSnapName) {
            snapName = window.autoTargetSnapName;
            window.autoTargetSnapName = null;
        } else {
            snapName = prompt("Enter a name for this new Map Template:", `${cityKey}_castles_${new Date().toLocaleDateString()}`);
            if (!snapName) return;
        }
    } else {
        const selector = document.getElementById('gen-template');
        snapName = selector.options[selector.selectedIndex].text.split(' (')[0].replace(/^..?\s*/, "").trim();
        finalId = targetTemplateId;

        const { getSnapshotById } = await import('../firebase/firebase-service.js');
        const existingSnap = await getSnapshotById(finalId);
        if (existingSnap && existingSnap.objects) {
            const allSavedObjects = existingSnap.objects;

            if (!overwrite) {
                // MERGE: Keep everything
                console.log("Merging: Keeping all existing objects.");
                existingObjects = allSavedObjects;
            } else {
                // RELOAD: Partition objects: Keep infrastructure/monsters/shops/CITADELS, drop ONLY regular castles
                console.log("Reloading: Filtering out only regular castles (keeping Citadels).");
                existingObjects = allSavedObjects.filter(o => {
                    // Keep if NOT a castle at all
                    if (o.type !== 'castle') return true;

                    // If it IS a castle, check if it's a Citadel (keep Citadels)
                    const isCitadel = o.icon === '�' ||
                        (o.name && o.name.includes('Citadel')) ||
                        (o.templateId && o.templateId.includes('citadel'));

                    return isCitadel; // Keep citadels, drop regular castles
                });
            }

            // Preserve existing zones if they exist (IN BOTH MODES)
            if (existingSnap.zones) {
                try {
                    zonesGeoJson = (typeof existingSnap.zones === 'string') ? JSON.parse(existingSnap.zones) : existingSnap.zones;
                    logConsole(`📋 Preserved ${zonesGeoJson.features.length} zones from existing template.`);
                } catch (e) { console.error("Error parsing existing zones:", e); }
            }
        }
    }

    // 2. Pre-Generational Zone Logic (CRITICAL for Add Mode)
    // If we have citadels but no zones yet, calculate them NOW so allocation works
    const existingCitadels = existingObjects.filter(o =>
        o.icon === '🏯' ||
        (o.name && o.name.includes('Citadel')) ||
        o.templateId?.includes('citadel')
    ).map((c, idx) => ({
        ...c,
        id: c.id || c.name || `citadel_${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`
    }));

    if (existingCitadels.length >= 2 && !zonesGeoJson) {
        logConsole(`📍 Citadels detected. Calculating distribution zones...`);
        try {
            zonesGeoJson = await generateCityTerritory(cityKey, existingCitadels, null);
            logConsole(`✅ ${zonesGeoJson.features.length} zones ready for distribution.`);
        } catch (err) {
            logConsole(`⚠️ Zone Calculation Failed: ${err.message}`);
        }
    }

    const searchRadius = 10000; // Reduced to 10km for better reliability in dense cities
    logConsole(`📡 Connecting to Overpass API for ${city.name} (radius: 10km, targeting ${capacity} castles)...`);

    // Dynamic Query based on Active Rules
    let queryFilters = "";
    activeRules.forEach((weight, id) => {
        if (weight <= 0) return;
        const t = templates.find(temp => temp.id === id);
        if (!t || !t.osmTag) return;

        // Support for multiple tag sets separated by semicolon
        const tagSets = t.osmTag.split(';');

        tagSets.forEach(tagSet => {
            const trimmed = tagSet.trim();
            if (!trimmed) return;

            // Handle Key~Value or Key=Value
            const isRegex = trimmed.includes('~');
            const parts = trimmed.split(/[=~]/);
            const key = parts[0].trim();
            const val = parts[1] ? parts[1].trim() : '';

            const op = isRegex ? '~' : '=';
            const tagPart = (val && val !== '*') ? `["${key}"${op}"${val}"]` : `["${key}"]`;

            // Special handling for administrative boundaries
            if (key === 'boundary' && val === 'administrative') {
                queryFilters += `relation["boundary"="administrative"]["admin_level"~"^(8|9|10)$"](around:${searchRadius},${city.lat},${city.lng});\n`;
            } else {
                // Use 'nwr' for optimized node/way/relation combined search
                queryFilters += `nwr${tagPart}(around:${searchRadius},${city.lat},${city.lng});\n`;
            }
        });
    });

    if (!queryFilters) {
        logConsole('⚠️ No active rules or tags. Select templates first.');
        return;
    }

    const query = `
        [out:json][timeout:90];
        (
          ${queryFilters}
        );
        out center;
    `;

    try {
        let response;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
            response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: "data=" + encodeURIComponent(query)
            });

            if (response.status === 429 || response.status === 504 || response.status === 503 || response.status === 502) {
                retries++;
                const delay = retries * 5000; // Increased delay for timeouts (5s, 10s, 15s)
                const errorMsg = response.status === 429 ? "Rate limit" : "Server timeout/busy";
                logConsole(`⏳ ${errorMsg} (${response.status}). Retrying in ${delay / 1000}s... (Attempt ${retries}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            break;
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Overpass Error:", errorText);
            throw new Error(`Overpass API Error: ${response.status}`);
        }

        const data = await response.json();
        const nodes = data.elements;
        logConsole(`✅ Received ${nodes.length} raw POIs from OSM.`);

        const processedCastles = processNodesInternal(nodes, cityKey);

        // Process & Balance Distribution
        if (!window.turf) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load Turf.js"));
                document.head.appendChild(script);
            });
        }
        const turf = window.turf;
        let newCastles = [];

        // Prepare template picker weights
        const selectionList = Array.from(activeRules.entries()).map(([id, weight]) => {
            const t = templates.find(temp => temp.id === id);
            return t ? { ...t, weight } : null;
        }).filter(Boolean);
        const totalWeight = selectionList.reduce((sum, t) => sum + t.weight, 0);

        if (zonesGeoJson && zonesGeoJson.features.length > 0) {
            // ZONE-BASED BALANCED DISTRIBUTION
            // Group features by citadelId (in case one citadel has multiple polygons/islands)
            const zonesById = {};
            zonesGeoJson.features.forEach((f, idx) => {
                let id = f.properties?.citadelId ||
                    f.properties?.id ||
                    f.id;

                if (!id || id === "Citadel" || id === "Castle") {
                    id = `zone_${idx}`;
                }
                if (!zonesById[id]) zonesById[id] = [];
                zonesById[id].push(f);
            });

            const uniqueZoneIds = Object.keys(zonesById);
            const totalLogicalZones = uniqueZoneIds.length;
            const targetPerZone = Math.floor(capacity / totalLogicalZones);
            const remainder = capacity % totalLogicalZones;

            logConsole(`⚖️ Distributing ${capacity} castles across ${totalLogicalZones} logical zones...`);

            uniqueZoneIds.forEach((citadelId, idx) => {
                const zoneFeatures = zonesById[citadelId];
                const zoneTarget = targetPerZone + (idx < remainder ? 1 : 0);
                let zoneCount = 0;

                // 1. Try to pull from OSM data first
                const internalOsm = processedCastles.filter(pt =>
                    zoneFeatures.some(f => turf.booleanPointInPolygon([pt.lng, pt.lat], f))
                );

                if (internalOsm.length > 0) {
                    const take = Math.min(internalOsm.length, zoneTarget);
                    const selected = internalOsm.sort(() => Math.random() - 0.5).slice(0, take);
                    newCastles.push(...selected.map(c => ({ ...c, zoneId: citadelId })));
                    zoneCount += take;
                }

                // 2. Fill remaining with random points if target not met
                if (zoneCount < zoneTarget) {
                    const needed = zoneTarget - zoneCount;
                    const pointsPerFeature = Math.ceil(needed / zoneFeatures.length);

                    for (const f of zoneFeatures) {
                        let featureNeeded = Math.min(pointsPerFeature, zoneTarget - zoneCount);
                        for (let n = 0; n < featureNeeded; n++) {
                            const rndPt = generateRandomPointInPolygon(f);
                            if (rndPt) {
                                const template = pickCastleTemplateByWeight(selectionList, totalWeight);
                                newCastles.push({
                                    ...template,
                                    lat: rndPt.lat,
                                    lng: rndPt.lng,
                                    cityId: cityKey,
                                    zoneId: citadelId,
                                    hp: (template.level || 1) * 100,
                                    maxHp: (template.level || 1) * 100
                                });
                                zoneCount++;
                            }
                        }
                    }
                }
                logConsole(`📍 Zone <b>${citadelId.split('_').pop()}</b>: ${zoneCount} castles`);
            });
        } else {
            // FALLBACK: GRID-BASED BALANCED DISTRIBUTION (If no Citadels)
            logConsole(`🎲 No zones found. Using 5x5 Grid for uniform coverage...`);
            const gridZones = 5;
            const latStep = 0.1 / gridZones;
            const lngStep = 0.1 / gridZones;
            const targetPerCell = Math.floor(capacity / (gridZones * gridZones));
            const remainder = capacity % (gridZones * gridZones);
            let cellIdx = 0;

            for (let y = 0; y < gridZones; y++) {
                for (let x = 0; x < gridZones; x++) {
                    const cellTarget = targetPerCell + (cellIdx < remainder ? 1 : 0);
                    const cellLat = city.lat - 0.05 + (y * latStep);
                    const cellLng = city.lng - 0.05 + (x * lngStep);
                    const cellPoly = turf.bboxPolygon([cellLng, cellLat, cellLng + lngStep, cellLat + latStep]);

                    // Filter OSM
                    const internalOsm = processedCastles.filter(pt =>
                        turf.booleanPointInPolygon([pt.lng, pt.lat], cellPoly)
                    );

                    if (internalOsm.length >= cellTarget) {
                        newCastles.push(...internalOsm.sort(() => Math.random() - 0.5).slice(0, cellTarget));
                    } else {
                        newCastles.push(...internalOsm);
                        const needed = cellTarget - internalOsm.length;
                        for (let n = 0; n < needed; n++) {
                            const rndPt = generateRandomPointInPolygon(cellPoly);
                            if (rndPt) {
                                const template = pickCastleTemplateByWeight(selectionList, totalWeight);
                                newCastles.push({
                                    ...template,
                                    lat: rndPt.lat,
                                    lng: rndPt.lng,
                                    cityId: cityKey,
                                    hp: (template.level || 1) * 100,
                                    maxHp: (template.level || 1) * 100
                                });
                            }
                        }
                    }
                    cellIdx++;
                }
            }
        }

        logConsole(`✅ Generated ${newCastles.length} castles with balanced distribution.`);

        const mergedObjects = [...existingObjects, ...newCastles];

        // 1. Calculate Zones if Citadels exist
        zonesGeoJson = null;
        const citadels = mergedObjects.filter(o =>
            o.icon === '🏯' ||
            (o.name && o.name.includes('Citadel')) ||
            o.templateId?.includes('citadel')
        );

        if (citadels.length >= 2) {
            logConsole(`📍 Citadels detected. Calculating math zones...`);
            try {
                // Calculate ONLY (don't save to DB yet)
                zonesGeoJson = await generateCityTerritory(cityKey, citadels, null);
                logConsole(`✅ Zones calculated (${zonesGeoJson.features.length} polygons).`);
            } catch (err) {
                logConsole(`⚠️ Zone Calculation Failed: ${err.message}`);
            }
        }

        // 2. Save Snapshot (Include Zones)
        logConsole(`💾 Saving Template "${snapName}"...`);
        const snapshotData = {
            id: finalId,
            name: snapName,
            cityId: cityKey,
            type: existingObjects.length > 0 ? 'mixed' : 'castle',
            objects: mergedObjects
        };

        // Serialize zones into the snapshot if they exist
        if (zonesGeoJson) {
            snapshotData.zones = JSON.stringify(zonesGeoJson);
            logConsole(`📦 Attached ${snapshotData.zones.length} chars of zone data.`);
        }

        const success = await saveWorldSnapshot(snapshotData);

        if (success) {
            logConsole(`✅ Template Saved! Go to "Map" tab to view.`);

            // 3. Update Live Game Zones (if we have them)
            if (zonesGeoJson) {
                try {
                    await saveCityZones(cityKey, zonesGeoJson);
                    logConsole(`✅ Live Zones synchronized for ${cityKey.toUpperCase()}.`);
                } catch (saveErr) {
                    logConsole(`⚠️ Failed to sync live zones: ${saveErr.message}`);
                }
            }

            await window.loadWorldSnapshots();
            alert('Generation complete! Template saved and territories synchronized.');
        }

    } catch (e) {
        logConsole(`❌ Error: ${e.message}`);
    }
};

function processNodesInternal(nodes, cityId) {
    const results = [];

    nodes.forEach(node => {
        // Extract coordinates (handle Way/Relation centers)
        const lat = node.lat || (node.center && node.center.lat);
        const lng = node.lon || (node.center && node.center.lon);

        if (!lat || !lng) return;

        let match = null;

        for (const t of templates) {
            if (!activeRules.has(t.id)) continue;
            if (!t.osmTag) continue;

            const tags = node.tags;
            if (!tags) continue;

            // Handle multiple tag sets separated by semicolon
            const tagSets = t.osmTag.split(';');
            let matchedSet = false;

            for (const tagSet of tagSets) {
                const trimmed = tagSet.trim();
                if (!trimmed) continue;

                const isRegex = trimmed.includes('~');
                const parts = trimmed.split(/[=~]/);
                const key = parts[0].trim();
                const val = parts[1] ? parts[1].trim() : '';

                if (tags[key]) {
                    const tagVal = tags[key];
                    let isMatch = false;

                    if (isRegex) {
                        const regex = new RegExp(`^(${val})$`);
                        isMatch = regex.test(tagVal);
                    } else {
                        isMatch = (val === '*' || tagVal === val);
                    }

                    // Special condition for administrative level
                    if (isMatch && key === 'boundary' && val === 'administrative') {
                        if (!tags.admin_level || !/^(8|9|10)$/.test(tags.admin_level)) {
                            isMatch = false;
                        }
                    }

                    if (isMatch) {
                        matchedSet = true;
                        break;
                    }
                }
            }

            if (matchedSet) {
                const weight = activeRules.get(t.id) || 0;
                if (Math.random() * 100 < weight) {
                    match = t;
                    const current = generatedCount.get(t.id) || 0;
                    generatedCount.set(t.id, current + 1);
                    break;
                }
            }
        }

        if (match) {
            results.push({
                type: 'castle',
                cityId: cityId,
                lat: lat,
                lng: lng,
                templateId: match.id,
                name: node.tags.name || match.name,
                icon: match.icon,
                level: match.level || 1,
                hp: (match.level || 1) * 100,
                maxHp: (match.level || 1) * 100,
                realWorldId: node.id
            });
        }
    });

    renderMappingRules();
    return results;
}

function logConsole(msg) {
    const con = document.getElementById('console-log');
    if (!con) return;
    const div = document.createElement('div');
    div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    con.prepend(div);
    saveState();
}

// ==================== BALANCED HELPERS ====================

function generateRandomPointInPolygon(feature) {
    const turf = window.turf;
    const bbox = turf.bbox(feature);
    const [minLng, minLat, maxLng, maxLat] = bbox;
    for (let attempt = 0; attempt < 500; attempt++) {
        const lng = minLng + Math.random() * (maxLng - minLng);
        const lat = minLat + Math.random() * (maxLat - minLat);
        if (turf.booleanPointInPolygon([lng, lat], feature)) return { lat, lng };
    }
    return null;
}

function pickCastleTemplateByWeight(list, totalWeight) {
    const rnd = Math.random() * totalWeight;
    let cur = 0;
    for (const t of list) {
        cur += (t.weight || 0);
        if (rnd <= cur) {
            return {
                type: 'castle',
                templateId: t.id,
                name: t.name,
                icon: t.icon,
                level: t.level || 1
            };
        }
    }
    return null;
}
