# CLAUDE.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Build & Run Commands

```bash
npm install                                    # Install dependencies
npx firebase serve --only hosting --port 5000  # Start local server → http://localhost:5000
npx firebase deploy --only hosting             # Deploy to production
npx cap sync android                           # Sync Capacitor (Android)
npx cap open android                           # Open in Android Studio
npm run android:build                          # Build debug APK
npm run android:release                        # Build release AAB
```

- **No bundler** — JS files are served directly as ES6 modules. No build step.
- **No test framework** — Manual testing via browser console. See `docs/DEV-QUICK-REFERENCE.md`.
- **Hot reload** — Hard-refresh (Ctrl+F5). No HMR.

---

## High-Level Architecture

FightCraft is a geolocation RPG (HTML5/JS/TailwindCSS) wrapped in Capacitor for Android, using Firebase as a serverless backend.

### Module Loading & Entry Points

`www/index.html` redirects to `www/core/index.html`, the true entry point. It loads:

1. **Global scripts** (Leaflet, Turf.js, TailwindCSS CDN, MarkerCluster)
2. `auth-ui/ui-loader.js` (regular script) — injects HTML templates (character selection, map templates, gameplay templates) into the DOM before modules run
3. `core/app.js` (ES6 module, `type="module"`) — main entry point

### Init Sequence (app.js)

```
1. initLogger()          → intercept console.* for debug overlay
2. initCharacterSelection() → Firebase auth → character picker → load/create
3. Object.assign(gameState, data) → merge character data into state
4. BigInt restore        → convert XP strings from Firestore back to BigInt
5. GPS acquisition       → real coords or fallback to Berlin (52.484512, 13.449876)
6. registerPlayerInRTDB()→ set position + onDisconnect cleanup
7. PvP reconnect check   → localStorage.activePvPBattleId + RTDB in_combat status
8. subscribeToPlayersRTDB() → live player markers + online list
9. initMap()             → Leaflet map init
10. loadStaticMonsters() → parse + render from Firestore spawned_objects
11. fetchSpawnedObjectsOnce() + getCityZones() + getTemplates() → parallel
12. checkAndFetchPOIs()  → Points of Interest
13. initPvP() + initKingdom() + initH3Territory() + initGroups() → subsystems (including immediate H3 discovery)
14. subscribeToArenas()  → RTDB arena listeners
15. recalculateStats()   → derive all stats from base attributes + equipment
16. updateHUD()          → render all UI
17. Game loops start     → regen (1s), income, world sync
18. triggerSave debounce → 5s inactivity → Firestore write
```

---

## Project Structure

**Strict Project Structure Rule:** NO stray files are allowed in the project root. Every new file MUST go into its designated folder. Temporary files, test scripts, patch files, or loose documentation are strictly prohibited in the root directory.

