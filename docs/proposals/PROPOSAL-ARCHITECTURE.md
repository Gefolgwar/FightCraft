# FightCraft Architecture Audit — Proposal

**Date:** 2026-05-03
**Author:** System Architect Agent
**Scope:** Full client-side + Firebase architecture review

---

## Executive Summary

FightCraft is a 62K-line vanilla JS codebase (64 files) with a Firebase serverless backend. The architecture has outgrown its original structure: four monolith files (`firebase-service.js` at 3,728 lines, `ui-controller.js` at 1,998 lines, `map.js` at 1,985 lines, `combat.js` at 1,533 lines) contain 59% of all code. A circular dependency exists between `combat.js` and `app.js`. The init sequence is duplicated across two 400+ line functions. The `bridge.js` centralized global registry is undermined by 40+ `window.*` assignments scattered across 4 other modules. These structural issues create high merge-conflict risk, difficult onboarding, and slow iteration cycles. This proposal identifies 14 issues and provides actionable decomposition plans prioritized by risk and effort.

---

## Current State Analysis

### Codebase Metrics

| Metric | Value |
|--------|-------|
| Total JS files (`www/`) | 64 |
| Total JS lines | 61,911 |
| Total HTML lines | 8,475 |
| Largest JS file | `world_cities.js` — 35,538 lines (640KB static data) |
| Largest logic file | `firebase-service.js` — 3,728 lines (108KB) |
| Exported functions (firebase-service.js) | 100 |
| Total `window.*` assignments | 80+ across 5 files |
| Firebase services | 3 (Firestore, RTDB, Storage) |
| Firestore collections | 12 |
| RTDB nodes | 9 |

### File Size Distribution (Logic Files Only)

| File | Lines | Bytes | Exports | Role |
|------|-------|-------|---------|------|
| `firebase/firebase-service.js` | 3,728 | 108KB | 100 | ALL Firebase CRUD, auth, RTDB, PvP, groups, arenas, world management |
| `auth-ui/ui-controller.js` | 1,998 | 78KB | 35 | ALL panels, modals, HUD, notifications, admin UI, storage, online players |
| `map/map.js` | 1,985 | 63KB | 20+ | Leaflet map, markers, H3 territory, fog, canvas rendering, multiplayer |
| `gameplay/combat.js` | 1,533 | 64KB | 20+ | PvE, PvP sync, group combat, UI rendering, victory/defeat |
| `core/app.js` | 1,427 | 46KB | 5 | Init sequence (x2), save/load, 15+ debug `window.*` functions |
| `gameplay/sync-engine.js` | 887 | 30KB | 1 (object) | IndexedDB caching layer |
| `map/poi.js` | 529 | 23KB | 10+ | POI rendering, income processing |
| `gameplay/pvp.js` | 464 | 19KB | 7 | PvP battle requests, leaderboards, RTDB battle system |
| `map/districts.js` | 438 | 15KB | 5+ | Geographic boundaries, point-in-polygon |
| `gameplay/data.js` | 420 | — | 4 | Static databases (ITEMS_DB, MONSTER_LIBRARY, CITY_ANCHORS, AFFIXES) |
| `gameplay/world_cities.js` | 35,538 | 640KB | 1 | Static city data — massive JSON-in-JS |

### Module Dependency Graph (Simplified)

```
                    +----------------+
                    |   app.js       |
                    | (1,427 lines)  |
                    +-------+--------+
           +----------------+-------------------+
           v                v                   v
    +----------+   +----------------+    +----------+
    |gameState |   |firebase-svc    |    |  map.js  |
    |(151 lines)|  |(3,728 lines)   |    |(1,985 ln)|
    +----+-----+   +---+------------+    +----+-----+
         |             |                      |
         |    +--------+----------+           |
         |    v        v          v           |
         | +----+ +--------+ +-------+       |
         | |auth| |ui-ctrl | |sync-  |       |
         | |    | |(1,998) | |engine |       |
         | +----+ +--------+ +-------+       |
         |                                    |
    +----+------------------------------------+
    v    v                                    v
+----------+    +---------+          +----------+
|combat.js |--->| app.js  |          |  poi.js  |
|(1,533 ln)|<---|(circular|          |(529 ln)  |
+----------+    |  dep!)  |          +----------+
                +---------+
```

