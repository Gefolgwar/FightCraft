const fs = require('fs');
let html = fs.readFileSync('www/map/templates_map.html', 'utf-8');

const target = `                            let success = false;
                            try {
                                success = await saveWorldSnapshot(newSnapshot);
                            } catch (err) {
                                console.error("Caught error in saveWorldSnapshot:", err);
                                alert("Error during save: " + err.message);
                            }`;

const replacement = `                            let success = false;
                            try {
                                console.log("Preparing to save newSnapshot...", newSnapshot);
                                const sizeStr = JSON.stringify(newSnapshot).length;
                                console.log("New snapshot size approx:", sizeStr);
                                
                                // Call directly to see where it fails if saveWorldSnapshot swallows error
                                success = await saveWorldSnapshot(newSnapshot);
                                console.log("saveWorldSnapshot returned:", success);
                            } catch (err) {
                                console.error("Caught error in saveWorldSnapshot:", err);
                                alert("Error during save: " + err.message);
                            }`;

html = html.replace(target, replacement);
fs.writeFileSync('www/map/templates_map.html', html);
console.log('Patched with debug logs');
