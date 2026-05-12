// Snapshot Service — Chunked Snapshot Architecture (v3)
// Splits world snapshots by city with auto-split at 800KB per chunk.
// See docs/proposals/PROPOSAL-CHUNKED-SNAPSHOTS.md for design decisions.

import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getDB,
  isAdmin,
  trackUsage,
  getCurrentUser,
  saveCityZones,
} from "./firebase-service.js";

// ==================== CONSTANTS ====================

export const CHUNK_SIZE_LIMIT = 800_000; // bytes — safety margin under 1MB
export const DOCUMENT_OVERHEAD = 500; // bytes for Firestore doc wrapper fields
export const BATCH_OP_LIMIT = 450; // ops per batch (safety margin under 500)
export const ACTIVATION_CONCURRENCY = 4; // parallel batch commits
export const SNAPSHOT_VERSION = 3;

export const PACKING_PRIORITY = [
  "zones",
  "citadels",
  "shops",
  "vaults",
  "castles",
  "monsters",
];
export const SKELETON_TYPES = ["zones", "citadels", "shops", "vaults"];
export const OVERFLOW_TYPES = ["castles", "monsters"];

/** Object counts per population — people per one object of this type */
export const GENERATION_RATIOS = {
  monsters: 4_000,
  castles: 5_000,
  shops: 16_000,
  vaults: 34_783,
  citadels: 190_476,
};

// ==================== GENERATION RATIOS ====================

/**
 * Calculate how many objects of each type a city should have based on population.
 * @param {number} population — city population
 * @returns {{ monsters: number, castles: number, shops: number, vaults: number, citadels: number }}
 */
export function calculateCityCounts(population) {
  const counts = {};
  for (const [type, ratio] of Object.entries(GENERATION_RATIOS)) {
    counts[type] = Math.round(population / ratio);
  }
  return counts;
}

// ==================== SPLIT ALGORITHM ====================

/**
 * Estimate the byte size of a value when stored in Firestore.
 * Uses JSON.stringify length as an approximation.
 * @param {*} value
 * @returns {number}
 */
