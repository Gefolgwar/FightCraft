# PROPOSAL-LOGIC: FightCraft Game Logic Audit

**Date:** 2026-05-03
**Reviewer:** Logic Reviewer Agent
**Scope:** Combat math, stat calculations, XP/leveling, rewards, PvP, zone capture, race conditions, client-side trust

---

## Executive Summary

FightCraft's game logic has **multiple critical exploit vectors** stemming from a fundamental architectural decision: **all combat resolution, stat calculations, and reward granting happen client-side** with no server-authoritative validation. Combined with liberal `window.*` global function exposure and overly permissive Firebase RTDB write rules, a player with browser console access can: win any combat instantly, grant themselves unlimited XP/gold/items, manipulate PvP outcomes, and claim any citadel. The combat math itself is reasonably sound for an indie mobile RPG, but several balance gaps exist in stat scaling, item drops, and group combat damage formulas.

**Risk Level: CRITICAL** — The game is exploitable in its current state by any player who opens the browser console.

---

## 1. Combat System Analysis

### 1.1 Damage Formula (PvE Solo)

**Location:** `www/gameplay/combat.js:657-668`

```javascript
function calculateDamage(attackerStats, target, zone, isMonster = false) {
    let hitChance = attackerStats.hitChance || 75;
    const isCrit = Math.random() * 100 < (attackerStats.critChance || 5);
    let dmg = Math.max(1, (attackerStats.derivedDamage || 10) - (target.defense || 0));
    if (isCrit) dmg *= 2;

    return {
        hit: Math.random() * 100 < hitChance,
        damage: dmg,
        crit: isCrit
    };
}
```

**Analysis:**

| Component | Formula | Notes |
|-----------|---------|-------|
| Base Damage | `derivedDamage - target.defense` | Linear subtraction, floored at 1 |
| Crit Multiplier | `damage * 2` | Applied AFTER floor, so crit on min-damage = 2 |
| Hit Roll | `random() * 100 < hitChance` | Independent roll per attack |
| Defense Bypass | None | Defense is flat subtraction only |

**Issue 1 — Zone defense is never checked in PvE solo:** The function accepts a `zone` parameter but never uses it for defense matching. Only PvP (via `battle-logic.js:138`) checks if `defenseZones.includes(attackZone)`. In PvE solo, the player selects attack and defense zones (UI enforces it), but monster attacks in `executeAttack()` (line 630-644) use a random zone and the dodge check is a separate flat roll — **the defense zone selection has no effect on PvE combat**.

**Impact:** The zone-based combat system is visually presented but mechanically ignored in PvE. This is misleading to players.

**Issue 2 — Hit chance is rolled but miss has no feedback loop:** When the player misses (line 684), the turn is still consumed. But the monster's response attacks happen **unconditionally** (line 623-644) regardless of whether the player hit. This means a miss is purely a loss for the player with no recovery mechanism.

### 1.2 Damage Formula (PvP)

**Location:** `www/gameplay/battle-logic.js:128-144`

```javascript
const calc = (attacker, defender, attackZone, defenseZones) => {
    let hitChance = attacker.hitChance || 80;
    let damage = Math.max(1, (attacker.derivedDamage || attacker.damage || 5) - (defender.defense || 0));
    const isCrit = Math.random() * 100 < (attacker.critChance || 5);
    if (isCrit) damage *= 2;
    let blocked = false;
    if (defenseZones && defenseZones.includes(attackZone)) {
        damage = Math.floor(damage * 0.5);
        blocked = true;
    }
    return { damage, isCrit, blocked };
};
```

**Key difference from PvE:** PvP actually checks zone blocking (50% damage reduction). But **hit chance is never rolled** — the PvP calc always hits. The `hitChance` variable is computed but never used in the return value.

**Issue 3 — PvP always hits:** PvP combat never misses. The `hit` field isn't returned or checked. This makes agility's hit chance bonus useless in PvP.

### 1.3 Damage Formula (Group/Unified Combat)

**Location:** `www/gameplay/combat.js:460-488`

```javascript
// MVP: Simple damage math (15-25). Can integrate calculateDamage later
const dmg = Math.floor(Math.random() * 10) + 15;
// ...
const dmg = Math.floor(Math.random() * 8) + 10; // Monster damage
```

**Issue 4 — Group combat ignores all stats:** Unified group combat uses hardcoded random damage ranges (15-25 for players, 10-18 for monsters). Player stats, equipment, level, and the entire `calculateDamage()` function are bypassed. This makes progression meaningless in group play.

