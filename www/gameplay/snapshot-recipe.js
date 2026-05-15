/**
 * Snapshot Recipe — Schema, Validation & CRUD
 *
 * A "recipe" is a ~1KB Firestore document that clients use to
 * deterministically generate the world via procedural seeding.
 *
 * Collection: world_recipes
 * Status flow: draft → preview → active → draft (on deactivate)
 * Constraint: only ONE recipe can be "active" at any time.
 */

import { getDB, trackUsage } from "../firebase/firebase-service.js";

// ─── Schema Defaults ────────────────────────────────────────────────

/** Default density ratios (1 object per N square-meters of H3 cell) */
export const DEFAULT_DENSITY_RATIOS = {
  monster: 1000,
  shop: 16000,
  vault: 34783,
  castle: 5000,
  citadel: 190476,
};

/** Default H3 resolution for cell grid */
export const DEFAULT_H3_RESOLUTION = 9;

const VALID_STATUSES = ["draft", "preview", "active"];
const COLLECTION = "world_recipes";

// ─── IndexedDB Cache (separate DB to avoid version conflicts with SyncEngine) ─

const CACHE_DB_NAME = "FightCraftRecipeCache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = "active_recipe";

/** @type {IDBDatabase|null} */
let _cacheDb = null;

/** @type {object|null} Module-level in-memory cache of the active recipe */
let _activeRecipeCache = null;

/**
 * Open (or create) the recipe cache IndexedDB.
 * @returns {Promise<IDBDatabase>}
 */
async function openCacheDB() {
  if (_cacheDb) return _cacheDb;

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

    req.onerror = (e) => {
      console.error("❌ Recipe cache IndexedDB error:", e.target.error);
      reject(e.target.error);
    };

    req.onsuccess = (e) => {
      _cacheDb = e.target.result;
      resolve(_cacheDb);
    };

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: "id" });
      }
    };
  });
}

/**
 * Persist the active recipe to IndexedDB for offline / fast reload.
 * @param {object} recipe
 */
async function cacheRecipeLocally(recipe) {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const store = tx.objectStore(CACHE_STORE);
    // Clear old entries, then put the new one
    store.clear();
    store.put(recipe);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    console.log("📋 Recipe cached locally");
  } catch (err) {
    console.warn("⚠️ Could not cache recipe locally:", err.message);
  }
}

/**
 * Load the cached active recipe from IndexedDB.
 * @returns {Promise<object|null>}
 */
