## Problem Statement

Currently, the robust procedural generation logic and advanced map visualization features (Voronoi zones, H3 hexagonal grids, dynamic LOD, and detailed population stats) exist in a standalone demo file (`procedural-demo.html`). The actual admin tool for managing and viewing these world templates (`templates_map.html`) lacks these visual features and procedural controls, making it difficult for administrators to accurately preview, generate, and analyze world templates in the official admin interface.

## Solution

Migrate the complete map logic, visualization layers, and procedural generation controls from `procedural-demo.html` into `templates_map.html`. This involves extracting the map logic into a reusable, deep module to keep the HTML clean, injecting necessary dependencies, merging the procedural controls into the existing left sidebar, maintaining all existing right-panel UI elements (like layer toggles and snapshot details), and routing execution logs to the existing console panel in `templates_map.html`.

## User Stories

1. As an admin, I want the `templates_map.html` map to visually render Voronoi zones, boundaries, and procedurally generated objects exactly like the demo, so that I can accurately preview world templates.
2. As an admin, I want to see dynamic population stats (monster count, shop count, etc.) in the right panel update as I generate or view templates.
3. As an admin, I want the map's Level of Detail (LOD) and viewport object count to display on the map overlay, so I can understand the current rendering performance and data scale.
4. As an admin, I want to access the procedural generation controls (Seed, Monster Ratio, Shop Ratio, Castle Ratio, Citadel Ratio, Generate button, Random Seed button) directly within the left sidebar of `templates_map.html`, so I can generate new worlds without leaving the main tool.
5. As an admin, I want all existing right-panel features (Snapshot ID, City, Type, Challenge Level, Zone Distribution tabs) to remain visible and functional.
6. As an admin, I want to use the existing layer visibility checkboxes (Monsters, Shops, Vaults, Castles, Citadels, Territory Zones, Water, Land, Countries, Contour Vertices) in the right panel to instantly toggle the visibility of the newly migrated procedural map layers.
7. As an admin, I want to see detailed execution logs from the procedural generation engine outputted directly into the existing `console-panel` (OPERATION LOG) at the bottom left of `templates_map.html`, instead of a separate debug div.
8. As a developer, I want the raw map rendering and clustering logic extracted into a dedicated JavaScript module, so that `templates_map.html` remains maintainable and the logic can be easily tested or reused.
9. As a developer, I want the procedural map's custom CSS styles to be merged into the global `style.css`, so that I don't have large inline `<style>` blocks cluttering the HTML structure.
10. As a developer, I want the new map module to safely replace the existing map initialization in `templates_map.html` without causing Leaflet "map already initialized" errors.

## Implementation Decisions

- **Map Logic Extraction:** Create a new deep module `procedural-map-ui.js` that encapsulates Leaflet map initialization, MarkerCluster grouping, custom marker creation, and layer toggling. It will expose a clean API (e.g., `initProceduralMap()`, `updateLayers()`, `toggleVisibility()`) to decouple Leaflet internals from the HTML UI.
- **HTML Modification:** Completely replace the existing `L.map` initialization script inside `templates_map.html` with an import of `procedural-map-ui.js`.
- **Dependency Management:** Inject missing CDNs (`h3-js`, specific `leaflet.markercluster` versions, `turf.min.js`) into the `<head>` of `templates_map.html`.
- **Layout Integration (Controls):** Move the `.controls` div (inputs for Seed, Ratios, Generate buttons) from `procedural-demo.html` into the `<aside>` left sidebar of `templates_map.html`, likely positioning it prominently above or below the Saved Snapshots list.
- **Layout Integration (Stats):** Place the `.stats` and `.legend` overlays (showing LOD, zoom, timing, and object counts) as absolute positioned elements inside the main `#map` container.
- **UI Wiring (Checkboxes):** Map the `onchange` events of the existing right-panel checkboxes (`toggle-monsters`, `toggle-shops`, etc.) to the new visibility toggle methods exposed by `procedural-map-ui.js`. No checkboxes will be deleted.
- **Log Routing:** Overwrite or intercept the `log()` function used by the procedural engine so that its output is appended to the `#console-log` div inside the existing `#console-panel` in `templates_map.html`.
- **CSS Migration:** Extract the ~200 lines of custom map CSS (e.g., `.citadel-marker`, tooltip styles) from `procedural-demo.html` and append them to `www/css/style.css`.

## Testing Decisions

- **Testing Philosophy:** Tests should verify external behavior (does toggling a layer make it invisible?) rather than implementation details (is Leaflet's internal layer array modified?).
- **Modules Tested:** The new `procedural-map-ui.js` module.
- **Testing Approach:** Due to the heavy reliance on Leaflet and DOM interactions, automated testing will be conducted via Playwright scripts (as per project rules). A Playwright test will load the updated `templates_map.html`, click the generation controls, verify the map populates, toggle a visibility checkbox in the right panel, and assert that the corresponding markers disappear from the map DOM. It will also verify that logs appear in the OPERATION LOG panel.
- **Prior Art:** Existing Playwright diagnostic scripts in `scripts/diagnostics/` will serve as the template for UI verification.

## Out of Scope

- Modifying the core generation algorithms inside `procedural-engine-v2.js` or `admin-citadel-generator.js`.
- Changing how data is saved to or loaded from Firestore (the actual "Saved Snapshots" list fetching remains as is).
- Refactoring `firebase-service.js`.
- Mobile responsive layout adjustments beyond what currently exists in `templates_map.html`.

## Further Notes

- Careful attention must be paid to ensure the `toggleRightPanel()` and other existing inline JS functions in `templates_map.html` are not inadvertently broken when merging the new scripts.
- The project rule strictly forbids stray files in the root directory; all new scripts must go into `www/map/` or `www/maintenance/`.
