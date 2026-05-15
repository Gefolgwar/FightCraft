/**
 * Admin Recipe Adapter
 *
 * Thin bridge between the existing admin pages (admin-monsters.js,
 * admin-shops.js, admin-vaults.js, admin-castles.js) and the new
 * recipe-based procedural generation system.
 *
 * Delegates to:
 *   - snapshot-recipe.js   -> recipe CRUD (Firestore)
 *   - procedural-engine-v2.js -> deterministic object generation (pure)
 *
 * Does NOT modify any existing admin HTML or JS files.
 * Admin pages import from this adapter and call wireAdminPageToRecipe()
 * to connect their existing UI.
 */

import {
  createRecipe,
  loadActiveRecipe,
  updateRecipe,
  activateRecipe,
  deactivateRecipe,
  listRecipes,
  addTemplateToLayer,
  removeTemplateFromLayer,
  updateTemplateWeight,
  loadRecipe,
  DEFAULT_DENSITY_RATIOS,
  DEFAULT_H3_RESOLUTION,
} from '../gameplay/snapshot-recipe.js';

import {
  generateObjectsForCell,
  generateCitadelsForCity,
  getObjectsForViewport,
  calculateCityObjectCount,
  findCityForCell,
} from '../core/procedural-engine-v2.js';

import {
  getViewportCells,
  getCellsInRadius,
} from '../core/h3-spatial.js';

// ==================== CONSTANTS ====================

const LOG_PREFIX = '\uD83D\uDD27 [RecipeAdapter]';
const VALID_LAYERS = ['monsters', 'shops', 'vaults', 'castles'];
const OBJECT_TYPES = ['monster', 'shop', 'vault', 'castle', 'citadel'];

/**
 * Approximate H3 cell area in km^2 by resolution, used for totalCells estimation.
 * Source: H3 documentation average hex area values.
 */
const H3_CELL_AREA_KM2 = {
  7: 5.161293,
  8: 0.737327,
  9: 0.105332,
  10: 0.015048,
};

// ==================== STATE ====================

/** @type {Object|null} Currently loaded recipe in admin */
let _currentRecipe = null;

/** @type {Array} Objects visible in map preview */
let _previewObjects = [];

// ==================== HELPERS ====================

/**
 * Estimate total H3 cells covering a city, based on population-derived radius.
 * Uses the same radius heuristic as generateCitadelsForCity: sqrt(pop / 500),
 * clamped to [5, 50] km, then divides the circular area by the average cell area.
 *
 * @param {Object} city - City with population field
 * @param {number} resolution - H3 resolution
 * @returns {number} Estimated cell count (>= 1)
 */
function estimateCityCellCount(city, resolution) {
  const pop = city?.population;
  if (!pop || pop <= 0) return 1;

  const radiusKm = Math.max(5, Math.min(50, Math.sqrt(pop / 500)));
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  const cellArea = H3_CELL_AREA_KM2[resolution] || H3_CELL_AREA_KM2[9];
  return Math.max(1, Math.round(areaKm2 / cellArea));
}

/**
 * Build a cityContext object for the procedural engine.
 * @param {Object} city - City data
 * @param {number} resolution - H3 resolution for cell count estimation
 * @returns {Object} cityContext compatible with procedural-engine-v2
 */
function buildCityContext(city, resolution) {
  return {
    cityId: city.id ?? city.name ?? 'unknown',
    cityName: city.name ?? 'Unknown',
    population: city.population ?? 0,
    totalCells: estimateCityCellCount(city, resolution),
  };
}

/**
 * Validate a layer name.
 * @param {string} layerName
 * @returns {boolean}
 */
function isValidLayer(layerName) {
  return VALID_LAYERS.includes(layerName);
}

// ==================== PUBLIC API ====================

/**
 * Initialize the recipe adapter. Loads active recipe or creates a new draft.
 * Call this from DOMContentLoaded in each admin page.
 * @returns {Promise<Object>} The loaded/created recipe
 */
