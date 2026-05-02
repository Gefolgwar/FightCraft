const cities = require('all-the-cities');
const fs = require('fs');

const threshold = 100000;
const filteredCities = cities.filter(city => city.population >= threshold);

console.log(`Found ${filteredCities.length} cities with population >= ${threshold}`);

const mappedCities = filteredCities.map(city => ({
    id: city.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
    name: city.name,
    lat: city.loc.coordinates[1],
    lng: city.loc.coordinates[0],
    population: city.population,
    country: city.country
}));

const idCounts = {};
mappedCities.forEach(city => {
    if (idCounts[city.id]) {
        idCounts[city.id]++;
        city.id = `${city.id}-${idCounts[city.id]}`;
    } else {
        idCounts[city.id] = 1;
    }
});

const fileContent = `export const WORLD_CITIES = ${JSON.stringify(mappedCities, null, 2)};\n`;
fs.writeFileSync('www/gameplay/world_cities.js', fileContent);
console.log('Saved to www/gameplay/world_cities.js');
