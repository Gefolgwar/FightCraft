const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf-8');

code = code.replace(
  "window.location.href = '/auth-ui/login.html';",
  "// window.location.href = '/auth-ui/login.html';"
);

fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log('Patched redirection');
