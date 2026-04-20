# Architectural Drift Findings & PRD Update Proposals

After reviewing the current project structure against `docs/PRD.md`, several areas of architectural drift have been identified. The PRD needs to be updated to reflect recent refactoring and feature additions.

## 1. Module Loading & Entry Points
**Current PRD State:**
References `www/index.html` as the main loader, and files like `www/js/ui-loader.js`, `www/js/app.js`, and `www/js/bridge.js`.
**Actual State:**
The frontend has been fully migrated into a modular monolith with 7 domain folders. 
- `www/index.html` now acts only as a redirect to `www/core/index.html`.
- `www/core/index.html` is the true entry point, loading external libraries.
- The correct script paths are now `www/auth-ui/ui-loader.js`, `www/core/app.js`, and `www/core/bridge.js`.
**Proposed PRD Update:**
Update the "Module Loading & Entry Points" section to reflect the `core/index.html` redirect and the new domain-specific paths (`auth-ui/`, `core/`).

## 2. Key Modules Inventory
**Current PRD State:**
The "Key Modules" table only lists 10 modules (e.g., `gameState.js`, `combat.js`, `firebase-service.js`, `map.js`) and misses the broader directory structure.
**Actual State:**
Several crucial modules from the recent refactor are missing from the documentation:
- **`auth-ui/ui-controller.js`**: Manages panels, modals, HUD, and the online players list.
- **`auth-ui/character-selection.js`**: Handles multi-character management logic.
- **`map/kingdom.js`**: Handles the district/citadel capture system.
- **`gameplay/monsters.js`**: Extracts monster-specific logic.
- **`firebase/firebase-monitor.js`**: Wraps Firestore reads to track API usage.
- **`core/logger.js`**: Intercepts `console.*` calls for the on-screen debug console.
**Proposed PRD Update:**
Expand the "Key Modules" table to include these missing modules and their responsibilities to accurately reflect the 7 domain folders (`core/`, `auth-ui/`, `gameplay/`, `firebase/`, `map/`, `maintenance/`, `assets/`, `css/`).

## 3. Firebase Rules Location
**Current PRD State:**
Implies the Firebase security rules (`firestore.rules`, `database.rules.json`, `storage.rules`) are located in the project root.
**Actual State:**
These rule files have been moved to a dedicated `/firebase/` folder at the project root, and `firebase.json` has been updated to point to these new paths.
**Proposed PRD Update:**
Update the "Firebase Architecture" section to specify that rule files reside in the `/firebase/` directory (e.g., `firebase/firestore.rules`).

## 4. Admin & Utility Scripts
**Current PRD State:**
States that utility scripts (`backup-firestore.js`, `deep-nuke.js`, `global-cleanup.js`) are located in `www/`.
**Actual State:**
All admin HTML files and utility scripts have been neatly moved into `www/maintenance/`.
**Proposed PRD Update:**
Update the "Admin & Utility Scripts" section to point to `www/maintenance/` instead of `www/`.

## 5. Recent Feature Additions (PvP & Arenas)
**Current PRD State:**
Lists "PvP Logic" under "Known Technical Debt" noting that the logic needs a fix.
**Actual State:**
Recent commits (`7529ed7 teams and fights fix. Arena add`, `cb51fcc Grupe fight`) indicate that Arenas and Team/Group fights have been implemented or significantly updated.
**Proposed PRD Update:**
Review the current PvP and Arena implementation. The PRD should formally document "Arenas" as a feature (currently only mentioned in passing as an RTDB node). The "Known Technical Debt" section for PvP should be updated or removed if the recent commits resolved the underlying issues.
