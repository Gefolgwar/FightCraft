
import { requireAdmin } from './admin-core.js';
import { BulkActions } from './template-bulk-actions.js';
import { getTemplates, saveTemplate, deleteTemplate, clearLocationObjects, saveGeneratedObjects, saveWorldSnapshot, getWorldSnapshots, isAdmin, getCurrentUser, initFirebase } from '../firebase/firebase-service.js';
import { generateMonstersFromOSM } from '../gameplay/generation-service.js';
import { generateCityTerritory } from '../map/territory-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';

let templates = [];
let currentEditId = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    await requireAdmin(async () => {
        await loadTemplates();
        // Clear previous state (ensure no restore from localStorage as per user request)

        const capacityInput = document.getElementById('gen-capacity');
        if (capacityInput) {
            capacityInput.addEventListener('input', () => {
                updateDistributionTable();
            });
        }

        // Delay snapshot loading slightly to ensure Admin role is firm
        setTimeout(() => {
            if (window.loadWorldSnapshots) window.loadWorldSnapshots();
        }, 1200);
    });
});

// ==================== TEMPLATE MANAGEMENT ====================

async function loadTemplates() {
    const list = document.getElementById('template-list');
    list.innerHTML = '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

    templates = await getTemplates('monster');
    renderTemplateList();
}

window.createDefaultMonsterTemplates = async function () {
    const defaults = [
        { name: "Goblin Scout", icon: "👺", hp: 30, damage: 5, xpReward: 15, level: 1, type: "monster", weight: 40, tag: "forest" },
        { name: "Forest Wolf", icon: "🐺", hp: 50, damage: 8, xpReward: 25, level: 2, type: "monster", weight: 30, tag: "forest" },
        { name: "Skeleton Warrior", icon: "💀", hp: 45, damage: 7, xpReward: 20, level: 2, type: "monster", weight: 20, tag: "dungeon" },
        { name: "Orc Brute", icon: "👹", hp: 120, damage: 15, xpReward: 60, level: 5, type: "monster", weight: 10, tag: "dungeon" },
        { name: "Water Slime", icon: "💧", hp: 25, damage: 3, xpReward: 10, level: 1, type: "monster", weight: 30, tag: "water" },
        { name: "City Rat", icon: "🐀", hp: 15, damage: 2, xpReward: 5, level: 1, type: "monster", weight: 50, tag: "city" },
        { name: "Zombie", icon: "🧟", hp: 60, damage: 10, xpReward: 30, level: 3, type: "monster", weight: 15, tag: "city" }
    ];

    for (const t of defaults) {
        await saveTemplate(t);
    }
    logConsole("Created default monster templates.");
}

const bulk = new BulkActions(deleteTemplate, loadTemplates);

