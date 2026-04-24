# Monster Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure monsters and other generated map objects are perfectly and evenly distributed across all Citadel zones, eliminating the "Outside Territories" clustering bug and fixing the bug where some Citadels receive zero objects.

**Architecture:** Modify `admin-citadel-generator.js` to stop aggressively deleting citadels near borders. Modify `admin-world.js` to use `turf.bbox` and `turf.booleanPointInPolygon` for assigning an exact quota of random objects to each zone.

**Tech Stack:** Vanilla JS, Turf.js.

---

### Task 1: Fix Citadel Deletion

**Files:**
- Modify: `www/maintenance/admin-citadel-generator.js`

- [ ] **Step 1: Write the failing test**

We can't easily test this locally without the browser, but we can verify the source file contains the bad `safetyMask` buffer logic.

Run: `grep -n "safetyMask" www/maintenance/admin-citadel-generator.js`
Expected: Should show the `turf.buffer` and `safetyMask` filter logic around lines 194-197.

- [ ] **Step 2: Remove the aggressive safety mask filtering**

In `www/maintenance/admin-citadel-generator.js`, find step 6:
```javascript
    // 6. Generate Zones
    let allCitadelsForZones = [...finalCitadels];
    if (cityBoundary) {
        try {
            const safetyMask = turf.buffer(cityBoundary, -0.01, { units: 'kilometers' });
            allCitadelsForZones = allCitadelsForZones.filter(c => turf.booleanPointInPolygon([c.lng, c.lat], safetyMask));
        } catch (e) { /* fallback */ }
    }
```

Replace it entirely with:
```javascript
    // 6. Generate Zones
    let allCitadelsForZones = [...finalCitadels];
    // No secondary filtering needed, they were already filtered by cityBoundary in Step 3.
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `grep -n "safetyMask" www/maintenance/admin-citadel-generator.js`
Expected: No results.

- [ ] **Step 4: Commit**

```bash
git add www/maintenance/admin-citadel-generator.js
git commit -m "fix: prevent citadel deletion near city boundaries"
```

---

### Task 2: Implement Polygon-Strict Quota Spawning

**Files:**
- Modify: `www/maintenance/admin-world.js`

- [ ] **Step 1: Write the failing test**

Run: `grep -n "buildCityGrid" www/maintenance/admin-world.js`
Expected: Should show the grid generation logic around line 188.

- [ ] **Step 2: Replace Grid Logic with Quota Allocation**

In `www/maintenance/admin-world.js`, completely replace the grid logic block (everything from `// 2. Build remaining objects...` down to the end of the `for (const { type, count, templatesList } of placementOrder)` loop). 

Find this start point:
```javascript
            // 2. Build remaining objects (Monsters, Shops, Vaults, Castles) using grid
```
And replace it down to (and including):
```javascript
            for (const { type, count, templatesList } of placementOrder) {
                if (!templatesList || templatesList.length === 0) continue;
                const preferredRing = ENTITY_RING_PREFERENCE[type];
                for (let j = 0; j < count; j++) {
                    const template = getRandomTemplate(templatesList);
                    if (!template) continue;
                    const cell = pickCell(preferredRing);
                    cityObjects.push(buildObject(type, template, cell));
                }
            }
```

Replace it with this implementation:

