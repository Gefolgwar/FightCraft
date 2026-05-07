const fs = require('fs');
const file = 'www/gameplay/sync-engine.js';
let data = fs.readFileSync(file, 'utf8');

const clientGenLogic = `
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
      
      console.log(\`🏙️ Generating city: \${city.name} (Seed: \${seed})\`);
      
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
          console.error(\`Failed to generate Voronoi for \${city.name}:\`, e);
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
          id: \`\${cityId}_\${type}_\${rng.generateId()}\`,
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
`;

// Insert the generateClientWorld function into SyncEngine
data = data.replace('// ================== INDEXEDDB HELPERS ==================', clientGenLogic + '\n  // ================== INDEXEDDB HELPERS ==================');

// Now update the main syncWorld logic
const newSyncLogic = `
      // 4. Update Needed
      console.log("🔄 SyncEngine: Update detected.");
      
      try {
         const objects = await this.generateClientWorld(firestoreDb);
         if (objects && objects.length > 0) {
             console.log(\`✅ SUCCESS. Deterministic Generation produced \${objects.length} objects.\`);
             await this.saveTransaction(objects, serverTime, serverHash);
             return objects;
         }
      } catch (err) {
         console.warn("[WORLD] ❌ Client Generation Failed. Falling back to Full Sync.", err.message);
      }

      // Force FULL sync if client generation failed or returned nothing
      return await this.performFullSync(firestoreDb, serverTime, serverHash);
`;

data = data.replace(/\/\/ STRATEGY: Try Bundle First[\s\S]*?return await this\.performDeltaSync\([\s\S]*?\}\n/, newSyncLogic);

fs.writeFileSync(file, data);
console.log("Patched sync-engine.js");
