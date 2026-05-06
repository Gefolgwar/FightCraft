const fs = require('fs');
let html = fs.readFileSync('www/map/templates_map.html', 'utf-8');

const target = `                            const success = await saveWorldSnapshot(newSnapshot);
                            
                            if (success) {`;

const replacement = `                            let success = false;
                            try {
                                success = await saveWorldSnapshot(newSnapshot);
                            } catch (err) {
                                console.error("Caught error in saveWorldSnapshot:", err);
                                alert("Error during save: " + err.message);
                            }
                            
                            if (success) {`;

html = html.replace(target, replacement);
fs.writeFileSync('www/map/templates_map.html', html);
console.log('Patched templates_map.html for better error logging');
