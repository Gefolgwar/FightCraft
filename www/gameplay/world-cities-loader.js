/**
 * world-cities-loader.js
 *
 * Async loader for world_cities.json.
 * Replaces the synchronous 35K-line ES module import with a fetch-based
 * approach that keeps the large dataset out of the JS parse/compile path.
 *
 * Usage (preferred):
 *   import { loadWorldCities, getWorldCities } from './world-cities-loader.js';
 *   const cities = await loadWorldCities();   // first call fetches, subsequent calls return cache
 *   const cities = getWorldCities();           // sync access after load (returns [] if not yet loaded)
 *
 * Backward-compat (deprecated):
 *   import { WORLD_CITIES } from './world-cities-loader.js';
 *   // Logs a deprecation warning on first access. Returns [] until loadWorldCities() resolves.
 */

let _cache = null;
let _loading = null;

/**
 * Fetch and cache the world cities array. Safe to call multiple times —
 * concurrent calls share the same in-flight promise, subsequent calls
 * return the cached result immediately.
 *
 * @returns {Promise<Array<{id:string, name:string, lat:number, lng:number, population:number, country:string}>>}
 */
export async function loadWorldCities() {
  if (_cache) return _cache;

  if (!_loading) {
    _loading = fetch(new URL('./world_cities.json', import.meta.url))
      .then(res => {
        if (!res.ok) throw new Error(`Failed to load world_cities.json: ${res.status}`);
        return res.json();
      })
      .then(data => {
        _cache = Object.freeze(data);
        _loading = null;
        console.log(`[world-cities-loader] Loaded ${_cache.length} cities`);
        return _cache;
      })
      .catch(err => {
        _loading = null;
        console.error('[world-cities-loader] Load failed:', err);
        throw err;
      });
  }

  return _loading;
}

/**
 * Synchronous access to the cached cities array.
 * Returns an empty array if loadWorldCities() hasn't resolved yet.
 *
 * @returns {Array<{id:string, name:string, lat:number, lng:number, population:number, country:string}>}
 */
export function getWorldCities() {
  if (!_cache) {
    console.warn('[world-cities-loader] getWorldCities() called before loadWorldCities() resolved — returning []');
  }
  return _cache || [];
}

// ---------------------------------------------------------------------------
// Backward-compat re-export (deprecated)
// ---------------------------------------------------------------------------

let _deprecationWarned = false;

/**
 * @deprecated Use loadWorldCities() / getWorldCities() instead.
 *
 * Accessing this named export logs a one-time deprecation warning and returns
 * the cached array (or [] if not yet loaded).
 */
export const WORLD_CITIES = new Proxy([], {
  get(target, prop, receiver) {
    if (!_deprecationWarned) {
      _deprecationWarned = true;
      console.warn(
        '[world-cities-loader] WORLD_CITIES is deprecated. ' +
        'Use "await loadWorldCities()" or "getWorldCities()" instead.'
      );
    }
    const source = _cache || target;
    const value = Reflect.get(source, prop, receiver);
    return typeof value === 'function' ? value.bind(source) : value;
  },
});
