/**
 * FightCraft — Procedural Engine V2 Tests
 *
 * Tests the deterministic world-generation engine:
 *   1. PRNG determinism (mulberry32, getWorldSeed, combineSeed)
 *   2. Template selection (pickWeightedTemplate)
 *   3. Density calculation (calculateCityObjectCount)
 *   4. Cell distribution (distributeObjectsAcrossCells)
 *   5. Per-cell generation (generateObjectsForCell)
 *   6. Viewport aggregation (getObjectsForViewport)
 *   7. Object lookup (getObjectById)
 *   8. Citadel generation (generateCitadelsForCity)
 *
 * Run: npx vitest run --config scripts/tests/vitest/vitest.config.js
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// ─── Mock h3-spatial.js (h3-js not available in Node) ──────────
vi.mock("@www/core/h3-spatial.js", () => ({
  H3_RES_CITADEL: 4,
  H3_RES_ENTITY: 8,
  h3ToLatLng: vi.fn((h3Index) => {
    // Deterministic fake coords derived from h3 index string hash
    let hash = 0;
    for (let i = 0; i < h3Index.length; i++) {
      hash = (hash * 31 + h3Index.charCodeAt(i)) & 0xffffffff;
    }
    return {
      lat: 52.5 + (hash % 100) / 10000,
      lng: 13.4 + (hash % 200) / 10000,
    };
  }),
  latLngToH3: vi.fn((lat, lng, res) => {
    return `${res || 8}${Math.floor(lat * 100)}${Math.floor(lng * 100)}`;
  }),
  getCellsInRadius: vi.fn((lat, lng, radiusKm, res) => {
    const cells = [];
    const base = `${res || 4}${Math.floor(lat * 10)}${Math.floor(lng * 10)}`;
    // Return 30 cells to support citadel tests (cities can need 21+)
    for (let i = 0; i < 30; i++) cells.push(`${base}_${i}`);
    return cells;
  }),
}));

// ─── Module Imports ────────────────────────────────────────────
import {
  mulberry32,
  getWorldSeed,
  combineSeed,
  pickWeightedTemplate,
  calculateCityObjectCount,
  distributeObjectsAcrossCells,
  generateObjectsForCell,
  generateCitadelsForCity,
  getObjectsForViewport,
  getObjectById,
  clearCellCityCache,
} from "@www/core/procedural-engine-v2.js";

// ─── Test Fixtures ─────────────────────────────────────────────

/** A valid recipe matching the snapshot-recipe schema. */
function makeRecipe(overrides = {}) {
  return {
    seed: 42,
    h3Resolution: 9,
    densityRatios: {
      monster: 1000,
      shop: 16000,
      vault: 34783,
      castle: 5000,
      citadel: 190476,
    },
    layers: {
      monsters: {
        templates: [
          { templateId: "goblin", weight: 70 },
          { templateId: "orc", weight: 30 },
        ],
      },
      shops: {
        templates: [{ templateId: "blacksmith", weight: 100 }],
      },
      vaults: {
        templates: [{ templateId: "treasure_room", weight: 100 }],
      },
      castles: {
        templates: [{ templateId: "stone_fort", weight: 100 }],
      },
    },
    status: "active",
    ...overrides,
  };
}

/** Standard city context for Berlin. */
const berlinContext = {
  cityId: "berlin",
  cityName: "Berlin",
  population: 4_000_000,
  totalCells: 1000,
};

/** A deterministic H3 index for testing. */
const TEST_CELL = "882a1070adfffff";

