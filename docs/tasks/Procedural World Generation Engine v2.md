# PRD: Procedural World Generation Engine v2

**Status:** Draft
**Created:** 2026-05-12
**Author:** AI-assisted design session

---

## Problem Statement

FightCraft's world generation system stores millions of individual game objects (monsters, shops, castles, citadels, vaults) as Firestore documents or as massive JSON arrays inside snapshot documents. This approach has fundamental scaling problems:

1. **Storage explosion.** With ~4,400 cities and 8 billion total population, the density formulas produce ~8 million monsters, ~1.6 million castles, ~500K shops, ~230K vaults, and ~42K citadels. Storing these as individual Firestore documents is cost-prohibitive; storing them as JSON arrays inside snapshots hits the 1MB document limit.

2. **Sync bottleneck.** Every player must download the entire object list for their region. The current SyncEngine + IndexedDB caching mitigates this but adds complexity and still requires expensive initial downloads.

3. **Admin workflow friction.** The admin creates monster templates, generates objects, saves them into a snapshot, and activates it. Each "Generate" pass produces megabytes of data that must be stored, previewed, and synced. Simple recipe changes (e.g. adjusting monster weights) require full regeneration and re-upload.

4. **Zone generation fragility.** The current Voronoi-based zone system depends on citadel positions and produces irregular polygons that are expensive to compute, store, and query. H3 hexagonal grid is already partially implemented (h3-spatial.js, procedural-engine.js) but not integrated into the admin workflow.

## Solution

Replace the "store every object" model with a **recipe-based procedural generation** system where:

- A **snapshot becomes a recipe** (~1KB JSON config) containing a seed, density ratios, template weights, and H3 resolution -- never a list of objects.
- Every client (admin preview or player game) **generates identical objects locally** from the recipe using deterministic PRNG seeded by H3 cell index.
- The admin UI on all existing pages (templates_map.html, gameplay_monsters.html, gameplay_shops.html, gameplay_vaults.html, gameplay_castle.html) remains visually unchanged. Only the backend logic changes.
- Layers are applied sequentially -- citadels first, then zones, then monsters/shops/vaults/castles -- matching the current admin mental model.
- Only **mutable state** (defeated monsters, captured castles, shop inventories) is stored in Firestore, not the base world.

## User Stories

### Admin: Template Management

1. As an admin, I want to create and edit monster templates on gameplay_monsters.html with custom stats, drops, icons, and weights, so that I can define the building blocks of the game world.
2. As an admin, I want to create and edit shop templates on gameplay_shops.html, so that I can define what shops appear in the world.
3. As an admin, I want to create and edit vault templates on gameplay_vaults.html, so that I can define vault encounters.
4. As an admin, I want to create and edit castle templates on gameplay_castle.html, so that I can define capturable fortifications.
5. As an admin, I want template changes to NOT require full world regeneration, so that I can iterate on game balance quickly.

### Admin: Recipe/Snapshot Management

6. As an admin, I want to create a new snapshot recipe on templates_map.html by specifying a seed and density ratios, so that I control global world density.
7. As an admin, I want to select which monster templates and their weights are included in a recipe, so that I control the monster distribution across the world.
8. As an admin, I want each recipe to be a small config (~1KB), so that I can create, duplicate, and compare multiple recipes without storage concerns.
9. As an admin, I want to set a recipe status to "draft", "preview", or "active", so that I can stage changes before they go live.
10. As an admin, I want only ONE active recipe at a time, so that all players see the same world.

### Admin: Layered Generation

11. As an admin, I want to generate citadels first (population / 190,476 per city), so that they form the anchor points for territorial control.
12. As an admin, I want zones to be H3 hexagonal cells (not Voronoi), so that zone boundaries are mathematically consistent and don't require polygon storage.
13. As an admin, I want to generate monsters into zones (population / 1,000 per city), distributed by template weight, so that monster density reflects real-world population.
14. As an admin, I want to generate shops into zones (population / 16,000 per city), so that commercial activity scales with population.
15. As an admin, I want to generate vaults into zones (population / 34,783 per city), so that rare encounters are appropriately sparse.
16. As an admin, I want to generate castles into zones (population / 5,000 per city), so that territorial objectives are plentiful but not overwhelming.
17. As an admin, I want each layer to build on top of previous layers in the same recipe, so that I can incrementally construct the world.

