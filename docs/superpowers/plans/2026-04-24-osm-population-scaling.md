# OSM Population Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the `generateGlobalWorld` admin script to scale generated objects based on the actual population of each city fetched from OSM.

**Architecture:** We will implement a helper function `fetchCityPopulation` using the existing `OverpassService`, and inject it into the main city loop of `generateGlobalWorld` with explicit error handling and throttling.

**Tech Stack:** Vanilla JS, Overpass API.

---

### Task 1: Add `fetchCityPopulation` Helper Function

**Files:**
- Modify: `www/maintenance/admin-world.js`

- [ ] **Step 1: Write the failing test (Manual Console Verification)**

*Since there is no automated test framework, we verify via browser console.*
Run: Open `http://localhost:5000/maintenance/admin.html`, open DevTools Console, and run:
`await window.fetchCityPopulation({ lat: 52.52, lng: 13.405, name: 'Berlin' })`
Expected: FAIL with "window.fetchCityPopulation is not a function"

- [ ] **Step 2: Write minimal implementation**

Add the import for `OverpassService` at the top of the file, and add the helper function.

```javascript
// Add to top of www/maintenance/admin-world.js
import { OverpassService } from '../map/overpass-service.js';

// Add below imports, before window.generateGlobalWorld
window.fetchCityPopulation = async function(city) {
    const query = `[out:json][timeout:10];
node(around:20000, ${city.lat}, ${city.lng})["place"~"city|town|municipality"]["name"="${city.name}"];
out tags;`;

    const data = await OverpassService.fetchJSON(query);
    
    if (!data || !data.elements || data.elements.length === 0) {
        throw new Error(`OSM node for ${city.name} not found.`);
    }

    const populationStr = data.elements[0].tags.population;
    if (!populationStr) {
        throw new Error(`Population tag missing for ${city.name}.`);
    }

    const population = parseInt(populationStr, 10);
    if (isNaN(population)) {
        throw new Error(`Invalid population data for ${city.name}: ${populationStr}`);
    }

    return population;
};
```

- [ ] **Step 3: Run test to verify it passes**

Run in browser console: `await window.fetchCityPopulation({ lat: 52.52, lng: 13.405, name: 'Berlin' })`
Expected: A number around `3850000` (Berlin's OSM population).

- [ ] **Step 4: Commit**

```bash
git add www/maintenance/admin-world.js
git commit -m "feat: add fetchCityPopulation helper to admin-world"
```

---

### Task 2: Integrate Population Fetch into `generateGlobalWorld`

**Files:**
- Modify: `www/maintenance/admin-world.js`

- [ ] **Step 1: Write the failing test (Manual Integration)**

Run: Click "Generate Global World" in the admin panel. 
Expected: It uses the default 1,000,000 population without fetching from OSM.

- [ ] **Step 2: Write minimal implementation**

Update the loop inside `window.generateGlobalWorld`:

```javascript
// Replace this existing code in www/maintenance/admin-world.js (around line 115):
// const population = city.population || 1000000;

// With this new implementation:
            status.textContent = `Fetching population for ${city.name} from OSM...`;
            const population = await window.fetchCityPopulation(city);
            await delay(1000); // Throttling for Overpass API
```

*(Note: Ensure this is inside the `try` block so that errors thrown by `fetchCityPopulation` are caught by the existing `catch (error)` block at the bottom, which safely turns the status red and halts execution).*

- [ ] **Step 3: Run test to verify it passes**

Run: Click "Generate Global World" in the admin panel.
Expected: The status bar briefly shows "Fetching population for Berlin from OSM...", followed by generation logic scaled to Berlin's actual population (resulting in ~20-21 citadels instead of 5). If it fails, the progress bar should halt and display the error message.

- [ ] **Step 4: Cleanup Global Scope**

We no longer need `fetchCityPopulation` attached to `window` since testing is complete. Remove `window.` from its definition and usage.

```javascript
// Change:
// window.fetchCityPopulation = async function(city) {
// To:
async function fetchCityPopulation(city) {

// And in generateGlobalWorld change:
// const population = await window.fetchCityPopulation(city);
// To:
const population = await fetchCityPopulation(city);
```

- [ ] **Step 5: Commit**

```bash
git add www/maintenance/admin-world.js
git commit -m "feat: integrate dynamic OSM population scaling into world generation"
```
