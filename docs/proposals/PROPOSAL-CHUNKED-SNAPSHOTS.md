# Proposal: Chunked Snapshot Architecture

**Status:** Approved (design reviewed)
**Author:** System Architect + User
**Scope:** `www/firebase/snapshot-service.js` (new), `www/gameplay/data.js` (population field)

---

## 1. Problem

World snapshots contain zones, citadels, monsters, shops, vaults, and castles. A single Firestore document has a 1MB limit. For large cities (Berlin: ~2,000 objects, ~890KB), a single document is insufficient. The system needs an algorithm to split snapshots into parts and reassemble them on load.

## 2. Overview of Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Chunk key | By city with auto-split at 800KB |
| 2 | Firestore structure | Flat subcollection `chunks/` + manifest in metadata |
| 3 | Internal chunk structure | Separate arrays per type (`zones`, `citadels`, `shops`, `vaults`, `castles`, `monsters`) |
| 4 | Packing priority | zones - citadels - shops - vaults - castles - monsters |
| 5 | Castles | Separate array, second overflow candidate after monsters |
| 6 | Size estimation | Pre-calculate `JSON.stringify().length` per object, sum incrementally |
| 7 | Zone storage | Zones IN snapshot; written to `city_zones/{cityId}` on activation |
| 8 | Population source | Hardcoded `population` field in `CITY_ANCHORS` |
| 9 | Overflow order | Monsters overflow first, then castles if needed |
| 10 | Client loading | Progressive: part0 immediately, rest background |
| 11 | Backward compat | New format only (v3). Old snapshots deprecated/read-only |
| 12 | Manifest detail | Full manifest with `partMap` (counts per type per part) |
| 13 | Activation target | All objects to `spawned_objects`, zones to `city_zones/` |
| 14 | IndexedDB caching | No caching of chunks (players read `spawned_objects`, not chunks) |
| 15 | Error handling | Idempotent activation with `activating` status |
| 16 | Deactivation | Tag-and-replace via `snapshotId` field on each object |
| 17 | Code location | New file `www/firebase/snapshot-service.js` |
| 18 | Batch writes | Parallel with concurrency limit of 4 |

---

## 3. Object Generation Ratios

Objects per city scale by population:

| Type | Ratio (people/object) | Berlin (3.7M) | Kyiv (3M) | Warsaw (1.8M) | Vienna (1.9M) | Prague (1.3M) | Lviv (720K) |
|------|-----------------------|---------------|-----------|---------------|---------------|---------------|-------------|
| Monsters | 4,000 | 925 | 750 | 450 | 475 | 325 | 180 |
| Castles | 5,000 | 740 | 600 | 360 | 380 | 260 | 144 |
| Shops | 16,000 | 231 | 188 | 113 | 119 | 81 | 45 |
| Vaults | 34,783 | 106 | 86 | 52 | 55 | 37 | 21 |
| Citadels | 190,476 | 19 | 16 | 9 | 10 | 7 | 4 |
| **Total** | | **2,021** | **1,640** | **984** | **1,039** | **710** | **394** |

Formula: `count = Math.round(population / ratio)`

### Data Change: `CITY_ANCHORS` in `www/gameplay/data.js`

Add `population` field to each entry:

    { id: "berlin", name: "Berlin", lat: 52.52, lng: 13.405, population: 3_700_000 },
    { id: "kyiv",   name: "Kyiv",   lat: 50.4501, lng: 30.5234, population: 3_000_000 },
    { id: "lviv",   name: "Lviv",   lat: 49.8397, lng: 24.0297, population: 720_000 },
    { id: "warsaw", name: "Warsaw", lat: 52.2297, lng: 21.0122, population: 1_800_000 },
    { id: "prague", name: "Prague", lat: 50.0755, lng: 14.4378, population: 1_300_000 },
    { id: "vienna", name: "Vienna", lat: 48.2082, lng: 16.3738, population: 1_900_000 },

### Generation Ratios Constant (in `snapshot-service.js`)

    GENERATION_RATIOS = {
      monsters:  4_000,
      castles:   5_000,
      shops:    16_000,
      vaults:   34_783,
      citadels: 190_476,
    }

---

## 4. Firestore Document Structure

### 4.1 Metadata Document: `world_snapshots/{snapshotId}`

    {
      "name": "Global World v3",
      "seed": 1847293651,
      "version": 3,
      "status": "inactive",             // "inactive" | "activating" | "active"
      "totalObjects": 6788,
      "totalCities": 6,
      "manifest": {
        "berlin": {
          "parts": ["berlin_p0", "berlin_p1"],
          "counts": {
            "zones": 19, "citadels": 19, "shops": 231,
            "vaults": 106, "castles": 740, "monsters": 925
          },
          "partMap": {
            "berlin_p0": {
              "zones": 19, "citadels": 19, "shops": 231,
              "vaults": 106, "castles": 740, "monsters": 580
            },
            "berlin_p1": { "monsters": 345 }
          }
        },
        "kyiv": {
          "parts": ["kyiv_p0"],
          "counts": {
            "zones": 16, "citadels": 16, "shops": 188,
            "vaults": 86, "castles": 600, "monsters": 750
          },
          "partMap": {
            "kyiv_p0": {
              "zones": 16, "citadels": 16, "shops": 188,
              "vaults": 86, "castles": 600, "monsters": 750
            }
          }
        }
      },
      "createdAt": "<serverTimestamp>",
      "createdBy": "admin@fightcraft.com"
    }

