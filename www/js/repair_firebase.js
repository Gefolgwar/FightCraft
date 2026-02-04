
const fs = require('fs');
const path = require('path');

const targetPath = 'd:/Project/test game/capacitor-project/www/js/firebase-service.js';
const fixedBasePath = 'd:/Project/test game/capacitor-project/www/js/firebase-service.js.fixed';
const appendPath = 'd:/Project/test game/capacitor-project/www/js/firebase-service.js_append';

// 1. Read Base (1-1360)
let content = fs.readFileSync(fixedBasePath, 'utf8');

// 2. Complete saveCityZones
if (!content.includes('return false;\n    }\n}')) {
    content += '\n        return false;\n    }\n}\n';
}

// 3. Add getCityZones
const getCityZonesCode = `
/**
 * Fetch zones for a city
 */
export async function getCityZones(cityId) {
    try {
        const snap = await getDoc(doc(db, 'city_zones', cityId));    
        if (snap.exists()) {
            const data = snap.data();
            // Automatically parse if stored as string
            if (typeof data.geoJson === 'string') {
                try {
                    data.geoJson = JSON.parse(data.geoJson);
                } catch (parseErr) {
                    console.error("Failed to parse cached GeoJSON:", parseErr);
                    return null;
                }
            }
            return data;
        }
        return null;
    } catch (e) {
        console.error('Error fetching city zones:', e);
        return null;
    }
}
`;

content += getCityZonesCode;

// 4. Add Optimized Query Functions from the append file
const appendContent = fs.readFileSync(appendPath, 'utf8');
content += appendContent;

// 5. Write back to file
fs.writeFileSync(targetPath, content, 'utf8');
console.log('✅ firebase-service.js repaired successfully.');
