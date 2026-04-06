# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

- **Install dependencies:** `npm install`
- **Start local server:** `npx firebase serve --only hosting --port 5000` → http://localhost:5000
- **Deploy to production:** `npx firebase deploy --only hosting`
- **Sync Capacitor (Android):** `npx cap sync android`
- **Open in Android Studio:** `npx cap open android`
- **Build Android APK (debug):** `npm run android:build`
- **Build Android AAB (release):** `npm run android:release`
- No build step — there is no bundler. JS files are served directly as ES6 modules.
- No test framework is configured. Manual testing via browser console (see DEV-QUICK-REFERENCE.md).

## High-Level Architecture

FightCraft is a geolocation RPG (HTML5/JS/TailwindCSS) wrapped in Capacitor for Android, using Firebase as its backend.

### Module Loading & Entry Points

- `www/index.html` loads external libs as global scripts (Leaflet, Turf.js, TailwindCSS CDN), then:
  1. `www/js/ui-loader.js` (regular script) — dynamically injects `character-selection-ui.html` into the DOM before modules run.
  2. `www/js/app.js` (ES6 module, `type="module"`) — main entry point. Orchestrates the init sequence: Firebase auth → character selection → GPS → map → monsters → world sync.
- `www/js/bridge.js` — central re-export file that imports functions from all modules and attaches them to `window.*` for use in inline `onclick` handlers throughout the HTML.

### Firebase Architecture (three services, two rule files)

- **Firestore** (`firestore.rules`) — persistent storage: user profiles, characters, game templates, city zones, spawned objects. Characters stored at `users/{uid}/characters/{charId}`.
- **Realtime Database** (`database.rules.json`) — live/ephemeral state: player positions on the map, PvP battle requests and battle state. Player presence uses `onDisconnect` for auto-cleanup.
- **Storage** (`storage.rules`) — static bundles for the SyncEngine optimization.
- Firebase SDK is loaded via ESM CDN imports in `firebase-service.js` (not from `index.html`).

### Key Module Responsibilities

| Module | Role |
|--------|------|
| `app.js` | Init sequence, GPS acquisition, world sync loop |
| `firebase-service.js` | All Firebase CRUD, auth, RTDB subscriptions, admin helpers |
| `gameState.js` | In-memory game state singleton (`gameState` object), stat recalculation |
| `ui-controller.js` | Panel/modal management, HUD updates, notification system, online player list |
| `map.js` | Leaflet map init, player/monster/POI markers, debug joystick movement |
| `combat.js` | PvE zone-based combat (head/body/belt/legs attack/defense system) |
| `pvp.js` | PvP via RTDB — battle requests, real-time fight sync, leaderboards |
| `sync-engine.js` | IndexedDB caching layer to minimize Firestore reads (Static Bundles strategy) |
| `data.js` | Static item/monster databases |
| `bridge.js` | Window-global function registry for inline HTML handlers |
| `kingdom.js` | District/citadel capture system |
| `districts.js` | Geographic district definitions and lookup |
| `poi.js` | Points of Interest — fetches real-world POIs via Overpass API |
| `logger.js` | Intercepts `console.*` calls and mirrors them to an on-screen debug console |
| `character-selection.js` | Multi-character management (create/select/delete per Firebase user) |
| `firebase-monitor.js` | Wraps Firestore reads to count/track API usage |

### Global Function Pattern

Functions needed by inline `onclick` handlers must be attached to `window`. This is done in two places:
- `bridge.js` — the main registry (UI, combat, map, game functions)
- Individual modules (e.g., `combat.js`, `pvp.js`, `app.js`) also attach some globals directly

Use `window.__checkGlobalFunctions()` in the browser console to audit which globals are registered.

### Styling & Z-Index Layers

TailwindCSS is loaded from CDN (not compiled). Custom styles are in `www/css/style.css`. Z-index layering:
- `z-[1000]` HUD → `z-[2000]` Panels → `z-[3000]` Item Modal → `z-[4000]` Combat → `z-[5000]` Victory/Defeat → `z-[99999]` Loading Screen

### Data Flow: XP Uses BigInt

`gameState.player.xp` and `gameState.player.xpToNext` are stored as `BigInt`. Firestore serializes them as strings; `app.js` reconverts on load. Any code touching XP values must use BigInt arithmetic.

### Admin & Utility Scripts

`www/` contains several standalone utility scripts (not part of the main app): `backup-firestore.js`, `restore-firestore.js`, `deep-nuke.js`, `global-cleanup.js`, etc. These are one-off maintenance tools.

## Development Context

- **Language:** Code comments and UI text are primarily in Ukrainian. README and docs are also in Ukrainian.
- **No linter/formatter** is configured.
- **Live URL:** https://fight-craft-3c3f0.web.app
- **Firebase project ID:** `fight-craft-3c3f0`
- **Default fallback coordinates:** Berlin (52.484512, 13.449876) when GPS is unavailable.
- **Hot reload:** Just hard-refresh the browser (Ctrl+F5). No HMR.