### 1.4 Stat Calculation

**Location:** `www/core/gameState.js:78-151`

```javascript
// Base Stats + Equipment bonuses
p.maxHp = 100 + (effective.vitality * 10);           // Vitality -> HP
p.derivedDamage = 5 + (effective.strength * 2) + attackBonus;  // Strength -> Damage
p.critChance = effective.intuition * 0.5;              // Intuition -> Crit%
p.hitChance = 80 + (effective.agility * 0.5);          // Agility -> Hit%
p.dodgeChance = effective.agility * 0.5;               // Agility -> Dodge%
p.interactionRadius = 25 + (effective.wisdom * 2);     // Wisdom -> Range (m)
p.regenRate = effective.vitality * 0.1 + effective.intellect * 0.2 + regenBonus;
```

**Stat Budget Analysis (Level 1, naked character):**

| Stat | Base | Derived Value | Impact |
|------|------|---------------|--------|
| Strength 5 | derivedDamage | 15 | +2 per point |
| Agility 5 | hitChance / dodge | 82.5% / 2.5% | +0.5% each per point |
| Intuition 5 | critChance | 2.5% | +0.5% per point |
| Vitality 5 | maxHp | 150 | +10 per point |
| Intellect 5 | regenRate | 1.5 HP/tick | +0.2 per point |
| Wisdom 5 | interactionRadius | 35m | +2m per point |

**Issue 5 — Wisdom is a trap stat for combat:** Investing in Wisdom only expands interaction radius. In combat, it does nothing. But players need it to interact with farther monsters. This creates a bad tradeoff where players must sacrifice combat power for basic game functionality.

**Issue 6 — No stat caps:** There's no upper bound on any stat. With enough levels, a player could reach 100% hit chance, 50%+ crit, or astronomical damage. At level 50 (with 250 stat points invested), a strength-focused build would have: `5 + 250 = 255 strength -> 5 + 255*2 = 515 damage`. This vastly outscales any monster in the current MONSTER_LIBRARY (max 70 damage on Young Dragon).

**Issue 7 — Equipment bonuses stack additively with no slot restrictions:** The `recalculateStats()` function iterates all equipment slots and adds their bonuses. But there's no validation that equipment types match their slots. If `gameState.equipment.helmet` is set to `flameSword` (a sword), the bonus would still apply. This is exploitable via console.

### 1.5 Defense Zone Mechanics (PvE Monster Response)

**Location:** `www/gameplay/combat.js:627-644`

```javascript
const mResult = calculateDamage(
    { derivedDamage: target.damage, hitChance: 75, critChance: 5 },
    victim.data, mAttackZone, true
);
if (mResult.hit) {
    if (victim.type === 'player' && Math.random() * 100 < (p.dodgeChance || 0)) {
        // DODGED
    } else {
        victim.data.hp -= mResult.damage;
    }
}
```

**Issue 8 — Player's selected defense zone is never checked against monster attacks:** The player selects a defense combo (e.g., "Head+Body"), but the monster's attack zone (randomly chosen) is never compared against it. The only mitigation is a flat dodge roll. The entire defense zone selection UI in PvE is decorative.

---

## 2. Exploit Vectors

### EXPLOIT-1: Instant Victory via Console [CRITICAL]

**Location:** `www/gameplay/combat.js:846, 1525`

**Reproduction:**
1. Enter any combat (click a monster)
2. Open browser console (F12)
3. Type: `window.victory()`
4. Receive full XP, gold, and 30% chance for item drop

**Root Cause:** `victory()` is exposed on `window` (line 1525) and sets `m.hp = 0` internally (line 850) without verifying the monster was actually defeated through combat.

**Impact:** Unlimited XP, gold, and items. Monsters get cooldown timers so other players see them as defeated.

**Fix:** Remove `victory` from `window` exports. Add a combat integrity check:
```javascript
export function victory() {
    if (!gameState.combat) return;
    const m = gameState.combat.monster;
    if (m.hp > 0) {
        console.warn('Combat integrity violation: monster still alive');
        return;
    }
    // ... rest of victory logic
}
```
Note: This only mitigates one vector. A player could also call `gameState.combat.monster.hp = 0` then `executeAttack()`. True fix requires server-side combat validation.

---

### EXPLOIT-2: Stat/Gold/XP Manipulation via Console [CRITICAL]

