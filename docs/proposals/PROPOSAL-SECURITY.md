# FightCraft Security Audit — PROPOSAL-SECURITY.md

**Date:** 2026-05-03  
**Auditor:** Security Reviewer Agent  
**Scope:** Full application — Firebase rules, client-side code, GPS privacy, PvP integrity, economy  
**Risk Rating:** **CRITICAL** — Multiple exploitable vulnerabilities exist that allow any authenticated user to cheat, corrupt game data, and access admin functionality.

---

## Executive Summary

FightCraft's security posture is **critically compromised**. The combination of an unbundled client-side architecture, a client-side `isAdmin()` function that **unconditionally returns `true`**, six Firestore collections with admin-only intent but **open write rules**, and fully client-authoritative combat/economy means that **any authenticated user** can:

1. Write to admin-only game data (templates, castles, world state)
2. Grant themselves unlimited gold, XP, and items via browser console
3. Manipulate PvP battles to guarantee wins
4. Spoof GPS position with no server-side validation
5. Inject XSS payloads via player names rendered through `innerHTML`

| Severity | Count |
|----------|-------|
| **CRITICAL** | 6 |
| **HIGH** | 7 |
| **MEDIUM** | 6 |
| **LOW** | 4 |
| **INFO** | 3 |
| **Total** | **26** |

---

## Threat Model

### Trust Boundaries

```
+------------------------------------------------------+
|                    UNTRUSTED ZONE                     |
|                                                       |
|  +---------------------------------------------------+
|  | Browser / Android WebView                          |
|  |                                                    |
|  |  - All JS source visible (no bundler/obfuscation)  |
|  |  - 80+ window.* global functions                   |
|  |  - gameState singleton (mutable)                   |
|  |  - Combat resolution (damage, rewards, loot)       |
|  |  - IndexedDB / localStorage caches                |
|  |  - GPS coordinates (spoofable)                     |
|  +------------------+--------------------------------+
|                     |                                 |
|      Firebase SDK   | (authenticated requests)        |
|                     |                                 |
+---------------------+--------------------------------+
                      |
     =================+==================================
       TRUST BOUNDARY (Firebase Security Rules ONLY)
     =================+==================================
                      |
+---------------------+--------------------------------+
|                     v        TRUSTED ZONE             |
|  +----------------------+ +-------------------------+ |
|  | Firestore             | | RTDB                     | |
|  | - Security Rules      | | - Security Rules         | |
|  | - (BROKEN for 6       | | - (BROKEN for battles,   | |
|  |    collections)       | |    arenas, groups)       | |
|  +----------------------+ +-------------------------+ |
|  +----------------------+                              |
|  | Storage               |                              |
|  | - Rules (OK)          |                              |
|  +----------------------+                              |
|                                                        |
|  NO Cloud Functions (no server-side validation)        |
+--------------------------------------------------------+
```

### Attack Surfaces

| Surface | Threat Level | Notes |
|---------|-------------|-------|
| Browser Console | **CRITICAL** | Full access to gameState, 80+ window functions, Firebase SDK |
| Firestore Rules | **CRITICAL** | 6 collections allow any-auth writes (should be admin-only) |
| RTDB Rules | **CRITICAL** | battles, arenas, groups lack ownership validation |
| GPS/Geolocation | **HIGH** | No server-side spoofing detection, no range validation |
| Player Names (XSS) | **HIGH** | innerHTML rendering without sanitization |
| Modified APK | **HIGH** | Capacitor WebView — trivially patchable |
| Network Interception | **MEDIUM** | HTTPS enforced by Firebase, but data can be read/replayed |

---

## Critical Vulnerabilities

---

### [SEVERITY: CRITICAL] — C1: isAdmin() Unconditionally Returns true

**Location:** `www/firebase/firebase-service.js:266`  
**Category:** Authentication Bypass  

**Description:** The client-side `isAdmin()` function has a premature `return true;` statement, causing it to bypass the actual role check for ALL users.

```javascript
// Line 266-268
export function isAdmin() { return true;    // BUG: Always returns true
  return userRole && userRole.toLowerCase() === "admin";
}
```

