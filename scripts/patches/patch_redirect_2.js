const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf-8');

code = code.replace(
  /window\.location\.href\s*=\s*['"]\/auth-ui\/login\.html['"];/g,
  "// window.location.href = '/auth-ui/login.html';"
);

code = code.replace(
  /window\.location\.href\s*=\s*['"]\.\.\/index\.html['"];/g,
  "// window.location.href = '../index.html';"
);

fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log('Patched all redirections');
