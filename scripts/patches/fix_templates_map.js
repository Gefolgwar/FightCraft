const fs = require('fs');
const path = require('path');

const mapPath = path.join(__dirname, '../../www/map/templates_map.html');
let content = fs.readFileSync(mapPath, 'utf8');

const targetStr = '<div class="text-[10px] text-gray-500">\n                            History of world generations\n                        </div>';

if (content.includes(targetStr) && !content.includes('window.generateGlobalWorld()')) {
    const buttonHtml = `\n                        <button onclick="window.generateGlobalWorld()" class="mt-2 w-full py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded-lg text-xs font-bold border border-yellow-500 shadow-lg shadow-yellow-900/50 transition flex items-center justify-center gap-2">🌍 Generate Full World</button>`;
    content = content.replace(targetStr, targetStr + buttonHtml);
    fs.writeFileSync(mapPath, content);
    console.log("Successfully added button to templates_map.html");
} else {
    console.log("Could not find target string or button already exists.");
}
