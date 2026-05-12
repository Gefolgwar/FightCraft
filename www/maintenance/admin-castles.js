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

let templates = [];
let currentEditId = null;
let activeRules = new Map(); // Stores Template ID -> Weight (0-100)
let generatedCount = new Map(); // Stores Template ID -> Count of spawned entities

// Init
document.addEventListener("DOMContentLoaded", async () => {
  await requireAdmin(async () => {
    await loadTemplates();
    // restoreState();
    renderMappingRules();
    renderTemplateList();

    // Add capacity change listener to update counts and save config
    const capacityInput = document.getElementById("gen-capacity");
    if (capacityInput) {
      // Load saved
      const savedCap = localStorage.getItem("max_districts");
      if (savedCap) capacityInput.value = savedCap;

      capacityInput.addEventListener("input", () => {
        const val = parseInt(capacityInput.value) || 10;
        localStorage.setItem("max_districts", val);
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
  const list = document.getElementById("template-list");
  list.innerHTML =
    '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

  templates = await getTemplates("castle");

  // EXCLUDE CITADELS (They have their own dedicated admin page)
  templates = templates.filter(
    (t) =>
      t.icon !== "🏯" &&
      !t.name.includes("Citadel") &&
      !(t.id && t.id.includes("citadel")),
  );

  // Ensure default templates if none
  if (templates.length === 0) {
    await createDefaultCastleTemplates();
    templates = await getTemplates("castle");
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
      hp: 500,
    },
    {
      name: "Wizard Tower",
      icon: "🧙‍♂️",
      osmTag: "amenity=bar",
      type: "castle",
      level: 8,
      hp: 600,
    },
    {
      name: "Outpost",
      icon: "🛡️",
      osmTag: "amenity=cafe",
      type: "castle",
      level: 3,
      hp: 300,
    },
  ];

  for (const t of defaults) {
    await saveTemplate(t);
  }
  logConsole("Created 3 default castle templates.");

  // Auto-setup for Template 4
  await loadTemplates(); // Refresh local list
  activeRules.clear();

  // Activate all 3 templates with 100% weight
  templates.forEach((t) => {
    if (["Stone Keep", "Wizard Tower", "Outpost"].includes(t.name)) {
      activeRules.set(t.id, 100);
    }
  });

  renderMappingRules();
  renderTemplateList();

  // Start generation automatically
  logConsole("🪄 Magic Wand: Starting 'Template 4' generation...");
  window.autoTargetSnapName = "Template 4";
  const capInput = document.getElementById("gen-capacity");
  if (capInput) capInput.value = 100; // Increased capacity for all types
  startGeneration();
};

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

    snaps.forEach((snap) => {
      const option = document.createElement("option");
      const display = snap.name ? snap.name : `${snap.id.substr(0, 10)}...`;
      const typeIcon =
        snap.type === "shop"
          ? "🏪"
          : snap.type === "monster"
            ? "👾"
            : snap.type === "castle"
              ? "🏰"
              : "🌍";

      option.value = snap.id;
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
    const isActive = activeRules.has(t.id);
    const activeClass = isActive
      ? "border-blue-500 bg-blue-900/20"
      : "border-gray-700 hover:border-blue-500";

    el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;

    el.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="text-xl flex-shrink-0">${t.icon || "🏰"}</span>
                <div class="min-w-0 flex-1">
                    <div class="font-bold text-sm text-gray-300 truncate">${t.name}</div>
                    <div class="text-[10px] text-gray-400 truncate opacity-60">Tags: ${t.osmTag || "N/A"}</div>
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
    el.querySelector(".flex.items-center.gap-2").prepend(
      bulk.createCheckbox(t.id),
    );

    el.addEventListener("click", (e) => {
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
  const tbody = document.getElementById("rules-table");
  const emptyMsg = document.getElementById("rules-empty");
  if (tbody) {
    tbody.innerHTML = "";
    if (activeRules.size === 0) {
      if (emptyMsg) emptyMsg.classList.remove("hidden");
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

      activeRules.forEach((weight) => {
        totalWeight += weight;
      });

      activeRules.forEach((weight, id) => {
        const t = templates.find((temp) => temp.id === id);
        if (!t) return;

        const estimatedCount =
          totalWeight > 0 ? Math.round(totalCap * (weight / totalWeight)) : 0;

        const tr = document.createElement("tr");
        tr.className = "border-b border-gray-800 hover:bg-gray-800/50";

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

window.removeMappingRule = (id) => {
  activeRules.delete(id);
  renderMappingRules();
};

window.openTemplateModal = () => {
  currentEditId = null;
  document.getElementById("tpl-id").value = "";
  document.getElementById("btn-delete").classList.add("hidden");

  ["name", "icon", "osm", "level"].forEach(
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
  document.getElementById("tpl-level").value = t.level || 1;

  document.getElementById("template-modal").classList.remove("hidden");
};

window.copyTemplate = async (id) => {
  const t = templates.find((t) => t.id === id);
  if (!t) return;

  const copyName = prompt(
    `Copy Template "${t.name}"\n\nEnter new name:`,
    `${t.name} (Copy)`,
  );
  if (!copyName) return;

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
  const template = {
    name: document.getElementById("tpl-name").value,
    icon: document.getElementById("tpl-icon").value,
    osmTag: document.getElementById("tpl-osm").value,
    level: parseInt(document.getElementById("tpl-level").value) || 1,
    hp: (parseInt(document.getElementById("tpl-level").value) || 1) * 100,
    type: "castle",
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
    const saved = localStorage.getItem("admin_castles_state");
    if (!saved) return;

    const state = JSON.parse(saved);

    if (state.consoleLog) {
      document.getElementById("console-log").innerHTML = state.consoleLog;
    }
    if (document.getElementById("gen-capacity")) {
      document.getElementById("gen-capacity").value = state.capacity || "1000";
    }
    if (state.activeRules) {
      activeRules = new Map(state.activeRules);
    }
  } catch (e) {
    console.error("Failed to restore state:", e);
  }
}

// ==================== GENERATION LOGIC ====================

window.startGeneration = async (overwrite = true) => {
  const capacity =
    parseInt(document.getElementById("gen-capacity")?.value) || 1000;

  // Mode Logging
  logConsole(
    overwrite
      ? "🗑️ Mode: Create / Delete + Create (Replenish Castles)"
      : "➕ Mode: Add if exist",
  );

  const targetTemplateId = document.getElementById("gen-template").value;
  let snapName = "";
  let finalId = null;
  let existingObjects = [];
  let zonesGeoJson = null;

  generatedCount.clear();
  renderMappingRules();

  if (targetTemplateId === "new") {
    if (window.autoTargetSnapName) {
      snapName = window.autoTargetSnapName;
      window.autoTargetSnapName = null;
    } else {
      snapName = prompt(
        "Enter a name for this new Map Template:",
        `castles_${new Date().toLocaleDateString()}`,
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

    const { getSnapshotById } = await import("../firebase/firebase-service.js");
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
        // MERGE: Keep everything
        console.log("Merging: Keeping all existing objects.");
        existingObjects = allSavedObjects;
      } else {
        // RELOAD: Partition objects: Keep infrastructure/monsters/shops/CITADELS, drop ONLY regular castles
        console.log(
          "Reloading: Filtering out only regular castles (keeping Citadels).",
        );
        existingObjects = allSavedObjects.filter((o) => {
          // Keep if NOT a castle at all
          if (o.type !== "castle") return true;

          // If it IS a castle, check if it's a Citadel (keep Citadels)
          const isCitadel =
            o.icon === "🏯" ||
            (o.name && o.name.includes("Citadel")) ||
            (o.templateId && o.templateId.includes("citadel"));

          return isCitadel; // Keep citadels, drop regular castles
        });
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

  // Zones are REQUIRED — they must come from the snapshot
  if (
    !zonesGeoJson ||
    !zonesGeoJson.features ||
    zonesGeoJson.features.length === 0
  ) {
    alert(
      "❌ No zones found in the selected snapshot. Zones are required for castle generation. Please select a snapshot that contains zones.",
    );
    logConsole("❌ No zones found. Zones must exist in the snapshot.");
    return;
  }

  // Load Turf.js if needed
  if (!window.turf) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Failed to load Turf.js"));
      document.head.appendChild(script);
    });
  }

  let newCastles = [];

  // Calculate totalWeight for pool building
  const totalWeight = Array.from(activeRules.values()).reduce(
    (s, w) => s + w,
    0,
  );

  // Build exact template pool
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

  if (exactTemplatePool.length === 0) {
    logConsole(
      "⚠️ No active rules or empty template pool. Select templates first.",
    );
    return;
  }

  // Group zone features by citadelId
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
  logConsole(`🗺️ Distributing castles across ${uniqueZoneIds.length} zones...`);

  // Pure random placement in zones
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
        newCastles.push({
          type: "castle",
          templateId: template.id,
          name: template.name,
          icon: template.icon,
          level: template.level || 1,
          lat: rndPt.lat,
          lng: rndPt.lng,
          cityId: zoneCityId,
          zoneId: citadelId,
        });
      }
    }
  });

  logConsole(`🏰 Generated ${newCastles.length} new castles.`);

  const mergedObjects = [...existingObjects, ...newCastles];

  // Save Snapshot (Include Zones)
  logConsole(`💾 Saving Template "${snapName}"...`);
  const snapshotData = {
    id: finalId,
    name: snapName,
    type: existingObjects.length > 0 ? "mixed" : "castle",
    objects: mergedObjects,
  };

  // Serialize zones into the snapshot
  if (zonesGeoJson) {
    snapshotData.zones = JSON.stringify(zonesGeoJson);
    logConsole(`📦 Attached ${snapshotData.zones.length} chars of zone data.`);
  }

  try {
    const success = await saveWorldSnapshot(snapshotData);

    if (success) {
      logConsole(`✅ Template Saved! Go to "Map" tab to view.`);
      await window.loadWorldSnapshots();
      alert("Generation complete! Template saved.");
    }
  } catch (e) {
    logConsole(`❌ Error: ${e.message}`);
  }
};

function logConsole(msg) {
  const con = document.getElementById("console-log");
  if (!con) return;
  const div = document.createElement("div");
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