**Location:** `www/core/gameState.js:4` (exported mutable singleton), `www/core/app.js:1028` (`window.getPlayerStats = recalculateStats`)

**Reproduction:**
1. Open browser console
2. `gameState.player.strength = 99999`
3. `gameState.player.gold = 99999999`
4. `gameState.player.xp = BigInt("99999999999999")`
5. `recalculateStats()` — recalculates derived stats from the manipulated base
6. `window.triggerSave()` — persists to Firestore

**Root Cause:** `gameState` is an exported mutable object accessible via `window.gameState` (exposed in `bridge.js`). Firestore security rules for `users/{uid}/characters/{charId}` allow owner write with **no field-level validation** — any stat value is accepted.

**Impact:** God-mode stats, unlimited currency, instant max level.

**Fix (Server-side):** Add Firestore rules to validate stat ranges:
```
match /users/{userId}/characters/{characterId} {
  allow update: if request.auth.uid == userId
    && request.resource.data.strength is number
    && request.resource.data.strength >= 1
    && request.resource.data.strength <= 500
    && request.resource.data.gold is number
    && request.resource.data.gold >= 0;
}
```

---

### EXPLOIT-3: PvP Battle Result Injection [CRITICAL]

**Location:** `firebase/database.rules.json:35`, `www/gameplay/battle-logic.js:88`

**Reproduction:**
1. Enter a PvP battle as Player 2
2. Open console
3. Write directly to RTDB: `firebase.database().ref('battles/<battleId>/rounds/1/result').set({ round: 1, p1_damage: 99999, p2_damage: 0, timestamp: Date.now() })`
4. Both clients receive the injected result
5. Player 1 takes 99999 damage, Player 2 takes 0

**Root Cause:** RTDB `battles/$battleId` has `.write: "auth != null"` — any authenticated user can write to any battle node, including results that should only be written by the host (Player 1).

**Impact:** Guaranteed PvP wins, ability to grief other players' PvP matches.

**Fix:** Restrict result writes to Player 1 (host):
```json
"result": {
    ".write": "auth != null && root.child('battle_requests').child($battleId).child('attackerId').val() === auth.uid"
}
```

---

### EXPLOIT-4: Castle/Citadel Claim Without Requirements [HIGH]

**Location:** `firebase/firestore.rules:95-98`

```
match /castles/{castleId} {
  allow read: if request.auth != null;
  allow create, update: if request.auth != null;  // <-- ANY user can write!
}
```

**Reproduction:**
1. Use Firebase REST API or console
2. Write to `castles/<districtId>` with `ownerId: <myUid>`, `ownerName: "Hacker"`
3. Now own any citadel without paying gold or winning combat

**Root Cause:** Firestore rules for `castles` have no ownership validation, no gold check, no proximity check. The client-side `claimThrone()` in `kingdom.js` checks gold and proximity, but these are client-only guards.

**Impact:** Bypass citadel capture mechanics entirely.

---

### EXPLOIT-5: Flee/Restart Combat for Reward Re-rolls [HIGH]

**Location:** `www/gameplay/combat.js:1007-1056` (fleeCombat), `www/gameplay/combat.js:846-958` (victory)

**Scenario:**
1. Start combat with a monster
2. Attack until monster HP is low
3. If no item drop desired: flee (5% XP penalty, 1hr cooldown)
4. Wait 1 hour or find another monster
5. Repeat until desired rare item drops

**Root Cause:** Item drops are a flat 30% roll from the entire ITEMS_DB pool (line 911), unrelated to monster type/level. Monster cooldowns are the only throttle.

**Impact:** Farm any item from any monster with patience. No correlation between monster difficulty and reward quality.

---

### EXPLOIT-6: Multi-Tab / Stale Combat State [HIGH]

**Scenario:**
1. Open game in Tab A, start combat
2. Open game in Tab B (same character)
3. Win combat in Tab A (get rewards)
4. Tab B still has `gameState.combat` populated
5. Call `victory()` in Tab B console — get rewards again

**Root Cause:** No session exclusivity mechanism. Firebase `onDisconnect` only cleans up RTDB `live_players`, not active combat state. The `_cleanupCombatState()` function only operates on local state.

**Impact:** Duplicate rewards per combat.

---

### EXPLOIT-7: Templates/World Chunks Write Access [MEDIUM]

**Location:** `firebase/firestore.rules:78-81, 109-113, 115-120, 122-127`

