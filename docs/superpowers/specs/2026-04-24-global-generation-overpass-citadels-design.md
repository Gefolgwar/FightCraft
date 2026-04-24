---
name: global-generation-overpass-citadels
description: Refactor admin-world.js to use the admin-citadels Overpass algorithm for exact city boundaries and proportional global generation.
type: project
---

# Global Generation with Overpass Citadels

## Purpose
Update the global generation logic (`admin-world.js`) to apply the exact citadel generation algorithm currently used in `admin-citadels.js`. It will fetch real OSM data for citadels, use strict administrative boundaries, strictly adhere to population ratios for object counts, and properly generate Voronoi territories within those boundaries before generating other entity types.

## Ratios
- **Monsters**: `round(population / 1000)`
- **Shops**: `round(population / 16000)`
- **Vaults**: `round(population / 34782.6087)`
- **Castles**: `round(population / 5000)`
- **Citadels**: `round(population / 190476)`
*(Example: Berlin (pop 4,000,000) = 21 Citadels)*

## Architecture & Flow

### 1. Refactor Citadel Generation (Option A)
We will extract the core OSM fetch and distribution algorithm from `admin-citadels.js` into a shared utility function inside `map/overpass-service.js` or `map/territory-service.js`.

**The algorithm steps:**
1. Fetch `OverpassService.fetchCityContext()` to get the true city GeoJSON boundary.
2. Build Overpass query using the active Citadel templates and area boundaries.
3. Fetch raw POIs.
4. Filter POIs strictly using Turf.js against the city boundary.
5. If POI count < target Citadels: Uniformly inject synthetic points inside the boundary mask.
6. If POI count > target Citadels: Use Furthest Point Sampling (FPS) to reduce to target count, prioritizing the best spread.
7. Return the finalized list of Citadel objects and the GeoJSON boundary.

### 2. Update `admin-world.js`
Modify `generateGlobalWorld` to:
1. Loop over `CITY_ANCHORS`.
2. Compute the precise entity counts based on population.
3. Await the shared citadel algorithm to fetch the Citadels and strict `cityBoundary`.
4. Generate the Voronoi territories (`zonesGeoJson`) using those Citadels and `cityBoundary`.
5. For the remaining entities (Monsters, Shops, Vaults, Castles), use the pseudo-random grid logic *but* strictly filter coordinates using Turf.js so everything stays within `cityBoundary`.
6. Inject a 2000ms delay between cities to prevent Overpass API rate limits (HTTP 429).
7. Save the output grouped by chunks of 3000 objects to Firebase (preventing payload limits).

## Data Flow
- `admin-world.js` -> `OverpassService` (Fetch OSM Boundary & Citadels)
- `admin-world.js` -> `territory-service.js` (Voronoi zones)
- `admin-world.js` -> Firebase (`saveWorldSnapshot`)

## Error Handling & Limits
- Use strict Turf.js bounding to avoid items spawning outside the real-world city borders.
- Provide fallbacks if Overpass fails (use synthetic distribution around radius).
- Rate limit handling via manual `delay()` between queries.
- Firebase writes split in 3000-object chunks to respect Firestore limitations.
