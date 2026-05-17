import { describe, it, expect } from "vitest";
import { generateObjectsFromConfig } from "../../../www/firebase/entity-config-generator.js";

// ── Shared fixtures ────────────────────────────────────────────────

/** Simple rectangular zone covering central Berlin (lat 52–53, lng 13–14) */
const simpleZone = {
  type: "Feature",
  properties: { zoneId: "zone_1" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [13.0, 52.0],
        [14.0, 52.0],
        [14.0, 53.0],
        [13.0, 53.0],
        [13.0, 52.0],
      ],
    ],
  },
};

/** A second zone for multi-zone tests */
const secondZone = {
  type: "Feature",
  properties: { zoneId: "zone_2" },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [14.0, 53.0],
        [15.0, 53.0],
        [15.0, 54.0],
        [14.0, 54.0],
        [14.0, 53.0],
      ],
    ],
  },
};

const monsterTemplates = [
  { id: "goblin", name: "Goblin Scout", icon: "👾", type: "monster", hp: 100 },
  { id: "wolf", name: "Dire Wolf", icon: "🐺", type: "monster", hp: 200 },
  {
    id: "skeleton",
    name: "Skeleton Warrior",
    icon: "💀",
    type: "monster",
    hp: 150,
  },
];

const shopTemplates = [
  { id: "blacksmith", name: "Blacksmith", icon: "⚒️", type: "shop" },
  { id: "potion_shop", name: "Potion Shop", icon: "🧪", type: "shop" },
];

const vaultTemplates = [
  { id: "gold_vault", name: "Gold Vault", icon: "🏦", type: "vault" },
];

const castleTemplates = [
  { id: "stone_keep", name: "Stone Keep", icon: "🏰", type: "castle" },
];

const citadelTemplates = [
  { id: "grand_citadel", name: "Grand Citadel", icon: "🏛️", type: "citadel" },
];

const templatesByType = {
  monsters: monsterTemplates,
  shops: shopTemplates,
  vaults: vaultTemplates,
  castles: castleTemplates,
  citadels: citadelTemplates,
};

const TEST_SNAPSHOT_ID = "snap_test_001";

// ── Helper to build an entityConfig quickly ────────────────────────