Multiple "admin-only" collections actually allow writes from any authenticated user:
- `templates` — create/update: `auth != null` (should be admin only)
- `world_chunks` — create/update: `auth != null`
- `world_metadata` — create/update: `auth != null`
- `city_zones` — create/update: `auth != null`
- `world_snapshots` — create/update: `auth != null`

**Reproduction:** Any authenticated user can create/modify game templates, potentially spawning super-powered monsters or corrupting world data.

**Impact:** Game world data corruption.

**Fix:** Change `allow create, update: if request.auth != null;` to `allow create, update: if isAdmin();` for all world-data collections.

---

### EXPLOIT-8: GPS Spoofing for Remote Zone Capture [MEDIUM]

**Location:** `firebase/database.rules.json:11-13`

```json
"position": {
    ".validate": "newData.hasChildren(['lat', 'lng'])
        && newData.child('lat').isNumber()
        && newData.child('lng').isNumber()"
}
```

**Root Cause:** RTDB validates that lat/lng are numbers but doesn't check ranges (-90..90, -180..180) or rate-limit position changes. A spoofed client can teleport anywhere instantly.

**Impact:** Capture citadels, fight monsters, and interact with POIs from anywhere in the world without physically moving.

---

## 3. Balance Issues

### BALANCE-1: Stat Point Efficiency Imbalance

At 5 stat points per level, stat investment efficiency varies wildly:

| Investment | Effect | Effective Power |
|------------|--------|-----------------|
| +1 Strength | +2 damage | Direct combat impact |
| +1 Agility | +0.5% hit, +0.5% dodge | Marginal (82.5% -> 83%) |
| +1 Intuition | +0.5% crit | Very marginal |
| +1 Vitality | +10 HP, +0.1 regen | Decent survivability |
| +1 Wisdom | +2m interaction radius | Zero combat value |
| +1 Intellect | +0.2 regen/tick | Minimal (regen paused during combat) |

**Recommendation:** Strength is overwhelmingly dominant. Consider:
- Agility: Increase to 1%/point for both hit and dodge
- Intuition: Add crit damage multiplier (currently flat 2x)
- Wisdom: Add combat benefit (e.g., +1% item drop chance per point)
- Intellect: Add in-combat utility (e.g., HP potion effectiveness)

### BALANCE-2: Monster-Player Power Curve Divergence

Level 1 player (base stats, no equipment):
- HP: 150, Damage: 15, Defense: 0, Hit: 82.5%, Crit: 2.5%

Level 5 Wolf Pack (MONSTER_LIBRARY):
- HP: 90, Damage: 12, Defense: 3

Expected combat: Player deals `max(1, 15-3) = 12 per hit`, monster deals 12 per hit (no player defense). Player hits ~82.5% of the time. Wolf has 90 HP -> ~9 hits to kill. Player has 150 HP -> ~13 hits from wolf. **Player wins easily.**

Level 30 Young Dragon (superUnique):
- HP: 950, Damage: 70, Defense: 40, Affixes: extraStrong (+100% = 140 DMG), stoneSkin (+50% DEF = 60), teleport

A level 15 player with 50 strength and plate armor (defense 25):
- Damage: 5 + 50*2 = 105, reduced by 60 defense = 45 per hit
- Takes 140 damage per hit...

**BUT** — see Balance-3 below: affixes are never actually applied in combat math. So the dragon actually fights with its base stats of 70 damage and 40 defense.

### BALANCE-3: Monster Affixes Are Never Applied

**Location:** `www/gameplay/combat.js:657-668`, `www/gameplay/data.js:183-209`

The `AFFIXES` object defines effects like `stoneSkin: { defenseBonus: 0.5 }` and `extraStrong: { damageBonus: 1.0 }`, but `calculateDamage()` never reads or applies these modifiers. Monsters with affixes like "Stone Skin" or "Extra Strong" fight identically to monsters without them.

**Impact:** The affix system is purely cosmetic. Champions, Uniques, and Super Uniques that should be significantly harder are only harder due to their base stat differences in MONSTER_LIBRARY.

