const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../www/map/templates_map.html');
let content = fs.readFileSync(filePath, 'utf8');

// Find the snapshot saving logic in generateSnapshotZones
const target = `const newSnapshot = {
                                ...currentSnapshot,
                                id: \`\${currentSnapshot.id}_zones_\${Date.now()}\`,
                                name: \`\${currentSnapshot.name} (with Zones)\`,
                                // zones: JSON.stringify(clipped), // Removed due to size limits
                                zoneConfig: {
                                    generated: true,
                                    algorithm: "voronoi_clipped",
                                },
                                isActive: false,
                            };
                            delete newSnapshot.zones; // Ensure it's empty`;

const replacement = `const newSnapshot = {
                                ...currentSnapshot,
                                id: \`\${currentSnapshot.id}_zones_\${Date.now()}\`,
                                name: \`\${currentSnapshot.name} (with Zones)\`,
                                zoneConfig: {
                                    generated: true,
                                    algorithm: "voronoi_clipped",
                                },
                                isActive: false,
                            };
                            
                            // Remove massive data payloads from snapshot to respect 1MB limit
                            delete newSnapshot.zones;
                            delete newSnapshot.objects; // Ensure objects are NOT saved here!
                            // Add a seed if one isn't present
                            if (!newSnapshot.seed) {
                                newSnapshot.seed = Math.floor(Math.random() * 2147483647);
                            }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Patched templates_map.html successfully (version 1)");
} else {
    // Maybe the target is slightly different
    const target2 = `const newSnapshot = {
                                ...currentSnapshot,
                                id: \`\${currentSnapshot.id}_zones_\${Date.now()}\`,
                                name: \`\${currentSnapshot.name} (with Zones)\`,
                                zones: JSON.stringify(clipped),
                                isActive: false
                            };`;
                            
    const replacement2 = `const newSnapshot = {
                                ...currentSnapshot,
                                id: \`\${currentSnapshot.id}_zones_\${Date.now()}\`,
                                name: \`\${currentSnapshot.name} (with Zones)\`,
                                zoneConfig: {
                                    generated: true,
                                    algorithm: "voronoi_clipped"
                                },
                                isActive: false
                            };
                            
                            delete newSnapshot.zones;
                            delete newSnapshot.objects;
                            if (!newSnapshot.seed) {
                                newSnapshot.seed = Math.floor(Math.random() * 2147483647);
                            }`;
                            
    if (content.includes(target2)) {
        content = content.replace(target2, replacement2);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log("Patched templates_map.html successfully (version 2)");
    } else {
        console.log("Could not find the target string in templates_map.html");
    }
}
