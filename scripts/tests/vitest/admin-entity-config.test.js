import { describe, it, expect } from "vitest";
import { EntityConfigManager } from "@www/maintenance/admin-entity-config.js";

// ── Cycle 1: Tracer Bullet — constructor + empty diff ──────────────
describe("EntityConfigManager", () => {
  describe("constructor", () => {
    it("creates an instance with entityType and options", () => {
      const mgr = new EntityConfigManager("monsters", {
        templateType: "monster",
        accentColor: "purple",
        tableId: "monster-config-table",
      });
      expect(mgr.entityType).toBe("monsters");
    });
  });

  describe("computeDiff", () => {
    it("returns empty array when both saved and working configs are empty", () => {
      const mgr = new EntityConfigManager("monsters");
      const diff = mgr.computeDiff([], []);
      expect(diff).toEqual([]);
    });

    // ── Cycle 2: added entries ──────────────────────────────────────
    it("marks entries in working but not in saved as 'added'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [];
      const working = [{ templateId: "goblin", count: 50, type: "generated" }];
      const diff = mgr.computeDiff(saved, working);
      expect(diff).toHaveLength(1);
      expect(diff[0].status).toBe("added");
      expect(diff[0].delta).toBe(50);
      expect(diff[0].templateId).toBe("goblin");
    });

    // ── Cycle 3: removed entries (count set to 0) ──────────────────
    it("marks entries with count 0 in working (was >0 in saved) as 'removed'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [{ templateId: "goblin", count: 50, type: "generated" }];
      const working = [{ templateId: "goblin", count: 0, type: "generated" }];
      const diff = mgr.computeDiff(saved, working);
      expect(diff).toHaveLength(1);
      expect(diff[0].status).toBe("removed");
      expect(diff[0].delta).toBe(-50);
    });

    // ── Cycle 4: removed entries (missing from working entirely) ───
    it("marks entries in saved but missing from working as 'removed'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [{ templateId: "wolf", count: 30, type: "generated" }];
      const working = [];
      const diff = mgr.computeDiff(saved, working);
      expect(diff).toHaveLength(1);
      expect(diff[0].status).toBe("removed");
      expect(diff[0].delta).toBe(-30);
      expect(diff[0].count).toBe(0);
    });

    // ── Cycle 5: increased count ───────────────────────────────────
    it("marks entries with higher count in working as 'increased'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [{ templateId: "goblin", count: 50, type: "generated" }];
      const working = [{ templateId: "goblin", count: 150, type: "generated" }];
      const diff = mgr.computeDiff(saved, working);
      expect(diff[0].status).toBe("increased");
      expect(diff[0].delta).toBe(100);
    });

    // ── Cycle 6: decreased count ──────────────────────────────────
    it("marks entries with lower count in working as 'decreased'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [{ templateId: "goblin", count: 100, type: "generated" }];
      const working = [{ templateId: "goblin", count: 40, type: "generated" }];
      const diff = mgr.computeDiff(saved, working);
      expect(diff[0].status).toBe("decreased");
      expect(diff[0].delta).toBe(-60);
    });

    // ── Cycle 7: unchanged entries ─────────────────────────────────
    it("marks entries with same count as 'unchanged'", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [{ templateId: "goblin", count: 50, type: "generated" }];
      const working = [{ templateId: "goblin", count: 50, type: "generated" }];
      const diff = mgr.computeDiff(saved, working);
      expect(diff[0].status).toBe("unchanged");
      expect(diff[0].delta).toBe(0);
    });

    // ── Cycle 8: mixed diff ────────────────────────────────────────
    it("handles complex mixed diff correctly", () => {
      const mgr = new EntityConfigManager("monsters");
      const saved = [
        { templateId: "goblin", count: 50, type: "generated" },
        { templateId: "wolf", count: 30, type: "generated" },
        { templateId: "dragon", count: 5, type: "manual" },
      ];
      const working = [
        { templateId: "goblin", count: 50, type: "generated" }, // unchanged
        { templateId: "wolf", count: 0, type: "generated" }, // removed
        { templateId: "skeleton", count: 20, type: "generated" }, // added
        // dragon missing -> removed
      ];
      const diff = mgr.computeDiff(saved, working);
      expect(diff).toHaveLength(4);

      const goblin = diff.find((d) => d.templateId === "goblin");
      const wolf = diff.find((d) => d.templateId === "wolf");
      const skeleton = diff.find((d) => d.templateId === "skeleton");
      const dragon = diff.find((d) => d.templateId === "dragon");

      expect(goblin.status).toBe("unchanged");
      expect(wolf.status).toBe("removed");
      expect(skeleton.status).toBe("added");
      expect(dragon.status).toBe("removed");
      expect(dragon.delta).toBe(-5);
    });

    // ── Cycle 9: null/undefined inputs ─────────────────────────────
    it("handles null/undefined inputs gracefully", () => {
      const mgr = new EntityConfigManager("monsters");
      const diff = mgr.computeDiff(null, undefined);
      expect(diff).toEqual([]);
    });
  });

  // ── Cycle 10: addToTable ──────────────────────────────────────────
  describe("addToTable", () => {
    it("adds a new entry with count:0 and type:'generated'", () => {
      const mgr = new EntityConfigManager("monsters");
      mgr.addToTable({ id: "goblin", name: "Goblin" });
      expect(mgr.workingConfig).toHaveLength(1);
      expect(mgr.workingConfig[0]).toEqual({
        templateId: "goblin",
        count: 0,
        type: "generated",
      });
    });

    it("does nothing if template already present", () => {
      const mgr = new EntityConfigManager("monsters");
      mgr.addToTable({ id: "goblin" });
      mgr.addToTable({ id: "goblin" });
      expect(mgr.workingConfig).toHaveLength(1);
    });

    it("supports templateId property as well as id", () => {
      const mgr = new EntityConfigManager("shops");
      mgr.addToTable({ templateId: "blacksmith" });
      expect(mgr.workingConfig[0].templateId).toBe("blacksmith");
    });
  });

  // ── Cycle 11: removeFromTable ─────────────────────────────────────
  describe("removeFromTable", () => {
    it("removes new entries (not in saved) entirely", () => {
      const mgr = new EntityConfigManager("monsters");
      mgr.addToTable({ id: "goblin" });
      expect(mgr.workingConfig).toHaveLength(1);
      mgr.removeFromTable("goblin");
      expect(mgr.workingConfig).toHaveLength(0);
    });

    it("sets count to 0 for entries that exist in saved config", () => {
      const mgr = new EntityConfigManager("monsters");
      // Simulate loaded state
      mgr._savedConfig = [
        { templateId: "goblin", count: 50, type: "generated" },
      ];
      mgr._workingConfig = [
        { templateId: "goblin", count: 50, type: "generated" },
      ];
      mgr.removeFromTable("goblin");
      expect(mgr.workingConfig).toHaveLength(1);
      expect(mgr.workingConfig[0].count).toBe(0);
    });
  });

  // ── Cycle 12: onTemplateSelected ──────────────────────────────────
  describe("onTemplateSelected", () => {
    it("loads entityConfig from snapshot and populates saved + working config", async () => {
      const mgr = new EntityConfigManager("monsters");
      const mockSnapshot = {
        id: "snap_123",
        entityConfig: {
          monsters: [
            { templateId: "goblin", count: 50, type: "generated" },
            { templateId: "wolf", count: 30, type: "generated" },
          ],
        },
      };
      const mockGetSnapshot = async (id) =>
        id === "snap_123" ? mockSnapshot : null;

      await mgr.onTemplateSelected("snap_123", {
        getSnapshotById: mockGetSnapshot,
      });

      expect(mgr.savedConfig).toHaveLength(2);
      expect(mgr.workingConfig).toHaveLength(2);
      expect(mgr.snapshotId).toBe("snap_123");
    });

    it("handles missing entityConfig gracefully", async () => {
      const mgr = new EntityConfigManager("shops");
      const mockGetSnapshot = async () => ({
        id: "snap_1",
        name: "Old snapshot",
      });
      await mgr.onTemplateSelected("snap_1", {
        getSnapshotById: mockGetSnapshot,
      });
      expect(mgr.savedConfig).toEqual([]);
      expect(mgr.workingConfig).toEqual([]);
    });

    it("handles null snapshot gracefully", async () => {
      const mgr = new EntityConfigManager("vaults");
      const mockGetSnapshot = async () => null;
      await mgr.onTemplateSelected("snap_none", {
        getSnapshotById: mockGetSnapshot,
      });
      expect(mgr.savedConfig).toEqual([]);
      expect(mgr.workingConfig).toEqual([]);
    });
  });

  // ── Cycle 13: applyChanges config output ──────────────────────────
  describe("applyChanges", () => {
    it("filters out removed entries (count 0) and saves clean config", async () => {
      const mgr = new EntityConfigManager("monsters");
      mgr._snapshotId = "snap_123";
      mgr._savedConfig = [
        { templateId: "goblin", count: 50, type: "generated" },
        { templateId: "wolf", count: 30, type: "generated" },
      ];
      mgr._workingConfig = [
        { templateId: "goblin", count: 80, type: "generated" }, // increased
        { templateId: "wolf", count: 0, type: "generated" }, // removed
        { templateId: "skeleton", count: 20, type: "generated" }, // new
      ];

      let savedData = null;
      const mockSave = async (data) => {
        savedData = data;
        return true;
      };
      const mockGet = async () => ({ id: "snap_123", entityConfig: {} });

      await mgr.applyChanges({
        saveWorldSnapshot: mockSave,
        getSnapshotById: mockGet,
      });

      const monstersConfig = savedData.entityConfig.monsters;
      expect(monstersConfig).toHaveLength(2); // goblin (80) + skeleton (20), wolf removed
      expect(monstersConfig.find((e) => e.templateId === "goblin").count).toBe(
        80,
      );
      expect(
        monstersConfig.find((e) => e.templateId === "skeleton").count,
      ).toBe(20);
      expect(
        monstersConfig.find((e) => e.templateId === "wolf"),
      ).toBeUndefined();
    });

    it("also removes new entries with count 0", async () => {
      const mgr = new EntityConfigManager("shops");
      mgr._snapshotId = "snap_456";
      mgr._savedConfig = [];
      mgr._workingConfig = [
        { templateId: "blacksmith", count: 0, type: "generated" }, // new but count 0
      ];

      let savedData = null;
      const mockSave = async (data) => {
        savedData = data;
        return true;
      };
      const mockGet = async () => ({ id: "snap_456" });

      await mgr.applyChanges({
        saveWorldSnapshot: mockSave,
        getSnapshotById: mockGet,
      });

      expect(savedData.entityConfig.shops).toHaveLength(0);
    });

    it("returns false when no snapshot is selected", async () => {
      const mgr = new EntityConfigManager("monsters");
      const result = await mgr.applyChanges({
        saveWorldSnapshot: async () => true,
      });
      expect(result).toBe(false);
    });

    it("preserves manual entries with coordinates", async () => {
      const mgr = new EntityConfigManager("castles");
      mgr._snapshotId = "snap_789";
      mgr._savedConfig = [];
      mgr._workingConfig = [
        {
          templateId: "keep",
          count: 1,
          type: "manual",
          lat: 52.52,
          lng: 13.405,
        },
      ];

      let savedData = null;
      const mockSave = async (data) => {
        savedData = data;
        return true;
      };
      const mockGet = async () => ({ id: "snap_789" });

      await mgr.applyChanges({
        saveWorldSnapshot: mockSave,
        getSnapshotById: mockGet,
      });

      const entry = savedData.entityConfig.castles[0];
      expect(entry.type).toBe("manual");
      expect(entry.lat).toBe(52.52);
      expect(entry.lng).toBe(13.405);
    });
  });

  // ── Cycle 14: renderConfigTable ───────────────────────────────────
  describe("renderConfigTable", () => {
    it("returns empty message when no config", () => {
      const mgr = new EntityConfigManager("monsters");
      const html = mgr.renderConfigTable();
      expect(html).toContain("No entities configured");
    });

    it("renders rows with correct color coding", () => {
      const mgr = new EntityConfigManager("monsters");
      mgr._savedConfig = [
        { templateId: "goblin", count: 50, type: "generated" },
      ];
      mgr._workingConfig = [
        { templateId: "goblin", count: 50, type: "generated" },
        { templateId: "wolf", count: 20, type: "generated" },
      ];

      const templates = [
        { id: "goblin", name: "Goblin Scout", icon: "\ud83d\udc7a" },
        { id: "wolf", name: "Dire Wolf", icon: "\ud83d\udc3a" },
      ];

      const html = mgr.renderConfigTable(templates);
      expect(html).toContain("bg-gray-800"); // unchanged
      expect(html).toContain("bg-blue-900"); // added
      expect(html).toContain("Goblin Scout");
      expect(html).toContain("Dire Wolf");
      expect(html).toContain("+20"); // added delta
    });
  });

  // ── Cycle 15: logConsole ──────────────────────────────────────────
  describe("logConsole", () => {
    it("returns formatted message with timestamp", () => {
      const mgr = new EntityConfigManager("monsters");
      const result = mgr.logConsole("Test message");
      expect(result).toMatch(/^\[.+\] Test message$/);
    });
  });

  // ── Cycle 16: loadWorldSnapshots ──────────────────────────────────
  describe("loadWorldSnapshots", () => {
    it("returns snapshots from injected dependency", async () => {
      const mgr = new EntityConfigManager("monsters");
      const mockSnapshots = [
        { id: "snap_1", name: "Berlin v1" },
        { id: "snap_2", name: "Kyiv v1" },
      ];
      const result = await mgr.loadWorldSnapshots({
        getWorldSnapshots: async () => mockSnapshots,
      });
      expect(result).toEqual(mockSnapshots);
    });

    it("throws if dependency not provided", async () => {
      const mgr = new EntityConfigManager("monsters");
      await expect(mgr.loadWorldSnapshots()).rejects.toThrow(
        "getWorldSnapshots dependency is required",
      );
    });
  });
});
