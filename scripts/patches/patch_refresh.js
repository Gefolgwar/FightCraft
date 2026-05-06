const fs = require('fs');

let html = fs.readFileSync('www/map/templates_map.html', 'utf-8');

const target = `                                logConsole(\`Saved new snapshot: \${newSnapshot.name}\`);
                            } else {`;

const replacement = `                                logConsole(\`Saved new snapshot: \${newSnapshot.name}\`);
                                
                                // Refresh the snapshot list to show the new template
                                if (typeof window.loadSnapshots === 'function') {
                                    window.loadSnapshots();
                                } else if (typeof loadSnapshots === 'function') {
                                    loadSnapshots();
                                }
                            } else {`;

html = html.replace(target, replacement);
fs.writeFileSync('www/map/templates_map.html', html);
console.log('Patched templates_map.html with loadSnapshots()');
