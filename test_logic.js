import fs from 'fs';
import { CITY_ANCHORS } from "./www/gameplay/data.js";
import { generateCitadelsAndZones } from "./www/maintenance/admin-citadel-generator.js";

// We need to mock OverpassService or let it run. It uses fetch. 
// node 18+ has global fetch.

async function run() {
    global.window = {};
    const city = CITY_ANCHORS[0]; // Berlin
    console.log("Testing:", city.name);
    try {
        const res = await generateCitadelsAndZones(city.id, 10, []);
        console.log("Success:", res.finalCitadels.length);
        
        // Test boundary logic
        const cityBoundary = res.cityBoundary;
        if (cityBoundary) {
            console.log("Boundary type:", cityBoundary.geometry.type);
            const coords = cityBoundary.geometry.coordinates[0];
            const latLngs = coords.map((c) => [c[1], c[0]]);
            console.log("Mapped coords successfully");
        }
    } catch(e) {
        console.error("CAUGHT ERROR:", e);
    }
}
run();
