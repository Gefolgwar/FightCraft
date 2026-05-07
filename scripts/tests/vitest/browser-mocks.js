/**
 * FightCraft — Browser-Specific Mocks for Integration Tests
 *
 * These mocks target APIs that exist in a browser but are either
 * missing or incomplete in Happy DOM / Node.  They are designed
 * for the integration test suite (integration.test.js).
 *
 * ─── Contents ───
 * 1. Geolocation API  — simulate movement + verify interaction radius
 * 2. Notification / Toast spy  — capture showNotification() output
 * 3. Leaflet.js stub  — prevent map.js from crashing at import
 * 4. Firebase RTDB event emitter — simulate PvP battle request push
 */
import { vi } from 'vitest';

// ════════════════════════════════════════════════════
//  1. Geolocation API Mock
// ════════════════════════════════════════════════════

/**
 * Creates a fully controllable navigator.geolocation mock.
 *
 * @param {number} [initialLat=52.484512] — starting latitude
 * @param {number} [initialLng=13.449876] — starting longitude
 * @returns {{ mock, simulateMovement, getPosition }}
 *
 * Usage:
 *   const geo = createGeolocationMock();
 *   navigator.geolocation = geo.mock;
 *   geo.simulateMovement(52.500, 13.450); // "walk" north
 */
export function createGeolocationMock(initialLat = 52.484512, initialLng = 13.449876) {
  let currentLat = initialLat;
  let currentLng = initialLng;
  let watchId = 1;

  /** Callbacks registered via watchPosition */
  const watchers = new Map();

  const mock = {
    getCurrentPosition: vi.fn((success, _error, _opts) => {
      success({
        coords: { latitude: currentLat, longitude: currentLng, accuracy: 10 },
        timestamp: Date.now(),
      });
    }),

    watchPosition: vi.fn((success, _error, _opts) => {
      const id = watchId++;
      watchers.set(id, success);
      // Immediately fire with current position
      success({
        coords: { latitude: currentLat, longitude: currentLng, accuracy: 10 },
        timestamp: Date.now(),
      });
      return id;
    }),

    clearWatch: vi.fn((id) => {
      watchers.delete(id);
    }),
  };

  /**
   * Simulate the player moving to a new location.
   * Triggers all active watchers.
   */
  function simulateMovement(newLat, newLng) {
    currentLat = newLat;
    currentLng = newLng;
    const position = {
      coords: { latitude: currentLat, longitude: currentLng, accuracy: 10 },
      timestamp: Date.now(),
    };
    watchers.forEach((cb) => cb(position));
  }

  function getPosition() {
    return { lat: currentLat, lng: currentLng };
  }

  return { mock, simulateMovement, getPosition };
}

// ════════════════════════════════════════════════════
//  2. Notification / Toast Spy
// ════════════════════════════════════════════════════

/**
 * Creates a spy that records every showNotification() call.
 *
 * Returns an object with:
 *   - fn: the vi.fn() itself (use for assertions like toHaveBeenCalled)
 *   - calls: array of { message, type } objects in call order
 *   - clear(): reset the call log
 *
 * The spy also captures window.alert() as a fallback.
 */
export function createNotificationSpy() {
  const calls = [];

  const fn = vi.fn((message, type = 'info') => {
    calls.push({ message, type, timestamp: Date.now() });
  });

  // Also intercept window.alert (some code paths use it as fallback)
  const alertFn = vi.fn((message) => {
    calls.push({ message, type: 'alert', timestamp: Date.now() });
  });

  // Install globally
  globalThis.window.alert = alertFn;

  return { fn, alertFn, calls, clear: () => { calls.length = 0; fn.mockClear(); alertFn.mockClear(); } };
}

// ════════════════════════════════════════════════════
//  3. Leaflet.js Stub
// ════════════════════════════════════════════════════

/**
 * Installs a minimal window.L (Leaflet) stub so that map.js
 * can be imported without crashing.  Every method returns `this`
 * for chaining (matching Leaflet's API pattern).
 */