**Fix:** Apply affix modifiers in `calculateDamage()`:
```javascript
function calculateDamage(attackerStats, target, zone, isMonster = false) {
    let effectiveDamage = attackerStats.derivedDamage || 10;
    let effectiveDefense = target.defense || 0;
    
    // Apply target affixes if attacking a monster
    if (!isMonster && target.affixes) {
        target.affixes.forEach(affix => {
            const effect = AFFIXES[affix]?.effect;
            if (effect?.defenseBonus) effectiveDefense *= (1 + effect.defenseBonus);
        });
    }
    // Apply attacker affixes if monster attacking player
    if (isMonster && attackerStats.affixes) {
        attackerStats.affixes.forEach(affix => {
            const effect = AFFIXES[affix]?.effect;
            if (effect?.damageBonus) effectiveDamage *= (1 + effect.damageBonus);
        });
    }
    
    let dmg = Math.max(1, effectiveDamage - effectiveDefense);
    // ... rest of formula
}
```

### BALANCE-4: Item Drop Pool Is Undifferentiated

**Location:** `www/gameplay/combat.js:910-918`

```javascript
const lootItems = Object.keys(ITEMS_DB).filter(k => ITEMS_DB[k].type !== 'consumable');
if (Math.random() < 0.3) {
    const id = lootItems[Math.floor(Math.random() * lootItems.length)];
    // ...
}
```

All non-consumable items have equal drop chance (30% to drop, then uniform random). A level 5 Wolf has the same chance to drop Plate Armor (rare, STR 15 req) as a Leather Cap (common, no req). Monster level, class, and difficulty are ignored.

**Recommendation:** Weight drops by monster class and item rarity:
- Normal monsters: only common drops
- Champions: common + uncommon
- Uniques: uncommon + rare
- Super Uniques: rare + epic + guaranteed drop

### BALANCE-5: Flee Penalty Inconsistency

Two different flee paths exist with different penalties:

| Path | Trigger | Gold Loss | XP Loss | Item Loss | Monster Cooldown |
|------|---------|-----------|---------|-----------|-----------------|
| `processFleePenalty()` | Pre-combat dialog "FLEE" button | 30% gold | 5% XP | 1 random item | 1 hour |
| `fleeCombat()` | In-combat "Flee" button | None | 5% XP | None | 1 hour |

**Impact:** The pre-combat flee is far more punishing than the mid-combat flee. Players are incentivized to start combat and immediately flee rather than using the pre-combat flee button.

### BALANCE-6: XP Curve Scaling

**Location:** `www/core/app.js:1259`

```javascript
gameState.player.xpToNext = BigInt(500 * gameState.player.level * gameState.player.level);
```

| Level | XP Required | Total XP to Reach | Best Monster XP (Dragon=1400) | Kills Needed |
|-------|------------|-------------------|-------------------------------|--------------|
| 1->2 | 500 | 500 | 1400 | 1 |
| 5->6 | 12,500 | 37,500 | 1400 | 9 |
| 10->11 | 50,000 | 192,500 | 1400 | 36 |
| 20->21 | 200,000 | 1,400,000 | 1400 | 143 |
| 50->51 | 1,250,000 | 21,250,000 | 1400 | 893 |

The quadratic curve grows steeply. By level 20, players need ~143 Young Dragon kills per level. With 30-minute cooldowns and limited monster supply, leveling becomes extremely grindy past level 15-20.

### BALANCE-7: King Boss Has Hardcoded Stats

**Location:** `www/map/kingdom.js:186-199`

```javascript
const kingBoss = {
    id: `king_${district.id}`,
    level: 42,
    hp: 500, maxHp: 500,
    damage: 40, defense: 20,
    xpReward: 2000, goldReward: 1000
};
```

The king boss is always level 42 with fixed stats, regardless of the actual king player's level, equipment, or stats. A level 50 player faces the same king boss as a level 10 player.

---

## 4. Race Conditions & Edge Cases

### RACE-1: PvP Round Resolution Race Condition [CRITICAL]

**Location:** `www/gameplay/battle-logic.js:86-89`

```javascript
if (p1?.ready && p2?.ready && !result) {
    if (this.role === 'player1') { // Host Authority
        this.resolveRound(p1, p2);
    }
}
```

The intent is that only Player 1 (host) resolves rounds. But since `battles/$battleId` has `.write: "auth != null"`, Player 2 could simultaneously write a result. If both write at similar times, the last write wins (RTDB has last-writer-wins semantics). This could cause inconsistent state between clients.

### RACE-2: Combat State Not Locked [HIGH]

**Location:** `www/gameplay/combat.js:560-604`

Multiple rapid calls to `executeAttack()` could process before the UI or state update. While the attack button is disabled after selection, a console user could call `executeAttack()` multiple times in quick succession, dealing multiple rounds of damage in a single turn.

