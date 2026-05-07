/**
 * FightCraft Test Mocks
 *
 * Provides deterministic replacements for browser globals and Firebase
 * services so that game logic can be tested in a pure Node environment.
 *
 * ─── Design Principles ───
 * 1. Zero impact on /www production code.
 * 2. Mocks return sensible defaults; tests override when needed.
 * 3. BigInt-safe: all numeric mocks that touch XP use BigInt.
 */
import { vi } from 'vitest';

// ════════════════════════════════════════════════════
//  Browser Globals
// ════════════════════════════════════════════════════

/**
 * Installs minimal browser-like globals on `globalThis`
 * so that ESM modules from www/ don't crash on import.
 */
export function mockBrowserGlobals() {
  // ── localStorage ──
  const store = new Map();
  const localStorage = {
    getItem: vi.fn((key) => store.get(key) ?? null),
    setItem: vi.fn((key, val) => store.set(key, String(val))),
    removeItem: vi.fn((key) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((i) => [...store.keys()][i] ?? null),
  };
  globalThis.localStorage = localStorage;

  // ── window (if not already present) ──
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }

  // Stub window properties used by production code
  globalThis.window.triggerSave = vi.fn();
  globalThis.window.updatePlayerInteractionRadius = vi.fn();
  globalThis.window.addXP = vi.fn(() => false);
  globalThis.window._currentCharacterId = 'test-char-001';
  globalThis.window._currentUserId = 'test-user-001';
  globalThis.window._currentlyPlayingCharacterId = 'test-char-001';
  globalThis.window._livePlayers = [];
  globalThis.window._cachedPlayersList = [];

  // ── document (minimal) ──
  if (typeof globalThis.document === 'undefined') {
    const noop = () => null;
    const mockElement = {
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        toggle: vi.fn(),
        contains: vi.fn(() => false),
      },
      style: {},
      innerHTML: '',
      textContent: '',
      disabled: false,
      dataset: {},
      appendChild: vi.fn(),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onclick: null,
      scrollTop: 0,
      scrollHeight: 0,
      parentElement: null,
    };

    globalThis.document = {
      getElementById: vi.fn(() => ({ ...mockElement })),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      createElement: vi.fn(() => ({ ...mockElement })),
      body: { appendChild: vi.fn(), ...mockElement },
      addEventListener: vi.fn(),
    };
  }

  // ── location ──
  if (typeof globalThis.location === 'undefined') {
    globalThis.location = {
      href: 'http://localhost/',
      origin: 'http://localhost',
      pathname: '/',
      search: '',
      hash: '',
      reload: vi.fn(),
    };
  }

  // ── navigator ──
  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = {
      geolocation: {
        getCurrentPosition: vi.fn((success) =>
          success({ coords: { latitude: 52.484512, longitude: 13.449876 } })
        ),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
      language: 'en',
      userAgent: 'vitest-node',
    };
  }

  // ── console (already exists in Node — no override needed) ──

  // ── Date.now deterministic override (optional – tests can use vi.useFakeTimers) ──
  // We do NOT override Date.now here to keep tests closer to reality by default.

  // ── setInterval / setTimeout (already exist in Node) ──
}

// ════════════════════════════════════════════════════
//  Firebase Service Mock
// ════════════════════════════════════════════════════

/**
 * Returns a mock object matching the shape of
 * `www/firebase/firebase-service.js` exports.
 *
 * Every function is a vi.fn() so tests can assert calls and override returns.
 */
export function mockFirebaseService() {
  return {
    initFirebase: vi.fn(async () => true),
    getCurrentUser: vi.fn(() => ({
      uid: 'test-user-001',
      displayName: 'TestHero',
      email: 'test@fightcraft.local',
    })),
    savePlayerToCloud: vi.fn(async () => true),
    loadPlayerFromCloud: vi.fn(async () => null),
    saveCharacter: vi.fn(async () => true),
    getCharacter: vi.fn(async () => null),
    logout: vi.fn(async () => true),

    // Firestore
    subscribeToSpawnedObjects: vi.fn(() => vi.fn()),
    fetchSpawnedObjectsOnce: vi.fn(async () => []),
    getCityZones: vi.fn(async () => []),
    getTemplates: vi.fn(async () => []),
    updateSpawnedObject: vi.fn(async () => true),

    // RTDB
    subscribeToPlayersRTDB: vi.fn(() => vi.fn()),
    registerPlayerInRTDB: vi.fn(async () => true),
    updatePlayerStatus: vi.fn(async () => true),
    updateRTDB: vi.fn(async () => true),
    createArenaRTDB: vi.fn(async () => true),
    removeArenaRTDB: vi.fn(async () => true),
    subscribeToArenas: vi.fn(() => vi.fn()),
    createUnifiedCombatRTDB: vi.fn(async () => true),
    setGroupActiveCombatRTDB: vi.fn(async () => true),
    updateUnifiedCombatRTDB: vi.fn(async () => true),
    submitUnifiedCombatMove: vi.fn(async () => true),
    subscribeToUnifiedCombat: vi.fn(() => vi.fn()),

    // Auth helpers
    isAdmin: vi.fn(() => false),
    isModerator: vi.fn(() => false),
    claimCastle: vi.fn(async () => true),

    // Admin
    loadTestPlayersToMap: vi.fn(),
  };
}

// ════════════════════════════════════════════════════
//  Helpers for Tests
// ════════════════════════════════════════════════════

/**
 * Create a fresh player state object with sensible defaults.
 * Merges any overrides provided.
 *
 * @param {object} overrides - partial player fields to merge
 * @returns {object} - a complete player-like object
 */
export function createMockPlayer(overrides = {}) {
  return {
    level: 1,
    xp: BigInt(0),
    xpToNext: BigInt(500),
    gold: 100,
    hp: 100,
    maxHp: 100,
    statPoints: 5,
    strength: 5,
    agility: 5,
    intuition: 5,
    vitality: 5,
    intellect: 5,
    wisdom: 5,
    regenRate: 0,
    lastDamageTime: 0,
    position: { lat: 52.484512, lng: 13.449876 },
    interactionRadius: 25,
    pvp: { wins: 0, losses: 0 },
    name: 'TestHero',
    avatar: '🧙',
    ...overrides,
  };
}

/**
 * Create a fresh monster object for combat tests.
 */
export function createMockMonster(overrides = {}) {
  return {
    id: 'monster-test-001',
    name: 'Test Goblin',
    icon: '👺',
    class: 'normal',
    level: 5,
    hp: 100,
    maxHp: 100,
    damage: 15,
    defense: 3,
    xpReward: 60,
    goldReward: 20,
    hitChance: 75,
    critChance: 5,
    affixes: [],
    isPlayer: false,
    ...overrides,
  };
}