### 4.2 Chunk Document: `world_snapshots/{snapshotId}/chunks/{cityId_pN}`

Part0 (skeleton + overflow start):

    {
      "cityId": "berlin",
      "partIndex": 0,
      "zones": "...(stringified GeoJSON FeatureCollection)...",
      "citadels": [ { "id": "berlin_citadel_0", "lat": 52.51, "lng": 13.38, ... } ],
      "shops":    [ { "id": "berlin_shop_0", "templateId": "blacksmith_1", ... } ],
      "vaults":   [ { "id": "berlin_vault_0", ... } ],
      "castles":  [ { "id": "berlin_castle_0", "type": "tower", ... } ],
      "monsters": [ { "id": "berlin_monster_0", "templateId": "goblin_3", ... } ]
    }

Overflow chunks (partIndex > 0) contain only the overflowed type(s):

    {
      "cityId": "berlin",
      "partIndex": 1,
      "monsters": [ { "id": "berlin_monster_580", ... }, ... ]
    }

---

## 5. Split Algorithm

### 5.1 Packing Priority

The "skeleton" of a city is packed first into part0:

    Priority: zones -> citadels -> shops -> vaults -> castles -> monsters
              ----------- skeleton ----------------   -- overflow candidates --

- **Zones, citadels, shops, vaults** always in part0 (small, essential for map rendering)
- **Castles** in part0 if they fit; overflow to part1 if not
- **Monsters** fill remainder of part0; overflow to part1, part2, ...

### 5.2 Algorithm Pseudocode

    CONST CHUNK_SIZE_LIMIT = 800_000  // bytes, safety margin under 1MB

    function splitCityIntoChunks(cityId, data):
        // data = { zones, citadels, shops, vaults, castles, monsters }

        // Step 1: Pre-calculate skeleton size
        skeletonTypes = ['zones', 'citadels', 'shops', 'vaults']
        overflowTypes = ['castles', 'monsters']  // in priority order

        skeleton = {}
        skeletonSize = DOCUMENT_OVERHEAD  // ~500 bytes for wrapper

        for type in skeletonTypes:
            serialized = JSON.stringify(data[type])
            skeleton[type] = data[type]
            skeletonSize += serialized.length

        if skeletonSize > CHUNK_SIZE_LIMIT:
            ERROR: "City skeleton alone exceeds limit"

        // Step 2: Pack overflow types into remaining budget
        currentPart = { ...skeleton, cityId, partIndex: 0 }
        currentPartSize = skeletonSize
        parts = []

        for type in overflowTypes:
            items = data[type]
            itemSizes = items.map(obj => ({ obj, size: JSON.stringify(obj).length }))

            for { obj, size } in itemSizes:
                if currentPartSize + size > CHUNK_SIZE_LIMIT:
                    // Flush current part
                    parts.push(currentPart)
                    // Start new part (no skeleton)
                    currentPart = { cityId, partIndex: parts.length }
                    currentPartSize = DOCUMENT_OVERHEAD

                // Add object to current part
                currentPart[type] = currentPart[type] || []
                currentPart[type].push(obj)
                currentPartSize += size

        // Flush last part
        parts.push(currentPart)

        // Step 3: Build partMap
        partMap = {}
        for part in parts:
            key = cityId + "_p" + part.partIndex
            partMap[key] = {}
            for type in ALL_TYPES:
                if part[type]:
                    count = Array.isArray(part[type]) ? part[type].length : 1
                    partMap[key][type] = count

        return { parts, partMap }

### 5.3 Size Estimates (Berlin worst case)

| Type | Count | ~Bytes/obj | ~Total KB |
|------|-------|------------|-----------|
| Zones (GeoJSON) | 19 | ~3,000 | **57** |
| Citadels | 19 | ~400 | **8** |
| Shops | 231 | ~350 | **81** |
| Vaults | 106 | ~300 | **32** |
| Castles | 740 | ~400 | **296** |
| Monsters | 925 | ~450 | **416** |
| **Total** | | | **~890 KB** |

Skeleton (zones+citadels+shops+vaults) = ~178 KB
Remaining budget for part0 = ~622 KB
Castles (296 KB) fit in part0 -> part0 now ~474 KB
Monsters: ~580 fit in part0 (remaining ~326 KB), ~345 overflow to part1

**Result: Berlin = 2 chunks. All other cities = 1 chunk.**

---

