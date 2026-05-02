const fs = require('fs');
let content = fs.readFileSync('www/map/templates_map.html', 'utf8');

const idbCode = `
            // Local IndexedDB manager for saving global map runs without hitting Firestore
            const LocalSnapshotsManager = {
                dbName: "FightCraftLocalTemplates",
                storeName: "local_snapshots",
                async init() {
                    return new Promise((resolve, reject) => {
                        const request = indexedDB.open(this.dbName, 1);
                        request.onupgradeneeded = (e) => {
                            const db = e.target.result;
                            if (!db.objectStoreNames.contains(this.storeName)) {
                                db.createObjectStore(this.storeName, { keyPath: "id" });
                            }
                        };
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                },
                async saveSnapshot(data) {
                    const db = await this.init();
                    return new Promise((resolve, reject) => {
                        const tx = db.transaction(this.storeName, "readwrite");
                        const store = tx.objectStore(this.storeName);
                        store.put(data);
                        tx.oncomplete = () => resolve(data);
                        tx.onerror = () => reject(tx.error);
                    });
                },
                async getAll() {
                    const db = await this.init();
                    return new Promise((resolve, reject) => {
                        const tx = db.transaction(this.storeName, "readonly");
                        const store = tx.objectStore(this.storeName);
                        const request = store.getAll();
                        request.onsuccess = () => {
                            const result = request.result || [];
                            result.sort((a, b) => b.createdAt - a.createdAt);
                            resolve(result);
                        };
                        request.onerror = () => reject(request.error);
                    });
                },
                async getById(id) {
                    const db = await this.init();
                    return new Promise((resolve, reject) => {
                        const tx = db.transaction(this.storeName, "readonly");
                        const store = tx.objectStore(this.storeName);
                        const request = store.get(id);
                        request.onsuccess = () => resolve(request.result);
                        request.onerror = () => reject(request.error);
                    });
                }
            };
`;

content = content.replace('let _initialMetadataLoaded = false;', 'let _initialMetadataLoaded = false;\n' + idbCode);

// Inject save logic after global render finishes
// Find: if (bounds.isValid()) { map.fitBounds(bounds, { padding: [50, 50] }); }
const saveLogic = `
                    if (bounds.isValid()) {
                        map.fitBounds(bounds, { padding: [50, 50] });
                    }

                    // Collect all citadels from the markers
                    const localData = {
                        id: "local_" + Date.now(),
                        name: "Global Map Run " + new Date().toLocaleTimeString(),
                        createdAt: Date.now(),
                        citiesCount: WORLD_CITIES.length,
                        citadelsCount: totalCitadels,
                        type: "global_preview",
                        citadels: [] // We skip full geometry to save space, store metadata mostly. Wait, if we want to preview it later, we need to save the data!
                    };
                    
                    // Actually, let's regenerate it when clicking on the snapshot using the seed, or save the seed!
                    // Since it's deterministic except for Math.random(), let's just save the metadata. 
                    // To actually save the citadels for quick preview, we can store 'processedCitadels' across all cities.
                    // Let's create an array to accumulate all citadels
`;

// wait, I need to modify previewGlobalWorld to collect all citadels into localData