async function loadCachedRecipe() {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const all = store.getAll();
    return new Promise((resolve) => {
      all.onsuccess = () => resolve(all.result?.[0] ?? null);
      all.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

// ─── Validation ─────────────────────────────────────────────────────

/**
 * Validate a recipe object against the schema.
 * @param {object} recipe
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRecipe(recipe) {
  const errors = [];

  // seed
  if (!Number.isInteger(recipe.seed) || recipe.seed < 1) {
    errors.push("seed must be a positive integer");
  }

  // h3Resolution
  if (
    !Number.isInteger(recipe.h3Resolution) ||
    recipe.h3Resolution < 7 ||
    recipe.h3Resolution > 10
  ) {
    errors.push("h3Resolution must be an integer between 7 and 10");
  }

  // densityRatios
  if (!recipe.densityRatios || typeof recipe.densityRatios !== "object") {
    errors.push("densityRatios must be an object");
  } else {
    for (const [key, val] of Object.entries(recipe.densityRatios)) {
      if (!Number.isInteger(val) || val < 1) {
        errors.push(`densityRatios.${key} must be a positive integer`);
      }
    }
  }

  // layers
  if (!recipe.layers || typeof recipe.layers !== "object") {
    errors.push("layers must be an object");
  } else {
    for (const [layerName, layer] of Object.entries(recipe.layers)) {
      if (!Array.isArray(layer.templates)) {
        errors.push(`layers.${layerName}.templates must be an array`);
        continue;
      }
      for (let i = 0; i < layer.templates.length; i++) {
        const t = layer.templates[i];
        if (!t.templateId || typeof t.templateId !== "string") {
          errors.push(
            `layers.${layerName}.templates[${i}].templateId must be a non-empty string`,
          );
        }
        if (typeof t.weight !== "number" || t.weight <= 0) {
          errors.push(
            `layers.${layerName}.templates[${i}].weight must be a positive number`,
          );
        }
      }
    }
  }

  // status
  if (!VALID_STATUSES.includes(recipe.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new recipe in Firestore.
 * @param {object} config  Partial recipe — merged with defaults.
 * @returns {Promise<object>} The full saved recipe object.
 */
export async function createRecipe(config = {}) {
  const { doc, setDoc, serverTimestamp } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );

  const id = `recipe_${Date.now()}`;

  const recipe = {
    id,
    version: 1,
    status: "draft",
    seed: config.seed ?? 42,
    h3Resolution: config.h3Resolution ?? DEFAULT_H3_RESOLUTION,
    densityRatios: { ...DEFAULT_DENSITY_RATIOS, ...config.densityRatios },
    layers: config.layers ?? {
      monsters: { templates: [] },
      shops: { templates: [] },
      vaults: { templates: [] },
      castles: { templates: [] },
    },
    useProceduralEngine: config.useProceduralEngine ?? true,
    createdAt: serverTimestamp(),
    createdBy: config.createdBy ?? "unknown",
  };

  const { valid, errors } = validateRecipe(recipe);
  if (!valid) {
    console.error("❌ Recipe validation failed:", errors);
    throw new Error(`Invalid recipe: ${errors.join("; ")}`);
  }

  const db = getDB();
  const ref = doc(db, COLLECTION, id);
  await setDoc(ref, recipe);

  trackUsage("WRITE", `${COLLECTION}/${id} (createRecipe)`, 1, `${COLLECTION}/${id}`);
  console.log(`✅ Recipe created: ${id}`);
  return recipe;
}

/**
 * Load a single recipe by ID.
 * @param {string} recipeId
 * @returns {Promise<object|null>}
 */
export async function loadRecipe(recipeId) {
  const { doc } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );
  const { monitoredGetDoc } = await import("../firebase/firebase-monitor.js");

  try {
    const db = getDB();
    const ref = doc(db, COLLECTION, recipeId);
    const snap = await monitoredGetDoc(ref, `${COLLECTION}/${recipeId} (loadRecipe)`);

    if (!snap.exists()) {
      console.warn(`⚠️ Recipe not found: ${recipeId}`);
      return null;
    }

    console.log(`📋 Recipe loaded: ${recipeId}`);
    return snap.data();
  } catch (err) {
    console.error(`❌ Failed to load recipe ${recipeId}:`, err.message);
    return null;
  }
}

/**
 * Load the currently active recipe (status === 'active').
 *
 * This is THE critical function for player clients — called once at
 * startup.  Uses module-level cache + IndexedDB for offline support.
 *
 * @returns {Promise<object|null>}
 */
export async function loadActiveRecipe() {
  // 1. In-memory cache (instant)
  if (_activeRecipeCache) {
    console.log("📋 Active recipe served from memory cache");
    return _activeRecipeCache;
  }

  const { collection, query, where, getDocs, limit } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );

  try {
    const db = getDB();
    const q = query(
      collection(db, COLLECTION),
      where("status", "==", "active"),
      limit(1),
    );

    const { monitoredGetDocs } = await import("../firebase/firebase-monitor.js");
    const snap = await monitoredGetDocs(q, `${COLLECTION} where status==active (loadActiveRecipe)`);

    if (snap.empty) {
      console.warn("⚠️ No active recipe found in Firestore");

      // 2. Fallback to IndexedDB cache (offline)
      const cached = await loadCachedRecipe();
      if (cached) {
        console.log("📋 Serving stale recipe from IndexedDB cache");
        _activeRecipeCache = cached;
        return cached;
      }
      return null;
    }

    const recipe = snap.docs[0].data();
    _activeRecipeCache = recipe;
    await cacheRecipeLocally(recipe);

    console.log(`✅ Active recipe loaded: ${recipe.id} (v${recipe.version})`);
    return recipe;
  } catch (err) {
    console.error("❌ Failed to load active recipe:", err.message);

    // Offline fallback
    const cached = await loadCachedRecipe();
    if (cached) {
      console.log("📋 Serving stale recipe from IndexedDB cache (offline fallback)");
      _activeRecipeCache = cached;
      return cached;
    }
    return null;
  }
}

