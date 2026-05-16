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
  isAdmin,
  getCurrentUser,
  initFirebase,
} from "../firebase/firebase-service.js";
import {
  distributePointsInZone,
  hashSeed,
} from "../gameplay/zone-generator.js";
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

// Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await requireAdmin(async () => {
    await loadTemplates();
    // Clear previous state (ensure no restore from localStorage as per user request)

    const capacityInput = document.getElementById("gen-capacity");
    if (capacityInput) {
      capacityInput.addEventListener("input", () => {
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
  const list = document.getElementById("template-list");
  list.innerHTML =
    '<div class="text-center text-gray-500 text-xs mt-4">Loading...</div>';

  templates = await getTemplates("monster");
  renderTemplateList();
}

window.createDefaultMonsterTemplates = async function () {
  const defaults = [
    {
      name: "Goblin Scout",
      icon: "👺",
      hp: 30,
      damage: 5,
      xpReward: 15,
      level: 1,
      type: "monster",
      weight: 40,
      tag: "forest",
    },
    {
      name: "Forest Wolf",
      icon: "🐺",
      hp: 50,
      damage: 8,
      xpReward: 25,
      level: 2,
      type: "monster",
      weight: 30,
      tag: "forest",
    },
    {
      name: "Skeleton Warrior",
      icon: "💀",
      hp: 45,
      damage: 7,
      xpReward: 20,
      level: 2,
      type: "monster",
      weight: 20,
      tag: "dungeon",
    },
    {
      name: "Orc Brute",
      icon: "👹",
      hp: 120,
      damage: 15,
      xpReward: 60,
      level: 5,
      type: "monster",
      weight: 10,
      tag: "dungeon",
    },
    {
      name: "Water Slime",
      icon: "💧",
      hp: 25,
      damage: 3,
      xpReward: 10,
      level: 1,
      type: "monster",
      weight: 30,
      tag: "water",
    },
    {
      name: "City Rat",
      icon: "🐀",
      hp: 15,
      damage: 2,
      xpReward: 5,
      level: 1,
      type: "monster",
      weight: 50,
      tag: "city",
    },
    {
      name: "Zombie",
      icon: "🧟",
      hp: 60,
      damage: 10,
      xpReward: 30,
      level: 3,
      type: "monster",
      weight: 15,
      tag: "city",
    },
  ];

  for (const t of defaults) {
    await saveTemplate(t);
  }
  logConsole("Created default monster templates.");
};

const bulk = new BulkActions(deleteTemplate, loadTemplates);

function renderTemplateList() {
  const list = document.getElementById("template-list");
  const search = document.getElementById("template-search").value.toLowerCase();

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
    const isActive = selectedTemplates.has(t.id);
    const activeClass = isActive
      ? "border-blue-500 bg-blue-900/20"
      : "border-gray-700 hover:border-purple-500";

    el.className = `p-2 bg-gray-900 border ${activeClass} rounded cursor-pointer flex justify-between items-center group transition`;
    el.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="text-xl">${t.icon || "👾"}</span>
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
    el.querySelector(".flex.items-center.gap-2").prepend(
      bulk.createCheckbox(t.id),
    );
    // Add click listener for selection (logic for distribution later)
    el.addEventListener("click", (e) => {
      if (
        !e.target.closest("button") &&
        !e.target.closest("input[type=checkbox]")
      )
        toggleTemplateSelection(t);
    });
    list.appendChild(el);
  });

  updateDistributionTable();
}

