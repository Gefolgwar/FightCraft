import { requireAdmin } from "./admin-core.js";
import { BulkActions } from "./template-bulk-actions.js";
import {
  getTemplates,
  saveTemplate,
  deleteTemplate,
  saveWorldSnapshot,
  getWorldSnapshots,
  getSnapshotById,
  loadSnapshotChunks,
  isAdmin,
  getCurrentUser,
  initFirebase,
} from "../firebase/firebase-service.js";
import { EntityConfigManager } from "./admin-entity-config.js";
import { latLngToH3, ensureH3Loaded } from "../core/h3-spatial.js";
import { validateCitadelCollisions } from "./admin-validators.js";

let templates = [];
let currentEditId = null;

// EntityConfigManager instance for citadels
const configManager = new EntityConfigManager("citadels", {
  templateType: "citadel",
  accentColor: "orange",
  tableId: "config-table-body",
});
window.configManager = configManager;

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await requireAdmin(
    async () => {
      await loadTemplates();

      // Delay snapshot loading slightly to ensure Admin role is firm
      setTimeout(() => {
        if (window.refreshSnapshotList) window.refreshSnapshotList();
      }, 1200);
    },
    { colorClass: "text-orange-400" },
  );
});

// ==================== TEMPLATE MANAGEMENT ====================

async function loadTemplates() {
  const list = document.getElementById("template-list");
  if (!list) return;
  list.innerHTML =
    '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

  try {
    // Citadels were historically stored as type 'castle', new ones are 'citadel'
    const allCastles = await getTemplates("castle");
    const allCitadels = await getTemplates("citadel");
    const combined = [...allCastles, ...allCitadels];

    templates = combined.filter(
      (t) =>
        t.type === "citadel" ||
        t.icon === "🏯" ||
        (t.name && t.name.includes("Citadel")) ||
        (t.id && t.id.includes("citadel")),
    );

    if (templates.length === 0) {
      console.log(
        "ℹ️ No 'Citadel' template found. Use the Magic Wand to create one.",
      );
    }
  } catch (error) {
    console.error("Template load error:", error);
    list.innerHTML =
      '<div class="text-center text-red-500 text-xs mt-4">Error loading templates</div>';
  }

  renderTemplateList();
}

const bulk = new BulkActions(deleteTemplate, loadTemplates);

window.createDefaultCitadelTemplates = async function () {
  const defaults = [
    {
      name: "Citadel",
      icon: "🏯",
      osmTag:
        "historic~castle|monument|memorial; tourism=museum; amenity~townhall|library|university|bus_station|arts_centre|place_of_worship; railway~station|subway_entrance; leisure~park|square|viewpoint|stadium",
      type: "citadel",
      level: 15,
      hp: 2000,
    },
  ];

  for (const t of defaults) {
    await saveTemplate(t);
  }
  logConsole("🪄 Magic Wand: Created default citadel templates.");
  await loadTemplates();
  logConsole("✅ Default Citadel template created.");
};

