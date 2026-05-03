# Scripts & AI Infrastructure Migration

**Date:** 2026-05-03
**Status:** Approved

## Problem

The project root contains 16 loose scripts (patches, diagnostics, generators, tests) and 3 diagnostic screenshots that should not be there. AI infrastructure is fragmented across `.agents/` (DOE architecture), `.claude/` (Claude-specific), `.gemini/` (1 scratch file), and `.context/` (1 design doc) with no shared foundation.

## Goals

1. Clean the project root by deleting dead one-shot patches and clutter
2. Create `scripts/` hierarchy organized by purpose for surviving scripts
3. Create `.ai_shared/` as the shared AI infrastructure layer (absorbs `.agents/` and `.context/`)
4. Set up `GEMINI.md` and `.gemini/` for Gemini Code Assist integration
5. Update all references (CLAUDE.md, .gitignore, directive docs)

## Non-Goals

- Refactoring `www/maintenance/` browser-side admin modules (they stay where they are)
- Modifying the `tests/` vitest test suite
- Changing `.claude/` internal structure (agents, rules, skills, settings)

---

## Phase 1: DELETE (16 root files)

### Dead Patches (10 files)

| File | Type | What it did |
|------|------|-------------|
| `patch_map.js` | Node CJS | Injected citadel markers into map.js |
| `fix_initMap.js` | Node CJS | Rewired cluster config in map.js |
| `fix_subscribe.js` | Node CJS | Fixed subscribeToCastles in firebase-service.js |
| `restore.js` | Node CJS | Empty stub |
| `update_script.js` | Node CJS | Patched zone quotas in admin-world.js |
| `patch-templates.js` | Node CJS | Incomplete IndexedDB injection into templates_map.html |
| `patch_load_monsters.sh` | Bash | sed patch on monsters.js |
| `patch_map.sh` | Bash | sed patch on map.js |
| `patch_map_players.sh` | Bash | sed patch on map.js |
| `patch_rtdb_players.sh` | Bash | sed patch on firebase-service.js |

### Root Clutter (6 files)

| File | Reason |
|------|--------|
| `diag-01.png` | Ephemeral diagnostic screenshot |
| `diag-after-login.png` | Ephemeral diagnostic screenshot |
| `diag-charload.png` | Ephemeral diagnostic screenshot |
| `fix_admin_world.patch` | Applied git patch file |
| `fix_snapshot_cache.patch` | Applied git patch file |
| `cors.json` | Duplicate of `firebase/cors.json` |

All recoverable from git history.

---

## Phase 2: CREATE scripts/ hierarchy

```
scripts/
├── generators/
│   ├── generate-cities.js        # City data generator (all-the-cities → world_cities.js)
│   └── repair_firebase.js        # Firebase repair utility (from www/maintenance/)
├── diagnostics/
│   ├── analyze-page.mjs          # Playwright page analyzer → .analysis/
│   ├── diagnose.mjs              # Playwright character loading diagnostics
│   └── play.mjs                  # Playwright persistent browser session
└── tests/
    ├── test_logic.js             # Standalone citadel generation test
    └── test_puppeteer.js         # Puppeteer template map test
```

### Import Fixes Required

**`test_logic.js`** (ESM relative imports break when moved):
```diff
- import { CITY_ANCHORS } from "./www/gameplay/data.js";
- import { generateCitadelsAndZones } from "./www/maintenance/admin-citadel-generator.js";
+ import { CITY_ANCHORS } from "../www/gameplay/data.js";
+ import { generateCitadelsAndZones } from "../www/maintenance/admin-citadel-generator.js";
```

**`play.mjs`** (`__dirname`-relative path breaks):
```diff
- const USER_DATA_DIR = path.join(__dirname, '.playwright-profile');
+ const USER_DATA_DIR = path.join(__dirname, '..', '.playwright-profile');
```

### No Fix Needed

These scripts use CWD-relative `fs` paths (e.g., `fs.readFileSync('www/map/map.js')`). They work correctly when invoked from the project root regardless of where the script file lives:

- `generate-cities.js` — `fs.writeFileSync('www/gameplay/world_cities.js', ...)`
- `analyze-page.mjs` — uses hardcoded absolute path `/mnt/d/Project/FightCraft/.analysis`
- `diagnose.mjs` — saves to `diag-charload.png` (CWD-relative)
- `test_puppeteer.js` — navigates to `http://localhost:5000` (no file paths)

### From www/maintenance/

**`repair_firebase.js`** uses `require('fs')` and `require('path')` — it's Node-only code that should not be in the browser-served `www/` directory. Move to `scripts/generators/`.

---

## Phase 3: CREATE .ai_shared/ (shared AI infrastructure)

```
.ai_shared/
├── INSTRUCTIONS.md                    # DOE orchestration (from .agents/)
├── directives/
│   ├── _index.md                      # Directive index (from .agents/directives/)
│   └── template-sync.md              # Template-Sync SOP (from .agents/directives/)
├── execution/
│   ├── audit-template-dataflow.ps1    # Data flow auditor (from .agents/execution/)
│   ├── audit-toggle-rerender.ps1      # Toggle rerender auditor (from .agents/execution/)
│   ├── validate-template-sync.ps1     # Security rules validator (from .agents/execution/)
│   └── find-dupes.ps1                 # HTML ID dupe finder (from .gemini/scratch/)
└── context/
    └── design-system-strictness.md    # Design tokens context (from .context/)
```

