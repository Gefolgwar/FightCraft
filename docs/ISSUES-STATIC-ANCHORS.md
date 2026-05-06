# Issues: Static City Anchor Cleanup

Tracking all remaining references to the legacy `CITY_ANCHORS` system that should be migrated to the global territory math system.

## Priority: High (Functional Impact)

### ISSUE-001: `getPlayerCity()` in map.js (L896-915)
- **File**: `www/map/map.js`
- **Current**: Iterates `CITY_ANCHORS`, returns nearest by raw distance
- **Impact**: Used for city-specific monster spawning context, debug display
- **Migration**: Replace with `getGlobalOwner()` from territory-service.js
- **Blocked by**: Nothing — can migrate immediately

### ISSUE-002: `currentCityId` in map.js (L20, L724-726)
- **File**: `www/map/map.js`
- **Current**: Set from `getPlayerCity().id`, stored in `gameState.currentCityId`
- **Impact**: Used by districts.js to load city-specific zones
- **Migration**: Remove city-specificity; use global territory context instead

### ISSUE-003: `fetchAndDrawDistricts()` in districts.js
- **File**: `www/map/districts.js`
- **Current**: Uses `gameState.currentCityId` to load city-specific zones from Firestore
- **Impact**: No districts loaded if player is outside known cities
- **Migration**: Use `computeAllTerritoryBoundaries()` + TerritoryCanvasLayer

## Priority: Medium (Display/UX)

### ISSUE-004: Debug city display in map.js (L820-822)
- **File**: `www/map/map.js`
- **Current**: Shows nearest CITY_ANCHOR name in debug overlay
- **Impact**: Cosmetic only
- **Migration**: Show territory owner name instead

### ISSUE-005: `renderStaticMonsters()` city context (L1080-1087)
- **File**: `www/map/map.js`
- **Current**: Sets `currentCityId` from `getPlayerCity()` for monster context
- **Impact**: Affects monster clustering behavior
- **Migration**: City context can be derived from H3 cell or territory owner

## Priority: Low (Can Defer)

### ISSUE-006: `CITY_ANCHORS` import in map.js (L9)
- **File**: `www/map/map.js`
- **Current**: Direct import of the deprecated constant
- **Migration**: Remove import after all uses are migrated

### ISSUE-007: CITY_ANCHORS in data.js
- **File**: `www/gameplay/data.js`
- **Current**: Array with 6 hardcoded cities (Berlin, Kyiv, Lviv, Warsaw, Prague, Vienna)
- **Migration**: Delete the array and export after all references are removed

## Completion Criteria

All issues resolved when:
1. No JS file imports `CITY_ANCHORS`
2. `getPlayerCity()` is removed or refactored
3. `gameState.currentCityId` is removed or repurposed
4. Districts load from global territory system, not city-specific Firestore docs
5. Debug overlay shows territory info instead of city name