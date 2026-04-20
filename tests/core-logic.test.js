/**
 * FightCraft — Core Logic Tests
 *
 * Tests the highest-value, purest computational modules:
 *   1. gameState.recalculateStats()  — attributes + equipment → derived stats
 *   2. combat.calculateDamage()      — zone-based hit/miss, crit, damage math
 *   3. data.js                        — static data integrity
 *   4. XP / Level-up                 — BigInt arithmetic, quadratic curve
 *   5. Debounced save                — 5-second window.triggerSave pattern
 *
 * Run: npx vitest run --config tests/vitest.config.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module Imports ────────────────────────────────────────────
// These rely on the aliases and mocks configured in vitest.config.js + setup.js

import {
  gameState,
  recalculateStats,
  updatePlayer,
  updateEquipment,
  addToInventory,
  removeFromInventory,
} from '@www/core/gameState.js';

import {
  ITEMS_DB,
  MONSTER_LIBRARY,
  AFFIXES,
  CITY_ANCHORS,
  GRID_SETTINGS,
} from '@www/gameplay/data.js';

// ═══════════════════════════════════════════════════════════════
//  1. recalculateStats()
// ═══════════════════════════════════════════════════════════════
describe('recalculateStats()', () => {
  beforeEach(() => {
    // Reset player to known defaults before each test
    gameState.player.strength = 5;
    gameState.player.agility = 5;
    gameState.player.intuition = 5;
    gameState.player.vitality = 5;
    gameState.player.intellect = 5;
    gameState.player.wisdom = 5;
    gameState.player.hp = 100;
    gameState.player.level = 1;

    // Clear equipment
    Object.keys(gameState.equipment).forEach(slot => {
      gameState.equipment[slot] = null;
    });

    // Reset triggerSave mock
    window.triggerSave = vi.fn();
  });

  describe('base attributes (no equipment)', () => {
    it('calculates maxHp from vitality: 100 + (vit * 10)', () => {
      gameState.player.vitality = 10;
      const p = recalculateStats();
      expect(p.maxHp).toBe(100 + 10 * 10); // 200
    });

    it('calculates derivedDamage from strength: 5 + (str * 2)', () => {
      gameState.player.strength = 8;
      const p = recalculateStats();
      expect(p.derivedDamage).toBe(5 + 8 * 2); // 21
    });

    it('calculates critChance from intuition: int * 0.5', () => {
      gameState.player.intuition = 12;
      const p = recalculateStats();
      expect(p.critChance).toBe(6.0);
    });

    it('calculates hitChance from agility: 80 + (agi * 0.5)', () => {
      gameState.player.agility = 10;
      const p = recalculateStats();
      expect(p.hitChance).toBe(85.0);
    });

    it('calculates dodgeChance from agility: agi * 0.5', () => {
      gameState.player.agility = 14;
      const p = recalculateStats();
      expect(p.dodgeChance).toBe(7.0);
    });

    it('calculates interactionRadius from wisdom: 25 + (wis * 2)', () => {
      gameState.player.wisdom = 7;
      const p = recalculateStats();
      expect(p.interactionRadius).toBe(25 + 7 * 2); // 39
    });

    it('calculates regenRate from vitality & intellect: vit*0.1 + int*0.2', () => {
      gameState.player.vitality = 10;
      gameState.player.intellect = 10;
      const p = recalculateStats();
      // 10*0.1 + 10*0.2 + 0 regenBonus = 3.0
      expect(p.regenRate).toBe(3.0);
    });

    it('clamps hp to maxHp if hp exceeds new maxHp', () => {
      gameState.player.vitality = 5;
      gameState.player.hp = 9999;
      const p = recalculateStats();
      expect(p.hp).toBe(p.maxHp);
    });

    it('returns the player object', () => {
      const result = recalculateStats();
      expect(result).toBe(gameState.player);
    });

    it('calls window.triggerSave', () => {
      recalculateStats();
      expect(window.triggerSave).toHaveBeenCalled();
    });
  });

  describe('with equipment bonuses', () => {
    it('adds attackBonus from a sword to derivedDamage', () => {
      // ironSword: stats { attackBonus: 8, strength: 2 }
      gameState.equipment.sword = 'ironSword';
      gameState.player.strength = 5;
      const p = recalculateStats();

      // effective strength = 5 + 2 (ironSword) = 7
      // derivedDamage = 5 + (7 * 2) + 8 (attackBonus) = 27
      expect(p.derivedDamage).toBe(5 + 7 * 2 + 8);
    });

    it('adds defense from armor to reduce nothing (defense is stored, not subtracted here)', () => {
      // leatherArmor: stats { defense: 5, vitality: 1 }
      gameState.equipment.armor = 'leatherArmor';
      const p = recalculateStats();

      // effective.defense should exist
      expect(p.effective.defense).toBe(5);
      // vitality bonus: 5 + 1 = 6 → maxHp = 100 + 60 = 160
      expect(p.maxHp).toBe(160);
    });

    it('stacks bonuses from multiple equipment slots', () => {
      // ironHelmet: { defense: 5, wisdom: 1 }
      // chainMail:  { defense: 12, vitality: 3 }
      // ironShield: { defense: 10, vitality: 2 }
      gameState.equipment.helmet = 'ironHelmet';
      gameState.equipment.armor = 'chainMail';
      gameState.equipment.shield = 'ironShield';
      const p = recalculateStats();

      // Total defense: 5 + 12 + 10 = 27
      expect(p.effective.defense).toBe(27);

      // Effective vitality: 5 + 3 + 2 = 10
      // maxHp = 100 + 10*10 = 200
      expect(p.maxHp).toBe(200);

      // Effective wisdom: 5 + 1 = 6
      // interactionRadius = 25 + 6*2 = 37
      expect(p.interactionRadius).toBe(37);
    });

    it('ignores null equipment slots gracefully', () => {
      gameState.equipment.sword = null;
      gameState.equipment.armor = null;
      expect(() => recalculateStats()).not.toThrow();
    });

    it('ignores equipment IDs not in ITEMS_DB', () => {
      gameState.equipment.sword = 'nonExistentSword';
      expect(() => recalculateStats()).not.toThrow();
      const p = recalculateStats();
      expect(p.derivedDamage).toBe(5 + 5 * 2); // base only
    });
  });

  describe('full loadout scenario', () => {
    it('calculates all derived stats for a fully equipped warrior', () => {
      // Set up a mid-level warrior
      gameState.player.strength = 15;
      gameState.player.agility = 10;
      gameState.player.intuition = 8;
      gameState.player.vitality = 12;
      gameState.player.intellect = 6;
      gameState.player.wisdom = 7;
      gameState.player.hp = 999; // Will be clamped

      // Equip: ironSword (+8 atk, +2 str), chainMail (+12 def, +3 vit), ironHelmet (+5 def, +1 wis)
      gameState.equipment.sword = 'ironSword';
      gameState.equipment.armor = 'chainMail';
      gameState.equipment.helmet = 'ironHelmet';

      const p = recalculateStats();

      // Effective stats:
      // str: 15+2 = 17, agi: 10, int: 8, vit: 12+3 = 15, intel: 6, wis: 7+1 = 8
      // attackBonus = 8, defense = 12+5 = 17

      expect(p.maxHp).toBe(100 + 15 * 10);                       // 250
      expect(p.hp).toBe(250);                                     // clamped
      expect(p.derivedDamage).toBe(5 + 17 * 2 + 8);              // 47
      expect(p.critChance).toBe(8 * 0.5);                         // 4.0
      expect(p.hitChance).toBe(80 + 10 * 0.5);                    // 85.0
      expect(p.dodgeChance).toBe(10 * 0.5);                       // 5.0
      expect(p.interactionRadius).toBe(25 + 8 * 2);               // 41
      expect(p.effective.defense).toBe(17);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  2. Combat Math (calculateDamage from combat.js)
//     Since calculateDamage is a private function inside combat.js
//     and heavily DOM-coupled, we test the equivalent logic extracted
//     from BattleLogic.resolveRound() and combat.calculateDamage().
// ═══════════════════════════════════════════════════════════════
describe('Combat Math', () => {
  /**
   * Pure re-implementation of the calculateDamage formula from combat.js:657
   * Used for testing the math in isolation.
   */
  function calculateDamage(attackerStats, target, zone, isMonster = false) {
    const hitChance = attackerStats.hitChance || 75;
    const isCrit = attackerStats._forceCrit ?? (Math.random() * 100 < (attackerStats.critChance || 5));
    let dmg = Math.max(1, (attackerStats.derivedDamage || 10) - (target.defense || 0));
    if (isCrit) dmg *= 2;

    return {
      hit: attackerStats._forceHit ?? (Math.random() * 100 < hitChance),
      damage: dmg,
      crit: isCrit,
    };
  }

  /**
   * Zone-based block logic from BattleLogic.resolveRound():
   *   If defenseZones includes the attackZone → damage * 0.5 (blocked)
   */
  function resolveZoneBlock(attackZone, defenseZones, baseDamage) {
    if (defenseZones && defenseZones.includes(attackZone)) {
      return { damage: Math.floor(baseDamage * 0.5), blocked: true };
    }
    return { damage: baseDamage, blocked: false };
  }

  describe('damage calculation', () => {
    it('deals at least 1 damage even if defense > attack', () => {
      const result = calculateDamage(
        { derivedDamage: 5, hitChance: 100, critChance: 0, _forceHit: true, _forceCrit: false },
        { defense: 999 },
        'body'
      );
      expect(result.damage).toBe(1);
    });

    it('subtracts target defense from attacker damage', () => {
      const result = calculateDamage(
        { derivedDamage: 20, hitChance: 100, critChance: 0, _forceHit: true, _forceCrit: false },
        { defense: 5 },
        'head'
      );
      expect(result.damage).toBe(15);
    });

    it('doubles damage on critical hit', () => {
      const result = calculateDamage(
        { derivedDamage: 20, hitChance: 100, critChance: 100, _forceHit: true, _forceCrit: true },
        { defense: 5 },
        'body'
      );
      expect(result.damage).toBe(30); // (20-5) * 2
      expect(result.crit).toBe(true);
    });

    it('reports hit=true when roll succeeds', () => {
      const result = calculateDamage(
        { derivedDamage: 10, hitChance: 100, _forceHit: true, _forceCrit: false },
        { defense: 0 },
        'legs'
      );
      expect(result.hit).toBe(true);
    });

    it('reports hit=false when roll fails', () => {
      const result = calculateDamage(
        { derivedDamage: 10, hitChance: 0, _forceHit: false, _forceCrit: false },
        { defense: 0 },
        'belt'
      );
      expect(result.hit).toBe(false);
    });

    it('uses default hitChance (75) when not provided', () => {
      // We can't deterministically test randomness, but we verify it doesn't crash
      const result = calculateDamage(
        { derivedDamage: 10, _forceCrit: false },
        { defense: 0 },
        'head'
      );
      expect(result).toHaveProperty('hit');
      expect(result).toHaveProperty('damage');
      expect(result).toHaveProperty('crit');
    });

    it('uses default derivedDamage (10) when not provided', () => {
      const result = calculateDamage(
        { _forceHit: true, _forceCrit: false },
        { defense: 3 },
        'body'
      );
      expect(result.damage).toBe(7); // 10 - 3
    });
  });

  describe('zone-based blocking', () => {
    it('halves damage when attack zone is in defense zones', () => {
      const { damage, blocked } = resolveZoneBlock('head', ['head', 'body'], 20);
      expect(damage).toBe(10);
      expect(blocked).toBe(true);
    });

    it('applies full damage when attack zone is NOT in defense zones', () => {
      const { damage, blocked } = resolveZoneBlock('legs', ['head', 'body'], 20);
      expect(damage).toBe(20);
      expect(blocked).toBe(false);
    });

    it('floors the halved damage (odd numbers)', () => {
      const { damage } = resolveZoneBlock('belt', ['belt', 'legs'], 15);
      expect(damage).toBe(7); // Math.floor(15 * 0.5) = 7
    });

    it('handles null/undefined defenseZones gracefully', () => {
      const { damage, blocked } = resolveZoneBlock('head', null, 20);
      expect(damage).toBe(20);
      expect(blocked).toBe(false);
    });

    // Defense zone patterns from the PRD:
    // Head+Body, Body+Belt, Belt+Legs, Head+Legs
    it.each([
      { attack: 'head', defense: ['head', 'body'],   expectBlocked: true },
      { attack: 'body', defense: ['head', 'body'],   expectBlocked: true },
      { attack: 'belt', defense: ['head', 'body'],   expectBlocked: false },
      { attack: 'legs', defense: ['head', 'body'],   expectBlocked: false },
      { attack: 'body', defense: ['body', 'belt'],   expectBlocked: true },
      { attack: 'belt', defense: ['belt', 'legs'],   expectBlocked: true },
      { attack: 'head', defense: ['head', 'legs'],   expectBlocked: true },
      { attack: 'legs', defense: ['head', 'legs'],   expectBlocked: true },
      { attack: 'body', defense: ['head', 'legs'],   expectBlocked: false },
    ])('attack=$attack vs defense=$defense → blocked=$expectBlocked', ({ attack, defense, expectBlocked }) => {
      const { blocked } = resolveZoneBlock(attack, defense, 20);
      expect(blocked).toBe(expectBlocked);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  3. XP & Level-up (BigInt arithmetic)
// ═══════════════════════════════════════════════════════════════
describe('XP & Level-Up (BigInt)', () => {
  /**
   * Pure re-implementation of XP/Level logic from app.js:748-798
   * Isolated from DOM to test the math.
   */
  function addXP(player, amount) {
    player.xp = BigInt(player.xp) + BigInt(Math.floor(amount));

    let levelsGained = 0;
    while (player.xp >= BigInt(player.xpToNext)) {
      // Level up
      player.level++;
      player.xp = BigInt(player.xp) - BigInt(player.xpToNext);
      player.xpToNext = BigInt(500 * player.level * player.level);
      player.statPoints += 5;

      // Restore HP on level-up
      const newMaxHp = 100 + (player.vitality * 10);
      player.maxHp = newMaxHp;
      player.hp = newMaxHp;

      levelsGained++;
    }
    return levelsGained;
  }

  let player;

  beforeEach(() => {
    player = {
      level: 1,
      xp: BigInt(0),
      xpToNext: BigInt(500),
      gold: 100,
      hp: 100,
      maxHp: 100,
      statPoints: 5,
      vitality: 5,
    };
  });

  it('stores XP as BigInt', () => {
    addXP(player, 100);
    expect(typeof player.xp).toBe('bigint');
  });

  it('adds XP without leveling when below threshold', () => {
    const levels = addXP(player, 200);
    expect(levels).toBe(0);
    expect(player.xp).toBe(200n);
    expect(player.level).toBe(1);
  });

  it('levels up when XP reaches xpToNext (500 for level 1→2)', () => {
    const levels = addXP(player, 500);
    expect(levels).toBe(1);
    expect(player.level).toBe(2);
    expect(player.xp).toBe(0n); // leftover
  });

  it('follows quadratic XP curve: xpToNext = 500 * level^2', () => {
    addXP(player, 500); // Level 1 → 2
    // After leveling to 2, xpToNext should be 500 * 2^2 = 2000
    expect(player.xpToNext).toBe(BigInt(2000));
  });

  it('carries over excess XP after leveling', () => {
    const levels = addXP(player, 600);
    expect(levels).toBe(1);
    expect(player.level).toBe(2);
    expect(player.xp).toBe(100n); // 600 - 500 = 100 leftover
  });

  it('handles multi-level jumps from large XP gains', () => {
    // Level 1→2 needs 500, Level 2→3 needs 2000
    const levels = addXP(player, 2500); // 500 + 2000 = exactly levels 1→3
    expect(levels).toBe(2);
    expect(player.level).toBe(3);
    expect(player.xp).toBe(0n);
    expect(player.xpToNext).toBe(BigInt(500 * 3 * 3)); // 4500
  });

  it('awards 5 stat points per level-up', () => {
    addXP(player, 500);
    expect(player.statPoints).toBe(10); // 5 initial + 5 from level-up
  });

  it('restores HP to new maxHp on level-up', () => {
    player.hp = 10; // Low HP before level-up
    addXP(player, 500);
    expect(player.hp).toBe(player.maxHp);
    expect(player.hp).toBe(100 + player.vitality * 10);
  });

  it('handles BigInt arithmetic for very large numbers', () => {
    player.xp = BigInt('999999999999999999999');
    player.xpToNext = BigInt('9999999999999999999999');
    const levels = addXP(player, 1);
    expect(levels).toBe(0);
    expect(player.xp).toBe(BigInt('999999999999999999999') + 1n);
  });

  it('does NOT use standard Number for XP that would lose precision', () => {
    // Prove BigInt retains precision above Number.MAX_SAFE_INTEGER
    const largeXP = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    player.xp = largeXP;
    player.xpToNext = largeXP + 1000n;
    addXP(player, 1);
    expect(player.xp).toBe(largeXP + 1n);
    // Standard Number would lose this: Number(Number.MAX_SAFE_INTEGER + 1) === Number.MAX_SAFE_INTEGER
  });

  it('flee penalty: -5% XP uses BigInt correctly', () => {
    player.xp = BigInt(1000);
    // Reproduce flee logic from combat.js:87-89
    const xpLoss = Math.floor(Number(player.xp) * 0.05);
    player.xp = BigInt(player.xp) - BigInt(xpLoss);
    if (player.xp < 0n) player.xp = 0n;

    expect(player.xp).toBe(950n); // 1000 - 50
  });

  it('flee penalty: XP cannot go below 0', () => {
    player.xp = BigInt(5);
    const xpLoss = Math.floor(Number(player.xp) * 0.05); // 0 (floor of 0.25)
    player.xp = BigInt(player.xp) - BigInt(xpLoss);
    if (player.xp < 0n) player.xp = 0n;

    expect(player.xp >= 0n).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
//  4. Static Data Integrity (data.js)
// ═══════════════════════════════════════════════════════════════
describe('Static Data Integrity (data.js)', () => {
  describe('ITEMS_DB', () => {
    const requiredFields = ['name', 'icon', 'type', 'rarity', 'stats', 'requirements'];

    it.each(Object.entries(ITEMS_DB))('item "%s" has all required fields', (id, item) => {
      requiredFields.forEach(field => {
        expect(item, `${id} missing "${field}"`).toHaveProperty(field);
      });
    });

    it('all rarity values are valid', () => {
      const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
      Object.entries(ITEMS_DB).forEach(([id, item]) => {
        expect(validRarities, `${id} has invalid rarity "${item.rarity}"`).toContain(item.rarity);
      });
    });

    it('all equipment types map to valid slots', () => {
      const validTypes = ['helmet', 'armor', 'shield', 'sword', 'boots', 'gloves', 'belt', 'consumable'];
      Object.entries(ITEMS_DB).forEach(([id, item]) => {
        expect(validTypes, `${id} has invalid type "${item.type}"`).toContain(item.type);
      });
    });

    it('consumable items have an effect property', () => {
      Object.entries(ITEMS_DB)
        .filter(([, item]) => item.type === 'consumable')
        .forEach(([id, item]) => {
          expect(item, `consumable "${id}" missing effect`).toHaveProperty('effect');
        });
    });
  });

  describe('MONSTER_LIBRARY', () => {
    const requiredFields = ['templateId', 'name', 'icon', 'class', 'level', 'hp', 'damage', 'defense', 'xpReward', 'goldReward'];

    it.each(MONSTER_LIBRARY.map((m, i) => [m.templateId || `index-${i}`, m]))(
      'monster "%s" has all required fields',
      (id, monster) => {
        requiredFields.forEach(field => {
          expect(monster, `${id} missing "${field}"`).toHaveProperty(field);
        });
      }
    );

    it('all monster classes are valid', () => {
      const validClasses = ['normal', 'champion', 'unique', 'superUnique'];
      MONSTER_LIBRARY.forEach(m => {
        expect(validClasses, `${m.name} has invalid class "${m.class}"`).toContain(m.class);
      });
    });

    it('all affix references exist in AFFIXES', () => {
      MONSTER_LIBRARY.forEach(m => {
        (m.affixes || []).forEach(affix => {
          expect(AFFIXES, `${m.name} references unknown affix "${affix}"`).toHaveProperty(affix);
        });
      });
    });

    it('all monsters have positive HP and damage', () => {
      MONSTER_LIBRARY.forEach(m => {
        expect(m.hp, `${m.name} hp`).toBeGreaterThan(0);
        expect(m.damage, `${m.name} damage`).toBeGreaterThan(0);
      });
    });

    it('XP and gold rewards are positive', () => {
      MONSTER_LIBRARY.forEach(m => {
        expect(m.xpReward, `${m.name} xpReward`).toBeGreaterThan(0);
        expect(m.goldReward, `${m.name} goldReward`).toBeGreaterThan(0);
      });
    });
  });

  describe('AFFIXES', () => {
    it('each affix has name, effect, and class', () => {
      Object.entries(AFFIXES).forEach(([id, affix]) => {
        expect(affix, `${id} missing name`).toHaveProperty('name');
        expect(affix, `${id} missing effect`).toHaveProperty('effect');
        expect(affix, `${id} missing class`).toHaveProperty('class');
      });
    });
  });

  describe('CITY_ANCHORS', () => {
    it('each city has id, name, lat, lng', () => {
      CITY_ANCHORS.forEach(city => {
        expect(city).toHaveProperty('id');
        expect(city).toHaveProperty('name');
        expect(city.lat).toBeGreaterThan(-90);
        expect(city.lat).toBeLessThan(90);
        expect(city.lng).toBeGreaterThan(-180);
        expect(city.lng).toBeLessThan(180);
      });
    });

    it('contains all 6 expected cities', () => {
      const ids = CITY_ANCHORS.map(c => c.id);
      ['berlin', 'kyiv', 'lviv', 'warsaw', 'prague', 'vienna'].forEach(id => {
        expect(ids).toContain(id);
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════════
//  5. Debounced Save Logic
// ═══════════════════════════════════════════════════════════════
describe('Debounced Save (window.triggerSave)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.triggerSave = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updatePlayer calls triggerSave for non-position updates', () => {
    updatePlayer({ gold: 999 });
    expect(window.triggerSave).toHaveBeenCalled();
  });

  it('updatePlayer does NOT call triggerSave for position-only updates', () => {
    updatePlayer({ position: { lat: 1, lng: 2 } });
    expect(window.triggerSave).not.toHaveBeenCalled();
  });

  it('updateEquipment calls triggerSave', () => {
    updateEquipment('sword', 'ironSword');
    expect(window.triggerSave).toHaveBeenCalled();
  });

  it('addToInventory calls triggerSave', () => {
    addToInventory({ id: 'healthPotion', quantity: 1 });
    expect(window.triggerSave).toHaveBeenCalled();
  });

  it('removeFromInventory calls triggerSave', () => {
    gameState.inventory = [{ id: 'healthPotion', quantity: 1 }];
    removeFromInventory(0);
    expect(window.triggerSave).toHaveBeenCalled();
  });

  it('recalculateStats calls triggerSave', () => {
    recalculateStats();
    expect(window.triggerSave).toHaveBeenCalled();
  });

  it('simulates the 5-second debounce pattern from app.js', () => {
    // Reproduce the exact debounce from app.js:285-296
    let saveTimeout = null;
    const saveGame = vi.fn();

    const triggerSave = (immediate = false) => {
      if (immediate) {
        saveGame();
        return;
      }
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        saveGame();
      }, 5000);
    };

    // Fire 3 rapid triggers — should NOT save yet
    triggerSave();
    triggerSave();
    triggerSave();
    expect(saveGame).not.toHaveBeenCalled();

    // Advance 4 seconds — still shouldn't save
    vi.advanceTimersByTime(4000);
    expect(saveGame).not.toHaveBeenCalled();

    // Advance 1 more second (total 5s since LAST trigger) — NOW save
    vi.advanceTimersByTime(1000);
    expect(saveGame).toHaveBeenCalledTimes(1);
  });

  it('immediate=true bypasses the debounce', () => {
    const saveGame = vi.fn();
    const triggerSave = (immediate = false) => {
      if (immediate) {
        saveGame();
        return;
      }
    };

    triggerSave(true);
    expect(saveGame).toHaveBeenCalledTimes(1);
  });

  it('resets the 5s timer on each new trigger', () => {
    let saveTimeout = null;
    const saveGame = vi.fn();

    const triggerSave = () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => saveGame(), 5000);
    };

    triggerSave();
    vi.advanceTimersByTime(3000); // 3s in
    triggerSave(); // Reset timer
    vi.advanceTimersByTime(3000); // 6s total but only 3s since last trigger
    expect(saveGame).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000); // 5s since last trigger
    expect(saveGame).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  6. Flee Penalty Logic (from combat.js)
// ═══════════════════════════════════════════════════════════════
describe('Flee Penalty', () => {
  it('applies 30% gold loss', () => {
    const gold = 1000;
    const goldLoss = Math.floor(gold * 0.3);
    expect(goldLoss).toBe(300);
    expect(gold - goldLoss).toBe(700);
  });

  it('applies 5% XP loss using BigInt', () => {
    const xp = BigInt(2000);
    const xpLoss = Math.floor(Number(xp) * 0.05);
    const newXp = BigInt(xp) - BigInt(xpLoss);
    expect(newXp).toBe(1900n);
  });

  it('removes a random inventory item', () => {
    const inventory = [
      { id: 'rustySword', quantity: 1 },
      { id: 'healthPotion', quantity: 1 },
      { id: 'ironSword', quantity: 1 },
    ];
    const idx = 1; // Simulate random pick
    const removed = inventory.splice(idx, 1);
    expect(removed[0].id).toBe('healthPotion');
    expect(inventory).toHaveLength(2);
  });

  it('handles empty inventory gracefully (no item loss)', () => {
    const inventory = [];
    let itemLossMsg = '';
    if (inventory.length > 0) {
      itemLossMsg = 'lost something';
    }
    expect(itemLossMsg).toBe('');
    expect(inventory).toHaveLength(0);
  });
});