**Attack Scenario:**
1. Any authenticated user opens the app
2. `isAdmin()` returns `true` regardless of actual role
3. The app grants admin UI access: debug panel, teleport controls, player management, monster spawning, world snapshot tools
4. `app.js:339` calls `isAdmin()` to decide whether to show admin-only world snapshot data
5. `app.js:1051` uses `isAdmin()` to enable the debug mode panel with teleportation

**Impact:** Every player sees and can use admin features. While Firestore rules provide a separate server-side admin check, the client-side bypass enables access to admin UI tools, teleportation controls, and debug functions that modify local game state before saving.

**Recommendation:** Fix the function immediately:
```javascript
export function isAdmin() {
  return userRole && userRole.toLowerCase() === "admin";
}
```

---

### [SEVERITY: CRITICAL] — C2: Six Firestore Collections Have Open Write Rules

**Location:** `firebase/firestore.rules:78-127`  
**Category:** Firebase Rules — Unauthorized Data Modification  

**Description:** Six collections intended for admin-only writes allow `create, update: if request.auth != null`, meaning ANY authenticated user can modify game-critical data:

```
templates/{templateId}        — Line 80
castles/{castleId}            — Line 97
world_snapshots/{snapshotId}  — Line 103
world_chunks/{chunkId}        — Line 111
world_metadata/{docId}        — Line 118
city_zones/{cityId}           — Line 126
```

All have: `allow create, update: if request.auth != null;`

**Attack Scenario:**
1. Attacker authenticates with any account
2. Opens browser console, accesses `window.firebaseFirestore` (exposed at firebase-service.js:133)
3. Creates a malicious template with trivial HP and massive gold rewards
4. Creates a castle with their own UID as owner
5. Overwrites `world_metadata` to force all clients to re-sync with corrupted data
6. All players in the game are affected

**Impact:** Complete game data corruption. Any player can create/modify templates, castles, world state, and city zones.

**Recommendation:** Restrict all six collections to admin-only writes:
```javascript
match /templates/{templateId} {
  allow read: if request.auth != null;
  allow create, update, delete: if isAdmin();
}
```

---

### [SEVERITY: CRITICAL] — C3: RTDB battles Node — Any User Can Modify Any PvP Battle

**Location:** `firebase/database.rules.json:33-50`  
**Category:** PvP Integrity — Unauthorized Data Modification  

**Description:** The RTDB `battles/$battleId` node allows any authenticated user to write:

```json
".write": "auth != null"
```

No ownership or participant check.

**Attack Scenario:**
1. Player A and Player B enter PvP combat, creating `battles/battle_123`
2. Player C (not a participant) opens console
3. Player C writes a fabricated round result with 99999 damage, crashing the battle
4. Or deletes the entire battle node

**Impact:** Any authenticated user can manipulate or destroy any active PvP battle.

**Recommendation:** Add participant validation:
```json
".write": "auth != null && (!data.exists() || data.child('player1_uid').val() === auth.uid || data.child('player2_uid').val() === auth.uid)"
```

---

### [SEVERITY: CRITICAL] — C4: Client-Authoritative Combat Rewards — Unlimited Gold/XP/Items

**Location:** `www/gameplay/combat.js:846-957`, `www/core/app.js:1233`  
**Category:** Transaction Integrity — Client-Side Trust  

**Description:** Combat victory rewards (XP, gold, loot) are computed entirely on the client:

```javascript
// combat.js:897-913
const leveledUp = window.addXP ? window.addXP(m.xpReward, 'Monster') : false;
gameState.player.gold += m.goldReward;
gameState.inventory.push({ id, quantity: 1 });
```

And `window.addXP` is globally accessible:
```javascript
// app.js:1233
window.addXP = function (amount, source = "Debug") {
  gameState.player.xp = BigInt(gameState.player.xp) + BigInt(Math.floor(amount));
```

**Attack Scenario (Console):**
```javascript
gameState.player.gold = 999999;
window.addXP(999999999);
gameState.inventory.push({ id: 'legendary_sword', quantity: 100 });
window.saveGame();
```