```javascript
            // 2. Build remaining objects using Zone Quotas
            const turf = window.turf || window.Turf;

            const placementOrder = [
                { type: 'castle',  count: counts.castle,  templatesList: castles },
                { type: 'vault',   count: counts.vault,   templatesList: vaults },
                { type: 'shop',    count: counts.shop,    templatesList: shops },
                { type: 'monster', count: counts.monster, templatesList: monsters }
            ];

            // Build a flat, shuffled pool of all objects to place
            const objectPool = [];
            for (const { type, count, templatesList } of placementOrder) {
                if (!templatesList || templatesList.length === 0) continue;
                for (let j = 0; j < count; j++) {
                    const template = getRandomTemplate(templatesList);
                    if (template) objectPool.push({ type, template });
                }
            }
            objectPool.sort(() => Math.random() - 0.5);

            const buildObject = (type, template, lat, lng) => {
                const obj = {
                    id: `${city.id}_${type}_${Math.random().toString(36).substring(2, 9)}`,
                    type, templateId: template.id, name: template.name, icon: template.icon,
                    lat, lng, cityId: city.id, spawnedAt: Date.now()
                };
                if (type === 'monster') {
                    obj.level = template.level || 1; obj.hp = template.hp || 20; obj.maxHp = template.maxHp || 20;
                    obj.damage = template.damage || 5; obj.defense = template.defense || 0;
                    obj.xpReward = template.xpReward || 10; obj.goldReward = template.goldReward || 5;
                } else if (type === 'shop') {
                    obj.shopType = template.name; obj.inventory = template.inventory || [];
                }
                return obj;
            };

            const zones = (zonesGeoJson && zonesGeoJson.features) ? zonesGeoJson.features : [];
            
            if (zones.length > 0 && turf) {
                const quotaPerZone = Math.ceil(objectPool.length / zones.length);
                
                for (const zone of zones) {
                    const bbox = turf.bbox(zone);
                    let placedInThisZone = 0;
                    let attempts = 0;
                    
                    while (placedInThisZone < quotaPerZone && objectPool.length > 0 && attempts < 10000) {
                        attempts++;
                        const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
                        const lng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
                        
                        if (turf.booleanPointInPolygon([lng, lat], zone)) {
                            const { type, template } = objectPool.pop();
                            cityObjects.push(buildObject(type, template, lat, lng));
                            placedInThisZone++;
                        }
                    }
                }
            }

            // Fallback for any remaining objects (if no zones or leftover rounding)
            const radiusMeters = 9000;
            let fallbackAttempts = 0;
            while (objectPool.length > 0 && fallbackAttempts < 10000) {
                fallbackAttempts++;
                const { type, template } = objectPool.pop();
                let randomAngle = Math.random() * Math.PI * 2;
                let randomDist = Math.random() * radiusMeters;
                const lat = city.lat + (randomDist / 111320) * Math.cos(randomAngle);
                const lng = city.lng + (randomDist / (111320 * Math.cos(city.lat * Math.PI / 180))) * Math.sin(randomAngle);
                
                if (cityBoundary && turf) {
                    try {
                        if (!turf.booleanPointInPolygon([lng, lat], cityBoundary)) {
                            objectPool.push({ type, template });
                            continue;
                        }
                    } catch(e) {}
                }
                cityObjects.push(buildObject(type, template, lat, lng));
            }
```

*Be absolutely sure to remove `buildCityGrid`, `pickCell`, `zoneCells`, etc. They are completely replaced.*

- [ ] **Step 3: Run the test to verify it passes**

Run: `grep -n "buildCityGrid" www/maintenance/admin-world.js`
Expected: No results.

- [ ] **Step 4: Commit**

```bash
git add www/maintenance/admin-world.js
git commit -m "feat: replace global grid with strict zone-based quota distribution"
```

---

### Task 3: Clean up unused grid functions

**Files:**
- Modify: `www/maintenance/admin-world.js`

- [ ] **Step 1: Write the failing test**

Run: `grep -n "function buildCityGrid" www/maintenance/admin-world.js`
Expected: Results showing the function definition.

- [ ] **Step 2: Delete unused functions**

In `www/maintenance/admin-world.js`, delete the following functions as they are no longer used by anything:
- `haversineMeters`
- `metresToLatDeg`
- `metresToLngDeg`
- `buildCityGrid`
- `ENTITY_RING_PREFERENCE`

- [ ] **Step 3: Run the test to verify it passes**

Run: `grep -n "function buildCityGrid" www/maintenance/admin-world.js`
Expected: No results.

- [ ] **Step 4: Commit**

```bash
git add www/maintenance/admin-world.js
git commit -m "refactor: remove unused grid generation functions"
```