/**
 * Update an existing recipe with a partial patch.
 * Increments version automatically.
 * @param {string} recipeId
 * @param {object} updates  Fields to merge.
 * @returns {Promise<boolean>}
 */
export async function updateRecipe(recipeId, updates) {
  const { doc, updateDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );

  try {
    // Load current state
    const current = await loadRecipe(recipeId);
    if (!current) {
      console.error(`❌ Cannot update — recipe not found: ${recipeId}`);
      return false;
    }

    const merged = {
      ...current,
      ...updates,
      // Deep-merge nested objects if provided
      densityRatios: { ...current.densityRatios, ...updates.densityRatios },
      layers: { ...current.layers, ...updates.layers },
      version: current.version + 1,
    };

    const { valid, errors } = validateRecipe(merged);
    if (!valid) {
      console.error("❌ Recipe validation failed on update:", errors);
      return false;
    }

    const db = getDB();
    const ref = doc(db, COLLECTION, recipeId);
    await updateDoc(ref, {
      ...updates,
      densityRatios: merged.densityRatios,
      layers: merged.layers,
      version: merged.version,
    });

    // Invalidate cache if this was the active recipe
    if (_activeRecipeCache?.id === recipeId) {
      _activeRecipeCache = null;
    }

    trackUsage("WRITE", `${COLLECTION}/${recipeId} (updateRecipe)`, 1, `${COLLECTION}/${recipeId}`);
    console.log(`✅ Recipe updated: ${recipeId} → v${merged.version}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to update recipe ${recipeId}:`, err.message);
    return false;
  }
}

/**
 * Activate a recipe.  Deactivates any currently active recipe first.
 * Only ONE recipe can be active at a time.
 * @param {string} recipeId
 * @returns {Promise<boolean>}
 */
export async function activateRecipe(recipeId) {
  const { doc, updateDoc, collection, query, where, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );
  const { monitoredGetDocs } = await import("../firebase/firebase-monitor.js");

  try {
    const db = getDB();

    // 1. Deactivate any currently active recipe
    const q = query(
      collection(db, COLLECTION),
      where("status", "==", "active"),
    );
    const snap = await monitoredGetDocs(q, `${COLLECTION} where status==active (activateRecipe — deactivate old)`);

    for (const activeDoc of snap.docs) {
      if (activeDoc.id !== recipeId) {
        await updateDoc(activeDoc.ref, { status: "draft" });
        trackUsage("WRITE", `${COLLECTION}/${activeDoc.id} (deactivate old)`, 1, `${COLLECTION}/${activeDoc.id}`);
        console.log(`📋 Deactivated old recipe: ${activeDoc.id}`);
      }
    }

    // 2. Activate the target recipe
    const ref = doc(db, COLLECTION, recipeId);
    await updateDoc(ref, { status: "active" });

    // Invalidate caches so next loadActiveRecipe() fetches fresh
    _activeRecipeCache = null;

    trackUsage("WRITE", `${COLLECTION}/${recipeId} (activateRecipe)`, 1, `${COLLECTION}/${recipeId}`);
    console.log(`✅ Recipe activated: ${recipeId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to activate recipe ${recipeId}:`, err.message);
    return false;
  }
}

/**
 * Deactivate a recipe (set status back to 'draft').
 * @param {string} recipeId
 * @returns {Promise<boolean>}
 */
