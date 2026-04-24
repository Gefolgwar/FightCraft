# OSM Population Scaling Design Spec

## Overview
Modify the `generateGlobalWorld` admin script (`www/maintenance/admin-world.js`) to scale generated objects (citadels, monsters, shops, etc.) dynamically based on the actual population of each city, fetched in real-time from the OpenStreetMap Overpass API.

## Current State vs. Goal
- **Current**: The script falls back to `1,000,000` population for every city because the `population` attribute is missing from `CITY_ANCHORS`. As a result, all cities generate the exact same number of objects.
- **Goal**: Fetch the city's population from OSM before calculating ratios.

## Technical Architecture

### 1. New Helper Function: `fetchCityPopulation(city)`
We will implement a helper function that leverages `OverpassService.fetchJSON()`.
- **Query**:
  ```
  [out:json][timeout:10];
  node(around:20000, {lat}, {lng})["place"~"city|town|municipality"]["name"="{name}"];
  out tags;
  ```
- **Parsing**: It will extract `data.elements[0].tags.population` and parse it into an integer.

### 2. Integration into `generateGlobalWorld()`
At the top of the main city loop:
1. Update UI: `status.textContent = "Fetching population for {City} from OSM...";`
2. Fetch the population using the helper function.
3. Apply the 1-second delay immediately after fetching to throttle requests before the subsequent boundary fetch (`generateCitadelsAndZones`).
4. Calculate object limits using the newly fetched population.

### 3. Error Handling (Strict Failure)
- **No Default Fallback**: We will **not** use `1,000,000` as a fallback.
- **Explicit Failure**: If the API call fails, times out, or the OSM node lacks a `population` tag, the script will throw an explicit error: `throw new Error("Could not fetch population for " + city.name + " from OSM.");`
- **UI Impact**: This exception will be caught by the existing try/catch block surrounding the generation logic, turning the progress status red and safely halting the generation process so the admin is aware of the failure.

### 4. Dependencies
- No new libraries needed. Relies on the existing `OverpassService`.
- Operates entirely within `www/maintenance/admin-world.js`.