**Impact:** Complete economy breakdown. Changes persist permanently via saveCharacter().

**Recommendation:** 
- Short-term: Add Firestore Security Rules validation for character data ranges
- Long-term: Implement Cloud Functions for combat resolution and reward distribution

---

### [SEVERITY: CRITICAL] — C5: window.firebaseFirestore Exposes Raw Firestore SDK

**Location:** `www/firebase/firebase-service.js:133`  
**Category:** Client-Side Trust — Direct Database Access  

**Description:** Firebase SDK functions are exposed on the window object:

```javascript
window.firebaseFirestore = { collectionGroup, query, onSnapshot };
```

Combined with open-write collections (C2), this gives console attackers convenient direct Firestore access.

**Impact:** Streamlines exploitation of all other Firestore vulnerabilities.

**Recommendation:** Remove the global exposure entirely.

---

### [SEVERITY: CRITICAL] — C6: No Firestore Validation on Character Save Data

**Location:** `firebase/firestore.rules:36-43`, `www/firebase/firebase-service.js:1145-1204`  
**Category:** Transaction Integrity — Missing Server-Side Validation  

**Description:** Firestore rules for characters only check ownership — ZERO validation on data:

```javascript
allow create, update: if (request.auth != null && request.auth.uid == userId) || isAdmin();
```

No validation of gold amount, HP, XP, inventory items, stat points, or level.

**Recommendation:** Add data validation rules for gold >= 0, level 1-999, HP <= maxHp.

---

## High-Risk Issues

---

### [SEVERITY: HIGH] — H1: XSS via Player Names in innerHTML

**Location:** Multiple files  
**Category:** Cross-Site Scripting (XSS)  

**Description:** Player names from Firestore/RTDB are rendered via `innerHTML` without sanitization:

| File | Line | Context |
|------|------|---------|
| `character-selection.js` | 155-166 | Character list |
| `pvp.js` | 136-145 | Leaderboard |
| `combat.js` | 25-51 | Pre-combat dialog |
| `ui-controller.js` | 862 | Online players list |
| `combat.js` | 388 | Combat log from RTDB |

No sanitization function exists (0 instances of escapeHtml, sanitize, DOMPurify).

**Attack Scenario:**
1. Attacker creates character with name: `<img src=x onerror="...">`
2. All players who view the leaderboard or online list execute the injected script

**Impact:** Stored XSS affecting all users.

**Recommendation:** Add `escapeHtml()` utility, use `textContent` where possible, validate character names on creation.

---

### [SEVERITY: HIGH] — H2: RTDB arenas, group_invites, group_declines — Unrestricted Writes

**Location:** `firebase/database.rules.json:91-115`  
**Category:** Firebase Rules — Unauthorized Data Modification  

**Description:** Three RTDB nodes allow any authenticated user to write anything:

```json
"group_invites": { "$targetCharId": { ".write": "auth != null" } }
"group_declines": { "$inviterCharId": { ".write": "auth != null" } }
"arenas": { "$arenaId": { ".write": "auth != null" } }
```

**Impact:** Game disruption, harassment via invite spam, map pollution via fake arenas.

---

### [SEVERITY: HIGH] — H3: GPS Position — No Range Validation or Spoofing Detection

**Location:** `firebase/database.rules.json:11-13`  
**Category:** GPS Privacy & Integrity  

**Description:** RTDB validates lat/lng are numbers but NOT ranges:

```json
"position": {
    ".validate": "newData.hasChildren(['lat', 'lng']) && newData.child('lat').isNumber() && newData.child('lng').isNumber()"
}
```

Missing: Latitude range (-90..90), longitude range (-180..180), speed/teleportation detection.

**Impact:** Core geolocation gameplay completely undermined. Players can access all content without movement.

**Recommendation:** Add range validation in RTDB rules. Implement Cloud Function for teleportation detection.

---

### [SEVERITY: HIGH] — H4: PvP Combat Resolution is Host-Authoritative