function renderTemplateList() {
  const list = document.getElementById("template-list");
  if (!list) return;

  const search =
    document.getElementById("template-search")?.value.toLowerCase() || "";

  list.innerHTML = "";

  const visible = templates.filter((t) =>
    t.name.toLowerCase().includes(search),
  );

  bulk.injectSelectAllHeader(
    list,
    visible.map((t) => t.id),
  );

  visible.forEach((t) => {
    const el = document.createElement("div");
    // Check if template is in config table
    const inConfig = configManager.workingConfig.some(
      (e) => e.templateId === t.id || e.templateId === t.originalTemplateId,
    );
    const activeClass = inConfig
      ? "border-orange-500 bg-orange-900/20"
      : "border-gray-700 hover:border-orange-500";

    el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;
    el.innerHTML = `
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="text-xl flex-shrink-0">${t.icon || "🏯"}</span>
        <div class="min-w-0 flex-1">
          <div class="font-bold text-sm text-gray-300 truncate">${t.name}</div>
          <div class="text-[10px] text-gray-400 truncate opacity-60">Lv.${t.level || 1} • Tags: ${t.osmTag || "N/A"}</div>
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
    // Click adds template to config table
    el.addEventListener("click", (e) => {
      if (
        !e.target.closest("button") &&
        !e.target.closest("input[type=checkbox]")
      ) {
        configManager.addToTable(t);
        renderConfigTable();
        renderTemplateList();
        logConsole(`Added "${t.name}" to config table.`);
      }
    });
    list.appendChild(el);
  });
}

window.openTemplateModal = () => {
  currentEditId = null;
  document.getElementById("tpl-id").value = "";
  document.getElementById("btn-delete").classList.add("hidden");

  ["name", "icon", "osm", "level"].forEach(
    (id) => (document.getElementById(`tpl-${id}`).value = ""),
  );
  document.getElementById("tpl-level").value = 10;

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
  document.getElementById("tpl-level").value = t.level || 10;

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

window.closeTemplateModal = () => {
  document.getElementById("template-modal").classList.add("hidden");
};

window.saveTemplateForm = async () => {
  const template = {
    name: document.getElementById("tpl-name").value,
    icon: document.getElementById("tpl-icon").value || "🏯",
    osmTag: document.getElementById("tpl-osm").value,
    level: parseInt(document.getElementById("tpl-level").value) || 10,
    hp: 2000,
    type: "citadel",
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
  if (confirm("Are you sure you want to delete this template?")) {
    await deleteTemplate(currentEditId);
    closeTemplateModal();
    loadTemplates();
    logConsole(`Template deleted.`);
  }
};

document
  .getElementById("template-search")
  .addEventListener("input", renderTemplateList);

// ==================== CONFIG TABLE RENDERING ====================

function renderConfigTable() {
  const tbody = document.getElementById("config-table-body");
  if (!tbody) return;

  const diff = configManager.computeDiff(
    configManager.savedConfig,
    configManager.workingConfig,
  );

  if (diff.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="p-4 text-center text-gray-500 italic">No entities configured. Click templates in sidebar to add.</td></tr>';
    updateTotalCount(0);
    return;
  }

  const colorMap = {
    unchanged: "bg-gray-800",
    added: "bg-blue-900/20 border-l-2 border-blue-500",
    removed: "bg-red-900/20 border-l-2 border-red-500",
    increased: "bg-green-900/20 border-l-2 border-green-500",
    decreased: "bg-red-900/20 border-l-2 border-red-500",
  };

  let totalCount = 0;

  tbody.innerHTML = diff
    .map((entry) => {
      const template = templates.find(
        (t) =>
          t.id === entry.templateId ||
          t.originalTemplateId === entry.templateId,
      );
      const name = template
        ? template.name || entry.templateId
        : entry.templateId;
      const icon = template ? template.icon || "❓" : "❓";
      const colorClass = colorMap[entry.status] || "bg-gray-800";
      const deltaDisplay =
        entry.delta > 0
          ? `<span class="text-green-400">+${entry.delta}</span>`
          : entry.delta < 0
            ? `<span class="text-red-400">${entry.delta}</span>`
            : "";

      totalCount += entry.count;

      const workingEntry = configManager.workingConfig.find(
        (e) => e.templateId === entry.templateId,
      );
      const entryType = workingEntry
        ? workingEntry.type || "generated"
        : "generated";
      const showCoords = entryType === "manual";

      return `<tr id="row-${entry.templateId}" class="${colorClass}">
          <td class="px-3 py-2">${icon} ${name}</td>
          <td class="px-3 py-2 text-center">
            <input type="number" class="w-16 bg-gray-900 border border-gray-700 rounded text-center text-xs p-1"
              value="${entry.count}" min="0"
              onchange="window.updateConfigCount('${entry.templateId}', parseInt(this.value))" />
          </td>
          <td class="px-3 py-2 text-center">
            <select class="bg-gray-900 border border-gray-700 rounded text-xs p-1"
              onchange="window.updateConfigType('${entry.templateId}', this.value)">
              <option value="generated" ${entryType === "generated" ? "selected" : ""}>generated</option>
              <option value="manual" ${entryType === "manual" ? "selected" : ""}>manual</option>
            </select>
          </td>
          <td class="px-3 py-2 text-center text-xs">
            ${showCoords ? `<input type="number" step="0.000001" class="w-20 bg-gray-900 border border-gray-700 rounded text-center text-[10px] p-0.5 mr-1" placeholder="lat" value="${workingEntry.lat || ""}" onchange="window.updateConfigCoord('${entry.templateId}', 'lat', parseFloat(this.value))" /><input type="number" step="0.000001" class="w-20 bg-gray-900 border border-gray-700 rounded text-center text-[10px] p-0.5" placeholder="lng" value="${workingEntry.lng || ""}" onchange="window.updateConfigCoord('${entry.templateId}', 'lng', parseFloat(this.value))" />` : '<span class="text-gray-600">—</span>'}
          </td>
          <td class="px-3 py-2 text-center">${deltaDisplay}</td>
          <td class="px-3 py-2 text-center text-xs text-gray-400">${entry.status}</td>
          <td class="px-3 py-2 text-center">
            <button onclick="window.removeConfigEntry('${entry.templateId}')" class="text-red-500 hover:text-white text-xs">
              <i class="fas fa-times"></i>
            </button>
          </td>
        </tr>`;
    })
    .join("\n");

  updateTotalCount(totalCount);
}

function updateTotalCount(count) {
  const el = document.getElementById("config-total-count");
  if (el) el.textContent = String(count);
}

// ==================== CONFIG ACTIONS ====================

window.updateConfigCount = (templateId, newCount) => {
  const entry = configManager.workingConfig.find(
    (e) => e.templateId === templateId,
  );
  if (entry) {
    entry.count = Math.max(0, newCount || 0);
    renderConfigTable();
  }
};

window.updateConfigType = (templateId, newType) => {
  const entry = configManager.workingConfig.find(
    (e) => e.templateId === templateId,
  );
  if (entry) {
    entry.type = newType;
    renderConfigTable();
  }
};

window.updateConfigCoord = (templateId, coord, value) => {
  const entry = configManager.workingConfig.find(
    (e) => e.templateId === templateId,
  );
  if (entry) {
    entry[coord] = value;
  }
};

window.removeConfigEntry = (templateId) => {
  configManager.removeFromTable(templateId);
  renderConfigTable();
  renderTemplateList();
  logConsole(`Removed template "${templateId}" from config.`);
};

// ==================== SNAPSHOT INTEGRATION ====================

window.refreshSnapshotList = async () => {
  const selector = document.getElementById("config-snapshot-select");
  if (!selector) return;

  if (!isAdmin()) {
    logConsole("⚠️ Waiting for admin role...");
    return;
  }

  const currentVal = selector.value;
  selector.innerHTML = '<option value="">Select a snapshot...</option>';

  logConsole("🔄 Loading snapshots...");

  try {
    const snaps = await getWorldSnapshots();
    logConsole(`📦 Found ${snaps.length} snapshots.`);

    snaps.forEach((snap) => {
      const option = document.createElement("option");
      const display = snap.name ? snap.name : `${snap.id.substr(0, 10)}...`;
      const typeIcon =
        snap.type === "world" ? "🌍" : snap.type === "monster" ? "👾" : "📦";

      option.value = snap.id;
      option.textContent = `${typeIcon} ${display}`;
      selector.appendChild(option);
    });

    // Restore selection if possible
    if (currentVal) {
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

window.onSnapshotSelected = async () => {
  const selector = document.getElementById("config-snapshot-select");
  const snapshotId = selector ? selector.value : "";

  if (!snapshotId) {
    configManager._savedConfig = [];
    configManager._workingConfig = [];
    configManager._snapshotId = null;
    renderConfigTable();
    updateSnapshotStats(null);
    return;
  }

  logConsole(`📂 Loading config for snapshot "${snapshotId}"...`);

  try {
    await configManager.onTemplateSelected(snapshotId, {
      getSnapshotById: getSnapshotById,
    });

    // Migrate legacy templateIds (from entityConfig) to real template doc IDs
    for (const entry of configManager._workingConfig) {
      const match = templates.find(
        (t) => t.originalTemplateId === entry.templateId,
      );
      if (match && match.id !== entry.templateId) {
        entry.templateId = match.id;
      }
    }
    for (const entry of configManager._savedConfig) {
      const match = templates.find(
        (t) => t.originalTemplateId === entry.templateId,
      );
      if (match && match.id !== entry.templateId) {
        entry.templateId = match.id;
      }
    }

    // Backward compatibility: if entityConfig.citadels is empty,
    // build config from snapshot's objects[] array (legacy format)
    if (configManager.workingConfig.length === 0) {
      const snapshot = await getSnapshotById(snapshotId);

      let objects = snapshot?.objects || [];

      // If snapshot is chunked, load full objects from chunks
      if (objects.length === 0 && snapshot?.chunked) {
        logConsole(`📦 Loading chunked objects...`);
        objects = await loadSnapshotChunks(snapshotId);
      }

      // Seed-based snapshot: no stored objects, generate procedurally
      if (objects.length === 0 && snapshot?.seed) {
        logConsole(
          `🌱 Seed-based snapshot (seed: ${snapshot.seed}). Generating objects from procedural engine...`,
        );
        try {
          const { generateWorldFromSeed } =
            await import("../map/procedural-map-ui.js");
          if (typeof generateWorldFromSeed === "function") {
            objects = await generateWorldFromSeed(snapshot.seed);
            logConsole(`🌱 Generated ${objects.length} objects from seed.`);
          }
        } catch (genErr) {
          logConsole(
            `ℹ️ Seed-based snapshot. Add citadel templates below and set counts.`,
          );
        }
      }

      // Filter citadel objects
      const citadelObjects = objects.filter(
        (o) =>
          o.type === "citadel" ||
          o.icon === "🏯" ||
          (o.name && o.name.includes("Citadel")) ||
          (o.templateId && o.templateId.includes("citadel")),
      );

      if (citadelObjects.length > 0) {
        // Group by templateId and count
        const templateCounts = new Map();
        for (const obj of citadelObjects) {
          const tid = obj.templateId || "unknown";
          templateCounts.set(tid, (templateCounts.get(tid) || 0) + 1);
        }

        // Build config from counted objects
        const legacyConfig = [];
        for (const [templateId, count] of templateCounts) {
          legacyConfig.push({ templateId, count, type: "generated" });
        }

        legacyConfig.sort((a, b) => b.count - a.count);

        configManager._savedConfig = JSON.parse(JSON.stringify(legacyConfig));
        configManager._workingConfig = JSON.parse(JSON.stringify(legacyConfig));

        // Migrate legacy templateIds to real template doc IDs
        for (const entry of configManager._workingConfig) {
          const match = templates.find(
            (t) => t.originalTemplateId === entry.templateId,
          );
          if (match && match.id !== entry.templateId) {
            entry.templateId = match.id;
          }
        }
        for (const entry of configManager._savedConfig) {
          const match = templates.find(
            (t) => t.originalTemplateId === entry.templateId,
          );
          if (match && match.id !== entry.templateId) {
            entry.templateId = match.id;
          }
        }

        logConsole(
          `🔄 Built config from ${citadelObjects.length} legacy citadel objects (${templateCounts.size} templates).`,
        );
      } else if (objects.length === 0) {
        logConsole(
          `ℹ️ Empty snapshot. Click templates in sidebar to add citadel entries, then set counts.`,
        );
      }

      // Update stats from all objects
      updateSnapshotStats(objects);
    } else {
      // For snapshots with entityConfig, still load objects for stats
      const snapshot = await getSnapshotById(snapshotId);
      let objects = snapshot?.objects || [];
      if (objects.length === 0 && snapshot?.chunked) {
        objects = await loadSnapshotChunks(snapshotId);
      }
      updateSnapshotStats(objects);
    }

    logConsole(
      `✅ Loaded ${configManager.workingConfig.length} citadel config entries.`,
    );
    renderConfigTable();
    renderTemplateList();
  } catch (err) {
    logConsole(`❌ Error loading config: ${err.message}`);
  }
};

window.applyConfigChanges = async () => {
  if (!configManager.snapshotId) {
    alert("Please select a snapshot first.");
    return;
  }

  // Pre-save validation: Check for manual citadel collisions
  await ensureH3Loaded();
  const collisions = validateCitadelCollisions(configManager.workingConfig, { latLngToH3 });

  // Clear any previous error highlights
  configManager.workingConfig.forEach(entry => {
    const row = document.getElementById(`row-${entry.templateId}`);
    if (row) {
      row.classList.remove("border-red-500", "bg-red-900/40", "border-2");
    }
  });

  if (collisions.length > 0) {
    logConsole(`❌ Validation Failed: Multiple manual citadels placed in the same H3 zone. Resolution required.`);
    alert("Save aborted! Multiple manual citadels share the same zone. See highlighted rows.");

    collisions.forEach(templateId => {
      const row = document.getElementById(`row-${templateId}`);
      if (row) {
        row.classList.add("border-red-500", "bg-red-900/40", "border-2");
      }
    });
    return;
  }

  const btn = document.getElementById("btn-apply-changes");
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Applying...';

  try {
    const result = await configManager.applyChanges({
      saveWorldSnapshot: saveWorldSnapshot,
      getSnapshotById: getSnapshotById,
    });

    if (result) {
      logConsole("✅ Citadel config saved to snapshot!");
      renderConfigTable();
      renderTemplateList();
    } else {
      logConsole("❌ Failed to save config.");
    }
  } catch (err) {
    logConsole(`❌ Error applying changes: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
};

// ==================== UTILITY ====================

function logConsole(msg) {
  const con = document.getElementById("console-log");
  if (!con) return;
  const div = document.createElement("div");
  div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
  con.prepend(div);
}

// ==================== SNAPSHOT STATS ====================

function updateSnapshotStats(objects) {
  const statsEl = document.getElementById("snapshot-stats-panel");
  if (!statsEl) return;

  if (!objects || objects.length === 0) {
    statsEl.classList.add("hidden");
    return;
  }

  // Count by type
  let monsters = 0,
    shops = 0,
    vaults = 0,
    castles = 0,
    citadels = 0,
    zones = 0;

  for (const o of objects) {
    const isCitadel =
      o.type === "citadel" ||
      o.icon === "🏯" ||
      (o.name && o.name.includes("Citadel")) ||
      (o.templateId && o.templateId.includes("citadel"));

    if (isCitadel) citadels++;
    else if (o.type === "monster") monsters++;
    else if (o.type === "shop") shops++;
    else if (o.type === "vault") vaults++;
    else if (o.type === "castle") castles++;
    else if (o.type === "zone") zones++;
  }

  // Update DOM
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val.toLocaleString();
  };

  set("stat-monsters", monsters);
  set("stat-shops", shops);
  set("stat-vaults", vaults);
  set("stat-castles", castles);
  set("stat-citadels", citadels);
  set("stat-zones", zones);
  set("stat-total", objects.length);

  statsEl.classList.remove("hidden");
}