function renderTemplateList() {
    const list = document.getElementById('template-list');
    const search = document.getElementById('template-search').value.toLowerCase();

    list.innerHTML = '';

    const visible = templates.filter(t => t.name.toLowerCase().includes(search));
    bulk.injectSelectAllHeader(list, visible.map(t => t.id));

    visible.forEach(t => {
            const el = document.createElement('div');
            const isActive = selectedTemplates.has(t.id);
            const activeClass = isActive ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 hover:border-purple-500';

            el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;
            el.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-xl">${t.icon || '👾'}</span>
                    <div>
                        <div class="font-bold text-sm text-gray-300">${t.name}</div>
                        <div class="text-[10px] text-gray-500">Lv.${t.level || 1} • ${t.hp} HP</div>
                    </div>
                </div>
                <div class="opacity-0 group-hover:opacity-100 flex gap-2">
                    <button class="text-xs text-green-400 hover:text-white" onclick="event.stopPropagation(); window.copyTemplate('${t.id}')" title="Copy Template">
                        <i class="fas fa-copy"></i>
                    </button>
                    <button class="text-xs text-blue-400 hover:text-white" onclick="event.stopPropagation(); window.editTemplate('${t.id}')">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            `;
            // Prepend bulk checkbox
            el.querySelector('.flex.items-center.gap-2').prepend(bulk.createCheckbox(t.id));
            // Add click listener for selection (logic for distribution later)
            el.addEventListener('click', (e) => {
                if (!e.target.closest('button') && !e.target.closest('input[type=checkbox]')) toggleTemplateSelection(t);
            });
            list.appendChild(el);
        });

    updateDistributionTable();
}

window.openTemplateModal = () => {
    currentEditId = null;
    document.getElementById('tpl-id').value = '';
    document.getElementById('btn-delete').classList.add('hidden');

    // Clear fields
    ['name', 'icon', 'hp', 'dmg', 'def', 'xp', 'weight', 'loot'].forEach(id => document.getElementById(`tpl-${id}`).value = '');
    document.getElementById('tpl-hp').value = 100;

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
    document.getElementById('tpl-hp').value = t.hp;
    document.getElementById('tpl-dmg').value = t.damage || 10;
    document.getElementById('tpl-def').value = t.defense || 0;
    document.getElementById('tpl-xp').value = t.xpReward || 50;
    document.getElementById('tpl-weight').value = t.weight || 10;
    document.getElementById('tpl-tag').value = t.tag || 'generic';
    document.getElementById('tpl-loot').value = (t.loot || []).join(', ');

    document.getElementById('template-modal').classList.remove('hidden');
};

window.copyTemplate = async (id) => {
    const t = templates.find(t => t.id === id);
    if (!t) return;

    const copyName = prompt(`Copy Template "${t.name}"\n\nEnter new name:`, `${t.name} (Copy)`);
    if (!copyName) return; // User cancelled

    const newTemplate = {
        ...t,
        id: undefined, // Force new ID generation
        name: copyName
    };

    delete newTemplate.id; // Make sure ID is cleared

    const success = await saveTemplate(newTemplate);
    if (success) {
        await loadTemplates();
        logConsole(`✅ Template "${copyName}" created from "${t.name}"`);
    }
};

window.closeTemplateModal = () => {
    document.getElementById('template-modal').classList.add('hidden');
};

window.saveTemplateForm = async () => {
    const template = {
        name: document.getElementById('tpl-name').value,
        icon: document.getElementById('tpl-icon').value,
        hp: parseInt(document.getElementById('tpl-hp').value),
        maxHp: parseInt(document.getElementById('tpl-hp').value),
        damage: parseInt(document.getElementById('tpl-dmg').value),
        defense: parseInt(document.getElementById('tpl-def').value),
        xpReward: parseInt(document.getElementById('tpl-xp').value),
        weight: parseInt(document.getElementById('tpl-weight').value),
        tag: document.getElementById('tpl-tag').value,
        loot: document.getElementById('tpl-loot').value.split(',').map(s => s.trim()).filter(s => s),
        type: 'monster'
    };

    if (currentEditId) template.id = currentEditId;

    const success = await saveTemplate(template);
    if (success) {
        closeTemplateModal();
        loadTemplates();
        logConsole(`Template "${template.name}" saved.`);
    }
};

window.deleteTemplate = async () => {
    if (!currentEditId) return;
    if (confirm('Are you sure you want to delete this template?')) {
        await deleteTemplate(currentEditId);
        closeTemplateModal();
        loadTemplates();
        logConsole(`Template deleted.`);
    }
};

document.getElementById('template-search').addEventListener('input', renderTemplateList);

// ==================== STATE PERSISTENCE ====================

function saveState() {
    // Disabled persistence as per user request
}

function restoreState() {
    try {
        const saved = localStorage.getItem('admin_monsters_state');
        if (!saved) return;

        const state = JSON.parse(saved);

        // Restore selected templates
        if (state.selectedTemplates) {
            selectedTemplates = new Set(state.selectedTemplates);
            updateDistributionTable();
        }

        // Restore console log
        if (state.consoleLog) {
            document.getElementById('console-log').innerHTML = state.consoleLog;
        }

        // Restore form values
        if (state.city) document.getElementById('gen-city').value = state.city;
        if (state.capacity) document.getElementById('gen-capacity').value = state.capacity;

    } catch (e) {
        console.error('Failed to restore state:', e);
    }
}


// ==================== GENERATION LOGIC ====================

let selectedTemplates = new Set();

function toggleTemplateSelection(template) {
    if (selectedTemplates.has(template.id)) {
        selectedTemplates.delete(template.id);
    } else {
        selectedTemplates.add(template.id);
        template.weight = 100; // Default to 100% as requested
    }
    renderTemplateList(); // Re-render to show highlight
}

function updateDistributionTable() {
    const table = document.getElementById('distribution-table');
    const totalCap = parseInt(document.getElementById('gen-capacity').value) || 1000;

    table.innerHTML = '';

    if (selectedTemplates.size === 0) {
        table.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-gray-500">Click templates in the sidebar to add them here.</td></tr>';
        document.getElementById('total-weight').textContent = '0%';
        document.getElementById('total-count').textContent = '0';
        return;
    }

    let totalWeight = 0;

    // First pass to get total weight
    Array.from(selectedTemplates).forEach(id => {
        const t = templates.find(temp => temp.id === id);
        if (t) totalWeight += (t.weight || 0);
    });

    // Second pass to render and calculate counts
    Array.from(selectedTemplates).forEach(id => {
        const t = templates.find(temp => temp.id === id);
        if (!t) return;

        // Relative weight distribution like in shops/castles
        const count = totalWeight > 0 ? Math.round(totalCap * (t.weight / totalWeight)) : 0;

        const row = document.createElement('tr');
        row.className = 'border-b border-gray-800 hover:bg-gray-800/50';
        row.innerHTML = `
            <td class="px-4 py-2 flex items-center gap-2">
                <span class="text-lg">${t.icon}</span> ${t.name}
            </td>
            <td class="px-4 py-2 text-center">
                <input type="number" class="w-16 bg-gray-900 border border-gray-700 rounded text-center text-xs p-1" 
                    value="${t.weight}" onchange="updateWeight('${t.id}', this.value)"> %
            </td>
            <td class="px-4 py-2 text-center text-gray-400 font-mono">${count}</td>
            <td class="px-4 py-2 text-right">
                <button onclick="removeSelection('${t.id}')" class="text-red-500 hover:text-white"><i class="fas fa-times"></i></button>
            </td>
        `;
        table.appendChild(row);
    });

    document.getElementById('total-weight').textContent = `${totalWeight}%`;
    document.getElementById('total-count').textContent = totalCap;
    document.getElementById('total-weight').className = totalWeight === 100 ? "px-4 py-2 text-center text-green-400" : "px-4 py-2 text-center text-yellow-500";

    const warning = document.getElementById('dist-warning');
    if (totalWeight !== 100) warning.classList.remove('hidden');
    else warning.classList.add('hidden');
}

window.updateWeight = (id, val) => {
    const t = templates.find(temp => temp.id === id);
    if (t) {
        t.weight = parseInt(val) || 0;
        updateDistributionTable();
    }
};

window.removeSelection = (id) => {
    selectedTemplates.delete(id);
    updateDistributionTable();
};

// Make available globally for Refresh button
window.loadWorldSnapshots = async function () {
    const selector = document.getElementById('gen-template');
    if (!selector) return;

    // Check admin status explicitly for debugging
    if (!isAdmin()) {
        logConsole('⚠️ skipping snapshot load: Waiting for admin role...');
        // Retry once after short delay if strictly needed, but better to rely on button
        return;
    }

    const currentVal = selector.value;

    // Keep the "New" option
    // Reset but keep "New"
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

        // Restore selection if possible
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

window.calculateDistribution = () => {
    updateDistributionTable(); // Refresh numbers
    logConsole('Distribution updated based on current capacity.');
};

window.startGeneration = async (overwrite = true) => {
    const cityKey = document.getElementById('gen-city').value;
    const capacity = parseInt(document.getElementById('gen-capacity').value);
    const useOSM = document.getElementById('use-osm').checked;
    const targetTemplateId = document.getElementById('gen-template').value;

    // Mode Logging
    logConsole(overwrite ? "🗑️ Mode: Create / Delete + Create (Replenish Monsters)" : "➕ Mode: Add if exist");

    // Validate Weights
    let currentWeight = 0;
    selectedTemplates.forEach(id => {
        const t = templates.find(temp => temp.id === id);
        if (t) currentWeight += t.weight;
    });
    if (currentWeight !== 100) {
        if (!confirm(`Total weight is ${currentWeight}% (not 100%). Continue?`)) return;
    }
    if (selectedTemplates.size === 0) {
        alert('Please select at least one monster template.');
        return;
    }

    const cityAnchor = CITY_ANCHORS.find(c => c.id === cityKey);
    if (!cityAnchor) {
        logConsole('❌ Error: City anchor not found!');
        return;
    }

    let snapName = "";
    let finalId = null;
    let existingObjects = [];
    let zonesGeoJson = null;
    const { getSnapshotById } = await import('../firebase/firebase-service.js');

    if (targetTemplateId === 'new') {
        snapName = prompt("Enter a name for this new Map Template:", `${cityKey}_${new Date().toLocaleDateString()}`);
        if (!snapName) return;
    } else {
        const selector = document.getElementById('gen-template');
        snapName = selector.options[selector.selectedIndex].text.split(' (')[0].replace(/^..?\s*/, "").trim();
        finalId = targetTemplateId;

        // Fetch existing
        const existingSnap = await getSnapshotById(finalId);
        if (existingSnap && existingSnap.objects) {
            const allSavedObjects = existingSnap.objects;

            if (!overwrite) {
                // MERGE: Add new to existing
                console.log("Merging: Keeping all existing objects.");
                existingObjects = allSavedObjects;
            } else {
                // RELOAD: Partition objects: Keep infrastructure, drop monsters
                const infrastructure = allSavedObjects.filter(o =>
                    o.type === 'shop' ||
                    o.type === 'castle' ||
                    o.icon === '🏯' ||
                    o.icon === '🏪' ||
                    (o.name && (o.name.includes('Citadel') || o.name.includes('Castle'))) ||
                    o.templateId?.includes('citadel')
                );

                existingObjects = infrastructure;
                console.log(`🛡️ RELOAD: Preserved ${infrastructure.length} infrastructure objects. Removed monsters.`);
            }

            // If the old snap had zones, preserve them (IN BOTH MODES)
            if (existingSnap.zones) {
                try {
                    zonesGeoJson = (typeof existingSnap.zones === 'string') ? JSON.parse(existingSnap.zones) : existingSnap.zones;
                    logConsole(`📋 Preserved ${zonesGeoJson.features.length} zones from existing template.`);
                } catch (e) { console.error("Zone parse error:", e); }
            }
        }
    }

    // 1. Pre-detect Citadels to handle balanced distribution
    const citadels = existingObjects.filter(o =>
        o.icon === '🏯' ||
        (o.name && o.name.includes('Citadel')) ||
        o.templateId?.includes('citadel')
    ).map((c, idx) => ({
        ...c,
        // Ensure every citadel has a unique ID for Voronoi purposes
        id: c.id || c.name || `citadel_${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`
    }));

    // 2. Zone Calculation
    if (citadels.length >= 2 && !zonesGeoJson) {
        logConsole(`📍 Citadels detected. Calculating distribution zones...`);
        try {
            zonesGeoJson = await generateCityTerritory(cityKey, citadels, null);
            logConsole(`✅ ${zonesGeoJson.features.length} zones found for distribution.`);
        } catch (err) {
            logConsole(`⚠️ Zone Calculation Failed: ${err.message}`);
        }
    } else if (citadels.length < 2 && !zonesGeoJson) {
        // Warning for missing zones
        const proceed = confirm("ATTENTION! For the algorithm to work correctly, you must first generate Citadels in the Castles tab!\n\nWould you like to proceed with standard (random) generation without zone-balancing?");
        if (!proceed) return;
    }

    // 2. Generate Points
    let generatedMonsters = [];

    if (zonesGeoJson && zonesGeoJson.features.length > 0) {
        // BALANCED DISTRIBUTION MODE
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

        logConsole(`⚖️ Distributing ${capacity} monsters across ${totalLogicalZones} logical zones...`);

        // Fetch OSM data ONCE if needed
        let allOsmData = [];
        if (useOSM) {
            logConsole(`🌍 Fetching OSM data for the entire city (10km radius)...`);
            const selTemps = Array.from(selectedTemplates).map(id => templates.find(t => t.id === id)).filter(Boolean);
            try {
                allOsmData = await generateMonstersFromOSM(
                    { lat: cityAnchor.lat, lng: cityAnchor.lng },
                    10000,
                    selTemps,
                    { timeOfDay: 'day' }
                );
            } catch (err) {
                logConsole(`⚠️ OSM Fetch Failed (${err.message}). Switching to Random placement.`);
                allOsmData = [];
            }
        }

        if (!window.turf) {
            logConsole(`⏳ Loading Turf.js for spatial calculations...`);
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
                script.onload = resolve;
                script.onerror = () => reject(new Error("Failed to load Turf.js"));
                document.head.appendChild(script);
            });
        }

        const turf = window.turf;
        const selectionList = Array.from(selectedTemplates).map(id => templates.find(t => t.id === id)).filter(Boolean);
        const totalWeight = selectionList.reduce((sum, t) => sum + (t.weight || 0), 0);

        uniqueZoneIds.forEach((citadelId, idx) => {
            const zoneFeatures = zonesById[citadelId];
            const zoneTarget = targetPerZone + (idx < remainder ? 1 : 0);
            const zoneMonsters = [];

            if (useOSM && allOsmData.length > 0) {
                // Filter OSM points inside any of the zone's features
                const internalOsm = allOsmData.filter(pt =>
                    zoneFeatures.some(f => turf.booleanPointInPolygon([pt.lng, pt.lat], f))
                );

                if (internalOsm.length >= zoneTarget) {
                    const selected = internalOsm.sort(() => Math.random() - 0.5).slice(0, zoneTarget);
                    zoneMonsters.push(...selected);
                } else {
                    zoneMonsters.push(...internalOsm);
                    const needed = zoneTarget - internalOsm.length;
                    const pointsPerFeature = Math.ceil(needed / zoneFeatures.length);
                    for (const f of zoneFeatures) {
                        let featureNeeded = Math.min(pointsPerFeature, zoneTarget - zoneMonsters.length);
                        for (let n = 0; n < featureNeeded; n++) {
                            const rndPt = generateRandomPointInPolygon(f);
                            if (rndPt) {
                                const template = pickTemplateByWeight(selectionList, totalWeight);
                                zoneMonsters.push({
                                    ...template,
                                    lat: rndPt.lat,
                                    lng: rndPt.lng,
                                    cityId: cityKey
                                });
                            }
                        }
                    }
                }
            } else {
                // PURE RANDOM IN ZONE
                const pointsPerFeature = Math.ceil(zoneTarget / zoneFeatures.length);
                for (const f of zoneFeatures) {
                    let featureNeeded = Math.min(pointsPerFeature, zoneTarget - zoneMonsters.length);
                    for (let n = 0; n < featureNeeded; n++) {
                        const rndPt = generateRandomPointInPolygon(f);
                        if (rndPt) {
                            const template = pickTemplateByWeight(selectionList, totalWeight);
                            zoneMonsters.push({
                                ...template,
                                lat: rndPt.lat,
                                lng: rndPt.lng,
                                cityId: cityKey
                            });
                        }
                    }
                }
            }

            // Tag monsters
            zoneMonsters.forEach(m => {
                m.cityId = cityKey;
                m.type = 'monster';
                m.zoneId = citadelId;
            });

            logConsole(`📍 Zone <b>${citadelId.split('_').pop()}</b>: ${zoneMonsters.length} monsters`);
            generatedMonsters.push(...zoneMonsters);
        });
        logConsole(`✅ DISTRIBUTION COMPLETE: Total ${generatedMonsters.length} monsters balanced.`);

    } else {
        // LEGACY / NO ZONES MODE - Improved with Grid-Based Balancing
        logConsole(`🎲 No Citadels found. Using Grid-Based balancing for city coverage...`);

        // Divide city area into a 5x5 grid (25 mini-zones) for uniform sampling even without Citadels
        const gridZones = 5;
        const latStep = 0.1 / gridZones; // Approx 10km span
        const lngStep = 0.1 / gridZones;
        const targetPerCell = Math.floor(capacity / (gridZones * gridZones));
        const remainder = capacity % (gridZones * gridZones);
        let cellIdx = 0;

        for (let y = 0; y < gridZones; y++) {
            for (let x = 0; x < gridZones; x++) {
                const cellTarget = targetPerCell + (cellIdx < remainder ? 1 : 0);
                const cellLat = cityAnchor.lat - 0.05 + (y * latStep);
                const cellLng = cityAnchor.lng - 0.05 + (x * lngStep);

                // Create a virtual bbox for this cell
                const cellBbox = [cellLng, cellLat, cellLng + lngStep, cellLat + latStep];
                const cellPoly = turf.bboxPolygon(cellBbox);

                for (let n = 0; n < cellTarget; n++) {
                    const rndPt = generateRandomPointInPolygon(cellPoly);
                    if (rndPt) {
                        const template = pickTemplateByWeight(Array.from(selectedTemplates).map(id => templates.find(t => t.id === id)).filter(Boolean), totalWeight);
                        generatedMonsters.push({
                            ...template,
                            lat: rndPt.lat,
                            lng: rndPt.lng,
                            cityId: cityKey,
                            zoneId: `grid_${y}_${x}`
                        });
                    }
                }
                cellIdx++;
            }
        }
        logConsole(`✅ GRID DISTRIBUTION COMPLETE: ${generatedMonsters.length} monsters.`);
    }

    if (generatedMonsters.length === 0) {
        logConsole('⚠️ No monsters generated.');
        return;
    }

    // 3. Save Snapshot
    const mergedObjects = [...existingObjects, ...generatedMonsters];
    logConsole(`💾 Saving Template "${snapName}" (${mergedObjects.length} objects)...`);
    // Determine actual type based on content to prevent accidental full-world wipes
    const hasMonsters = mergedObjects.some(o => o.type === 'monster');
    const hasInfrastructure = mergedObjects.some(o => o.type === 'shop' || o.type === 'castle');
    const finalType = (hasMonsters && hasInfrastructure) ? 'mixed' : (hasMonsters ? 'monster' : 'infrastructure');

    const snapshotData = {
        id: finalId,
        name: snapName,
        cityId: cityKey,
        type: finalType,
        objects: mergedObjects
    };

    if (zonesGeoJson) {
        snapshotData.zones = JSON.stringify(zonesGeoJson);
    }

    // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
    snapshotData.objects = mergedObjects.map(o => {
        // We only need the core data, the rest can be reconstructed from templates or logic
        const { createdBy, createdAt, ...core } = o;
        return core;
    });

    logConsole(`💾 Optimizing ${snapshotData.objects.length} objects for storage...`);
    const success = await saveWorldSnapshot(snapshotData);

    if (success) {
        logConsole('✅ Template Saved!');

        // 4. Update Live Game Zones (Sync)
        if (zonesGeoJson) {
            try {
                const { saveCityZones } = await import('../firebase/firebase-service.js');
                await saveCityZones(cityKey, zonesGeoJson);
                logConsole(`✅ Live Zones synchronized for ${cityKey.toUpperCase()}.`);
            } catch (saveErr) {
                logConsole(`⚠️ Failed to sync live zones: ${saveErr.message}`);
            }
        }

        alert('Template saved successfully and territories synchronized!');
        await loadWorldSnapshots(); // Refresh list
    }
};

window.clearMapData = async () => {
    // Deprecated for this view, but kept for legacy cleanup
    alert("To clear map, use the Map tab controls.");
};

// ==================== GEO GRID ALGORITHM ====================

function generateGeoGrid(city, limit) {
    const monsters = [];
    const selectionList = Array.from(selectedTemplates).map(id => templates.find(t => t.id === id)).filter(Boolean);

    // Normalize weights if not 100%
    const totalWeight = selectionList.reduce((sum, t) => sum + (t.weight || 0), 0);

    // Generate grid
    // Logic adapted from monsters.js but dynamic
    const radiusDeg = city.id === 'berlin' ? 0.3 : 0.1; // Rough approximation
    const step = (radiusDeg * 2) / Math.sqrt(limit); // Calculate step size to fit limit roughly

    let lat = city.lat - radiusDeg;
    const latEnd = city.lat + radiusDeg;

    let count = 0;

    // We strive to hit the limit exactly-ish
    while (monsters.length < limit && lat < latEnd) {
        let lng = city.lng - radiusDeg; // simplistic box
        const lngEnd = city.lng + radiusDeg;

        while (lng < lngEnd) {
            // Jitter
            const jLat = lat + (Math.random() - 0.5) * step * 0.8;
            const jLng = lng + (Math.random() - 0.5) * step * 0.8;

            // Pick Template
            const rnd = Math.random() * totalWeight;
            let cur = 0;
            let selected = selectionList[0];

            for (const t of selectionList) {
                cur += t.weight;
                if (rnd <= cur) {
                    selected = t;
                    break;
                }
            }

            // Create Instance
            monsters.push({
                type: 'monster',
                cityId: city.id,
                lat: jLat,
                lng: jLng,
                templateId: selected.id,
                name: selected.name,
                icon: selected.icon,
                hp: selected.maxHp || selected.hp || 100,
                maxHp: selected.maxHp || selected.hp || 100,
                damage: selected.damage || 10,
                defense: selected.defense || 0,
                xpReward: selected.xpReward || 50,
                loot: selected.loot || [],
                level: selected.level || 1, // Add level scaling later
                respawnAt: null
            });

            count++;
            if (count >= limit) break;
            lng += step;
        }
        lat += step;
    }

    return monsters;
}


// ==================== BALANCED HELPERS ====================

function generateRandomPointInPolygon(feature) {
    const turf = window.turf;
    const bbox = turf.bbox(feature);
    const [minLng, minLat, maxLng, maxLat] = bbox;

    // Protection against infinite loops in weird geometries
    for (let attempt = 0; attempt < 500; attempt++) {
        const lng = minLng + Math.random() * (maxLng - minLng);
        const lat = minLat + Math.random() * (maxLat - minLat);

        if (turf.booleanPointInPolygon([lng, lat], feature)) {
            return { lat, lng };
        }
    }
    return null; // Fallback
}

function pickTemplateByWeight(list, totalWeight) {
    const rnd = Math.random() * totalWeight;
    let cur = 0;
    for (const t of list) {
        cur += (t.weight || 0);
        if (rnd <= cur) {
            return {
                type: 'monster',
                templateId: t.id,
                name: t.name,
                icon: t.icon,
                hp: t.maxHp || t.hp || 100,
                maxHp: t.maxHp || t.hp || 100,
                damage: t.damage || 10,
                defense: t.defense || 0,
                xpReward: t.xpReward || 50,
                loot: t.loot || [],
                level: t.level || 1,
                respawnAt: null
            };
        }
    }
    return null;
}

// Utility
function logConsole(msg) {
    const con = document.getElementById('console-log');
    if (!con) return;
    const div = document.createElement('div');
    div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    con.prepend(div);
}