**Location:** `www/gameplay/battle-logic.js:88-168`  
**Category:** PvP Integrity  

**Description:** Player 1 (host) computes ALL round results using local stats:

```javascript
if (this.role === 'player1') {
    this.resolveRound(p1, p2);  // Host calculates for both players
}
```

Host can modify local stats or fabricate results.

**Impact:** PvP host always wins. Rankings meaningless.

---

### [SEVERITY: HIGH] — H5: Full Player Stats and GPS Shared via RTDB

**Location:** `www/firebase/firebase-service.js:500-517`  
**Category:** GPS Privacy — Information Disclosure  

**Description:** `registerPlayerInRTDB()` publishes comprehensive data readable by ALL authenticated users:
- Full GPS coordinates (6+ decimals = sub-meter precision)
- Firebase UID
- Complete combat stats (HP, damage, defense, crit, dodge)
- Activity status, group ID, combat ID

**Impact:** Real-time GPS tracking of any player. Tactical advantage via stat scouting.

**Recommendation:** Round GPS to 3 decimal places (~111m). Share only name and level.

---

### [SEVERITY: HIGH] — H6: window.teleportToCoords — Debug Teleportation Exposed

**Location:** `www/core/app.js:1032-1044`  
**Category:** Client-Side Trust — Game Mechanic Bypass  

**Description:** Teleportation function globally exposed via `window.teleportToCoords`. With `isAdmin()` returning true for everyone (C1), all players can access the debug panel.

**Impact:** Instant movement to any coordinate. Breaks geolocation gameplay.

---

### [SEVERITY: HIGH] — H7: RTDB combats Node — Weak Write Protection

**Location:** `firebase/database.rules.json:52-67`  
**Category:** Firebase Rules — Insufficient Authorization  

**Description:** Write rule only checks if `initiatorId` exists — any user can write if it does:

```json
".write": "auth != null && (!data.exists() || data.child('initiatorId').exists())"
```

**Impact:** Any authenticated user can interfere with any active group combat.

---

## Medium-Risk Issues

---

### [SEVERITY: MEDIUM] — M1: Hardcoded Admin UID in Firestore Rules

**Location:** `firebase/firestore.rules:12`  
**Category:** Authentication — Hardcoded Credentials  

```javascript
request.auth.uid == 'YshG61RxTIczGXOfFqiu2wqC63r2'
```

**Recommendation:** Remove after confirming custom claims are fully deployed.

---

### [SEVERITY: MEDIUM] — M2: Admin Role Cached in localStorage

**Location:** `www/firebase/firebase-service.js:160-200`  
**Category:** Client-Side Trust  

User profile (including role) cached with 1-hour TTL. Tamperable, but Firestore rules still enforce server-side checks.

---

### [SEVERITY: MEDIUM] — M3: window.currentUserEmail — Email Exposure

**Location:** `www/firebase/firebase-service.js:153`  

```javascript
window.currentUserEmail = user.email;
```

Any XSS payload can read user email.

---

### [SEVERITY: MEDIUM] — M4: No Rate Limiting on Firestore Writes

No rate-limiting patterns in any Firestore rules. Could enable billing attacks.

---

### [SEVERITY: MEDIUM] — M5: Inventory Duplication — No Atomic Transactions

Inventory uses direct array mutations without Firestore transactions. No server-side validation of item IDs.

---

### [SEVERITY: MEDIUM] — M6: Firestore isAdmin() — Recursive Read Cost

Third tier of isAdmin() performs a Firestore get(), doubling read costs for non-admin users reaching this check.

---

## Low-Risk Issues

---

### [SEVERITY: LOW] — L1: Firebase API Key in Client Code

`firebase-service.js:61` — Firebase keys are designed to be public. Recommend restricting in GCP Console.

### [SEVERITY: LOW] — L2: window._currentUserId and window._currentCharacterId Exposed

`app.js:590-591` — Enables targeted attacks combined with other vulnerabilities.

### [SEVERITY: LOW] — L3: LocalStorage Contains Sensitive Game Data

`app.js:1002` — Full game state stored in localStorage. Readable on shared devices.

