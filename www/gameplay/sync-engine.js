/**
 * Sync Engine - Optimizing Firestore Reads
 * Strategy: "Meta-Check" (1 Read) -> IndexedDB
 */

import { getStorageInstance } from "../firebase/firebase-service.js";

const DB_NAME = "FightCraftDB";
const DB_VERSION = 4;
const STORE_NAME = "spawned_objects";
const METADATA_STORE = "world_metadata";
const DEFEATED_STORE = "defeated_objects";

export const SyncEngine = {
  db: null,

  /**
   * Initialize IndexedDB
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log("✅ SyncEngine: IndexedDB initialized");
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for spawned objects (monsters, shops, etc.)
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, {
            keyPath: "id",
          });
          objectStore.createIndex("cityId", "cityId", { unique: false });
          objectStore.createIndex("type", "type", { unique: false });
          // We can create a spatial index if needed, but for now we'll filter in memory or specific key
        }

        // Store for metadata (timestamps)
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: "id" });
        }

        // Store for templates
        if (!db.objectStoreNames.contains("templates")) {
          const tStore = db.createObjectStore("templates", { keyPath: "id" });
          tStore.createIndex("type", "type", { unique: false });
        }

        // Store for city_zones
        if (!db.objectStoreNames.contains("city_zones")) {
          db.createObjectStore("city_zones", { keyPath: "id" }); // id = cityId
        }

        // Store for defeated procedural monsters (H3-cell-based cooldown tracking)
        if (!db.objectStoreNames.contains("defeated_objects")) {
          const defStore = db.createObjectStore("defeated_objects", {
            keyPath: "id",
          });
          defStore.createIndex("h3Index", "h3Index", { unique: false });
          defStore.createIndex("expiresAt", "expiresAt", { unique: false });
        }
      };
    });
  },

  /**
   * MAIN SYNC FUNCTION
   * 1. Check world_metadata/current_state in Firestore (1 Read)
   * 2. Compare with local IndexedDB timestamp
   * 3. If outdated -> Fetch ONLY deltas (or full reload if forced)
   * 4. If same -> Load from IndexedDB (0 Reads)
   */
  async syncWorld(firestoreDb) {
    if (!this.db) await this.init();

    console.log("🌍 SyncEngine: Starting World Sync...");
    const start = performance.now();

    try {
      const { doc } =
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const { monitoredGetDoc, monitoredGetDocs } =
        await import("../firebase/firebase-monitor.js");

      // 1. Meta-Check (The ONLY mandatory read)
      const metaRef = doc(firestoreDb, "world_metadata", "current_state");
      const metaSnap = await monitoredGetDoc(
        metaRef,
        "world_metadata/current_state (SyncEngine Check)",
      );

      if (!metaSnap.exists()) {
        console.warn(
          "⚠️ SyncEngine: 'world_metadata/current_state' NOT FOUND. Falling back to full legacy load.",
        );
        return await this.fallbackFullLoad(firestoreDb);
      }

      const serverMeta = metaSnap.data();
      const serverHash = serverMeta.version_hash || "";
      const serverTime = serverMeta.last_global_update?.toMillis() || 0;
      const bundleUrl = serverMeta.world_data || null;

      // 2. Get Local Metadata
      const localMeta = await this.getLocalMetadata();
      const localHash = localMeta?.version_hash || "";
      const localTime = localMeta?.last_global_update || 0;

      console.log(
        `⏱️ Sync Check: ServerHash=${serverHash} vs LocalHash=${localHash}`,
      );

      // 3. Compare Hashes (Preferred) or Timestamps
      const isMatch =
        (serverHash && serverHash === localHash) ||
        (localTime === serverTime && localTime > 0);

      if (isMatch) {
        console.log(
          "✅ SyncEngine: VERSIONS MATCH. Loading from IndexedDB (0 Extra Reads).",
        );
        return await this.getAllFromIndexedDB();
      }

      // 4. Update Needed
      console.log("🔄 SyncEngine: Update detected.");

      
      // 4. Update Needed
      console.log("🔄 SyncEngine: Update detected.");
      
      try {
         const objects = await this.generateClientWorld(firestoreDb);
         if (objects && objects.length > 0) {
             console.log(`✅ SUCCESS. Deterministic Generation produced ${objects.length} objects.`);
             await this.saveTransaction(objects, serverTime, serverHash);
             return objects;
         }
      } catch (err) {
         console.warn("[WORLD] ❌ Client Generation Failed. Falling back to Full Sync.", err.message);
      }

      // Force FULL sync if client generation failed or returned nothing
      return await this.performFullSync(firestoreDb, serverTime, serverHash);
    } catch (e) {
      console.warn("❌ SyncEngine CRITICAL Error:", e.message);
      return await this.fallbackFullLoad(firestoreDb);
    }
  },

  /**
   * Download JSON bundle using Firebase Storage SDK (bypasses CORS)
   * Strategy: SDK first (no CORS issues) -> raw fetch fallback
   */
  async downloadBundle(url) {
    const id = Math.random().toString(36).substring(7);
    console.warn(`[SYNC-${id}] 🔽 START: ${url.substring(0, 60)}...`);

    // Extract storage path from URL for SDK usage
    let storagePath = null;
    try {
      const urlObj = new URL(url);
      const encodedPath = urlObj.pathname.split("/o/")[1];
      if (encodedPath) {
        storagePath = decodeURIComponent(encodedPath.split("?")[0]);
      }
    } catch (e) {
      // URL parsing failed, will try raw fetch
    }

    // STRATEGY 1: Firebase SDK (bypasses CORS entirely)
    if (storagePath) {
      try {
        console.warn(`[SYNC-${id}] 📡 Downloading via Firebase SDK...`);
        const { ref, getBytes, getStorage } =
          await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js");
        const { getApp } =
          await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js");

        let storage;
        try {
          // Use the already-initialized storage instance
          const mod = await import("../firebase/firebase-service.js");
          storage = mod.getStorageInstance();
        } catch (e) {
          /* ignore */
        }

        if (!storage) {
          try {
            const app = getApp();
            storage = getStorage(app);
          } catch (e) {
            throw new Error("Firebase app not initialized");
          }
        }

        const fileRef = ref(storage, storagePath);

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("SDK timeout (15s)")), 15000),
        );

        const bytes = await Promise.race([getBytes(fileRef), timeoutPromise]);

        const text = new TextDecoder().decode(bytes);
        const data = JSON.parse(text);
        console.warn(
          `[SYNC-${id}] ✅ SDK SUCCESS. Items: ${data?.length || "N/A"}`,
        );
        return data;
      } catch (sdkErr) {
        console.warn(
          `[SYNC-${id}] ⚠️ SDK failed: ${sdkErr.message}. Trying raw fetch...`,
        );
      }
    }

    // STRATEGY 2: Raw fetch fallback (works when CORS is configured)
    try {
      console.warn(`[SYNC-${id}] 📡 Downloading via fetch...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.warn(
        `[SYNC-${id}] ✅ Fetch SUCCESS. Items: ${data?.length || "N/A"}`,
      );
      return data;
    } catch (fetchErr) {
      console.warn(`[SYNC-${id}] ❌ FAILED:`, fetchErr.message);
      throw fetchErr;
    }
  },

  /**
   * Fetch ALL objects from Firestore and replace Cache
   */
  async performFullSync(db, newTimestamp, versionHash = null) {
    const { collection } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const { monitoredGetDocs } =
      await import("../firebase/firebase-monitor.js");

    const q = collection(db, "spawned_objects");
    const snapshot = await monitoredGetDocs(q, "spawned_objects/ (Full Sync)");

    if (window.trackUsage)
      window.trackUsage(
        "read",
        "[sync] [FULL LOAD]",
        snapshot.size,
        "spawned_objects/",
      );

    const objects = [];
    snapshot.forEach((doc) => {
      objects.push({ id: doc.id, ...doc.data() });
    });

    // Save to IndexedDB
    await this.saveTransaction(objects, newTimestamp, versionHash);
    return objects;
  },

  /**
   * Fetch ONLY changed objects
   */
  async performDeltaSync(db, lastSyncTime, newTimestamp, versionHash = null) {
    const { collection, query, where, getDocs, Timestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

    // Firestore Timestamp for query
    const lastDate = Timestamp.fromMillis(lastSyncTime);

    // We assume objects have 'updatedAt' or 'createdAt'
    // Ideally, 'updatedAt' field should be maintained on all objects
    const q = query(
      collection(db, "spawned_objects"),
      where("updatedAt", ">", lastDate),
    );

    const { monitoredGetDocs } =
      await import("../firebase/firebase-monitor.js");
    const snapshot = await monitoredGetDocs(q, "spawned_objects/ (Delta Sync)");

    // if (window.trackUsage) window.trackUsage('read', '[sync] [DELTA LOAD]', snapshot.size, 'spawned_objects/ (delta)');
    console.log(`📦 Delta Sync: Found ${snapshot.size} changed objects.`);

    if (snapshot.size > 1000) {
      console.warn(
        "⚠️ Delta too large (>1000). Doing full re-sync usually better.",
      );
      // Optional optimization: If delta is huge, maybe just wipe and reload?
    }

    const updates = [];
    snapshot.forEach((doc) => {
      updates.push({ id: doc.id, ...doc.data() });
    });

    // Update IndexedDB
    await this.updateTransaction(updates, newTimestamp, versionHash);

    // Return full fresh state
    return await this.getAllFromIndexedDB();
  },

  /**
   * Fallback if sync fails
   */
  async fallbackFullLoad(db) {
    // Just use the old logic from firebase-service
    const { collection } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const { monitoredGetDocs } =
      await import("../firebase/firebase-monitor.js");
    const snapshot = await monitoredGetDocs(
      collection(db, "spawned_objects"),
      "spawned_objects/ (Fallback)",
    );
    const objects = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    console.log(`⚠️ Fallback loaded ${objects.length} objects.`);
    return objects;
  },

  
  // ==================== CLIENT-SIDE DETERMINISTIC GENERATION ====================
  async generateClientWorld(firestoreDb) {
    console.log("🌍 Initiating deterministic client-side generation...");
    
    // 1. Imports & Data
    const { getTemplates, getWorldSnapshots } = await import("../firebase/firebase-service.js");
    const { collection, getDocs, query } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const { CITY_ANCHORS } = await import("../gameplay/data.js");
    const { SeededRandom } = await import("../core/random.js");
    const turf = window.turf || window.Turf;
    
    if (!turf) {
      console.warn("⚠️ Turf.js not loaded, skipping Voronoi generation.");
      return [];
    }
    
    // 2. Fetch Snapshots & Templates & Castles
    const [allSnaps, monsters, shops, vaults, allCastles] = await Promise.all([
      getWorldSnapshots(),
      getTemplates("monster"),
      getTemplates("shop"),
      getTemplates("vault"),
      getDocs(query(collection(firestoreDb, "castles"))).then(snap => snap.docs.map(d => ({id: d.id, ...d.data()})))
    ]);
    
    const activeSnaps = allSnaps.filter(s => s.isActive);
    if (activeSnaps.length === 0) {
      console.warn("⚠️ No active snapshots found.");
      return [];
    }

    const castlesTemplates = await getTemplates("castle"); // For generated castles that aren't citadels
    const cityObjects = [];
    const cityZones = [];
    
    // 3. Generate each city
    for (const snap of activeSnaps) {
      const cityId = snap.cityId;
      const city = CITY_ANCHORS.find(c => c.id === cityId);
      if (!city) continue;
      
      const seed = snap.seed || 123456789;
      const config = snap.config || { monsterCount: 0, shopCount: 0, vaultCount: 0, castleCount: 0 };
      const rng = new SeededRandom(seed);
      
      console.log(`🏙️ Generating city: ${city.name} (Seed: ${seed})`);
      
      // Get citadels for this city
      const cityCitadels = allCastles.filter(c => c.cityId === cityId);
      
      // Add citadels to the objects list
      cityObjects.push(...cityCitadels);
      
      // 4. Generate Zones (Voronoi) using Turf
      let zones = [];
      if (cityCitadels.length >= 2) {
        const padding = 0.05;
        const minLng = Math.min(...cityCitadels.map(c => c.lng)) - padding;
        const maxLng = Math.max(...cityCitadels.map(c => c.lng)) + padding;
        const minLat = Math.min(...cityCitadels.map(c => c.lat)) - padding;
        const maxLat = Math.max(...cityCitadels.map(c => c.lat)) + padding;
        
        const turfPoints = turf.featureCollection(
          cityCitadels.map(c => turf.point([c.lng, c.lat], { id: c.id, cityId: c.cityId }))
        );
        
        try {
          const voronoiPolygons = turf.voronoi(turfPoints, { bbox: [minLng, minLat, maxLng, maxLat] });
          if (voronoiPolygons && voronoiPolygons.features) {
            zones = voronoiPolygons.features.filter(f => f != null);
            cityZones.push({ id: cityId, features: zones });
          }
        } catch (e) {
          console.error(`Failed to generate Voronoi for ${city.name}:`, e);
        }
      }
      
      // 5. Build Object Pool
      const placementOrder = [
        { type: "castle", count: config.castleCount || 0, templatesList: castlesTemplates },
        { type: "vault", count: config.vaultCount || 0, templatesList: vaults },
        { type: "shop", count: config.shopCount || 0, templatesList: shops },
        { type: "monster", count: config.monsterCount || 0, templatesList: monsters },
      ];
      
      const objectPool = [];
      const getRandomTemplate = (list) => list[rng.rangeInt(0, list.length - 1)];
      
      for (const { type, count, templatesList } of placementOrder) {
        if (!templatesList || templatesList.length === 0) continue;
        for (let j = 0; j < count; j++) {
          const template = getRandomTemplate(templatesList);
          if (template) objectPool.push({ type, template });
        }
      }
      rng.shuffle(objectPool);
      
      // 6. Distribute Objects
      const buildObject = (type, template, lat, lng) => {
        const obj = {
          id: `${cityId}_${type}_${rng.generateId()}`,
          type,
          templateId: template.id,
          name: template.name,
          icon: template.icon,
          lat,
          lng,
          cityId: cityId,
          seed: seed,
          spawnedAt: Date.now(),
        };
        if (type === "monster") {
          obj.level = template.level || 1;
          obj.hp = template.hp || 20;
          obj.maxHp = template.maxHp || 20;
          obj.damage = template.damage || 5;
          obj.defense = template.defense || 0;
          obj.xpReward = template.xpReward || 10;
          obj.goldReward = template.goldReward || 5;
        } else if (type === "shop") {
          obj.shopType = template.name;
          obj.inventory = template.inventory || [];
        }
        return obj;
      };
      
      if (zones.length > 0) {
        const quotaPerZone = Math.ceil(objectPool.length / zones.length);
        
        for (const zone of zones) {
          const bbox = turf.bbox(zone);
          let placedInThisZone = 0;
          let attempts = 0;
          
          while (placedInThisZone < quotaPerZone && objectPool.length > 0 && attempts < 1000) {
            attempts++;
            const lat = bbox[1] + rng.next() * (bbox[3] - bbox[1]);
            const lng = bbox[0] + rng.next() * (bbox[2] - bbox[0]);
            
            if (turf.booleanPointInPolygon([lng, lat], zone)) {
              const { type, template } = objectPool.pop();
              cityObjects.push(buildObject(type, template, lat, lng));
              placedInThisZone++;
            }
          }
        }
      }
      
      // Fallback for remaining objects
      const radiusMeters = 9000;
      while (objectPool.length > 0) {
        const { type, template } = objectPool.pop();
        let randomAngle = rng.next() * Math.PI * 2;
        let randomDist = rng.next() * radiusMeters;
        const lat = city.lat + (randomDist / 111320) * Math.cos(randomAngle);
        const lng = city.lng + (randomDist / (111320 * Math.cos(city.lat * Math.PI / 180))) * Math.sin(randomAngle);
        cityObjects.push(buildObject(type, template, lat, lng));
      }
    }
    
    // Save zones to a local variable/indexedDB if needed, or window for map
    window._clientGeneratedZones = cityZones;
    
    return cityObjects;
  },

  // ================== INDEXEDDB HELPERS ==================

  async getLocalMetadata() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([METADATA_STORE], "readonly");
      const store = tx.objectStore(METADATA_STORE);
      const req = store.get("current_state");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllFromIndexedDB() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME], "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        console.log(`💾 Loaded ${req.result.length} objects from IndexedDB.`);
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveTransaction(objects, timestamp, versionHash = null) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME, METADATA_STORE], "readwrite");

      tx.oncomplete = () => {
        console.log("💾 IndexedDB Transaction Complete: Full Save");
        resolve();
      };
      tx.onerror = (e) => {
        console.error("IndexedDB Save Error:", e);
        reject(e);
      };

      // 1. Clear old data? Or just overwrite. For full sync, clear is safer.
      const objectStore = tx.objectStore(STORE_NAME);
      objectStore.clear();

      objects.forEach((obj) => {
        objectStore.add(obj);
      });

      // 2. Update Metadata
      const metaStore = tx.objectStore(METADATA_STORE);
      const meta = { id: "current_state", last_global_update: timestamp };
      if (versionHash) meta.version_hash = versionHash;
      metaStore.put(meta);
    });
  },

  async updateTransaction(updates, timestamp, versionHash = null) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE_NAME, METADATA_STORE], "readwrite");

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);

      const objectStore = tx.objectStore(STORE_NAME);

      updates.forEach((obj) => {
        // put() will update if exists, add if new
        objectStore.put(obj);
      });

      // Updates could also include DELETIONS, but handling deletions in Delta Sync
      // is tricky (need a 'deleted_objects' collection or 'isDeleted' flag).
      // For now, we assume simple updates/adds.

      const metaStore = tx.objectStore(METADATA_STORE);
      const meta = { id: "current_state", last_global_update: timestamp };
      if (versionHash) meta.version_hash = versionHash;
      metaStore.put(meta);
    });
  },

  // ================== SPATIAL QUERIES ==================

  /**
   * Get objects nearby using Turf.js directly on cached data
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusKm
   */
  async getLocalNearby(lat, lng, radiusKm) {
    // 1. Get all objects (Optimized: in real world usage we might use a spatial index mostly,
    // using IDBKeyRange on lat/lng is hard.
    // Loading all 2000 objects into memory is CHEAP (few MBs).

    const allObjects = await this.getAllFromIndexedDB();

    if (!window.turf) {
      console.error("❌ Turf.js not loaded!");
      return allObjects; // Fail safe
    }

    const center = turf.point([lng, lat]);

    return allObjects.filter((obj) => {
      // Note: Different objects might have different location structures
      // Spawned objects typically use 'position' or 'lat'/'lng'
      const objLat = obj.position?.lat || obj.lat || obj.location?.lat;
      const objLng = obj.position?.lng || obj.lng || obj.location?.lng;

      if (!objLat || !objLng) return false;

      const target = turf.point([objLng, objLat]);
      const distance = turf.distance(center, target, { units: "kilometers" });

      return distance <= radiusKm;
    });
  },

  // ================== UTIL ==================

  /**
   * Force a global update (Admin Tool)
   */
  async forceGlobalUpdate(db) {
    const { doc, setDoc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    await setDoc(doc(db, "world_metadata", "current_state"), {
      last_global_update: serverTimestamp(),
      triggeredBy: "admin", // Add user info if available
    });
    console.log("🚀 Global Update Triggered!");
  },

  /**
   * Sync Templates (Generic Logic)
   * Checks 'world_metadata/current_state' -> field 'last_templates_update'
   */
  async syncTemplates(firestoreDb, type) {
    if (!this.db) await this.init();

    try {
      const { doc, collection, query, where } =
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const { monitoredGetDoc, monitoredGetDocs } =
        await import("../firebase/firebase-monitor.js");

      // 1. Meta-Check
      const metaRef = doc(firestoreDb, "world_metadata", "current_state");
      // Usage tracked by monitoredGetDoc
      const metaSnap = await monitoredGetDoc(
        metaRef,
        `world_metadata/current_state (Templates ${type})`,
      );

      const serverMeta = metaSnap.exists() ? metaSnap.data() : {};
      const serverTime = serverMeta.last_templates_update?.toMillis() || 0;
      const bundleUrl = serverMeta.templates || null; // URL from metadata

      // 2. Local Check
      const localMeta = await this.getLocalMetadata();
      const localTime = localMeta?.last_templates_update || 0;

      if (serverTime === localTime && localTime > 0) {
        // console.log(`✅ Templates (${type}) Up-to-Date. Loading from IDB.`);
        return await this.getTemplatesFromIDB(type);
      }

      console.log(
        `🔄 Templates Update Detected (Server: ${serverTime} vs Local: ${localTime}). Fetching ${type}...`,
      );

      // TRY BUNDLE FIRST
      if (bundleUrl) {
        try {
          console.log(`📦 Downloading Templates Bundle: ${bundleUrl}`);
          const allTemplates = await this.downloadBundle(bundleUrl);
          // Filter just the type we need (Optimized: Bundle contains ALL templates usually, but let's check structure)
          // The admin bundler dumps ALL templates.
          const typeTemplates = allTemplates.filter((t) => t.type === type);

          // To keep it simple and consistent with local request, let's just save what we need or maybe everything is better.
          // Saving everything avoids re-downloading for other types.

          await this.saveTemplatesToIDB(allTemplates, serverTime); // Save ALL
          return typeTemplates;
        } catch (e) {
          console.warn("Templates bundle failed, falling back to Firestore", e);
        }
      }

      // 3. Simple Full Sync for Templates
      // We fetch ALL templates, not just the requested type, to make sure
      // the IndexedDB cache is fully overwritten and we don't end up with stale deleted items of other types
      // since we only have one global last_templates_update timestamp.
      const q = collection(firestoreDb, "templates");
      const snapshot = await monitoredGetDocs(q, `templates/ (Full Sync)`);

      const allTemplates = [];
      snapshot.forEach((doc) =>
        allTemplates.push({ id: doc.id, ...doc.data() }),
      );

      // 4. Save ALL templates to IDB, which also clears the old ones
      await this.saveTemplatesToIDB(allTemplates, serverTime);

      const typeTemplates = allTemplates.filter((t) => t.type === type);
      return typeTemplates;
    } catch (e) {
      console.error("❌ SyncTemplates Error:", e);
      return [];
    }
  },

  async getTemplatesFromIDB(type) {
    return new Promise((resolve) => {
      const tx = this.db.transaction(["templates"], "readonly");
      const store = tx.objectStore("templates");
      const index = store.index("type");
      const req = index.getAll(type);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve([]);
    });
  },

  async saveTemplatesToIDB(templates, timestamp) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        ["templates", METADATA_STORE],
        "readwrite",
      );
      const store = tx.objectStore("templates");

      // Clear ALL existing templates first to remove deleted ones
      const clearReq = store.clear();

      clearReq.onsuccess = () => {
        // Once cleared, put the new ones
        templates.forEach((t) => store.put(t));

        // Update Metadata (merge with existing)
        const metaStore = tx.objectStore(METADATA_STORE);
        const metaReq = metaStore.get("current_state");

        metaReq.onsuccess = () => {
          const data = metaReq.result || { id: "current_state" };
          data.last_templates_update = timestamp;
          metaStore.put(data);
        };
      };

      clearReq.onerror = (e) => reject(e);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  },

  /**
   * Sync City Zones
   */
  async syncCityZones(firestoreDb, cityId) {
    if (!this.db) await this.init();

    try {
      const { doc } =
        await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
      const { monitoredGetDoc } =
        await import("../firebase/firebase-monitor.js");

      // 1. Meta-Check
      const metaRef = doc(firestoreDb, "world_metadata", "current_state");
      // Usage tracked by monitoredGetDoc
      const metaSnap = await monitoredGetDoc(
        metaRef,
        `world_metadata/current_state (Zones ${cityId})`,
      );

      const serverMeta = metaSnap.exists() ? metaSnap.data() : {};
      const serverTime = serverMeta.last_zones_update?.toMillis() || 0;
      const bundleUrl = serverMeta.zones || null;

      // 2. Local Check
      const localMeta = await this.getLocalMetadata();
      const localTime = localMeta?.last_zones_update || 0;

      // Check if we actually HAVE the zones in IDB
      const cachedZones = await this.getCityZonesFromIDB(cityId);

      if (serverTime === localTime && localTime > 0 && cachedZones) {
        // console.log(`✅ City Zones (${cityId}) Up-to-Date. Loading from IDB.`);
        return cachedZones;
      }

      console.log(
        `🔄 City Zones Update Detected (Server: ${serverTime} vs Local: ${localTime}). Fetching ${cityId}...`,
      );

      // TRY BUNDLE FIRST
      if (bundleUrl) {
        try {
          console.log(`📦 Downloading Zones Bundle: ${bundleUrl}`);
          const allZones = await this.downloadBundle(bundleUrl);
          // Filter for specific city (naive filter, structure depends on bundle)
          // If bundle is array of zones where id=cityId
          const targetZone = allZones.find((z) => z.id === cityId);

          if (targetZone) {
            await this.saveCityZonesToIDB(targetZone, cityId, serverTime);
            return targetZone;
          }
          console.warn(`City ${cityId} not found in bundle.`);
        } catch (e) {
          console.warn("Zones bundle failed, falling back to Firestore", e);
        }
      }

      // 3. Fetch from Firestore
      const zoneRef = doc(firestoreDb, "city_zones", cityId);
      const zoneSnap = await monitoredGetDoc(zoneRef, `city_zones/${cityId}`);

      // if (window.trackUsage) window.trackUsage('read', `[sync] [city_zones: ${cityId}]`, 1, `city_zones/${cityId}`);

      if (!zoneSnap.exists()) return null;

      const data = zoneSnap.data();

      // 4. Save to IDB
      await this.saveCityZonesToIDB(data, cityId, serverTime);

      return data;
    } catch (e) {
      console.error("❌ SyncCityZones Error:", e);
      return null;
    }
  },

  async getCityZonesFromIDB(cityId) {
    return new Promise((resolve) => {
      const tx = this.db.transaction(["city_zones"], "readonly");
      const store = tx.objectStore("city_zones");
      const req = store.get(cityId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  },

  async saveCityZonesToIDB(data, cityId, timestamp) {
    return new Promise((resolve, reject) => {
      // Ensure id is present for IDB key
      const record = { ...data, id: cityId };

      const tx = this.db.transaction(
        ["city_zones", METADATA_STORE],
        "readwrite",
      );
      const store = tx.objectStore("city_zones");

      store.put(record);

      // Update Metadata
      const metaStore = tx.objectStore(METADATA_STORE);
      const metaReq = metaStore.get("current_state");

      metaReq.onsuccess = () => {
        const mData = metaReq.result || { id: "current_state" };
        mData.last_zones_update = timestamp;
        metaStore.put(mData);
      };

      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e);
    });
  },

  /**
   * Record a defeated procedural monster
   * Writes to both Firestore and local IndexedDB cache
   * @param {string} monsterId - e.g., 'proc_872a1070fffffff_3'
   * @param {string} h3Index - The H3 cell index
   * @param {string} defeatedByUid - The player's UID
   */
  async recordDefeatedMonster(monsterId, h3Index, defeatedByUid) {
    const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
    const now = Date.now();
    const expiresAt = now + COOLDOWN_MS;

    const record = {
      id: monsterId,
      h3Index,
      defeatedByUid,
      defeatedAt: now,
      expiresAt,
    };

    // 1. Write to local IndexedDB (immediate, for offline)
    try {
      const tx = this.db.transaction("defeated_objects", "readwrite");
      const store = tx.objectStore("defeated_objects");
      store.put(record);
    } catch (e) {
      console.warn("Failed to cache defeated monster locally:", e);
    }

    // 2. Write to Firestore (async, for cross-player visibility)
    try {
      const { doc, setDoc, getFirestore } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { getApp } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const db = getFirestore(getApp());
      await setDoc(doc(db, "defeated_objects", monsterId), {
        h3Index,
        defeatedByUid,
        defeatedAt: now,
        expiresAt,
      });
    } catch (e) {
      console.warn("Failed to record defeated monster in Firestore:", e);
      // Local cache still works — will sync later
    }
  },

  /**
   * Get all defeated monster IDs for a set of H3 cells
   * Checks Firestore first (cross-player), falls back to local cache
   * @param {string[]} h3Cells - Array of H3 cell indices
   * @returns {Set<string>} Set of defeated monster IDs
   */
  async getDefeatedMonstersForCells(h3Cells) {
    const now = Date.now();
    const defeatedIds = new Set();

    // 1. Try Firestore query for cross-player defeated monsters
    try {
      const { collection, query, where, getDocs, getFirestore } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      const { getApp } =
        await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
      const db = getFirestore(getApp());

      // Firestore 'in' queries support max 30 values, batch if needed
      const batches = [];
      for (let i = 0; i < h3Cells.length; i += 30) {
        batches.push(h3Cells.slice(i, i + 30));
      }

      for (const batch of batches) {
        const q = query(
          collection(db, "defeated_objects"),
          where("h3Index", "in", batch),
          where("expiresAt", ">", now),
        );
        const snapshot = await getDocs(q);
        snapshot.forEach((doc) => {
          defeatedIds.add(doc.id);
        });
      }
    } catch (e) {
      console.warn("Firestore defeated query failed, using local cache:", e);

      // 2. Fallback: local IndexedDB
      try {
        const tx = this.db.transaction("defeated_objects", "readonly");
        const store = tx.objectStore("defeated_objects");
        const index = store.index("h3Index");

        for (const cell of h3Cells) {
          const req = index.getAll(cell);
          await new Promise((resolve, reject) => {
            req.onsuccess = () => {
              for (const record of req.result) {
                if (record.expiresAt > now) {
                  defeatedIds.add(record.id);
                }
              }
              resolve();
            };
            req.onerror = () => resolve(); // Skip on error
          });
        }
      } catch (e2) {
        console.warn("Local defeated cache also failed:", e2);
      }
    }

    return defeatedIds;
  },

  /**
   * Clean up expired defeated records from IndexedDB
   * Should be called periodically (e.g., every 10 minutes)
   */
  async cleanupExpiredDefeated() {
    if (!this.db) return;

    try {
      const now = Date.now();
      const tx = this.db.transaction("defeated_objects", "readwrite");
      const store = tx.objectStore("defeated_objects");
      const req = store.openCursor();

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.value.expiresAt <= now) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } catch (e) {
      console.warn("Cleanup failed:", e);
    }
  },
};