### Internal Path Updates

Inside the migrated directive files, update execution script references:

**`_index.md`** and **`template-sync.md`**:
```diff
- pwsh .agents/execution/validate-template-sync.ps1
- pwsh .agents/execution/audit-template-dataflow.ps1
- pwsh .agents/execution/audit-toggle-rerender.ps1
+ pwsh .ai_shared/execution/validate-template-sync.ps1
+ pwsh .ai_shared/execution/audit-template-dataflow.ps1
+ pwsh .ai_shared/execution/audit-toggle-rerender.ps1
```

**`validate-template-sync.ps1`** (param default):
```diff
- [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
+ [string]$ProjectRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
```
This resolves to the project root from `.ai_shared/execution/` — same as before from `.agents/execution/`. No change needed.

### Directories Removed After Migration

- `.agents/` — all content moved to `.ai_shared/`
- `.context/` — content moved to `.ai_shared/context/`

---

## Phase 4: CREATE GEMINI.md + configure .gemini/

### GEMINI.md (project root)

A condensed instruction file for Gemini Code Assist. Contents:
- Project overview (FightCraft geolocation RPG, Firebase backend, Capacitor Android)
- Build & run commands (same as CLAUDE.md)
- Pointer to `.ai_shared/INSTRUCTIONS.md` for DOE protocol
- Pointer to `.ai_shared/directives/` for SOPs
- Pointer to `.ai_shared/execution/` for validation scripts
- Firebase architecture summary (3 services, key collections, RTDB nodes)
- Security model summary (isAdmin(), known gaps)
- Project structure overview (updated to reflect migration)
- Key data patterns (BigInt XP, save system, combat reconnection)

### .gemini/ structure

```
.gemini/
└── settings.json    # Gemini-specific configuration
```

The scratch script `find-dupes.ps1` moves to `.ai_shared/execution/`.

---

## Phase 5: UPDATE references

### CLAUDE.md

Update the Multi-Agent System section:
```diff
- ### Antigravity Agents (`.agents/`) — DOE Architecture
- | Orchestration | `INSTRUCTIONS.md` | Command routing, DOE algorithm, ACR role system |
- | Directives | `directives/` | 9 natural language SOPs |
- | Execution | `execution/` | 5 PowerShell scripts |
- | Protocols | `protocols/` | Self-annealing, parallel review |
- | Rules | `rules/a-c-r.md` | ACR multi-agent system rules |
- | Skills | `skills/` | 13 skills (5 custom + 8 community) |
- | Environment | `env/` | Sensitive data isolation |
+ ### Shared AI Infrastructure (`.ai_shared/`) — DOE Architecture
+ | Orchestration | `INSTRUCTIONS.md` | Command routing, DOE algorithm, ACR role system |
+ | Directives | `directives/` | Natural-language SOPs (template-sync) |
+ | Execution | `execution/` | PowerShell validation/audit scripts |
+ | Context | `context/` | Shared design context |
```

Update the Project Structure section to add `scripts/` and `.ai_shared/`, remove `.agents/` and `.context/`.

Remove references to directories/files that no longer exist (protocols/, rules/a-c-r.md, skills/ under .agents, env/).

### .gitignore

```diff
- # DOE Environment (sensitive data)
- .agents/env/.env
+ # AI shared environment (sensitive data)
+ .ai_shared/env/.env
```

Add `scripts/` exclusion patterns if needed (none anticipated).

---

## Migration Summary

| Action | Count | Details |
|--------|-------|---------|
| DELETE | 16 files | 10 dead patches + 6 root clutter |
| MOVE to scripts/ | 7 files | 2 generators, 3 diagnostics, 2 tests |
| MOVE to .ai_shared/ | 7 files | 1 INSTRUCTIONS + 2 directives + 3 execution + 1 context |
| FIX imports | 2 files | test_logic.js, play.mjs |
| CREATE | 2 files | GEMINI.md, .gemini/settings.json |
| UPDATE | 4 files | CLAUDE.md, .gitignore, _index.md, template-sync.md |
| REMOVE dirs | 2 dirs | .agents/, .context/ |

**Total: 32 file operations across 5 phases.**

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Deleted patch was still needed | Low | All patches apply to specific code patterns; verify the target code already contains the patched version before deleting |
| CWD-relative scripts break from scripts/ | None | `fs.readFileSync('www/...')` resolves against CWD, not script location. Run from project root. |
| ESM import in test_logic.js breaks | Certain without fix | Path update from `./www/` to `../www/` is required |
| play.mjs __dirname path breaks | Certain without fix | Path update to include `..` for .playwright-profile/ |
| CLAUDE.md references stale after migration | Certain without fix | Phase 5 updates all references |
| PowerShell $PSScriptRoot changes | None | Both `.agents/execution/` and `.ai_shared/execution/` are 2 levels deep from root — `Split-Path -Parent` x2 resolves identically |