```
www/                         ← Firebase Hosting root
├── core/                    ← Application core
│   ├── index.html           ← TRUE entry point (~1100 lines, all game UI)
│   ├── app.js               ← Init sequence, save/load, debug, game loops (35KB)
│   ├── bridge.js            ← window.* function registry for inline onclick
│   ├── gameState.js         ← In-memory state singleton + recalculateStats()
│   ├── logger.js            ← console.* interceptor → on-screen debug console
│   ├── diagnostics.js       ← Runtime diagnostics (runs 10s after boot)
│   ├── capacitor.js         ← Capacitor integration stub
│   └── geometry-utils.js    ← Spatial calculation helpers
├── auth-ui/                 ← Authentication & UI management
│   ├── login.html           ← Firebase Auth login page
│   ├── character-selection-ui.html ← Character picker template
│   ├── character-selection.js ← Multi-character CRUD (create/select/delete/switch)
│   ├── ui-controller.js     ← Panel/modal/HUD management (77KB, largest UI file)
│   ├── ui-loader.js         ← Dynamic HTML template injection at startup
│   └── ui.js                ← UI utilities
├── firebase/                ← Firebase integration
│   ├── firebase-service.js  ← ALL Firebase CRUD, auth, RTDB (103KB, largest file)
│   ├── firebase-monitor.js  ← Firestore read/write counter
│   ├── db-usage.js          ← Database usage tracking UI
│   └── emergency-monitor.js ← Emergency monitoring
├── gameplay/                ← Game mechanics
│   ├── combat.js            ← PvE + PvP + Group combat system (64KB)
│   ├── battle-logic.js      ← Extracted combat math — pure functions (testable)
│   ├── pvp.js               ← PvP: battle requests, leaderboards, RTDB sync
│   ├── data.js              ← Static databases: ITEMS_DB, MONSTER_LIBRARY, CITY_ANCHORS
│   ├── world_cities*.json   ← Pre-generated boundaries & POIs (do not fetch dynamically)
│   ├── monsters.js          ← Monster generation/rendering logic
│   ├── groups.js            ← RTDB-synced group/party system
│   ├── sync-engine.js       ← IndexedDB caching layer for Firestore (27KB)
│   ├── generation-service.js← World object generation
│   └── gameplay_*.html      ← 6 admin gameplay templates
├── map/                     ← Map & geography
│   ├── map.js               ← Leaflet map, player/monster/POI markers (48KB)
│   ├── districts.js         ← Geographic district boundaries + point-in-polygon
│   ├── kingdom.js           ← Citadel capture + passive income system
│   ├── poi.js               ← Points of Interest rendering
│   ├── overpass-service.js  ← Overpass API integration (currently disabled)
│   ├── territory-service.js ← Territory management
│   └── templates_map.html   ← Map UI templates (66KB)
├── maintenance/             ← Admin & utility tools (25 files)
│   ├── admin.html           ← Admin panel
│   ├── admin-*.js           ← Admin modules (monsters, shops, castles, citadels, vaults, leveling)
│   ├── admin-bundler.js     ← Static bundle generator for SyncEngine
│   ├── backup-firestore.js / restore-firestore.js ← Firestore backup/restore
│   └── *-cleanup.js         ← Database cleanup utilities
├── css/style.css            ← Custom styles (14KB)
└── assets/                  ← Static assets

scripts/                     ← Node/Bash utility scripts (run from project root)
├── generators/              ← Data generators (fetch-city-boundaries.js, fetch-city-pois.js, repair_firebase.js)
├── diagnostics/             ← Playwright diagnostic tools
├── patches/                 ← Temporary patches and fix scripts
└── tests/                   ← Testing scripts and play logic

docs/                        ← Documentation
├── proposals/               ← RFCs and architecture proposals
├── reports/                 ← Analysis and progress reports
└── tasks/                   ← Ongoing task records
```

### Firebase Rules (in `firebase/` directory, NOT project root)

```
firebase/
├── firestore.rules          ← Firestore Security Rules
├── database.rules.json      ← RTDB Security Rules
├── storage.rules            ← Storage Security Rules
└── cors.json                ← CORS configuration
```

`firebase.json` points to these: `"rules": "firebase/firestore.rules"`, etc.

---

## Firebase Architecture

### Three Services, Three Rule Files

| Service | Purpose | Rules File | SDK Loading |
|---------|---------|------------|-------------|
| **Firestore** | Persistent game state | `firebase/firestore.rules` | ESM CDN in `firebase-service.js` |
| **RTDB** | Real-time ephemeral state | `firebase/database.rules.json` | ESM CDN in `firebase-service.js` |
| **Storage** | Static bundles for SyncEngine | `firebase/storage.rules` | ESM CDN in `firebase-service.js` |

Firebase SDK is loaded via ESM CDN imports in `firebase-service.js` (not from `index.html`).

### Firestore Collections

| Collection | Purpose | Client Access |
|------------|---------|---------------|
| `users/{uid}` | Player profiles, metadata | Self-write (protected: `role`, `uid`), public read |
| `users/{uid}/characters/{charId}` | Character data (stats, equipment, inventory) | Owner read/write |
| `users/{uid}/invites/{inviteId}` | Inbox pattern — anyone can create, only owner reads | Create: any auth; R/U/D: owner |
| `spawned_objects/{objectId}` | Monsters, shops, castles on the map | Read: any auth; Update: only `defeatedAt` field; Write: admin |
| `templates/{templateId}` | Monster/shop/castle templates for world gen | Read: any auth; Write: admin |
| `world_chunks/{chunkId}` | Compressed binary payloads for city zones | Read: any auth; Write: admin |
| `world_metadata/{docId}` | Sync metadata (versions, timestamps) | Read: any auth; Write: admin |
| `city_zones/{cityId}` | City zone definitions | Read: any auth; Write: admin |
| `castles/{castleId}` | Persistent territorial data | Read: any auth; Write: admin |
| `combats/{combatId}` | Combat records | Read: any auth; Create: any auth; Update: participants or admin |
| `world_snapshots/{snapshotId}` | World state snapshots | Read: any auth; Write: admin |
| `players/{playerId}` | **Legacy** — being deprecated | Self-write, public read |

