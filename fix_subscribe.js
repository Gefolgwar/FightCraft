const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf8');

const regex = /export function subscribeToCastles\(onUpdate\) \{\s*if \(\!db\) return \(\) => \{\};\s*try \{\s*const \{ collection, query \} = window\.firebaseFirestore \|\| \{[\s\S]*?\};\s*const q = query\(collection\(db, "castles"\)\);/m;

const replacement = `export function subscribeToCastles(onUpdate) {
  if (!db) return () => {};

  try {
    const q = query(collection(db, "castles"));`;

code = code.replace(regex, replacement);
fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log("Fixed subscribeToCastles");
