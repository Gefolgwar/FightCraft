const fs = require('fs');
let code = fs.readFileSync('www/map/templates_map.html', 'utf-8');

const target = `                            try {
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

const replacement = `                            try {
                                console.log("Preparing to save newSnapshot...", newSnapshot);
                                
                                // Truncate coordinates to save space (5 decimals = ~1m accuracy)
                                if (window.turf && window.turf.truncate) {
                                    newSnapshot.zones = JSON.stringify(window.turf.truncate(clipped, {precision: 5, coordinates: 2}));
                                }
                                
                                const sizeStr = JSON.stringify(newSnapshot).length;
                                console.log("New snapshot size approx:", sizeStr);
                                
                                if (sizeStr > 1040000) {
                                    alert("The generated template is too large (" + Math.round(sizeStr/1024) + " KB). Limit is 1024 KB. Cannot save.");
                                } else {
                                    success = await saveWorldSnapshot(newSnapshot);
                                    if (!success) {
                                        alert("saveWorldSnapshot returned false. Check console for 'Snapshot save error'");
                                    }
                                }
                            } catch (err) {
                                console.error("Caught error in saveWorldSnapshot:", err);
                                alert("Error during save: " + err.message);
                            }`;

code = code.replace(target, replacement);
fs.writeFileSync('www/map/templates_map.html', code);
console.log('Patched templates_map.html with truncate and explicit alerts');