---

## Identified Issues

### Critical (Blocks scaling or introduces bugs)

**#1. `firebase-service.js` is a 3,728-line god object with 100 exports**
- **Location:** `www/firebase/firebase-service.js`
- **Evidence:** Single file handles: Firebase init, auth, user profile CRUD, character CRUD, RTDB player registration, real-time subscriptions (5+ different), spawned objects management, world snapshots (8 functions), city zones, PvP battle system (10+ functions), group system (8 functions), arena management, usage tracking, template management, castle system.
- **Impact:** Any change to PvP logic requires loading 100 unrelated functions. Merge conflicts are near-certain when multiple developers work on different features. Testing any single function requires understanding the entire 108KB context.

**#2. Circular dependency: `combat.js` <-> `app.js`**
- **Location:** `www/gameplay/combat.js` line 7: `import { saveGame } from '../core/app.js'`; `www/core/app.js` line 54: `import "../gameplay/combat.js"`
- **Evidence:** `combat.js` statically imports `saveGame` from `app.js`. `app.js` statically imports `combat.js` as a side-effect module. ES6 module spec handles this via live bindings, but it creates fragile initialization ordering.
- **Impact:** Breaks if import order changes. Makes it impossible to test `combat.js` without loading `app.js` (and thus the entire init chain). Prevents clean module boundaries.

**#3. `isAdmin()` hardcoded to `return true`**
- **Location:** `www/firebase/firebase-service.js` line 266: `export function isAdmin() { return true;`
- **Evidence:** The function has `return true;` before the actual logic (`return userRole && userRole.toLowerCase() === "admin"`). This was likely a debug override that was never removed.
- **Impact:** **Every user is treated as admin.** All admin-only UI, debug tools, and Firestore operations are available to all players. This is a critical security/functionality issue, though it's being flagged architecturally because it shows the risk of having auth logic embedded in a 3,728-line file where a single-line change can go unnoticed.

**#4. Init sequence duplicated between `init()` and `startGameWithCharacter()`**
- **Location:** `www/core/app.js` — `init()` (lines 71-565) and `startGameWithCharacter()` (lines 571-963)
- **Evidence:** Both functions contain nearly identical sequences:
  - BigInt restoration (lines 112-113 duplicated at 605-606)
  - Stats initialization (lines 116-129 duplicated at 609-622)
  - Debug mode restoration (lines 132-135 duplicated at 624-628)
  - Role sync (lines 139-145 duplicated at 632-638)
  - World data fetching + template loading (lines 281-312 duplicated at 649-680)
  - Combat reconnection (lines 239-264 duplicated at 708-729)
  - World metadata subscription (lines 329-333 duplicated at 765-769)
  - Template logging (lines 336-448 duplicated at 772-794+)
- **Impact:** ~300 lines of duplicated logic. Bugs fixed in one path but not the other. The `startGameWithCharacter` path is the manual character-select flow; `init` is the auto-load flow. They MUST stay in sync but there's no mechanism enforcing this.

### High (Significant maintainability or performance concern)

**#5. `window.*` global registration fragmented across 5 files**
- **Location:** `bridge.js` (51 lines, 30 registrations), `ui-controller.js` (20+ registrations at lines 780-817, 920-982, 1145), `app.js` (15+ registrations), `character-selection.js` (5 registrations), `ui.js` (7 registrations)
- **Evidence:** `bridge.js` was designed as the single registry, but at least 4 other modules also assign to `window.*` directly. Some functions are registered in BOTH `bridge.js` AND their source module (e.g., `openMenu`, `closeMenu`, `showNotification` exist in both `bridge.js` and `ui-controller.js`).
- **Impact:** No single source of truth for what's globally available. Duplicate registrations create confusion about which import is authoritative. `window.__checkGlobalFunctions()` diagnostic exists but cannot catch registration-order bugs.

