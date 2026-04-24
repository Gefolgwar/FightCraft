import { requireAdmin } from './admin-core.js';
import { BulkActions } from './template-bulk-actions.js';
import { getTemplates, saveTemplate, deleteTemplate, saveWorldSnapshot, getWorldSnapshots, getSnapshotById, isAdmin, getCurrentUser, initFirebase } from '../firebase/firebase-service.js';
import { CITY_ANCHORS } from '../gameplay/data.js';
import { generateCityTerritory } from '../map/territory-service.js';
import { saveCityZones } from '../firebase/firebase-service.js';
import { OverpassService } from '../map/overpass-service.js';
import { generateCitadelsAndZones } from './admin-citadel-generator.js';

let templates = [];
let currentEditId = null;
let activeRules = new Map(); // Stores Template ID -> Weight (0-100)
let generatedCount = new Map(); // Stores Template ID -> Count of spawned entities

// Init
document.addEventListener('DOMContentLoaded', async () => {
    await requireAdmin(async () => {
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
    }, { colorClass: 'text-orange-400' });
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

const bulk = new BulkActions(deleteTemplate, loadTemplates);

window.renderTemplateList = function () {
    const list = document.getElementById('template-list');
    if (!list) return;

    const search = document.getElementById('template-search')?.value.toLowerCase() || "";
    list.innerHTML = '';

    // Filter to only citadel-type templates
    const visible = templates.filter(t => {
        const isMatch = t.name.toLowerCase().includes(search) || t.osmTag?.toLowerCase().includes(search);
        const isCitadel = t.name.includes("Citadel") || t.name.includes("Fortress") || t.icon === "🏯";
        return isMatch && isCitadel;
    });

    bulk.injectSelectAllHeader(list, visible.map(t => t.id));

    visible.forEach(t => {
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
            // Re-run strictly
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

function logConsole(msg) {
    const con = document.getElementById('console-log');
    if (!con) return;
    const div = document.createElement('div');
    div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    con.prepend(div);
}
