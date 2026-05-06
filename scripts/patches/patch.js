const fs = require('fs');

let html = fs.readFileSync('www/map/templates_map.html', 'utf-8');

const target = `                        logConsole(
                            \`Generated \${features.length} Voronoi zones from \${landCitadels.length} land citadels\`,
                        );
                    }
                } catch (e) {`;

const replacement = `                        logConsole(
                            \`Generated \${features.length} Voronoi zones from \${landCitadels.length} land citadels\`,
                        );

                        // Save as a new snapshot
                        if (currentSnapshot) {
                            if (statusEl) {
                                statusEl.innerText = "Saving new template with zones...";
                                statusEl.className = "text-[10px] font-bold text-yellow-400 animate-pulse";
                            }
                            
                            const newSnapshot = {
                                ...currentSnapshot,
                                id: \`\${currentSnapshot.id}_zones_\${Date.now()}\`,
                                name: \`\${currentSnapshot.name} (with Zones)\`,
                                zones: JSON.stringify(clipped),
                                isActive: false
                            };
                            
                            const success = await saveWorldSnapshot(newSnapshot);
                            
                            if (success) {
                                if (statusEl) {
                                    statusEl.innerText = \`✅ Saved new template with \${features.length} zones!\`;
                                    statusEl.className = "text-[10px] font-bold text-green-400";
                                }
                                logConsole(\`Saved new snapshot: \${newSnapshot.name}\`);
                            } else {
                                if (statusEl) {
                                    statusEl.innerText = \`❌ Failed to save new template\`;
                                    statusEl.className = "text-[10px] font-bold text-red-400";
                                }
                            }
                        }
                    }
                } catch (e) {`;

html = html.replace(target, replacement);
fs.writeFileSync('www/map/templates_map.html', html);
console.log('Patched templates_map.html');
