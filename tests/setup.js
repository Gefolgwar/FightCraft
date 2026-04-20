/**
 * Vitest Global Setup
 * 
 * Bootstraps minimal browser globals so that www/ ESM modules
 * can be imported in Node without crashing on missing APIs.
 * 
 * IMPORTANT: This file runs BEFORE every test file.
 */
import { vi } from 'vitest';
import { mockBrowserGlobals, mockFirebaseService } from './mocks.js';

// Install browser-like globals (window, document, localStorage, etc.)
mockBrowserGlobals();

// Pre-mock Firebase so any transitive import of firebase-service.js is safe
vi.mock('@www/firebase/firebase-service.js', () => mockFirebaseService());

// Pre-mock DOM-dependent modules that are transitively imported
vi.mock('@www/auth-ui/ui-controller.js', () => ({
  showNotification: vi.fn(),
  addEventLog: vi.fn(),
  updateHUD: vi.fn(),
  updateEventLogDisplay: vi.fn(),
  renderInventory: vi.fn(),
  updateAdminPlayersList: vi.fn(),
  renderOnlinePlayersList: vi.fn(),
  refreshPlayersList: vi.fn(),
  updateMultiplayerDebugUI: vi.fn(),
  refreshSettingsVisibility: vi.fn(),
}));

vi.mock('@www/map/map.js', () => ({
  getDistance: vi.fn(() => 0),
  renderStaticMonsters: vi.fn(),
  isInsideArena: vi.fn(() => true),
  initMap: vi.fn(),
  updatePlayerPosition: vi.fn(),
  updateOtherPlayers: vi.fn(),
  updateDebugCoords: vi.fn(),
  centerOnPlayer: vi.fn(),
  updateArenas: vi.fn(),
  renderArena: vi.fn(),
}));

vi.mock('@www/core/app.js', () => ({
  saveGame: vi.fn(),
}));
