const fs = require('fs');
const content = fs.readFileSync('www/maintenance/admin-world.js', 'utf8');

const startIndex = content.indexOf('// 2. Build remaining objects (Monsters, Shops, Vaults, Castles) using grid');
const endIndex = content.indexOf('// 3. Save Snapshots');

if (startIndex === -1 || endIndex === -1) {
    console.log('Could not find boundaries');
    process.exit(1);
}

const replacement = `// 2. Build remaining objects using Zone Quotas
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
                    id: \`\${city.id}_\${type}_\${Math.random().toString(36).substring(2, 9)}\`,
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

            `;

const newContent = content.substring(0, startIndex) + replacement + content.substring(endIndex);
fs.writeFileSync('www/maintenance/admin-world.js', newContent, 'utf8');
console.log('Update successful');