export async function initRecipeAdapter() {
  console.log(LOG_PREFIX + ' Initializing...');

  try {
    // Try loading the active recipe first
    const active = await loadActiveRecipe();
    if (active) {
      _currentRecipe = active;
      console.log(LOG_PREFIX + ' Loaded active recipe: ' + active.id + ' (v' + active.version + ')');
      return _currentRecipe;
    }

    // No active recipe -- try the most recent draft
    const all = await listRecipes();
    const draft = all.find(function (r) { return r.status === 'draft'; });
    if (draft) {
      _currentRecipe = draft;
      console.log(LOG_PREFIX + ' Loaded draft recipe: ' + draft.id);
      return _currentRecipe;
    }

    // Nothing exists -- create a fresh draft
    console.log(LOG_PREFIX + ' No recipes found, creating new draft...');
    _currentRecipe = await createRecipe();
    return _currentRecipe;
  } catch (err) {
    console.error(LOG_PREFIX + ' Init failed:', err.message);
    throw err;
  }
}

/**
 * Get the current recipe being edited.
 * @returns {Object|null}
 */
export function getCurrentRecipe() {
  return _currentRecipe;
}

/**
 * Save template selections from an admin page to the current recipe.
 * This is the NEW version of "Generate" -- instead of creating objects,
 * it saves template weights to recipe.layers.{layerName}.
 *
 * @param {string} layerName - 'monsters' | 'shops' | 'vaults' | 'castles'
 * @param {Array<{templateId: string, weight: number}>} templateSelections
 * @returns {Promise<boolean>} success
 */
export async function saveLayerTemplates(layerName, templateSelections) {
  if (!_currentRecipe) {
    console.error(LOG_PREFIX + ' No current recipe -- call initRecipeAdapter() first');
    return false;
  }

  if (!isValidLayer(layerName)) {
    console.error(LOG_PREFIX + ' Invalid layer name: ' + layerName + '. Must be one of: ' + VALID_LAYERS.join(', '));
    return false;
  }

  if (!Array.isArray(templateSelections) || templateSelections.length === 0) {
    console.warn(LOG_PREFIX + ' Empty template selections for layer "' + layerName + '"');
  }

  console.log(LOG_PREFIX + ' Saving ' + (templateSelections ? templateSelections.length : 0) + ' template(s) to layer "' + layerName + '"...');

  try {
    // Build the new layer content using the pure helper functions
    let updatedRecipe = {
      ..._currentRecipe,
      layers: JSON.parse(JSON.stringify(_currentRecipe.layers)),
    };

    // Clear existing templates in the layer, then add the new ones
    updatedRecipe.layers[layerName] = { templates: [] };

    if (Array.isArray(templateSelections)) {
      for (const sel of templateSelections) {
        if (!sel.templateId) continue;
        const weight = typeof sel.weight === 'number' && sel.weight > 0 ? sel.weight : 1;
        updatedRecipe = addTemplateToLayer(updatedRecipe, layerName, sel.templateId, weight);
      }
    }

    // Persist to Firestore via updateRecipe
    const success = await updateRecipe(_currentRecipe.id, {
      layers: updatedRecipe.layers,
    });

    if (success) {
      // Refresh local state -- version was incremented by updateRecipe
      _currentRecipe = await loadRecipe(_currentRecipe.id);
      _previewObjects = []; // Invalidate preview cache
      console.log(LOG_PREFIX + ' Layer "' + layerName + '" saved (' + (templateSelections ? templateSelections.length : 0) + ' templates)');
    }

    return success;
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to save layer templates:', err.message);
    return false;
  }
}

/**
 * Update density ratio for an object type in the current recipe.
 * @param {string} objectType - 'monster' | 'shop' | 'vault' | 'castle' | 'citadel'
 * @param {number} ratio - Population per object (higher = fewer objects)
 * @returns {Promise<boolean>} success
 */
