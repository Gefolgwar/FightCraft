/**
 * FightCraft — Snapshot Recipe Tests
 *
 * Tests the pure validation and layer-manipulation functions from
 * the snapshot-recipe module:
 *   1. validateRecipe() — schema validation with rich error messages
 *   2. addTemplateToLayer() — immutable template addition
 *   3. removeTemplateFromLayer() — immutable template removal
 *   4. updateTemplateWeight() — immutable weight update
 *
 * Run: npx vitest run --config scripts/tests/vitest/vitest.config.js
 */
import { vi, describe, it, expect } from 'vitest';

// ─── Mock Firebase dependencies ────────────────────────────────
vi.mock('@www/firebase/firebase-service.js', () => ({
  getDB: vi.fn(),
  trackUsage: vi.fn(),
}));
vi.mock('@www/firebase/firebase-monitor.js', () => ({
  monitoredGetDoc: vi.fn(),
  monitoredGetDocs: vi.fn(),
}));

// ─── Module Imports ────────────────────────────────────────────
import {
  validateRecipe,
  addTemplateToLayer,
  removeTemplateFromLayer,
  updateTemplateWeight,
  DEFAULT_DENSITY_RATIOS,
  DEFAULT_H3_RESOLUTION,
} from '@www/gameplay/snapshot-recipe.js';

// ─── Test Fixtures ─────────────────────────────────────────────

/** Create a valid recipe. Merge overrides for negative test cases. */
function makeValidRecipe(overrides = {}) {
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
          { templateId: 'goblin', weight: 70 },
          { templateId: 'orc', weight: 30 },
        ],
      },
      shops: {
        templates: [{ templateId: 'blacksmith', weight: 100 }],
      },
      vaults: {
        templates: [{ templateId: 'treasure_room', weight: 50 }],
      },
      castles: {
        templates: [{ templateId: 'stone_fort', weight: 80 }],
      },
    },
    status: 'active',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
