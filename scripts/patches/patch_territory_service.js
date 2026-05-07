const fs = require('fs');
const file = 'www/map/territory-service.js';
let data = fs.readFileSync(file, 'utf8');

const clientZoneCheck = `
export async function getTerritoryZones(cityId) {
  // 1. Return from local memory if available
  if (_localZoneCache[cityId]) return _localZoneCache[cityId];

  // 1.5. Check client-side generated zones
  if (window._clientGeneratedZones) {
     const cityZone = window._clientGeneratedZones.find(z => z.id === cityId);
     if (cityZone && cityZone.features) {
         const geoJson = { type: "FeatureCollection", features: cityZone.features };
         _localZoneCache[cityId] = geoJson;
         return geoJson;
     }
  }

  // 2. Fetch from Database
`;

data = data.replace(/export async function getTerritoryZones\(cityId\) \{\n  \/\/ 1\. Return from local memory if available\n  if \(_localZoneCache\[cityId\]\) return _localZoneCache\[cityId\];\n\n  \/\/ 2\. Fetch from Database/, clientZoneCheck.trim());

fs.writeFileSync(file, data);
console.log("Patched territory-service.js");
