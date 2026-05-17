import {
  getDB,
  getTemplates,
  saveCityZones,
  saveWorldSnapshot,
} from "../firebase/firebase-service.js";
import { CITY_ANCHORS } from "../gameplay/data.js";
import { WORLD_CITIES } from "../gameplay/world_cities.js";
import { generateCityTerritory } from "../map/territory-service.js";
import { OverpassService } from "../map/overpass-service.js";
import { SeededRandom } from "../core/random.js";
import {
  collection,
  writeBatch,
  doc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Helper for delays
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function fetchCityPopulation(city) {
  const query = `[out:json][timeout:10];
    (
        node(around:20000, ${city.lat}, ${city.lng})["place"~"city|town|municipality"]["name"="${city.name}"];
        node(around:20000, ${city.lat}, ${city.lng})["place"~"city|town|municipality"]["name:en"="${city.name}"];
    );
    out tags;`;

  const data = await OverpassService.fetchJSON(query);

  if (!data || !data.elements || data.elements.length === 0) {
    throw new Error(`OSM node for ${city.name} not found.`);
  }

  const populationStr = data.elements[0].tags.population;
  if (!populationStr) {
    throw new Error(`Population tag missing for ${city.name}.`);
  }

  const population = parseInt(populationStr, 10);
  if (isNaN(population)) {
    throw new Error(
      `Invalid population data for ${city.name}: ${populationStr}`,
    );
  }

  return population;
}

