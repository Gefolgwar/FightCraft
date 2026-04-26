# Refactor Plan: Static Cities → Procedural Global World

**Status:** Draft  
**Author:** AI Assistant  
**Created:** 2025-07-13  
**Scope:** Territory, Districts, Discovery, Canvas Rendering  
**Risk Level:** Medium — all changes additive until final deprecation step  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture (Before)](#2-current-architecture-before)
3. [Target Architecture (After)](#3-target-architecture-after)
4. [File-by-File Migration Plan](#4-file-by-file-migration-plan)
5. [Preservation Rules](#5-preservation-rules)
6. [Migration Sequence](#6-migration-sequence)
7. [Risk Mitigation](#7-risk-mitigation)
8. [Test Strategy (TDD)](#8-test-strategy-tdd)

---

## 1. Executive Summary

FightCraft's world is currently anchored to **6 hardcoded cities** defined in `CITY_ANCHORS` (`www/gameplay/data.js`). Territory ownership, district rendering, monster generation, and admin tooling all route through this static list. This creates a hard ceiling: the game cannot operate outside these 6 metropolitan areas.

This plan migrates FightCraft from **static `CITY_ANCHORS`** to a **dynamic H3-based Discovery system** with **global Weighted Voronoi territory math**. After migration:

- **Any coordinate on Earth** resolves to a territory owner via Power Diagram math.
- **New areas self-populate** — walking into an undiscovered H3 Res 6 cell triggers OSM discovery and auto-creates castles as Firestore documents.
- **Territory borders render globally** via a dedicated Canvas overlay with faction-colored Voronoi cells.
- **Districts are computed mathematically** from citadel positions — no pre-generated polygons required.
- **`CITY_ANCHORS` becomes a legacy convenience** — retained for admin tooling backward compat, but stripped from all runtime territory logic.

### Key Deliverables

| # | Deliverable | Type | Dependency |
|---|-------------|------|------------|
| 1 | `territory-math.js` | New module | None (pure math) |
| 2 | `discovery-service.js` | New module | h3-spatial, overpass-service |
| 3 | `territory-canvas.js` | New module | territory-math, canvas-renderer |
| 4 | `territory-service.js` refactor | Refactor | territory-math |
| 5 | `districts.js` refactor | Refactor | territory-math |
| 6 | `map.js` integration | Integration | All above |
| 7 | `CITY_ANCHORS` deprecation | Cleanup | All above verified |

---

## 2. Current Architecture (Before)

### 2.1 City Resolution

Players are assigned to a city via `getPlayerCity()` in `www/map/map.js` (L896–916):

```js
export function getPlayerCity() {
  const pos = gameState.player.position;
  if (!pos) return null;
  let closestCity = null;
  let closestDist = Infinity;
  CITY_ANCHORS.forEach((city) => {
    const dist = getDistance(pos.lat, pos.lng, city.lat, city.lng);
    if (dist < closestDist) { closestDist = dist; closestCity = city; }
  });
  return closestCity;
}
```

This returns the nearest of 6 static entries:

```js
// www/gameplay/data.js L125-132
export const CITY_ANCHORS = [
    { id: 'berlin',  name: 'Berlin',  lat: 52.52,   lng: 13.405  },
    { id: 'kyiv',    name: 'Kyiv',    lat: 50.4501, lng: 30.5234 },
    { id: 'lviv',    name: 'Lviv',    lat: 49.8397, lng: 24.0297 },
    { id: 'warsaw',  name: 'Warsaw',  lat: 52.2297, lng: 21.0122 },
    { id: 'prague',  name: 'Prague',  lat: 50.0755, lng: 14.4378 },
    { id: 'vienna',  name: 'Vienna',  lat: 48.2082, lng: 16.3738 },
];
```

**Problem:** A player in Tokyo, São Paulo, or rural France is silently assigned to the "nearest" European city — sometimes 8,000+ km away. Territory, districts, and monster spawns all key off this nonsensical assignment.

### 2.2 Territory Ownership

`www/map/territory-service.js` implements weighted distance:

```
D_weighted = Distance(point, citadel) / citadel.powerMultiplier
```

- `getZoneOwner(lat, lng)` finds the citadel with the lowest `D_weighted` from a **local cache** (`_citadelCache`).
- The cache is hydrated per-city from Firestore `city_zones/{cityId}`.
- Territory is only computed **within the context of a single city** — citadels from Berlin never compete with citadels from Kyiv.

**Key functions already correct in principle:**
- `weightedDistance()` — pure math, globally valid ✓
- `getNearestCitadel()` — iterates citadel list, globally valid ✓
- `getCitadelColor()` — deterministic HSL from ID, globally valid ✓

**What's broken:**
- `_citadelCache` is populated per-city via `getTerritoryZones(cityId)` — only loads one city's citadels.
- `generateCityTerritory()` scopes citadels to a `cityId` and stores GeoJSON per-city in Firestore.
- Legacy GeoJSON stubs (`getCleanCityMask`, `generateSmartMapMask`) are dead code but imported.

### 2.3 District System

`www/map/districts.js` renders territory zones as Leaflet polygons:

- `fetchAndDrawDistricts()` loads GeoJSON from `getTerritoryZones(cityId)` — scoped to `gameState.currentCityId || 'berlin'`.
- `getDistrictByCoords(lat, lng)` uses `isPointInPolygon()` against pre-stored polygon vertices.
- Districts only exist where an admin has manually generated them via the admin panel.

**Problem:** Outside admin-generated zones, `getDistrictByCoords()` returns `null` — the player has no district, no king, no territory context.

### 2.4 H3 Grid System

`www/core/h3-spatial.js` already provides:

| Constant | Resolution | Edge Length | Purpose |
|----------|-----------|-------------|---------|
| `H3_RES_ENTITY` | 8 | ~461m | Monster spawn cells |
| `H3_RES_CITADEL` | 4 | ~22.6km | Territory chunks |
| `H3_RES_CLUSTER` | 6 | ~3.2km | Visual marker clustering |

Missing: A `H3_RES_DISCOVERY` constant for the discovery trigger resolution.

### 2.5 Overpass API

`www/map/overpass-service.js` is **fully implemented but disabled** at the call site. The `districts.js` fallback to `OverpassService.fetchDistricts()` is commented out (L155–175):

```js
// FALLBACK: Overpass API (DISABLED to prevent unwanted "torn" zones)
```

The service itself is functional:
- `fetchCityContext()` — boundary + districts from OSM
- `fetchRelationGeometry()` — raw GeoJSON from relation ID
- `findSafeCitadelLocation()` — snaps coords to nearest footway
- `stitchWaysToRings()` — robust polygon assembly from way segments

### 2.6 Canvas Layer

`www/map/canvas-renderer.js` exports `CanvasEntityLayer` (extends `L.Layer`) — currently used **only for procedural monsters** in `map.js`:

```js
canvasMonsterLayer = new CanvasEntityLayer({ onClick: handleCanvasMonsterClick });
canvasMonsterLayer.addTo(map);
```

The renderer supports arbitrary entities with emoji icons, click hit-testing, and inactive state. It can be extended or a sibling class created for territory rendering.

### 2.7 Dependency Graph (Before)

```
CITY_ANCHORS (data.js)
    ├── map.js         → getPlayerCity() → currentCityId
    ├── monsters.js    → CITY_REGIONS → spawn radius per city
    ├── districts.js   → fetchAndDrawDistricts(cityId)
    ├── app.js         → setupWorldSync() → closest city
    └── admin-*.js     → city selector dropdowns (5 admin modules)
         └── territory-service.js → generateCityTerritory(cityId)
              └── Firestore city_zones/{cityId}
```

---

## 3. Target Architecture (After)

### 3.1 Core Principle: Citadels Are the Only Anchors

After migration, the **only spatial anchors** are citadel documents in Firestore (`spawned_objects` or a dedicated `citadels` collection). Territory is computed globally from this single source of truth. No hardcoded coordinates.

### 3.2 Global Owner Resolution

```
getOwner(lat, lng) → { citadel, distance }
```

A single function resolves **any coordinate on Earth** to its controlling citadel using the existing weighted distance formula:

```
D_weighted = haversine(point, citadel) / citadel.powerMultiplier
```

This is mathematically a **Multiplicatively Weighted Voronoi Diagram** (Power Diagram). The citadel with the lowest `D_weighted` owns the point. No polygons, no city scoping, no GeoJSON.

### 3.3 H3 Discovery Loop

When a player moves into a new H3 Res 6 cell (~3.2 km edge):

```
1. Player enters cell 0x862a1070fffffff
2. Check Firestore: has this cell been discovered?
3. NO → Query Overpass API for POIs in the cell's bounding hex
4. Auto-create castle/citadel documents from notable OSM features
5. Mark cell as discovered in Firestore
6. Refresh territory canvas with new citadels
```

This replaces the admin-only city generation workflow with **player-driven organic world growth**.

### 3.4 Canvas Territory Rendering

A new `TerritoryCanvasLayer` (sibling to `CanvasEntityLayer`) renders Voronoi territory boundaries:

- **Input:** Array of citadels `[{lat, lng, powerMultiplier, factionColor}]`
- **Rendering:** For each pixel in the viewport, compute `getOwner()` → fill with faction color at low opacity
- **Optimization:** Render at 1/4 resolution, sample grid points, interpolate boundaries
- **Update trigger:** Map `moveend` event + citadel cache changes

### 3.5 Mathematical Districts

Districts are no longer stored as polygons. Instead:

```js
getDistrictByCoords(lat, lng) {
    const result = getOwner(lat, lng);  // from territory-math.js
    return result ? {
        id: result.citadel.id,
        name: result.citadel.name,
        center: { lat: result.citadel.lat, lng: result.citadel.lng },
        kingId: result.citadel.ownerId,
        kingName: result.citadel.ownerName
    } : null;
}
```

No polygon storage, no point-in-polygon checks, no GeoJSON parsing. The Voronoi cell boundary is implicit from the math.

### 3.6 Dependency Graph (After)

```
territory-math.js (pure math, zero imports)
    ├── territory-service.js  → global citadel cache, getOwner() delegation
    ├── territory-canvas.js   → Canvas Voronoi rendering
    ├── districts.js          → getDistrictByCoords() via getOwner()
    └── kingdom.js            → citadel proximity via territory-math

discovery-service.js (H3 + Overpass)
    ├── h3-spatial.js         → cell index computation
    ├── overpass-service.js   → OSM POI queries
    └── firebase-service.js   → citadel document creation

map.js (orchestrator)
    ├── territory-canvas.js   → addTo(map)
    ├── discovery-service.js  → onPlayerMove hook
    └── territory-service.js  → citadel cache refresh
```

---

## 4. File-by-File Migration Plan

### 4.1 Summary Table

| File | Action | Risk | LOC (est.) |
|------|--------|------|------------|
| `www/core/territory-math.js` | **NEW** | None | ~120 |
| `www/core/discovery-service.js` | **NEW** | Low | ~180 |
| `www/map/territory-canvas.js` | **NEW** | Low | ~250 |
| `www/map/territory-service.js` | **REFACTOR** | Medium | ~80 changed |
| `www/map/districts.js` | **REFACTOR** | Medium | ~40 changed |
| `www/map/kingdom.js` | **MINOR** | Low | ~10 changed |
| `www/map/map.js` | **INTEGRATE** | Medium | ~30 added |
| `www/gameplay/data.js` | **DEPRECATE** | None | ~5 changed |
| `www/core/h3-spatial.js` | **EXTEND** | None | ~3 added |
| `www/core/gameState.js` | **EXTEND** | None | ~5 added |

### 4.2 Detailed Changes

---

#### `www/core/territory-math.js` — **NEW**

Pure math module. Zero imports. Zero side effects. The foundation of the entire migration.

**Exports:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `haversineMeters` | `(lat1, lng1, lat2, lng2) → number` | Earth-surface distance in meters |
| `weightedDistance` | `(lat1, lng1, lat2, lng2, power) → number` | `haversine / max(power, 0.01)` |
| `getOwner` | `(lat, lng, citadels[]) → {citadel, distance} \| null` | Globally resolves any coordinate to its controlling citadel |
| `getOwnersInRadius` | `(lat, lng, radiusM, citadels[]) → citadel[]` | All citadels within raw haversine radius |
| `estimateBoundaryPoint` | `(c1, c2) → {lat, lng}` | Weighted midpoint between two citadels (for canvas boundary estimation) |
| `citadelColorHSL` | `(citadelId) → string` | Deterministic `hsl(H, 70%, 50%)` from string hash |

**Design notes:**
- `haversineMeters` is extracted from the duplicate in `territory-service.js` (`_haversineMeters`, L31–42). The existing copy becomes a thin wrapper or is deleted.
- `getOwner` replaces both `getNearestCitadel` and `getZoneOwner` — same algorithm, better name, no cache coupling.
- `estimateBoundaryPoint` finds the point on the line segment between two citadels where their weighted distances are equal. Used by the canvas renderer to approximate Voronoi edges without full polygon computation.

**Why a new file instead of extending `territory-service.js`?**
- `territory-service.js` imports from `firebase-service.js` — it has side effects and cannot be tested in isolation.
- Pure math must live in a zero-dependency module for TDD.

---

#### `www/core/discovery-service.js` — **NEW**

Manages the H3-based world discovery loop. Tracks which cells have been explored and triggers OSM discovery for new cells.

**Exports:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `initDiscovery` | `(mapInstance) → void` | Hooks into map `moveend` for cell tracking |
| `checkAndDiscover` | `(lat, lng) → Promise<void>` | Main discovery loop entry point |
| `getDiscoveredCells` | `() → Set<string>` | Currently discovered H3 cells |
| `markCellDiscovered` | `(h3Index) → void` | Manual cell marking (admin use) |

**Discovery flow:**

```
checkAndDiscover(lat, lng)
  │
  ├─ h3-spatial.latLngToH3(lat, lng, H3_RES_DISCOVERY)
  │   → h3Index = "862a1070fffffff"
  │
  ├─ Check local Set: already discovered? → return early
  │
  ├─ Check Firestore: discovered_cells/{h3Index} exists? → add to Set, return
  │
  ├─ Query Overpass: notable POIs in hex boundary
  │   → OverpassService.fetchCityContext(hexCenter, {includeDistricts: false})
  │
  ├─ Filter results → candidate castle locations
  │   → OverpassService.findSafeCitadelLocation() for each
  │
  ├─ Create Firestore documents: spawned_objects (type: 'citadel')
  │
  ├─ Write Firestore: discovered_cells/{h3Index} = { discoveredAt, discoveredBy }
  │
  └─ Refresh territory-service citadel cache
```

**Firestore impact:**
- New collection: `discovered_cells/{h3Index}` — lightweight documents (~100 bytes each)
- Reuses existing `spawned_objects` collection for castle/citadel documents
- Reads: 1 per new cell check (cached after first load)
- Writes: 1 discovery marker + N castle documents per new cell (typically 1–5 castles)

**Rate limiting:**
- Max 1 Overpass query per 5 seconds (respects existing `MIN_REQUEST_GAP` in `overpass-service.js`)
- Max 3 cells queued for discovery at once (prevents burst on fast map pan)
- Gated by `gameState.features.globalTerritory` feature flag

---

#### `www/map/territory-canvas.js` — **NEW**

Canvas overlay that renders Weighted Voronoi territory boundaries with faction colors.

**Exports:**

| Function | Signature | Description |
|----------|-----------|-------------|
| `TerritoryCanvasLayer` | `class extends L.Layer` | Leaflet-compatible canvas overlay |

**Rendering strategy:**

1. **Grid sampling:** Divide viewport into a coarse grid (e.g., every 8px at display resolution)
2. **Owner computation:** For each grid point, call `getOwner(lat, lng, citadels)` → get citadel ID + faction color
3. **Region fill:** Fill each grid cell with the owner's color at 20% opacity
4. **Border detection:** Where adjacent grid cells have different owners, draw a 2px border line
5. **Smooth animation:** Interpolate opacity on citadel cache changes (300ms ease)

**Performance budget:**

| Viewport Size | Grid Points (8px) | `getOwner` calls | Target frame time |
|--------------|-------------------|-------------------|-------------------|
| 1920×1080 | ~32,400 | ~32,400 | <16ms |
| 375×812 (mobile) | ~4,800 | ~4,800 | <8ms |

Each `getOwner` call iterates the citadel list (typically <50 citadels in viewport). With 50 citadels × 32K points = 1.6M comparisons — feasible in <10ms on modern hardware. If too slow, spatial index (grid-based bucket) can reduce to O(1) per point.

**Rerender triggers:**
- Map `moveend` / `zoomend`
- `citadelCacheChanged` custom event from `territory-service.js`
- `resize` event

**Relationship to `canvas-renderer.js`:**
- Separate class, not a subclass of `CanvasEntityLayer`
- `CanvasEntityLayer` renders discrete point entities (monsters)
- `TerritoryCanvasLayer` renders continuous spatial fields (territory regions)
- Both attach as Leaflet layers to the same map instance

---

#### `www/map/territory-service.js` — **REFACTOR**

The existing file already has the right math. The refactor removes city-scoping and delegates core math to `territory-math.js`.

**Changes:**

| Section | Change |
|---------|--------|
| `_haversineMeters()` (L31–42) | **DELETE** — replaced by `territory-math.haversineMeters` |
| `weightedDistance()` (L56–60) | **DELETE** — replaced by `territory-math.weightedDistance` |
| `getNearestCitadel()` (L68–82) | **DELETE** — replaced by `territory-math.getOwner` |
| `getZoneOwner()` (L113–115) | **REWRITE** — delegates to `territory-math.getOwner(lat, lng, _citadelCache)` |
| `getCitadelColor()` (L141–147) | **DELETE** — replaced by `territory-math.citadelColorHSL` |
| `setCitadels()` (L93–95) | **KEEP** — cache management stays here |
| `getCitadels()` (L101–103) | **KEEP** |
| `getPlayerZoneOwner()` (L121–125) | **KEEP** — thin wrapper using gameState |
| `getCitadelsInRange()` (L131–136) | **REWRITE** — delegates to `territory-math.getOwnersInRadius` |
| `generateCityTerritory()` (L160–196) | **KEEP** — legacy compat for admin tools |
| `regenerateCityTerritory()` (L203–213) | **KEEP** — legacy compat |
| `getTerritoryZones()` (L221–252) | **KEEP** — still needed for loading city-scoped zones |
| Legacy stubs (L257–275) | **KEEP** — prevent import errors in admin modules |

**New additions:**

```js
import { haversineMeters, weightedDistance, getOwner, getOwnersInRadius, citadelColorHSL } from '../core/territory-math.js';

// Re-export for backward compatibility
export { weightedDistance, citadelColorHSL as getCitadelColor };

// New: Load ALL citadels globally (not per-city)
export async function loadGlobalCitadels() {
    // Query Firestore spawned_objects where type == 'citadel'
    // Populate _citadelCache with ALL citadels regardless of cityId
    // Emit 'citadelCacheChanged' event
}
```

**Migration safety:** All existing exports preserved. Callers don't break. New global loading function added alongside legacy per-city loading.

---

#### `www/map/districts.js` — **REFACTOR**

The core change: `getDistrictByCoords()` stops using polygon point-in-polygon and starts using `getOwner()`.

**Changes:**

| Section | Change |
|---------|--------|
| `import { isPointInPolygon }` (L3) | **REMOVE** — no longer needed for district resolution |
| `getDistrictByCoords()` (L231–238) | **REWRITE** — use `getZoneOwner()` from territory-service |
| `fetchAndDrawDistricts()` (L91–175) | **CONDITIONAL** — feature-flagged: legacy path or global path |
| `renderDistricts()` (L185–229) | **KEEP** — polygon rendering preserved for zones that still have GeoJSON |

**New `getDistrictByCoords`:**

```js
export function getDistrictByCoords(lat, lng) {
    if (gameState.features?.globalTerritory) {
        // New: mathematical district from global citadel ownership
        const result = getZoneOwner(lat, lng);
        if (!result) return null;
        return {
            id: result.citadel.id,
            name: result.citadel.name || `Zone ${result.citadel.id.substring(0, 6)}`,
            center: { lat: result.citadel.lat, lng: result.citadel.lng },
            kingId: result.citadel.ownerId || null,
            kingName: result.citadel.ownerName || 'Unclaimed',
            points: [] // No polygon — consumers must handle empty
        };
    }

    // Legacy: polygon-based lookup
    for (const d of districtData) {
        if (isPointInPolygon({ lat, lng }, d.points)) {
            return d;
        }
    }
    return null;
}
```

**Note:** The `isPointInPolygon` import is retained while the feature flag exists. It's only removed in the final deprecation step.

---

#### `www/map/kingdom.js` — **MINOR**

Citadel proximity check in `checkCitadelProximity()` (L17–47) currently reads from `gameState.currentDistrict.center`. This works with both legacy and new district objects — no structural change needed.

**Only change:** Add a fallback for when `globalTerritory` is active and the district object lacks a `citadel` sub-object:

```js
// L22-24: existing code already handles this correctly
const targetPos = district.citadel || district.center;
```

No change required. The existing fallback chain (`district.citadel || district.center`) works with the new mathematical district shape since we always populate `center`.

**Optional improvement:** Import `haversineMeters` from `territory-math.js` instead of `getDistance` from `map.js` to reduce coupling. Deferred — not blocking.

---

#### `www/map/map.js` — **INTEGRATE**

Wire the new systems into the map initialization and movement hooks.

**Changes:**

| Location | Change |
|----------|--------|
| Imports (L1–13) | Add `TerritoryCanvasLayer`, `discovery-service` |
| `initMap()` (~L465) | Add territory canvas layer after monster canvas layer |
| `updatePlayerPosition()` (~L670) | Hook `checkAndDiscover()` on movement |
| `getPlayerCity()` (L896–916) | Feature-flagged: return synthetic city object from `getOwner()` when global territory is active |

**New code in `initMap()`:**

```js
// After canvasMonsterLayer initialization (~L470)
if (gameState.features?.globalTerritory) {
    const { TerritoryCanvasLayer } = await import('./territory-canvas.js');
    const territoryLayer = new TerritoryCanvasLayer();
    territoryLayer.addTo(map);

    const { initDiscovery } = await import('../core/discovery-service.js');
    initDiscovery(map);
}
```

**Modified `getPlayerCity()`:**

```js
export function getPlayerCity() {
    const pos = gameState.player.position;
    if (!pos) return null;

    if (gameState.features?.globalTerritory) {
        const result = getZoneOwner(pos.lat, pos.lng);
        if (result) {
            return {
                id: result.citadel.cityId || result.citadel.id,
                name: result.citadel.name || 'Unknown Territory',
                lat: result.citadel.lat,
                lng: result.citadel.lng
            };
        }
    }

    // Legacy fallback
    let closestCity = null;
    let closestDist = Infinity;
    CITY_ANCHORS.forEach((city) => { /* ... existing code ... */ });
    return closestCity;
}
```

---

#### `www/gameplay/data.js` — **DEPRECATE**

Mark `CITY_ANCHORS` as legacy. Do **not** delete — admin modules still reference it for city-selector dropdowns.

```js
/**
 * @deprecated Legacy city anchors — used only by admin tools.
 * Runtime territory resolution uses territory-math.js getOwner() instead.
 * See: docs/REFACTOR-PLAN-GLOBAL-TERRITORY.md
 */
export const CITY_ANCHORS = [
    { id: 'berlin',  name: 'Berlin',  lat: 52.52,   lng: 13.405  },
    // ... unchanged
];
```

No functional change. Pure documentation.

---

#### `www/core/h3-spatial.js` — **EXTEND**

Add the discovery resolution constant:

```js
/** Resolution 6: ~3.2km edge length — world discovery trigger cells */
export const H3_RES_DISCOVERY = 6;
```

This is the same numeric value as `H3_RES_CLUSTER` but with distinct semantic meaning. Using a separate named constant ensures the discovery system can be tuned independently of clustering.

---

#### `www/core/gameState.js` — **EXTEND**

Add the feature flags object to the game state:

```js
export let gameState = {
    // ... existing fields ...
    features: {
        globalTerritory: false,  // Set true to enable global territory system
    },
    // ...
};
```

---

## 5. Preservation Rules

These systems are **explicitly out of scope** and must not be modified:

### 5.1 Combat Math — UNTOUCHED

`www/gameplay/battle-logic.js` contains pure combat math (damage calc, hit/dodge, crit rolls). Territory migration does not affect combat resolution. The zone-based attack/defense system (Head, Body, Belt, Legs) is completely independent.

### 5.2 Passive Income — Preserved, Rewired

`districts.js` tax logic and `kingdom.js` income processing continue to work. The only change is **where the district/king data comes from**:

| Before | After |
|--------|-------|
| `getDistrictByCoords()` → polygon lookup → `{kingId, kingName}` | `getDistrictByCoords()` → `getOwner()` → `{citadel.ownerId, citadel.ownerName}` |

The downstream consumers (`checkCitadelProximity`, `claimThrone`, `openCitadelMenu`) receive the same shaped object.

### 5.3 BigInt XP — Unchanged

All XP/gold arithmetic uses BigInt. Territory migration introduces no new numeric types. `triggerSave()` serialization (`xp.toString()`) is unaffected.

### 5.4 Save System — Unchanged

The `triggerSave()` debounce pattern (5s inactivity → Firestore write) is not modified. Discovery writes are separate Firestore operations, not part of the player save document.

### 5.5 PvP / Group Combat — Unchanged

RTDB-based PvP matchmaking (`battles/`, `battle_requests/`) and group system (`groups/`, `group_invites/`) are territory-agnostic. Arena boundary checks (50m radius) use raw `getDistance()` — independent of territory ownership.

### 5.6 Admin Modules — Backward Compatible

All 5 admin modules (`admin-castles.js`, `admin-citadels.js`, `admin-monsters.js`, `admin-shops.js`, `admin-vaults.js`) continue to use `CITY_ANCHORS` for their city-selector dropdowns. The legacy `generateCityTerritory()` path is preserved. Admin tools gain a **new option** to trigger global discovery but are not forced to migrate.

---

## 6. Migration Sequence

Each step produces a verifiable deliverable. No step removes existing functionality.

### Step 1: Pure Math Module

**File:** `www/core/territory-math.js`  
**Depends on:** Nothing  
**Verify:** Unit tests pass — `haversineMeters`, `weightedDistance`, `getOwner`, `estimateBoundaryPoint` all produce correct results for known inputs.

### Step 2: Feature Flag

**File:** `www/core/gameState.js`  
**Depends on:** Nothing  
**Verify:** `gameState.features.globalTerritory` defaults to `false`. Setting it to `true` via console doesn't break anything (flag not consumed yet).

### Step 3: H3 Discovery Constant

**File:** `www/core/h3-spatial.js`  
**Depends on:** Nothing  
**Verify:** `H3_RES_DISCOVERY === 6` exported correctly.

### Step 4: Discovery Service

**File:** `www/core/discovery-service.js`  
**Depends on:** Step 3 (`H3_RES_DISCOVERY`)  
**Verify:** Calling `checkAndDiscover(52.52, 13.405)` (Berlin) queries Overpass, creates test documents in Firestore emulator, marks cell as discovered.

### Step 5: Territory Canvas

**File:** `www/map/territory-canvas.js`  
**Depends on:** Step 1 (`territory-math.js`)  
**Verify:** Adding layer to map with test citadels renders colored regions. Boundaries appear between regions of different owners.

### Step 6: Refactor `territory-service.js`

**File:** `www/map/territory-service.js`  
**Depends on:** Step 1 (`territory-math.js`)  
**Verify:**
- `getZoneOwner()` produces identical results to before for Berlin citadels (regression test).
- New `loadGlobalCitadels()` populates cache from all cities.
- All existing admin workflows still function.

### Step 7: Refactor `districts.js`

**File:** `www/map/districts.js`  
**Depends on:** Step 6 (refactored `territory-service.js`)  
**Verify:**
- With `globalTerritory: false` — identical behavior to before.
- With `globalTerritory: true` — `getDistrictByCoords()` returns owner-based district for coordinates outside any polygon.

### Step 8: Wire into `map.js`

**File:** `www/map/map.js`  
**Depends on:** Steps 4, 5, 6, 7  
**Verify:**
- Boot with `globalTerritory: false` — no behavioral change.
- Boot with `globalTerritory: true` — territory canvas visible, discovery triggers on movement, `getPlayerCity()` returns citadel-based city.

### Step 9: Deprecate `CITY_ANCHORS`

**File:** `www/gameplay/data.js`  
**Depends on:** Step 8 verified and stable  
**Verify:** `@deprecated` JSDoc tag present. No runtime behavior change.

### Sequence Diagram

```
Step 1 ─────────────────────────────┐
                                     ├─→ Step 5 (canvas) ──┐
Step 2 (flag) ──────────────────────┤                       │
                                     ├─→ Step 6 (territory) ┼─→ Step 7 (districts) ──┐
Step 3 (h3 const) ─→ Step 4 (disc.) ┘                       │                         ├─→ Step 8 (map.js) → Step 9
                                                             └─────────────────────────┘
```

**Parallelizable:** Steps 1, 2, 3 can be done simultaneously. Steps 4 and 5 can be done simultaneously (both depend on Step 1 but not each other).

---

## 7. Risk Mitigation

### 7.1 Additive-Only Until Verified

All new code is **added alongside** existing code. No existing function is deleted or renamed until the feature flag has been tested in production with a subset of users.

| Risk | Mitigation |
|------|-----------|
| `getOwner()` produces different results than legacy polygon check | Both paths run in parallel; log discrepancies for 1 week before switching |
| Overpass API rate limits during mass discovery | Queue + backoff in `discovery-service.js`; max 3 pending cells |
| Canvas rendering performance on mobile | 8px grid sampling; skip render below zoom level 10; benchmark on low-end Android |
| Firestore cost increase from discovery writes | `discovered_cells` docs are tiny (~100 bytes); estimate 10K cells = 1MB = negligible |
| Admin tools break due to territory-service refactor | All legacy exports preserved; admin modules don't use feature flag |

### 7.2 Feature Flag Pattern

```js
if (gameState.features?.globalTerritory) {
    // New global territory path
} else {
    // Legacy city-scoped path (unchanged)
}
```

The flag is checked at exactly 3 decision points:
1. `map.js` → `initMap()` — whether to load canvas + discovery
2. `map.js` → `getPlayerCity()` — citadel-based vs CITY_ANCHORS
3. `districts.js` → `getDistrictByCoords()` — math-based vs polygon-based

### 7.3 Legacy Stub Preservation

The following stubs in `territory-service.js` are kept indefinitely to prevent import errors:
- `getCleanCityMask()` — passthrough
- `generateSmartMapMask()` — passthrough
- `generateCityTerritory()` — returns Point FeatureCollection (not Voronoi polygons)

### 7.4 Rollback Plan

If critical issues are found after enabling global territory:

1. Set `gameState.features.globalTerritory = false` (instant rollback, no deploy needed)
2. All legacy code paths are still present and functional
3. `discovered_cells` Firestore data is inert when flag is off — no cleanup needed
4. Created citadel documents remain valid for both legacy and global systems

---

## 8. Test Strategy (TDD)

### 8.1 `territory-math.js` — Pure Function Tests

**Coverage target: 100%** — this module has zero side effects and must be exhaustively tested.

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Haversine: Berlin → Kyiv | `(52.52, 13.405, 50.4501, 30.5234)` | ~1,189,000m (±1%) |
| Haversine: same point | `(0, 0, 0, 0)` | `0` |
| Haversine: antipodal | `(0, 0, 0, 180)` | ~20,015,000m (half Earth circumference) |
| Weighted distance: power=1 | `(52.52, 13.405, 50.45, 30.52, 1)` | Same as raw haversine |
| Weighted distance: power=2 | same coords, `power=2` | Exactly half of raw |
| Weighted distance: power=0 | same coords, `power=0` | Uses `0.01` guard → raw/0.01 |
| `getOwner`: single citadel | Any point, 1 citadel | Always returns that citadel |
| `getOwner`: two equal citadels | Midpoint between them | Either is valid (distance ≈ equal) |
| `getOwner`: power advantage | Point equidistant, citadel A has power=2 | Returns citadel A |
| `getOwner`: empty array | Any point, `[]` | `null` |
| `getOwner`: Berlin center | `(52.52, 13.405)`, Berlin + Kyiv citadels | Berlin citadel |
| `getOwner`: middle of Atlantic | `(40.0, -30.0)`, 6 European citadels | Nearest European citadel |
| `getOwner`: equator / prime meridian | `(0.0, 0.0)` | Should not throw |
| `getOwner`: North Pole | `(90.0, 0.0)` | Should not throw |
| `getOwner`: South Pole | `(-90.0, 0.0)` | Should not throw |
| `getOwner`: antimeridian | `(0.0, 179.999)` vs `(0.0, -179.999)` | Consistent nearest (tests sign wrap) |
| `getOwner`: antimeridian citadel | Citadel at `(0, 179.5)`, point at `(0, -179.5)` | Should recognize ~1° apart, not ~359° |
| `estimateBoundaryPoint`: equal power | Two citadels, power=1 each | Geographic midpoint |
| `estimateBoundaryPoint`: unequal power | Citadel A power=2, B power=1 | Point closer to B (A's territory extends further) |
| `citadelColorHSL`: deterministic | Same ID twice | Same HSL string |
| `citadelColorHSL`: different IDs | `"abc"` vs `"def"` | Different hue values |

**⚠️ Antimeridian note:** The standard haversine formula handles the antimeridian correctly (longitude wraps via cosine). However, `estimateBoundaryPoint` must handle the case where a naive midpoint of `lng=179.5` and `lng=-179.5` would compute `lng=0` instead of the correct `lng=180`. Test this explicitly.

### 8.2 `discovery-service.js` — Integration Tests

| Test Case | Setup | Verify |
|-----------|-------|--------|
| New cell triggers Overpass query | Mock Overpass, call `checkAndDiscover` | `fetchCityContext` called once |
| Already-discovered cell skips query | Pre-populate `discoveredCells` Set | No Overpass call |
| Firestore persistence | Discover a cell, clear local Set, re-check | Firestore doc found, no Overpass call |
| Rate limiting | Call `checkAndDiscover` 10x in 1 second | Max 3 Overpass queries |
| Overpass failure | Mock 503 response | Cell not marked as discovered, retry possible |
| Feature flag off | `globalTerritory: false` | `checkAndDiscover` is a no-op |

### 8.3 `territory-canvas.js` — Visual Regression

Automated visual testing is impractical for canvas rendering. Instead:

1. **Screenshot comparison:** Capture canvas output for a known citadel configuration. Store as baseline PNG.
2. **Manual test matrix:**

| Scenario | Check |
|----------|-------|
| 2 citadels, equal power | Boundary is a straight line at geographic midpoint |
| 2 citadels, unequal power | Boundary curves toward weaker citadel |
| 5 citadels, Berlin area | Voronoi regions visible, no gaps, no overlap |
| Zoom out to world view | Rendering degrades gracefully (lower sample rate or hidden) |
| Pan across boundary | Smooth boundary, no flickering |
| Citadel added dynamically | Canvas re-renders within 500ms |
| Mobile viewport (375×812) | Renders within 16ms frame budget |

3. **Performance benchmark:** Log `getOwner` call count and total render time per frame. Alert if >16ms.

### 8.4 Regression Tests for Refactored Modules

| Module | Test | Method |
|--------|------|--------|
| `territory-service.js` | `getZoneOwner` returns same results for Berlin citadels | Snapshot comparison with pre-refactor output |
| `territory-service.js` | `setCitadels` / `getCitadels` round-trip | Unit test |
| `territory-service.js` | `generateCityTerritory` still returns valid GeoJSON | Schema validation |
| `districts.js` | `getDistrictByCoords` in legacy mode matches polygon behavior | Same test inputs, same outputs |
| `districts.js` | `getDistrictByCoords` in global mode returns citadel-based district | Mock citadel cache, verify shape |
| `map.js` | `getPlayerCity` in legacy mode returns nearest CITY_ANCHOR | Existing test still passes |
| `map.js` | `getPlayerCity` in global mode returns citadel-based city | Mock `getZoneOwner`, verify shape |
| `kingdom.js` | `checkCitadelProximity` works with new district shape | Verify `district.center` is read correctly |

### 8.5 Test File Location

```
tests/
├── core-logic.test.js          ← existing (add territory-math tests here)
├── territory-math.test.js      ← NEW: dedicated pure math tests
└── discovery-service.test.js   ← NEW: integration tests with mocked Firestore/Overpass
```

---

## Appendix A: Antimeridian Handling

The international date line (±180° longitude) creates an edge case for distance calculations. The haversine formula inherently handles this correctly because it uses `cos(Δλ)`, which wraps at 360°. However, **boundary estimation** between two citadels straddling the antimeridian requires explicit handling:

```js
function normalizeLng(lng) {
    return ((lng + 540) % 360) - 180;
}

function midpointLng(lng1, lng2) {
    // Handle the short way around the antimeridian
    let diff = lng2 - lng1;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return normalizeLng(lng1 + diff / 2);
}
```

This must be implemented in `territory-math.js` and used by `estimateBoundaryPoint`.

---

## Appendix B: Firestore Schema Additions

### `discovered_cells/{h3Index}`

```json
{
  "discoveredAt": "2025-07-13T12:00:00Z",
  "discoveredBy": "charId_abc123",
  "resolution": 6,
  "centerLat": 52.520,
  "centerLng": 13.405,
  "castlesCreated": 3
}
```

**Security rules addition:**

```
match /discovered_cells/{cellId} {
    allow read: if request.auth != null;
    allow create: if request.auth != null
                  && request.resource.data.discoveredBy is string;
    allow update, delete: if false;  // Immutable once created
}
```

---

## Appendix C: Glossary

| Term | Definition |
|------|-----------|
| **Power Diagram** | A generalization of Voronoi diagrams where each site has a weight (power). The boundary between two weighted sites is not equidistant but shifted toward the weaker site. In FightCraft, `powerMultiplier` is this weight. |
| **H3** | Uber's hexagonal hierarchical spatial index. Each resolution level divides Earth into hexagonal cells of consistent size. |
| **Weighted Distance** | `D_w = haversine(P, C) / C.powerMultiplier` — a citadel with higher power "reaches further," expanding its territory. |
| **Discovery Cell** | An H3 Res 6 hexagon (~3.2 km edge). When a player enters an undiscovered cell, the game auto-populates it with POIs from OpenStreetMap. |
| **Antimeridian** | The 180° / -180° longitude line in the Pacific Ocean where longitude values wrap. |