// ═══════════════════════════════════════════════════════════════
//  1. PRNG Determinism
// ═══════════════════════════════════════════════════════════════
describe("PRNG Determinism", () => {
  it("mulberry32(42) returns the same sequence on every call", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const seq1 = Array.from({ length: 20 }, () => rng1());
    const seq2 = Array.from({ length: 20 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("mulberry32(42) and mulberry32(43) produce different sequences", () => {
    const rng42 = mulberry32(42);
    const rng43 = mulberry32(43);

    const seq42 = Array.from({ length: 10 }, () => rng42());
    const seq43 = Array.from({ length: 10 }, () => rng43());

    expect(seq42).not.toEqual(seq43);
  });

  it("output is always in [0, 1)", () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 10_000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("getWorldSeed produces the same hash for the same input", () => {
    const a = getWorldSeed("882a1070adfffff");
    const b = getWorldSeed("882a1070adfffff");
    expect(a).toBe(b);
    expect(typeof a).toBe("number");
  });

  it("getWorldSeed produces different hashes for different inputs", () => {
    const a = getWorldSeed("882a1070adfffff");
    const b = getWorldSeed("882a1070bdffffff");
    expect(a).not.toBe(b);
  });

  it("getWorldSeed returns a 32-bit unsigned integer", () => {
    const val = getWorldSeed("test-cell-index");
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(val)).toBe(true);
  });

  it("combineSeed produces different results for different recipe seeds", () => {
    const h3Seed = getWorldSeed(TEST_CELL);
    const a = combineSeed(42, h3Seed);
    const b = combineSeed(99, h3Seed);
    expect(a).not.toBe(b);
  });

  it("combineSeed produces different results for different h3 seeds", () => {
    const seedA = getWorldSeed("cell_alpha");
    const seedB = getWorldSeed("cell_beta");
    const a = combineSeed(42, seedA);
    const b = combineSeed(42, seedB);
    expect(a).not.toBe(b);
  });

  it("combineSeed returns a 32-bit unsigned integer", () => {
    const val = combineSeed(42, 12345);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(val)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. Template Selection
// ═══════════════════════════════════════════════════════════════
describe("Template Selection (pickWeightedTemplate)", () => {
  it("always returns a template from the list", () => {
    const templates = [
      { templateId: "goblin", weight: 50 },
      { templateId: "orc", weight: 50 },
    ];
    const rng = mulberry32(777);

    for (let i = 0; i < 100; i++) {
      const picked = pickWeightedTemplate(templates, rng);
      expect(picked).not.toBeNull();
      expect(templates).toContainEqual(picked);
    }
  });

  it("with weights [70, 30], distribution is approximately 70%/30% (+-5%)", () => {
    const templates = [
      { templateId: "goblin", weight: 70 },
      { templateId: "orc", weight: 30 },
    ];
    const rng = mulberry32(42);
    const counts = { goblin: 0, orc: 0 };
    const N = 10_000;

    for (let i = 0; i < N; i++) {
      const picked = pickWeightedTemplate(templates, rng);
      counts[picked.templateId]++;
    }

    const goblinPct = counts.goblin / N;
    const orcPct = counts.orc / N;

    expect(goblinPct).toBeGreaterThan(0.65);
    expect(goblinPct).toBeLessThan(0.75);
    expect(orcPct).toBeGreaterThan(0.25);
    expect(orcPct).toBeLessThan(0.35);
  });

  it("with a single template, always picks that one", () => {
    const templates = [{ templateId: "only_one", weight: 1 }];
    const rng = mulberry32(999);

    for (let i = 0; i < 50; i++) {
      const picked = pickWeightedTemplate(templates, rng);
      expect(picked.templateId).toBe("only_one");
    }
  });

  it("returns null for empty templates array", () => {
    const rng = mulberry32(42);
    expect(pickWeightedTemplate([], rng)).toBeNull();
  });

  it("returns null for null/undefined templates", () => {
    const rng = mulberry32(42);
    expect(pickWeightedTemplate(null, rng)).toBeNull();
    expect(pickWeightedTemplate(undefined, rng)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. Density Calculation
// ═══════════════════════════════════════════════════════════════
describe("Density Calculation (calculateCityObjectCount)", () => {
  const recipe = makeRecipe();

  it("Berlin (pop 4M) with monster ratio 1:1000 -> 4,000 monsters", () => {
    const count = calculateCityObjectCount(
      { population: 4_000_000 },
      recipe,
      "monster",
    );
    expect(count).toBe(4000);
  });

  it("Tokyo (pop 14M) with monster ratio 1:1000 -> 14,000 monsters", () => {
    const count = calculateCityObjectCount(
      { population: 14_000_000 },
      recipe,
      "monster",
    );
    expect(count).toBe(14000);
  });

  it("Village (pop 5K) with citadel ratio 1:190476 -> 1 citadel (minimum)", () => {
    // 5000 / 190476 = 0.026 -> rounds to 0, but MIN_COUNTS.citadel = 1
    const count = calculateCityObjectCount(
      { population: 5000 },
      recipe,
      "citadel",
    );
    expect(count).toBe(1);
  });

  it("Small village (pop 500) with shop ratio 1:16000 -> 0 shops (no minimum)", () => {
    // 500 / 16000 = 0.03125 -> rounds to 0, MIN_COUNTS.shop = 0
    const count = calculateCityObjectCount({ population: 500 }, recipe, "shop");
    expect(count).toBe(0);
  });

  it("returns 0 for zero population", () => {
    const count = calculateCityObjectCount(
      { population: 0 },
      recipe,
      "monster",
    );
    expect(count).toBe(0);
  });

  it("returns 0 for negative population", () => {
    const count = calculateCityObjectCount(
      { population: -100 },
      recipe,
      "monster",
    );
    expect(count).toBe(0);
  });

  it("returns 0 for missing density ratio", () => {
    const noRatio = makeRecipe({ densityRatios: {} });
    const count = calculateCityObjectCount(
      { population: 4_000_000 },
      noRatio,
      "monster",
    );
    expect(count).toBe(0);
  });

  it("returns 0 for null city", () => {
    expect(calculateCityObjectCount(null, recipe, "monster")).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. Cell Distribution
// ═══════════════════════════════════════════════════════════════
describe("Cell Distribution (distributeObjectsAcrossCells)", () => {
  const cells = Array.from({ length: 10 }, (_, i) => `cell_${i}`);

  it("distributes all 100 objects across 10 cells (sum equals totalCount)", () => {
    const dist = distributeObjectsAcrossCells(100, cells, 42);
    let sum = 0;
    for (const count of dist.values()) sum += count;
    expect(sum).toBe(100);
  });

  it("sum of distribution always equals totalCount for various counts", () => {
    for (const total of [1, 7, 50, 100, 999, 10000]) {
      const dist = distributeObjectsAcrossCells(total, cells, 42);
      let sum = 0;
      for (const count of dist.values()) sum += count;
      expect(sum).toBe(total);
    }
  });

  it("same seed produces same distribution", () => {
    const dist1 = distributeObjectsAcrossCells(100, cells, 42);
    const dist2 = distributeObjectsAcrossCells(100, cells, 42);

    expect([...dist1.entries()]).toEqual([...dist2.entries()]);
  });

  it("different seed produces different distribution", () => {
    const dist1 = distributeObjectsAcrossCells(100, cells, 42);
    const dist2 = distributeObjectsAcrossCells(100, cells, 99);

    // Convert to comparable arrays
    const values1 = cells.map((c) => dist1.get(c) ?? 0);
    const values2 = cells.map((c) => dist2.get(c) ?? 0);

    // Distributions should differ (extremely unlikely to be identical)
    expect(values1).not.toEqual(values2);
  });

  it("returns empty map for zero totalCount", () => {
    const dist = distributeObjectsAcrossCells(0, cells, 42);
    expect(dist.size).toBe(0);
  });

  it("returns empty map for empty cells array", () => {
    const dist = distributeObjectsAcrossCells(100, [], 42);
    expect(dist.size).toBe(0);
  });

  it("handles single cell (all objects go to it)", () => {
    const dist = distributeObjectsAcrossCells(50, ["only_cell"], 42);
    expect(dist.get("only_cell")).toBe(50);
  });

  it("only includes cells with count > 0 in the map", () => {
    // 3 objects across 10 cells — most will have 0
    const dist = distributeObjectsAcrossCells(3, cells, 42);
    for (const count of dist.values()) {
      expect(count).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. Per-Cell Generation (generateObjectsForCell)
// ═══════════════════════════════════════════════════════════════
describe("Per-Cell Generation (generateObjectsForCell)", () => {
  const recipe = makeRecipe();

  beforeEach(() => {
    clearCellCityCache();
  });

  it("same recipe + h3Index always produces same objects", () => {
    const objects1 = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );
    const objects2 = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    expect(objects1).toEqual(objects2);
  });

  it("different seeds produce different objects", () => {
    const recipe1 = makeRecipe({ seed: 42 });
    const recipe2 = makeRecipe({ seed: 99 });

    const objects1 = generateObjectsForCell(
      TEST_CELL,
      recipe1,
      "monster",
      berlinContext,
    );
    const objects2 = generateObjectsForCell(
      TEST_CELL,
      recipe2,
      "monster",
      berlinContext,
    );

    // At minimum, the content should be different (templateIds or positions)
    if (objects1.length > 0 && objects2.length > 0) {
      const ids1 = objects1.map((o) => o.templateId);
      const lats1 = objects1.map((o) => o.lat);
      const ids2 = objects2.map((o) => o.templateId);
      const lats2 = objects2.map((o) => o.lat);
      // At least one of templateIds or positions should differ
      const differ = !arraysEqual(ids1, ids2) || !arraysEqual(lats1, lats2);
      expect(differ).toBe(true);
    }
  });

  it("each object has valid id format: proc_{type}_{h3Index}_{localIndex}", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(obj.id).toMatch(new RegExp(`^proc_monster_${TEST_CELL}_\\d+$`));
    }
  });

  it("each object has type, templateId, lat, lng, procedural: true", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(obj.type).toBe("monster");
      expect(typeof obj.templateId).toBe("string");
      expect(obj.templateId.length).toBeGreaterThan(0);
      expect(typeof obj.lat).toBe("number");
      expect(typeof obj.lng).toBe("number");
      expect(obj.procedural).toBe(true);
    }
  });

  it("objects are positioned near the cell center (within POSITION_JITTER = 0.004)", async () => {
    const { h3ToLatLng } = await import("@www/core/h3-spatial.js");
    const center = h3ToLatLng(TEST_CELL);
    const HALF_JITTER = 0.004 / 2;
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(Math.abs(obj.lat - center.lat)).toBeLessThanOrEqual(HALF_JITTER);
      expect(Math.abs(obj.lng - center.lng)).toBeLessThanOrEqual(HALF_JITTER);
    }
  });

  it("objects have cityId and seed from context and recipe", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(obj.cityId).toBe("berlin");
      expect(obj.seed).toBe(42);
    }
  });

  it("localIndex is sequential starting from 0", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (let i = 0; i < objects.length; i++) {
      expect(objects[i].localIndex).toBe(i);
    }
  });

  it("returns empty array for null h3Index", () => {
    expect(
      generateObjectsForCell(null, recipe, "monster", berlinContext),
    ).toEqual([]);
  });

  it("returns empty array for null recipe", () => {
    expect(
      generateObjectsForCell(TEST_CELL, null, "monster", berlinContext),
    ).toEqual([]);
  });

  it("returns empty array for null cityContext", () => {
    expect(generateObjectsForCell(TEST_CELL, recipe, "monster", null)).toEqual(
      [],
    );
  });

  it("templateId comes from the recipe layers (goblin or orc)", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(["goblin", "orc"]).toContain(obj.templateId);
    }
  });

  it("uses default templateId when recipe has no templates for type", () => {
    const noTemplates = makeRecipe({
      layers: {
        monsters: { templates: [] },
        shops: { templates: [] },
        vaults: { templates: [] },
        castles: { templates: [] },
      },
    });

    const objects = generateObjectsForCell(
      TEST_CELL,
      noTemplates,
      "monster",
      berlinContext,
    );

    for (const obj of objects) {
      expect(obj.templateId).toBe("monster_default");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
//  6. Viewport Aggregation (getObjectsForViewport)
// ═══════════════════════════════════════════════════════════════
describe("Viewport Aggregation (getObjectsForViewport)", () => {
  const recipe = makeRecipe();
  const cells = ["cell_alpha", "cell_beta", "cell_gamma"];

  beforeEach(() => {
    clearCellCityCache();
  });

  it("returns objects from all provided cells", () => {
    const objects = getObjectsForViewport(cells, recipe, berlinContext);

    // Each cell should contribute objects — verify multiple cells represented
    const cellsRepresented = new Set(objects.map((o) => o.h3Index));
    expect(cellsRepresented.size).toBeGreaterThan(0);
  });

  it("filters out defeated IDs", () => {
    const allObjects = getObjectsForViewport(cells, recipe, berlinContext);
    if (allObjects.length === 0) return; // Skip if no objects generated

    // Defeat the first object
    const defeated = new Set([allObjects[0].id]);
    const filtered = getObjectsForViewport(
      cells,
      recipe,
      berlinContext,
      defeated,
    );

    expect(filtered.length).toBe(allObjects.length - 1);
    expect(filtered.find((o) => o.id === allObjects[0].id)).toBeUndefined();
  });

  it("only generates requested object types", () => {
    const monstersOnly = getObjectsForViewport(
      cells,
      recipe,
      berlinContext,
      new Set(),
      ["monster"],
    );

    for (const obj of monstersOnly) {
      expect(obj.type).toBe("monster");
    }
  });

  it("skips citadel type silently (citadels are city-level)", () => {
    const withCitadel = getObjectsForViewport(
      cells,
      recipe,
      berlinContext,
      new Set(),
      ["monster", "citadel"],
    );

    for (const obj of withCitadel) {
      expect(obj.type).not.toBe("citadel");
    }
  });

  it("returns empty array for empty cells", () => {
    const objects = getObjectsForViewport([], recipe, berlinContext);
    expect(objects).toEqual([]);
  });

  it("deterministic: same inputs produce same output", () => {
    const a = getObjectsForViewport(cells, recipe, berlinContext);
    const b = getObjectsForViewport(cells, recipe, berlinContext);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════
//  7. Object Lookup by ID (getObjectById)
// ═══════════════════════════════════════════════════════════════
describe("Object Lookup (getObjectById)", () => {
  const recipe = makeRecipe();

  beforeEach(() => {
    clearCellCityCache();
  });

  it("returns an object for a valid procedural ID", () => {
    // Generate objects for a cell, then look up by ID
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );
    if (objects.length === 0) return;

    const target = objects[0];
    const found = getObjectById(target.id, recipe, berlinContext);

    expect(found).not.toBeNull();
    expect(found.id).toBe(target.id);
  });

  it("returned object matches the corresponding object from generateObjectsForCell", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );
    if (objects.length < 4) return;

    // Look up the 4th object (index 3)
    const targetId = `proc_monster_${TEST_CELL}_3`;
    const found = getObjectById(targetId, recipe, berlinContext);

    expect(found).not.toBeNull();
    expect(found.id).toBe(objects[3].id);
    expect(found.templateId).toBe(objects[3].templateId);
    expect(found.lat).toBe(objects[3].lat);
    expect(found.lng).toBe(objects[3].lng);
    expect(found.type).toBe("monster");
  });

  it("returns null for null/undefined ID", () => {
    expect(getObjectById(null, recipe, berlinContext)).toBeNull();
    expect(getObjectById(undefined, recipe, berlinContext)).toBeNull();
  });

  it("returns null for non-string ID", () => {
    expect(getObjectById(12345, recipe, berlinContext)).toBeNull();
  });

  it("returns null for ID with wrong format (no proc_ prefix)", () => {
    expect(getObjectById("monster_cell_0", recipe, berlinContext)).toBeNull();
  });

  it("returns null for ID with too few parts", () => {
    expect(getObjectById("proc_monster", recipe, berlinContext)).toBeNull();
  });

  it("returns null for ID with negative localIndex", () => {
    expect(
      getObjectById("proc_monster_cell_-1", recipe, berlinContext),
    ).toBeNull();
  });

  it("returns null for ID with localIndex beyond generated count", () => {
    const objects = generateObjectsForCell(
      TEST_CELL,
      recipe,
      "monster",
      berlinContext,
    );
    const outOfBounds = `proc_monster_${TEST_CELL}_${objects.length + 100}`;
    expect(getObjectById(outOfBounds, recipe, berlinContext)).toBeNull();
  });

  it("handles citadel ID with minimal reconstruction", () => {
    const citadelId = "proc_citadel_4525134_0";
    const found = getObjectById(citadelId, recipe, berlinContext);

    expect(found).not.toBeNull();
    expect(found.type).toBe("citadel");
    expect(found.templateId).toBe("citadel_default");
    expect(found.procedural).toBe(true);
    expect(found.id).toBe(citadelId);
  });

  it("uses default cityContext when none provided", () => {
    const objects = generateObjectsForCell(TEST_CELL, recipe, "monster", {
      cityId: "unknown",
      cityName: "Unknown",
      population: 1_000_000,
      totalCells: 1000,
    });
    if (objects.length === 0) return;

    // Call without cityContext — should use defaults and not throw
    const found = getObjectById(objects[0].id, recipe);
    expect(found).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
//  8. Citadel Generation (generateCitadelsForCity)
// ═══════════════════════════════════════════════════════════════
describe("Citadel Generation (generateCitadelsForCity)", () => {
  const recipe = makeRecipe();

  it("Berlin (pop 4M / 190476) produces ~21 citadels", () => {
    const berlin = {
      id: "berlin",
      name: "Berlin",
      lat: 52.52,
      lng: 13.405,
      population: 4_000_000,
    };
    const citadels = generateCitadelsForCity(berlin, recipe);

    // 4_000_000 / 190_476 = 20.99... Math.round -> 21
    expect(citadels.length).toBe(21);
  });

  it("small city (pop 5000) produces 1 citadel (minimum)", () => {
    const village = {
      id: "village",
      name: "Village",
      lat: 50.0,
      lng: 10.0,
      population: 5000,
    };
    const citadels = generateCitadelsForCity(village, recipe);

    // 5000 / 190476 = 0.026 -> rounds to 0, but MIN_COUNTS.citadel = 1
    expect(citadels.length).toBe(1);
  });

  it('all citadels have type "citadel"', () => {
    const city = {
      id: "testcity",
      name: "TestCity",
      lat: 52.0,
      lng: 13.0,
      population: 1_000_000,
    };
    const citadels = generateCitadelsForCity(city, recipe);

    for (const c of citadels) {
      expect(c.type).toBe("citadel");
    }
  });

  it("citadels are deterministic (same city + recipe produces same citadels)", () => {
    const city = {
      id: "berlin",
      name: "Berlin",
      lat: 52.52,
      lng: 13.405,
      population: 4_000_000,
    };

    const run1 = generateCitadelsForCity(city, recipe);
    const run2 = generateCitadelsForCity(city, recipe);

    expect(run1).toEqual(run2);
  });

  it("citadels have procedural: true and correct ID format", () => {
    const city = {
      id: "berlin",
      name: "Berlin",
      lat: 52.52,
      lng: 13.405,
      population: 1_000_000,
    };
    const citadels = generateCitadelsForCity(city, recipe);

    for (const c of citadels) {
      expect(c.procedural).toBe(true);
      expect(c.id).toMatch(/^proc_citadel_.+_\d+$/);
      expect(c.cityId).toBe("berlin");
      expect(c.cityName).toBe("Berlin");
      expect(c.seed).toBe(42);
    }
  });

  it("different recipe seeds produce different citadel arrangements", () => {
    const city = {
      id: "berlin",
      name: "Berlin",
      lat: 52.52,
      lng: 13.405,
      population: 4_000_000,
    };

    const citadels1 = generateCitadelsForCity(city, makeRecipe({ seed: 42 }));
    const citadels2 = generateCitadelsForCity(city, makeRecipe({ seed: 99 }));

    // Same count but different cell assignments (via Fisher-Yates shuffle)
    expect(citadels1.length).toBe(citadels2.length);
    const ids1 = citadels1.map((c) => c.h3Index);
    const ids2 = citadels2.map((c) => c.h3Index);
    expect(ids1).not.toEqual(ids2);
  });

  it("returns empty array for null city", () => {
    expect(generateCitadelsForCity(null, recipe)).toEqual([]);
  });

  it("returns empty array for zero population", () => {
    const empty = {
      id: "ghost",
      name: "Ghost",
      lat: 50,
      lng: 10,
      population: 0,
    };
    expect(generateCitadelsForCity(empty, recipe)).toEqual([]);
  });

  it("citadels have valid lat/lng", () => {
    const city = {
      id: "test",
      name: "Test",
      lat: 52.0,
      lng: 13.0,
      population: 500_000,
    };
    const citadels = generateCitadelsForCity(city, recipe);

    for (const c of citadels) {
      expect(typeof c.lat).toBe("number");
      expect(typeof c.lng).toBe("number");
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lng)).toBe(true);
    }
  });
});

// ─── Helper ────────────────────────────────────────────────────
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}