export async function updateDensityRatio(objectType, ratio) {
  if (!_currentRecipe) {
    console.error(LOG_PREFIX + ' No current recipe -- call initRecipeAdapter() first');
    return false;
  }

  if (!OBJECT_TYPES.includes(objectType)) {
    console.error(LOG_PREFIX + ' Invalid object type: ' + objectType);
    return false;
  }

  if (typeof ratio !== 'number' || ratio < 1 || !Number.isInteger(ratio)) {
    console.error(LOG_PREFIX + ' Ratio must be a positive integer, got: ' + ratio);
    return false;
  }

  console.log(LOG_PREFIX + ' Updating density ratio: ' + objectType + ' -> 1 per ' + ratio);

  try {
    const densityPatch = {};
    densityPatch[objectType] = ratio;

    const success = await updateRecipe(_currentRecipe.id, {
      densityRatios: densityPatch,
    });

    if (success) {
      _currentRecipe = await loadRecipe(_currentRecipe.id);
      _previewObjects = [];
    }

    return success;
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to update density ratio:', err.message);
    return false;
  }
}

/**
 * Generate preview objects for the current map viewport.
 * Uses the procedural engine -- 0 Firestore reads.
 *
 * @param {Object} bounds - Map viewport bounds {north, south, east, west}
 * @param {Array<{id: string, name: string, lat: number, lng: number, population: number}>} cities
 * @param {number} [resolution=9] - H3 resolution for preview
 * @returns {Array} Preview objects (monsters, shops, etc.)
 */
export function generatePreview(bounds, cities, resolution) {
  if (!_currentRecipe) {
    console.warn(LOG_PREFIX + ' No current recipe for preview');
    return [];
  }

  if (!bounds || !cities || cities.length === 0) {
    console.warn(LOG_PREFIX + ' Missing bounds or cities for preview');
    return [];
  }

  const res = resolution != null ? resolution : (_currentRecipe.h3Resolution ?? DEFAULT_H3_RESOLUTION);

  console.log(LOG_PREFIX + ' Generating preview at resolution ' + res + '...');

  try {
    const h3Cells = getViewportCells(bounds, res);

    if (h3Cells.length === 0) {
      console.warn(LOG_PREFIX + ' No H3 cells in viewport');
      return [];
    }

    // Partition viewport cells by nearest city
    /** @type {Map<string, {city: Object, cells: string[]}>} */
    const cellsByCity = new Map();

    for (const cell of h3Cells) {
      const city = findCityForCell(cell, cities);
      if (!city) continue;

      const key = city.id ?? city.name;
      if (!cellsByCity.has(key)) {
        cellsByCity.set(key, { city: city, cells: [] });
      }
      cellsByCity.get(key).cells.push(cell);
    }

    // Generate objects per city partition
    const results = [];

    for (const entry of cellsByCity.values()) {
      const ctx = buildCityContext(entry.city, res);

      const objects = getObjectsForViewport(
        entry.cells,
        _currentRecipe,
        ctx,
        new Set() // no defeated filter in admin preview
      );
      results.push(...objects);
    }

    // Also generate citadels for cities whose centers fall within bounds
    for (const city of cities) {
      if (
        city.lat >= bounds.south && city.lat <= bounds.north &&
        city.lng >= bounds.west && city.lng <= bounds.east
      ) {
        const citadels = generateCitadelsForCity(city, _currentRecipe);
        results.push(...citadels);
      }
    }

    _previewObjects = results;
    console.log(LOG_PREFIX + ' Preview generated: ' + results.length + ' objects across ' + cellsByCity.size + ' city zone(s)');
    return results;
  } catch (err) {
    console.error(LOG_PREFIX + ' Preview generation failed:', err.message);
    return [];
  }
}

/**
 * Generate preview for a specific city area.
 * @param {Object} city - City object {id, name, lat, lng, population}
 * @param {string[]} objectTypes - Which types to preview (e.g. ['monster', 'shop'])
 * @returns {Array} Preview objects
 */
