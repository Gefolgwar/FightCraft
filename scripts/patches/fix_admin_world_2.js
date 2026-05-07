const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../www/maintenance/admin-world.js');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
    /\$\{Math\.random\(\)\.toString\(36\)\.substring\(2, 9\)\}/g,
    '${rng.generateId()}'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("admin-world.js ids fixed");
