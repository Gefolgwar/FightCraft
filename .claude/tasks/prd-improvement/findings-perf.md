# Performance Findings & PRD Update Proposals

## 1. SyncEngine & Caching State
**Current Implementation:** The `SyncEngine` (`www/gameplay/sync-engine.js`) correctly implements the "Meta-Check" pattern, reducing startup Firestore reads from 2600+ to ~1. It checks `world_metadata/current_state` and only downloads a delta or bundle if the cache is stale.
**PRD Alignment:** The PRD accurately reflects the ~15 read startup target, but it lacks details on the specific storage pattern (using Firebase Storage bundles as a priority before falling back to full Firestore reads).
**Proposal:** Update the PRD to clarify that SyncEngine uses Firebase Storage bundles for bulk loads to bypass Firestore query costs.

## 2. Missing Lighthouse Targets & Metrics
**Current Implementation:** The `.claude/rules/lighthouse-profiling.md` defines specific Lighthouse targets for the Capacitor WebView (Performance Score ≥ 60, FCP < 2.5s, LCP < 4s, TBT < 300ms, CLS < 0.1).
**PRD Alignment:** The PRD completely omits Lighthouse metrics, web vitals, or mobile rendering targets.
**Proposal:** Add a "Performance Targets (Lighthouse)" subsection under the "Performance & Optimization" section in the PRD with the specific mobile/Capacitor goals.

## 3. Known Bottlenecks & Network Payloads
**Current Implementation:** We load TailwindCSS (~300KB unused), Firebase SDK ESM imports (~400KB), and unminified application code (`firebase-service.js` is ~101KB) over CDN. Because of the "No Bundler" architectural decision, these payload sizes are an accepted tradeoff.
**PRD Alignment:** The PRD mentions "No bundler", but does not explicitly document the specific payload bottlenecks or execution time impacts that result from this.
**Proposal:** Add a "Known Bottlenecks" subsection in the PRD, explicitly acknowledging the large unused CSS (Tailwind CDN) and Firebase SDK ESM payload as accepted tech debt due to the bundler-free architecture.

## 4. Path & File Size Inaccuracies
**Current Implementation:** A recent refactor migrated JS files into domain modules (`core/`, `auth-ui/`, `gameplay/`, `map/`, `firebase/`). The main HTML is now `www/core/index.html`. 
**PRD Alignment:** The "Performance Profile" and "Module Loading & Entry Points" sections in the PRD still reference flat paths like `www/index.html`, `www/js/app.js`, and `www/js/ui-loader.js`. 
**Proposal:** Update the PRD file paths to reflect the new modular monolith structure and verify exact file sizes/lines (e.g., `firebase-service.js` is now ~101KB / 2800 lines in the `firebase/` directory).

## Proposed PRD Additions (Draft)

**Under "Performance Profile":**
- **Lighthouse Targets:** Mobile Performance Score ≥ 60, FCP < 2.5s, LCP < 4s, TBT < 300ms.
- **Accepted Bottlenecks:** ~300KB unused Tailwind CSS and ~400KB Firebase SDK ESM imports. These large payloads and JavaScript execution times are accepted trade-offs to maintain the bundler-free architecture.
- **Caching Mechanism:** SyncEngine prefers downloading pre-generated JSON bundles from Firebase Storage before falling back to Firestore queries, saving significant read costs.

**Under "Module Loading":**
- Update references to `www/core/index.html`, `www/core/app.js`, and `www/auth-ui/ui-controller.js`.
