// ==================== GAME STATE ====================
import { ITEMS_DB } from '../gameplay/data.js';

export let gameState = {
    player: {
        level: 1,
        xp: BigInt(0),
        xpToNext: BigInt(500),
        gold: 100,
        hp: 100,
        maxHp: 100,
        statPoints: 5,
        strength: 5, agility: 5, intuition: 5,
        vitality: 5, intellect: 5, wisdom: 5,
        regenRate: 0, lastDamageTime: 0,
        position: { lat: 52.484512, lng: 13.449876 },
        interactionRadius: 25,
        pvp: { wins: 0, losses: 0 }
    },
    equipment: { helmet: null, armor: null, shield: null, sword: null, boots: null, gloves: null, belt: null },
    inventory: [],
    monsters: [],
    quests: { monstersKilled: 0, itemsCollected: 0, uniquesKilled: 0, distanceTraveled: 0 },
    combat: null,
    debug: { enabled: false, moveSpeed: 1 },
    settings: { sound: true, notifications: true, fog: true, vibration: true },
    inactiveMonsters: {}, // {monsterId: cooldownEndTime}
    currentDistrict: null, // Current District info for UI
    currentGroup: null, // Current group (RTDB-synced)
    storage: [], // Safe storage items
    storageGold: 0 // Safe storage gold
};

export let staticMonsters = [];
export const STATIC_MONSTER_KEY = 'fightcraft_monsters_cache_v3';

export function setGameState(newState) {
    gameState = { ...gameState, ...newState };
}

export function updatePlayer(updates) {
    gameState.player = { ...gameState.player, ...updates };

    // Optimize: Don't trigger Firestore save for rapid position updates (using RTDB for that)
    const isOnlyPosition = Object.keys(updates).length === 1 && updates.position;
    if (window.triggerSave && !isOnlyPosition) {
        window.triggerSave();
    }
}

export function updateEquipment(slot, itemId) {
    gameState.equipment[slot] = itemId;
    if (window.triggerSave) window.triggerSave();
}

export function addToInventory(item) {
    gameState.inventory.push(item);
    if (window.triggerSave) window.triggerSave();
}

export function removeFromInventory(index) {
    gameState.inventory.splice(index, 1);
    if (window.triggerSave) window.triggerSave();
}

export function setStaticMonsters(monsters) {
    staticMonsters = monsters;
}

export function getStaticMonsters() {
    return staticMonsters;
}

/**
 * Recalculate Derived Stats based on Attributes
 * Call this whenever attributes change (level up, gear, etc.)
 */
export function recalculateStats() {
    const p = gameState.player;

    // 1. Calculate effective base attributes (Base + Equipment)
    const effective = {
        strength: p.strength,
        agility: p.agility,
        intuition: p.intuition,
        vitality: p.vitality,
        intellect: p.intellect,
        wisdom: p.wisdom,
        attackBonus: 0,
        defense: 0,
        regenBonus: 0
    };

    if (gameState.equipment) {
        Object.values(gameState.equipment).forEach(itemId => {
            if (itemId && ITEMS_DB[itemId]?.stats) {
                const itemStats = ITEMS_DB[itemId].stats;
                Object.entries(itemStats).forEach(([stat, value]) => {
                    if (effective[stat] !== undefined) {
                        effective[stat] += value;
                    } else {
                        // For stats not in base (like attackBonus, defense)
                        effective[stat] = (effective[stat] || 0) + value;
                    }
                });
            }
        });
    }

    // 2. Vitality -> Health
    // Base 100 + (Effective Vit * 10)
    p.maxHp = 100 + (effective.vitality * 10);
    if (p.hp > p.maxHp) p.hp = p.maxHp;

    // 3. Strength -> Damage
    // Base 5 + (Effective Str * 2) + attackBonus
    p.derivedDamage = 5 + (effective.strength * 2) + (effective.attackBonus || 0);

    // 4. Intuition -> Crit Chance
    // 0.5% per point
    p.critChance = Number((effective.intuition * 0.5).toFixed(1));

    // 5. Agility -> Hit Chance & Dodge Chance
    // Hit: Base 80% + (Effective Agi * 0.5%)
    // Dodge: Effective Agi * 0.5%
    p.hitChance = Number((80 + (effective.agility * 0.5)).toFixed(1));
    p.dodgeChance = Number((effective.agility * 0.5).toFixed(1));

    // 6. Wisdom -> Interaction Radius (View Radius)
    // Base 25m + (Effective Wisdom * 2m)
    const oldRadius = p.interactionRadius;
    p.interactionRadius = 25 + (effective.wisdom * 2);

    // 7. Intellect -> Regen or Mana (if added later)
    p.regenRate = Number((effective.vitality * 0.1 + effective.intellect * 0.2 + effective.regenBonus).toFixed(1));

    // Store effective stats for UI/Combat reference
    p.effective = effective;

    // Update Map Circle if radius changed
    if (oldRadius !== p.interactionRadius) {
        if (window.updatePlayerInteractionRadius) {
            window.updatePlayerInteractionRadius(p.interactionRadius);
        }
    }

    // console.log(`📊 Stats Recalculated: HP=${p.maxHp}, Dmg=${p.derivedDamage}, Crit=${p.critChance}%, Dodge=${p.dodgeChance}%, Radius=${p.interactionRadius}m`);

    if (window.triggerSave) window.triggerSave();
    return p;
}
