const fs = require('fs');

function patchFile(filepath, isCastles) {
    let content = fs.readFileSync(filepath, 'utf8');

    // 1. Add the blocking check if no zones
    // We look for where zones are generated.
    let detectStr = isCastles
        ? `if (existingCitadels.length >= 2 && !zonesGeoJson) {`
        : `if (citadels.length >= 2 && !zonesGeoJson) {`;

    let endOfTryCatch = `}\n    }`;

    // Actually, let's just insert it before Overpass API logging
    let overpassLog = `logConsole(\`📡 Connecting to Overpass API`;
    if (content.includes(overpassLog)) {
        let blockCheck = isCastles
            ? `\n    if (existingCitadels.length < 2 && !zonesGeoJson) {\n        alert("Спочатку згенеруйте зони (Цитаделі) в табі Castles!");\n        return;\n    }\n\n`
            : `\n    if (citadels.length < 2 && !zonesGeoJson) {\n        alert("Спочатку згенеруйте зони (Цитаделі) в табі Castles!");\n        return;\n    }\n\n`;

        if (!content.includes('alert("Спочатку згенеруйте зони')) {
            content = content.replace(overpassLog, blockCheck + '    ' + overpassLog);
        }
    } else {
        console.log("Could not find overpass log in " + filepath);
    }

    // 2. Capacity calculation & 3. Zone Placement Logic & 4. Cleanup
    // We look for the start of the zone-based distribution logic.
    let distStart = `if (zonesGeoJson && zonesGeoJson.features.length > 0) {`;

    // We need to replace the entire block from distStart to the end of the `else` grid-based block.
    // The easiest way is to find the bounds using indices.

    let startIdx = content.indexOf(`const totalWeight = selectionList.reduce((sum, t) => sum + t.weight, 0);`);
    if (startIdx === -1) {
        console.log("Could not find start marker in " + filepath);
        return;
    }

    // Finding the end of the grid-based fallback.
    // In admin-shops.js, it ends right before `logConsole(\`🏁 Map generation complete! Generated \${generatedShops.length} shops.\`);`
    let endMarker = isCastles
        ? 'const mergedObjects = ['
        : 'const mergedObjects = [';

    let endIdx = content.indexOf(endMarker, startIdx);
    if (endIdx === -1) {
        console.log("Could not find end marker in " + filepath);
        return;
    }

    let processedArr = isCastles ? 'processedCastles' : (filepath.includes('vault') ? 'processedShops' : 'processedShops');
    if (filepath.includes('vault')) processedArr = 'processedShops'; // The vaults script also uses processedShops inside processNodesInternal apparently... wait let me check the file outline. Vaults outline: `let processedShops [L630]`. Yes, it reuses the variable name.

    let generatedArr = isCastles ? 'newCastles' : 'generatedShops';
    let hpInit = isCastles ? `,\n                            hp: (template.level || 1) * 100,\n                            maxHp: (template.level || 1) * 100` : '';

    let newLogic = `const exactTemplatePool = [];
        Array.from(activeRules.entries()).forEach(([id, weight]) => {
            const t = templates.find((temp) => temp.id === id);
            if (!t) return;
            const count = totalWeight > 0 ? Math.round(capacity * (weight / totalWeight)) : 0;
            for (let i = 0; i < count; i++) {
                exactTemplatePool.push({ ...t });
            }
        });

        const zonesById = {};
        zonesGeoJson.features.forEach((f, idx) => {
            let id = f.properties?.citadelId || f.properties?.id || f.id;
            if (!id || id === "Citadel" || id === "Castle") {
                id = \`zone_\${idx}\`;
            }
            if (!zonesById[id]) zonesById[id] = [];
            zonesById[id].push(f);
        });

        const uniqueZoneIds = Object.keys(zonesById);

        uniqueZoneIds.forEach((citadelId) => {
            const zoneFeatures = zonesById[citadelId];

            const zoneOsm = ${processedArr}.filter(pt =>
                zoneFeatures.some(f => turf.booleanPointInPolygon([pt.lng, pt.lat], f))
            );

            const zoneTemplatePool = exactTemplatePool.slice().sort(() => Math.random() - 0.5);

            for (const template of zoneTemplatePool) {
                const matchIdx = zoneOsm.findIndex(node => node.templateId === template.id);
                if (matchIdx !== -1) {
                    const node = zoneOsm[matchIdx];
                    ${generatedArr}.push({
                        ...template,
                        lat: node.lat,
                        lng: node.lng,
                        cityId: cityKey,
                        zoneId: citadelId${hpInit}
                    });
                    zoneOsm.splice(matchIdx, 1);
                } else {
                    const randomFeature = zoneFeatures[Math.floor(Math.random() * zoneFeatures.length)];
                    const rndPt = generateRandomPointInPolygon(randomFeature);
                    if (rndPt) {
                        ${generatedArr}.push({
                            ...template,
                            lat: rndPt.lat,
                            lng: rndPt.lng,
                            cityId: cityKey,
                            zoneId: citadelId${hpInit}
                        });
                    }
                }
            }
        });

        `;

    content = content.substring(0, startIdx) + newLogic + content.substring(endIdx);

    // D: Cleanup the pick... functions
    let pickFunc = isCastles ? 'pickCastleTemplateByWeight' : (filepath.includes('vault') ? 'pickVaultTemplateByWeight' : 'pickShopTemplateByWeight');
    let pickStart = content.indexOf(`function ${pickFunc}`);
    if (pickStart !== -1) {
        // the function is at the end of the file
        content = content.substring(0, pickStart);
    }

    fs.writeFileSync(filepath, content, 'utf8');
    console.log("Successfully patched " + filepath);
}

patchFile('www/maintenance/admin-shops.js', false);
patchFile('www/maintenance/admin-vaults.js', false);
patchFile('www/maintenance/admin-castles.js', true);