### [SEVERITY: LOW] — L4: No CSRF Protection on Game Actions

Firebase Auth handles CSRF internally, but game-specific actions lack additional protection.

---

## Informational Findings

---

### [SEVERITY: INFO] — I1: Massive Window Global Attack Surface (80+ Functions)

Over 80 functions exposed on window, including: saveGame, addXP, teleportToCoords, resetGame, equipItem, useItem, startCombat, challengePlayer, switchToPlayer, spawnTestMonsters.

### [SEVERITY: INFO] — I2: experimentalForceLongPolling Enabled

`firebase-service.js:127` — Disables WebSocket transport. Not a direct security issue but increases latency.

### [SEVERITY: INFO] — I3: Storage Rules Are Properly Configured

Storage rules correctly require auth for reads, admin custom claim for writes, and have deny-all default. This is the most secure rules file.

---

## Firebase Rules Audit — Rule-by-Rule Analysis

### Firestore (firebase/firestore.rules)

| Rule | Line | Verdict | Issue |
|------|------|---------|-------|
| isAdmin() function | 9-15 | **WARN** | Hardcoded UID, recursive read |
| users/{userId} read | 20 | **OK** | Auth required |
| users/{userId} update | 24-27 | **OK** | Owner-only + field protection |
| users/{userId} create | 30 | **OK** | Self-registration only |
| users/{userId} delete | 33 | **OK** | Admin-only |
| characters/{charId} | 36-43 | **FAIL** | No data validation |
| invites/{inviteId} | 48-52 | **OK** | Inbox pattern correct |
| combats/{combatId} | 59-68 | **WARN** | Participant check spoofable on create |
| collectionGroup characters | 72-74 | **OK** | Admin-only |
| templates/{templateId} | 78-82 | **FAIL** | Any auth can write |
| spawned_objects/{objectId} | 86-92 | **OK** | Field-level restriction |
| castles/{castleId} | 95-99 | **FAIL** | Any auth can write |
| world_snapshots | 102-106 | **FAIL** | Any auth can write |
| world_chunks | 109-113 | **FAIL** | Any auth can write |
| world_metadata | 116-120 | **FAIL** | Any auth can write |
| city_zones | 123-127 | **FAIL** | Any auth can write |
| players/{playerId} | 130-134 | **OK** | Owner-only |
| defeated_objects | 142-157 | **OK** | Well-validated |
| Catch-all deny | 160-162 | **OK** | Properly configured |

### RTDB (firebase/database.rules.json)

| Node | Verdict | Issue |
|------|---------|-------|
| live_players/$charId | **WARN** | Good ownership, no GPS range validation |
| battle_requests/$battleId | **OK** | Proper attacker/target validation |
| battles/$battleId | **FAIL** | No ownership check |
| combats/$combatId | **FAIL** | Weak ownership (initiatorId exists) |
| players/$uid | **OK** | Owner-only |
| groups/$groupId | **WARN** | LeaderId check insufficient |
| group_invites | **FAIL** | No restriction |
| group_declines | **FAIL** | No restriction |
| arenas/$arenaId | **FAIL** | No restriction |

### Storage (firebase/storage.rules)

| Rule | Verdict |
|------|---------|
| /bundles read | **OK** |
| /bundles write | **OK** (admin claim only) |
| Catch-all deny | **OK** |

---

## GPS/Privacy Analysis

### Data Exposure

| Data Point | Precision | Shared With | Duration |
|-----------|-----------|-------------|----------|
| GPS coordinates | Full (6+ decimals) | All auth users via RTDB | Until disconnect |
| Firebase UID | Exact | All auth users via RTDB | Until disconnect |
| Player email | Exact | window.currentUserEmail | Session |
| Player stats | Full | All auth users via RTDB | Until disconnect |

### GDPR/CCPA Concerns

1. Sub-meter location shared with all users (violates data minimization)
2. No consent mechanism for location sharing
3. No data deletion mechanism for location history
4. No opt-out for location visibility

### Spoofing Vectors