**#6. `ui-controller.js` is a 1,998-line monolith mixing UI, admin, and storage logic**
- **Location:** `www/auth-ui/ui-controller.js`
- **Evidence:** Contains: HUD updates, menu panel management, equipment display, inventory rendering, character panel, settings panel, item details modal, storage/vault system (deposit/withdraw gold, move items), online players list with PvP challenge UI, group invite dialog, admin player list with test player management, multiplayer debug UI, settings visibility refresh.
- **Impact:** Any UI change requires editing a 78KB file. Storage logic (vault system) has nothing to do with auth-ui but lives here. Admin functionality is interleaved with player-facing UI.

**#7. `combat.js` mixes PvE, PvP, and group combat with UI rendering**
- **Location:** `www/gameplay/combat.js` (1,533 lines)
- **Evidence:** Three distinct combat modes (PvE at line 104, group at line 210, unified/RTDB at line 310) share the same file. Combat UI rendering (lines 689-843) is interleaved with combat logic. Victory/defeat screens (lines 844-1000+) include both reward calculation AND DOM manipulation.
- **Impact:** Cannot modify PvP without risk of breaking PvE. UI changes require understanding combat math. The extracted `battle-logic.js` (193 lines) was a good start but only covers basic math — the combat modes are still monolithic.

**#8. `map.js` at 1,985 lines mixes rendering, H3 territory, multiplayer, and canvas layers**
- **Location:** `www/map/map.js`
- **Evidence:** Contains: Leaflet init, player marker management, monster marker rendering, POI cluster management, other-player multiplayer markers, arena circle rendering, H3 territory loading/rendering, canvas monster layer management, procedural monster generation hooks, fog of war, position sync throttling, citadel territory management.
- **Impact:** The map module is the visual backbone but has become a dumping ground for anything spatial. H3 territory logic, multiplayer sync, and canvas rendering are distinct concerns packed into one file.

### Medium (Quality of life / code health)

**#9. `world_cities.js` is a 640KB static data file loaded as ES6 module**
- **Location:** `www/gameplay/world_cities.js` (35,538 lines)
- **Evidence:** Contains a single `export const WORLD_CITIES = [...]` with ~4,800 city objects. This is 640KB of JSON disguised as a JS module.
- **Impact:** Loaded at module parse time regardless of whether the player needs world cities. In a bundler-free architecture, this is 640KB of parse/compile work on mobile WebView. Should be loaded on-demand from Firestore or a JSON file fetched asynchronously.

**#10. `ui-controller.js` uses 14+ dynamic imports of `firebase-service.js`**
- **Location:** `www/auth-ui/ui-controller.js` — 14 instances of `import('../firebase/firebase-service.js')`
- **Evidence:** To avoid a static circular dependency (firebase-service.js -> ui-controller.js -> firebase-service.js), `ui-controller.js` uses dynamic `import()` for every Firebase call. Each of the 14 call sites independently imports the same module.
- **Impact:** While ES6 modules cache resolved imports (so only one actual fetch), the pattern creates 14 places where the dependency is hidden from static analysis. Any refactor of firebase-service exports requires grepping for dynamic imports across the codebase.

**#11. Quest system is a dead stub**
- **Location:** `www/core/app.js` line 1022-1024: `export function updateQuestProgress() { /* Placeholder */ }`
- **Evidence:** Registered in `bridge.js` (window.updateQuestProgress), referenced in gameState (`quests: { monstersKilled: 0, itemsCollected: 0, uniquesKilled: 0, distanceTraveled: 0 }`), quest HTML exists in templates, but no actual quest logic exists.
- **Impact:** Dead code increases cognitive load. The quest data structure in gameState is serialized to Firestore on every save, adding unnecessary payload.

**#12. `data.js` mixes static databases with no separation**
- **Location:** `www/gameplay/data.js` (420 lines)
- **Evidence:** `ITEMS_DB`, `MONSTER_LIBRARY`, `CITY_ANCHORS`, `AFFIXES`, and `GRID_SETTINGS` all in one file. This is the most-imported module in the codebase (16 imports from other files).
- **Impact:** Adding a single item to `ITEMS_DB` forces every module that imports `data.js` to re-evaluate the module. `CITY_ANCHORS` (6 entries) has nothing to do with `ITEMS_DB` (100+ entries) or `AFFIXES`.

