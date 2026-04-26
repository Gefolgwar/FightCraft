const fs = require('fs');
let code = fs.readFileSync('www/map/map.js', 'utf8');

const replacement = `
  poiCluster = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 17,
    maxClusterRadius: 120, // INCREASED: More items per group
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 20,
    animate: false,
  });
  map.addLayer(poiCluster);

  citadelLayerGroup = L.layerGroup();
  map.addLayer(citadelLayerGroup);
`;

code = code.replace('  poiCluster = L.', replacement);
fs.writeFileSync('www/map/map.js', code);
console.log("Fixed poiCluster and added citadelLayerGroup.");