1. Browser Console: `updatePlayerLocationRTDB(lat, lng)`
2. Modified APK: Capacitor WebView patchable
3. DevTools: Override navigator.geolocation
4. Android Mock Location apps

---

## Remediation Plan

| # | Vulnerability | Fix | Priority | Effort |
|---|--------------|-----|----------|--------|
| 1 | C1: isAdmin() returns true | Remove `return true;` | **P0** | 1 min |
| 2 | C2: 6 collections open writes | Change to isAdmin() | **P0** | 30 min |
| 3 | C3: RTDB battles open | Add participant validation | **P0** | 1 hr |
| 4 | H1: XSS player names | Add escapeHtml(), sanitize innerHTML | **P1** | 2-4 hrs |
| 5 | H2: RTDB arenas/groups | Add ownership validation | **P1** | 2 hrs |
| 6 | H3: GPS no range check | Add lat/lng range in RTDB rules | **P1** | 30 min |
| 7 | C5: window.firebaseFirestore | Remove global exposure | **P1** | 5 min |
| 8 | H5: Full stats in RTDB | Reduce live_players data | **P1** | 1-2 hrs |
| 9 | H6: window.teleportToCoords | Remove window binding | **P1** | 30 min |
| 10 | C4/C6: Client-auth combat | Add Firestore validation rules | **P2** | 4-8 hrs |
| 11 | H4: PvP host authority | Cloud Functions for PvP | **P3** | 2-4 wks |
| 12 | M1: Hardcoded UID | Remove from rules | **P2** | 15 min |
| 13 | M3: window.currentUserEmail | Remove exposure | **P2** | 5 min |
| 14 | M4: No rate limiting | Add timestamp throttling | **P3** | 2-4 hrs |

---

## Top 3 Priority Fixes

### 1. Fix isAdmin() and Deploy Firestore Rules (C1 + C2) — DO TODAY

Every user currently has admin access AND can write to admin-only collections.

Steps:
1. Fix `firebase-service.js:266` — remove the `return true;`
2. Fix `firestore.rules` — change 6 open collections to `isAdmin()` for writes
3. Validate: `npx firebase deploy --only firestore:rules,hosting`

### 2. Fix RTDB Battle/Arena Write Rules (C3 + H2) — DO THIS WEEK

Any authenticated user can manipulate any PvP battle or create fake arenas.

Steps:
1. Add participant validation to battles write rules
2. Add ownership validation to arenas, group_invites, group_declines
3. Deploy: `npx firebase deploy --only database`

### 3. Add XSS Sanitization (H1) — DO THIS WEEK

Stored XSS via player names affects all users who view malicious names.

Steps:
1. Create `www/core/utils.js` with `escapeHtml()` function
2. Replace innerHTML with sanitized versions where user data is rendered
3. Add character name validation (alphanumeric, 3-20 chars)

---

## Architecture Recommendations

### Short-Term (No Architecture Changes)
1. Deploy rule fixes immediately (C1, C2, C3, H2, H3)
2. Add escapeHtml() utility for XSS prevention
3. Reduce RTDB data exposure in live_players
4. Remove debug globals (teleport, spawnMonsters, firebaseFirestore)

### Medium-Term (Moderate Changes)
5. Add Firestore data validation rules for character saves
6. Implement character name sanitization server-side
7. GPS precision reduction (3 decimal places)
8. Add consent and privacy controls

### Long-Term (Significant Changes)
9. Cloud Functions for combat resolution
10. Cloud Functions for economy validation
11. Teleportation detection Cloud Function
12. Code bundling/minification

---

## Self-Verification Checklist

- [x] All Firebase security rules files reviewed (Firestore, RTDB, Storage)
- [x] All global window function exposures cataloged (80+ functions)
- [x] GPS data handling and sharing analyzed
- [x] PvP data synchronization integrity assessed
- [x] User input sanitization checked (none found)
- [x] Authentication enforcement on all sensitive operations verified
- [x] Client-authoritative values identified (gold, XP, items, position, stats)
- [x] IndexedDB cache integrity considered
- [x] Exposed secrets/API keys reviewed