### Low (Minor issues / tech debt)

**#13. `app.js` defines `teleportToCoords` twice**
- **Location:** `www/core/app.js` lines 1032-1043 and again at lines 1164-1180
- **Evidence:** Two `window.teleportToCoords` function definitions. The second overwrites the first.
- **Impact:** Dead code. Minimal risk but indicates lack of code review on the monolith file.

**#14. Maintenance modules (24 files, 6,466 lines) have no shared abstraction**
- **Location:** `www/maintenance/` — 24 JS files including `admin-monsters.js` (31KB), `admin-shops.js` (38KB), `admin-vaults.js` (37KB), `admin-castles.js` (36KB)
- **Evidence:** Each admin module independently imports from `firebase-service.js` and implements its own CRUD patterns. `admin-core.js` exists but is only imported by 6 of the 24 modules.
- **Impact:** Admin code is 25% of the codebase by file count. Patterns like "list items, create item, edit item, delete item" are repeated 4+ times with slight variations.

---

## Improvement Proposals

### Proposal 1: Decompose `firebase-service.js` into Domain Modules

**Problem:** 3,728 lines / 100 exports / 7+ distinct domains in one file.

**Solution:** Split into focused modules under `www/firebase/`:

```
www/firebase/
+-- firebase-init.js         -- Firebase app init, auth state, role helpers (~120 lines)
+-- firebase-auth.js         -- User profile CRUD, login/logout, role management (~150 lines)
+-- firebase-characters.js   -- Character CRUD (create/read/update/delete) (~250 lines)
+-- firebase-players.js      -- RTDB player registration, position, subscriptions (~200 lines)
+-- firebase-world.js        -- Spawned objects, templates, city zones, world snapshots (~600 lines)
+-- firebase-combat.js       -- PvP battles, combat moves, arenas, unified combat RTDB (~400 lines)
+-- firebase-groups.js       -- Group CRUD, invites, RTDB sync (~200 lines)
+-- firebase-castles.js      -- Castle discovery, claiming, abandoning, subscriptions (~200 lines)
+-- firebase-usage.js        -- Usage tracking, stats (already partially in db-usage.js) (~100 lines)
+-- firebase-service.js      -- Re-export barrel (backward compatibility) (~50 lines)
+-- firebase-monitor.js      -- (existing, keep as-is)
+-- db-usage.js              -- (existing, keep as-is)
+-- emergency-monitor.js     -- (existing, keep as-is)
```

The existing `firebase-service.js` becomes a barrel re-export file (`export * from './firebase-auth.js'`, etc.) so that all 16 existing import sites continue to work without modification during migration.

**Impact:** Each domain module is 100-600 lines. New contributors can understand the PvP Firebase layer without reading castle management code. Merge conflicts drop dramatically.

**Effort:** Medium (2-3 days). Mechanical refactor — move functions, update internal imports, keep barrel file for backward compat. No logic changes.

**Risk:** Low. Barrel re-exports preserve all existing import paths. Can be done incrementally (one domain at a time).

---

### Proposal 2: Extract Shared Init Sequence from `app.js`

**Problem:** ~300 lines of logic duplicated between `init()` and `startGameWithCharacter()`.

**Solution:** Extract shared steps into a `core/game-bootstrap.js` module:

```javascript
// core/game-bootstrap.js
export function restoreCharacterData(data) {
  // BigInt restoration, stats defaults, debug mode, role sync
}

export async function loadWorldData(position) {
  // Find closest city, fetch spawned objects, templates
}

export function setupCombatReconnection(players) {
  // Combat reconnect logic (localStorage + RTDB status check)
}

export async function initializeSubsystems() {
  // PvP, Kingdom, H3 Territory, Groups, Arenas, Discovery
}
```

Both `init()` and `startGameWithCharacter()` become thin orchestrators calling these shared functions.

