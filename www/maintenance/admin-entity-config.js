/**
 * EntityConfigManager — shared module for entity config management
 * across all 5 admin pages (monsters, shops, vaults, castles, citadels).
 *
 * Deep module: simple public interface, significant internal logic.
 *
 * @module admin-entity-config
 */

export class EntityConfigManager {
  /**
   * @param {'monsters'|'shops'|'vaults'|'castles'|'citadels'} entityType
   * @param {object} [options]
   * @param {string} [options.templateType] - filter key for templates
   * @param {string} [options.accentColor] - UI accent color
   * @param {string} [options.tableId] - DOM id for config table
   */
  constructor(entityType, options = {}) {
    this.entityType = entityType;
    this.templateType = options.templateType || entityType;
    this.accentColor = options.accentColor || "gray";
    this.tableId = options.tableId || `${entityType}-config-table`;

    /** @type {Array<{templateId: string, count: number, type: string}>} */
    this._savedConfig = [];
    /** @type {Array<{templateId: string, count: number, type: string, lat?: number, lng?: number}>} */
    this._workingConfig = [];
    /** @type {string|null} */
    this._snapshotId = null;
  }

  /**
   * Compute visual diff between saved and working config.
   * Pure function — no side effects, fully testable.
   *
   * @param {Array} savedConfig
   * @param {Array} workingConfig
   * @returns {Array<{templateId: string, count: number, type: string, status: string, delta: number}>}
   */
  computeDiff(savedConfig, workingConfig) {
    const saved = savedConfig || [];
    const working = workingConfig || [];

    if (saved.length === 0 && working.length === 0) {
      return [];
    }

    const savedMap = new Map();
    for (const entry of saved) {
      savedMap.set(entry.templateId, entry);
    }

    const result = [];
    const seen = new Set();

    // Process working config entries
    for (const entry of working) {
      seen.add(entry.templateId);
      const savedEntry = savedMap.get(entry.templateId);

      if (!savedEntry) {
        // New entry — not in saved
        result.push({
          templateId: entry.templateId,
          count: entry.count,
          type: entry.type || "generated",
          status: "added",
          delta: entry.count,
        });
      } else if (entry.count === 0 && savedEntry.count > 0) {
        // Removed — count set to 0
        result.push({
          templateId: entry.templateId,
          count: entry.count,
          type: entry.type || savedEntry.type || "generated",
          status: "removed",
          delta: -savedEntry.count,
        });
      } else if (entry.count > savedEntry.count) {
        result.push({
          templateId: entry.templateId,
          count: entry.count,
          type: entry.type || savedEntry.type || "generated",
          status: "increased",
          delta: entry.count - savedEntry.count,
        });
      } else if (entry.count < savedEntry.count) {
        result.push({
          templateId: entry.templateId,
          count: entry.count,
          type: entry.type || savedEntry.type || "generated",
          status: "decreased",
          delta: entry.count - savedEntry.count,
        });
      } else {
        result.push({
          templateId: entry.templateId,
          count: entry.count,
          type: entry.type || savedEntry.type || "generated",
          status: "unchanged",
          delta: 0,
        });
      }
    }

    // Process saved entries not in working (removed)
    for (const entry of saved) {
      if (!seen.has(entry.templateId)) {
        result.push({
          templateId: entry.templateId,
          count: 0,
          type: entry.type || "generated",
          status: "removed",
          delta: -entry.count,
        });
      }
    }

    return result;
  }

  /**
   * Add a template to the working config table.
   * If already present, does nothing.
   *
   * @param {{id: string, name?: string}} template
   */
  addToTable(template) {
    const templateId = template.id || template.templateId;
    const exists = this._workingConfig.find((e) => e.templateId === templateId);
    if (exists) return;

    this._workingConfig.push({
      templateId,
      count: 0,
      type: "generated",
    });
  }

  /**
   * Remove a template from the working config table.
   * - If entry was in saved config: set count to 0 (status becomes 'removed')
   * - If entry is new (not in saved): remove entirely
   *
   * @param {string} templateId
   */
  removeFromTable(templateId) {
    const savedEntry = this._savedConfig.find(
      (e) => e.templateId === templateId,
    );

    if (savedEntry) {
      // Existing entry — mark as removed by setting count to 0
      const workingEntry = this._workingConfig.find(
        (e) => e.templateId === templateId,
      );
      if (workingEntry) {
        workingEntry.count = 0;
      }
    } else {
      // New entry — remove entirely
      this._workingConfig = this._workingConfig.filter(
        (e) => e.templateId !== templateId,
      );
    }
  }

  /**
   * Load config from a snapshot's entityConfig field.
   *
   * @param {string} snapshotId
   * @param {object} deps - injected dependencies
   * @param {function} deps.getSnapshotById - async (id) => snapshot
   */
  async onTemplateSelected(snapshotId, deps = {}) {
    this._snapshotId = snapshotId;
    const getSnapshotById = deps.getSnapshotById;
    if (!getSnapshotById) {
      throw new Error("getSnapshotById dependency is required");
    }

    const snapshot = await getSnapshotById(snapshotId);
    if (!snapshot) {
      this._savedConfig = [];
      this._workingConfig = [];
      return;
    }

    const entityConfig = snapshot.entityConfig || {};
    const config = entityConfig[this.entityType] || [];

    // Deep-clone to avoid mutation
    this._savedConfig = JSON.parse(JSON.stringify(config));
    this._workingConfig = JSON.parse(JSON.stringify(config));
  }

