/**
 * FightCraft - Procedural World Renderer Tests
 *
 * Tests the world-level procedural rendering module:
 *   1. getTypesForZoom      - LOD object type selection
 *   2. getResolutionForZoom - H3 resolution selection per zoom
 *   3. estimateCityTotalCells - Cell count estimation
 *   4. generateAllCitadels  - World-wide citadel generation + caching
 *   5. invalidateCitadelCache - Cache invalidation
 *   6. getViewportKey       - Viewport deduplication key
 *   7. generateViewportObjects - Multi-city viewport generation
 *
 * Run: npx vitest run --config scripts/tests/vitest/vitest.config.js procedural-world-renderer
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// ─── Mock h3-spatial.js ────────────────────────────────────────
vi.mock("@www/core/h3-spatial.js", () => ({
  H3_RES_CITADEL: 4,
  H3_RES_ENTITY: 8,
  h3ToLatLng: vi.fn((h3Index) => ({ lat: 52.5, lng: 13.4 })),
  getViewportCells: vi.fn(() => ["cell1", "cell2"]),
  getCellsInRadius: vi.fn(() => ["cell1", "cell2", "cell3"]),
}));

// ─── Mock procedural-engine-v2.js ──────────────────────────────
vi.mock("@www/core/procedural-engine-v2.js", () => ({
  generateCitadelsForCity: vi.fn((city) => [
    { id: `citadel_${city.id}_0`, type: "citadel", cityId: city.id },
  ]),
  generateObjectsForCell: vi.fn(() => []),
  getObjectsForViewport: vi.fn((cells, recipe, ctx, defeated, types) =>
    cells.map((c, i) => ({ id: `obj_${c}_${i}`, type: types[0] || "monster" })),
  ),
  calculateCityObjectCount: vi.fn(() => 100),
  findCityForCell: vi.fn((cell, cities) => cities[0] || null),
  clearCellCityCache: vi.fn(),
  combineSeed: vi.fn((a, b) => a + b),
  getWorldSeed: vi.fn((s) => 42),
}));

// ─── Module Imports (after mocks) ──────────────────────────────
import {
  getTypesForZoom,
  getResolutionForZoom,
  estimateCityTotalCells,
  generateAllCitadels,
  invalidateCitadelCache,
  getViewportKey,
  generateViewportObjects,
  generateZoneGeoJSON,
  filterCitadelsInBounds,
} from "@www/core/procedural-world-renderer.js";

import {
  generateCitadelsForCity,
  findCityForCell,
  getObjectsForViewport,
} from "@www/core/procedural-engine-v2.js";

// ─── Test Fixtures ─────────────────────────────────────────────

const berlin = {
  id: "berlin",
  name: "Berlin",
  lat: 52.52,
  lng: 13.405,
  population: 3_400_000,
};
const kyiv = {
  id: "kyiv",
  name: "Kyiv",
  lat: 50.45,
  lng: 30.52,
  population: 2_900_000,
};
const village = {
  id: "smallville",
  name: "Smallville",
  lat: 48.0,
  lng: 16.0,
  population: 5_000,
};
const emptyCity = {
  id: "ghost",
  name: "Ghost Town",
  lat: 40.0,
  lng: -74.0,
  population: 0,
};

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
      monsters: { templates: [{ templateId: "goblin", weight: 70 }] },
      shops: { templates: [{ templateId: "blacksmith", weight: 100 }] },
      vaults: { templates: [{ templateId: "treasure_room", weight: 100 }] },
      castles: { templates: [{ templateId: "stone_fort", weight: 100 }] },
    },
    status: "active",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
//  1. LOD: Zoom to Object Types
// ═══════════════════════════════════════════════════════════════
describe("getTypesForZoom", () => {
  it("zoom 1 (world) returns empty array", () => {
    expect(getTypesForZoom(1)).toEqual([]);
  });

  it("zoom 5 (continent) returns empty array", () => {
    expect(getTypesForZoom(5)).toEqual([]);
  });

  it("zoom 7 (boundary) returns empty array", () => {
    expect(getTypesForZoom(7)).toEqual([]);
  });

  it("zoom 8 (country) returns only castle", () => {
    expect(getTypesForZoom(8)).toEqual(["castle"]);
  });

  it("zoom 10 (country boundary) returns only castle", () => {
    expect(getTypesForZoom(10)).toEqual(["castle"]);
  });

  it("zoom 11 (region) returns castle, shop, vault", () => {
    expect(getTypesForZoom(11)).toEqual(["castle", "shop", "vault"]);
  });

  it("zoom 13 (region boundary) returns castle, shop, vault", () => {
    expect(getTypesForZoom(13)).toEqual(["castle", "shop", "vault"]);
  });

  it("zoom 14 (city) includes monster", () => {
    const types = getTypesForZoom(14);
    expect(types).toContain("monster");
    expect(types).toContain("castle");
    expect(types).toContain("shop");
    expect(types).toContain("vault");
  });

  it("zoom 18 (street level) includes all types", () => {
    const types = getTypesForZoom(18);
    expect(types).toEqual(["monster", "castle", "shop", "vault"]);
  });

  it("zoom 20 (max) includes all types", () => {
    expect(getTypesForZoom(20)).toEqual(["monster", "castle", "shop", "vault"]);
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. LOD: Zoom to H3 Resolution
// ═══════════════════════════════════════════════════════════════
describe("getResolutionForZoom", () => {
  it("zoom 1 returns resolution 7", () => {
    expect(getResolutionForZoom(1)).toBe(7);
  });

  it("zoom 7 returns resolution 7", () => {
    expect(getResolutionForZoom(7)).toBe(7);
  });

  it("zoom 10 (boundary) returns resolution 7", () => {
    expect(getResolutionForZoom(10)).toBe(7);
  });

  it("zoom 11 returns resolution 8", () => {
    expect(getResolutionForZoom(11)).toBe(8);
  });

  it("zoom 13 (boundary) returns resolution 8", () => {
    expect(getResolutionForZoom(13)).toBe(8);
  });

  it("zoom 14 returns resolution 9", () => {
    expect(getResolutionForZoom(14)).toBe(9);
  });

  it("zoom 18 returns resolution 9", () => {
    expect(getResolutionForZoom(18)).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. City Cell Estimation
// ═══════════════════════════════════════════════════════════════
describe("estimateCityTotalCells", () => {
  it("Berlin (3.4M pop) at res 8 produces ~1200 cells", () => {
    const cells = estimateCityTotalCells(berlin, 8);
    // radiusKm = sqrt(3400000 / 12000) ~= 16.83
    // area = pi * 16.83^2 ~= 890
    // cells = 890 / 0.737 ~= 1208
    expect(cells).toBeGreaterThan(1000);
    expect(cells).toBeLessThan(1500);
  });

  it("Village (5K pop) at res 8 produces a small number of cells", () => {
    const cells = estimateCityTotalCells(village, 8);
    // radiusKm = max(3, sqrt(5000/12000)) = max(3, 0.645) = 3
    // area = pi * 9 = 28.27
    // cells = 28.27 / 0.737 ~= 38
    expect(cells).toBeGreaterThan(10);
    expect(cells).toBeLessThan(100);
  });

  it("zero population produces 1 cell (minimum)", () => {
    const cells = estimateCityTotalCells({ population: 0 }, 8);
    // radiusKm = max(3, sqrt(0)) = 3, area = pi*9 = 28.27, cells = 38
    // Actually sqrt(0/12000)=0, clamped to 3, so same as village
    // But the minimum is 1, and this formula should still yield > 1
    expect(cells).toBeGreaterThanOrEqual(1);
  });

  it("large city at res 7 (coarse) produces fewer cells than at res 9 (fine)", () => {
    const coarse = estimateCityTotalCells(berlin, 7);
    const fine = estimateCityTotalCells(berlin, 9);
    expect(fine).toBeGreaterThan(coarse);
  });

  it("uses fallback cell area (0.737) for unknown resolution", () => {
    const knownRes8 = estimateCityTotalCells(berlin, 8);
    const unknownRes = estimateCityTotalCells(berlin, 99);
    // Both use 0.737 cell area, so should be equal
    expect(unknownRes).toBe(knownRes8);
  });

  it("radius is clamped to max 50 km for mega-cities", () => {
    const megaCity = { population: 100_000_000 }; // 100M
    const cells = estimateCityTotalCells(megaCity, 8);
    // radiusKm = min(50, sqrt(100M/12000)) = min(50, 91.3) = 50
    // area = pi * 2500 = 7854
    // cells = 7854 / 0.737 ~= 10657
    expect(cells).toBeLessThan(11000);
    expect(cells).toBeGreaterThan(10000);
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. World Citadel Generation + Caching
// ═══════════════════════════════════════════════════════════════
describe("generateAllCitadels", () => {
  beforeEach(() => {
    invalidateCitadelCache();
    vi.clearAllMocks();
  });

  it("generates citadels for all cities with positive population", () => {
    const recipe = makeRecipe();
    const cities = [berlin, kyiv, village];
    const citadels = generateAllCitadels(cities, recipe);

    expect(citadels.length).toBe(3); // 1 citadel per city from mock
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(3);
  });

  it("skips cities with zero population", () => {
    const recipe = makeRecipe();
    const cities = [berlin, emptyCity];
    const citadels = generateAllCitadels(cities, recipe);

    expect(citadels.length).toBe(1);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(1);
    expect(generateCitadelsForCity).toHaveBeenCalledWith(berlin, recipe);
  });

  it("skips cities with negative population", () => {
    const negCity = {
      id: "neg",
      name: "Neg",
      lat: 0,
      lng: 0,
      population: -100,
    };
    const recipe = makeRecipe();
    const citadels = generateAllCitadels([negCity], recipe);

    expect(citadels.length).toBe(0);
    expect(generateCitadelsForCity).not.toHaveBeenCalled();
  });

  it("returns cached result for same recipe seed", () => {
    const recipe = makeRecipe({ seed: 42 });
    const cities = [berlin, kyiv];

    const first = generateAllCitadels(cities, recipe);
    const second = generateAllCitadels(cities, recipe);

    expect(first).toBe(second); // Same reference (cached)
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(2); // Only from first call
  });

  it("regenerates when recipe seed changes", () => {
    const cities = [berlin];

    const recipe1 = makeRecipe({ seed: 42 });
    const first = generateAllCitadels(cities, recipe1);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(1);

    const recipe2 = makeRecipe({ seed: 99 });
    const second = generateAllCitadels(cities, recipe2);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(2);

    expect(first).not.toBe(second);
  });

  it("returns empty array for empty city list", () => {
    const recipe = makeRecipe();
    const citadels = generateAllCitadels([], recipe);
    expect(citadels).toEqual([]);
  });

  it("citadels have correct cityId from the mock", () => {
    const recipe = makeRecipe();
    const citadels = generateAllCitadels([berlin], recipe);
    expect(citadels[0].cityId).toBe("berlin");
    expect(citadels[0].type).toBe("citadel");
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. Cache Invalidation
// ═══════════════════════════════════════════════════════════════
describe("invalidateCitadelCache", () => {
  beforeEach(() => {
    invalidateCitadelCache();
    vi.clearAllMocks();
  });

  it("forces regeneration on next call", () => {
    const recipe = makeRecipe({ seed: 42 });
    const cities = [berlin];

    generateAllCitadels(cities, recipe);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(1);

    // Without invalidation, should be cached
    generateAllCitadels(cities, recipe);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(1);

    // Invalidate, should regenerate
    invalidateCitadelCache();
    generateAllCitadels(cities, recipe);
    expect(generateCitadelsForCity).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════
//  6. Viewport Cache Key
// ═══════════════════════════════════════════════════════════════
describe("getViewportKey", () => {
  const bounds = { north: 52.55, south: 52.45, east: 13.45, west: 13.35 };

  it("produces a deterministic string key", () => {
    const key = getViewportKey(bounds, 14, 42);
    expect(typeof key).toBe("string");
    expect(key).toBe("52.5500_52.4500_13.4500_13.3500_14_42");
  });

  it("same bounds + zoom + seed produces identical key", () => {
    const key1 = getViewportKey(bounds, 14, 42);
    const key2 = getViewportKey(bounds, 14, 42);
    expect(key1).toBe(key2);
  });

  it("different bounds produces different key", () => {
    const bounds2 = { north: 53.0, south: 52.0, east: 14.0, west: 13.0 };
    const key1 = getViewportKey(bounds, 14, 42);
    const key2 = getViewportKey(bounds2, 14, 42);
    expect(key1).not.toBe(key2);
  });

  it("different zoom produces different key", () => {
    const key1 = getViewportKey(bounds, 14, 42);
    const key2 = getViewportKey(bounds, 10, 42);
    expect(key1).not.toBe(key2);
  });

  it("different seed produces different key", () => {
    const key1 = getViewportKey(bounds, 14, 42);
    const key2 = getViewportKey(bounds, 14, 99);
    expect(key1).not.toBe(key2);
  });

  it("truncates coordinates to 4 decimal places", () => {
    const precise = {
      north: 52.5512345,
      south: 52.4587654,
      east: 13.456789,
      west: 13.3598765,
    };
    const key = getViewportKey(precise, 14, 42);
    expect(key).toBe("52.5512_52.4588_13.4568_13.3599_14_42");
  });
});

// ═══════════════════════════════════════════════════════════════
//  7. Viewport Object Generation
// ═══════════════════════════════════════════════════════════════
describe("generateViewportObjects", () => {
  const bounds = { north: 52.55, south: 52.45, east: 13.45, west: 13.35 };

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mock implementations (clearAllMocks only clears call history)
    findCityForCell.mockImplementation((cell, cities) => cities[0] || null);
    getObjectsForViewport.mockImplementation(
      (cells, recipe, ctx, defeated, types) =>
        cells.map((c, i) => ({
          id: `obj_${c}_${i}`,
          type: types[0] || "monster",
        })),
    );
    // Set up window.h3 mock for viewport generation
    globalThis.window = globalThis.window || {};
    globalThis.window.h3 = {
      polygonToCells: vi.fn(() => ["cellA", "cellB", "cellC"]),
    };
  });

  it("returns empty array at zoom <= 7 (citadels-only tier)", () => {
    const recipe = makeRecipe();
    const result = generateViewportObjects(bounds, recipe, [berlin], 5);
    expect(result).toEqual([]);
    // Should not even try to call h3
    expect(window.h3.polygonToCells).not.toHaveBeenCalled();
  });

  it("returns empty array when window.h3 is not available", () => {
    globalThis.window.h3 = null;
    const recipe = makeRecipe();
    const result = generateViewportObjects(bounds, recipe, [berlin], 14);
    expect(result).toEqual([]);
  });

  it("groups cells by city and generates objects", () => {
    const recipe = makeRecipe();
    const cities = [berlin];

    const result = generateViewportObjects(bounds, recipe, cities, 14);

    // Mock returns 3 cells, findCityForCell maps all to berlin,
    // getObjectsForViewport maps each cell to one object
    expect(result.length).toBe(3);
    expect(findCityForCell).toHaveBeenCalledTimes(3);
    expect(getObjectsForViewport).toHaveBeenCalledTimes(1); // One city group
  });

  it("passes correct types for zoom 10 (castle only)", () => {
    const recipe = makeRecipe();
    generateViewportObjects(bounds, recipe, [berlin], 10);

    expect(getObjectsForViewport).toHaveBeenCalledWith(
      expect.any(Array),
      recipe,
      expect.objectContaining({ cityId: "berlin" }),
      expect.any(Set),
      ["castle"],
    );
  });

  it("passes correct types for zoom 12 (castle+shop+vault)", () => {
    const recipe = makeRecipe();
    generateViewportObjects(bounds, recipe, [berlin], 12);

    expect(getObjectsForViewport).toHaveBeenCalledWith(
      expect.any(Array),
      recipe,
      expect.objectContaining({ cityId: "berlin" }),
      expect.any(Set),
      ["castle", "shop", "vault"],
    );
  });

  it("passes correct types for zoom 15 (all types)", () => {
    const recipe = makeRecipe();
    generateViewportObjects(bounds, recipe, [berlin], 15);

    expect(getObjectsForViewport).toHaveBeenCalledWith(
      expect.any(Array),
      recipe,
      expect.objectContaining({ cityId: "berlin" }),
      expect.any(Set),
      ["monster", "castle", "shop", "vault"],
    );
  });

  it("handles H3 polygonToCells failure gracefully", () => {
    globalThis.window.h3.polygonToCells = vi.fn(() => {
      throw new Error("Invalid polygon");
    });
    const recipe = makeRecipe();
    const result = generateViewportObjects(bounds, recipe, [berlin], 14);
    expect(result).toEqual([]);
  });

  it("clamps cell count when H3 returns too many cells", () => {
    // Return 6000 cells (over the 5000 limit)
    const manyCells = Array.from({ length: 6000 }, (_, i) => `cell_${i}`);
    globalThis.window.h3.polygonToCells = vi.fn(() => manyCells);

    const recipe = makeRecipe();
    generateViewportObjects(bounds, recipe, [berlin], 14);

    // findCityForCell should be called exactly 5000 times (clamped)
    expect(findCityForCell).toHaveBeenCalledTimes(5000);
  });

  it("skips cells with no matching city", () => {
    findCityForCell.mockReturnValue(null);
    const recipe = makeRecipe();
    const result = generateViewportObjects(bounds, recipe, [], 14);
    expect(result).toEqual([]);
    expect(getObjectsForViewport).not.toHaveBeenCalled();
  });

  it("builds cityContext with estimateCityTotalCells", () => {
    const recipe = makeRecipe();
    generateViewportObjects(bounds, recipe, [berlin], 14);

    const call = getObjectsForViewport.mock.calls[0];
    const cityContext = call[2];
    expect(cityContext.cityId).toBe("berlin");
    expect(cityContext.cityName).toBe("Berlin");
    expect(cityContext.population).toBe(3_400_000);
    expect(cityContext.totalCells).toBeGreaterThan(0);
    // totalCells should match estimateCityTotalCells(berlin, 9) since zoom=14 -> res 9
    expect(cityContext.totalCells).toBe(estimateCityTotalCells(berlin, 9));
  });

  it("passes defeatedIds through to getObjectsForViewport", () => {
    const recipe = makeRecipe();
    const defeated = new Set(["obj_1", "obj_2"]);
    generateViewportObjects(bounds, recipe, [berlin], 14, defeated);

    const call = getObjectsForViewport.mock.calls[0];
    expect(call[3]).toBe(defeated);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// generateZoneGeoJSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("generateZoneGeoJSON", () => {
  const mockBoundary = [
    [52.5, 13.3],
    [52.6, 13.4],
    [52.5, 13.5],
    [52.4, 13.5],
    [52.3, 13.4],
    [52.4, 13.3],
  ];

  const mockH3 = {
    cellToBoundary: vi.fn(() => mockBoundary),
  };

  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    globalThis.window.h3 = mockH3;
    mockH3.cellToBoundary.mockClear();
  });

  afterEach(() => {
    delete globalThis.window.h3;
  });

  it("returns empty FeatureCollection for null input", () => {
    const result = generateZoneGeoJSON(null);
    expect(result).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("returns empty FeatureCollection for empty array", () => {
    const result = generateZoneGeoJSON([]);
    expect(result).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("returns empty FeatureCollection when window.h3 is not available", () => {
    delete globalThis.window.h3;
    const citadels = [
      { h3Index: "841f91fffffffff", id: "c1", cityId: "berlin" },
    ];
    const result = generateZoneGeoJSON(citadels);
    expect(result).toEqual({ type: "FeatureCollection", features: [] });
  });

  it("generates features with correct GeoJSON structure", () => {
    const citadels = [
      {
        h3Index: "841f91fffffffff",
        id: "c1",
        cityId: "berlin",
        cityName: "Berlin",
        templateId: "t1",
        lat: 52.5,
        lng: 13.4,
      },
    ];
    const result = generateZoneGeoJSON(citadels);

    expect(result.type).toBe("FeatureCollection");
    expect(result.features).toHaveLength(1);

    const feature = result.features[0];
    expect(feature.type).toBe("Feature");
    expect(feature.geometry.type).toBe("Polygon");
    expect(Array.isArray(feature.geometry.coordinates)).toBe(true);
    expect(Array.isArray(feature.geometry.coordinates[0])).toBe(true);
  });

  it("deduplicates citadels in the same H3 cell", () => {
    const citadels = [
      { h3Index: "841f91fffffffff", id: "c1", cityId: "berlin" },
      { h3Index: "841f91fffffffff", id: "c2", cityId: "berlin" },
      { h3Index: "842e35fffffffff", id: "c3", cityId: "kyiv" },
    ];
    const result = generateZoneGeoJSON(citadels);

    // Two unique cells -> two features
    expect(result.features).toHaveLength(2);
    expect(result.features[0].properties.citadelId).toBe("c1");
    expect(result.features[1].properties.citadelId).toBe("c3");
  });

  it("each feature has all required properties", () => {
    const citadels = [
      {
        h3Index: "841f91fffffffff",
        id: "c1",
        cityId: "berlin",
        cityName: "Berlin",
        templateId: "t1",
      },
    ];
    const result = generateZoneGeoJSON(citadels);
    const props = result.features[0].properties;

    expect(props).toHaveProperty("h3Index", "841f91fffffffff");
    expect(props).toHaveProperty("citadelId", "c1");
    expect(props).toHaveProperty("cityId", "berlin");
    expect(props).toHaveProperty("cityName", "Berlin");
    expect(props).toHaveProperty("templateId", "t1");
  });

  it("defaults missing optional properties to null", () => {
    const citadels = [{ h3Index: "841f91fffffffff", id: "c1" }];
    const result = generateZoneGeoJSON(citadels);
    const props = result.features[0].properties;

    expect(props.cityId).toBeNull();
    expect(props.cityName).toBeNull();
    expect(props.templateId).toBeNull();
  });

  it("coordinates are in [lng, lat] GeoJSON format", () => {
    const citadels = [
      { h3Index: "841f91fffffffff", id: "c1", cityId: "berlin" },
    ];
    const result = generateZoneGeoJSON(citadels);
    const ring = result.features[0].geometry.coordinates[0];

    // mockBoundary[0] is [lat=52.5, lng=13.3]
    // GeoJSON should be [lng=13.3, lat=52.5]
    expect(ring[0]).toEqual([13.3, 52.5]);
    expect(ring[1]).toEqual([13.4, 52.6]);
  });

  it("ring is closed (first coordinate === last coordinate)", () => {
    const citadels = [
      { h3Index: "841f91fffffffff", id: "c1", cityId: "berlin" },
    ];
    const result = generateZoneGeoJSON(citadels);
    const ring = result.features[0].geometry.coordinates[0];

    expect(ring.length).toBe(mockBoundary.length + 1); // original + closing vertex
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it("skips citadels with no h3Index", () => {
    const citadels = [
      { id: "c1", cityId: "berlin" }, // no h3Index
      { h3Index: "", id: "c2", cityId: "berlin" }, // empty h3Index
      { h3Index: "841f91fffffffff", id: "c3", cityId: "kyiv" },
    ];
    const result = generateZoneGeoJSON(citadels);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.citadelId).toBe("c3");
  });

  it("handles cellToBoundary throwing an error gracefully", () => {
    mockH3.cellToBoundary.mockImplementationOnce(() => {
      throw new Error("invalid cell");
    });
    const citadels = [
      { h3Index: "invalid_cell", id: "c1", cityId: "berlin" },
      { h3Index: "841f91fffffffff", id: "c2", cityId: "kyiv" },
    ];
    const result = generateZoneGeoJSON(citadels);
    // First citadel skipped due to error, second succeeds
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.citadelId).toBe("c2");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// filterCitadelsInBounds
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe("filterCitadelsInBounds", () => {
  const bounds = { north: 53.0, south: 52.0, east: 14.0, west: 13.0 };

  const citadelInside = { id: "c1", lat: 52.5, lng: 13.5 };
  const citadelOutside = { id: "c2", lat: 60.0, lng: 25.0 };
  const citadelEdge = { id: "c3", lat: 54.5, lng: 13.5 }; // outside bounds but within default padding=2
  const citadelFarOut = { id: "c4", lat: 70.0, lng: 30.0 }; // outside even with padding

  it("returns empty array for null citadels", () => {
    expect(filterCitadelsInBounds(null, bounds)).toEqual([]);
  });

  it("returns empty array for null bounds", () => {
    expect(filterCitadelsInBounds([citadelInside], null)).toEqual([]);
  });

  it("returns empty array for empty citadel list", () => {
    expect(filterCitadelsInBounds([], bounds)).toEqual([]);
  });

  it("filters citadels within bounds", () => {
    const result = filterCitadelsInBounds(
      [citadelInside, citadelOutside, citadelFarOut],
      bounds,
      0, // no padding -- strict bounds
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c1");
  });

  it("default padding is 2 degrees", () => {
    // citadelEdge is at lat=54.5 -- outside north=53 but within 53 + 2 = 55
    const result = filterCitadelsInBounds(
      [citadelInside, citadelEdge, citadelFarOut],
      bounds,
    );
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toContain("c1");
    expect(result.map((c) => c.id)).toContain("c3");
  });

  it("respects custom padding parameter", () => {
    // With padding=0, citadelEdge (lat=54.5) is outside north=53
    const noPadding = filterCitadelsInBounds([citadelEdge], bounds, 0);
    expect(noPadding).toHaveLength(0);

    // With padding=2, citadelEdge is within north+2=55
    const withPadding = filterCitadelsInBounds([citadelEdge], bounds, 2);
    expect(withPadding).toHaveLength(1);
  });

  it("includes citadels exactly on the padded boundary", () => {
    // Citadel exactly at north + padding boundary
    const onBoundary = { id: "edge", lat: 55.0, lng: 13.5 }; // north(53) + padding(2) = 55
    const result = filterCitadelsInBounds([onBoundary], bounds, 2);
    expect(result).toHaveLength(1);
  });
});
