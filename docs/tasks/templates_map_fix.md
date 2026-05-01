## User

[@New Agent Thread](zed:///agent/thread/8143d900-c801-47ba-9401-85aabf85ba3a?name=New+Agent+Thread) Continue

## Assistant

<thinking>
**Initiating Thought Process**

I'm starting a new agent thread, as directed. The prompt signals this is a continuation, but the history is absent here. I'm Antigravity, ready to proceed.



</thinking>

**Tool Call: git status**
Status: Completed

Terminal:
```
On branch main
Your branch is up to date with 'origin/main'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   CLAUDE.md
	modified:   README.md
	modified:   docs/PRD.md
	modified:   firebase/firestore.rules
	modified:   www/core/app.js
	modified:   www/core/index.html
	modified:   www/firebase/firebase-service.js
	modified:   www/maintenance/admin-citadel-generator.js
	modified:   www/map/map.js

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	www/map/test_syntax.mjs

no changes added to commit (use "git add" and/or "git commit -a")

```


**Tool Call: git diff**
Status: Completed

Terminal:
```
warning: in the working copy of 'CLAUDE.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'README.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'docs/PRD.md', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'firebase/firestore.rules', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'www/core/app.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'www/core/index.html', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'www/firebase/firebase-service.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'www/maintenance/admin-citadel-generator.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'www/map/map.js', LF will be replaced by CRLF the next time Git touches it
diff --git a/CLAUDE.md b/CLAUDE.md
index db1605e..3f9e79c 100644
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -47,7 +47,7 @@ FightCraft is a geolocation RPG (HTML5/JS/TailwindCSS) wrapped in Capacitor for
 10. loadStaticMonsters() → parse + render from Firestore spawned_objects
 11. fetchSpawnedObjectsOnce() + getCityZones() + getTemplates() → parallel
 12. checkAndFetchPOIs()  → Points of Interest
-13. initPvP() + initKingdom() + initGroups() → subsystems
+13. initPvP() + initKingdom() + initH3Territory() + initGroups() → subsystems (including immediate H3 discovery)
 14. subscribeToArenas()  → RTDB arena listeners
 15. recalculateStats()   → derive all stats from base attributes + equipment
 16. updateHUD()          → render all UI
@@ -299,7 +299,7 @@ TailwindCSS loaded from CDN (~300KB, ~5% utilized — accepted trade-off for bun
 - **Firebase project ID:** `fight-craft-3c3f0`
 - **Android package:** `com.fightcraft.game`
 - **Default fallback coordinates:** Berlin (52.484512, 13.449876) when GPS is unavailable
-- **Multi-city support:** 6 city anchors (Berlin, Kyiv, Lviv, Warsaw, Prague, Vienna) — defined in `CITY_ANCHORS` in `gameplay/data.js`
+- **Multi-city support:** 6 city anchors (Berlin, Kyiv, Lviv, Warsaw, Prague, Vienna) — defined in `CITY_ANCHORS` in `gameplay/data.js` (Transitioning to H3 global procedural discovery)
 - **Design system:** Penpot-managed UI tokens (37 color rules, spacing/sizing tokens, 8px grid) — see `docs/SRC.md`
 - **Firestore optimization:** ~15 reads at startup (down from 2600+ via SyncEngine + IndexedDB caching)

diff --git a/README.md b/README.md
index 3ebfd5c..5bb3335 100644
--- a/README.md
+++ b/README.md
@@ -165,6 +165,8 @@ Defense covers 2 adjacent zones simultaneously (Head+Body, Body+Belt, Belt+Legs,
 - Proximity checks: all members must be within 50m of the target

 ### Territory
+- **Procedural Global World:** Powered by H3 spatial indexing and OpenStreetMap, generating the world wherever you go.
+- **Auto-Discovery:** Landmarks (castles, monuments, ruins) are automatically discovered and spawned immediately upon logging in and as you explore.
 - City districts with citadels that can be captured when within 50m
 - District kings earn passive hourly gold income
 - Safe storage system at citadels to protect resources
diff --git a/docs/PRD.md b/docs/PRD.md
index d9c7374..64dbcf5 100644
--- a/docs/PRD.md
+++ b/docs/PRD.md
@@ -310,7 +310,7 @@ EffectiveDistance = HaversineDistance(player, citadel) / CitadelPower
 The citadel with the lowest `EffectiveDistance` owns any given point. This is computed client-side with zero Firestore reads.

 ### Discovery System
-- **Trigger**: Player enters a new H3 Resolution 6 cell (~3.2km edge)
+- **Trigger**: Player logs into the game OR enters a new H3 Resolution 6 cell (~3.2km edge)
 - **Action**: Overpass API queries OSM for historic landmarks (castles, monuments, ruins, cathedrals, etc.)
 - **Result**: New castle documents are created in Firestore with default `powerMultiplier: 1.0`
 - **Dedup**: 100m radius prevents duplicate castles for the same landmark
diff --git a/firebase/firestore.rules b/firebase/firestore.rules
index 9aab4a6..3d307e5 100644
--- a/firebase/firestore.rules
+++ b/firebase/firestore.rules
@@ -77,7 +77,8 @@ service cloud.firestore {
     // Templates collection - authenticated users can read, admins can write
     match /templates/{templateId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // Spawned objects - admins can write, all authenticated users can read
@@ -93,31 +94,36 @@ service cloud.firestore {
     // Castles collection - authenticated users can read, admins can write
     match /castles/{castleId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // World Snapshots - admins can write, authenticated users can read (for map viewer)
     match /world_snapshots/{snapshotId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // World Chunks (Packed States) - All users can read, only admins can write (auto-pack)
     match /world_chunks/{chunkId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // World Metadata - All users can read (for sync), admins can write (force update)
     match /world_metadata/{docId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // City Zones - All users can read, admins can write
     match /city_zones/{cityId} {
       allow read: if request.auth != null;
-      allow write: if isAdmin();
+      allow create, update: if request.auth != null;
+      allow delete: if isAdmin();
     }

     // Players collection (legacy) - authenticated users can read/write their own
diff --git a/www/core/app.js b/www/core/app.js
index c891222..7ea545a 100644
--- a/www/core/app.js
+++ b/www/core/app.js
@@ -23,6 +23,7 @@ import {
   subscribeToWorldMetadata,
   isAdmin,
   isModerator,
+  saveDiscoveredCastle,
 } from "../firebase/firebase-service.js";
 import {
   updateHUD,
@@ -56,8 +57,10 @@ window.logout = logout;

 console.log("✅ app.js module loaded - setting up window functions...");

+import { getCitadels } from "../map/territory-service.js";
 import { initPvP } from "../gameplay/pvp.js";
 import { initKingdom } from "../map/kingdom.js";
+import { initDiscoveryService } from "./discovery-service.js";

 import { initLogger } from "./logger.js";

@@ -463,6 +466,18 @@ async function init() {
     // Initialize PvP & Stats
     initPvP();
     initKingdom();
+
+    // Initialize Discovery Service before H3
+    initDiscoveryService({
+      saveCastle: async (castle) => {
+        return saveDiscoveredCastle(castle);
+      },
+      loadCastles: async () => {
+        // Use existing citadels loaded from Firestore as the dedup base
+        return getCitadels();
+      },
+    });
+
     // Initialize H3-based territory system (loads citadels from Firestore)
     initH3Territory().catch((e) =>
       console.warn("⚠️ H3 territory init:", e.message),
diff --git a/www/core/index.html b/www/core/index.html
index b4565c0..2a31abf 100644
--- a/www/core/index.html
+++ b/www/core/index.html
@@ -1116,6 +1116,6 @@
     <!-- Character Selection UI Loader (must load before app.js) -->
     <script src="../auth-ui/ui-loader.js"></script>

-    <script type="module" src="./app.js"></script>
+    <script type="module" src="./app.js?v=1777669522"></script>

 </html>
\ No newline at end of file
diff --git a/www/firebase/firebase-service.js b/www/firebase/firebase-service.js
index 3f9b06f..c6b6f65 100644
--- a/www/firebase/firebase-service.js
+++ b/www/firebase/firebase-service.js
@@ -1714,6 +1714,29 @@ export async function updateSpawnedObject(objectId, updates) {
 /**
  * Claim a castle in Firestore
  */
+/**
+ * Save a newly discovered castle to Firestore (H3 Discovery System)
+ * @param {Object} castleData The castle object to save
+ */
+export async function saveDiscoveredCastle(castleData) {
+  try {
+    const cid = String(castleData.id);
+    const castleRef = doc(db, "castles", cid);
+    await setDoc(castleRef, castleData, { merge: true });
+
+    // Add to local cache
+    if (_castlesCache) {
+      _castlesCache[cid] = castleData;
+    }
+
+    console.log(`🏰 Castle saved to Firestore: ${cid}`);
+    return true;
+  } catch (e) {
+    console.error("Error saving discovered castle:", e);
+    throw e;
+  }
+}
+
 export async function claimCastle(castleId, castleData) {
   if (!db) return;

diff --git a/www/maintenance/admin-citadel-generator.js b/www/maintenance/admin-citadel-generator.js
index 0f55500..f44bc5f 100644
--- a/www/maintenance/admin-citadel-generator.js
+++ b/www/maintenance/admin-citadel-generator.js
@@ -1,6 +1,7 @@
 import { OverpassService } from "../map/overpass-service.js";
 import { generateCityTerritory } from "../map/territory-service.js";
 import { CITY_ANCHORS } from "../gameplay/data.js";
+import { createRNG, hashSeed } from "../gameplay/zone-generator.js";

 /**
  * Ensures Turf is loaded on window
@@ -29,6 +30,7 @@ export async function generateCitadelsAndZones(
   if (!city) throw new Error("Invalid city");

   const turf = await ensureTurf();
+  const rng = createRNG(hashSeed(cityKey));

   // 1. Resolve Area ID & Boundary
   const ctx = await OverpassService.fetchCityContext(
@@ -120,7 +122,7 @@ export async function generateCitadelsAndZones(

         if (citadelTemplate) {
           processedCitadels.push({
-            id: `${cityKey}_citadel_${Math.random().toString(36).substring(2, 9)}`,
+            id: `${cityKey}_citadel_${rng().toString(36).substring(2, 9)}`,
             type: "castle",
             cityId: cityKey,
             lat,
@@ -175,11 +177,9 @@ export async function generateCitadelsAndZones(
     while (processedCitadels.length < targetCapacity && attempts < 1000) {
       attempts++;
       const lat =
-        cityBounds.minLat +
-        Math.random() * (cityBounds.maxLat - cityBounds.minLat);
+        cityBounds.minLat + rng() * (cityBounds.maxLat - cityBounds.minLat);
       const lng =
-        cityBounds.minLng +
-        Math.random() * (cityBounds.maxLng - cityBounds.minLng);
+        cityBounds.minLng + rng() * (cityBounds.maxLng - cityBounds.minLng);

       let isInside = true;
       if (cityBoundary) {
@@ -188,7 +188,7 @@ export async function generateCitadelsAndZones(

       if (isInside && citadelTemplate) {
         processedCitadels.push({
-          id: `${cityKey}_citadel_${Math.random().toString(36).substring(2, 9)}`,
+          id: `${cityKey}_citadel_${rng().toString(36).substring(2, 9)}`,
           type: "castle",
           cityId: cityKey,
           lat,
diff --git a/www/map/map.js b/www/map/map.js
index 0f4ef98..5181e0a 100644
--- a/www/map/map.js
+++ b/www/map/map.js
@@ -826,14 +826,12 @@ export function updatePlayerPosition(lat, lng) {
           `🏰 Discovered ${newCastles.length} new landmark(s)!`,
           "success",
         );
-        // Update territory-service cache with new castles
-        const allCastles = getDiscoveredCastles();
-        setCitadels(allCastles);
-        // Recompute and redraw territory boundaries
-        _updateTerritoryCanvas();
+        // Note: We don't need to manually call setCitadels() here because
+        // saveDiscoveredCastle writes to Firestore, which immediately triggers
+        // our subscribeToCastles listener, updating the map automatically.
       }
     })
-    .catch(() => {}); // Swallow errors — discovery is non-critical
+    .catch((err) => console.warn("Discovery check failed:", err));

   // Check for new POIs (Castles/Shops)
   checkAndFetchPOIs();
@@ -1785,16 +1783,23 @@ export async function initH3Territory() {
       );
     });

-    // Also merge any locally discovered castles
-    const discovered = getDiscoveredCastles();
-    if (discovered && discovered.length > 0) {
-      const existing = getCitadels();
-      const existingIds = new Set(existing.map((c) => c.id));
-      const newOnes = discovered.filter((c) => !existingIds.has(c.id));
-      if (newOnes.length > 0) {
-        setCitadels([...existing, ...newOnes]);
-        _updateTerritoryCanvas();
-      }
+    // Trigger initial H3 discovery on load
+    if (gameState && gameState.player && gameState.player.position) {
+      const { lat, lng } = gameState.player.position;
+      checkDiscovery(lat, lng)
+        .then((newCastles) => {
+          if (newCastles && newCastles.length > 0) {
+            console.log(
+              `🏰 Initial discovery: ${newCastles.length} new castle(s)!`,
+            );
+            showNotification(
+              `🏰 Discovered ${newCastles.length} new landmark(s)!`,
+              "success",
+            );
+            // Firebase snapshot listener will handle state update automatically
+          }
+        })
+        .catch(() => {});
     }
   } catch (e) {
     console.warn("⚠️ H3 territory init failed:", e.message);

```


## Assistant

<thinking>
**Listing Uncommitted Changes**

I've identified several modified files with uncommitted changes: `CLAUDE.md`, `README.md`, `docs/PRD.md`, `firebase/firestore.rules`, and files in `www` directory: `www/core/app.js`, `www/core/index.html` and `www/firebase/firebase-service.js`. These are currently the focus of my attention.



</thinking>

**Tool Call: dir www\core\discovery-service.js**
Status: Completed

Terminal:
```
dir: cannot access 'wwwcorediscovery-service.js': No such file or directory





```


**Tool Call: ls -la www/core/**
Status: Completed

Terminal:
```
total 206
drwxr-xr-x 1 user 197121     0 May  1 23:05 .
drwxr-xr-x 1 user 197121     0 Apr 26 18:52 ..
-rw-r--r-- 1 user 197121 45845 May  1 23:41 app.js
-rw-r--r-- 1 user 197121  2380 Apr 18 16:31 bridge.js
-rw-r--r-- 1 user 197121   126 Jan 27 20:27 capacitor.js
-rw-r--r-- 1 user 197121  1719 Apr 18 15:46 diagnostics.js
-rw-r--r-- 1 user 197121 10500 Apr 26 18:47 discovery-service.js
-rw-r--r-- 1 user 197121  5249 Apr 18 15:47 gameState.js
-rw-r--r-- 1 user 197121  4854 Apr 26 14:29 geometry-utils.js
-rw-r--r-- 1 user 197121  6946 Apr 26 18:58 h3-spatial.js
-rw-r--r-- 1 user 197121  7760 Apr 26 19:50 h3-territory.js
-rw-r--r-- 1 user 197121 67300 May  1 23:05 index.html
-rw-r--r-- 1 user 197121  3933 Apr 27 00:00 logger.js
-rw-r--r-- 1 user 197121   395 Feb  1 18:59 manifest.json
-rw-r--r-- 1 user 197121  7891 Apr 26 17:00 procedural-engine.js
-rw-r--r-- 1 user 197121  9502 Apr 26 18:53 territory-math.js

```


