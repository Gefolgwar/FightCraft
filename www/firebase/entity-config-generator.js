/**
 * Entity Config Generator — generates game objects from entityConfig at snapshot activation time.
 *
 * Pure-function module: no Firebase dependencies, no DOM, fully testable.
 * Used by the activation engine (snapshot-service.js) to create positioned
 * objects from compact config entries.
 *
 * @module entity-config-generator
 */

// ── Entity type mapping: entityConfig key → object type field ──────
const ENTITY_TYPE_MAP = {
  monsters: "monster",
  shops: "shop",
  vaults: "vault",
  castles: "castle",
  citadels: "citadel",
};

const ALL_ENTITY_TYPES = Object.keys(ENTITY_TYPE_MAP);

/**
 * Generate a random point inside a GeoJSON Polygon or MultiPolygon feature.
 * Uses rejection sampling within the bounding box.
 *
 * @param {object} feature — GeoJSON Feature with Polygon/MultiPolygon geometry
 * @returns {{lat: number, lng: number}|null}
 */
function randomPointInFeature(feature) {
  const geom = feature.geometry;
  if (!geom) return null;

  let coords;
  if (geom.type === "Polygon") {
    coords = geom.coordinates[0]; // outer ring
  } else if (geom.type === "MultiPolygon") {
    coords = geom.coordinates[0][0]; // first polygon's outer ring
  } else {
    return null;
  }

  // Compute bounding box [minLng, minLat, maxLng, maxLat]
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  // Rejection sampling: try up to 100 times
  for (let attempt = 0; attempt < 100; attempt++) {
    const lng = minLng + Math.random() * (maxLng - minLng);
    const lat = minLat + Math.random() * (maxLat - minLat);

    if (pointInPolygon([lng, lat], coords)) {
      return { lat, lng };
    }
  }

  // Fallback: centroid of the bounding box
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
}

/**
 * Ray-casting point-in-polygon test.
 * @param {[number, number]} point — [lng, lat]
 * @param {Array<[number, number]>} ring — outer ring of the polygon
 * @returns {boolean}
 */
function pointInPolygon(point, ring) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Generate game objects from an entityConfig + zone features + templates.
 *
 * For each entity type in the config:
 * - `generated` entries: distribute across zones using random point-in-polygon
 * - `manual` entries: place at specified coordinates with `isManual: true`
 *
 * @param {object} entityConfig — { monsters: [], shops: [], vaults: [], castles: [], citadels: [] }
 * @param {Array<object>} zoneFeatures — GeoJSON Features (Polygon/MultiPolygon)
 * @param {object} templatesByType — { monsters: [{id, name, icon, ...}], shops: [...], ... }
 * @param {string} snapshotId — snapshot identifier
 * @returns {Array<object>} — flat array of generated objects
 */
export function generateObjectsFromConfig(
  entityConfig,
  zoneFeatures,
  templatesByType,
  snapshotId,
) {
  if (!entityConfig) return [];

  const result = [];
  let idCounter = 0;

  for (const entityType of ALL_ENTITY_TYPES) {
    const entries = entityConfig[entityType];
    if (!entries || entries.length === 0) continue;

    const objectType = ENTITY_TYPE_MAP[entityType];
    const templates = (templatesByType && templatesByType[entityType]) || [];
    const templateMap = new Map();
    for (const t of templates) {
      templateMap.set(t.id || t.templateId, t);
    }

    for (const entry of entries) {
      if (!entry.count || entry.count <= 0) continue;

      const template = templateMap.get(entry.templateId);

      if (entry.type === "manual") {
        // Manual placement: single object at specified coordinates
        const obj = buildObject({
          template,
          templateId: entry.templateId,
          objectType,
          snapshotId,
          id: generateId(objectType, entry.templateId, idCounter++),
          lat: entry.lat,
          lng: entry.lng,
          isManual: true,
        });
        result.push(obj);
      } else {
        // Generated placement: distribute across zones
        for (let i = 0; i < entry.count; i++) {
          const point = pickRandomPoint(zoneFeatures);
          const obj = buildObject({
            template,
            templateId: entry.templateId,
            objectType,
            snapshotId,
            id: generateId(objectType, entry.templateId, idCounter++),
            lat: point ? point.lat : 0,
            lng: point ? point.lng : 0,
            isManual: false,
          });
          result.push(obj);
        }
      }
    }
  }

  return result;
}

/**
 * Pick a random point from a random zone feature.
 * @param {Array<object>} zoneFeatures
 * @returns {{lat: number, lng: number}|null}
 */
function pickRandomPoint(zoneFeatures) {
  if (!zoneFeatures || zoneFeatures.length === 0) return null;

  const feature = zoneFeatures[Math.floor(Math.random() * zoneFeatures.length)];
  return randomPointInFeature(feature);
}

/**
 * Build a game object from template + placement data.
 */
function buildObject({
  template,
  templateId,
  objectType,
  snapshotId,
  id,
  lat,
  lng,
  isManual,
}) {
  const obj = {
    id,
    templateId,
    type: objectType,
    lat,
    lng,
    snapshotId,
  };

  if (isManual) {
    obj.isManual = true;
  }

  // Merge template data if available
  if (template) {
    obj.name = template.name;
    obj.icon = template.icon;
    // Copy type-specific fields
    if (template.hp != null) obj.hp = template.hp;
    if (template.maxHp != null) obj.maxHp = template.maxHp;
    if (template.damage != null) obj.damage = template.damage;
    if (template.defense != null) obj.defense = template.defense;
    if (template.xpReward != null) obj.xpReward = template.xpReward;
    if (template.level != null) obj.level = template.level;
    if (template.osmTag != null) obj.osmTag = template.osmTag;
    if (template.inventory != null) obj.inventory = template.inventory;
    if (template.slots != null) obj.slots = template.slots;
    if (template.loot != null) obj.loot = template.loot;
    if (template.tag != null) obj.tag = template.tag;
    if (template.weight != null) obj.weight = template.weight;
  }

  return obj;
}

/**
 * Generate a unique object ID.
 */
function generateId(objectType, templateId, counter) {
  return `${objectType}_${templateId}_${Date.now()}_${counter}`;
}