### RTDB Nodes

| Node | Purpose | Write Rules |
|------|---------|-------------|
| `live_players/{charId}` | GPS position sync (`lat`, `lng`), online status | Owner only (validated via `userId`) |
| `battle_requests/{battleId}` | PvP matchmaking handshakes | Creator or participants |
| `battles/{battleId}` | Real-time PvP turn sync (rounds, choices, results) | ⚠️ Any authenticated user |
| `combats/{combatId}` | Live combat instances (PvE/group) | ⚠️ Partially restricted |
| `groups/{groupId}` | Ephemeral party state | ⚠️ Partially restricted |
| `group_invites/{targetCharId}` | Group invitation delivery | ⚠️ Any authenticated user |
| `arenas/{arenaId}` | 50m combat boundary zones on the map | ⚠️ Any authenticated user |
| `players/{uid}` | Legacy player data mirror | Owner only |

> ⚠️ Nodes marked with ⚠️ have overly permissive write rules. See Security Model below.

---

## Key Module Responsibilities

| Module | Path | Role | Testability |
|--------|------|------|-------------|
| `app.js` | `core/` | Init sequence, save/load, GPS, game loops | Low — orchestration |
| `gameState.js` | `core/` | State singleton, `recalculateStats()`, mutations | **High** — pure functions |
| `bridge.js` | `core/` | Window-global function registry for `onclick` | N/A — glue code |
| `firebase-service.js` | `firebase/` | ALL Firebase CRUD, auth, RTDB subscriptions | Low — side effects |
| `ui-controller.js` | `auth-ui/` | Panel/modal/HUD, notifications, online player list | Low — DOM-coupled |
| `combat.js` | `gameplay/` | PvE + PvP + group combat, zone-based resolution | Medium |
| `battle-logic.js` | `gameplay/` | Extracted combat math (damage, hit, dodge, crit) | **High** — pure computation |
| `pvp.js` | `gameplay/` | PvP: battle requests, fight sync, leaderboards | Low — RTDB + DOM |
| `data.js` | `gameplay/` | `ITEMS_DB`, `MONSTER_LIBRARY`, `CITY_ANCHORS`, `AFFIXES` | **High** — pure data |
| `monsters.js` | `gameplay/` | Monster generation + rendering logic | **High** — computational |
| `groups.js` | `gameplay/` | Group CRUD, invite flow, RTDB sync | Low — RTDB-dependent |
| `sync-engine.js` | `gameplay/` | IndexedDB caching for Firestore (Static Bundles) | Medium |
| `map.js` | `map/` | Leaflet map, player/monster/arena markers, fog | Low — DOM + Leaflet |
| `districts.js` | `map/` | Geographic district boundaries, point-in-polygon | Medium — geometry testable |
| `kingdom.js` | `map/` | Citadel capture, passive income, district king | Low |
| `poi.js` | `map/` | Points of Interest rendering + income processing | Low |
| `character-selection.js` | `auth-ui/` | Multi-character management (create/select/delete) | Low — DOM |
| `firebase-monitor.js` | `firebase/` | Firestore read/write/delete counter | **High** — mockable |
| `logger.js` | `core/` | `console.*` interceptor → on-screen debug console | Medium |

### Global Function Pattern

Functions used in inline `onclick` handlers must be attached to `window`. Two mechanisms:
- **`core/bridge.js`** — primary registry; imports from all modules and exports to `window.*`
- **Individual modules** — some attach globals directly (e.g., `app.js`, `combat.js`)

Diagnostic: `window.__checkGlobalFunctions()` in browser console.

---

## Key Data Patterns

### Pre-generated World Data

To minimize Overpass API requests during procedural generation, city boundaries and POIs are pre-fetched via Node scripts and stored in `www/gameplay/`:
- `world_cities.json`: Base list of cities worldwide.
- `world_cities_boundaries.json`: City boundary polygons (generated via `scripts/generators/fetch-city-boundaries.js`).
- `world_cities_pois.json`: Key landmarks used for Citadel snapping (generated via `scripts/generators/fetch-city-pois.js`).

> **💡 Pro-tip for Scripts:** Both generator scripts support the `--resume` flag (e.g., `node scripts/generators/fetch-city-pois.js --resume`). This allows the script to safely skip successfully processed cities and retry only the failed ones or pick up where it left off, which is critical due to Overpass API rate limits.