## 6. Save Flow (Admin)

    saveChunkedSnapshot(metadata, objectsByCity):
      1. For each city in objectsByCity:
         a. splitCityIntoChunks(cityId, cityData) -> parts[] + partMap
         b. Accumulate into global manifest

      2. Write metadata document:
         world_snapshots/{id} <- { name, seed, version: 3, status: "inactive", manifest, ... }

      3. Write chunk documents in batches (limit 450 ops per batch):
         For each part -> setDoc(world_snapshots/{id}/chunks/{cityId_pN}, partData)

      4. Return success

---

## 7. Activation Flow

    activateSnapshot(snapshotId):
      1. Read metadata (1 read) -> manifest, validate version === 3
      2. Set status = "activating" (1 write)
      3. Deactivate previous snapshot: set old status = "inactive" (1 write)

      4. For each city in manifest:
         a. Load all parts for city: Promise.all(parts.map(loadChunk))
         b. Extract zones -> saveCityZones(cityId, zonesGeoJSON)
         c. Merge all objects (citadels + shops + vaults + castles + monsters)
         d. Tag each object: { ...obj, snapshotId }
         e. Batch write to spawned_objects (setDoc per object, 500 ops/batch)
            -> parallel batches with concurrency limit = 4

      5. Cleanup: delete spawned_objects where snapshotId !== current (background)
      6. Set status = "active" (1 write)

### 7.1 Idempotency

- All objects have stable IDs from generation (seed-based)
- `setDoc` = upsert. Re-running activation overwrites with same data
- `status: "activating"` allows admin to see incomplete state and retry
- Cleanup only deletes objects with mismatched `snapshotId`

### 7.2 Batch Write Strategy

    writeBatchesWithLimit(batches, concurrency = 4):
      for i = 0 to batches.length step concurrency:
        slice = batches[i : i + concurrency]
        await Promise.all(slice.map(b => b.commit()))
        onProgress(i / batches.length)

Total for all 6 cities: ~6,788 objects -> ~14 batches -> ~4 rounds of 4 -> ~3-4 seconds.

---

## 8. Progressive Client Loading

Players never read chunks directly. At activation, chunks are unpacked into `spawned_objects` + `city_zones`. The existing SyncEngine caches `spawned_objects` in IndexedDB.

The "progressive" aspect applies to the **activation** process itself:
1. Part0 of each city is loaded and written first (skeleton + partial monsters)
2. Part1+ (overflow monsters) are loaded and written in background
3. Admin UI shows progress: "Activating Berlin... (2/6 cities)"

---

## 9. Deactivation: Tag and Replace

Every object written to `spawned_objects` includes a `snapshotId` field:

    { "id": "berlin_monster_42", "snapshotId": "snap_1717000000", "type": "monster", ... }

On activation of a new snapshot:
1. New objects are written with `snapshotId = newId`
2. Background cleanup queries `spawned_objects` where `snapshotId !== newId` and deletes in batches of 500
3. Players see a brief overlap period (~seconds), then old objects disappear

---

## 10. File Structure

### New File: `www/firebase/snapshot-service.js`

Exports:
- `GENERATION_RATIOS` - object counts per population
- `calculateCityCounts(population)` - returns { monsters, castles, shops, vaults, citadels }
- `splitCityIntoChunks(cityId, data)` - returns { parts, partMap, counts }
- `saveChunkedSnapshot(metadata, objectsByCity)` - writes metadata + chunks to Firestore
- `loadChunkedSnapshot(snapshotId)` - reads metadata + all chunks
- `loadCityChunks(snapshotId, cityId)` - reads chunks for one city
- `activateSnapshot(snapshotId, onProgress)` - full activation pipeline
- `cleanupOldSnapshotObjects(excludeSnapshotId)` - background batch delete

Imports from `firebase-service.js`:
- `db`, `isAdmin()`, `trackUsage()`, `currentUser`, `saveCityZones()`

### Modified: `www/gameplay/data.js`

- Add `population` field to each entry in `CITY_ANCHORS`

---

## 11. Constants

    CHUNK_SIZE_LIMIT = 800_000       // bytes (safety margin under 1MB)
    DOCUMENT_OVERHEAD = 500          // bytes for Firestore doc wrapper
    BATCH_OP_LIMIT = 450             // ops per batch (safety margin under 500)
    ACTIVATION_CONCURRENCY = 4       // parallel batch commits
    PACKING_PRIORITY = ['zones', 'citadels', 'shops', 'vaults', 'castles', 'monsters']
    SKELETON_TYPES = ['zones', 'citadels', 'shops', 'vaults']
    OVERFLOW_TYPES = ['castles', 'monsters']

---

## 12. Migration Notes

- **Old snapshots** (v1 flat, v2 country-chunked) are not migrated. They remain read-only in admin UI.
- **New generation** always produces v3 chunked-by-city format.
- **`saveWorldSnapshot()`** and **`saveWorldSnapshotChunked()`** in `firebase-service.js` are deprecated but not removed.
- **`city_zones/{cityId}`** remains the runtime source for zones. Snapshots write to it on activation.
- **`spawned_objects`** remains the runtime source for all game objects. Snapshots write to it on activation.