export function generateCityPreview(city, objectTypes) {
  if (!_currentRecipe) {
    console.warn(LOG_PREFIX + ' No current recipe for city preview');
    return [];
  }

  if (!city || !city.population || city.population <= 0) {
    console.warn(LOG_PREFIX + ' Invalid city for preview');
    return [];
  }

  const types = objectTypes || ['monster', 'shop', 'vault', 'castle'];
  const res = _currentRecipe.h3Resolution ?? DEFAULT_H3_RESOLUTION;

  console.log(LOG_PREFIX + ' Generating city preview: ' + city.name + ' [' + types.join(', ') + ']');

  try {
    // Get all H3 cells covering the city area
    const radiusKm = Math.max(5, Math.min(50, Math.sqrt(city.population / 500)));
    const cityCells = getCellsInRadius(city.lat, city.lng, radiusKm, res);
    const ctx = buildCityContext(city, res);
    // Use actual cell count for more accurate density
    ctx.totalCells = cityCells.length || 1;

    const results = [];

    // Non-citadel types via viewport generator
    const standardTypes = types.filter(function (t) { return t !== 'citadel'; });
    if (standardTypes.length > 0) {
      const objects = getObjectsForViewport(
        cityCells,
        _currentRecipe,
        ctx,
        new Set(),
        standardTypes
      );
      results.push(...objects);
    }

    // Citadels via dedicated generator
    if (types.includes('citadel')) {
      const citadels = generateCitadelsForCity(city, _currentRecipe);
      results.push(...citadels);
    }

    console.log(LOG_PREFIX + ' City preview: ' + results.length + ' objects for ' + city.name);
    return results;
  } catch (err) {
    console.error(LOG_PREFIX + ' City preview failed:', err.message);
    return [];
  }
}

/**
 * Get statistics about what the current recipe would generate globally.
 * @param {Array<{id: string, name: string, lat: number, lng: number, population: number}>} cities
 * @returns {Object} Stats per object type { monster: { total, perCity: Map<string, number> }, ... }
 */
export function getRecipeStats(cities) {
  if (!_currentRecipe) {
    console.warn(LOG_PREFIX + ' No current recipe for stats');
    return {};
  }

  if (!cities || cities.length === 0) {
    console.warn(LOG_PREFIX + ' No cities provided for stats');
    return {};
  }

  const stats = {};

  for (const type of OBJECT_TYPES) {
    let total = 0;
    const perCity = new Map();

    for (const city of cities) {
      const count = calculateCityObjectCount(city, _currentRecipe, type);
      total += count;
      perCity.set(city.id ?? city.name, count);
    }

    stats[type] = { total: total, perCity: perCity };
  }

  // Log summary
  const summary = {};
  for (const type of OBJECT_TYPES) {
    summary[type] = stats[type].total;
  }
  console.log(LOG_PREFIX + ' Recipe stats:', summary);

  return stats;
}

/**
 * Activate the current recipe, making it the live world for all players.
 * @returns {Promise<boolean>} success
 */
export async function activateCurrentRecipe() {
  if (!_currentRecipe) {
    console.error(LOG_PREFIX + ' No current recipe to activate');
    return false;
  }

  console.log(LOG_PREFIX + ' Activating recipe: ' + _currentRecipe.id + '...');

  try {
    const success = await activateRecipe(_currentRecipe.id);

    if (success) {
      _currentRecipe = await loadRecipe(_currentRecipe.id);
      console.log(LOG_PREFIX + ' Recipe activated: ' + _currentRecipe.id);
    }

    return success;
  } catch (err) {
    console.error(LOG_PREFIX + ' Activation failed:', err.message);
    return false;
  }
}

/**
 * Deactivate the current recipe.
 * @returns {Promise<boolean>} success
 */
export async function deactivateCurrentRecipe() {
  if (!_currentRecipe) {
    console.error(LOG_PREFIX + ' No current recipe to deactivate');
    return false;
  }

  console.log(LOG_PREFIX + ' Deactivating recipe: ' + _currentRecipe.id + '...');

  try {
    const success = await deactivateRecipe(_currentRecipe.id);

    if (success) {
      _currentRecipe = await loadRecipe(_currentRecipe.id);
      console.log(LOG_PREFIX + ' Recipe deactivated: ' + _currentRecipe.id);
    }

    return success;
  } catch (err) {
    console.error(LOG_PREFIX + ' Deactivation failed:', err.message);
    return false;
  }
}

