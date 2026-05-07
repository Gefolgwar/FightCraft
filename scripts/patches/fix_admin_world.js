const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../www/maintenance/admin-world.js');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
    'const globalSeed = Math.floor(rng.next() * 2147483647);',
    'const globalSeed = Math.floor(Math.random() * 2147483647);'
);

fs.writeFileSync(filePath, content, 'utf8');
console.log("admin-world.js fixed");