export async function deactivateRecipe(recipeId) {
  const { doc, updateDoc } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );

  try {
    const db = getDB();
    const ref = doc(db, COLLECTION, recipeId);
    await updateDoc(ref, { status: "draft" });

    // Invalidate cache if this was the active recipe
    if (_activeRecipeCache?.id === recipeId) {
      _activeRecipeCache = null;
    }

    trackUsage("WRITE", `${COLLECTION}/${recipeId} (deactivateRecipe)`, 1, `${COLLECTION}/${recipeId}`);
    console.log(`✅ Recipe deactivated: ${recipeId}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to deactivate recipe ${recipeId}:`, err.message);
    return false;
  }
}

/**
 * List all recipes, ordered by createdAt descending.
 * @returns {Promise<object[]>}
 */
export async function listRecipes() {
  const { collection, query, orderBy, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
  );
  const { monitoredGetDocs } = await import("../firebase/firebase-monitor.js");

  try {
    const db = getDB();
    const q = query(
      collection(db, COLLECTION),
      orderBy("createdAt", "desc"),
    );
    const snap = await monitoredGetDocs(q, `${COLLECTION} orderBy createdAt desc (listRecipes)`);

    const recipes = snap.docs.map((d) => d.data());
    console.log(`📋 Listed ${recipes.length} recipe(s)`);
    return recipes;
  } catch (err) {
    console.error("❌ Failed to list recipes:", err.message);
    return [];
  }
}

/**
 * Duplicate an existing recipe.  The copy gets a new ID and status 'draft'.
 * @param {string} recipeId  The recipe to clone.
 * @returns {Promise<object>} The newly created recipe.
 */
export async function duplicateRecipe(recipeId) {
  const source = await loadRecipe(recipeId);
  if (!source) {
    throw new Error(`Cannot duplicate — recipe not found: ${recipeId}`);
  }

  // Strip server-managed fields; createRecipe will set new id, version, timestamps
  const config = {
    seed: source.seed,
    h3Resolution: source.h3Resolution,
    densityRatios: { ...source.densityRatios },
    layers: JSON.parse(JSON.stringify(source.layers)),
    useProceduralEngine: source.useProceduralEngine,
    createdBy: source.createdBy,
  };

  const duplicate = await createRecipe(config);
  console.log(`✅ Recipe duplicated: ${recipeId} → ${duplicate.id}`);
  return duplicate;
}

// ─── Pure Layer Helpers ─────────────────────────────────────────────

/**
 * Add a template entry to a recipe layer (pure function).
 * @param {object} recipe
 * @param {string} layerName  e.g. 'monsters', 'shops'
 * @param {string} templateId
 * @param {number} weight     Positive number.
 * @returns {object} New recipe with the template added.
 */
export function addTemplateToLayer(recipe, layerName, templateId, weight) {
  const layers = JSON.parse(JSON.stringify(recipe.layers));
  if (!layers[layerName]) {
    layers[layerName] = { templates: [] };
  }
  layers[layerName].templates.push({ templateId, weight });
  return { ...recipe, layers };
}

/**
 * Remove a template entry from a recipe layer (pure function).
 * @param {object} recipe
 * @param {string} layerName
 * @param {string} templateId
 * @returns {object} New recipe with the template removed.
 */
export function removeTemplateFromLayer(recipe, layerName, templateId) {
  const layers = JSON.parse(JSON.stringify(recipe.layers));
  if (layers[layerName]) {
    layers[layerName].templates = layers[layerName].templates.filter(
      (t) => t.templateId !== templateId,
    );
  }
  return { ...recipe, layers };
}

/**
 * Update the weight of a template in a recipe layer (pure function).
 * @param {object} recipe
 * @param {string} layerName
 * @param {string} templateId
 * @param {number} newWeight
 * @returns {object} New recipe with the weight updated.
 */
export function updateTemplateWeight(recipe, layerName, templateId, newWeight) {
  const layers = JSON.parse(JSON.stringify(recipe.layers));
  if (layers[layerName]) {
    const tmpl = layers[layerName].templates.find(
      (t) => t.templateId === templateId,
    );
    if (tmpl) {
      tmpl.weight = newWeight;
    }
  }
  return { ...recipe, layers };
}