/**
 * Create a new recipe from scratch.
 * @param {Object} [config] - Optional recipe config overrides
 * @returns {Promise<Object>} The new recipe
 */
export async function createNewRecipe(config) {
  console.log(LOG_PREFIX + ' Creating new recipe...');

  try {
    _currentRecipe = await createRecipe(config);
    _previewObjects = [];
    console.log(LOG_PREFIX + ' New recipe created: ' + _currentRecipe.id);
    return _currentRecipe;
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to create recipe:', err.message);
    throw err;
  }
}

/**
 * Load a specific recipe by ID for editing.
 * @param {string} recipeId
 * @returns {Promise<Object>} The recipe
 */
export async function loadRecipeForEditing(recipeId) {
  if (!recipeId) {
    console.error(LOG_PREFIX + ' No recipe ID provided');
    return null;
  }

  console.log(LOG_PREFIX + ' Loading recipe for editing: ' + recipeId);

  try {
    const recipe = await loadRecipe(recipeId);

    if (!recipe) {
      console.error(LOG_PREFIX + ' Recipe not found: ' + recipeId);
      return null;
    }

    _currentRecipe = recipe;
    _previewObjects = [];
    console.log(LOG_PREFIX + ' Recipe loaded: ' + recipe.id + ' (v' + recipe.version + ', status: ' + recipe.status + ')');
    return _currentRecipe;
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to load recipe:', err.message);
    return null;
  }
}

/**
 * List all available recipes for the dropdown selector.
 * @returns {Promise<Array>} Recipes sorted by createdAt desc
 */
export async function getRecipeList() {
  console.log(LOG_PREFIX + ' Fetching recipe list...');

  try {
    const recipes = await listRecipes();
    console.log(LOG_PREFIX + ' Found ' + recipes.length + ' recipe(s)');
    return recipes;
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to list recipes:', err.message);
    return [];
  }
}

/**
 * Render recipe selector dropdown HTML.
 * Called by admin pages to populate their snapshot/recipe selector.
 * @param {string} containerId - DOM element ID to render into
 * @param {Function} onSelect - Callback when a recipe is selected: (recipeId: string) => void
 */
export async function renderRecipeSelector(containerId, onSelect) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error(LOG_PREFIX + ' Container not found: #' + containerId);
    return;
  }

  console.log(LOG_PREFIX + ' Rendering recipe selector into #' + containerId);

  try {
    const recipes = await getRecipeList();

    // Build the select element
    const select = document.createElement('select');
    select.id = containerId + '-select';
    select.className = 'w-full p-2 rounded bg-gray-800 text-white border border-gray-600 text-sm';

    // "Create New" option
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = '+ Create New Recipe';
    select.appendChild(newOpt);

    // Existing recipes
    for (const recipe of recipes) {
      const opt = document.createElement('option');
      opt.value = recipe.id;

      var statusIcon = '\u26AA'; // default: white circle
      if (recipe.status === 'active') statusIcon = '\uD83D\uDFE2'; // green circle
      else if (recipe.status === 'preview') statusIcon = '\uD83D\uDFE1'; // yellow circle

      var layerCount = 0;
      if (recipe.layers) {
        var layerKeys = Object.keys(recipe.layers);
        for (var k = 0; k < layerKeys.length; k++) {
          var layer = recipe.layers[layerKeys[k]];
          layerCount += (layer.templates ? layer.templates.length : 0);
        }
      }

      opt.textContent = statusIcon + ' ' + recipe.id.replace('recipe_', 'R') + ' (v' + recipe.version + ', ' + layerCount + ' templates)';

      // Pre-select the current recipe
      if (_currentRecipe && recipe.id === _currentRecipe.id) {
        opt.selected = true;
      }

      select.appendChild(opt);
    }

    // Wire up change handler
    select.addEventListener('change', async function () {
      const val = select.value;

      if (val === 'new') {
        const newRecipe = await createNewRecipe();
        if (onSelect) onSelect(newRecipe.id);
        // Re-render to include the new recipe in the list
        await renderRecipeSelector(containerId, onSelect);
      } else {
        await loadRecipeForEditing(val);
        if (onSelect) onSelect(val);
      }
    });

    // Replace container contents
    container.innerHTML = '';
    container.appendChild(select);
  } catch (err) {
    console.error(LOG_PREFIX + ' Failed to render recipe selector:', err.message);
    container.innerHTML = '<span class="text-red-400 text-xs">Failed to load recipes</span>';
  }
}