window.openTemplateModal = () => {
  currentEditId = null;
  document.getElementById("tpl-id").value = "";
  document.getElementById("btn-delete").classList.add("hidden");

  // Clear fields
  ["name", "icon", "hp", "dmg", "def", "xp", "weight", "loot"].forEach(
    (id) => (document.getElementById(`tpl-${id}`).value = ""),
  );
  document.getElementById("tpl-hp").value = 100;

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
  document.getElementById("tpl-hp").value = t.hp;
  document.getElementById("tpl-dmg").value = t.damage || 10;
  document.getElementById("tpl-def").value = t.defense || 0;
  document.getElementById("tpl-xp").value = t.xpReward || 50;
  document.getElementById("tpl-weight").value = t.weight || 10;
  document.getElementById("tpl-tag").value = t.tag || "generic";
  document.getElementById("tpl-loot").value = (t.loot || []).join(", ");

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
    id: undefined, // Force new ID generation
    name: copyName,
  };

  delete newTemplate.id; // Make sure ID is cleared

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
    icon: document.getElementById("tpl-icon").value,
    hp: parseInt(document.getElementById("tpl-hp").value),
    maxHp: parseInt(document.getElementById("tpl-hp").value),
    damage: parseInt(document.getElementById("tpl-dmg").value),
    defense: parseInt(document.getElementById("tpl-def").value),
    xpReward: parseInt(document.getElementById("tpl-xp").value),
    weight: parseInt(document.getElementById("tpl-weight").value),
    tag: document.getElementById("tpl-tag").value,
    loot: document
      .getElementById("tpl-loot")
      .value.split(",")
      .map((s) => s.trim())
      .filter((s) => s),
    type: "monster",
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

// ==================== STATE PERSISTENCE ====================

function saveState() {
  // Disabled persistence as per user request
}