### RACE-3: `window._resolvingRound` Debounce Has No Timeout [MEDIUM]

**Location:** `www/gameplay/combat.js:437`

```javascript
if (window._resolvingRound === round) return;
window._resolvingRound = round;
resolveUnifiedRound(combatId, data);
```

If `resolveUnifiedRound()` fails or throws, `window._resolvingRound` is never cleared, permanently blocking round resolution. There's no timeout or error cleanup.

### RACE-4: Firestore Save Debounce vs Combat State [MEDIUM]

**Location:** `www/core/app.js` (triggerSave with 5s debounce)

Combat changes mutate `gameState` immediately but Firestore saves are debounced by 5 seconds. If the app crashes or the tab is closed during this window, the latest combat results (XP, gold, items) could be lost. Conversely, if a player wins combat and immediately refreshes before the save, they could re-enter combat and win again.

### EDGE-1: BigInt XP with NaN Input [MEDIUM]

**Location:** `www/core/app.js:1233-1235`

```javascript
window.addXP = function (amount, source = "Debug") {
    gameState.player.xp = BigInt(gameState.player.xp) + BigInt(Math.floor(amount));
```

If `amount` is `undefined`, `NaN`, or a non-numeric value, `Math.floor(amount)` returns `NaN`, and `BigInt(NaN)` throws a `TypeError`. This would crash the XP system and potentially leave the game in an inconsistent state.

**Fix:**
```javascript
window.addXP = function (amount, source = "Debug") {
    const safeAmount = Math.floor(Number(amount)) || 0;
    if (safeAmount <= 0) return false;
    gameState.player.xp = BigInt(gameState.player.xp) + BigInt(safeAmount);
```

### EDGE-2: Negative Gold From Defeat Penalty [LOW]

**Location:** `www/gameplay/combat.js:995`

```javascript
gameState.player.gold = Math.floor(gameState.player.gold * 0.9);
```