**DO NOT** duplicate OSM fetching logic inside client-side or procedural game loop code. Always rely on these pre-fetched JSON files to build the world zones and snap points.

### XP Uses BigInt

`gameState.player.xp` and `gameState.player.xpToNext` are **BigInt**. Firestore serializes as strings; `app.js` reconverts on load. All XP arithmetic must use BigInt operators. Level curve: `500 * level²`.

### Save System

- `gameState.js` mutations call `window.triggerSave()` (debounced 5s → single Firestore write)
- XP is serialized to string before Firestore save: `xp.toString()`
- Position updates use RTDB `set()` (NOT Firestore) to avoid cost
- `onDisconnect` auto-removes player from `live_players` on disconnect

### Combat Reconnection

On page refresh, combat state is recovered via:
1. `localStorage.getItem('activePvPBattleId')` → PvP battle reconnect
2. RTDB `live_players/{charId}.status === 'in_combat'` → group/unified combat reconnect
3. `combatId` prefix routing: `combat_*` → `joinUnifiedCombat()`, `arena_*` → `startPvPCombat()`

### Character Storage

Characters stored at `users/{uid}/characters/{charId}` in Firestore. Selection persists via `localStorage('lastCharacterId')`. The `gameState` singleton is populated via `Object.assign(gameState, characterData)`.

---

## Combat System

Zone-based tactical combat with 4 attack zones and 4 defense combos:

| Attack Zones | Defense Combos |
|-------------|----------------|
| Head, Body, Belt, Legs | Head+Body, Body+Belt, Belt+Legs, Head+Legs |

Resolution: attack zone matched against defense zones → hit/miss → crit roll → damage calc → defense reduction.

- **Monster classes:** Normal, Champion, Unique, Super Unique
- **Monster affixes:** Stone Skin, Extra Strong, Teleport, Cursed, Mana Burn
- **Flee penalty:** -30% Gold, -5% XP, lose 1 random item, monster gets 1hr cooldown
- **Arena boundary:** 50m radius — leaving = auto-defeat

---

## Security Model

### Admin Verification (3-tier, being consolidated)

```
1. Custom claim: request.auth.token.admin == true  ← preferred
2. Hardcoded UID: 'YshG61RxTIczGXOfFqiu2wqC63r2'  ← fallback, to be removed
3. Firestore role: users/{uid}.role == 'admin'      ← legacy, to be deprecated
```

Storage rules are strictest: only accept custom claim.

### Key Security Rules

- **Protected fields:** `role` and `uid` on user documents cannot be self-modified
- **Field-level restriction:** `spawned_objects` updates limited to `defeatedAt` field only (must be number)
- **Inbox pattern:** `users/{userId}/invites` — any auth user can create, only owner can read/modify
- **Catch-all deny:** `match /{document=**} { allow read, write: if false; }` at bottom of Firestore rules

### Known Security Gaps

1. **RTDB permissive writes:** `battles`, `group_invites`, `arenas` accept writes from any authenticated user without ownership validation
2. **GPS validation:** RTDB validates data type only (number), no range bounds (-90..90, -180..180), no spoofing/teleportation detection
3. **isAdmin() recursive read:** Still includes Firestore `get()` fallback for role-based admin check — planned for removal after custom claims migration
4. **Client-side combat:** All combat resolution happens client-side; no server-authoritative validation

---

## Styling & Z-Index Layers

TailwindCSS loaded from CDN (~300KB, ~5% utilized — accepted trade-off for bundler-free arch). Custom styles in `www/css/style.css`.

| Z-Index | Layer |
|---------|-------|
| `z-[1000]` | HUD (top bar, bottom nav) |
| `z-[1001]` | FAB buttons, debug elements |
| `z-[1002]` | Event log, online players panel |
| `z-[2000]` | Menu panels (character, inventory, quests, settings) |
| `z-[3000]` | Item detail modal |
| `z-[4000]` | Combat screen, encounter dialog |
| `z-[5000]` | Victory / Defeat / Draw screens |
| `z-[99999]` | Loading screen |

---

## Development Context

- **Language:** English for all docs and agent files. Code comments mixed (Ukrainian migration in progress).
- **Live URL:** https://fight-craft-3c3f0.web.app
- **Firebase project ID:** `fight-craft-3c3f0`
- **Android package:** `com.fightcraft.game`
- **Default fallback coordinates:** Berlin (52.484512, 13.449876) when GPS is unavailable
- **Multi-city support:** 6 city anchors (Berlin, Kyiv, Lviv, Warsaw, Prague, Vienna) — defined in `CITY_ANCHORS` in `gameplay/data.js` (Transitioning to H3 global procedural discovery)
- **Design system:** Penpot-managed UI tokens (37 color rules, spacing/sizing tokens, 8px grid) — see `docs/SRC.md`
- **Firestore optimization:** ~15 reads at startup (down from 2600+ via SyncEngine + IndexedDB caching)

