const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../www/maintenance/admin-world.js');
let content = fs.readFileSync(filePath, 'utf8');

// Add SeededRandom import
if (!content.includes('SeededRandom')) {
    content = content.replace(
        'import { OverpassService } from "../map/overpass-service.js";',
        'import { OverpassService } from "../map/overpass-service.js";\nimport { SeededRandom } from "../core/random.js";'
    );
}

// Inside generateGlobalWorld, add seed
if (content.includes('window.generateGlobalWorld = async () => {') && !content.includes('const globalSeed =')) {
    content = content.replace(
        'window.generateGlobalWorld = async () => {',
        'window.generateGlobalWorld = async () => {\n  const globalSeed = Math.floor(Math.random() * 2147483647);\n  const rng = new SeededRandom(globalSeed);\n'
    );
}

// Replace Math.random with rng calls
content = content.replace(/Math\.random\(\)/g, 'rng.next()');
content = content.replace(/rng\.next\(\)\.toString/g, 'Math.random().toString'); // Restore toString(36) for IDs if we want them unique, but wait, seeded PRNG for ID is rng.generateId()!
content = content.replace(/\$\{rng\.next\(\)\.toString\(36\)\.substring\(2, 9\)\}/g, '${rng.generateId()}');

// Add seed to snapshot
content = content.replace(
    'cityId: city.id,',
    'cityId: city.id,\n          seed: globalSeed,'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("admin-world.js patched");
