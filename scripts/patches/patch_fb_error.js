const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf-8');

code = code.replace(
  'console.error("Snapshot save error:", e);\n    return false;',
  'console.error("Snapshot save error:", e);\n    if (typeof alert === "function") alert("Snapshot save error: " + e.message);\n    return false;'
);

fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log('Patched firebase-service.js to alert the error');