---

## Known Technical Debt

1. **Quest system** — `updateQuestProgress()` is a stub; quests are hardcoded in HTML
2. **RTDB security** — `battles`, `combats`, `arenas`, `groups`, `group_invites` lack ownership validation
3. **Tax management** — Citadel king tax shows "coming soon" notification
4. **isAdmin() fallback** — Recursive Firestore read for role-based admin check still present
5. **Overpass API** — POI fetching disabled; world content comes from Firestore sync only
6. **TailwindCSS CDN** — Full ~300KB library loaded with ~5% utilization (purging would reduce to ~10KB)
7. **firebase-service.js** — 103KB / ~2800 lines — monolith file that could be decomposed
8. **Client-side combat** — No server-authoritative combat validation (would require Cloud Functions)

---

## Multi-Agent System

FightCraft supports two AI agent systems sharing the same project context:

### Claude Code Agents (`.claude/agents/`)

6 specialized agents for Claude Code's teammate mode:

| Agent | Role |
|-------|------|
| `system-architect.md` | Architecture planning & system design |
| `security-reviewer.md` | Security audits, Firebase rules, GPS privacy |
| `perf-reviewer.md` | Performance optimization, Firebase costs |
| `logic-reviewer.md` | Logic correctness, error handling |
| `fullstack-coder.md` | Implementation & bug fixes |
| `fightcraft-game-dev.md` | Game-specific development |

**Rules** (`.claude/rules/`):
- `firebase-logic.md` — **Always-on rule**. Explains all 3 Firebase rule files, emphasizing `isAdmin()`, field protections (role/uid), monster cooldowns, and RTDB vulnerabilities.
- `security-linting.md` — **Security linting guidelines**. Demands a 4-step security lint (Syntax, Skill Load, Pattern Matching, Drift Detection) before deploying any Firebase rules.
- `multi-agent-orchestrator.md` — **Orchestrator Protocol**. Dictates the workflow for breaking down tasks, delegating to specialized agents (`.claude/agents/`), and formatting Tmux visualization markers (`🔄 [ORCHESTRATOR]`, `➡️ [DELEGATING TO]`, etc.).

### Shared AI Infrastructure (`.ai_shared/`) — DOE Architecture

Three-layer DOE (Directive → Orchestration → Execution):

| Layer | Location | Purpose |
|-------|----------|---------|
| Orchestration | `INSTRUCTIONS.md` | Command routing, DOE algorithm, ACR role system |
| Directives | `directives/` | Natural-language SOPs (template-sync) |
| Execution | `execution/` | PowerShell validation/audit scripts |
| Context | `context/` | Shared design context |

### MCP Configuration

MCP servers configured in `.claude/settings.json`. Active plugins:
- **Firebase** — Firestore, RTDB, Auth, Storage tools. Project: `fight-craft-3c3f0`. Credentials: `firebase-key.json` (`.claude/` directory)
- **Context7** — Up-to-date library documentation
- **Playwright** — Browser automation and testing

---

## Key Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| **PRD** | `docs/PRD.md` | 104 user stories, implementation decisions, security model, testing plan |
| **Tech Spec** | `docs/SRC.md` | System architecture, Firestore/RTDB schemas, Penpot design system |
| **Dev Reference** | `docs/DEV-QUICK-REFERENCE.md` | HTML IDs, global functions, debugging recipes, test scripts |
| **README** | `README.md` | Project overview, structure, quick start, gameplay summary |

---

## Behavioral Guidelines

### 0. Multi-Agent Orchestration (MANDATORY)

**On EVERY user prompt, you MUST call `TeamCreate` before any other action.** This is non-negotiable. See `.claude/rules/multi-agent-orchestrator.md` for the full protocol. Delegate work to specialists from `.claude/agents/`. Never perform complex tasks (coding, auditing, architecting) yourself — spin up the appropriate agent via the `Agent` tool.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- ALWAYS read graphify-out/GRAPH_REPORT.md before reading any source files, running grep/glob searches, or answering codebase questions. The graph is your primary map of the codebase.
- IF graphify-out/wiki/index.md EXISTS, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
