import { requireAdmin } from "./admin-core.js";
import { BulkActions } from "./template-bulk-actions.js";
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  clearLocationObjects,
  saveGeneratedObjects,
  saveWorldSnapshot,
  getWorldSnapshots,
  getSnapshotById,
  isAdmin,
  getCurrentUser,
  initFirebase,
} from "../firebase/firebase-service.js";
import {
  buildEntityStatistics,
  createManualEntity,
  validateManualEntity,
  getProceduralRulesForType,
} from "../gameplay/entity-control-center.js";
import {
  loadActiveRecipe,
  updateRecipe,
  addTemplateToLayer,
  removeTemplateFromLayer,
  updateTemplateWeight,
} from "../gameplay/snapshot-recipe.js";

let templates = [];
let currentEditId = null;
let scannedShopsBuffer = [];
let activeRules = new Map(); // Stores Template ID -> Weight (0-100)
let generatedCount = new Map(); // Stores Template ID -> Count of spawned entities

// Init
document.addEventListener("DOMContentLoaded", async () => {
  await requireAdmin(async () => {
    await loadTemplates();
    // restoreState();
    renderMappingRules();
    renderTemplateList();

    // Add capacity change listener to update counts
    const capacityInput = document.getElementById("gen-capacity");
    if (capacityInput) {
      capacityInput.addEventListener("input", () => {
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

// ... (loadTemplates, renderTemplateList, renderMappingRules stay mostly same) ...

async function loadTemplates() {
  const list = document.getElementById("template-list");
  list.innerHTML =
    '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

  templates = await getTemplates("shop");

  // Ensure default templates if none
  if (templates.length === 0) {
    await createDefaultShopTemplates();
    templates = await getTemplates("shop");
  }

  renderTemplateList();
  renderMappingRules();
}

window.createDefaultShopTemplates = async function () {
  const defaults = [
    {
      name: "General Store",
      icon: "🏪",
      osmTag: "shop=convenience",
      type: "shop",
      inventory: [{ id: "potion_hp_small", price: 20 }],
    },
    {
      name: "Tavern",
      icon: "🍺",
      osmTag: "amenity=pub",
      type: "shop",
      inventory: [{ id: "beer", price: 5 }],
    },
    {
      name: "Alchemist",
      icon: "⚗️",
      osmTag: "amenity=pharmacy",
      type: "shop",
      inventory: [{ id: "potion_hp_large", price: 100 }],
    },
  ];

  for (const t of defaults) {
    await saveTemplate(t);
  }
  logConsole("Created default shop templates.");

  // Auto-setup for Template 4
  await loadTemplates();
  activeRules.clear();

  // Activate all 3 templates with 100% weight
  templates.forEach((t) => {
    if (["General Store", "Tavern", "Alchemist"].includes(t.name)) {
      activeRules.set(t.id, 100);
    }
  });

  renderMappingRules();
  renderTemplateList();

  logConsole("✅ Ready to scan. Use buttons to generate.");
};

// ... (renderTemplateList, renderMappingRules, window functions for modal stay same) ...

// ==================== SNAPSHOT & MAP TEMPLATES ====================

window.loadWorldSnapshots = async function () {
  const selector = document.getElementById("gen-template");
  if (!selector) return;

  if (!isAdmin()) return;

  const currentVal = selector.value;

  const newOpt = document.createElement("option");
  newOpt.value = "new";
  newOpt.text = "+ Create New Map Template";

  selector.innerHTML = "";
  selector.appendChild(newOpt);

  logConsole("🔄 Loading map templates...");

  try {
    const snaps = await getWorldSnapshots();
    logConsole(`📦 Found ${snaps.length} snapshots total.`);

    // Show ALL templates here, but maybe group them? Or just all.
    // User wants: "when I generate shops into a template that has monsters... they appear together"
    // So we need to allow picking ANY template (monster or shop or mixed)
    // Just filter by city maybe? Or show all. Let's show all for flexibility but maybe indicate type.

    snaps.forEach((snap) => {
      const option = document.createElement("option");
      const display = snap.name ? snap.name : `${snap.id.substr(0, 10)}...`;
      const typeIcon =
        snap.type === "shop" ? "🏪" : snap.type === "monster" ? "👾" : "🌍";

      option.value = snap.id;
      // Show existing object count to hint at mixing
      option.textContent = `${typeIcon} ${display} (${snap.objects?.length || 0} obj)`;
      selector.appendChild(option);
    });

    if (currentVal && currentVal !== "new") {
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
};

// ... (saveState, restoreState, Overpass Scanner logic) ...

window.saveScannedShops = async () => {
  if (scannedShopsBuffer.length === 0) return;

  const cityId = scannedShopsBuffer[0].cityId;
  const targetTemplateId = document.getElementById("gen-template").value;

  let snapName = "";
  let finalId = null;
  let existingObjects = [];

  // Prepare Template ID/Name
  if (targetTemplateId === "new") {
    snapName = prompt(
      "Enter a name for this new Map Template:",
      `${cityId}_shops_${new Date().toLocaleDateString()}`,
    );
    if (!snapName) return;
  } else {
    const selector = document.getElementById("gen-template");
    snapName = selector.options[selector.selectedIndex].text
      .split(" (")[0]
      .substring(3); // Remove icon
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

      if (
        confirm(
          `Template has ${existingObjects.length} objects. Keep existing non-shop objects (e.g. monsters)?`,
        )
      ) {
        existingObjects = existingObjects.filter((o) => o.type !== "shop");
      } else {
        existingObjects = []; // Overwrite all
      }
    }
  }

  const mergedObjects = [...existingObjects, ...scannedShopsBuffer];

  // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
  const optimizedObjects = mergedObjects.map((o) => {
    const { createdBy, createdAt, ...core } = o;
    return core;
  });

  // Save Snapshot
  logConsole(
    `💾 Saving Template "${snapName}" (${optimizedObjects.length} objects)...`,
  );

  const success = await saveWorldSnapshot({
    id: finalId, // Null if new
    name: snapName,
    cityId: cityId,
    type: mergedObjects.some((o) => o.type === "monster" || o.type === "castle")
      ? "mixed"
      : "shop",
    objects: optimizedObjects,
  });

  if (success) {
    logConsole(`✅ Template Saved! Go to "Map" tab to view.`);
    scannedShopsBuffer = [];
    document.getElementById("btn-save-shops").disabled = true;
    await window.loadWorldSnapshots();
  }
};

// ... (logConsole stays same) ...

const bulk = new BulkActions(deleteTemplate, loadTemplates);

function renderTemplateList() {
  const list = document.getElementById("template-list");
  list.innerHTML = "";

  const visible = [...templates];
  bulk.injectSelectAllHeader(
    list,
    visible.map((t) => t.id),
  );

  visible.forEach((t) => {
    const el = document.createElement("div");
    // Add visual cue if active
    const isActive = activeRules.has(t.id);
    const activeClass = isActive
      ? "border-blue-500 bg-blue-900/20"
      : "border-gray-700 hover:border-blue-500";

    el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;

    el.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-xl">${t.icon || "🏪"}</span>
                <div>
                    <div class="font-bold text-sm text-gray-300">${t.name}</div>
                    <div class="text-[10px] text-gray-400">Match: ${t.osmTag || "N/A"}</div>
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
    // Prepend bulk checkbox
    el.querySelector(".flex.items-center.gap-2").prepend(
      bulk.createCheckbox(t.id),
    );

    // Click to toggle rule
    el.addEventListener("click", (e) => {
      // Avoid triggering if clicking buttons or checkboxes
      if (
        !e.target.closest("button") &&
        !e.target.closest("input[type=checkbox]")
      ) {
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
    const t = templates.find((temp) => temp.id === id);
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
  const tbody = document.getElementById("rules-table");
  const emptyMsg = document.getElementById("rules-empty");
  if (tbody) {
    tbody.innerHTML = "";
    if (activeRules.size === 0) {
      if (emptyMsg) emptyMsg.classList.remove("hidden");
      // Reset totals
      const totalEl = document.getElementById("total-count");
      if (totalEl) totalEl.textContent = "0";
      const totalWeightEl = document.getElementById("total-weight");
      if (totalWeightEl) {
        totalWeightEl.textContent = "0%";
        totalWeightEl.className = "px-4 py-2 text-center";
      }
    } else {
      if (emptyMsg) emptyMsg.classList.add("hidden");

      const totalCap =
        parseInt(document.getElementById("gen-capacity")?.value) || 1000;
      let totalWeight = 0;

      // Calculate total weight first
      activeRules.forEach((weight) => {
        totalWeight += weight;
      });

      // Iterate Map values
      activeRules.forEach((weight, id) => {
        const t = templates.find((temp) => temp.id === id);
        if (!t) return;

        // Calculate estimated count based on weight distribution
        const estimatedCount =
          totalWeight > 0 ? Math.round(totalCap * (weight / totalWeight)) : 0;

        const tr = document.createElement("tr");
        tr.className = "border-b border-gray-800 hover:bg-gray-800/50";

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
      const totalEl = document.getElementById("total-count");
      if (totalEl) totalEl.textContent = totalCap;

      const totalWeightEl = document.getElementById("total-weight");
      if (totalWeightEl) {
        totalWeightEl.textContent = `${totalWeight}%`;
        totalWeightEl.className =
          totalWeight === 100
            ? "px-4 py-2 text-center text-green-400"
            : "px-4 py-2 text-center text-yellow-500";
      }
    }
  }

  saveState();
}

window.addMappingRule = () => {
  const selector = document.getElementById("rule-select");
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
  document.getElementById("tpl-id").value = "";
  document.getElementById("btn-delete").classList.add("hidden");

  ["name", "icon", "osm", "inventory"].forEach(
    (id) => (document.getElementById(`tpl-${id}`).value = ""),
  );
  document.getElementById("template-modal").classList.remove("hidden");
};

window.editTemplate = (id) => {
  const t = templates.find((t) => t.id === id);
  if (!t) return;

  currentEditId = id;
  document.getElementById("tpl-id").value = id;
  document.getElementById("btn-delete").classList.remove("hidden");

  document.getElementById("tpl-name").value = t.name;
  document.getElementById("tpl-icon").value = t.icon;
  document.getElementById("tpl-osm").value = t.osmTag || "";
  document.getElementById("tpl-inventory").value = JSON.stringify(
    t.inventory || [],
    null,
    2,
  );

  document.getElementById("template-modal").classList.remove("hidden");
};

window.copyTemplate = async (id) => {
  const t = templates.find((t) => t.id === id);
  if (!t) return;

  const copyName = prompt(
    `Copy Template "${t.name}"\n\nEnter new name:`,
    `${t.name} (Copy)`,
  );
  if (!copyName) return; // User cancelled

  const newTemplate = {
    ...t,
    id: undefined,
    name: copyName,
  };

  delete newTemplate.id;

  const success = await saveTemplate(newTemplate);
  if (success) {
    await loadTemplates();
    logConsole(`✅ Template "${copyName}" created from "${t.name}"`);
  }
};

window.closeTemplateModal = () =>
  document.getElementById("template-modal").classList.add("hidden");

window.saveTemplateForm = async () => {
  try {
    const inv = JSON.parse(
      document.getElementById("tpl-inventory").value || "[]",
    );
    const template = {
      name: document.getElementById("tpl-name").value,
      icon: document.getElementById("tpl-icon").value,
      osmTag: document.getElementById("tpl-osm").value,
      inventory: inv,
      type: "shop",
    };

    if (currentEditId) template.id = currentEditId;

    const success = await saveTemplate(template);
    if (success) {
      closeTemplateModal();
      loadTemplates();
    }
  } catch (e) {
    alert("Invalid JSON in Inventory field");
  }
};

window.deleteTemplate = async () => {
  if (!currentEditId) return;
  if (confirm("Delete this template?")) {
    await deleteTemplate(currentEditId);
    closeTemplateModal();
    loadTemplates();
    logConsole("Template deleted.");
  }
};

// ==================== STATE PERSISTENCE ====================

function saveState() {
  // Disabled persistence as per user request
}

function restoreState() {
  try {
    const saved = localStorage.getItem("admin_shops_state");
    if (!saved) return;

    const state = JSON.parse(saved);

    if (state.consoleLog) {
      document.getElementById("console-log").innerHTML = state.consoleLog;
    }
    // Support both old 'radius' and new 'capacity' for backwards compatibility
    const capacityValue = state.capacity || state.radius || "1000";
    if (document.getElementById("gen-capacity")) {
      document.getElementById("gen-capacity").value = capacityValue;
    }
    if (state.activeRules) {
      // Check format (old was Array of IDs, new is Array of Entries)
      if (
        Array.isArray(state.activeRules) &&
        state.activeRules.length > 0 &&
        Array.isArray(state.activeRules[0])
      ) {
        activeRules = new Map(state.activeRules);
      } else if (Array.isArray(state.activeRules)) {
        // Migrate old format (Set-like array)
        activeRules = new Map();
        state.activeRules.forEach((id) => activeRules.set(id, 100)); // Default weight
      }
    }
  } catch (e) {
    console.error("Failed to restore state:", e);
  }
}

// ==================== OVERPASS SCANNER ====================

// ==================== GENERATION LOGIC ====================

window.startGeneration = async (overwrite = true) => {
  const capacity =
    parseInt(document.getElementById("gen-capacity")?.value) || 1000;

  // Mode Logging
  logConsole(
    overwrite
      ? "🗑️ Mode: Create / Delete + Create (Replenish Shops)"
      : "➕ Mode: Add if exist",
  );

  // 1. Initial State & Preservation
  let existingObjects = [];
  let zonesGeoJson = null;
  const { getSnapshotById } = await import("../firebase/firebase-service.js");

  // Prepare Template ID/Name first
  const targetTemplateId = document.getElementById("gen-template").value;
  let snapName = "";
  let finalId = null;

  // Reset Counts
  generatedCount.clear();
  renderMappingRules();

  if (targetTemplateId === "new") {
    if (window.autoTargetSnapName) {
      snapName = window.autoTargetSnapName;
      window.autoTargetSnapName = null;
    } else {
      snapName = prompt(
        "Enter a name for this new Map Template:",
        `shops_${new Date().toLocaleDateString()}`,
      );
      if (!snapName) return;
    }
  } else {
    const selector = document.getElementById("gen-template");
    snapName = selector.options[selector.selectedIndex].text
      .split(" (")[0]
      .replace(/^..?\s*/, "")
      .trim();
    finalId = targetTemplateId;

    // Fetch existing
    const existingSnap = await getSnapshotById(finalId);
    let allSavedObjects = [];
    if (existingSnap) {
      if (existingSnap.chunked && !existingSnap.objects) {
        const { loadSnapshotChunks } =
          await import("../firebase/firebase-service.js");
        const chunks = await loadSnapshotChunks(finalId);
        allSavedObjects = chunks.flatMap((c) => c.objects || []);
      } else {
        allSavedObjects = existingSnap.objects || [];
      }

      if (!overwrite) {
        // MERGE: Add new shops to existing list
        console.log("Merging: Keeping all existing objects.");
        existingObjects = allSavedObjects;
      } else {
        // Selective Clear: Keep non-shop items
        console.log("Reloading: Filtering out only shops.");
        existingObjects = allSavedObjects.filter(
          (o) => o.type !== "shop" && o.icon !== "🏪",
        );
      }

      // Load zones from chunks (new format)
      if (existingSnap.zoneConfig && existingSnap.zoneConfig.generated) {
        try {
          const { loadZoneChunks } =
            await import("../firebase/snapshot-service.js");
          zonesGeoJson = await loadZoneChunks(
            finalId,
            existingSnap.zoneConfig.chunkCount,
          );
          if (zonesGeoJson) {
            logConsole(
              `✅ <b>Зони завантажені з бази даних!</b> ${zonesGeoJson.features.length} зон.`,
            );
          }
        } catch (e) {
          console.error("Zone loading error:", e);
        }
      }

      // Fallback: try inline zones field (old format)
      if (!zonesGeoJson && existingSnap.zones) {
        try {
          zonesGeoJson =
            typeof existingSnap.zones === "string"
              ? JSON.parse(existingSnap.zones)
              : existingSnap.zones;
          logConsole(
            `✅ <b>Зони завантажені з бази даних!</b> ${zonesGeoJson.features.length} зон (inline).`,
          );
        } catch (e) {
          console.error("Zone parse error:", e);
        }
      }
    }
  }

  // 2. Zone Detection — zones MUST come from snapshot
  if (!zonesGeoJson) {
    alert(
      "No zones found in snapshot! Generate zones (Citadels) in the Castles tab first.",
    );
    return;
  }

  try {
    // Process & Balance Distribution
    if (!window.turf) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src =
          "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Turf.js"));
        document.head.appendChild(script);
      });
    }
    const turf = window.turf;
    const generatedShops = [];
    const totalWeight = Array.from(activeRules.values()).reduce(
      (s, w) => s + w,
      0,
    );
    const exactTemplatePool = [];
    Array.from(activeRules.entries()).forEach(([id, weight]) => {
      const t = templates.find((temp) => temp.id === id);
      if (!t) return;
      const count =
        totalWeight > 0 ? Math.round(capacity * (weight / totalWeight)) : 0;
      for (let i = 0; i < count; i++) {
        exactTemplatePool.push({ ...t });
      }
    });

    const zonesById = {};
    zonesGeoJson.features.forEach((f, idx) => {
      let id = f.properties?.citadelId || f.properties?.id || f.id;
      if (!id || id === "Citadel" || id === "Castle") {
        id = `zone_${idx}`;
      }
      if (!zonesById[id]) zonesById[id] = [];
      zonesById[id].push(f);
    });

    const uniqueZoneIds = Object.keys(zonesById);

    uniqueZoneIds.forEach((citadelId) => {
      const zoneFeatures = zonesById[citadelId];
      const zoneCityId = zoneFeatures[0]?.properties?.cityId || "unknown";
      const zoneTemplatePool = exactTemplatePool
        .slice()
        .sort(() => Math.random() - 0.5);

      for (const template of zoneTemplatePool) {
        const randomFeature =
          zoneFeatures[Math.floor(Math.random() * zoneFeatures.length)];
        const rndPt = generateRandomPointInPolygon(randomFeature);
        if (rndPt) {
          generatedShops.push({
            type: "shop",
            templateId: template.id,
            name: template.name,
            icon: template.icon,
            shopType: template.name,
            inventory: template.inventory || [],
            lat: rndPt.lat,
            lng: rndPt.lng,
            cityId: zoneCityId,
            zoneId: citadelId,
          });
        }
      }
    });

    const mergedObjects = [...existingObjects, ...generatedShops];

    // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
    const optimizedObjects = mergedObjects.map((o) => {
      const { createdBy, createdAt, ...core } = o;
      return core;
    });

    // 3. Save Snapshot
    logConsole(
      `💾 Saving Template "${snapName}" (${optimizedObjects.length} objects)...`,
    );
    const snapshotData = {
      id: finalId, // Null if new
      name: snapName,
      type: mergedObjects.some(
        (o) => o.type === "monster" || o.type === "castle",
      )
        ? "mixed"
        : "shop",
      objects: optimizedObjects,
    };

    if (zonesGeoJson) {
      snapshotData.zones = JSON.stringify(zonesGeoJson);
      logConsole(
        `📦 Attached ${snapshotData.zones.length} chars of zone data.`,
      );
    }

    const success = await saveWorldSnapshot(snapshotData);

    if (success) {
      logConsole(`✅ Template Saved! Go to "Map" tab to view.`);
      await window.loadWorldSnapshots();
    }
  } catch (e) {
    logConsole(`❌ Error: ${e.message}`);
  }
};

// Deprecated old functions
window.scanOverpass = () => logConsole("Use Generate button.");
window.saveScannedShops = () => {};

// Deprecated old functions continued
window.saveScannedShops = () => {};

function logConsole(msg) {
  const con = document.getElementById("console-log");
  if (!con) return;
  const div = document.createElement("div");
  div.className = "mb-1 border-b border-gray-800/30 pb-1 last:border-0";
  div.innerHTML = `<span class="text-blue-500/70 mr-1">[${new Date().toLocaleTimeString([], { hour12: false })}]</span> ${msg}`;
  con.prepend(div);
}

// ==================== BALANCED HELPERS ====================

// ==================== TAB NAVIGATION ====================

let activeRecipe = null;

window.switchTab = (tabName) => {
  // Hide all tab contents
  document.querySelectorAll(".tab-content").forEach((el) => {
    el.classList.add("hidden");
  });
  // Show selected tab
  const target = document.getElementById(`tab-${tabName}`);
  if (target) target.classList.remove("hidden");

  // Update tab button styles
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active", "bg-gray-800", "text-purple-300");
    btn.classList.add("bg-gray-900", "text-gray-400");
  });
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add("active", "bg-gray-800", "text-purple-300");
    activeBtn.classList.remove("bg-gray-900", "text-gray-400");
  }

  // Lazy-load tab data
  if (tabName === "procedural") loadProceduralRules();
  if (tabName === "manual") populateManualTemplateDropdown();
  if (tabName === "stats") refreshStatistics();
};

// ==================== PROCEDURAL RULES TAB ====================

async function loadProceduralRules() {
  const infoEl = document.getElementById("recipe-info");
  try {
    activeRecipe = await loadActiveRecipe();
    if (!activeRecipe) {
      infoEl.innerHTML =
        '<div class="text-xs text-yellow-400"><i class="fas fa-exclamation-triangle mr-1"></i> No active recipe found. Create one in the Map Admin tool first.</div>';
      return;
    }
    infoEl.innerHTML = `<div class="text-xs text-green-400"><i class="fas fa-check-circle mr-1"></i> Active recipe: <strong>${activeRecipe.id}</strong> (seed: ${activeRecipe.seed}, v${activeRecipe.version || 1})</div>`;

    // Set density ratio
    const densityInput = document.getElementById("proc-density");
    if (densityInput && activeRecipe.densityRatios?.shop) {
      densityInput.value = activeRecipe.densityRatios.shop;
    }

    renderProceduralRulesTable();
    populateAddTemplateDropdown();
  } catch (err) {
    infoEl.innerHTML = `<div class="text-xs text-red-400"><i class="fas fa-times-circle mr-1"></i> Error: ${err.message}</div>`;
  }
}

function renderProceduralRulesTable() {
  const table = document.getElementById("proc-rules-table");
  if (!activeRecipe) {
    table.innerHTML =
      '<tr><td colspan="4" class="p-4 text-center text-gray-500 italic">No active recipe</td></tr>';
    return;
  }

  const rules = getProceduralRulesForType(activeRecipe, "shops");
  if (rules.templates.length === 0) {
    table.innerHTML =
      '<tr><td colspan="4" class="p-4 text-center text-gray-500 italic">No shop templates in recipe whitelist. Add templates below.</td></tr>';
    return;
  }

  table.innerHTML = rules.templates
    .map(
      (t) => `
    <tr class="border-b border-gray-800 hover:bg-gray-800/50">
      <td class="px-4 py-2">${t.templateId}</td>
      <td class="px-4 py-2 text-center">
        <input type="number" class="w-16 bg-gray-900 border border-gray-700 rounded text-center text-xs p-1"
          value="${t.weight}" onchange="updateProcWeight('${t.templateId}', this.value)" min="1" max="100">
      </td>
      <td class="px-4 py-2 text-center text-gray-400">${t.weightPercent}%</td>
      <td class="px-4 py-2 text-right">
        <button onclick="removeProcTemplate('${t.templateId}')" class="text-red-500 hover:text-white"><i class="fas fa-times"></i></button>
      </td>
    </tr>
  `,
    )
    .join("");
}

function populateAddTemplateDropdown() {
  const select = document.getElementById("proc-add-template");
  if (!select) return;
  const existingIds = new Set(
    (activeRecipe?.layers?.shops?.templates || []).map((t) => t.templateId),
  );
  select.innerHTML = '<option value="">Select template to add...</option>';
  templates
    .filter((t) => !existingIds.has(t.id))
    .forEach((t) => {
      select.innerHTML += `<option value="${t.id}">${t.icon || ""} ${t.name}</option>`;
    });
}

window.addToProceduralWhitelist = async () => {
  const templateId = document.getElementById("proc-add-template").value;
  const weight =
    parseInt(document.getElementById("proc-add-weight").value) || 10;
  if (!templateId || !activeRecipe) return;

  activeRecipe = addTemplateToLayer(activeRecipe, "shops", templateId, weight);
  try {
    await updateRecipe(activeRecipe.id, { layers: activeRecipe.layers });
    logConsole(
      `<span class="text-green-400">Added ${templateId} to procedural whitelist (weight: ${weight})</span>`,
    );
    renderProceduralRulesTable();
    populateAddTemplateDropdown();
  } catch (err) {
    logConsole(
      `<span class="text-red-400">Error saving: ${err.message}</span>`,
    );
  }
};

window.removeProcTemplate = async (templateId) => {
  if (!activeRecipe) return;
  activeRecipe = removeTemplateFromLayer(activeRecipe, "shops", templateId);
  try {
    await updateRecipe(activeRecipe.id, { layers: activeRecipe.layers });
    logConsole(
      `<span class="text-yellow-400">Removed ${templateId} from procedural whitelist</span>`,
    );
    renderProceduralRulesTable();
    populateAddTemplateDropdown();
  } catch (err) {
    logConsole(
      `<span class="text-red-400">Error saving: ${err.message}</span>`,
    );
  }
};

window.updateProcWeight = async (templateId, newWeight) => {
  if (!activeRecipe) return;
  activeRecipe = updateTemplateWeight(
    activeRecipe,
    "shops",
    templateId,
    parseInt(newWeight) || 1,
  );
  try {
    await updateRecipe(activeRecipe.id, { layers: activeRecipe.layers });
    renderProceduralRulesTable();
  } catch (err) {
    logConsole(
      `<span class="text-red-400">Error updating weight: ${err.message}</span>`,
    );
  }
};

window.saveProceduralRules = async () => {
  if (!activeRecipe) return;
  const density =
    parseInt(document.getElementById("proc-density").value) || 16000;
  try {
    await updateRecipe(activeRecipe.id, {
      densityRatios: { ...activeRecipe.densityRatios, shop: density },
      layers: activeRecipe.layers,
    });
    activeRecipe.densityRatios.shop = density;
    logConsole(
      '<span class="text-green-400">Procedural rules saved to recipe!</span>',
    );
  } catch (err) {
    logConsole(
      `<span class="text-red-400">Error saving rules: ${err.message}</span>`,
    );
  }
};

// ==================== MANUAL PLACEMENT TAB ====================

function populateManualTemplateDropdown() {
  const select = document.getElementById("manual-template");
  if (!select) return;
  select.innerHTML = '<option value="">Select a shop template...</option>';
  templates.forEach((t) => {
    select.innerHTML += `<option value="${t.id}">${t.icon || ""} ${t.name}</option>`;
  });
  select.onchange = () => {
    const t = templates.find((tp) => tp.id === select.value);
    const preview = document.getElementById("manual-template-preview");
    if (t && preview) {
      preview.innerHTML = `<div class="text-white font-bold">${t.icon || ""} ${t.name}</div>
        <div class="text-gray-400 mt-1">Type: ${t.type || "shop"} | Items: ${(t.inventory || []).length}</div>`;
    }
  };
}

window.placeManualEntity = async () => {
  const templateId = document.getElementById("manual-template").value;
  const lat = parseFloat(document.getElementById("manual-lat").value);
  const lng = parseFloat(document.getElementById("manual-lng").value);
  const template = templates.find((t) => t.id === templateId);

  if (!templateId || !template) {
    alert("Please select a template.");
    return;
  }

  const entity = createManualEntity(
    "shop",
    templateId,
    {
      name: template.name,
      icon: template.icon,
      inventory: template.inventory || [],
    },
    { lat, lng },
  );

  const validation = validateManualEntity(entity);
  if (!validation.valid) {
    alert("Validation failed:\n" + validation.errors.join("\n"));
    return;
  }

  try {
    await saveGeneratedObjects([entity]);
    logConsole(
      `<span class="text-green-400">Placed manual shop: ${entity.name} at (${lat}, ${lng})</span>`,
    );
    document.getElementById("manual-lat").value = "";
    document.getElementById("manual-lng").value = "";
    refreshManualList();
  } catch (err) {
    logConsole(
      `<span class="text-red-400">Error placing entity: ${err.message}</span>`,
    );
  }
};

window.refreshManualList = async () => {
  const listEl = document.getElementById("manual-objects-list");
  listEl.innerHTML =
    '<div class="text-gray-500">Loading manual objects...</div>';
  try {
    const { collection, query, where, getDocs } =
      await import("https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js");
    const { getDB } = await import("../firebase/firebase-service.js");
    const db = getDB();
    const q = query(
      collection(db, "spawned_objects"),
      where("type", "==", "shop"),
      where("isManual", "==", true),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML =
        '<div class="text-gray-500">No manual shops found.</div>';
      return;
    }
    listEl.innerHTML = snap.docs
      .map((doc) => {
        const d = doc.data();
        return `<div class="flex justify-between items-center p-1 hover:bg-gray-800 rounded">
        <span>${d.icon || "🏪"} ${d.name || d.templateId} (${d.lat?.toFixed(4)}, ${d.lng?.toFixed(4)})</span>
        <span class="text-gray-500 text-[10px]">${doc.id.slice(0, 12)}...</span>
      </div>`;
      })
      .join("");
  } catch (err) {
    listEl.innerHTML = `<div class="text-red-400">Error: ${err.message}</div>`;
  }
};

// ==================== STATISTICS TAB ====================

window.refreshStatistics = async () => {
  const procEl = document.getElementById("stat-procedural-total");
  const manEl = document.getElementById("stat-manual-total");
  const combEl = document.getElementById("stat-combined-total");
  const tableEl = document.getElementById("stats-breakdown-table");

  procEl.textContent = "...";
  manEl.textContent = "...";
  combEl.textContent = "...";

  try {
    // Get procedural count from recipe
    if (!activeRecipe) activeRecipe = await loadActiveRecipe();
    const rules = getProceduralRulesForType(activeRecipe, "shops");

    // Get manual objects from Firestore
    const { collection, query, where, getDocs } =
      await import("https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js");
    const { getDB } = await import("../firebase/firebase-service.js");
    const db = getDB();
    const q = query(
      collection(db, "spawned_objects"),
      where("type", "==", "shop"),
      where("isManual", "==", true),
    );
    const snap = await getDocs(q);
    const manualObjects = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Build procedural placeholder array from recipe rules
    const proceduralCount = rules.templates.length > 0 ? "~recipe" : 0;

    const stats = buildEntityStatistics([], manualObjects);

    // Display
    procEl.textContent =
      rules.templates.length > 0 ? `${rules.templates.length} rules` : "0";
    manEl.textContent = String(stats.manual.total);
    combEl.textContent = String(stats.manual.total) + " placed";

    // Breakdown table
    const allTemplateIds = new Set([
      ...rules.templates.map((t) => t.templateId),
      ...Object.keys(stats.manual.byTemplate),
    ]);

    if (allTemplateIds.size === 0) {
      tableEl.innerHTML =
        '<tr><td colspan="4" class="p-4 text-center text-gray-500 italic">No data available</td></tr>';
      return;
    }

    tableEl.innerHTML = Array.from(allTemplateIds)
      .map((tid) => {
        const procRule = rules.templates.find((t) => t.templateId === tid);
        const manCount = stats.manual.byTemplate[tid] || 0;
        const procInfo = procRule ? `${procRule.weightPercent}% weight` : "—";
        return `<tr class="border-b border-gray-800">
        <td class="px-4 py-2">${tid}</td>
        <td class="px-4 py-2 text-center text-blue-400">${procInfo}</td>
        <td class="px-4 py-2 text-center text-green-400">${manCount}</td>
        <td class="px-4 py-2 text-center text-gray-300">${manCount}${procRule ? " + proc" : ""}</td>
      </tr>`;
      })
      .join("");
  } catch (err) {
    procEl.textContent = "Err";
    manEl.textContent = "Err";
    combEl.textContent = "Err";
    tableEl.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-400">${err.message}</td></tr>`;
  }
};

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
