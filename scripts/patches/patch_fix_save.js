const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf-8');

code = code.replace(
  'createdBy: currentUser.email,',
  'createdBy: (currentUser && currentUser.email) ? currentUser.email : "admin@fightcraft.com",'
);

fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log('Patched firebase-service.js to handle undefined currentUser.email');