function restoreState() {
  try {
    const saved = localStorage.getItem("admin_monsters_state");
    if (!saved) return;

    const state = JSON.parse(saved);

    // Restore selected templates
    if (state.selectedTemplates) {
      selectedTemplates = new Set(state.selectedTemplates);
      updateDistributionTable();
    }

    // Restore console log
    if (state.consoleLog) {
      document.getElementById("console-log").innerHTML = state.consoleLog;
    }

    // Restore form values
    if (state.capacity)
      document.getElementById("gen-capacity").value = state.capacity;
  } catch (e) {
    console.error("Failed to restore state:", e);
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
  const table = document.getElementById("distribution-table");
  const totalCap =
    parseInt(document.getElementById("gen-capacity").value) || 1000;

  table.innerHTML = "";

  if (selectedTemplates.size === 0) {
    table.innerHTML =
      '<tr><td colspan="4" class="p-4 text-center text-gray-500">Click templates in the sidebar to add them here.</td></tr>';
    document.getElementById("total-weight").textContent = "0%";
    document.getElementById("total-count").textContent = "0";
    return;
  }

  let totalWeight = 0;

  // First pass to get total weight
  Array.from(selectedTemplates).forEach((id) => {
    const t = templates.find((temp) => temp.id === id);
    if (t) totalWeight += t.weight || 0;
  });

  // Second pass to render and calculate counts
  Array.from(selectedTemplates).forEach((id) => {
    const t = templates.find((temp) => temp.id === id);
    if (!t) return;

    // Relative weight distribution like in shops/castles
    const count =
      totalWeight > 0 ? Math.round(totalCap * (t.weight / totalWeight)) : 0;

    const row = document.createElement("tr");
    row.className = "border-b border-gray-800 hover:bg-gray-800/50";
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

  document.getElementById("total-weight").textContent = `${totalWeight}%`;
  document.getElementById("total-count").textContent = totalCap;
  document.getElementById("total-weight").className =
    totalWeight === 100
      ? "px-4 py-2 text-center text-green-400"
      : "px-4 py-2 text-center text-yellow-500";

  const warning = document.getElementById("dist-warning");
  if (totalWeight !== 100) warning.classList.remove("hidden");
  else warning.classList.add("hidden");
}

window.updateWeight = (id, val) => {
  const t = templates.find((temp) => temp.id === id);
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
  const selector = document.getElementById("gen-template");
  if (!selector) return;

  // Check admin status explicitly for debugging
  if (!isAdmin()) {
    logConsole("⚠️ skipping snapshot load: Waiting for admin role...");
    // Retry once after short delay if strictly needed, but better to rely on button
    return;
  }

  const currentVal = selector.value;

  // Keep the "New" option
  // Reset but keep "New"
  const newOpt = document.createElement("option");
  newOpt.value = "new";
  newOpt.text = "+ Create New Map Template";

  selector.innerHTML = "";
  selector.appendChild(newOpt);

  logConsole("🔄 Loading map templates...");

  try {
    const snaps = await getWorldSnapshots();

    // Also load local snapshots (from IndexedDB, created by Global World generation)
    let localSnaps = [];
    try {
      const { LocalSnapshotsManager } = await import("./local-snapshots.js");
      localSnaps = await LocalSnapshotsManager.getAll();
    } catch (e) {
      console.warn("Could not load local snapshots:", e);
    }
    const allSnaps = [...localSnaps, ...snaps];
    logConsole(
      `📦 Found ${allSnaps.length} snapshots total (${localSnaps.length} local + ${snaps.length} Firestore).`,
    );

    allSnaps.forEach((snap) => {
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

    // Restore selection if possible
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

window.calculateDistribution = () => {
  updateDistributionTable(); // Refresh numbers
  logConsole("Distribution updated based on current capacity.");
};

window.startGeneration = async (overwrite = true) => {
  const capacity = parseInt(document.getElementById("gen-capacity").value);
  const targetTemplateId = document.getElementById("gen-template").value;

  // Mode Logging
  logConsole(
    overwrite
      ? "🗑️ Mode: Create / Delete + Create (Replenish Monsters)"
      : "➕ Mode: Add if exist",
  );

  // Validate Weights
  let currentWeight = 0;
  selectedTemplates.forEach((id) => {
    const t = templates.find((temp) => temp.id === id);
    if (t) currentWeight += t.weight;
  });
  if (currentWeight !== 100) {
    if (!confirm(`Total weight is ${currentWeight}% (not 100%). Continue?`))
      return;
  }
  if (selectedTemplates.size === 0) {
    alert("Please select at least one monster template.");
    return;
  }

  let snapName = "";
  let finalId = null;
  let existingObjects = [];
  const { getSnapshotById } = await import("../firebase/firebase-service.js");

  if (targetTemplateId === "new") {
    snapName = prompt(
      "Enter a name for this new Map Template:",
      `snapshot_${new Date().toLocaleDateString()}`,
    );
    if (!snapName) return;
  } else {
    const selector = document.getElementById("gen-template");
    snapName = selector.options[selector.selectedIndex].text
      .split(" (")[0]
      .replace(/^..?\s*/, "")
      .trim();
    finalId = targetTemplateId;

    // Fetch existing
    let existingSnap;
    if (finalId && finalId.startsWith("local_")) {
      // Load from local IndexedDB
      try {
        const { LocalSnapshotsManager } = await import("./local-snapshots.js");
        existingSnap = await LocalSnapshotsManager.getById(finalId);
      } catch (e) {
        console.error("Failed to load local snapshot:", e);
      }
    } else {
      existingSnap = await getSnapshotById(finalId);
    }
    let allSavedObjects = [];
    if (existingSnap) {
      if (existingSnap.chunked && !existingSnap.objects) {
        const { loadSnapshotChunks } =
          await import("../firebase/firebase-service.js");
        allSavedObjects = await loadSnapshotChunks(finalId);
      } else {
        allSavedObjects = existingSnap.objects || [];
      }

      if (!overwrite) {
        // MERGE: Add new to existing
        console.log("Merging: Keeping all existing objects.");
        existingObjects = allSavedObjects;
      } else {
        // RELOAD: Partition objects: Keep infrastructure, drop monsters
        const infrastructure = allSavedObjects.filter(
          (o) =>
            o.type === "shop" ||
            o.type === "castle" ||
            o.icon === "🏯" ||
            o.icon === "🏪" ||
            (o.name &&
              (o.name.includes("Citadel") || o.name.includes("Castle"))) ||
            o.templateId?.includes("citadel"),
        );

        existingObjects = infrastructure;
        console.log(
          `🛡️ RELOAD: Preserved ${infrastructure.length} infrastructure objects. Removed monsters.`,
        );
      }
    }
  }

  // 1. Pre-detect Citadels to handle balanced distribution
  const citadels = existingObjects
    .filter(
      (o) =>
        o.icon === "🏯" ||
        (o.name && o.name.includes("Citadel")) ||
        o.templateId?.includes("citadel"),
    )
    .map((c, idx) => ({
      ...c,
      powerMultiplier: c.powerMultiplier || 1,
      id: c.id || c.name || `citadel_${c.lat.toFixed(4)}_${c.lng.toFixed(4)}`,
    }));

  // Need at least 2 citadels for distance-based zone ownership
  if (citadels.length < 2) {
    alert(
      `Need at least 2 citadels in the snapshot (found ${citadels.length}). Generate citadels first in the Citadels tab.`,
    );
    return;
  }

  logConsole(
    `🏰 Found <b>${citadels.length}</b> citadels. Computing zones via distance-based ownership (no stored zones needed)...`,
  );

  // Generate Points using distributePointsInZone — computes zones on-the-fly from citadel positions
  let generatedMonsters = [];

  const selectionList = Array.from(selectedTemplates)
    .map((id) => templates.find((t) => t.id === id))
    .filter(Boolean);
  const totalWeight = selectionList.reduce(
    (sum, t) => sum + (t.weight || 0),
    0,
  );

  const baseSeed = hashSeed(citadels[0]?.cityId || "default");

  logConsole(
    `⚖️ Distributing ${capacity} monsters per zone across ${citadels.length} zones (Total: ${citadels.length * capacity})...`,
  );

  for (let i = 0; i < citadels.length; i++) {
    const citadel = citadels[i];
    const zoneSeed = baseSeed + i * 7919; // prime offset per zone
    const zoneCityId = citadel.cityId || "unknown";

    // distributePointsInZone uses distance-based ownership to evenly fill the zone
    const positions = distributePointsInZone(
      citadel,
      citadels,
      capacity,
      zoneSeed,
    );

    // Assign templates by weight to positions
    const zoneMonsters = [];
    if (positions.length > 0 && selectionList.length > 0) {
      // Build cumulative weight array for O(log n) selection
      const cumWeights = [];
      let cumTotal = 0;
      for (const t of selectionList) {
        cumTotal += t.weight || 1;
        cumWeights.push(cumTotal);
      }

      // Simple seeded random for template assignment
      let seed = zoneSeed + 1;
      const rng = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      for (const pos of positions) {
        const roll = rng() * cumTotal;
        let lo = 0,
          hi = cumWeights.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cumWeights[mid] <= roll) lo = mid + 1;
          else hi = mid;
        }
        const t = selectionList[lo];
        zoneMonsters.push({
          type: "monster",
          lat: pos.lat,
          lng: pos.lng,
          cityId: zoneCityId,
          zoneId: citadel.id,
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
          respawnAt: null,
        });
      }
    }

    logConsole(
      `📍 Zone <b>${citadel.id.split("_").pop()}</b>: ${zoneMonsters.length} monsters (${positions.length} positions)`,
    );
    generatedMonsters.push(...zoneMonsters);
  }
  logConsole(
    `✅ DISTRIBUTION COMPLETE: Total ${generatedMonsters.length} monsters across ${citadels.length} zones.`,
  );

  if (generatedMonsters.length === 0) {
    logConsole("⚠️ No monsters generated.");
    return;
  }

  // 3. Save Snapshot
  const mergedObjects = [...existingObjects, ...generatedMonsters];
  logConsole(
    `💾 Saving Template "${snapName}" (${mergedObjects.length} objects)...`,
  );
  // Determine actual type based on content to prevent accidental full-world wipes
  const hasMonsters = mergedObjects.some((o) => o.type === "monster");
  const hasInfrastructure = mergedObjects.some(
    (o) => o.type === "shop" || o.type === "castle",
  );
  const finalType =
    hasMonsters && hasInfrastructure
      ? "mixed"
      : hasMonsters
        ? "monster"
        : "infrastructure";

  const snapshotData = {
    id: finalId,
    name: snapName,
    type: finalType,
    objects: mergedObjects,
  };

  // Optimization: Strip identical/redundant fields from objects to save bandwidth/space
  snapshotData.objects = mergedObjects.map((o) => {
    // We only need the core data, the rest can be reconstructed from templates or logic
    const { createdBy, createdAt, ...core } = o;
    return core;
  });

  logConsole(
    `💾 Optimizing ${snapshotData.objects.length} objects for storage...`,
  );
  const success = await saveWorldSnapshot(snapshotData);

  if (success) {
    logConsole("✅ Template Saved!");
    alert("Template saved successfully!");
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
  const selectionList = Array.from(selectedTemplates)
    .map((id) => templates.find((t) => t.id === id))
    .filter(Boolean);

  // Normalize weights if not 100%
  const totalWeight = selectionList.reduce(
    (sum, t) => sum + (t.weight || 0),
    0,
  );

  // Generate grid
  // Logic adapted from monsters.js but dynamic
  const radiusDeg = city.id === "berlin" ? 0.3 : 0.1; // Rough approximation
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
        type: "monster",
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
        respawnAt: null,
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

// Utility
function logConsole(msg) {
  const con = document.getElementById("console-log");
  if (!con) return;
  const div = document.createElement("div");
  div.innerHTML = `<span class="text-gray-500">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
  con.prepend(div);
}

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
    if (densityInput && activeRecipe.densityRatios?.monster) {
      densityInput.value = activeRecipe.densityRatios.monster;
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

  const rules = getProceduralRulesForType(activeRecipe, "monsters");
  if (rules.templates.length === 0) {
    table.innerHTML =
      '<tr><td colspan="4" class="p-4 text-center text-gray-500 italic">No monster templates in recipe whitelist. Add templates below.</td></tr>';
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
    (activeRecipe?.layers?.monsters?.templates || []).map((t) => t.templateId),
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

  activeRecipe = addTemplateToLayer(
    activeRecipe,
    "monsters",
    templateId,
    weight,
  );
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
  activeRecipe = removeTemplateFromLayer(activeRecipe, "monsters", templateId);
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
    "monsters",
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
    parseInt(document.getElementById("proc-density").value) || 1000;
  try {
    await updateRecipe(activeRecipe.id, {
      densityRatios: { ...activeRecipe.densityRatios, monster: density },
      layers: activeRecipe.layers,
    });
    activeRecipe.densityRatios.monster = density;
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
  select.innerHTML = '<option value="">Select a monster template...</option>';
  templates.forEach((t) => {
    select.innerHTML += `<option value="${t.id}">${t.icon || ""} ${t.name} (HP:${t.hp || "?"} DMG:${t.dmg || t.damage || "?"})</option>`;
  });
  select.onchange = () => {
    const t = templates.find((tp) => tp.id === select.value);
    const preview = document.getElementById("manual-template-preview");
    if (t && preview) {
      preview.innerHTML = `<div class="text-white font-bold">${t.icon || ""} ${t.name}</div>
        <div class="text-gray-400 mt-1">HP: ${t.hp || "?"} | DMG: ${t.dmg || t.damage || "?"} | DEF: ${t.defense || 0} | XP: ${t.xpReward || t.xp || 0}</div>`;
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
    "monster",
    templateId,
    {
      name: template.name,
      icon: template.icon,
      hp: template.hp,
      damage: template.dmg || template.damage,
      defense: template.defense,
      xpReward: template.xpReward || template.xp,
      loot: template.loot || [],
      level: template.level || 1,
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
      `<span class="text-green-400">Placed manual monster: ${entity.name} at (${lat}, ${lng})</span>`,
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
      where("type", "==", "monster"),
      where("isManual", "==", true),
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      listEl.innerHTML =
        '<div class="text-gray-500">No manual monsters found.</div>';
      return;
    }
    listEl.innerHTML = snap.docs
      .map((doc) => {
        const d = doc.data();
        return `<div class="flex justify-between items-center p-1 hover:bg-gray-800 rounded">
        <span>${d.icon || "👾"} ${d.name || d.templateId} (${d.lat?.toFixed(4)}, ${d.lng?.toFixed(4)})</span>
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
    const rules = getProceduralRulesForType(activeRecipe, "monsters");

    // Get manual objects from Firestore
    const { collection, query, where, getDocs } =
      await import("https://www.gstatic.com/firebasejs/11.7.1/firebase-firestore.js");
    const { getDB } = await import("../firebase/firebase-service.js");
    const db = getDB();
    const q = query(
      collection(db, "spawned_objects"),
      where("type", "==", "monster"),
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
