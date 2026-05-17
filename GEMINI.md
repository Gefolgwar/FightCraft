# GEMINI.md

Instructions for Gemini Code Assist when working with FightCraft.

## Build & Run Commands

```bash
npm install                                    # Install dependencies
npx firebase serve --only hosting --port 5000  # Start local server → http://localhost:5000
npx firebase deploy --only hosting             # Deploy to production
npx cap sync android                           # Sync Capacitor (Android)
npm run android:build                          # Build debug APK
```

No bundler — JS files are served directly as ES6 modules. No build step.

---

## Project Overview

FightCraft is a geolocation RPG (HTML5/JS/TailwindCSS) wrapped in Capacitor for Android, using Firebase as a serverless backend.

- **Entry point:** `www/core/index.html` → `core/app.js` (ES6 module)
- **Live URL:** https://fight-craft-3c3f0.web.app
- **Firebase project:** `fight-craft-3c3f0`
- **Android package:** `com.fightcraft.game`

---

## Shared AI Infrastructure

Cross-tool AI configuration lives in `.ai_shared/`. Both Claude and Gemini reference this shared layer.

| Layer | Location | Purpose |
|-------|----------|---------|
| Orchestration | `.ai_shared/INSTRUCTIONS.md` | DOE algorithm, ACR role system |
| Directives | `.ai_shared/directives/` | Natural-language SOPs |
| Execution | `.ai_shared/execution/` | PowerShell validation/audit scripts |
| Context | `.ai_shared/context/` | Shared design context |

Read `.ai_shared/INSTRUCTIONS.md` for the full DOE (Directive → Orchestration → Execution) protocol.

---

## Project Structure

**Strict Project Structure Rule:** NO stray files are allowed in the project root. Every new file MUST go into its designated folder. Temporary files, test scripts, patch files, or loose documentation are strictly prohibited in the root directory.

```
www/                         ← Firebase Hosting root
├── core/                    ← Application core (app.js, gameState.js, bridge.js)
├── auth-ui/                 ← Authentication & UI management
├── firebase/                ← Firebase integration (firebase-service.js — 103KB)
├── gameplay/                ← Game mechanics (combat.js, pvp.js, data.js, monsters.js)
├── map/                     ← Map & geography (map.js, districts.js, kingdom.js)
├── maintenance/             ← Admin tools (25 files)
├── css/style.css            ← Custom styles
└── assets/                  ← Static assets

scripts/                     ← Node/Bash utility scripts
├── generators/              ← Data generators (generate-cities.js)
├── diagnostics/             ← Playwright diagnostic tools
├── patches/                 ← Temporary patches and fix scripts
└── tests/                   ← Testing scripts and play logic

docs/                        ← Documentation
├── proposals/               ← RFCs and architecture proposals
├── reports/                 ← Analysis and progress reports
└── tasks/                   ← Ongoing task records

.ai_shared/                  ← Shared AI infrastructure (DOE)
├── INSTRUCTIONS.md          ← Orchestration
├── directives/              ← SOPs
├── execution/               ← Validation scripts
└── context/                 ← Design context

.claude/                     ← Claude Code config (agents, rules, skills)
.gemini/                     ← Gemini config
firebase/                    ← Firebase rules (firestore.rules, database.rules.json, storage.rules)
tests/                       ← Vitest test suite
```

---

## Firebase Architecture

### Three Services

| Service | Purpose | Rules File |
|---------|---------|------------|
| Firestore | Persistent game state | `firebase/firestore.rules` |
| RTDB | Real-time ephemeral state | `firebase/database.rules.json` |
| Storage | Static bundles for SyncEngine | `firebase/storage.rules` |

### Key Collections (Firestore)

| Collection | Purpose |
|------------|---------|
| `users/{uid}` | Player profiles (`role`, `uid` fields are protected) |
| `users/{uid}/characters/{charId}` | Character data |
| `spawned_objects/{objectId}` | Map objects (update restricted to `defeatedAt` field) |
| `templates/{templateId}` | Game object templates (admin-only write) |
| `world_snapshots/{snapshotId}` | World state snapshots (admin-only write) |
| `combats/{combatId}` | Combat records |

### Key RTDB Nodes

| Node | Purpose |
|------|---------|
| `live_players/{charId}` | GPS position sync |
| `battles/{battleId}` | Real-time PvP turn sync |
| `groups/{groupId}` | Party state |

---

## Security Model

### Admin Verification

```
1. Custom claim: request.auth.token.admin == true  ← preferred
2. Hardcoded UID: 'YshG61RxTIczGXOfFqiu2wqC63r2'  ← legacy fallback
3. Firestore role: get(users/{uid}).data.role == 'admin'  ← deprecated
```

### Known Security Gaps

- RTDB `battles`, `group_invites`, `arenas` accept writes from any authenticated user
- GPS validation checks type only, no range bounds or spoofing detection
- All combat resolution is client-side (no server-authoritative validation)

---

## Key Data Patterns

- **XP uses BigInt** — serialized as strings in Firestore, reconverted on load
- **Save system** — `triggerSave()` debounced 5s → single Firestore write
- **Position updates** — RTDB `set()` (not Firestore) to avoid cost
- **Combat reconnection** — `localStorage.activePvPBattleId` + RTDB status check

---

## Behavioral Guidelines

1. **Think before coding** — state assumptions explicitly, ask if uncertain
2. **Simplicity first** — minimum code that solves the problem
3. **Surgical changes** — touch only what you must
4. **Goal-driven execution** — define success criteria, loop until verified
