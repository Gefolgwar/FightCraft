import { describe, it, expect } from "vitest";
import {
  buildEntityStatistics,
  createManualEntity,
  validateManualEntity,
  getProceduralRulesForType,
} from "@www/gameplay/entity-control-center.js";

// ── Cycle 1: Tracer Bullet — empty inputs ──────────────────────────
describe("buildEntityStatistics", () => {
  it("returns zeroed stats when both inputs are empty", () => {
    const result = buildEntityStatistics([], []);
    expect(result).toEqual({
      procedural: { total: 0, byTemplate: {} },
      manual: { total: 0, byTemplate: {} },
      combined: { total: 0 },
    });
  });

  // ── Cycle 2: Only procedural objects ──────────────────────────────
  it("counts procedural objects by template", () => {
    const procedural = [
      { id: "p1", templateId: "goblin", procedural: true },
      { id: "p2", templateId: "goblin", procedural: true },
      { id: "p3", templateId: "wolf", procedural: true },
    ];
    const result = buildEntityStatistics(procedural, []);
    expect(result.procedural.total).toBe(3);
    expect(result.procedural.byTemplate).toEqual({ goblin: 2, wolf: 1 });
    expect(result.manual.total).toBe(0);
    expect(result.combined.total).toBe(3);
  });

  // ── Cycle 3: Only manual objects ──────────────────────────────────
  it("counts manual objects by template", () => {
    const manual = [
      { id: "m1", templateId: "dragon", isManual: true },
      { id: "m2", templateId: "dragon", isManual: true },
    ];
    const result = buildEntityStatistics([], manual);
    expect(result.manual.total).toBe(2);
    expect(result.manual.byTemplate).toEqual({ dragon: 2 });
    expect(result.procedural.total).toBe(0);
    expect(result.combined.total).toBe(2);
  });

  // ── Cycle 4: Mixed procedural + manual ────────────────────────────
  it("combines procedural and manual counts correctly", () => {
    const procedural = [
      { id: "p1", templateId: "goblin", procedural: true },
      { id: "p2", templateId: "wolf", procedural: true },
    ];
    const manual = [
      { id: "m1", templateId: "goblin", isManual: true },
      { id: "m2", templateId: "boss", isManual: true },
    ];
    const result = buildEntityStatistics(procedural, manual);
    expect(result.procedural.total).toBe(2);
    expect(result.manual.total).toBe(2);
    expect(result.combined.total).toBe(4);
    expect(result.procedural.byTemplate).toEqual({ goblin: 1, wolf: 1 });
    expect(result.manual.byTemplate).toEqual({ goblin: 1, boss: 1 });
  });

  it("handles null/undefined inputs gracefully", () => {
    const result = buildEntityStatistics(null, undefined);
    expect(result.procedural.total).toBe(0);
    expect(result.manual.total).toBe(0);
    expect(result.combined.total).toBe(0);
  });

  it("groups objects without templateId under 'unknown'", () => {
    const result = buildEntityStatistics(
      [{ id: "p1" }],
      [{ id: "m1", isManual: true }],
    );
    expect(result.procedural.byTemplate).toEqual({ unknown: 1 });
    expect(result.manual.byTemplate).toEqual({ unknown: 1 });
  });
});

// ── Cycle 5: createManualEntity ─────────────────────────────────────
describe("createManualEntity", () => {
  it("creates a manual entity with isManual:true and required fields", () => {
    const template = {
      name: "Dragon Boss",
      icon: "🐉",
      hp: 500,
      damage: 80,
      defense: 30,
      xpReward: 1000,
    };
    const entity = createManualEntity("monster", "dragon_boss", template, {
      lat: 52.52,
      lng: 13.405,
    });

    expect(entity.isManual).toBe(true);
    expect(entity.type).toBe("monster");
    expect(entity.templateId).toBe("dragon_boss");
    expect(entity.name).toBe("Dragon Boss");
    expect(entity.icon).toBe("🐉");
    expect(entity.lat).toBe(52.52);
    expect(entity.lng).toBe(13.405);
    expect(entity.hp).toBe(500);
    expect(entity.maxHp).toBe(500);
  });

  it("generates a unique id with 'manual_' prefix", () => {
    const entity = createManualEntity(
      "shop",
      "blacksmith",
      { name: "Smith" },
      {
        lat: 52.0,
        lng: 13.0,
      },
    );
    expect(entity.id).toMatch(/^manual_/);
  });

  it("includes all template properties in the entity", () => {
    const template = { name: "Vault", icon: "🏦", capacity: 10 };
    const entity = createManualEntity("vault", "vault_1", template, {
      lat: 52.0,
      lng: 13.0,
    });
    expect(entity.capacity).toBe(10);
  });

  it("allows extra properties via overrides parameter", () => {
    const template = { name: "Keep", icon: "🏰" };
    const entity = createManualEntity(
      "castle",
      "stone_keep",
      template,
      {
        lat: 52.0,
        lng: 13.0,
      },
      { level: 5, cityId: "berlin" },
    );
    expect(entity.level).toBe(5);
    expect(entity.cityId).toBe("berlin");
  });
});