If gold is 0, this produces 0 (safe). If gold is negative (shouldn't happen, but no guards), `Math.floor(-5 * 0.9) = -4` — gold stays negative. There's no floor check.

### EDGE-3: Player HP During Regen [LOW]

**Location:** `www/core/app.js:952-963`

Regen is blocked during combat (`if (gameState.combat) return`) and for 5 seconds after damage. This is correctly implemented. The `lastDamageTime` check prevents regen-during-combat exploitation.

---

## 5. Client-Side Trust Boundaries

### Summary of Window-Exposed Critical Functions

**Location:** `www/gameplay/combat.js:1520-1534`

| Function | Risk | Exploit |
|----------|------|---------|
| `window.victory()` | CRITICAL | Instant win, free rewards |
| `window.startCombat(monster)` | CRITICAL | Start combat with fabricated weak monster for easy XP |
| `window.executeAttack()` | HIGH | Rapid-fire attacks |
| `window.fleeCombat()` | MEDIUM | Exit combat without proper penalties |
| `window.getPlayerStats()` | LOW | Calls `recalculateStats()` — triggers save |
| `window.selectAttackZone()` | LOW | UI manipulation only |
| `window.addXP(amount)` | CRITICAL | Arbitrary XP grant (app.js:1233) |
| `window.triggerSave()` | CRITICAL | Persist any local state changes |
| `window.openCitadelMenu()` | MEDIUM | Access citadel UI without proximity |
| `window.gameState` | CRITICAL | Direct state mutation (bridge.js) |

### What the Server Actually Validates

| Operation | Client Authority | Server Validation |
|-----------|-----------------|-------------------|
| Combat damage | 100% client | None |
| XP/Gold grants | 100% client | None |
| Item drops | 100% client | None |
| Character stats | 100% client | Field protection on `role`/`uid` only |
| Monster defeat (cooldown) | Client writes `defeatedAt` | Must be a number (Firestore rules) |
| PvP battle results | Player 1 (host) client | None (any auth can write to `battles`) |
| Citadel ownership | Client | None (any auth can write to `castles`) |
| Player position | Client | Must be numbers (no range check) |

---

## 6. Improvement Proposals

### PROPOSAL-1: Remove Critical Window Globals

**Problem:** `window.victory`, `window.addXP`, `window.startCombat`, and `window.gameState` enable trivial console exploits.

**Fix:** Remove from window exports. For functions needed by inline `onclick` handlers, use event delegation from `bridge.js` with a whitelist of safe functions. For `gameState`, use `Object.freeze` on the exported reference or make it accessible only through getter/setter functions with validation.

**Impact:** Blocks trivial console exploits. Still bypassable by a determined attacker (module import), but raises the bar significantly.

### PROPOSAL-2: Combat Integrity Checksums

**Problem:** Client-side combat can be manipulated at any point.

**Fix (Short-term, no Cloud Functions):** Generate a combat hash at start (combining monster stats, player stats, and a server-provided nonce). On victory, include the hash and round count in the save. On load, verify combat plausibility (e.g., XP gained matches known monster XP values from templates).

**Fix (Long-term):** Move combat resolution to Cloud Functions. Client sends attack/defense choices; server resolves and writes results.

**Impact:** Short-term fix reduces casual cheating. Long-term fix eliminates it.

### PROPOSAL-3: Fix PvP RTDB Write Rules

**Problem:** `battles/$battleId` allows any authenticated user to write anything.

**Fix:** Restrict writes based on participant role:
```json
"battles": {
    "$battleId": {
        ".read": "auth != null",
        ".write": "auth != null && (
            !data.exists() ||
            root.child('battle_requests').child($battleId).child('attackerId').val() === auth.uid ||
            root.child('battle_requests').child($battleId).child('targetId').val() === auth.uid
        )",
        "rounds": {
            "$roundNumber": {
                "player1_choice": {
                    ".write": "root.child('battle_requests').child($battleId).child('attackerId').val() === auth.uid"
                },
                "player2_choice": {
                    ".write": "root.child('battle_requests').child($battleId).child('targetId').val() === auth.uid"
                },
                "result": {
                    ".write": "root.child('battle_requests').child($battleId).child('attackerId').val() === auth.uid"
                }
            }
        }
    }
}
```

**Impact:** Prevents PvP result injection. Player 2 can only write their own choices.

### PROPOSAL-4: Fix Firestore Collection Permissions

**Problem:** `templates`, `world_chunks`, `world_metadata`, `city_zones`, `world_snapshots`, and `castles` allow any authenticated user to create/update.

**Fix:** Change all to `isAdmin()` for writes:
```
allow create, update: if isAdmin();
```
For `castles`, add ownership validation:
```
allow create: if request.auth != null
    && request.resource.data.ownerId == request.auth.uid;
allow update: if request.auth != null
    && (resource.data.ownerId == request.auth.uid || isAdmin());
```

**Impact:** Prevents world data corruption and unauthorized castle claims.

### PROPOSAL-5: Implement Defense Zone Matching in PvE

**Problem:** Player defense zone selection has no effect in PvE combat.

**Fix:** In `executeAttack()` (line 623-644), compare monster's random attack zone against player's selected defense zones:
```javascript
const defenseZones = getDefenseZones(selectedDefenseZone);
// e.g., 'head-body' -> ['head', 'body']
if (defenseZones.includes(mAttackZone)) {
    mResult.damage = Math.floor(mResult.damage * 0.5);
    blocked = true;
}
```

**Impact:** Makes the zone combat system actually functional. Increases player agency and tactical depth.

### PROPOSAL-6: Apply Monster Affixes in Combat

**Problem:** Monster affixes (Stone Skin, Extra Strong, Teleport, Cursed, Mana Burn) are defined in data but never applied during combat.

**Fix:** Integrate affix effects into `calculateDamage()` and `executeAttack()`:
- Stone Skin: +50% monster defense
- Extra Strong: +100% monster damage
- Teleport: 20% chance to dodge player attack
- Cursed: -20% player damage for the duration
- Mana Burn: Extra flat damage (10) that bypasses defense

**Impact:** Makes monster classes and affixes meaningful. Champions and Uniques become genuinely harder.

### PROPOSAL-7: Tiered Item Drop Tables

**Problem:** All monsters drop all items with equal probability.

**Fix:** Create drop tables per monster class:
```javascript
const DROP_TABLES = {
    normal:      { chance: 0.2, pool: ['common'] },
    champion:    { chance: 0.3, pool: ['common', 'uncommon'] },
    unique:      { chance: 0.4, pool: ['uncommon', 'rare'] },
    superUnique: { chance: 0.6, pool: ['rare', 'epic'], guaranteed: true }
};
```

**Impact:** Creates meaningful progression incentive. Higher-risk monsters reward better loot.

---

## 7. Priority Recommendations

### Immediate (Pre-Launch Blockers)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 1 | Remove `window.victory`, `window.addXP`, `window.startCombat` from globals | CRITICAL | Low |
| 2 | Fix RTDB `battles` write rules to participant-only | CRITICAL | Low |
| 3 | Fix Firestore `castles`, `templates`, `world_*` write rules to admin-only | CRITICAL | Low |
| 4 | Add stat range validation in Firestore character rules | CRITICAL | Medium |
| 5 | Add BigInt/NaN safety to `addXP()` | HIGH | Low |

### Short-Term (Next Sprint)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 6 | Implement defense zone matching in PvE | HIGH | Medium |
| 7 | Apply monster affixes in combat | HIGH | Medium |
| 8 | Fix PvP hit chance (currently always hits) | HIGH | Low |
| 9 | Use actual stats in group combat (not hardcoded 15-25) | HIGH | Medium |
| 10 | Add GPS coordinate range validation in RTDB rules | MEDIUM | Low |

### Medium-Term (Next Month)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 11 | Combat integrity checksums | MEDIUM | High |
| 12 | Tiered item drop tables | LOW | Medium |
| 13 | Stat rebalancing (wisdom, intellect, agility) | LOW | Medium |
| 14 | Flee penalty consistency | LOW | Low |
| 15 | Multi-tab session exclusivity | MEDIUM | High |

### Long-Term (Architecture)

| # | Issue | Severity | Effort |
|---|-------|----------|--------|
| 16 | Server-side combat resolution (Cloud Functions) | CRITICAL | Very High |
| 17 | Anti-cheat telemetry system | HIGH | High |
| 18 | Rate-limited position updates with velocity checks | MEDIUM | High |

---

## Appendix A: Formula Reference

```
DAMAGE = max(1, attackerDamage - targetDefense)
    if crit: DAMAGE *= 2
    if PvP blocked: DAMAGE *= 0.5

derivedDamage = 5 + (effective_strength * 2) + equipment_attackBonus
maxHp = 100 + (effective_vitality * 10)
hitChance = 80 + (effective_agility * 0.5)   [NOT USED IN PvP]
dodgeChance = effective_agility * 0.5
critChance = effective_intuition * 0.5
interactionRadius = 25 + (effective_wisdom * 2)
regenRate = vitality * 0.1 + intellect * 0.2 + equipment_regenBonus

XP_TO_NEXT_LEVEL = 500 * level^2
STAT_POINTS_PER_LEVEL = 5

FLEE_PENALTY (pre-combat) = -30% gold, -5% XP, -1 random item, 1hr cooldown
FLEE_PENALTY (mid-combat) = -5% XP, 1hr cooldown
DEFEAT_PENALTY = HP set to 30% max, -10% gold, 5min monster cooldown
PVP_DEFEAT = HP set to 10% max, no gold penalty
```

## Appendix B: RTDB Security Rule Gaps

| Node | Current Rule | Should Be |
|------|-------------|-----------|
| `battles/$battleId` | `auth != null` | Participant only (attacker or target via battle_requests) |
| `battles/../result` | Inherited (any auth) | Host (attacker) only |
| `combats/$combatId` | `auth != null && (!data.exists() \|\| data.child('initiatorId').exists())` | Initiator or participant only |
| `groups/$groupId/members/$charId` | `auth != null` | Group leader or self |
| `group_invites/$targetCharId` | `auth != null` | Validated inviter only |
| `arenas/$arenaId` | `auth != null` | Combat participants only |

## Appendix C: Verified Correct Logic

The following areas were reviewed and found to be correctly implemented:

- **HP regen blocking:** Regen pauses during combat and for 5 seconds after damage (app.js:952-963). Correctly prevents regen exploitation.
- **BigInt XP subtraction on level-up:** `xp -= xpToNext` using BigInt operators is correct (app.js:1254-1255).
- **Monster cooldown Firestore field restriction:** `spawned_objects` update rule correctly limits changes to `defeatedAt` field only, validated as number (firestore.rules:86-91).
- **Battle request RTDB rules:** Properly restrict to attacker creating, and only participants updating (database.rules.json:16-30).
- **onDisconnect cleanup:** Player removal from `live_players` on disconnect is correctly handled through Firebase RTDB onDisconnect hook.
- **Defeat HP restoration:** Both PvE (30% HP) and PvP (10% HP) properly use `recalculateStats()` to get max HP before calculating restore amount.
- **PvP draw detection:** Correctly checks both HP <= 0 simultaneously before checking individual win/loss conditions (combat.js:1504-1515).
