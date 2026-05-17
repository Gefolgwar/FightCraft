## [Unreleased] - Seed + Overrides Architecture & Admin UI Fixes (Issue #11)
### Added
- **Seed + Overrides Architecture**: Hybrid world generation merging procedural Base World (Seed) with Database Overrides (Manual placements) via `world-merge.js`.
- **Entity Control Centers**: Refactored admin pages (`gameplay_monsters.html`, `gameplay_shops.html`, `gameplay_castles.html`, `gameplay_vaults.html`) into unified control centers featuring 4 tabs: Snapshot Gen, Procedural Rules, Manual Placement, and Statistics.
- **Viewport Stats**: Restored the real-time Viewport Stats block to the `templates_map.html` left sidebar to monitor active object counts and dynamic LOD seamlessly.
- **Snapshot Metadata**: Introduced `snapshot-stats.js` to efficiently pre-calculate entity statistics and embed them as lightweight metadata in Firestore snapshot documents.

### Fixed
- Wired Seed+Overrides engine correctly into the client boot sequence in `app.js`.
- Snapshot saving logic updated in `firebase-service.js` to use `computeSnapshotStats` and bypass 1MB document limits.
- Resolved module import errors in the `vitest` testing suite, successfully passing all 17 test cases for `world-merge` and `snapshot-stats`.