**Impact:** Single source of truth for character loading. Bugs fixed once, applied to both paths. `app.js` drops from 1,427 to ~600 lines.

**Effort:** Low (1 day). Extract and call — no behavior change.

**Risk:** Low. Both paths already do the same thing; extraction just removes duplication.

---

### Proposal 3: Break `combat.js` into Combat Mode Modules

**Problem:** 1,533 lines mixing PvE, PvP, and group combat with UI rendering.

**Solution:**

```
www/gameplay/
+-- combat.js            -- Combat orchestrator: mode selection, shared state (~200 lines)
+-- combat-pve.js        -- PvE combat flow: startCombat, executeAttack (PvE path) (~300 lines)
+-- combat-pvp.js        -- PvP RTDB sync: startPvPCombat, battle round sync (~300 lines)
+-- combat-group.js      -- Group/unified combat: startGroupCombat, joinUnifiedCombat (~300 lines)
+-- combat-ui.js         -- All DOM manipulation: updateCombatUI, victory/defeat screens (~300 lines)
+-- battle-logic.js      -- (existing) Pure combat math functions (~193 lines)
+-- combat-shared.js     -- Shared: flee penalty, arena boundary, target selection (~100 lines)
```

**Impact:** PvP changes don't risk breaking PvE. UI redesign doesn't touch combat math. Each file is testable in isolation.

**Effort:** Medium (2 days). Requires careful extraction since combat modes share state (`gameState.combat`). The orchestrator pattern keeps the shared state centralized.

**Risk:** Medium. Combat state is mutable and shared — extraction requires clear ownership of `gameState.combat` mutations.

---

### Proposal 4: Decompose `ui-controller.js` by Feature Area

**Problem:** 1,998 lines mixing HUD, menus, inventory, storage, admin, and multiplayer UI.

**Solution:**

```
www/auth-ui/
+-- ui-controller.js     -- Barrel re-export + shared utilities (~100 lines)
+-- ui-hud.js            -- updateHUD, updateDistrictHUD, showNotification, addEventLog (~200 lines)
+-- ui-menus.js          -- openMenu, closeMenu, panel management (~100 lines)
+-- ui-inventory.js      -- renderInventory, filterInventory, equipItem, useItem, itemDetails (~250 lines)
+-- ui-character.js      -- updateCharacterPanel, allocateStat, equipment display (~200 lines)
+-- ui-storage.js        -- Storage/vault system: deposit, withdraw, move items (~200 lines)
+-- ui-multiplayer.js    -- Online players list, group invite dialog, PvP challenge (~250 lines)
+-- ui-admin.js          -- Admin player list, test player management, debug UI (~300 lines)
+-- ui-settings.js       -- Settings panel, toggle handlers, visibility refresh (~100 lines)
+-- character-selection.js -- (existing, keep as-is)
```

**Impact:** Storage vault system moves out of `auth-ui` conceptually. Admin UI is isolated. HUD updates are in a focused module. 14 dynamic imports of `firebase-service.js` are localized to the modules that need them.

**Effort:** Medium (2 days). Similar mechanical refactor as Proposal 1.

**Risk:** Low with barrel re-export pattern.

---

### Proposal 5: Consolidate `window.*` Registration into `bridge.js`

**Problem:** 80+ global registrations across 5 files, with duplicates.

**Solution:**
1. Remove all `window.*` assignments from `ui-controller.js` (lines 780-817, 920, 937, 982, 1145), `app.js` (debug functions), `character-selection.js`, and `ui.js`.
2. Consolidate all registrations into `bridge.js` with clear sections.
3. Add a startup diagnostic that detects duplicate window registrations.

```javascript
// bridge.js — THE SINGLE SOURCE OF TRUTH
// === UI ===
window.openMenu = openMenu;
window.closeMenu = closeMenu;
// ... (grouped by domain)

// === Combat ===
window.startCombat = startCombat;
// ...

// === Debug (admin-only, registered conditionally) ===
// window.teleportToCoords = teleportToCoords;
// ...
```

**Impact:** Single file to check "what's globally available." Eliminates duplicate registrations. Debug functions can be conditionally registered.