### Admin: Preview

18. As an admin, I want to see generated objects on the map in templates_map.html before activating, so that I can verify placement visually.
19. As an admin, I want the preview to render objects only for the current map viewport, so that preview is instant regardless of world size.
20. As an admin, I want to click a previewed monster and see its stats, so that I can verify template application.
21. As an admin, I want to start a test fight with a previewed monster, so that I can verify combat balance.
22. As an admin, I want to pan/zoom the map and see new objects generate in real-time, so that I can inspect any region.

### Admin: Activation and Rollback

23. As an admin, I want to activate a recipe with one click, so that all players immediately see the new world.
24. As an admin, I want to deactivate a recipe and revert to a previous one, so that I can roll back broken configs.
25. As an admin, I want activation to be instant (no batch writes), so that world updates don't take minutes.

### Admin: Fresh Browser

26. As an admin, I want to open any admin page from a fresh browser and have the active recipe loaded from Firebase automatically, so that I don't need local state to work.
27. As an admin, I want the recipe to be cached locally (IndexedDB) after first load, so that subsequent visits are instant.

### Player: World Experience

28. As a player, I want to see monsters, shops, castles, citadels, and vaults on the map around my location, so that I can explore and interact with the game world.
29. As a player, I want every other player to see the exact same objects at the same locations, so that the world is shared and consistent.
30. As a player, I want objects to appear instantly when I open the app, so that I don't wait for a large download.
31. As a player, I want killed monsters to stay dead for their respawn duration, so that combat has consequences.
32. As a player, I want monsters to respawn after their cooldown, so that the world replenishes.
33. As a player, I want to see more objects in densely populated cities and fewer in small towns, so that the world feels alive and proportional.
34. As a player, I want the game to work offline for objects I've already seen, so that GPS dead zones don't break my session.

### System: Performance

35. As the system, I want initial load to require exactly 1 Firestore read (the active recipe), so that startup cost is minimal.
36. As the system, I want 0 Firestore reads for world object rendering (all procedural), so that ongoing costs are near-zero.
37. As the system, I want only mutable state (defeats, captures) to require Firestore writes, so that the write volume is proportional to player actions, not world size.
38. As the system, I want the world_cities data to load as a static JSON file, so that it can be cached by the browser and CDN.

## Implementation Decisions

### Module Architecture

**Module 1: Snapshot Recipe Schema and CRUD** (new module)
- Defines the recipe JSON schema (seed, density ratios, template weights per layer, H3 resolution, status).
- Provides createRecipe(), loadActiveRecipe(), activateRecipe(), deactivateRecipe().
- Reads/writes a single Firestore document per recipe in the world_snapshots collection (reuses existing collection, new schema).

**Module 2: Procedural Engine V2** (extends existing procedural-engine.js)
- Currently generates only monsters for H3 cells with hardcoded biome logic.
- Extended to accept a recipe config and generate ALL object types (citadels, monsters, shops, vaults, castles).
- Key functions: generateCitadelsForCity(city, recipe), generateObjectsForCell(h3Index, recipe, objectType), getObjectsForViewport(h3Cells, recipe, defeatedIds), getObjectById(objectId).
- All generation is pure-functional and deterministic: same inputs produce same outputs.
- Population-aware density: each city's objects = city.population / ratio, distributed across the city's H3 cells.

**Module 3: World Cities Data** (convert existing)
- Convert world_cities.js (35K-line ES module, ~4,400 cities) to world_cities.json (static data file).
- Loaded via fetch() and cached in memory.
- All existing importers updated to use the JSON source.

**Module 4: Admin Page Adapters** (modify existing admin modules)
- admin-monsters.js: "Generate" button saves template weights to recipe.layers.monsters instead of generating object arrays. Calls procedural engine for map preview.
- admin-shops.js, admin-vaults.js, admin-castles.js: analogous changes.
- templates_map.html JS: "Generate Global" creates a recipe. "Activate" sets recipe.status = "active". Map preview uses procedural engine for viewport.
- No UI changes -- same buttons, same inputs, same visual output.

**Module 5: Defeated State Manager** (new module)
- Tracks mutable state: defeated monsters, captured castles, purchased shop items.
- Firestore collection defeated_objects/{objectId} with defeatedBy, defeatedAt, respawnAt.
- Client loads defeated IDs for visible H3 cells and filters them from procedural output.
- Respawn: Date.now() > respawnAt means object reappears (no Firestore delete needed, cleanup is async).