/**
 * Wire up existing admin page UI to recipe mode.
 * This maps existing button clicks to recipe operations.
 *
 * @param {Object} config
 * @param {string} config.layerName - 'monsters' | 'shops' | 'vaults' | 'castles'
 * @param {Function} config.getSelectedTemplates - Returns current template selections [{templateId, weight}]
 * @param {Function} [config.onPreviewGenerated] - Callback with preview objects
 * @param {Function} [config.onRecipeActivated] - Callback after activation
 * @param {Function} [config.onError] - Error callback
 */
export function wireAdminPageToRecipe(config) {
  if (!config || !config.layerName || !config.getSelectedTemplates) {
    console.error(LOG_PREFIX + ' wireAdminPageToRecipe: missing required config (layerName, getSelectedTemplates)');
    return;
  }

  if (!isValidLayer(config.layerName)) {
    console.error(LOG_PREFIX + ' wireAdminPageToRecipe: invalid layer "' + config.layerName + '"');
    return;
  }

  const layerName = config.layerName;
  const getSelectedTemplates = config.getSelectedTemplates;
  const onPreviewGenerated = config.onPreviewGenerated || null;
  const onRecipeActivated = config.onRecipeActivated || null;
  const onError = config.onError || null;
  const handleError = onError || function (msg) { console.error(LOG_PREFIX + ' Error:', msg); };

  console.log(LOG_PREFIX + ' Wiring admin page for layer "' + layerName + '"');

  // -- Recipe-mode "Generate" --
  // Saves template weights to the recipe instead of creating objects.
  window.recipeGenerate = async function () {
    try {
      const selections = getSelectedTemplates();
      if (!selections || selections.length === 0) {
        handleError('No templates selected');
        return;
      }

      const success = await saveLayerTemplates(layerName, selections);
      if (!success) {
        handleError('Failed to save layer templates');
        return;
      }

      console.log(LOG_PREFIX + ' Layer "' + layerName + '" saved to recipe');

      // Generate a preview if a callback is provided
      if (onPreviewGenerated) {
        onPreviewGenerated(_previewObjects);
      }
    } catch (err) {
      handleError(err.message || err);
    }
  };

  // -- Recipe-mode "Activate" --
  // Sets the recipe to active status.
  window.recipeActivate = async function () {
    try {
      const success = await activateCurrentRecipe();
      if (!success) {
        handleError('Failed to activate recipe');
        return;
      }

      console.log(LOG_PREFIX + ' Recipe activated');

      if (onRecipeActivated) {
        onRecipeActivated(_currentRecipe);
      }
    } catch (err) {
      handleError(err.message || err);
    }
  };

  // -- Recipe-mode "Deactivate" --
  window.recipeDeactivate = async function () {
    try {
      const success = await deactivateCurrentRecipe();
      if (!success) {
        handleError('Failed to deactivate recipe');
        return;
      }

      console.log(LOG_PREFIX + ' Recipe deactivated');
    } catch (err) {
      handleError(err.message || err);
    }
  };

  // -- Recipe-mode "Preview" --
  // Generates a viewport preview using the procedural engine.
  window.recipePreview = function (bounds, cities, resolution) {
    try {
      const objects = generatePreview(bounds, cities, resolution);

      if (onPreviewGenerated) {
        onPreviewGenerated(objects);
      }

      return objects;
    } catch (err) {
      handleError(err.message || err);
      return [];
    }
  };

  console.log(LOG_PREFIX + ' Admin page wired. Globals: recipeGenerate(), recipeActivate(), recipeDeactivate(), recipePreview()');
}