function makeConfig(overrides = {}) {
  return {
    monsters: [],
    shops: [],
    vaults: [],
    castles: [],
    citadels: [],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════

describe("generateObjectsFromConfig", () => {
  // ── 1. Empty entityConfig returns empty array ────────────────────
  it("returns empty array when all entity types are empty", () => {
    const config = makeConfig();
    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );
    expect(result).toEqual([]);
  });

  // ── 2. Returns correct count of objects per type ─────────────────
  it("returns correct count of objects per type", () => {
    const config = makeConfig({
      monsters: [
        { templateId: "goblin", count: 10, type: "generated" },
        { templateId: "wolf", count: 5, type: "generated" },
        { templateId: "skeleton", count: 2, type: "generated" },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(17);
    result.forEach((obj) => {
      expect(obj.type).toBe("monster");
    });
  });

  // ── 3. Generated objects have valid lat/lng within zone bbox ──────
  it("generates lat/lng within the zone bounding box", () => {
    const config = makeConfig({
      monsters: [{ templateId: "goblin", count: 50, type: "generated" }],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result.length).toBe(50);

    // GeoJSON polygon coords are [lng, lat], so the bbox is:
    // lat: 52.0 – 53.0, lng: 13.0 – 14.0
    result.forEach((obj) => {
      expect(obj.lat).toBeGreaterThanOrEqual(52.0);
      expect(obj.lat).toBeLessThanOrEqual(53.0);
      expect(obj.lng).toBeGreaterThanOrEqual(13.0);
      expect(obj.lng).toBeLessThanOrEqual(14.0);
    });
  });

  // ── 4. Manual entries use specified coordinates ──────────────────
  it("uses exact coordinates for manual entries", () => {
    const config = makeConfig({
      monsters: [
        {
          templateId: "goblin",
          count: 1,
          type: "manual",
          lat: 52.5,
          lng: 13.4,
        },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(52.5);
    expect(result[0].lng).toBe(13.4);
  });

  // ── 5. Manual entries get isManual: true flag ───────────────────
  it("flags manual entries with isManual: true", () => {
    const config = makeConfig({
      shops: [
        {
          templateId: "blacksmith",
          count: 1,
          type: "manual",
          lat: 52.52,
          lng: 13.405,
        },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(1);
    expect(result[0].isManual).toBe(true);
  });

  // ── 6. Objects include template data ────────────────────────────
  it("includes name and icon from the matching template", () => {
    const config = makeConfig({
      monsters: [{ templateId: "wolf", count: 1, type: "generated" }],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dire Wolf");
    expect(result[0].icon).toBe("🐺");
    expect(result[0].templateId).toBe("wolf");
  });

  // ── 7. Each object gets a unique id ─────────────────────────────
  it("assigns a unique id to every generated object", () => {
    const config = makeConfig({
      monsters: [
        { templateId: "goblin", count: 20, type: "generated" },
        { templateId: "wolf", count: 15, type: "generated" },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    const ids = result.map((obj) => obj.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  // ── 8. Objects include snapshotId ───────────────────────────────
  it("includes the snapshotId on every generated object", () => {
    const snapshotId = "snap_unique_42";
    const config = makeConfig({
      monsters: [{ templateId: "goblin", count: 5, type: "generated" }],
      shops: [{ templateId: "blacksmith", count: 3, type: "generated" }],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      snapshotId,
    );

    expect(result.length).toBe(8);
    result.forEach((obj) => {
      expect(obj.snapshotId).toBe("snap_unique_42");
    });
  });

  // ── 9. Multiple entity types generate correct total ─────────────
  it("generates correct total across multiple entity types", () => {
    const config = makeConfig({
      monsters: [{ templateId: "goblin", count: 5, type: "generated" }],
      shops: [{ templateId: "blacksmith", count: 3, type: "generated" }],
      vaults: [{ templateId: "gold_vault", count: 2, type: "generated" }],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(10);

    const monsters = result.filter((o) => o.type === "monster");
    const shops = result.filter((o) => o.type === "shop");
    const vaults = result.filter((o) => o.type === "vault");

    expect(monsters).toHaveLength(5);
    expect(shops).toHaveLength(3);
    expect(vaults).toHaveLength(2);
  });

  // ── 10. Skips entries with count 0 ──────────────────────────────
  it("produces no objects for entries with count 0", () => {
    const config = makeConfig({
      monsters: [
        { templateId: "goblin", count: 0, type: "generated" },
        { templateId: "wolf", count: 3, type: "generated" },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(3);
    result.forEach((obj) => {
      expect(obj.templateId).toBe("wolf");
    });
  });

  // ── 11. Handles missing templates gracefully ────────────────────
  it("generates objects even when templateId is not found in templates", () => {
    const config = makeConfig({
      monsters: [
        { templateId: "unknown_beast", count: 2, type: "generated" },
      ],
    });

    const result = generateObjectsFromConfig(
      config,
      [simpleZone],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    expect(result).toHaveLength(2);
    result.forEach((obj) => {
      expect(obj.templateId).toBe("unknown_beast");
      // Should still have an id and type even without a template match
      expect(obj.id).toBeDefined();
      expect(obj.type).toBe("monster");
    });
  });

  // ── 12. Handles empty zones gracefully ──────────────────────────
  it("handles empty zone features array without crashing", () => {
    const config = makeConfig({
      monsters: [{ templateId: "goblin", count: 3, type: "generated" }],
    });

    // Should not throw — either skips generation or falls back to defaults
    const result = generateObjectsFromConfig(
      config,
      [],
      templatesByType,
      TEST_SNAPSHOT_ID,
    );

    // Accept either: objects with some default coords, or an empty result
    expect(Array.isArray(result)).toBe(true);
    if (result.length > 0) {
      result.forEach((obj) => {
        expect(typeof obj.lat).toBe("number");
        expect(typeof obj.lng).toBe("number");
        expect(Number.isFinite(obj.lat)).toBe(true);
        expect(Number.isFinite(obj.lng)).toBe(true);
      });
    }
  });
});
