
import { getDB, getStorageInstance, getCurrentUser } from './firebase-service.js';
import { collection, getDocs, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

/**
 * Admin Tool: Static Bundle Generator
 * Reads high-volume collections from Firestore and saves them as static JSON files in Storage.
 * This allows clients to fetch 1 JSON file instead of N Firestore reads.
 */
export const AdminBundler = {

    /**
     * Main function to generate all bundles
     */
    async generateAllBundles() {
        const currentUser = getCurrentUser();
        const db = getDB();
        const storage = getStorageInstance();

        if (!currentUser) {
            alert("Please login first");
            return;
        }

        if (!db || !storage) {
            console.error("Firebase services not initialized", { db, storage });
            alert("Firebase not ready. Refesh page.");
            return;
        }

        console.log("📦 Starting Bundle Generation...");
        const start = performance.now();

        try {
            // 1. World Objects (The heavy one)
            const worldUrl = await this.bundleCollection(db, storage, 'spawned_objects', 'bundles/world_data.json');

            // 2. Templates
            const templatesUrl = await this.bundleCollection(db, storage, 'templates', 'bundles/templates.json');

            // 3. City Zones
            const zonesUrl = await this.bundleCollection(db, storage, 'city_zones', 'bundles/zones.json');

            // 4. Update Metadata
            await this.updateMetadata(db, {
                world_data: worldUrl,
                templates: templatesUrl,
                zones: zonesUrl,
                generatedAt: Date.now(),
                version_hash: `v_${Date.now()}`
            });

            const duration = ((performance.now() - start) / 1000).toFixed(2);
            alert(`✅ Bundles Generated & Uploaded in ${duration}s!`);

        } catch (e) {
            console.error("❌ Bundle Generation Failed:", e);
            alert("Error generating bundles. Check console.");
        }
    },

    /**
     * Reads a collection and uploads it as JSON
     */
    async bundleCollection(db, storage, collectionName, storagePath) {
        console.log(`🔹 Bundling ${collectionName}...`);

        // 1. Fetch from Firestore (Expensive Read)
        const snapshot = await getDocs(collection(db, collectionName));
        const data = [];
        snapshot.forEach(doc => {
            data.push({ id: doc.id, ...doc.data() });
        });

        console.log(`   Fetched ${data.length} documents.`);

        // 2. Convert to JSON
        const jsonString = JSON.stringify(data);

        // 3. Upload to Storage
        const storageRef = ref(storage, storagePath);

        // Using 'raw' string upload
        await uploadString(storageRef, jsonString, 'raw', {
            contentType: 'application/json'
        });

        // 4. Get Public URL
        const url = await getDownloadURL(storageRef);
        console.log(`   ✅ Uploaded to: ${url}`);

        return url;
    },

    /**
     * Updates the central metadata file that clients check
     */
    async updateMetadata(db, bundleUrls) {
        console.log("🔹 Updating Metadata...");
        const metaRef = doc(db, 'world_metadata', 'current_state');

        await setDoc(metaRef, {
            ...bundleUrls,
            last_global_update: serverTimestamp(), // Triggers world sync
            last_templates_update: serverTimestamp(), // Triggers template caching
            last_zones_update: serverTimestamp() // Triggers zone caching
        }, { merge: true });

        console.log("   ✅ Metadata Updated.");
    }
};

// Expose globally for console testing if needed
window.AdminBundler = AdminBundler;