**Module 6: Player Client Integration** (modify existing)
- app.js init sequence: replace fetchSpawnedObjectsOnce() + loadStaticMonsters() with loadActiveRecipe() (1 read).
- map.js: replace subscribeToSpawnedObjects() with viewport-based procedural generation on map move.
- Monster click: getObjectById(id) regenerates full object from ID (no DB lookup needed).

### Key Architectural Decisions

- **Deterministic IDs:** Every object's ID encodes its origin: proc_{type}_{h3Index}_{localIndex}. This enables regeneration from ID alone (critical for combat reconnection).
- **H3 resolution split:** Res 5 (~252 sq km) for citadel macro-zones; Res 9 (~0.1 sq km) for entity placement. This matches the existing H3_RES_CITADEL and H3_RES_ENTITY constants.
- **Population distribution per cell:** A city's population is spread across its H3 cells proportionally. Cells closer to city center may get slightly higher density (configurable in recipe).
- **Voronoi removal:** Zone boundaries are no longer computed or stored. The H3 grid IS the zone system. Each H3 cell belongs to the nearest city by geodesic distance.
- **Recipe versioning:** Each recipe has a version field. Changing a recipe creates a new version. Players always use the active version.
- **Backward compatibility:** The spawned_objects Firestore collection continues to work during migration. A feature flag useProceduralEngine in the recipe controls whether clients use old or new system.
- **No Voronoi, no Turf.js dependency for zones:** H3 cells are computed via h3-js library (already loaded via CDN). Turf.js remains only for existing non-zone geometry operations.

### Snapshot Recipe Schema

```json
{
  "id": "recipe_1715500000",
  "version": 1,
  "status": "draft | preview | active",
  "seed": 42,
  "h3Resolution": 9,
  "densityRatios": {
    "monster": 1000,
    "shop": 16000,
    "vault": 34783,
    "castle": 5000,
    "citadel": 190476
  },
  "layers": {
    "monsters": {
      "templates": [
        { "templateId": "goblin_warrior", "weight": 30 },
        { "templateId": "skeleton_archer", "weight": 20 },
        { "templateId": "dragon_boss", "weight": 1 }
      ]
    },
    "shops": { "templates": [] },
    "vaults": { "templates": [] },
    "castles": { "templates": [] }
  },
  "createdAt": "2026-05-12T...",
  "createdBy": "admin_uid"
}
```

### Data Flow

```
Admin creates recipe (1 Firestore write, ~1KB)
  |
Admin previews on map (0 reads -- procedural engine runs locally)
  |
Admin activates recipe (1 Firestore update)
  |
Player loads app --> loadActiveRecipe() (1 Firestore read)
  |
Player moves --> getObjectsForViewport() (0 reads -- all local)
  |
Player defeats monster --> save defeatedAt (1 Firestore write per kill)
```

### Layer Generation Flow

```
SNAPSHOT RECIPE (Firestore: 1 document)
  |
  +-- Layer 1: Citadels   (population / 190476)
  |     +-- position = H3 cell center, deterministic from seed
  +-- Layer 2: Zones      (H3 hexagons covering city radius)
  +-- Layer 3: Monsters   (population / 1000, weighted by templates)
  +-- Layer 4: Shops      (population / 16000)
  +-- Layer 5: Vaults     (population / 34783)
  +-- Layer 6: Castles    (population / 5000)
```

### Migration Strategy

1. New system runs in parallel with old (spawned_objects).
2. Recipe activation sets useProceduralEngine: true in Firestore world_metadata.
3. Clients check this flag and choose rendering path.
4. Once stable, spawned_objects collection is archived and deprecated.

### Implementation Phases

| # | Phase | Dependencies | Size |
|---|-------|-------------|------|
| 0 | world_cities.js to JSON | nothing | S |
| 1 | Recipe schema + CRUD | Phase 0 | M |
| 2 | Procedural Engine V2 | Phase 1 | L (key phase) |
| 3 | Admin adapters (under the hood) | Phase 2 | M |
| 4 | Preview system | Phase 2+3 | M |
| 5 | Player client integration | Phase 2 | M |
| 6 | Defeated state sync | Phase 5 | S |