**Effort:** Low (0.5 day). Grep-and-move operation.

**Risk:** Low. Must ensure no registration is missed, but `window.__checkGlobalFunctions()` diagnostic catches this.

---

### Proposal 6: Move `world_cities.js` to Async-Loaded JSON

**Problem:** 640KB (35,538 lines) of static city data loaded as an ES6 module at parse time.

**Solution:**
1. Convert to `world_cities.json` in `www/assets/data/`.
2. Load via `fetch()` on demand when H3 territory system needs it.
3. Cache in IndexedDB via SyncEngine after first load.

```javascript
// Before: import { WORLD_CITIES } from './world_cities.js'; // 640KB parse
// After:
async function getWorldCities() {
  const cached = await SyncEngine.get('world_cities');
  if (cached) return cached;
  const resp = await fetch('/assets/data/world_cities.json');
  const cities = await resp.json();
  await SyncEngine.put('world_cities', cities);
  return cities;
}
```

**Impact:** Saves 640KB of parse/compile work on cold start. Mobile WebView performance improvement. Data cached locally after first load.

**Effort:** Low (0.5 day). Convert export to JSON file, add async loader.

**Risk:** Low. Only used by H3 territory system which already loads asynchronously.

---

### Proposal 7: Decompose `map.js` by Rendering Concern

**Problem:** 1,985 lines mixing Leaflet core, markers, multiplayer, H3, and canvas.

**Solution:**

```
www/map/
+-- map.js               -- Leaflet init, player marker, position updates (~400 lines)
+-- map-markers.js       -- Monster markers, POI clusters, arena circles (~300 lines)
+-- map-multiplayer.js   -- Other player markers, position sync, online status (~300 lines)
+-- map-territory.js     -- H3 territory loading, citadel rendering, canvas layer (~400 lines)
+-- map-fog.js           -- Fog of war rendering (~100 lines)
+-- canvas-renderer.js   -- (existing, keep as-is)
+-- territory-canvas.js  -- (existing, keep as-is)
+-- territory-service.js -- (existing, keep as-is)
+-- poi.js               -- (existing, keep as-is)
+-- districts.js         -- (existing, keep as-is)
+-- kingdom.js           -- (existing, keep as-is)
```

**Impact:** Map init is fast and focused. Territory code (which involves H3 library loading) is isolated. Multiplayer marker management is a self-contained module.

**Effort:** Medium (1.5 days). Map module has shared state (Leaflet `map` instance, layer groups) that needs careful export management.

**Risk:** Medium. The Leaflet `map` instance is shared across all sub-modules — needs a clear pattern for accessing it (e.g., `getMap()` accessor in the core map module).

---

### Proposal 8: Fix the `combat.js` <-> `app.js` Circular Dependency

**Problem:** `combat.js` statically imports `saveGame` from `app.js`, while `app.js` statically imports `combat.js`.

**Solution:** Move `saveGame` to a dedicated module or use dependency injection:

**Option A (Preferred):** Move `saveGame` to `core/save-service.js`
```javascript
// core/save-service.js
export async function saveGame() { /* current saveGame logic */ }
export async function loadGame() { /* current loadGame logic */ }
```
Both `app.js` and `combat.js` import from `save-service.js`. No circular dependency.

**Option B:** Inject via `window.triggerSave()` (already partially done)
```javascript
// combat.js -- instead of:
import { saveGame } from '../core/app.js';
// use:
if (window.triggerSave) window.triggerSave();
```

**Impact:** Clean dependency graph. `combat.js` can be tested without loading `app.js`.

**Effort:** Low (0.5 day). Move one function and update imports.

**Risk:** Very low.

---

## Recommended Priority Order