//  1. validateRecipe()
// ═══════════════════════════════════════════════════════════════
describe('validateRecipe()', () => {
  it('valid recipe returns { valid: true, errors: [] }', () => {
    const result = validateRecipe(makeValidRecipe());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts all valid statuses: draft, preview, active', () => {
    for (const status of ['draft', 'preview', 'active']) {
      const result = validateRecipe(makeValidRecipe({ status }));
      expect(result.valid).toBe(true);
    }
  });

  // ── Seed Validation ──────────────────────────────────────────

  it('missing seed produces error', () => {
    const recipe = makeValidRecipe();
    delete recipe.seed;
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('seed'),
    );
  });

  it('non-integer seed (3.14) produces error', () => {
    const result = validateRecipe(makeValidRecipe({ seed: 3.14 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('seed'),
    );
  });

  it('zero seed produces error', () => {
    const result = validateRecipe(makeValidRecipe({ seed: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('seed'),
    );
  });

  it('negative seed produces error', () => {
    const result = validateRecipe(makeValidRecipe({ seed: -5 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('seed'),
    );
  });

  it('string seed produces error', () => {
    const result = validateRecipe(makeValidRecipe({ seed: 'abc' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('seed'),
    );
  });

  // ── h3Resolution Validation ──────────────────────────────────

  it('h3Resolution below 7 produces error', () => {
    const result = validateRecipe(makeValidRecipe({ h3Resolution: 6 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('h3Resolution'),
    );
  });

  it('h3Resolution above 10 produces error', () => {
    const result = validateRecipe(makeValidRecipe({ h3Resolution: 11 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('h3Resolution'),
    );
  });

  it('non-integer h3Resolution (8.5) produces error', () => {
    const result = validateRecipe(makeValidRecipe({ h3Resolution: 8.5 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('h3Resolution'),
    );
  });

  it('h3Resolution of 7 is valid (lower bound)', () => {
    const result = validateRecipe(makeValidRecipe({ h3Resolution: 7 }));
    expect(result.valid).toBe(true);
  });

  it('h3Resolution of 10 is valid (upper bound)', () => {
    const result = validateRecipe(makeValidRecipe({ h3Resolution: 10 }));
    expect(result.valid).toBe(true);
  });

  // ── densityRatios Validation ─────────────────────────────────

  it('missing densityRatios produces error', () => {
    const recipe = makeValidRecipe();
    delete recipe.densityRatios;
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('densityRatios'),
    );
  });

  it('null densityRatios produces error', () => {
    const result = validateRecipe(makeValidRecipe({ densityRatios: null }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('densityRatios'),
    );
  });

  it('negative density ratio produces error', () => {
    const result = validateRecipe(
      makeValidRecipe({
        densityRatios: {
          monster: -100,
          shop: 16000,
          vault: 34783,
          castle: 5000,
          citadel: 190476,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('densityRatios.monster'),
    );
  });

  it('zero density ratio produces error', () => {
    const result = validateRecipe(
      makeValidRecipe({
        densityRatios: {
          monster: 0,
          shop: 16000,
          vault: 34783,
          castle: 5000,
          citadel: 190476,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('densityRatios.monster'),
    );
  });

  it('non-integer density ratio produces error', () => {
    const result = validateRecipe(
      makeValidRecipe({
        densityRatios: {
          monster: 1000.5,
          shop: 16000,
          vault: 34783,
          castle: 5000,
          citadel: 190476,
        },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('densityRatios.monster'),
    );
  });

  // ── Layers / Templates Validation ────────────────────────────

  it('missing layers produces error', () => {
    const recipe = makeValidRecipe();
    delete recipe.layers;
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('layers'),
    );
  });

  it('template without templateId produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates[0] = { weight: 50 };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('templateId'),
    );
  });

  it('template with empty string templateId produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates[0] = { templateId: '', weight: 50 };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('templateId'),
    );
  });

  it('template with zero weight produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates[0] = { templateId: 'goblin', weight: 0 };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('weight'),
    );
  });

  it('template with negative weight produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates[0] = { templateId: 'goblin', weight: -10 };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('weight'),
    );
  });

  it('template with missing weight produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates[0] = { templateId: 'goblin' };
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('weight'),
    );
  });

  it('non-array templates produces error', () => {
    const recipe = makeValidRecipe();
    recipe.layers.monsters.templates = 'not-an-array';
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('templates must be an array'),
    );
  });

  // ── Status Validation ────────────────────────────────────────

  it('invalid status produces error', () => {
    const result = validateRecipe(makeValidRecipe({ status: 'published' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('status'),
    );
  });

  it('missing status produces error', () => {
    const recipe = makeValidRecipe();
    delete recipe.status;
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('status'),
    );
  });

  // ── Multiple Errors ──────────────────────────────────────────

  it('reports multiple errors simultaneously', () => {
    const recipe = makeValidRecipe({ seed: -1, h3Resolution: 99, status: 'invalid' });
    const result = validateRecipe(recipe);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. Exported Constants
// ═══════════════════════════════════════════════════════════════
describe('Exported Constants', () => {
  it('DEFAULT_DENSITY_RATIOS has all expected keys', () => {
    expect(DEFAULT_DENSITY_RATIOS).toHaveProperty('monster');
    expect(DEFAULT_DENSITY_RATIOS).toHaveProperty('shop');
    expect(DEFAULT_DENSITY_RATIOS).toHaveProperty('vault');
    expect(DEFAULT_DENSITY_RATIOS).toHaveProperty('castle');
    expect(DEFAULT_DENSITY_RATIOS).toHaveProperty('citadel');
  });

  it('DEFAULT_DENSITY_RATIOS values are positive integers', () => {
    for (const val of Object.values(DEFAULT_DENSITY_RATIOS)) {
      expect(Number.isInteger(val)).toBe(true);
      expect(val).toBeGreaterThan(0);
    }
  });

  it('DEFAULT_H3_RESOLUTION is 9', () => {
    expect(DEFAULT_H3_RESOLUTION).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. Pure Layer Helpers
// ═══════════════════════════════════════════════════════════════
describe('addTemplateToLayer()', () => {
  it('adds a template to an existing layer', () => {
    const recipe = makeValidRecipe();
    const updated = addTemplateToLayer(recipe, 'monsters', 'skeleton', 40);

    const monsterTemplates = updated.layers.monsters.templates;
    expect(monsterTemplates).toContainEqual({ templateId: 'skeleton', weight: 40 });
    expect(monsterTemplates.length).toBe(3); // 2 original + 1 new
  });

  it('creates the layer if it does not exist', () => {
    const recipe = makeValidRecipe();
    const updated = addTemplateToLayer(recipe, 'newlayer', 'dragon', 100);

    expect(updated.layers.newlayer).toBeDefined();
    expect(updated.layers.newlayer.templates).toEqual([
      { templateId: 'dragon', weight: 100 },
    ]);
  });

  it('does not modify the original recipe (immutable)', () => {
    const recipe = makeValidRecipe();
    const originalTemplateCount = recipe.layers.monsters.templates.length;
    const originalTemplates = [...recipe.layers.monsters.templates];

    addTemplateToLayer(recipe, 'monsters', 'skeleton', 40);

    // Original should be untouched
    expect(recipe.layers.monsters.templates.length).toBe(originalTemplateCount);
    expect(recipe.layers.monsters.templates).toEqual(originalTemplates);
  });

  it('returns a new recipe object (not the same reference)', () => {
    const recipe = makeValidRecipe();
    const updated = addTemplateToLayer(recipe, 'monsters', 'skeleton', 40);

    expect(updated).not.toBe(recipe);
    expect(updated.layers).not.toBe(recipe.layers);
  });
});

describe('removeTemplateFromLayer()', () => {
  it('removes a template from a layer by templateId', () => {
    const recipe = makeValidRecipe();
    const updated = removeTemplateFromLayer(recipe, 'monsters', 'goblin');

    const monsterTemplates = updated.layers.monsters.templates;
    expect(monsterTemplates.find((t) => t.templateId === 'goblin')).toBeUndefined();
    expect(monsterTemplates.length).toBe(1); // only 'orc' remains
  });

  it('does nothing if templateId not found', () => {
    const recipe = makeValidRecipe();
    const updated = removeTemplateFromLayer(recipe, 'monsters', 'nonexistent');

    expect(updated.layers.monsters.templates.length).toBe(2);
  });

  it('does nothing if layer does not exist', () => {
    const recipe = makeValidRecipe();
    const updated = removeTemplateFromLayer(recipe, 'nonexistent_layer', 'goblin');

    // Should not throw, layers remain as they are
    expect(updated.layers.monsters.templates.length).toBe(2);
  });

  it('does not modify the original recipe (immutable)', () => {
    const recipe = makeValidRecipe();
    const originalCount = recipe.layers.monsters.templates.length;

    removeTemplateFromLayer(recipe, 'monsters', 'goblin');

    expect(recipe.layers.monsters.templates.length).toBe(originalCount);
    expect(recipe.layers.monsters.templates.find((t) => t.templateId === 'goblin')).toBeDefined();
  });

  it('returns a new recipe object (not the same reference)', () => {
    const recipe = makeValidRecipe();
    const updated = removeTemplateFromLayer(recipe, 'monsters', 'goblin');

    expect(updated).not.toBe(recipe);
    expect(updated.layers).not.toBe(recipe.layers);
  });
});

describe('updateTemplateWeight()', () => {
  it('updates the weight of an existing template', () => {
    const recipe = makeValidRecipe();
    const updated = updateTemplateWeight(recipe, 'monsters', 'goblin', 90);

    const goblin = updated.layers.monsters.templates.find(
      (t) => t.templateId === 'goblin',
    );
    expect(goblin.weight).toBe(90);
  });

  it('does not change weight of other templates in the same layer', () => {
    const recipe = makeValidRecipe();
    const updated = updateTemplateWeight(recipe, 'monsters', 'goblin', 90);

    const orc = updated.layers.monsters.templates.find(
      (t) => t.templateId === 'orc',
    );
    expect(orc.weight).toBe(30); // unchanged
  });

  it('does nothing if templateId not found', () => {
    const recipe = makeValidRecipe();
    const updated = updateTemplateWeight(recipe, 'monsters', 'nonexistent', 100);

    // Weights should remain as-is
    const goblin = updated.layers.monsters.templates.find(
      (t) => t.templateId === 'goblin',
    );
    expect(goblin.weight).toBe(70);
  });

  it('does nothing if layer does not exist', () => {
    const recipe = makeValidRecipe();
    const updated = updateTemplateWeight(recipe, 'nonexistent_layer', 'goblin', 100);

    // Original layers remain intact in the copy
    expect(updated.layers.monsters.templates.length).toBe(2);
  });

  it('does not modify the original recipe (immutable)', () => {
    const recipe = makeValidRecipe();
    const originalWeight = recipe.layers.monsters.templates.find(
      (t) => t.templateId === 'goblin',
    ).weight;

    updateTemplateWeight(recipe, 'monsters', 'goblin', 999);

    const afterWeight = recipe.layers.monsters.templates.find(
      (t) => t.templateId === 'goblin',
    ).weight;
    expect(afterWeight).toBe(originalWeight);
  });

  it('returns a new recipe object (not the same reference)', () => {
    const recipe = makeValidRecipe();
    const updated = updateTemplateWeight(recipe, 'monsters', 'goblin', 90);

    expect(updated).not.toBe(recipe);
    expect(updated.layers).not.toBe(recipe.layers);
  });
});