## Testing Decisions

Good tests for this system verify **external behavior** (given inputs, expected outputs) without depending on internal implementation details like PRNG internals or H3 library specifics.

### Modules to test

**Procedural Engine V2 (HIGH priority -- pure functions, highly testable)**
- Given a recipe + H3 cell index, always produces the same objects (determinism test).
- Given two different seeds, produces different objects (uniqueness test).
- Given a city with population 4,000,000 and monster ratio 1:1000, produces exactly 4,000 monsters across all cells.
- Given a recipe with 2 templates at weights 70/30, distribution across 10,000 objects is approximately 70%/30% (within 5%).
- getObjectById("proc_monster_CELLID_3") returns the same object as generateObjectsForCell(CELLID)[3].

**Snapshot Recipe CRUD (MEDIUM priority)**
- Create recipe, read it back, same data.
- Activate recipe, loadActiveRecipe() returns it.
- Only one recipe can be active at a time.

**Defeated State Manager (MEDIUM priority)**
- Mark object as defeated, it is filtered from viewport results.
- After respawn time passes, object reappears in viewport results.

**Admin Adapters (LOW priority -- integration/E2E)**
- "Generate" on monster page updates recipe.layers.monsters.templates (not objects array).
- Map preview shows markers after generation.

### Prior art

- procedural-engine.js already has the pattern: pure functions that take seed + config and return arrays. Same pattern extends.
- battle-logic.js is the project's best example of testable pure-function module -- damage calc, hit/miss, crit rolls.
- No formal test framework exists (manual console testing per CLAUDE.md), but the pure functions can be tested via browser console or a future test runner.

## Out of Scope

1. **Server-authoritative combat validation** -- combat remains client-side (existing technical debt, unchanged).
2. **Overture Maps / OSM integration for biomes** -- the deepResearch recommendation for Overture data is noted but deferred. The procedural engine uses seed-based biomes for now, with a hook for future real-world data enrichment.
3. **Cloud Functions for world management** -- all generation remains client-side. No server-side compute introduced.
4. **Admin page UI redesign** -- all existing buttons, forms, inputs, and layouts remain unchanged.
5. **PvP, Groups, Kingdom systems** -- these systems interact with objects via existing interfaces and are not modified.
6. **Capacitor / Android build changes** -- no native layer changes.
7. **TailwindCSS optimization** -- unchanged (existing tech debt).
8. **Multi-recipe blending** -- only one active recipe at a time. No support for overlaying multiple recipes.

## Further Notes

### Scale Estimates

| Metric | Old System | New System |
|--------|-----------|------------|
| Firestore docs for world | ~8M+ | 1 (recipe) |
| Initial player load | ~15 reads + IndexedDB | 1 read (~1KB) |
| Storage per recipe | 1-50 MB (objects) | ~1 KB (config) |
| Time to activate new world | Minutes (batch writes) | Instant (1 doc update) |
| Time to preview | Seconds-minutes (generate + save) | Instant (local PRNG) |

### world_cities.js Statistics

- ~4,440 cities
- 35,538 lines
- Fields: id, name, lat, lng, population, country
- Converting to JSON eliminates the ES module wrapper and enables standard fetch() + browser caching.

### H3 Resolution Reference

| Resolution | Edge Length | Cell Area | Use Case |
|-----------|------------|-----------|----------|
| 4 | ~22 km | ~1,770 sq km | Citadel territory chunks |
| 5 | ~8 km | ~253 sq km | City macro-zones |
| 6 | ~3.2 km | ~36 sq km | Discovery triggers, clustering |
| 8 | ~460 m | ~0.74 sq km | Entity spawn cells (monsters) |
| 9 | ~174 m | ~0.11 sq km | Fine-grained entity placement |

### Density Ratio Table

| Object Type | Population per Object | Berlin (4M) | Tokyo (14M) | Village (5K) |
|------------|----------------------|-------------|-------------|--------------|
| Monsters | 1,000 | 4,000 | 14,000 | 5 |
| Castles | 5,000 | 800 | 2,800 | 1 |
| Shops | 16,000 | 250 | 875 | 0-1 |
| Vaults | 34,783 | 115 | 402 | 0 |
| Citadels | 190,476 | 21 | 73 | 0 |
