const fs = require('fs');

const code = `window.generateSnapshotZones = async function () {
    const citadelsByCity = _lastCitadelsByCity;
    if (!citadelsByCity) {
        alert('No snapshot loaded');
        return;
    }

    const statusEl = document.getElementById('recalc-status');
    if (statusEl) {
        statusEl.innerText = 'Generating zones...';
        statusEl.className = 'text-[10px] font-bold text-yellow-400 animate-pulse';
    }

    if (districtLayerGroup) districtLayerGroup.clearLayers();
    if (cityBoundaryLayerGroup) cityBoundaryLayerGroup.clearLayers();

    try {
        const turf = window.turf;
        if (!turf) {
            alert('Turf.js not loaded');
            return;
        }

        const allCitadels = Object.values(citadelsByCity).flat();
        if (allCitadels.length === 0) return;

        const seen = new Set();
        const unique = [];
        for (const c of allCitadels) {
            const key = \`\${c.lat.toFixed(6)}_\${c.lng.toFixed(6)}\`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(c);
            }
        }

        const allPoints = turf.featureCollection(
            unique.map((c, i) =>
                turf.point([c.lng, c.lat], {
                    id: c.id,
                    name: c.name || \`Citadel \${i + 1}\`,
                    cityId: c.cityId,
                    citadelId: c.id || \`citadel_\${i}\`
                })
            )
        );

        logConsole(\`Fast Zone Generation: \${unique.length} citadels\`);

        if (unique.length >= 2) {
            const voronoiFc = window.generateVoronoiFromCitadels ? window.generateVoronoiFromCitadels(allPoints, 'global') : null;
            if (voronoiFc && voronoiFc.features) {
                await renderDistrictsFromData(voronoiFc.features.map(f => {
                    const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates[0][0] : []);
                    return { points: coords.map(c => ({ lat: c[1], lng: c[0] })) };
                }));
            }
        } else if (unique.length === 1) {
            const center = turf.point(allPoints.features[0].geometry.coordinates);
            const buffered = turf.buffer(center, 5, { units: 'kilometers' });
            buffered.properties = allPoints.features[0].properties;
            await renderDistrictsFromData([{
                points: buffered.geometry.coordinates[0].map(c => ({ lat: c[1], lng: c[0] }))
            }]);
        }

        if (statusEl) {
            statusEl.innerText = \`\${unique.length} zones generated\`;
            statusEl.className = 'text-[10px] font-bold text-emerald-400';
        }

        if (currentSnapshot) {
            if (statusEl) {
                statusEl.innerText = 'Saving template config...';
                statusEl.className = 'text-[10px] font-bold text-yellow-400 animate-pulse';
            }

            const updatedSnapshot = {
                ...currentSnapshot,
                zoneConfig: {
                    generated: true,
                    algorithm: 'fast_euclidean',
                },
            };

            if (!updatedSnapshot.seed) {
                updatedSnapshot.seed = Math.floor(Math.random() * 2147483647);
            }

            updatedSnapshot.zones = JSON.stringify(allPoints);

            let success = false;
            try {
                const sizeStr = JSON.stringify(updatedSnapshot).length;
                console.log('New snapshot size approx:', sizeStr);

                if (updatedSnapshot.id && updatedSnapshot.id.startsWith('local_')) {
                    try {
                        await LocalSnapshotsManager.saveSnapshot(updatedSnapshot);
                        success = true;
                    } catch (localErr) {
                        console.error('Local save error:', localErr);
                        alert('Failed to save local snapshot: ' + localErr.message);
                    }
                } else {
                    if (sizeStr > 1040000) {
                        alert(\`The generated template is too large (\${Math.round(sizeStr / 1024)} KB). Limit is 1024 KB. Cannot save.\`);
                    } else {
                        success = await saveWorldSnapshot(updatedSnapshot);
                        if (!success) {
                            alert('saveWorldSnapshot returned false. Check console for "Snapshot save error"');
                        }
                    }
                }
            } catch (err) {
                console.error('Snapshot generation error:', err);
                alert('Error generating zones: ' + err.message);
            }

            if (success) {
                currentSnapshot = updatedSnapshot;
                if (statusEl) {
                    statusEl.innerText = \`✅ Saved config for \${unique.length} zones!\`;
                    statusEl.className = 'text-[10px] font-bold text-green-400';
                }
                if (typeof window.loadSnapshots === 'function') {
                    window.loadSnapshots();
                } else if (typeof loadSnapshots === 'function') {
                    loadSnapshots();
                }
            }
        }
    } catch (e) {
        console.error('Zone generation failed:', e);
        if (statusEl) {
            statusEl.innerText = 'Error: ' + e.message;
            statusEl.className = 'text-[10px] font-bold text-red-400';
        }
    }
}`;

let html = fs.readFileSync('www/map/templates_map.html', 'utf8');
const startStr = 'window.generateSnapshotZones = async function () {';
const startIdx = html.indexOf(startStr);
if (startIdx === -1) throw new Error('Could not find start');

let braceCount = 0;
let endIdx = -1;
let started = false;

for (let i = startIdx; i < html.length; i++) {
    if (html[i] === '{') {
        braceCount++;
        started = true;
    } else if (html[i] === '}') {
        braceCount--;
    }
    
    if (started && braceCount === 0) {
        endIdx = i + 1;
        break;
    }
}

if (endIdx === -1) throw new Error('Could not find end');

html = html.substring(0, startIdx) + code + html.substring(endIdx);
fs.writeFileSync('www/map/templates_map.html', html);
console.log('Patch applied successfully!');