  /**
   * Build clean config array for saving to Firestore.
   * Filters out removed new entries (count === 0 and not in saved).
   *
   * @param {object} deps - injected dependencies
   * @param {function} deps.saveWorldSnapshot - async (data) => boolean
   * @param {function} [deps.getSnapshotById] - async (id) => snapshot
   * @returns {Promise<boolean>}
   */
  async applyChanges(deps = {}) {
    if (!this._snapshotId) return false;

    const saveWorldSnapshot = deps.saveWorldSnapshot;
    const getSnapshotById = deps.getSnapshotById;
    if (!saveWorldSnapshot) {
      throw new Error("saveWorldSnapshot dependency is required");
    }

    // Build clean config: filter out entries with count 0 that were new
    const savedIds = new Set(this._savedConfig.map((e) => e.templateId));
    const cleanConfig = this._workingConfig.filter((entry) => {
      // Keep if: has count > 0, OR was in saved (even with count 0 means removal signal)
      if (entry.count > 0) return true;
      if (savedIds.has(entry.templateId) && entry.count === 0) return false;
      return false;
    });

    // Load existing snapshot to merge
    let existingSnapshot = {};
    if (getSnapshotById) {
      existingSnapshot = (await getSnapshotById(this._snapshotId)) || {};
    }

    const existingEntityConfig = existingSnapshot.entityConfig || {};

    const updatedSnapshot = {
      ...existingSnapshot,
      id: this._snapshotId,
      entityConfig: {
        ...existingEntityConfig,
        [this.entityType]: cleanConfig,
      },
    };

    const result = await saveWorldSnapshot(updatedSnapshot);

    if (result) {
      // Update saved config to match what we just saved
      this._savedConfig = JSON.parse(JSON.stringify(cleanConfig));
      this._workingConfig = JSON.parse(JSON.stringify(cleanConfig));
    }

    return result;
  }

  /**
   * Render config table HTML with color-coded rows.
   *
   * @param {Array} [templates] - available templates for name resolution
   * @returns {string} HTML table rows
   */
  renderConfigTable(templates = []) {
    const diff = this.computeDiff(this._savedConfig, this._workingConfig);
    const templateMap = new Map();
    for (const t of templates) {
      templateMap.set(t.id || t.templateId, t);
    }

    if (diff.length === 0) {
      return '<tr><td colspan="5" class="text-center text-gray-500 py-4">No entities configured</td></tr>';
    }

    const colorMap = {
      unchanged: "bg-gray-800",
      added: "bg-blue-900/50 border-l-2 border-blue-400",
      removed: "bg-red-900/50 border-l-2 border-red-400",
      increased: "bg-green-900/50 border-l-2 border-green-400",
      decreased: "bg-red-900/50 border-l-2 border-red-400",
    };

    return diff
      .map((entry) => {
        const template = templateMap.get(entry.templateId);
        const name = template
          ? template.name || entry.templateId
          : entry.templateId;
        const icon = template ? template.icon || "\u2753" : "\u2753";
        const colorClass = colorMap[entry.status] || "bg-gray-800";
        const deltaDisplay =
          entry.delta > 0
            ? `<span class="text-green-400">+${entry.delta}</span>`
            : entry.delta < 0
              ? `<span class="text-red-400">${entry.delta}</span>`
              : "";

        return `<tr class="${colorClass}">
          <td class="px-3 py-2">${icon} ${name}</td>
          <td class="px-3 py-2 text-center">${entry.count}</td>
          <td class="px-3 py-2 text-center">${entry.type}</td>
          <td class="px-3 py-2 text-center">${deltaDisplay}</td>
          <td class="px-3 py-2 text-center">${entry.status}</td>
        </tr>`;
      })
      .join("\n");
  }

  /**
   * Load world snapshots and return them for dropdown population.
   *
   * @param {object} deps - injected dependencies
   * @param {function} deps.getWorldSnapshots - async () => Array
   * @returns {Promise<Array>}
   */
  async loadWorldSnapshots(deps = {}) {
    const getWorldSnapshots = deps.getWorldSnapshots;
    if (!getWorldSnapshots) {
      throw new Error("getWorldSnapshots dependency is required");
    }
    return await getWorldSnapshots();
  }

  /**
   * Write timestamped message to console panel.
   *
   * @param {string} msg
   * @param {object} [deps] - injected dependencies
   * @param {HTMLElement} [deps.consoleElement] - DOM element for console output
   */
  logConsole(msg, deps = {}) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;

    if (deps.consoleElement) {
      const div = document.createElement("div");
      div.textContent = formatted;
      deps.consoleElement.appendChild(div);
      deps.consoleElement.scrollTop = deps.consoleElement.scrollHeight;
    }

    console.log(formatted);
    return formatted;
  }

  // ── Getters for test access ──
  get savedConfig() {
    return this._savedConfig;
  }
  get workingConfig() {
    return this._workingConfig;
  }
  get snapshotId() {
    return this._snapshotId;
  }
}
