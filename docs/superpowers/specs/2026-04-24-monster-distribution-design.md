# Monster Distribution Design Spec

## Goal
Ensure monsters and other generated map objects are perfectly and evenly distributed across all Citadel zones, eliminating the "Outside Territories" clustering bug and fixing the bug where some Citadels receive zero objects.

## Architecture & Approach
We will abandon the global jittered grid placement in favor of a strictly zone-bound random generation algorithm. 

### 1. Fix Citadel Deletion
**File:** `www/maintenance/admin-citadel-generator.js`
- **Issue:** An aggressive `-0.01km` safety mask buffer was inadvertently filtering out valid citadels near the city boundary, leaving them with no territory.
- **Solution:** Remove the `safetyMask` buffering step entirely. If a citadel exists in `finalCitadels` and is inside the city bounds, it will be passed to `generateCityTerritory` directly.

### 2. Polygon-Strict Quota Spawning
**File:** `www/maintenance/admin-world.js`
- **Issue:** The grid system ran out of valid cells due to strict city bounding, dumping excess objects into a fallback generic location ("Outside Territories").
- **Solution:** 
  - After fetching all required templates (monsters, shops, vaults, castles), calculate the total number of objects to spawn.
  - Calculate a `quotaPerZone = Math.ceil(totalObjects / numZones)`.
  - Create a master list of all objects to be placed (shuffled).
  - Iterate through each feature in `zonesGeoJson.features` (the Voronoi zones).
  - For each zone, calculate its Turf bounding box (`turf.bbox`).
  - Use a `while` loop to generate random coordinates within the bounding box.
  - Use `turf.booleanPointInPolygon` to confirm the generated point is strictly inside the zone.
  - Pop an object from the master list and assign it the valid coordinates.
  - Continue until the zone reaches its exact quota or the master list is empty.
  - If any objects remain after looping through all zones (due to rounding), place them into random zones or strictly inside the overall `cityBoundary`.

## Component Responsibilities

- **`admin-citadel-generator.js`**: Responsible only for returning the valid 14 citadels and their generated territory GeoJSON without arbitrarily deleting edge citadels.
- **`admin-world.js`**: Responsible for the exact quota math, random point sampling within Turf polygons, and maintaining an even distribution of entity types across all zones.

## Constraints & Trade-offs
- **Random Clumping:** Since we are moving from a structured grid to random points, objects might occasionally spawn close to each other. We accept this trade-off in exchange for guaranteed even distribution per zone and massive performance gains over complex grid-cell mapping.
- **Performance:** Generating random points and running `booleanPointInPolygon` could take slightly longer for complex polygons, but since we are doing this in an admin script and saving the final state as a snapshot, runtime performance is not an issue.