export function stubLeaflet() {
  const chainable = () => {
    const self = {
      addTo: vi.fn(() => self),
      setView: vi.fn(() => self),
      remove: vi.fn(() => self),
      setLatLng: vi.fn(() => self),
      setRadius: vi.fn(() => self),
      bindPopup: vi.fn(() => self),
      openPopup: vi.fn(() => self),
      closePopup: vi.fn(() => self),
      on: vi.fn(() => self),
      off: vi.fn(() => self),
      addLayer: vi.fn(() => self),
      removeLayer: vi.fn(() => self),
      clearLayers: vi.fn(() => self),
      setZoom: vi.fn(() => self),
      fitBounds: vi.fn(() => self),
      getBounds: vi.fn(() => ({ contains: vi.fn(() => true) })),
      getCenter: vi.fn(() => ({ lat: 52.484512, lng: 13.449876 })),
      getZoom: vi.fn(() => 15),
      invalidateSize: vi.fn(() => self),
      eachLayer: vi.fn(() => self),
      setStyle: vi.fn(() => self),
      setIcon: vi.fn(() => self),
      _leaflet_id: Math.random(),
    };
    return self;
  };

  const L = {
    map: vi.fn(() => chainable()),
    tileLayer: vi.fn(() => chainable()),
    marker: vi.fn(() => chainable()),
    circle: vi.fn(() => chainable()),
    polygon: vi.fn(() => chainable()),
    popup: vi.fn(() => chainable()),
    layerGroup: vi.fn(() => chainable()),
    featureGroup: vi.fn(() => chainable()),
    divIcon: vi.fn(() => ({})),
    icon: vi.fn(() => ({})),
    latLng: vi.fn((lat, lng) => ({ lat, lng })),
    latLngBounds: vi.fn(() => ({
      contains: vi.fn(() => true),
      extend: vi.fn(),
      getCenter: vi.fn(() => ({ lat: 52.484512, lng: 13.449876 })),
    })),
    control: {
      zoom: vi.fn(() => chainable()),
      layers: vi.fn(() => chainable()),
    },
    DomUtil: {
      create: vi.fn(() => document.createElement('div')),
      addClass: vi.fn(),
      removeClass: vi.fn(),
    },
    Browser: { mobile: false, retina: false },
    CRS: { EPSG3857: {} },
  };

  globalThis.L = L;
  globalThis.window.L = L;

  return L;
}

// ════════════════════════════════════════════════════
//  4. Firebase RTDB Event Emitter (PvP Battles)
// ════════════════════════════════════════════════════

/**
 * Simulates Firebase RTDB subscriptions for PvP battle requests.
 *
 * Usage:
 *   const rtdb = createRTDBMock();
 *   // The handler from pvp.js subscribeToBattleRequests gets installed
 *   rtdb.onBattleRequest(handler);
 *
 *   // In your test, trigger a fake battle request:
 *   rtdb.emit('battleRequest', {
 *     battleId: 'battle-001',
 *     attackerId: 'user-A',
 *     targetId: 'user-B',
 *     status: 'pending',
 *     createdAt: Date.now(),
 *   });
 */
export function createRTDBMock() {
  const handlers = {
    battleRequest: [],
    battleStatusChange: [],
    unifiedCombat: [],
  };

  return {
    /** Register a handler for incoming battle requests */
    onBattleRequest(handler) {
      handlers.battleRequest.push(handler);
    },

    /** Register a handler for battle status changes */
    onBattleStatusChange(handler) {
      handlers.battleStatusChange.push(handler);
    },

    /** Register a handler for unified combat updates */
    onUnifiedCombat(handler) {
      handlers.unifiedCombat.push(handler);
    },

    /**
     * Emit an event to all registered handlers.
     * @param {'battleRequest'|'battleStatusChange'|'unifiedCombat'} event
     * @param {object} data
     */
    emit(event, data) {
      (handlers[event] || []).forEach((fn) => fn(data));
    },

    /** Reset all handlers */
    reset() {
      Object.keys(handlers).forEach((key) => { handlers[key] = []; });
    },

    /**
     * Returns a mock subscribeToBattleRequests function that
     * wires up handlers to this emitter.
     */
    getSubscribeToBattleRequests() {
      return vi.fn((onRequest, onStatusChange) => {
        if (onRequest) handlers.battleRequest.push(onRequest);
        if (onStatusChange) handlers.battleStatusChange.push(onStatusChange);
        return vi.fn(); // unsubscribe
      });
    },

    /**
     * Returns a mock subscribeToUnifiedCombat function.
     */
    getSubscribeToUnifiedCombat() {
      return vi.fn((_combatId, onUpdate) => {
        if (onUpdate) handlers.unifiedCombat.push(onUpdate);
        return vi.fn(); // unsubscribe
      });
    },
  };
}
