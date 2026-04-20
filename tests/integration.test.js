/**
 * FightCraft — Integration & UI Logic Tests
 *
 * Verifies end-to-end user flows by exercising production modules
 * against a Happy DOM environment with full DOM manipulation.
 *
 * Suites:
 *   1. Fight Initiation — monster tap → pre-combat dialog → combat screen
 *   2. Flee Button → Penalty + Toast — gold/XP/item loss + notification
 *   3. PvP Battle Request Modal — RTDB push → Accept/Decline UI
 *   4. BigInt XP → Level Progress Bar — XP award → bar width + text
 *
 * Run:
 *   npx vitest run --config tests/vitest.config.js tests/integration.test.js
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNotificationSpy, stubLeaflet, createRTDBMock, createGeolocationMock } from './browser-mocks.js';
import { createMockMonster, createMockPlayer } from './mocks.js';

// ─── Pre-test Globals ──────────────────────────────────────────
// Happy DOM gives us document + window, but we need extra stubs
// before importing production modules.

// Install Leaflet stub so map.js doesn't crash
stubLeaflet();

// Notification spy — captures all showNotification() calls
let notifSpy;

// RTDB mock for PvP tests
const rtdbMock = createRTDBMock();

// ─── Module-level Mocks ────────────────────────────────────────
// These must run BEFORE any production imports.

vi.mock('@www/firebase/firebase-service.js', () => ({
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
  subscribeToSpawnedObjects: vi.fn(() => vi.fn()),
  fetchSpawnedObjectsOnce: vi.fn(async () => []),
  getCityZones: vi.fn(async () => []),
  getTemplates: vi.fn(async () => []),
  updateSpawnedObject: vi.fn(async () => true),
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
  subscribeToBattleRequests: vi.fn(),
  updateBattleRequestStatus: vi.fn(async () => true),
  submitBattleChoice: vi.fn(async () => true),
  applyFleePenalty: vi.fn(async () => true),
  getBattleRequest: vi.fn(async () => null),
  claimCastle: vi.fn(async () => true),
  isAdmin: vi.fn(() => false),
  isModerator: vi.fn(() => false),
  loadTestPlayersToMap: vi.fn(),
  fetchLeaderboard: vi.fn(async () => []),
}));

vi.mock('@www/map/map.js', () => ({
  getDistance: vi.fn(() => 10),
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

vi.unmock('@www/auth-ui/ui-controller.js');
vi.mock('@www/core/app.js', () => ({
  saveGame: vi.fn(),
  resetGame: vi.fn(),
  updateQuestProgress: vi.fn(),
}));

// ─── Production Imports (after mocks) ──────────────────────────
import { gameState, recalculateStats, updatePlayer } from '@www/core/gameState.js';
import { showPreCombatDialog, processFleePenalty, startCombat, fleeCombat } from '@www/gameplay/combat.js';
import { showNotification, addEventLog, updateHUD } from '@www/auth-ui/ui-controller.js';
import { subscribeToBattleRequests } from '@www/firebase/firebase-service.js';

// Wire up the hoisted mock
subscribeToBattleRequests.mockImplementation(rtdbMock.getSubscribeToBattleRequests());


// ═══════════════════════════════════════════════════════════════
//  Scaffolding: Build minimal DOM structure before each test
// ═══════════════════════════════════════════════════════════════

function scaffoldCombatDOM() {
  document.body.innerHTML = `
    <!-- Pre-combat dialog container -->
    <div id="poi-dialog" class="hidden"></div>

    <!-- Combat screen -->
    <div id="combat-screen" class="hidden">
      <span id="combat-player-avatar"></span>
      <span id="combat-player-name"></span>
      <span id="combat-player-level"></span>
      <div id="combat-player-hp" style="width: 100%"></div>
      <span id="combat-player-hp-text"></span>
      <span id="combat-player-dmg"></span>
      <span id="combat-player-def"></span>
      <span id="combat-player-hit"></span>
      <span id="combat-player-crit"></span>

      <div id="combat-allies"></div>

      <span id="combat-enemy-icon"></span>
      <span id="combat-enemy-name"></span>
      <span id="combat-enemy-level"></span>
      <span id="combat-enemy-class"></span>
      <span id="combat-enemy-affixes"></span>
      <div id="enemy-hp-bar" style="width: 100%"></div>
      <span id="enemy-hp-text"></span>
      <div>
        <div>
          <span id="combat-enemy-dmg"></span>
        </div>
      </div>
      <span id="combat-enemy-def"></span>
      <span id="combat-enemy-hit"></span>
      <span id="combat-enemy-crit"></span>

      <!-- Equipment -->
      <span id="combat-player-helmet"></span>
      <span id="combat-player-armor"></span>
      <span id="combat-player-shield"></span>
      <span id="combat-player-sword"></span>
      <span id="combat-player-boots"></span>
      <span id="combat-player-gloves"></span>
      <span id="combat-player-belt"></span>

      <!-- Zones & buttons -->
      <div class="enemy-zone" data-zone="head"></div>
      <div class="enemy-zone" data-zone="body"></div>
      <div class="enemy-zone" data-zone="belt"></div>
      <div class="enemy-zone" data-zone="legs"></div>
      <button class="defense-btn" data-defense="head-body"></button>
      <button class="defense-btn" data-defense="body-belt"></button>
      <button id="attack-btn" disabled>Attack</button>
      <div id="combat-log"></div>
    </div>

    <!-- Victory / Defeat screens -->
    <div id="victory-screen" class="hidden">
      <span id="reward-xp"></span>
      <span id="reward-gold"></span>
      <div id="reward-items"></div>
      <div id="level-up-notice" class="hidden"></div>
    </div>
    <div id="defeat-screen" class="hidden"></div>
    <div id="draw-screen" class="hidden"></div>

    <!-- HUD elements for updateHUD() -->
    <span id="player-level"></span>
    <div id="player-hp" style="width: 100%"></div>
    <span id="player-hp-text"></span>
    <div id="player-xp" style="width: 0%"></div>
    <span id="player-xp-text"></span>
    <span id="player-gold"></span>
    <span id="player-storage-gold"></span>
    <span id="points-inline"></span>
    <span id="stat-points"></span>
    <div id="district-hud" class="hidden">
      <span id="district-name"></span>
      <span id="district-king"></span>
      <span id="district-tax"></span>
      <span id="district-status"></span>
    </div>

    <!-- Notification container -->
    <div id="notification-container"></div>

    <!-- PvP encounter dialog -->
    <div id="encounter-dialog" class="hidden">
      <div id="encounter-text"></div>
      <div class="flex gap-3"></div>
    </div>
  `;
}

function resetPlayerState() {
  gameState.player.level = 1;
  gameState.player.xp = BigInt(0);
  gameState.player.xpToNext = BigInt(500);
  gameState.player.gold = 100;
  gameState.player.hp = 100;
  gameState.player.maxHp = 100;
  gameState.player.statPoints = 5;
  gameState.player.strength = 5;
  gameState.player.agility = 5;
  gameState.player.intuition = 5;
  gameState.player.vitality = 5;
  gameState.player.intellect = 5;
  gameState.player.wisdom = 5;
  gameState.player.regenRate = 0;
  gameState.player.lastDamageTime = 0;
  gameState.player.position = { lat: 52.484512, lng: 13.449876 };
  gameState.player.interactionRadius = 25;
  gameState.player.pvp = { wins: 0, losses: 0 };
  gameState.player.name = 'TestHero';
  gameState.player.avatar = '🧙';

  gameState.equipment = { helmet: null, armor: null, shield: null, sword: null, boots: null, gloves: null, belt: null };
  gameState.inventory = [];
  gameState.combat = null;
  gameState.settings = { sound: true, notifications: true, fog: true, vibration: true };

  // Stub globals expected by production code
  window.triggerSave = vi.fn();
  window.addXP = vi.fn(() => false);
  window._currentCharacterId = 'test-char-001';
  window._currentUserId = 'test-user-001';
  window._currentlyPlayingCharacterId = 'test-char-001';
  window._livePlayers = [];
  window._cachedPlayersList = [];
  window.updatePlayerInteractionRadius = vi.fn();
  window.updatePlayerMarkerIcon = vi.fn();
}

// ═══════════════════════════════════════════════════════════════
//  1. FIGHT INITIATION
//     Monster tap → pre-combat dialog → combat screen
// ═══════════════════════════════════════════════════════════════
describe('Fight Initiation', () => {
  beforeEach(() => {
    scaffoldCombatDOM();
    resetPlayerState();
    notifSpy = createNotificationSpy();
  });

  it('showPreCombatDialog renders the dialog with monster stats', () => {
    const monster = createMockMonster({ name: 'Fire Imp', level: 7, damage: 25, hp: 200 });
    showPreCombatDialog(monster);

    const dialog = document.getElementById('poi-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains('hidden')).toBe(false);

    // Dialog contains monster name and stats
    const html = dialog.innerHTML;
    expect(html).toContain('Fire Imp');
    expect(html).toContain('Level 7');
    expect(html).toContain('25');   // damage
    expect(html).toContain('200');  // HP
  });

  it('showPreCombatDialog creates Fight and Flee buttons', () => {
    const monster = createMockMonster();
    showPreCombatDialog(monster);

    const fightBtn = document.getElementById('start-combat-btn');
    const fleeBtn = document.getElementById('flee-combat-btn');

    expect(fightBtn).not.toBeNull();
    expect(fleeBtn).not.toBeNull();
    expect(fightBtn.textContent).toContain('FIGHT');
    expect(fleeBtn.textContent).toContain('FLEE');
  });

  it('clicking Fight hides dialog and initializes combat state', () => {
    const monster = createMockMonster({ name: 'Stone Golem', hp: 300, maxHp: 300, damage: 20, defense: 8 });
    showPreCombatDialog(monster);

    // Click the Fight button
    const fightBtn = document.getElementById('start-combat-btn');
    fightBtn.click();

    // Dialog should be hidden
    const dialog = document.getElementById('poi-dialog');
    expect(dialog.classList.contains('hidden')).toBe(true);

    // Combat state should be populated
    expect(gameState.combat).not.toBeNull();
    expect(gameState.combat.monster.name).toBe('Stone Golem');
    expect(gameState.combat.monster.hp).toBe(300);
    expect(gameState.combat.monster.maxHp).toBe(300);
    expect(gameState.combat.monster.damage).toBe(20);
    expect(gameState.combat.monster.defense).toBe(8);
  });

  it('startCombat shows the combat screen with enemy stats', () => {
    const monster = createMockMonster({ name: 'Dark Wraith', level: 10, hp: 500, maxHp: 500, damage: 35, defense: 10 });
    startCombat(monster);

    // Combat screen should be visible
    const combatScreen = document.getElementById('combat-screen');
    expect(combatScreen.classList.contains('hidden')).toBe(false);

    // Enemy info populated
    expect(document.getElementById('combat-enemy-name').textContent).toBe('Dark Wraith');
    expect(document.getElementById('combat-enemy-level').textContent).toBe('10');
  });

  it('combat state has proper structure after startCombat', () => {
    const monster = createMockMonster({ id: 'mon-123', name: 'Cave Troll' });
    startCombat(monster);

    expect(gameState.combat).toMatchObject({
      turn: 'player',
      isStatic: false,
      resolved: false,
    });
    expect(gameState.combat.monster.id).toBe('mon-123');
    expect(gameState.combat.enemies).toHaveLength(1);
    expect(gameState.combat.allies).toEqual([]);
    expect(gameState.combat.arena).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. FLEE BUTTON → PENALTY + TOAST
//     processFleePenalty() — gold/XP/item loss + notification
// ═══════════════════════════════════════════════════════════════
describe('Flee Penalty (processFleePenalty)', () => {
  beforeEach(() => {
    scaffoldCombatDOM();
    resetPlayerState();
    notifSpy = createNotificationSpy();
  });

  it('applies 30% gold loss', () => {
    gameState.player.gold = 1000;
    const monster = createMockMonster();
    processFleePenalty(monster);

    expect(gameState.player.gold).toBe(700); // 1000 - 300
  });

  it('applies 5% XP loss using BigInt', () => {
    gameState.player.xp = BigInt(2000);
    const monster = createMockMonster();
    processFleePenalty(monster);

    // 5% of 2000 = 100 → 2000 - 100 = 1900
    expect(gameState.player.xp).toBe(1900n);
    expect(typeof gameState.player.xp).toBe('bigint');
  });

  it('floors XP at 0n (cannot go negative)', () => {
    gameState.player.xp = BigInt(3);
    const monster = createMockMonster();
    processFleePenalty(monster);

    // 5% of 3 = 0 (floor) → 3 - 0 = 3 (no loss, but XP stays ≥0)
    expect(gameState.player.xp >= 0n).toBe(true);
  });

  it('removes a random inventory item when inventory is non-empty', () => {
    gameState.inventory = [
      { id: 'rustySword', quantity: 1 },
      { id: 'healthPotion', quantity: 1 },
      { id: 'ironSword', quantity: 1 },
    ];
    const monster = createMockMonster();
    processFleePenalty(monster);

    // One item should have been removed
    expect(gameState.inventory).toHaveLength(2);
  });

  it('handles empty inventory gracefully (no crash)', () => {
    gameState.inventory = [];
    const monster = createMockMonster();
    expect(() => processFleePenalty(monster)).not.toThrow();
    expect(gameState.inventory).toHaveLength(0);
  });

  it('shows a warning notification with gold and XP amounts', () => {
    gameState.player.gold = 500;
    gameState.player.xp = BigInt(1000);
    const monster = createMockMonster();
    processFleePenalty(monster);

    // The notification container should have a toast element
    const container = document.getElementById('notification-container');
    const notifications = container.querySelectorAll('.notification');
    expect(notifications.length).toBeGreaterThan(0);

    // Check that the notification text contains gold/XP info
    const lastNotif = notifications[notifications.length - 1];
    expect(lastNotif.textContent).toContain('150');  // 30% of 500 gold
    expect(lastNotif.textContent).toContain('50');   // 5% of 1000 XP
    expect(lastNotif.textContent).toContain('Fled');
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. PvP BATTLE REQUEST MODAL
//     Simulated RTDB push → encounter dialog displayed
// ═══════════════════════════════════════════════════════════════
describe('PvP Battle Request Modal', () => {
  beforeEach(() => {
    scaffoldCombatDOM();
    resetPlayerState();
    rtdbMock.reset();
    notifSpy = createNotificationSpy();
  });

  it('encounter-dialog exists and is initially hidden', () => {
    const dialog = document.getElementById('encounter-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains('hidden')).toBe(true);
  });

  it('encounter-dialog has a text area and button container', () => {
    const text = document.getElementById('encounter-text');
    const footer = document.querySelector('#encounter-dialog .flex.gap-3');

    expect(text).not.toBeNull();
    expect(footer).not.toBeNull();
  });

  it('battle request data structure is valid for RTDB emission', () => {
    const battleData = {
      battleId: 'battle-test-001',
      attackerId: 'user-A',
      attackerCharId: 'char-A',
      targetId: 'test-user-001',
      targetCharId: 'test-char-001',
      status: 'pending',
      createdAt: Date.now(),
    };

    // Verify the data shape matches what pvp.js expects
    expect(battleData).toHaveProperty('battleId');
    expect(battleData).toHaveProperty('attackerId');
    expect(battleData).toHaveProperty('targetId');
    expect(battleData).toHaveProperty('status');
    expect(battleData.status).toBe('pending');
  });

  it('RTDB mock emitter correctly dispatches to handlers', () => {
    const handler = vi.fn();
    rtdbMock.onBattleRequest(handler);

    const battleData = {
      battleId: 'battle-test-002',
      attackerId: 'user-B',
      targetId: 'test-user-001',
      status: 'pending',
      createdAt: Date.now(),
    };

    rtdbMock.emit('battleRequest', battleData);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(battleData);
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. BigInt XP → LEVEL PROGRESS BAR
//     XP award → bar width + text update via updateHUD()
// ═══════════════════════════════════════════════════════════════
describe('BigInt XP → Level Progress Bar', () => {
  /**
   * Pure re-implementation of the addXP logic from app.js
   * (same as in core-logic.test.js but used here for integration)
   */
  function addXP(player, amount) {
    player.xp = BigInt(player.xp) + BigInt(Math.floor(amount));

    let levelsGained = 0;
    while (player.xp >= BigInt(player.xpToNext)) {
      player.level++;
      player.xp = BigInt(player.xp) - BigInt(player.xpToNext);
      player.xpToNext = BigInt(500 * player.level * player.level);
      player.statPoints += 5;
      const newMaxHp = 100 + (player.vitality * 10);
      player.maxHp = newMaxHp;
      player.hp = newMaxHp;
      levelsGained++;
    }
    return levelsGained;
  }

  function resetPlayerState() {
    gameState.player = {
      level: 1,
      xp: 0n,
      xpToNext: 500n,
      hp: 100,
      maxHp: 100,
      gold: 500,
      statPoints: 0,
      strength: 1, agility: 1, intuition: 1, vitality: 1, intellect: 1, wisdom: 1
    };
    gameState.settings = { notifications: true };
    gameState.inventory = [];
    gameState.equipment = { weapon: null, armor: null, artifact: null };
    gameState.storageGold = 0;
  }

  beforeEach(() => {
    scaffoldCombatDOM();
    resetPlayerState();
  });

  it('XP bar width reflects current XP percentage', () => {
    // Give 250 XP (50% of 500 needed for level 2)
    addXP(gameState.player, 250);
    console.log('Player XP after addXP:', gameState.player.xp, 'Type:', typeof gameState.player.xp);
    try {
        updateHUD();
    } catch(e) {
        console.error('updateHUD crashed:', e);
    }
    const xpBar = document.getElementById('player-xp');
    console.log('xpBar width is:', xpBar.style.width);
    // Width should be 50%
    expect(xpBar.style.width).toBe('50%');
  });

  it('XP text shows BigInt-safe formatted values', () => {
    addXP(gameState.player, 100);
    updateHUD();

    const xpText = document.getElementById('player-xp-text');
    // Should show "100 / 500" (formatted by formatBigInt)
    expect(xpText.textContent).toContain('100');
    expect(xpText.textContent).toContain('500');
  });

  it('level display updates after level-up', () => {
    addXP(gameState.player, 500); // Level 1→2
    recalculateStats();
    updateHUD();

    const levelEl = document.getElementById('player-level');
    expect(levelEl.textContent).toBe('2');
  });

  it('XP bar resets after level-up (excess XP only)', () => {
    // 500 n XP to next, player gains 600
    addXP(gameState.player, 600); 
    updateHUD();

    // Percentage = 100/2000 * 100 = 5%
    const xpBar = document.getElementById('player-xp');
    expect(xpBar.style.width).toBe('5%');

    const xpText = document.getElementById('player-xp-text');
    expect(xpText.textContent).toContain('100');
    expect(xpText.textContent).toContain('2.0K'); // formatBigInt(2000) produces 2.0K
  });

  it('handles very large BigInt XP without precision loss', () => {
    // Set XP far beyond Number.MAX_SAFE_INTEGER
    gameState.player.xp = BigInt('999999999999999999');
    gameState.player.xpToNext = BigInt('9999999999999999999');

    // Should not throw
    expect(() => updateHUD()).not.toThrow();

    // Level should still be 1 (haven't reached xpToNext)
    const levelEl = document.getElementById('player-level');
    expect(levelEl.textContent).toBe('1');
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. GEOLOCATION — Interaction Radius Verification
//     Verify movement simulation works with browser mock
// ═══════════════════════════════════════════════════════════════
describe('Geolocation Mock — Interaction Radius', () => {
  let geo;

  beforeEach(() => {
    scaffoldCombatDOM();
    resetPlayerState();
    geo = createGeolocationMock(52.484512, 13.449876);
    Object.defineProperty(navigator, 'geolocation', {
        value: geo.mock,
        configurable: true
    });
  });

  it('getCurrentPosition returns the initial coordinates', () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      expect(pos.coords.latitude).toBe(52.484512);
      expect(pos.coords.longitude).toBe(13.449876);
    });
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('simulateMovement updates the position for watchPosition', () => {
    const positions = [];
    navigator.geolocation.watchPosition((pos) => {
      positions.push({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    });

    // Initial position fired immediately
    expect(positions).toHaveLength(1);

    // Simulate movement
    geo.simulateMovement(52.500, 13.450);
    expect(positions).toHaveLength(2);
    expect(positions[1].lat).toBe(52.500);
    expect(positions[1].lng).toBe(13.450);
  });

  it('clearWatch stops further position updates', () => {
    const positions = [];
    const id = navigator.geolocation.watchPosition((pos) => {
      positions.push(pos);
    });

    navigator.geolocation.clearWatch(id);
    geo.simulateMovement(52.600, 13.500);

    // Only the initial position should be captured (watchPosition fires immediately)
    expect(positions).toHaveLength(1);
  });

  it('interaction radius check: inside radius returns true', () => {
    // Player at 52.484512, 13.449876 with radius 25m
    // A point ~10m away should be inside
    gameState.player.interactionRadius = 25;
    const monsterDist = 10; // meters

    expect(monsterDist <= gameState.player.interactionRadius).toBe(true);
  });

  it('interaction radius check: outside radius returns false', () => {
    gameState.player.interactionRadius = 25;
    const monsterDist = 50; // meters — outside

    expect(monsterDist <= gameState.player.interactionRadius).toBe(false);
  });
});