// ── Cycle 6: validateManualEntity ───────────────────────────────────
describe("validateManualEntity", () => {
  const validEntity = {
    id: "manual_123",
    type: "monster",
    templateId: "goblin",
    name: "Goblin",
    lat: 52.52,
    lng: 13.405,
    isManual: true,
  };

  it("returns valid for a properly formed entity", () => {
    const result = validateManualEntity(validEntity);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires type field", () => {
    const { type, ...noType } = validEntity;
    const result = validateManualEntity(noType);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("type is required");
  });

  it("requires templateId field", () => {
    const { templateId, ...noTid } = validEntity;
    const result = validateManualEntity(noTid);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("templateId is required");
  });

  it("requires valid lat/lng coordinates", () => {
    const result = validateManualEntity({
      ...validEntity,
      lat: "abc",
      lng: null,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("lat must be a number between -90 and 90");
    expect(result.errors).toContain(
      "lng must be a number between -180 and 180",
    );
  });

  it("rejects out-of-range coordinates", () => {
    const result = validateManualEntity({ ...validEntity, lat: 91, lng: -181 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("lat must be a number between -90 and 90");
    expect(result.errors).toContain(
      "lng must be a number between -180 and 180",
    );
  });

  it("requires name field", () => {
    const { name, ...noName } = validEntity;
    const result = validateManualEntity(noName);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("name is required");
  });

  it("requires isManual to be true", () => {
    const result = validateManualEntity({ ...validEntity, isManual: false });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "isManual must be true for manual entities",
    );
  });
});

// ── Cycle 7: getProceduralRulesForType ──────────────────────────────
describe("getProceduralRulesForType", () => {
  const recipe = {
    seed: 42,
    densityRatios: { monster: 1000, shop: 16000, castle: 5000 },
    layers: {
      monsters: {
        templates: [
          { templateId: "goblin", weight: 70 },
          { templateId: "wolf", weight: 30 },
        ],
      },
      shops: {
        templates: [{ templateId: "blacksmith", weight: 100 }],
      },
    },
  };

  it("extracts templates and weights for a given layer", () => {
    const rules = getProceduralRulesForType(recipe, "monsters");
    expect(rules.templates).toHaveLength(2);
    expect(rules.templates[0]).toEqual({
      templateId: "goblin",
      weight: 70,
      weightPercent: 70,
    });
    expect(rules.templates[1]).toEqual({
      templateId: "wolf",
      weight: 30,
      weightPercent: 30,
    });
  });

  it("includes densityRatio for the entity type", () => {
    const rules = getProceduralRulesForType(recipe, "monsters");
    expect(rules.densityRatio).toBe(1000);
  });

  it("returns empty templates array for non-existent layer", () => {
    const rules = getProceduralRulesForType(recipe, "vaults");
    expect(rules.templates).toEqual([]);
  });

  it("calculates total weight", () => {
    const rules = getProceduralRulesForType(recipe, "monsters");
    expect(rules.totalWeight).toBe(100);
  });

  it("calculates weight percentage for each template", () => {
    const rules = getProceduralRulesForType(recipe, "monsters");
    expect(rules.templates[0].weightPercent).toBe(70);
    expect(rules.templates[1].weightPercent).toBe(30);
  });

  it("handles null/missing recipe gracefully", () => {
    const rules = getProceduralRulesForType(null, "monsters");
    expect(rules.templates).toEqual([]);
    expect(rules.densityRatio).toBe(0);
    expect(rules.totalWeight).toBe(0);
  });

  it("maps layer name to density key correctly", () => {
    const rules = getProceduralRulesForType(recipe, "shops");
    expect(rules.densityRatio).toBe(16000);
  });
});