### Phase 1: Critical Fixes (Week 1)
1. **Fix `isAdmin()` return true** — one-line fix, critical security issue (#3)
2. **Fix circular dependency** — Proposal 8, extract `save-service.js` (#2)
3. **Consolidate `window.*` globals** — Proposal 5, mechanical cleanup (#5)

### Phase 2: Core Decomposition (Weeks 2-3)
4. **Decompose `firebase-service.js`** — Proposal 1, highest structural impact (#1)
5. **Extract shared init sequence** — Proposal 2, eliminates duplication (#4)
6. **Move `world_cities.js` to JSON** — Proposal 6, quick performance win (#9)

### Phase 3: Feature Module Decomposition (Weeks 3-4)
7. **Decompose `combat.js`** — Proposal 3, enables independent combat mode development (#7)
8. **Decompose `ui-controller.js`** — Proposal 4, enables parallel UI work (#6)
9. **Decompose `map.js`** — Proposal 7, cleanest module boundaries (#8)

### Phase 4: Cleanup (Ongoing)
10. **Remove duplicate `teleportToCoords`** — (#13)
11. **Remove quest stubs or implement quest system** — (#11)
12. **Split `data.js` into domain-specific data files** — (#12)
13. **Standardize admin module patterns** — (#14)
14. **Eliminate hidden dynamic imports in `ui-controller.js`** — (#10, resolved naturally by Proposal 4)

---

## Risk Assessment

### Risk 1: Barrel Re-Export Performance
**Concern:** Using barrel files (`export * from './sub-module.js'`) may cause the browser to load all sub-modules eagerly.
**Mitigation:** This is actually desired — the current single-file approach loads everything eagerly anyway. The decomposition doesn't change load behavior, only code organization. For true lazy loading, critical modules (e.g., admin, PvP) can use dynamic `import()` at call sites.

### Risk 2: Shared Mutable State During Extraction
**Concern:** `gameState` is a mutable singleton imported by 9 modules. `firebase-service.js` has module-level caches (`_spawnedObjectsCache`, `_worldFetchPromise`, etc.). Moving functions to sub-modules may break cache sharing.
**Mitigation:** Module-level caches stay in the sub-module that owns them. The barrel file only re-exports functions, not internal state. Each sub-module manages its own cache.

### Risk 3: Regression During Mechanical Refactors
**Concern:** Moving 3,728 lines of firebase-service.js into 8 files is error-prone.
**Mitigation:** Each proposal can be validated by:
1. `window.__checkGlobalFunctions()` — verifies all globals still registered
2. Manual smoke test: login -> character select -> map load -> combat -> save
3. No logic changes in Phase 2 — purely structural moves

### Risk 4: `templates_map.html` at 3,070 Lines
**Concern:** The largest HTML template file is injected by `ui-loader.js` at startup. Any UI decomposition must account for this.
**Mitigation:** Not addressed in this proposal. A separate UI template proposal should break `templates_map.html` into component-level fragments loaded by their owning modules.

### Risk 5: No Test Framework
**Concern:** All proposals rely on manual testing. No automated regression detection.
**Mitigation:** The `battle-logic.js` extraction (already done) proves pure-function modules are testable. Proposals 1-8 produce more pure modules. A future proposal should introduce a lightweight test runner (e.g., `scripts/tests/test_logic.js` already exists) and unit tests for extracted modules.

---

## Appendix: Import Graph Analysis

### Most-Imported Modules (Coupling Hotspots)
| Module | Import Count | Role |
|--------|-------------|------|
| `gameplay/data.js` | 16 | Static databases — acceptable high coupling |
| `firebase/firebase-service.js` | 16 | Firebase monolith — decomposition target |
| `core/gameState.js` | 9 | State singleton — acceptable |
| `map/territory-service.js` | 8 | Territory management |
| `auth-ui/ui-controller.js` | 7 | UI monolith — decomposition target |
| `map/map.js` | 3 | Map module |
| `core/app.js` | 3 | Entry point — should be 0 (leaf node) |

### Key Observation
`core/app.js` is imported by 3 other modules. As the application entry point, it should ideally be a **leaf node** (imports others, nothing imports it). The 3 imports are:
- `combat.js` -> `saveGame` (circular dependency, fixed by Proposal 8)
- `bridge.js` -> `resetGame`, `saveGame`, `updateQuestProgress` (legitimate, but should use save-service after Proposal 8)
- `maintenance/admin-world.js` -> `setupWorldSync` (should be moved to world-sync module)
