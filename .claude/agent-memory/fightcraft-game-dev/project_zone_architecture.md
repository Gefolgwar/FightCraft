---
name: Territory Zone Storage Architecture
description: How city territory zones are generated and stored — canonical location is city_zones/{cityId}, not world_snapshots
type: project
---

Zone data for city territory (Voronoi diagrams) lives in `city_zones/{cityId}` in Firestore — this is the canonical location consumed by `getTerritoryZones()` in `territory-service.js` and by the kingdom/map systems at runtime.

**Why:** `saveWorldSnapshot` enforces a 1MB Firestore document limit. Embedding GeoJSON zones for all 6 cities inside a single global snapshot would exceed this. Zones are therefore saved city-by-city via `saveCityZones(cityId, geoJson)` as a separate write.

**How to apply:** When any admin tool generates citadels + zones, always call `saveCityZones` directly (not embed zones in the snapshot). The `zones` field that `saveWorldSnapshot` accepts in its data object is valid for single-city snapshots only (used in `admin-citadels.js`) and is optional — the canonical zone data must also be written to `city_zones/`.

**Pipeline in admin-world.js (global generation):**
1. Per city: place objects with ring algorithm, collect placed citadels.
2. Per city: call `generateCityTerritory(cityId, citadelSeeds)` -> returns GeoJSON FeatureCollection.
3. Per city: call `saveCityZones(cityId, geoJson)` -> writes to `city_zones/{cityId}`.
4. Global: call `saveWorldSnapshot({ objects: allObjects })` — no zones field.

**Minimum citadels for zone generation:** `generateCityTerritory` requires >= 2 points for a valid Voronoi diagram. Guard with `if (citadels.length >= 2)` before calling.

**Citadel id requirement:** `generateCityTerritory` uses `citadel.id` as the `properties.citadelId` on each zone feature. When building citadel objects from a grid (not from OSM), assign `id: \`${cityId}_citadel_${index}\`` to enable zone-to-citadel lookup.
