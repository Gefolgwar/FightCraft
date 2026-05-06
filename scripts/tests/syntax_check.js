const fs = require('fs');
const html = fs.readFileSync('www/map/templates_map.html', 'utf-8');
const scriptContent = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
fs.writeFileSync('/tmp/test_script.js', scriptContent);
