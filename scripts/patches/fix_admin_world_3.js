const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../www/maintenance/admin-world.js');
let content = fs.readFileSync(filePath, 'utf8');

// Strip objects and zones, and add seed to the snapshot
const target = `const snapshotData = {
          id: \`GlobalGen_\${city.id}_\${Date.now()}_\${chunkIndex}\`,
          name: snapshotName,
          description: \`Auto-generated from global world algorithm (\${chunk.length} objects)\`,
          cityId: city.id,
          type: "mixed",
          objects: chunk,
          zones:
            chunkIndex === 0 && zonesGeoJson
              ? JSON.stringify(zonesGeoJson)
              : null,
        };`;

const replacement = `const snapshotData = {
          id: \`GlobalGen_\${city.id}_\${Date.now()}_\${chunkIndex}\`,
          name: snapshotName,
          description: \`Auto-generated from global world algorithm (Seed: \${globalSeed})\`,
          cityId: city.id,
          type: "mixed",
          seed: globalSeed,
          config: {
              monsterCount: counts.monster,
              shopCount: counts.shop,
              vaultCount: counts.vault,
              castleCount: counts.castle,
              citadelCount: counts.citadel
          }
          // Objects and zones are excluded to respect 1MB limit.
          // They will be regenerated on the client dynamically using the seed!
        };`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("admin-world.js snapshotData fixed");
} else {
    // Maybe whitespace is slightly different. Let's do regex or generic replacement
    content = content.replace(/objects: chunk,/g, '// objects: chunk,');
    content = content.replace(/type: "mixed",/g, 'type: "mixed",\n          seed: globalSeed,\n          config: counts,');
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("admin-world.js snapshotData fallback fixed");
}

