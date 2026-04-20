import { getTemplates, saveTemplate, deleteTemplate, clearLocationObjects, saveGeneratedObjects, saveWorldSnapshot, getWorldSnapshots, getSnapshotById, isAdmin, getCurrentUser, initFirebase } from '../firebase/firebase-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';
import { generateCityTerritory } from '../map/territory-service.js';

let templates = [];
let currentEditId = null;
let scannedVaultsBuffer = [];
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
            document.getElementById('admin-status').innerHTML = `<span class="text-green-400">● Online (${user.email})</span>`;
        }
        await loadTemplates();
        // restoreState();
        renderMappingRules();
        renderTemplateList();

        // Add capacity change listener to update counts
        const capacityInput = document.getElementById('gen-capacity');
        if (capacityInput) {
            capacityInput.addEventListener('input', () => {
                renderMappingRules();
            });
        }

        // Delay snapshot loading slightly
        setTimeout(() => {
            if (window.loadWorldSnapshots) window.loadWorldSnapshots();
        }, 1200);
    }
});

// ==================== TEMPLATE MANAGEMENT ====================

// ... (loadTemplates, renderTemplateList, renderMappingRules stay mostly same) ...

async function loadTemplates() {
    const list = document.getElementById('template-list');
    list.innerHTML = '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

    templates = await getTemplates('vault');

    // Ensure default templates if none
    if (templates.length === 0) {
        await createDefaultVaultTemplates();
        templates = await getTemplates('vault');
    }

    renderTemplateList();
    renderMappingRules();
}

window.createDefaultVaultTemplates = async function () {
    const defaults = [
        {
            name: "Vault",
            icon: "📦",
            osmTag: "amenity=post_box",
            type: "vault",
            slots: 20
        }
    ];

    for (const t of defaults) {
        await saveTemplate(t);
    }
    logConsole("📦 Created default Vault template.");

    // Setup active rules (but don't start generation)
    templates = await getTemplates('vault');
    activeRules.clear();

    // Activate Vault template with 100% weight
    templates.forEach(t => {
        if (t.name === "Vault") {
            activeRules.set(t.id, 100);
        }
    });

    renderMappingRules();
    renderTemplateList();

    logConsole("✅ Ready to scan. Use buttons to generate.");
}

