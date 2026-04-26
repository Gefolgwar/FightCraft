// ==================== PROCEDURAL ENGINE ====================
// Deterministic client-side monster spawning via PRNG + H3 grid.
// Every player sees identical monsters at the same location — no Firestore needed.

import { latLngToH3, h3ToLatLng, H3_RES_ENTITY } from "./h3-spatial.js";
import { MONSTER_LIBRARY } from "../gameplay/data.js";

// ==================== PRNG: Mulberry32 ====================

/**
 * Mulberry32 — fast, high-quality 32-bit PRNG.
 * Returns a function that produces deterministic floats in [0, 1).
 * @param {number} seed - 32-bit integer seed
 * @returns {function(): number} RNG function returning [0, 1)
 */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================== SEED GENERATION ====================

/**
 * FNV-1a hash of an H3 index string → deterministic 32-bit unsigned integer.
 * This is the root of all procedural generation for a given cell.
 * @param {string} h3Index - H3 cell index string
 * @returns {number} 32-bit unsigned integer seed
 */
export function getWorldSeed(h3Index) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < h3Index.length; i++) {
    hash ^= h3Index.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ==================== BIOME CLASSIFICATION ====================

/**
 * Deterministic biome classification for an H3 cell.
 * The biome is derived solely from the cell's seed — it never changes.
 * @param {string} h3Index - H3 cell index string
 * @returns {string} Biome identifier ('park', 'city', 'water', 'dungeon', or 'generic')
 */
export function getBiomeForCell(h3Index) {
  const seed = getWorldSeed(h3Index);
  const rng = mulberry32(seed);
  const roll = rng();
  if (roll < 0.25) return "park";
  if (roll < 0.45) return "city";
  if (roll < 0.6) return "water";
  if (roll < 0.75) return "dungeon";
  return "generic";
}

// ==================== TEMPLATE PICKER ====================

/**
 * Biome-to-preferred-monster-type mapping.
 * `null` means any type is acceptable (generic biome).
 * @type {Object}
 */
const BIOME_TYPES = {
  park: ["scavenger", "wraith"],
  city: ["goblin", "orc", "fallen"],
  water: ["wraith", "dragon"],
  dungeon: ["skeleton", "fallen", "golem"],
  generic: null,
};

/**
 * Pick a monster template from MONSTER_LIBRARY, biased toward types that
 * thematically belong in the given biome. Falls back to the full library
 * if no biome-specific candidates exist.
 * @param {function(): number} rng - Seeded RNG function
 * @param {string} biome - Biome identifier
 * @returns {Object} A monster template from MONSTER_LIBRARY
 */
function pickTemplate(rng, biome) {
  const preferred = BIOME_TYPES[biome];
  let candidates = MONSTER_LIBRARY;

  if (preferred) {
    const filtered = MONSTER_LIBRARY.filter((m) => preferred.includes(m.type));
    if (filtered.length > 0) candidates = filtered;
  }

  return candidates[Math.floor(rng() * candidates.length)];
}

// ==================== MONSTER GENERATION PER CELL ====================

/**
 * Generate an array of monster objects deterministically for a single H3 cell.
 *
 * The monsters are fully reproducible: the same `h3Index` always yields
 * identical monsters with identical stats, positions, and IDs regardless of
 * which client calls this function.
 *
 * `playerLevel` is accepted for future level-scaling hooks but is NOT used
 * in the seed, so monsters don't change when a player levels up.
 *
 * @param {string} h3Index - H3 cell index (resolution 8 recommended)
 * @param {number} [playerLevel=1] - Player level (reserved for future scaling)
 * @returns {Array<Object>} Array of procedurally generated monster objects
 */
export function generateMonstersForCell(h3Index, playerLevel = 1) {
  const seed = getWorldSeed(h3Index);
  const rng = mulberry32(seed);
  const biome = getBiomeForCell(h3Index);
  const center = h3ToLatLng(h3Index);

  // Number of monsters per cell: 2-6 based on seed
  const count = 2 + Math.floor(rng() * 5); // 2–6

  const monsters = [];
  for (let i = 0; i < count; i++) {
    // Each monster gets its own sub-seed so they're independently deterministic.
    // 7919 is an arbitrary prime that spaces sub-seeds apart.
    const localRng = mulberry32(seed + i * 7919);

    // Position within cell: offset from center (max ~220 m in each direction)
    const latOffset = (localRng() - 0.5) * 0.004;
    const lngOffset = (localRng() - 0.5) * 0.004;

    // Pick template from MONSTER_LIBRARY (biome-aware)
    const template = pickTemplate(localRng, biome);

    // Cell "difficulty" adds 0–2 bonus levels (deterministic per cell, shared)
    const cellDifficulty = Math.floor(rng() * 3);
    const monsterLevel = template.level + cellDifficulty;

    // Scale HP/damage/defense/rewards by +15 % per bonus level
    const levelScale = 1 + (monsterLevel - template.level) * 0.15;

    // Deterministic unique ID: encodes cell + index for fast reverse lookup
    const monsterId = `proc_${h3Index}_${i}`;

    monsters.push({
      id: monsterId,
      h3Index,
      localIndex: i,
      type: "monster",
      templateId: template.templateId,
      name: template.name,
      icon: template.icon,
      class: template.class,
      level: monsterLevel,
      hp: Math.round(template.hp * levelScale),
      maxHp: Math.round(template.hp * levelScale),
      damage: Math.round(template.damage * levelScale),
      defense: Math.round(template.defense * levelScale),
      xpReward: Math.round(template.xpReward * levelScale),
      goldReward: Math.round((template.goldReward || 30) * levelScale),
      loot: template.loot || [],
      affixes: template.affixes || [],
      biome,
      lat: center.lat + latOffset,
      lng: center.lng + lngOffset,
      procedural: true,
    });
  }

  return monsters;
}

// ==================== VIEWPORT AGGREGATION ====================

/**
 * Aggregate non-defeated monsters across all H3 cells visible in the viewport.
 *
 * @param {string[]} h3Cells - Array of H3 cell index strings in the current viewport
 * @param {Set<string>} [defeatedIds=new Set()] - Set of monster IDs already defeated
 *   (persisted via SyncEngine / IndexedDB / Firestore)
 * @returns {Array<Object>} All non-defeated monsters across the given cells
 */
export function getMonstersForViewport(h3Cells, defeatedIds = new Set()) {
  const allMonsters = [];
  for (const cell of h3Cells) {
    const cellMonsters = generateMonstersForCell(cell);
    for (const m of cellMonsters) {
      if (!defeatedIds.has(m.id)) {
        allMonsters.push(m);
      }
    }
  }
  return allMonsters;
}

// ==================== SINGLE MONSTER LOOKUP ====================

/**
 * Retrieve a single procedurally generated monster by its deterministic ID.
 * Useful for combat reconnection — the ID encodes everything needed to
 * regenerate the monster without any database lookup.
 *
 * ID format: `proc_{h3Index}_{localIndex}`
 *
 * @param {string} monsterId - Deterministic monster ID (e.g. "proc_872a1070fffffff_3")
 * @returns {Object|null} The monster object, or null if the ID is invalid
 */
export function getMonsterById(monsterId) {
  if (!monsterId || typeof monsterId !== "string") return null;

  const parts = monsterId.split("_");
  // Minimum valid: ['proc', '<h3Index>', '<localIndex>']
  if (parts[0] !== "proc" || parts.length < 3) return null;

  // H3 index may itself contain underscores (unlikely but defensive)
  const h3Index = parts.slice(1, -1).join("_");
  const localIndex = parseInt(parts[parts.length - 1], 10);

  if (isNaN(localIndex) || localIndex < 0) return null;

  const cellMonsters = generateMonstersForCell(h3Index);
  return cellMonsters[localIndex] || null;
}
