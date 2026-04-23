/**
 * Sync Engine - Optimizing Firestore Reads
 * Strategy: "Meta-Check" (1 Read) -> IndexedDB
 */

import { getStorageInstance } from '../firebase/firebase-service.js?v=debug_7';

const DB_NAME = 'FightCraftDB';
const DB_VERSION = 3;
const STORE_NAME = 'spawned_objects';
const METADATA_STORE = 'world_metadata';

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
                    const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    objectStore.createIndex('cityId', 'cityId', { unique: false });
                    objectStore.createIndex('type', 'type', { unique: false });
                    // We can create a spatial index if needed, but for now we'll filter in memory or specific key
                }

                // Store for metadata (timestamps)
                if (!db.objectStoreNames.contains(METADATA_STORE)) {
                    db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
                }

                // Store for templates
                if (!db.objectStoreNames.contains('templates')) {
                    const tStore = db.createObjectStore('templates', { keyPath: 'id' });
                    tStore.createIndex('type', 'type', { unique: false });
                }

                // Store for city_zones
                if (!db.objectStoreNames.contains('city_zones')) {
                    db.createObjectStore('city_zones', { keyPath: 'id' }); // id = cityId
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
            const { doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const { monitoredGetDoc, monitoredGetDocs } = await import('../firebase/firebase-monitor.js');

            // 1. Meta-Check (The ONLY mandatory read)
            const metaRef = doc(firestoreDb, 'world_metadata', 'current_state');
            const metaSnap = await monitoredGetDoc(metaRef, 'world_metadata/current_state (SyncEngine Check)');

            if (!metaSnap.exists()) {
                console.warn("⚠️ SyncEngine: 'world_metadata/current_state' NOT FOUND. Falling back to full legacy load.");
                return await this.fallbackFullLoad(firestoreDb);
            }

            const serverMeta = metaSnap.data();
            const serverHash = serverMeta.version_hash || '';
            const serverTime = serverMeta.last_global_update?.toMillis() || 0;
            const bundleUrl = serverMeta.world_data || null;

            // 2. Get Local Metadata
            const localMeta = await this.getLocalMetadata();
            const localHash = localMeta?.version_hash || '';
            const localTime = localMeta?.last_global_update || 0;

            console.log(`⏱️ Sync Check: ServerHash=${serverHash} vs LocalHash=${localHash}`);

            // 3. Compare Hashes (Preferred) or Timestamps
            const isMatch = (serverHash && serverHash === localHash) || (localTime === serverTime && localTime > 0);

            if (isMatch) {
                console.log("✅ SyncEngine: VERSIONS MATCH. Loading from IndexedDB (0 Extra Reads).");
                return await this.getAllFromIndexedDB();
            }

            // 4. Update Needed
            console.log("🔄 SyncEngine: Update detected.");

            // STRATEGY: Try Bundle First -> Delta -> Full Clean
            if (bundleUrl) {
                console.log("📦 Bundle Available! Downloading from Storage...", bundleUrl);
                try {
                    const objects = await this.downloadBundle(bundleUrl);
                    console.warn(`[WORLD] 🔍 Processing result: Array=${Array.isArray(objects)}, Count=${objects?.length}`);

                    if (objects && objects.length > 0) {
                        console.warn(`[WORLD] ✅ SUCCESS. Saving ${objects.length} objects.`);
                        await this.saveTransaction(objects, serverTime, serverHash);
                        return objects;
                    } else {
                        console.warn(`[WORLD] ⚠️ Bundle empty or invalid.`);
                    }
                } catch (err) {
                    console.warn("[WORLD] ❌ Bundle Load Failed. Falling back to Firestore.", err.message);
                }
            }

            // Fallback to old logic
            if (localTime === 0) {
                console.warn("[WORLD] 🆕 NO CACHE. Doing Full Firestore Sync (Expensive!).");
                return await this.performFullSync(firestoreDb, serverTime, serverHash);
            } else {
                console.warn("[WORLD] 🔄 DOING DELTA SYNC.");
                return await this.performDeltaSync(firestoreDb, localTime, serverTime, serverHash);
            }

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
            const encodedPath = urlObj.pathname.split('/o/')[1];
            if (encodedPath) {
                storagePath = decodeURIComponent(encodedPath.split('?')[0]);
            }
        } catch (e) {
            // URL parsing failed, will try raw fetch
        }

        // STRATEGY 1: Firebase SDK (bypasses CORS entirely)
        if (storagePath) {
            try {
                console.warn(`[SYNC-${id}] 📡 Downloading via Firebase SDK...`);
                const { ref, getBytes, getStorage } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js');
                const { getApp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');

                let storage;
                try {
                    // Use the already-initialized storage instance
                    const mod = await import('../firebase/firebase-service.js');
                    storage = mod.getStorageInstance();
                } catch(e) { /* ignore */ }

                if (!storage) {
                    try {
                        const app = getApp();
                        storage = getStorage(app);
                    } catch (e) {
                        throw new Error('Firebase app not initialized');
                    }
                }

                const fileRef = ref(storage, storagePath);

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('SDK timeout (15s)')), 15000)
                );

                const bytes = await Promise.race([
                    getBytes(fileRef),
                    timeoutPromise
                ]);

                const text = new TextDecoder().decode(bytes);
                const data = JSON.parse(text);
                console.warn(`[SYNC-${id}] ✅ SDK SUCCESS. Items: ${data?.length || 'N/A'}`);
                return data;
            } catch (sdkErr) {
                console.warn(`[SYNC-${id}] ⚠️ SDK failed: ${sdkErr.message}. Trying raw fetch...`);
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
            console.warn(`[SYNC-${id}] ✅ Fetch SUCCESS. Items: ${data?.length || 'N/A'}`);
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
        const { collection } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const { monitoredGetDocs } = await import('../firebase/firebase-monitor.js');

        const q = collection(db, 'spawned_objects');
        const snapshot = await monitoredGetDocs(q, 'spawned_objects/ (Full Sync)');

        if (window.trackUsage) window.trackUsage('read', '[sync] [FULL LOAD]', snapshot.size, 'spawned_objects/');

        const objects = [];
        snapshot.forEach(doc => {
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
        const { collection, query, where, getDocs, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');

        // Firestore Timestamp for query
        const lastDate = Timestamp.fromMillis(lastSyncTime);

        // We assume objects have 'updatedAt' or 'createdAt'
        // Ideally, 'updatedAt' field should be maintained on all objects
        const q = query(
            collection(db, 'spawned_objects'),
            where('updatedAt', '>', lastDate)
        );

        const { monitoredGetDocs } = await import('../firebase/firebase-monitor.js');
        const snapshot = await monitoredGetDocs(q, 'spawned_objects/ (Delta Sync)');

        // if (window.trackUsage) window.trackUsage('read', '[sync] [DELTA LOAD]', snapshot.size, 'spawned_objects/ (delta)');
        console.log(`📦 Delta Sync: Found ${snapshot.size} changed objects.`);

        if (snapshot.size > 1000) {
            console.warn("⚠️ Delta too large (>1000). Doing full re-sync usually better.");
            // Optional optimization: If delta is huge, maybe just wipe and reload?
        }

        const updates = [];
        snapshot.forEach(doc => {
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
        const { collection } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        const { monitoredGetDocs } = await import('../firebase/firebase-monitor.js');
        const snapshot = await monitoredGetDocs(collection(db, 'spawned_objects'), 'spawned_objects/ (Fallback)');
        const objects = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log(`⚠️ Fallback loaded ${objects.length} objects.`);
        return objects;
    },

    // ================== INDEXEDDB HELPERS ==================

    async getLocalMetadata() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([METADATA_STORE], 'readonly');
            const store = tx.objectStore(METADATA_STORE);
            const req = store.get('current_state');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    },

    async getAllFromIndexedDB() {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([STORE_NAME], 'readonly');
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
            const tx = this.db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');

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

            objects.forEach(obj => {
                objectStore.add(obj);
            });

            // 2. Update Metadata
            const metaStore = tx.objectStore(METADATA_STORE);
            const meta = { id: 'current_state', last_global_update: timestamp };
            if (versionHash) meta.version_hash = versionHash;
            metaStore.put(meta);
        });
    },

    async updateTransaction(updates, timestamp, versionHash = null) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([STORE_NAME, METADATA_STORE], 'readwrite');

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);

            const objectStore = tx.objectStore(STORE_NAME);

            updates.forEach(obj => {
                // put() will update if exists, add if new
                objectStore.put(obj);
            });

            // Updates could also include DELETIONS, but handling deletions in Delta Sync 
            // is tricky (need a 'deleted_objects' collection or 'isDeleted' flag).
            // For now, we assume simple updates/adds.

            const metaStore = tx.objectStore(METADATA_STORE);
            const meta = { id: 'current_state', last_global_update: timestamp };
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

        return allObjects.filter(obj => {
            // Note: Different objects might have different location structures
            // Spawned objects typically use 'position' or 'lat'/'lng'
            const objLat = obj.position?.lat || obj.lat || obj.location?.lat;
            const objLng = obj.position?.lng || obj.lng || obj.location?.lng;

            if (!objLat || !objLng) return false;

            const target = turf.point([objLng, objLat]);
            const distance = turf.distance(center, target, { units: 'kilometers' });

            return distance <= radiusKm;
        });
    },

    // ================== UTIL ==================

    /**
     * Force a global update (Admin Tool)
     */
    async forceGlobalUpdate(db) {
        const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
        await setDoc(doc(db, 'world_metadata', 'current_state'), {
            last_global_update: serverTimestamp(),
            triggeredBy: 'admin' // Add user info if available
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
            const { doc, collection, query, where } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const { monitoredGetDoc, monitoredGetDocs } = await import('../firebase/firebase-monitor.js');

            // 1. Meta-Check
            const metaRef = doc(firestoreDb, 'world_metadata', 'current_state');
            // Usage tracked by monitoredGetDoc
            const metaSnap = await monitoredGetDoc(metaRef, `world_metadata/current_state (Templates ${type})`);

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

            console.log(`🔄 Templates Update Detected (Server: ${serverTime} vs Local: ${localTime}). Fetching ${type}...`);

            // TRY BUNDLE FIRST
            if (bundleUrl) {
                try {
                    console.log(`📦 Downloading Templates Bundle: ${bundleUrl}`);
                    const allTemplates = await this.downloadBundle(bundleUrl);
                    // Filter just the type we need (Optimized: Bundle contains ALL templates usually, but let's check structure)
                    // The admin bundler dumps ALL templates.
                    const typeTemplates = allTemplates.filter(t => t.type === type);

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
            const q = collection(firestoreDb, 'templates');
            const snapshot = await monitoredGetDocs(q, `templates/ (Full Sync)`);

            const allTemplates = [];
            snapshot.forEach(doc => allTemplates.push({ id: doc.id, ...doc.data() }));

            // 4. Save ALL templates to IDB, which also clears the old ones
            await this.saveTemplatesToIDB(allTemplates, serverTime);

            const typeTemplates = allTemplates.filter(t => t.type === type);
            return typeTemplates;

        } catch (e) {
            console.error("❌ SyncTemplates Error:", e);
            return [];
        }
    },

    async getTemplatesFromIDB(type) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(['templates'], 'readonly');
            const store = tx.objectStore('templates');
            const index = store.index('type');
            const req = index.getAll(type);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve([]);
        });
    },

    async saveTemplatesToIDB(templates, timestamp) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['templates', METADATA_STORE], 'readwrite');
            const store = tx.objectStore('templates');

            // Clear ALL existing templates first to remove deleted ones
            const clearReq = store.clear();

            clearReq.onsuccess = () => {
                // Once cleared, put the new ones
                templates.forEach(t => store.put(t));

                // Update Metadata (merge with existing)
                const metaStore = tx.objectStore(METADATA_STORE);
                const metaReq = metaStore.get('current_state');

                metaReq.onsuccess = () => {
                    const data = metaReq.result || { id: 'current_state' };
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
            const { doc } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
            const { monitoredGetDoc } = await import('../firebase/firebase-monitor.js');

            // 1. Meta-Check
            const metaRef = doc(firestoreDb, 'world_metadata', 'current_state');
            // Usage tracked by monitoredGetDoc
            const metaSnap = await monitoredGetDoc(metaRef, `world_metadata/current_state (Zones ${cityId})`);

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

            console.log(`🔄 City Zones Update Detected (Server: ${serverTime} vs Local: ${localTime}). Fetching ${cityId}...`);

            // TRY BUNDLE FIRST
            if (bundleUrl) {
                try {
                    console.log(`📦 Downloading Zones Bundle: ${bundleUrl}`);
                    const allZones = await this.downloadBundle(bundleUrl);
                    // Filter for specific city (naive filter, structure depends on bundle)
                    // If bundle is array of zones where id=cityId
                    const targetZone = allZones.find(z => z.id === cityId);

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
            const zoneRef = doc(firestoreDb, 'city_zones', cityId);
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
            const tx = this.db.transaction(['city_zones'], 'readonly');
            const store = tx.objectStore('city_zones');
            const req = store.get(cityId);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    },

    async saveCityZonesToIDB(data, cityId, timestamp) {
        return new Promise((resolve, reject) => {
            // Ensure id is present for IDB key
            const record = { ...data, id: cityId };

            const tx = this.db.transaction(['city_zones', METADATA_STORE], 'readwrite');
            const store = tx.objectStore('city_zones');

            store.put(record);

            // Update Metadata
            const metaStore = tx.objectStore(METADATA_STORE);
            const metaReq = metaStore.get('current_state');

            metaReq.onsuccess = () => {
                const mData = metaReq.result || { id: 'current_state' };
                mData.last_zones_update = timestamp;
                metaStore.put(mData);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e);
        });
    }
};
