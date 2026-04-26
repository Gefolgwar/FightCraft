# FightCraft — Directive Index

> All operational directives for the DOE (Directive → Orchestration → Execution) system.

## Active Directives

| # | Directive | SOP File | Status |
|---|-----------|----------|--------|
| 1 | **Template-Sync** | [template-sync.md](template-sync.md) | ✅ Active |

---

## Directive: Template-Sync

**Purpose:** Defines the zero-refresh protocol for world generation, template activation, and real-time DOM sync.

**Trigger:** Admin clicks "🌍 Generate Full World" or toggles a snapshot Active/Inactive.

**Data Flow:**
```
Admin UI → generateGlobalWorld() → Firestore (world_snapshots)
                                         ↓ onSnapshot listener
                                   Admin DOM auto-updates sidebar
                                         ↓ toggle Active
                                   applyWorldSnapshot() → spawned_objects
                                         ↓ world_metadata timestamp
                                   Game client SyncEngine delta-sync
```

**Entry Points:**
| Surface | Location | Mechanism |
|---------|----------|-----------|
| Admin Dashboard | `www/maintenance/admin.html` | `window.generateGlobalWorld()` via `admin-world.js` |
| Templates Map | `www/map/templates_map.html` | `window.generateGlobalWorld()` + real-time listener + toggle UI |

**Constraints:**
- No `window.location.reload()` — all updates via Firestore `onSnapshot` listeners
- No IndexedDB cache wipe on toggle — SyncEngine delta-sync handles consistency
- No redundant `loadSnapshots()` inside toggle handlers — `onSnapshot` callback handles re-render
- API keys sourced from `.agents/env/` — never hardcoded in JS modules
- All write operations gated by `isAdmin()` in Firestore security rules
- Listener cleanup on `beforeunload` via `_snapshotUnsubscribe()`

**ACR Roles:**
- **Architect:** Plans listener topology and cache invalidation strategy
- **Coder:** Implements `subscribeToWorldSnapshots()` and wires into DOM
- **Reviewer:** Audits toggle logic for unnecessary re-renders and cache wipes

---

## Execution Scripts

| # | Script | Purpose | Run Command |
|---|--------|---------|-------------|
| 1 | `validate-template-sync.ps1` | Validates Firebase security rules protect Template-Sync collections | `pwsh .agents/execution/validate-template-sync.ps1` |
| 2 | `audit-template-dataflow.ps1` | Verifies end-to-end data flow: generation → save → listener → toggle → apply | `pwsh .agents/execution/audit-template-dataflow.ps1` |
| 3 | `audit-toggle-rerender.ps1` | Detects anti-patterns: double re-renders, unnecessary cache wipes, missing cleanup | `pwsh .agents/execution/audit-toggle-rerender.ps1` |

### Execution Checklist

Run all three scripts from the project root before deploying Template-Sync changes:

```
pwsh .agents/execution/validate-template-sync.ps1
pwsh .agents/execution/audit-template-dataflow.ps1
pwsh .agents/execution/audit-toggle-rerender.ps1
```

All checks should return `[PASS]`. `[WARN]` items are informational. `[FAIL]` items must be resolved before deploy.

---

## Protocol History

| Date | Change | ACR Phase |
|------|--------|-----------|
| Initial | Directive created, `subscribeToWorldSnapshots()` wired in `templates_map.html` | Architect + Coder |
| Initial | `validate-template-sync.ps1` created | Coder |
| Update | Fixed double-render bug: removed redundant `loadSnapshots()` from toggle handlers | Reviewer → Coder |
| Update | Added `beforeunload` cleanup for `_snapshotUnsubscribe` | Reviewer → Coder |
| Update | Created `audit-template-dataflow.ps1` and `audit-toggle-rerender.ps1` | Coder |