// ... (renderTemplateList, renderMappingRules, window functions for modal stay same) ...

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

        // Show ALL templates here, but maybe group them? Or just all.
        // User wants: "when I generate shops into a template that has monsters... they appear together"
        // So we need to allow picking ANY template (monster or shop or mixed)
        // Just filter by city maybe? Or show all. Let's show all for flexibility but maybe indicate type.

        snaps.forEach(snap => {
            const option = document.createElement('option');
            const display = snap.name ? snap.name : `${snap.id.substr(0, 10)}...`;
            const typeIcon = snap.type === 'vault' ? '📦' : (snap.type === 'shop' ? '🏪' : (snap.type === 'monster' ? '👾' : '🌍'));

            option.value = snap.id;
            // Show existing object count to hint at mixing
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


// ... (saveState, restoreState, Overpass Scanner logic) ...

window.saveScannedShops = async () => {
    if (scannedShopsBuffer.length === 0) return;

    const cityId = scannedShopsBuffer[0].cityId;
    const targetTemplateId = document.getElementById('gen-template').value;

    let snapName = "";
    let finalId = null;
    let existingObjects = [];

    // Prepare Template ID/Name
    if (targetTemplateId === 'new') {
        snapName = prompt("Enter a name for this new Map Template:", `${cityId}_shops_${new Date().toLocaleDateString()}`);
        if (!snapName) return;
    } else {
        const selector = document.getElementById('gen-template');
        snapName = selector.options[selector.selectedIndex].text.split(' (')[0].substring(3); // Remove icon
        finalId = targetTemplateId;

        // If merging, we need to fetch existing objects!
        // Wait, saveWorldSnapshot OVERWRITES objects array? 
        // Yes, so we need to GET the snapshot first, MERGE objects, then SAVE.

        const existingSnap = await getSnapshotById(finalId);
        if (existingSnap && existingSnap.objects) {
            existingObjects = existingSnap.objects;
            // Filter out any OLD shops if we want to "replace shops" but keep monsters?
            // User said: "generate shops in template that has monsters... they appear together"
            // Usually this implies KEEPING the others.
            // Implies: We should NOT clear non-shop objects.
            // But we MIGHT want to clear old shops from that template to avoid duplicates?
            // Let's assume we simply APPEND for now, or filter only shops if users want to 'regenerate shops'.
            // Strategy: Remove 'shop' type objects from existing, keep 'monster', add new shops.

            if (confirm(`Template has ${existingObjects.length} objects. Keep existing non-shop objects (e.g. monsters)?`)) {
                existingObjects = existingObjects.filter(o => o.type !== 'shop');
            } else {
                existingObjects = []; // Overwrite all
            }
        }
    }

    const mergedObjects = [...existingObjects, ...scannedShopsBuffer];

    // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
    const optimizedObjects = mergedObjects.map(o => {
        const { createdBy, createdAt, ...core } = o;
        return core;
    });

    // Save Snapshot
    logConsole(`💾 Saving Template "${snapName}" (${optimizedObjects.length} objects)...`);

    const success = await saveWorldSnapshot({
        id: finalId, // Null if new
        name: snapName,
        cityId: cityId,
        type: (mergedObjects.some(o => o.type === 'monster' || o.type === 'castle')) ? 'mixed' : 'shop',
        objects: optimizedObjects
    });

    if (success) {
        logConsole(`✅ Template Saved! Go to "Map" tab to view.`);
        scannedShopsBuffer = [];
        document.getElementById('btn-save-shops').disabled = true;
        await window.loadWorldSnapshots();
    }
};

// ... (logConsole stays same) ...

function renderTemplateList() {
    const list = document.getElementById('template-list');
    list.innerHTML = '';

    templates.forEach(t => {
        const el = document.createElement('div');
        // Add visual cue if active
        const isActive = activeRules.has(t.id);
        const activeClass = isActive ? 'border-blue-500 bg-blue-900/20' : 'border-gray-700 hover:border-blue-500';

        el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;

        el.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-xl">${t.icon || '🏪'}</span>
                <div>
                    <div class="font-bold text-sm text-gray-300">${t.name}</div>
                    <div class="text-[10px] text-gray-400">Match: ${t.osmTag || 'N/A'}</div>
                </div>
            </div>
            <div class="opacity-0 group-hover:opacity-100 flex gap-2">
                <button class="text-xs text-green-400 hover:text-white" onclick="event.stopPropagation(); window.copyTemplate('${t.id}')" title="Copy Template">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="text-xs text-blue-400" onclick="event.stopPropagation(); window.editTemplate('${t.id}')">
                    <i class="fas fa-edit"></i>
                </button>
            </div>
        `;

        // Click to toggle rule
        el.addEventListener('click', (e) => {
            // Avoid triggering if clicking buttons
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
            activeRules.set(id, 100); // Default to 100%
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
    if (weight < 0) weight = 0;
    if (weight > 100) weight = 100;

    if (activeRules.has(id)) {
        activeRules.set(id, weight);
    }
};

function renderMappingRules() {
    // Dropdown removed

    // Populate Table
    const tbody = document.getElementById('rules-table');
    const emptyMsg = document.getElementById('rules-empty');
    if (tbody) {
        tbody.innerHTML = '';
        if (activeRules.size === 0) {
            if (emptyMsg) emptyMsg.classList.remove('hidden');
            // Reset totals
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

            // Calculate total weight first
            activeRules.forEach((weight) => {
                totalWeight += weight;
            });

            // Iterate Map values
            activeRules.forEach((weight, id) => {
                const t = templates.find(temp => temp.id === id);
                if (!t) return;

                // Calculate estimated count based on weight distribution
                const estimatedCount = totalWeight > 0 ? Math.round(totalCap * (weight / totalWeight)) : 0;

                const tr = document.createElement('tr');
                tr.className = 'border-b border-gray-800 hover:bg-gray-800/50';

                tr.innerHTML = `
                    <td class="px-4 py-2 flex items-center gap-2 max-w-[150px] truncate">
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
                    <td class="px-4 py-2 text-center max-w-[200px]">
                         <span class="bg-gray-800 text-blue-400 px-2 py-1 rounded text-[10px] font-mono border border-gray-600 break-words block">${t.osmTag}</span>
                    </td>
                    <td class="px-4 py-2 text-right">
                        <button onclick="removeMappingRule('${t.id}')" class="text-red-500 hover:text-white"><i class="fas fa-times"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Update Footer Total
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

window.addMappingRule = () => {
    const selector = document.getElementById('rule-select');
    const id = selector.value;
    if (!id) return;

    activeRules.add(id);
    renderMappingRules();
};

window.removeMappingRule = (id) => {
    activeRules.delete(id);
    renderMappingRules();
};

window.openTemplateModal = () => {
    currentEditId = null;
    document.getElementById('tpl-id').value = '';
    document.getElementById('btn-delete').classList.add('hidden');

    ['name', 'icon', 'osm', 'inventory'].forEach(id => document.getElementById(`tpl-${id}`).value = '');
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
    document.getElementById('tpl-inventory').value = JSON.stringify(t.inventory || [], null, 2);

    document.getElementById('template-modal').classList.remove('hidden');
};

window.copyTemplate = async (id) => {
    const t = templates.find(t => t.id === id);
    if (!t) return;

    const copyName = prompt(`Copy Template "${t.name}"\n\nEnter new name:`, `${t.name} (Copy)`);
    if (!copyName) return; // User cancelled

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
    try {
        const inv = JSON.parse(document.getElementById('tpl-inventory').value || '[]');
        const template = {
            name: document.getElementById('tpl-name').value,
            icon: document.getElementById('tpl-icon').value,
            osmTag: document.getElementById('tpl-osm').value,
            inventory: inv,
            type: 'vault'
        };

        if (currentEditId) template.id = currentEditId;

        const success = await saveTemplate(template);
        if (success) {
            closeTemplateModal();
            loadTemplates();
        }
    } catch (e) {
        alert('Invalid JSON in Inventory field');
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
        const saved = localStorage.getItem('admin_shops_state');
        if (!saved) return;

        const state = JSON.parse(saved);

        if (state.consoleLog) {
            document.getElementById('console-log').innerHTML = state.consoleLog;
        }
        if (state.city) document.getElementById('gen-city').value = state.city;
        // Support both old 'radius' and new 'capacity' for backwards compatibility
        const capacityValue = state.capacity || state.radius || '1000';
        if (document.getElementById('gen-capacity')) {
            document.getElementById('gen-capacity').value = capacityValue;
        }
        if (state.activeRules) {
            // Check format (old was Array of IDs, new is Array of Entries)
            if (Array.isArray(state.activeRules) && state.activeRules.length > 0 && Array.isArray(state.activeRules[0])) {
                activeRules = new Map(state.activeRules);
            } else if (Array.isArray(state.activeRules)) {
                // Migrate old format (Set-like array)
                activeRules = new Map();
                state.activeRules.forEach(id => activeRules.set(id, 100)); // Default weight
            }
        }

    } catch (e) {
        console.error('Failed to restore state:', e);
    }
}

// ==================== OVERPASS SCANNER ====================

// ==================== GENERATION LOGIC ====================

window.startGeneration = async (overwrite = true) => {
    const cityKey = document.getElementById('gen-city').value;
    const capacity = parseInt(document.getElementById('gen-capacity')?.value) || 1000;
    const city = CITY_ANCHORS.find(c => c.id === cityKey);

    if (!city) return logConsole('❌ Invalid city selected.');

    // Mode Logging
    logConsole(overwrite ? "🗑️ Mode: Create / Delete + Create (Replenish Vaults)" : "➕ Mode: Add if exist");

    // 1. Initial State & Preservation
    let existingObjects = [];
    let zonesGeoJson = null;
    const { getSnapshotById } = await import('../firebase/firebase-service.js');

    // Prepare Template ID/Name first
    const targetTemplateId = document.getElementById('gen-template').value;
    let snapName = "";
    let finalId = null;

    // Reset Counts
    generatedCount.clear();
    renderMappingRules();

    if (targetTemplateId === 'new') {
        if (window.autoTargetSnapName) {
            snapName = window.autoTargetSnapName;
            window.autoTargetSnapName = null;
        } else {
            snapName = prompt("Enter a name for this new Map Template:", `${cityKey}_vaults_${new Date().toLocaleDateString()}`);
            if (!snapName) return;
        }
    } else {
        const selector = document.getElementById('gen-template');
        snapName = selector.options[selector.selectedIndex].text.split(' (')[0].replace(/^..?\s*/, "").trim();
        finalId = targetTemplateId;

        // Fetch existing
        const existingSnap = await getSnapshotById(finalId);
        if (existingSnap && existingSnap.objects) {
            const allSavedObjects = existingSnap.objects;

            if (!overwrite) {
                // MERGE: Add new shops to existing list
                console.log("Merging: Keeping all existing objects.");
                existingObjects = allSavedObjects;
            } else {
                // Selective Clear: Keep non-vault items
                console.log("Reloading: Filtering out only vaults.");
                existingObjects = allSavedObjects.filter(o =>
                    o.type !== 'vault' &&
                    o.icon !== '📦'
                );
            }

            // Preserve existing zones if they exist (IN BOTH MODES)
            if (existingSnap.zones) {
                try {
                    zonesGeoJson = (typeof existingSnap.zones === 'string') ? JSON.parse(existingSnap.zones) : existingSnap.zones;
                    logConsole(`📋 Preserved ${zonesGeoJson.features.length} zones from existing template.`);
                } catch (e) { console.error("Zone parse error:", e); }
            }
        }
    }

    // 2. Citadel & Zone Detection
    const citadels = existingObjects.filter(o =>
        o.icon === '🏯' ||
        (o.name && o.name.includes('Citadel')) ||
        o.templateId?.includes('citadel')
    ).map((c, idx) => ({
        ...c,
        id: c.id || c.name || `citadel_${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`
    }));

    if (citadels.length >= 2 && !zonesGeoJson) {
        logConsole(`📍 Citadels detected. Calculating distribution zones...`);
        try {
            const { generateCityTerritory } = await import('../map/territory-service.js');
            zonesGeoJson = await generateCityTerritory(cityKey, citadels, null);
            logConsole(`✅ ${zonesGeoJson.features.length} zones found for distribution.`);
        } catch (err) {
            logConsole(`⚠️ Zone Calculation Failed: ${err.message}`);
        }
    }

    logConsole(`📡 Connecting to Overpass API for ${city.name} (searching 10km area, targeting ${capacity} vaults)...`);

    // Dynamic Query based on Active Rules
    let queryFilters = "";
    activeRules.forEach((weight, id) => {
        if (weight <= 0) return;
        const t = templates.find(temp => temp.id === id);
        if (!t || !t.osmTag) return;

        const tagSets = t.osmTag.split(';');

        tagSets.forEach(tagSet => {
            const trimmed = tagSet.trim();
            if (!trimmed) return;

            const isRegex = trimmed.includes('~');
            const parts = trimmed.split(/[=~]/);
            const key = parts[0].trim();
            const val = parts[1] ? parts[1].trim() : '';

            const op = isRegex ? '~' : '=';
            const tagPart = (val && val !== '*') ? `["${key}"${op}"${val}"]` : `["${key}"]`;

            queryFilters += `nwr${tagPart}(around:10000,${city.lat},${city.lng});\n`;
        });
    });

    if (!queryFilters) {
        logConsole('⚠️ No active rules with valid tags.');
        return;
    }

    let processedShops = [];
    try {
        const query = `
            [out:json][timeout:90];
            (
            ${queryFilters}
            );
            out center;
        `;

        let response;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
            response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: "data=" + encodeURIComponent(query)
            });

            if (response.status === 429) {
                retries++;
                const delay = retries * 3000;
                logConsole(`⏳ Rate limit (429). Retrying in ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            break;
        }

        if (!response.ok) {
            throw new Error(`Overpass API Error: ${response.status}`);
        }

        const data = await response.json();
        const nodes = data.elements;
        logConsole(`✅ Received ${nodes.length} raw POIs from OSM.`);

        // Process nodes to match templates
        processedShops = processNodesInternal(nodes, cityKey);
    } catch (err) {
        logConsole(`⚠️ Overpass Failed (${err.message}). Switching to Random Mode.`);
        processedShops = [];
    }

    try {
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
        const generatedShops = [];
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

            logConsole(`⚖️ Distributing ${capacity} vaults across ${totalLogicalZones} logical zones...`);

            uniqueZoneIds.forEach((citadelId, idx) => {
                const zoneFeatures = zonesById[citadelId];
                const zoneTarget = targetPerZone + (idx < remainder ? 1 : 0);
                let zoneCount = 0;

                // 1. Try to pull from OSM data first
                const internalOsm = processedShops.filter(pt =>
                    zoneFeatures.some(f => turf.booleanPointInPolygon([pt.lng, pt.lat], f))
                );

                if (internalOsm.length > 0) {
                    const take = Math.min(internalOsm.length, zoneTarget);
                    const selected = internalOsm.sort(() => Math.random() - 0.5).slice(0, take);
                    generatedShops.push(...selected.map(s => ({ ...s, zoneId: citadelId })));
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
                                const template = pickShopTemplateByWeight(selectionList, totalWeight);
                                generatedShops.push({
                                    ...template,
                                    lat: rndPt.lat,
                                    lng: rndPt.lng,
                                    cityId: cityKey,
                                    zoneId: citadelId
                                });
                                zoneCount++;
                            }
                        }
                    }
                }
            });
        } else {
            // GRID-BASED BALANCED DISTRIBUTION (If no Citadels)
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
                    const internalOsm = processedShops.filter(pt =>
                        turf.booleanPointInPolygon([pt.lng, pt.lat], cellPoly)
                    );

                    if (internalOsm.length >= cellTarget) {
                        generatedShops.push(...internalOsm.sort(() => Math.random() - 0.5).slice(0, cellTarget));
                    } else {
                        generatedShops.push(...internalOsm);
                        const needed = cellTarget - internalOsm.length;
                        for (let n = 0; n < needed; n++) {
                            const rndPt = generateRandomPointInPolygon(cellPoly);
                            if (rndPt) {
                                const template = pickShopTemplateByWeight(selectionList, totalWeight);
                                generatedShops.push({
                                    ...template,
                                    lat: rndPt.lat,
                                    lng: rndPt.lng,
                                    cityId: cityKey,
                                    zoneId: `grid_${y}_${x}`
                                });
                            }
                        }
                    }
                    cellIdx++;
                }
            }
        }

        // 1. Merge and Optimize
        const mergedObjects = [...existingObjects, ...generatedShops];

        // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
        const optimizedObjects = mergedObjects.map(o => {
            const { createdBy, createdAt, ...core } = o;
            return core;
        });

        // 3. Save Snapshot
        logConsole(`💾 Saving Template "${snapName}" (${optimizedObjects.length} objects)...`);
        const snapshotData = {
            id: finalId, // Null if new
            name: snapName,
            cityId: cityKey,
            type: (mergedObjects.some(o => o.type && o.type !== 'vault')) ? 'mixed' : 'vault',
            objects: optimizedObjects
        };

        if (zonesGeoJson) {
            snapshotData.zones = JSON.stringify(zonesGeoJson);
            logConsole(`📦 Attached ${snapshotData.zones.length} chars of zone data.`);
        }

        const success = await saveWorldSnapshot(snapshotData);

        if (success) {
            logConsole(`✅ Template Saved! Go to "Map" tab to view.`);

            // 3. Update Live Game Zones (Sync)
            if (zonesGeoJson) {
                try {
                    const { saveCityZones } = await import('../firebase/firebase-service.js');
                    await saveCityZones(cityKey, zonesGeoJson);
                    logConsole(`✅ Live Zones synchronized for ${cityKey.toUpperCase()}.`);
                } catch (saveErr) {
                    logConsole(`⚠️ Failed to sync live zones: ${saveErr.message}`);
                }
            }

            await window.loadWorldSnapshots();
        }

    } catch (e) {
        logConsole(`❌ Error: ${e.message}`);
    }
};

function processNodesInternal(nodes, cityId) {
    const results = [];

    nodes.forEach(node => {
        // Handle coordinates for node/way/relation
        const lat = node.lat || (node.center && node.center.lat);
        const lng = node.lon || (node.center && node.center.lon);
        if (!lat || !lng) return;

        let match = null;

        for (const t of templates) {
            if (!activeRules.has(t.id)) continue;
            if (!t.osmTag) continue;

            const tags = node.tags;
            if (!tags) continue;

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
                type: 'vault',
                cityId: cityId,
                lat: lat,
                lng: lng,
                templateId: match.id,
                name: node.tags.name || match.name,
                icon: match.icon,
                vaultType: match.name,
                inventory: match.inventory || [],
                realWorldId: node.id
            });
        }
    });

    renderMappingRules();
    return results;
}

// Deprecated old functions
window.scanOverpass = () => logConsole("Use Generate button.");
window.saveScannedShops = () => { };


// Deprecated old functions continued
window.saveScannedShops = () => { };

function logConsole(msg) {
    const con = document.getElementById('console-log');
    if (!con) return;
    const div = document.createElement('div');
    div.className = "mb-1 border-b border-gray-800/30 pb-1 last:border-0";
    div.innerHTML = `<span class="text-blue-500/70 mr-1">[${new Date().toLocaleTimeString([], { hour12: false })}]</span> ${msg}`;
    con.prepend(div);
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

function pickShopTemplateByWeight(list, totalWeight) {
    const rnd = Math.random() * totalWeight;
    let cur = 0;
    for (const t of list) {
        cur += (t.weight || 0);
        if (rnd <= cur) {
            return {
                type: 'vault',
                templateId: t.id,
                name: t.name,
                icon: t.icon,
                vaultType: t.name,
                inventory: t.inventory || []
            };
        }
    }
    return null;
}