function estimateSize(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

/**
 * Split a city's generated data into Firestore-safe chunks (< 800KB each).
 *
 * Packing priority: zones -> citadels -> shops -> vaults -> castles -> monsters
 * Skeleton types (zones..vaults) always go into part0.
 * Overflow candidates (castles, monsters) spill into part1, part2, etc.
 *
 * @param {string} cityId
 * @param {{ zones: *, citadels: Array, shops: Array, vaults: Array, castles: Array, monsters: Array }} data
 * @returns {{ parts: Array<object>, partMap: object, counts: object }}
 */
export function splitCityIntoChunks(cityId, data) {
  // Step 1: Build skeleton (always fits in part0)
  const skeleton = {};
  let skeletonSize = DOCUMENT_OVERHEAD;

  for (const type of SKELETON_TYPES) {
    const items = data[type];
    if (items != null) {
      skeleton[type] = items;
      skeletonSize += estimateSize(items);
    }
  }

  if (skeletonSize > CHUNK_SIZE_LIMIT) {
    throw new Error(
      `City "${cityId}" skeleton alone is ${(skeletonSize / 1024).toFixed(1)}KB — exceeds ${(CHUNK_SIZE_LIMIT / 1024).toFixed(0)}KB limit`,
    );
  }

  // Step 2: Pack overflow types into remaining budget
  let currentPart = { ...skeleton, cityId, partIndex: 0 };
  let currentPartSize = skeletonSize;
  const parts = [];

  for (const type of OVERFLOW_TYPES) {
    const items = data[type];
    if (!items || !items.length) continue;

    for (const obj of items) {
      const objSize = estimateSize(obj) + 2; // +2 for comma + bracket overhead

      if (currentPartSize + objSize > CHUNK_SIZE_LIMIT) {
        // Flush current part, start a new one
        parts.push(currentPart);
        currentPart = { cityId, partIndex: parts.length };
        currentPartSize = DOCUMENT_OVERHEAD;
      }

      if (!currentPart[type]) currentPart[type] = [];
      currentPart[type].push(obj);
      currentPartSize += objSize;
    }
  }

  // Flush last part
  parts.push(currentPart);

  // Step 3: Build counts and partMap
  const allTypes = [...SKELETON_TYPES, ...OVERFLOW_TYPES];
  const counts = {};
  const partMap = {};

  for (const type of allTypes) {
    counts[type] = 0;
  }

  for (const part of parts) {
    const key = `${cityId}_p${part.partIndex}`;
    partMap[key] = {};

    for (const type of allTypes) {
      if (part[type] != null) {
        const count = Array.isArray(part[type]) ? part[type].length : 1;
        partMap[key][type] = count;
        counts[type] += count;
      }
    }
  }

  return { parts, partMap, counts };
}

// ==================== SAVE ====================

/**
 * Save a v3 chunked world snapshot to Firestore.
 *
 * Writes:
 * - `world_snapshots/{snapshotId}` — metadata + manifest
 * - `world_snapshots/{snapshotId}/chunks/{cityId_pN}` — chunk documents
 *
 * @param {{ id?: string, name?: string, seed?: number }} metadata
 * @param {Record<string, { zones: *, citadels: Array, shops: Array, vaults: Array, castles: Array, monsters: Array }>} objectsByCity
 * @param {(msg: string) => void} [onProgress] — optional progress callback
 * @returns {Promise<string|false>} — snapshot ID on success, false on failure
 */
export async function saveChunkedSnapshot(metadata, objectsByCity, onProgress) {
  if (!isAdmin()) return false;

  const db = getDB();
  if (!db) {
    console.error("snapshot-service: Firestore not initialized");
    return false;
  }

  try {
    const id = metadata.id || `snap_${Date.now()}`;
    const cities = Object.keys(objectsByCity);
    const manifest = {};
    const allParts = []; // { docId, data }
    let totalObjects = 0;

    // Step 1: Split each city into chunks
    for (const cityId of cities) {
      const cityData = objectsByCity[cityId];
      const { parts, partMap, counts } = splitCityIntoChunks(cityId, cityData);

      const partIds = parts.map((p) => `${cityId}_p${p.partIndex}`);

      manifest[cityId] = { parts: partIds, counts, partMap };

      for (const part of parts) {
        allParts.push({
          docId: `${cityId}_p${part.partIndex}`,
          data: part,
        });
      }

      const cityTotal = Object.values(counts).reduce((s, n) => s + n, 0);
      totalObjects += cityTotal;

      if (onProgress) {
        onProgress(
          `Split ${cityId}: ${parts.length} chunk(s), ${cityTotal} objects`,
        );
      }
    }

    // Step 2: Write metadata document
    const user = getCurrentUser();
    const metaDoc = {
      name: metadata.name || "World Snapshot v3",
      seed: metadata.seed || Math.floor(Math.random() * 2_147_483_647),
      version: SNAPSHOT_VERSION,
      status: "inactive",
      totalObjects,
      totalCities: cities.length,
      manifest,
      createdAt: serverTimestamp(),
      createdBy: user && user.email ? user.email : "admin@fightcraft.com",
    };

    await setDoc(doc(db, "world_snapshots", id), metaDoc);
    trackUsage(
      "write",
      `[admin] [v3 snapshot meta: ${id}]`,
      1,
      `world_snapshots/${id}`,
    );

    if (onProgress)
      onProgress(`Metadata saved. Writing ${allParts.length} chunk(s)...`);

    // Step 3: Write chunks in batches (max BATCH_OP_LIMIT ops per batch)
    const batches = [];
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const { docId, data } of allParts) {
      const chunkRef = doc(
        collection(db, "world_snapshots", id, "chunks"),
        docId,
      );
      batch.set(chunkRef, data);
      opsInBatch++;

      if (opsInBatch >= BATCH_OP_LIMIT) {
        batches.push(batch);
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) batches.push(batch);

    // Commit batches with concurrency limit
    await commitBatchesWithLimit(batches, ACTIVATION_CONCURRENCY);

    trackUsage(
      "write",
      `[admin] [v3 snapshot chunks: ${id}]`,
      allParts.length,
      `world_snapshots/${id}/chunks/*`,
    );

    console.log(
      `Chunked snapshot saved: ${id} (${totalObjects} objects, ${allParts.length} chunks)`,
    );
    localStorage.removeItem("admin_snapshots_list");

    if (onProgress) onProgress(`Snapshot ${id} saved successfully`);
    return id;
  } catch (e) {
    console.error("Chunked snapshot save error:", e);
    return false;
  }
}

// ==================== LOAD ====================

/**
 * Load a chunked snapshot: metadata + all chunks from all cities.
 * @param {string} snapshotId
 * @returns {Promise<{ metadata: object, objectsByCity: Record<string, object> } | null>}
 */
export async function loadChunkedSnapshot(snapshotId) {
  const db = getDB();
  if (!db) return null;

  try {
    // Read metadata
    const metaSnap = await getDoc(doc(db, "world_snapshots", snapshotId));
    if (!metaSnap.exists()) {
      console.error(`Snapshot ${snapshotId} not found`);
      return null;
    }
    trackUsage(
      "read",
      `[snapshot meta: ${snapshotId}]`,
      1,
      `world_snapshots/${snapshotId}`,
    );

    const metadata = metaSnap.data();
    if (metadata.version !== SNAPSHOT_VERSION) {
      console.warn(
        `Snapshot ${snapshotId} is version ${metadata.version}, expected ${SNAPSHOT_VERSION}`,
      );
    }

    // Read all chunks
    const chunksSnap = await getDocs(
      collection(db, "world_snapshots", snapshotId, "chunks"),
    );
    trackUsage(
      "read",
      `[snapshot chunks: ${snapshotId}]`,
      chunksSnap.size,
      `world_snapshots/${snapshotId}/chunks`,
    );

    // Group chunks by city
    const objectsByCity = {};
    for (const chunkDoc of chunksSnap.docs) {
      const data = chunkDoc.data();
      const cityId = data.cityId;

      if (!objectsByCity[cityId]) {
        objectsByCity[cityId] = {
          zones: null,
          citadels: [],
          shops: [],
          vaults: [],
          castles: [],
          monsters: [],
        };
      }

      const city = objectsByCity[cityId];

      // Zones: only in part0 (non-array, take as-is)
      if (data.zones != null && city.zones == null) {
        city.zones = data.zones;
      }
      // Array types: merge from all parts
      for (const type of [
        "citadels",
        "shops",
        "vaults",
        "castles",
        "monsters",
      ]) {
        if (Array.isArray(data[type])) {
          city[type].push(...data[type]);
        }
      }
    }

    return { metadata, objectsByCity };
  } catch (e) {
    console.error("loadChunkedSnapshot error:", e);
    return null;
  }
}

/**
 * Load chunks for a single city from a snapshot.
 * @param {string} snapshotId
 * @param {string} cityId
 * @returns {Promise<{ zones: *, citadels: Array, shops: Array, vaults: Array, castles: Array, monsters: Array } | null>}
 */
export async function loadCityChunks(snapshotId, cityId) {
  const db = getDB();
  if (!db) return null;

  try {
    // First read manifest to know part IDs
    const metaSnap = await getDoc(doc(db, "world_snapshots", snapshotId));
    if (!metaSnap.exists()) return null;
    trackUsage(
      "read",
      `[snapshot meta for city: ${snapshotId}]`,
      1,
      `world_snapshots/${snapshotId}`,
    );

    const metadata = metaSnap.data();
    const cityManifest = metadata.manifest && metadata.manifest[cityId];
    if (!cityManifest) {
      console.warn(`City ${cityId} not found in snapshot ${snapshotId}`);
      return null;
    }

    // Load all parts for this city in parallel
    const partIds = cityManifest.parts;
    const partPromises = partIds.map((partId) =>
      getDoc(doc(db, "world_snapshots", snapshotId, "chunks", partId)),
    );
    const partSnaps = await Promise.all(partPromises);
    trackUsage(
      "read",
      `[snapshot city chunks: ${cityId}]`,
      partIds.length,
      `world_snapshots/${snapshotId}/chunks`,
    );

    // Merge all parts
    const result = {
      zones: null,
      citadels: [],
      shops: [],
      vaults: [],
      castles: [],
      monsters: [],
    };
    for (const snap of partSnaps) {
      if (!snap.exists()) continue;
      const data = snap.data();

      if (data.zones != null && result.zones == null) {
        result.zones = data.zones;
      }
      for (const type of [
        "citadels",
        "shops",
        "vaults",
        "castles",
        "monsters",
      ]) {
        if (Array.isArray(data[type])) {
          result[type].push(...data[type]);
        }
      }
    }

    return result;
  } catch (e) {
    console.error(`loadCityChunks error (${cityId}):`, e);
    return null;
  }
}

// ==================== ACTIVATION ====================

/**
 * Activate a v3 chunked snapshot:
 * 1. Validate + set status = "activating"
 * 2. Deactivate previous active snapshot
 * 3. For each city: load chunks -> write zones to city_zones -> write objects to spawned_objects
 * 4. Cleanup old snapshot objects (background)
 * 5. Set status = "active"
 *
 * @param {string} snapshotId
 * @param {(msg: string, progress?: number) => void} [onProgress]
 * @returns {Promise<boolean>}
 */
export async function activateSnapshot(snapshotId, onProgress) {
  if (!isAdmin()) return false;

  const db = getDB();
  if (!db) return false;

  const progress = onProgress || (() => {});

  try {
    // Step 1: Read metadata and validate
    progress("Loading snapshot metadata...", 0);
    const metaRef = doc(db, "world_snapshots", snapshotId);
    const metaSnap = await getDoc(metaRef);

    if (!metaSnap.exists()) {
      console.error(`Snapshot ${snapshotId} not found`);
      return false;
    }
    trackUsage(
      "read",
      `[activate] snapshot meta: ${snapshotId}`,
      1,
      `world_snapshots/${snapshotId}`,
    );

    const metadata = metaSnap.data();
    if (metadata.version !== SNAPSHOT_VERSION) {
      console.error(
        `Cannot activate: version ${metadata.version}, expected ${SNAPSHOT_VERSION}`,
      );
      return false;
    }

    if (metadata.status === "active") {
      console.warn(`Snapshot ${snapshotId} is already active`);
      return true;
    }

    // Step 2: Set status = "activating"
    await updateDoc(metaRef, { status: "activating" });
    trackUsage(
      "write",
      `[activate] status=activating: ${snapshotId}`,
      1,
      `world_snapshots/${snapshotId}`,
    );
    progress("Status: activating", 0.05);

    // Step 3: Deactivate any currently active snapshot
    await deactivatePreviousSnapshot(snapshotId);
    progress("Previous snapshot deactivated", 0.1);

    // Step 4: Process each city
    const manifest = metadata.manifest;
    const cityIds = Object.keys(manifest);
    let citiesProcessed = 0;

    for (const cityId of cityIds) {
      const cityProgress = 0.1 + (0.8 * citiesProcessed) / cityIds.length;
      progress(`Loading chunks for ${cityId}...`, cityProgress);

      // Load all chunks for this city
      const cityManifest = manifest[cityId];
      const partPromises = cityManifest.parts.map((partId) =>
        getDoc(doc(db, "world_snapshots", snapshotId, "chunks", partId)),
      );
      const partSnaps = await Promise.all(partPromises);
      trackUsage(
        "read",
        `[activate] city chunks: ${cityId}`,
        cityManifest.parts.length,
        `world_snapshots/${snapshotId}/chunks`,
      );

      // Merge chunks
      let zones = null;
      const allObjects = [];

      for (const snap of partSnaps) {
        if (!snap.exists()) continue;
        const data = snap.data();

        // Extract zones (only in part0)
        if (data.zones != null && zones == null) {
          zones = data.zones;
        }

        // Collect all game objects
        for (const type of [
          "citadels",
          "shops",
          "vaults",
          "castles",
          "monsters",
        ]) {
          if (Array.isArray(data[type])) {
            for (const obj of data[type]) {
              allObjects.push({ ...obj, objectType: type, snapshotId });
            }
          }
        }
      }

      // Write zones to city_zones/{cityId}
      if (zones != null) {
        progress(`Writing zones for ${cityId}...`, cityProgress + 0.02);
        await saveCityZones(cityId, zones);
      }

      // Write objects to spawned_objects in batches
      if (allObjects.length > 0) {
        progress(
          `Writing ${allObjects.length} objects for ${cityId}...`,
          cityProgress + 0.04,
        );
        await writeObjectsToSpawnedObjects(db, allObjects, snapshotId);
      }

      citiesProcessed++;
      progress(
        `${cityId} done (${allObjects.length} objects)`,
        0.1 + (0.8 * citiesProcessed) / cityIds.length,
      );
    }

    // Step 5: Background cleanup of old snapshot objects
    progress("Cleaning up old snapshot objects...", 0.92);
    await cleanupOldSnapshotObjects(snapshotId);

    // Step 6: Set status = "active"
    await updateDoc(metaRef, { status: "active" });
    trackUsage(
      "write",
      `[activate] status=active: ${snapshotId}`,
      1,
      `world_snapshots/${snapshotId}`,
    );

    progress(`Snapshot ${snapshotId} activated successfully`, 1.0);
    console.log(
      `Snapshot ${snapshotId} activated: ${metadata.totalObjects} objects across ${cityIds.length} cities`,
    );
    return true;
  } catch (e) {
    console.error("activateSnapshot error:", e);
    progress(`Activation failed: ${e.message}`, -1);

    // Try to reset status back so admin can retry
    try {
      await updateDoc(doc(db, "world_snapshots", snapshotId), {
        status: "inactive",
      });
    } catch (resetErr) {
      console.error("Could not reset status:", resetErr);
    }

    return false;
  }
}

// ==================== INTERNAL HELPERS ====================

/**
 * Write an array of objects to `spawned_objects` using setDoc (upsert).
 * Each object must have a stable `id` field.
 * Batches are committed with concurrency limit.
 *
 * @param {*} db — Firestore instance
 * @param {Array<object>} objects — objects with `id` and `snapshotId` fields
 * @param {string} snapshotId — for tracking
 */
async function writeObjectsToSpawnedObjects(db, objects, snapshotId) {
  const batches = [];
  let batch = writeBatch(db);
  let opsInBatch = 0;

  for (const obj of objects) {
    const objId = obj.id;
    if (!objId) {
      console.warn("Skipping object without id:", obj);
      continue;
    }

    const objRef = doc(db, "spawned_objects", objId);
    batch.set(objRef, {
      ...obj,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    opsInBatch++;

    if (opsInBatch >= BATCH_OP_LIMIT) {
      batches.push(batch);
      batch = writeBatch(db);
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) batches.push(batch);

  await commitBatchesWithLimit(batches, ACTIVATION_CONCURRENCY);

  trackUsage(
    "write",
    `[activate] spawned_objects for snapshot ${snapshotId}`,
    objects.length,
    "spawned_objects/*",
  );
}

/**
 * Deactivate any currently active snapshot (set its status to "inactive").
 * Does NOT delete its objects — that's done by tag-and-replace cleanup.
 *
 * @param {string} excludeSnapshotId — the snapshot being activated (skip it)
 */
async function deactivatePreviousSnapshot(excludeSnapshotId) {
  const db = getDB();
  if (!db) return;

  try {
    const q = query(
      collection(db, "world_snapshots"),
      where("status", "==", "active"),
    );
    const snap = await getDocs(q);
    trackUsage(
      "read",
      "[activate] find active snapshots",
      snap.size,
      "world_snapshots",
    );

    for (const snapDoc of snap.docs) {
      if (snapDoc.id === excludeSnapshotId) continue;
      await updateDoc(snapDoc.ref, { status: "inactive" });
      trackUsage(
        "write",
        `[activate] deactivate old: ${snapDoc.id}`,
        1,
        `world_snapshots/${snapDoc.id}`,
      );
      console.log(`Deactivated previous snapshot: ${snapDoc.id}`);
    }
  } catch (e) {
    console.error("Error deactivating previous snapshot:", e);
  }
}

/**
 * Delete spawned_objects that belong to an old snapshot.
 * Queries for objects where `snapshotId` exists and != excludeSnapshotId.
 * Deletes in batches of BATCH_OP_LIMIT.
 *
 * @param {string} excludeSnapshotId — keep objects with this snapshotId
 */
export async function cleanupOldSnapshotObjects(excludeSnapshotId) {
  const db = getDB();
  if (!db) return;

  try {
    // Query objects that have a snapshotId field but it's not the current one
    const q = query(
      collection(db, "spawned_objects"),
      where("snapshotId", "!=", excludeSnapshotId),
    );

    const snap = await getDocs(q);
    trackUsage(
      "read",
      "[cleanup] old snapshot objects",
      snap.size,
      "spawned_objects",
    );

    if (snap.empty) {
      console.log("No old snapshot objects to clean up");
      return;
    }

    console.log(`Cleaning up ${snap.size} old snapshot objects...`);

    const batches = [];
    let batch = writeBatch(db);
    let opsInBatch = 0;

    for (const objDoc of snap.docs) {
      batch.delete(objDoc.ref);
      opsInBatch++;

      if (opsInBatch >= BATCH_OP_LIMIT) {
        batches.push(batch);
        batch = writeBatch(db);
        opsInBatch = 0;
      }
    }
    if (opsInBatch > 0) batches.push(batch);

    await commitBatchesWithLimit(batches, ACTIVATION_CONCURRENCY);

    trackUsage(
      "delete",
      "[cleanup] old snapshot objects",
      snap.size,
      "spawned_objects/*",
    );
    console.log(`Cleaned up ${snap.size} old snapshot objects`);
  } catch (e) {
    console.error("cleanupOldSnapshotObjects error:", e);
  }
}

// ==================== ZONE CHUNKS ====================

/**
 * Save zone GeoJSON (FeatureCollection) as chunks in the snapshot's subcollection.
 * Splits features into parts that fit within the 800KB Firestore doc limit.
 *
 * Writes to: world_snapshots/{snapshotId}/zone_chunks/zones_p{N}
 * Updates metadata: zoneConfig.chunkCount, zoneConfig.totalFeatures
 *
 * @param {string} snapshotId
 * @param {object} zonesGeoJson — GeoJSON FeatureCollection
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<boolean>}
 */
export async function saveZoneChunks(snapshotId, zonesGeoJson, onProgress) {
  const db = getDB();
  if (!db) return false;

  try {
    const features = zonesGeoJson.features || [];
    if (features.length === 0) {
      console.warn("saveZoneChunks: no features to save");
      return false;
    }

    // Split features into chunks by size
    const chunks = []; // array of { partIndex, features[] }
    let currentFeatures = [];
    let currentSize = DOCUMENT_OVERHEAD;

    for (const feature of features) {
      const featureSize = JSON.stringify(feature).length + 2;

      if (
        currentSize + featureSize > CHUNK_SIZE_LIMIT &&
        currentFeatures.length > 0
      ) {
        chunks.push({ partIndex: chunks.length, features: currentFeatures });
        currentFeatures = [];
        currentSize = DOCUMENT_OVERHEAD;
      }

      currentFeatures.push(feature);
      currentSize += featureSize;
    }
    if (currentFeatures.length > 0) {
      chunks.push({ partIndex: chunks.length, features: currentFeatures });
    }

    if (onProgress)
      onProgress(
        `Splitting ${features.length} zones into ${chunks.length} chunk(s)...`,
      );

    // Write zone chunks sequentially to avoid overwhelming Firestore WebChannel.
    // Each chunk is ~800KB so parallel writes crash the transport.
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const docId = `zones_p${chunk.partIndex}`;
      const chunkRef = doc(
        collection(db, "world_snapshots", snapshotId, "zone_chunks"),
        docId,
      );

      await setDoc(chunkRef, {
        type: "zones",
        partIndex: chunk.partIndex,
        features: JSON.stringify(chunk.features),
        featureCount: chunk.features.length,
      });

      if (onProgress)
        onProgress(
          `Saving zone chunk ${i + 1}/${chunks.length} (${chunk.features.length} zones)...`,
        );
    }

    // Update metadata with zone info + remove old inline zones field
    const metaRef = doc(db, "world_snapshots", snapshotId);
    await updateDoc(metaRef, {
      zoneConfig: {
        generated: true,
        algorithm: "voronoi_clipped",
        chunkCount: chunks.length,
        totalFeatures: features.length,
      },
      zones: deleteField(), // remove old inline zones that crash WebChannel
    });

    trackUsage(
      "write",
      `[admin] zone chunks: ${snapshotId}`,
      chunks.length + 1,
      `world_snapshots/${snapshotId}/zone_chunks/*`,
    );

    console.log(
      `Zone chunks saved: ${chunks.length} chunk(s), ${features.length} features`,
    );
    if (onProgress)
      onProgress(
        `\u2705 \u0417\u043e\u043d\u0438 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0456 \u0432 \u0431\u0430\u0437\u0443 \u0434\u0430\u043d\u0438\u0445! ${chunks.length} chunk(s), ${features.length} features`,
      );
    return true;
  } catch (e) {
    console.error("saveZoneChunks error:", e);
    if (onProgress)
      onProgress(
        `\u274c \u041f\u043e\u043c\u0438\u043b\u043a\u0430 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043d\u044f \u0437\u043e\u043d: ${e.message}`,
      );
    return false;
  }
}

/**
 * Load zone GeoJSON from chunks in the snapshot's subcollection.
 * Reconstructs a FeatureCollection from zones_p0, zones_p1, etc.
 *
 * @param {string} snapshotId
 * @param {number} [chunkCount] — if known from zoneConfig, speeds up loading
 * @returns {Promise<object|null>} — GeoJSON FeatureCollection or null
 */
export async function loadZoneChunks(snapshotId, chunkCount) {
  const db = getDB();
  if (!db) return null;

  try {
    const allFeatures = [];

    if (chunkCount != null && chunkCount > 0) {
      // Load chunks sequentially — each is ~800KB, parallel kills WebChannel
      for (let i = 0; i < chunkCount; i++) {
        const partId = `zones_p${i}`;
        const snap = await getDoc(
          doc(db, "world_snapshots", snapshotId, "zone_chunks", partId),
        );
        if (!snap.exists()) continue;
        const data = snap.data();

        let features;
        if (typeof data.features === "string") {
          features = JSON.parse(data.features);
        } else {
          features = data.features;
        }
        if (Array.isArray(features)) {
          allFeatures.push(...features);
        }
      }
    } else {
      // Fallback: query all zone chunks from dedicated subcollection
      const chunksRef = collection(
        db,
        "world_snapshots",
        snapshotId,
        "zone_chunks",
      );
      const allDocs = await getDocs(chunksRef);

      // Sort by partIndex and extract features
      const sorted = [...allDocs.docs].sort((a, b) => {
        const idxA = a.data().partIndex || 0;
        const idxB = b.data().partIndex || 0;
        return idxA - idxB;
      });

      for (const snapDoc of sorted) {
        const data = snapDoc.data();
        let features;
        if (typeof data.features === "string") {
          features = JSON.parse(data.features);
        } else {
          features = data.features;
        }
        if (Array.isArray(features)) {
          allFeatures.push(...features);
        }
      }
    }

    trackUsage(
      "read",
      `[zones] load zone chunks: ${snapshotId}`,
      chunkCount || allFeatures.length,
      `world_snapshots/${snapshotId}/zone_chunks/*`,
    );

    if (allFeatures.length === 0) return null;

    console.log(`Zone chunks loaded: ${allFeatures.length} features`);
    return { type: "FeatureCollection", features: allFeatures };
  } catch (e) {
    console.error("loadZoneChunks error:", e);
    return null;
  }
}

// ==================== INTERNAL HELPERS ====================

/**
 * Commit an array of writeBatch instances with a concurrency limit.
 * @param {Array} batches — array of writeBatch objects
 * @param {number} concurrency — max parallel commits
 */
async function commitBatchesWithLimit(batches, concurrency) {
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    await Promise.all(slice.map((b) => b.commit()));
  }
}
