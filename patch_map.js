const fs = require('fs');
let code = fs.readFileSync('www/map/map.js', 'utf8');

const markerFn = `
function _updateCitadelMarkers() {
  if (!citadelLayerGroup) return;
  citadelLayerGroup.clearLayers();

  const citadels = getCitadels();
  if (citadels.length === 0) return;

  citadels.forEach(citadel => {
    const iconHtml = \`
      <div class="w-12 h-12 flex items-center justify-center relative bg-transparent">
          <div class="absolute inset-0 rounded-full blur-md opacity-40 bg-orange-500"></div>
          <div class="text-3xl filter drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)] z-10 leading-none select-none">🏯</div>
      </div>
    \`;

    const markerIcon = L.divIcon({
        html: iconHtml,
        className: "custom-tpl-icon",
        iconSize: [48, 48],
        iconAnchor: [24, 24]
    });

    const marker = L.marker([citadel.lat, citadel.lng], {
        icon: markerIcon,
        zIndexOffset: 3000
    });

    const ownerText = citadel.ownerName ? \`<div class="text-yellow-400 font-bold">👑 \${citadel.ownerName}</div>\` : \`<div class="text-gray-400 italic">Unclaimed</div>\`;
    marker.bindTooltip(\`
        <div class="text-center p-1">
            <div class="font-bold text-lg text-orange-300">\${citadel.name || "Citadel"}</div>
            \${ownerText}
        </div>
    \`, { direction: "top", permanent: false });

    marker.on("click", () => {
        const dist = getDistance(
          gameState.player.position.lat,
          gameState.player.position.lng,
          citadel.lat,
          citadel.lng
        );
        if (dist <= 50) {
            if (window.openCitadelMenu) window.openCitadelMenu();
        } else {
            showNotification("❌ Get closer to interact with the Citadel!", "warning");
        }
    });

    citadelLayerGroup.addLayer(marker);
  });
}
`;

if (!code.includes('_updateCitadelMarkers() {')) {
  code = code.replace('function _updateTerritoryCanvas() {', markerFn + '\nfunction _updateTerritoryCanvas() {\n  _updateCitadelMarkers();\n');
  fs.writeFileSync('www/map/map.js', code);
  console.log('map.js patched successfully');
} else {
  console.log('Already patched');
}
