/**
 * Entity Control Center — Pure logic module for dual-purpose admin pages.
 *
 * Provides functions for:
 * - Statistics: procedural vs manual entity counts
 * - Manual entity creation and validation
 * - Procedural rules extraction from recipes
 *
 * All functions are pure (no side effects, no Firebase, no DOM).
 */

/** Map from recipe layer name to densityRatios key */
const LAYER_TO_DENSITY_KEY = {
  monsters: "monster",
  shops: "shop",
  vaults: "vault",
  castles: "castle",
  citadels: "citadel",
};

/**
 * Build statistics splitting procedural vs manual entities.
 *
 * @param {Array} proceduralObjects - Objects with procedural:true or without isManual
 * @param {Array} manualObjects     - Objects with isManual:true
 * @returns {{ procedural: {total, byTemplate}, manual: {total, byTemplate}, combined: {total} }}
 */
export function buildEntityStatistics(proceduralObjects, manualObjects) {
  const procedural = Array.isArray(proceduralObjects) ? proceduralObjects : [];
  const manual = Array.isArray(manualObjects) ? manualObjects : [];

  const procByTemplate = {};
  for (const obj of procedural) {
    const tid = obj.templateId || "unknown";
    procByTemplate[tid] = (procByTemplate[tid] || 0) + 1;
  }

  const manByTemplate = {};
  for (const obj of manual) {
    const tid = obj.templateId || "unknown";
    manByTemplate[tid] = (manByTemplate[tid] || 0) + 1;
  }

  return {
    procedural: { total: procedural.length, byTemplate: procByTemplate },
    manual: { total: manual.length, byTemplate: manByTemplate },
    combined: { total: procedural.length + manual.length },
  };
}

/**
 * Create a manual entity object ready for Firestore spawned_objects.
 *
 * @param {string} type        - Entity type: "monster", "shop", "castle", "vault"
 * @param {string} templateId  - Template identifier
 * @param {object} template    - Template data (name, icon, hp, etc.)
 * @param {{lat: number, lng: number}} coords - GPS coordinates
 * @param {object} [overrides] - Extra properties to merge
 * @returns {object} Entity object with isManual:true
 */
export function createManualEntity(
  type,
  templateId,
  template,
  coords,
  overrides = {},
) {
  const id = `manual_${templateId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const entity = {
    ...template,
    id,
    type,
    templateId,
    lat: coords.lat,
    lng: coords.lng,
    isManual: true,
    ...overrides,
  };

  // Set maxHp = hp if hp exists and maxHp wasn't explicitly set
  if (template.hp && !overrides.maxHp) {
    entity.maxHp = template.hp;
  }

  return entity;
}

/**
 * Validate a manual entity object before saving to Firestore.
 *
 * @param {object} entity - The entity object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManualEntity(entity) {
  const errors = [];

  if (!entity || typeof entity !== "object") {
    return { valid: false, errors: ["entity must be an object"] };
  }

  if (!entity.type) {
    errors.push("type is required");
  }

  if (!entity.templateId) {
    errors.push("templateId is required");
  }

  if (!entity.name) {
    errors.push("name is required");
  }

  if (typeof entity.lat !== "number" || entity.lat < -90 || entity.lat > 90) {
    errors.push("lat must be a number between -90 and 90");
  }

  if (typeof entity.lng !== "number" || entity.lng < -180 || entity.lng > 180) {
    errors.push("lng must be a number between -180 and 180");
  }

  if (entity.isManual !== true) {
    errors.push("isManual must be true for manual entities");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract procedural generation rules for a specific entity type from a recipe.
 *
 * @param {object} recipe    - The active recipe object
 * @param {string} layerName - Layer name: "monsters", "shops", "vaults", "castles"
 * @returns {{ templates: Array<{templateId, weight, weightPercent}>, densityRatio: number, totalWeight: number }}
 */
export function getProceduralRulesForType(recipe, layerName) {
  const empty = { templates: [], densityRatio: 0, totalWeight: 0 };

  if (!recipe || typeof recipe !== "object") {
    return empty;
  }

  const densityKey = LAYER_TO_DENSITY_KEY[layerName] || layerName;
  const densityRatio = recipe.densityRatios?.[densityKey] || 0;

  const layer = recipe.layers?.[layerName];
  if (
    !layer ||
    !Array.isArray(layer.templates) ||
    layer.templates.length === 0
  ) {
    return { templates: [], densityRatio, totalWeight: 0 };
  }

  const totalWeight = layer.templates.reduce(
    (sum, t) => sum + (t.weight || 0),
    0,
  );

  const templates = layer.templates.map((t) => ({
    templateId: t.templateId,
    weight: t.weight,
    weightPercent:
      totalWeight > 0 ? Math.round(((t.weight || 0) / totalWeight) * 100) : 0,
  }));

  return { templates, densityRatio, totalWeight };
}
