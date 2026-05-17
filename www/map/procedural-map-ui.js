import {
  getTypesForZoom,
  generateAllCitadels,
  invalidateCitadelCache,
  generateViewportObjects,
  getViewportKey,
} from "../core/procedural-world-renderer.js";
import { generateZonesForCity, zonesToGeoJSON } from "../core/zone-engine.js";
import { clearCellCityCache } from "../core/procedural-engine-v2.js";
import { ensureH3Loaded } from "../core/h3-spatial.js";
import { getTemplates } from "../firebase/firebase-service.js";

// Internal map state
let map;
let citadelClusterGroup;
let viewportClusterGroup;
let zoneLayerGroup;
let boundaryLayerGroup;
let cities = [];
let worldCitadels = [];
let lastViewportKey = "";
let cityBoundaries = {};
let cityPOIs = {};
let zoneCache = new Map();
let totalBoundaryCount = 0;

// Configurable log callback
let logCallback = console.log;

// Default recipe configuration
let currentRecipe = {
  seed: 42,
  h3Resolution: 9,
  densityRatios: {
    monster: 1000,
    shop: 16000,
    vault: 34783,
    castle: 5000,
    citadel: 100000,
  },
  layers: {
    monsters: {
      templates: [
        { templateId: "goblin", weight: 30 },
        { templateId: "skeleton", weight: 20 },
        { templateId: "wolf", weight: 25 },
        { templateId: "orc", weight: 15 },
        { templateId: "wraith", weight: 10 },
      ],
    },
    shops: {
      templates: [
        { templateId: "weapons_shop", weight: 40 },
        { templateId: "armor_shop", weight: 30 },
        { templateId: "potion_shop", weight: 30 },
      ],
    },
    vaults: {
      templates: [
        { templateId: "ancient_vault", weight: 50 },
        { templateId: "dragon_vault", weight: 20 },
        { templateId: "cursed_vault", weight: 30 },
      ],
    },
    castles: {
      templates: [
        { templateId: "stone_fortress", weight: 40 },
        { templateId: "dark_citadel", weight: 25 },
        { templateId: "royal_castle", weight: 35 },
      ],
    },
  },
};

// Visibility state mapped to layer identifiers
const visibility = {
  monster: true,
  shop: true,
  vault: true,
  castle: true,
  citadel: true,
  district: true, // renamed from 'zone' to match templates_map.html checkbox ID
  cityBoundary: true, // renamed from 'boundary'
};

const TYPE_COLORS = {
  monster: "#ef4444",
  shop: "#22c55e",
  vault: "#a855f7",
  castle: "#f59e0b",
  citadel: "#06b6d4",
};

// Helpers
function cityColor(cityId) {
  if (!cityId) return "#888888";
  let hash = 0;
  for (let i = 0; i < cityId.length; i++) {
    hash = cityId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = ((hash % 360) + 360) % 360;
  return "hsl(" + h + ", 70%, 55%)";
}

function log(msg, cls) {
  logCallback(msg, cls);
}

function updateStats(type, val) {
  const el = document.getElementById(`stat-${type}`);
  if (el) el.textContent = val;
}

// ── Public API ──

export async function initProceduralMap(containerId, options = {}) {
  if (options.onLog) logCallback = options.onLog;
  if (options.recipe) currentRecipe = options.recipe;

  log("Initializing Procedural World Map...", "info");

  map = L.map(containerId, {
    renderer: L.canvas({ padding: 0.5 }),
    preferCanvas: true,
    worldCopyJump: false,
    minZoom: 2,
    maxZoom: 18,
  });
  window._map = map;

  map.fitBounds(
    [
      [-60, -170],
      [70, 180],
    ],
    { padding: [10, 10] },
  );

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap",
  }).addTo(map);

  citadelClusterGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 10,
    maxClusterRadius: 40,
    chunkedLoading: true,
    animate: false,
  });

  viewportClusterGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 16,
    maxClusterRadius: 60,
    chunkedLoading: true,
    animate: false,
  });
  map.addLayer(viewportClusterGroup);

  zoneLayerGroup = L.layerGroup();
  boundaryLayerGroup = L.layerGroup();

  map.on("moveend", onMapMove);
  map.on("zoomend", onMapMove);

  // Load data dependencies
  await loadDependencies();

  // Auto-generate world
  await generateWorld();
  updateZoomLayers();

  log("World preview ready! Zoom in to see LOD in action.", "success");
  return map;
}

export function setRecipe(recipe) {
  currentRecipe = { ...currentRecipe, ...recipe };
}

export function toggleVisibility(layerName, isVisible) {
  visibility[layerName] = isVisible;
  const zoom = map ? map.getZoom() : 0;

  if (layerName === "citadel") {
    if (isVisible && zoom >= 10) map.addLayer(citadelClusterGroup);
    else map.removeLayer(citadelClusterGroup);
  }
  if (layerName === "district") {
    if (isVisible && zoom >= 10) {
      map.addLayer(zoneLayerGroup);
      lastViewportKey = "";
      renderViewport();
    } else map.removeLayer(zoneLayerGroup);
  }
  if (layerName === "cityBoundary") {
    if (isVisible && zoom >= 8) {
      map.addLayer(boundaryLayerGroup);
      renderBoundaries();
    } else map.removeLayer(boundaryLayerGroup);
  }
  if (["monster", "shop", "vault", "castle"].includes(layerName)) {
    lastViewportKey = "";
    renderViewport();
  }
}

export async function generateWorldFromSeed(seed) {
  await ensureH3Loaded();

  if (cities.length === 0) {
    await loadDependencies();
  }

  const recipe = { ...currentRecipe, seed };

  // Fetch citadel templates from the database to avoid 'citadel_default'
  if (!recipe.layers?.citadels?.templates) {
    try {
      const allCastles = await getTemplates("castle");
      const allCitadels = await getTemplates("citadel");
      const combined = [...allCastles, ...allCitadels];
      const validCitadels = combined.filter(
        (t) =>
          t.type === "citadel" ||
          t.icon === "🏯" ||
          (t.name && t.name.includes("Citadel")) ||
          (t.id && t.id.includes("citadel")),
      );
      if (validCitadels.length > 0) {
        recipe.layers = recipe.layers || {};
        recipe.layers.citadels = {
          templates: validCitadels.map(t => ({ templateId: t.id, weight: 10 }))
        };
      }
    } catch (e) {
      console.warn("Failed to fetch citadel templates for seed generation", e);
    }
  }

  const citiesWithBoundaries = cities.filter(
    (c) => cityBoundaries[c.id] && cityBoundaries[c.id].boundary,
  );

  const generatedCitadels = generateAllCitadels(
    citiesWithBoundaries,
    recipe,
    cityBoundaries,
    cityPOIs,
  );

  return generatedCitadels;
}

export async function generateWorld() {
  invalidateCitadelCache();
  clearCellCityCache();
  citadelClusterGroup.clearLayers();
  zoneCache.clear();

  const t0 = performance.now();
  log(`Generating citadels for ${cities.length} cities...`, "info");

  await new Promise((r) => setTimeout(r, 50));

  const citiesWithBoundaries = cities.filter(
    (c) => cityBoundaries[c.id] && cityBoundaries[c.id].boundary,
  );
  worldCitadels = generateAllCitadels(
    citiesWithBoundaries,
    currentRecipe,
    cityBoundaries,
    cityPOIs,
  );
  window._worldCitadels = worldCitadels;

  log(`Rendering ${worldCitadels.length} citadels with clustering...`, "info");
  await new Promise((r) => setTimeout(r, 50));

  const markers = worldCitadels.map((obj) => {
    const cc = cityColor(obj.cityId);
    const marker = L.circleMarker([obj.lat, obj.lng], {
      radius: 6,
      fillColor: cc,
      color: cc,
      weight: 1,
      opacity: 0.9,
      fillOpacity: 0.7,
    });
    marker.bindPopup(
      () => `
            <div style="font-family:system-ui;font-size:12px;">
                <b>⚔️ ${obj.templateId || "citadel"}</b><br>
                City: ${obj.cityId || "?"}<br>
                ID: <code style="font-size:10px">${obj.id}</code><br>
                ${obj.poiName ? `POI: <b>${obj.poiName}</b> (${obj.poiType})<br>` : ""}
                ${obj.lat.toFixed(4)}, ${obj.lng.toFixed(4)}
            </div>`,
    );
    obj._marker = marker;
    return marker;
  });
  citadelClusterGroup.addLayers(markers);

  const genTime = (performance.now() - t0).toFixed(0);
  updateStats("citadels", worldCitadels.length);
  updateStats("total", worldCitadels.length);
  updateStats("cities", cities.length);

  log(
    `✅ ${worldCitadels.length} citadels generated in ${genTime}ms for ${cities.length} cities`,
    "success",
  );
  renderViewport();
}

/**
 * Sync worldCitadels array with zone engine results after POI snapping.
 * Updates data properties AND visually repositions Leaflet markers.
 *
 * @param {Array} worldCitadels - The global citadels array
 * @param {Array} zones - zones from generateZonesForCity().zones
 * @returns {number} count of markers that were repositioned
 */
export function syncCitadelsWithZoneResults(worldCitadels, zones) {
  let snappedCount = 0;
  for (const zone of zones) {
    const match = worldCitadels.find((c) => c.id === zone.citadel.id);
    if (match) {
      const moved =
        match.lat !== zone.citadel.lat || match.lng !== zone.citadel.lng;
      match.lat = zone.citadel.lat;
      match.lng = zone.citadel.lng;
      match.name = zone.citadel.name;
      match.poiName = zone.citadel.poiName;
      match.poiType = zone.citadel.poiType;
      match.h3Index = zone.citadel.h3Index;
      if (moved && match._marker) {
        match._marker.setLatLng([zone.citadel.lat, zone.citadel.lng]);
        snappedCount++;
      }
    }
  }
  return snappedCount;
}

// ── Private Internal Methods ──

async function loadDependencies() {
  log("Loading world cities...", "info");
  try {
    const resp = await fetch("../gameplay/world_cities.json");
    cities = await resp.json();
    log(`Loaded ${cities.length} cities`, "success");
  } catch (e) {
    log(`Failed to load cities: ${e.message}`, "warn");
    cities = [
      {
        id: "berlin",
        name: "Berlin",
        lat: 52.52,
        lng: 13.405,
        population: 3748148,
        country: "DE",
      },
    ];
  }
  updateStats("cities", cities.length);

  try {
    const bResp = await fetch("../gameplay/world_cities_boundaries.json");
    if (bResp.ok) {
      cityBoundaries = await bResp.json();
      window._cityBoundaries = cityBoundaries;
      const validCount = Object.keys(cityBoundaries).filter(
        (k) => cityBoundaries[k].boundary,
      ).length;
      totalBoundaryCount = validCount;
      updateStats(
        "boundaries",
        `${validCount} / ${Object.keys(cityBoundaries).length}`,
      );
      log(`Boundaries: ${validCount} valid entries loaded`, "success");
    }
  } catch (e) {
    log("No city boundaries file yet", "info");
  }

  try {
    const pResp = await fetch("../gameplay/world_cities_pois.json");
    if (pResp.ok) {
      cityPOIs = await pResp.json();
      window._cityPOIs = cityPOIs;
      log("Loaded POIs for Citadel snapping", "success");
    }
  } catch (e) {
    log("No city POIs file yet", "info");
  }
}

function renderViewport() {
  if (worldCitadels.length === 0) return;

  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const boundsObj = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  const key = getViewportKey(boundsObj, zoom, currentRecipe.seed);
  if (key === lastViewportKey) return;
  lastViewportKey = key;

  let types = getTypesForZoom(zoom).filter((t) => visibility[t]);
  const lodName =
    zoom <= 7
      ? "Citadels only"
      : zoom <= 10
        ? "+Castles"
        : zoom <= 13
          ? "+Shops/Vaults"
          : "Full (all types)";

  updateStats("zoom", zoom);
  updateStats("lod", lodName);
  viewportClusterGroup.clearLayers();

  if (types.length === 0) {
    updateStats("viewport", "0");
    updateStats("total", worldCitadels.length);
    renderZones();
    return;
  }

  const t0 = performance.now();
  const objects = generateViewportObjects(
    boundsObj,
    currentRecipe,
    cities,
    zoom,
  );
  const genTime = (performance.now() - t0).toFixed(1);

  const markers = objects.map((obj) => {
    const color = TYPE_COLORS[obj.type] || "#ffffff";
    const r = obj.type === "castle" ? 5 : 4;
    const marker = L.circleMarker([obj.lat, obj.lng], {
      radius: r,
      fillColor: color,
      color: color,
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.6,
    });
    marker.bindPopup(
      () => `
            <div style="font-family:system-ui;font-size:12px;">
                <b>${obj.templateId || obj.type}</b><br>
                Type: ${obj.type}<br>
                City: ${obj.cityId || "?"}<br>
                ID: <code style="font-size:10px">${obj.id}</code><br>
                ${obj.poiName ? `POI: <b>${obj.poiName}</b> (${obj.poiType})<br>` : ""}
                ${obj.lat.toFixed(5)}, ${obj.lng.toFixed(5)}
            </div>`,
    );
    return marker;
  });
  viewportClusterGroup.addLayers(markers);

  updateStats("viewport", objects.length);
  updateStats("total", worldCitadels.length + objects.length);
  updateStats("time", genTime);

  if (objects.length > 0) {
    log(
      `Viewport: ${objects.length} ${types.join("+")} in ${genTime}ms (zoom ${zoom})`,
      "success",
    );
  }
  renderZones();
}

function renderZones() {
  zoneLayerGroup.clearLayers();
  if (!visibility.district || worldCitadels.length === 0) return;

  const zoom = map.getZoom();
  if (zoom < 10) return;

  const bounds = map.getBounds();
  const boundsObj = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };
  const pad = 0.5;
  const visibleCities = cities.filter(
    (c) =>
      c.lat >= boundsObj.south - pad &&
      c.lat <= boundsObj.north + pad &&
      c.lng >= boundsObj.west - pad &&
      c.lng <= boundsObj.east + pad,
  );
  if (visibleCities.length === 0 || visibleCities.length > 50) return;

  const t0 = performance.now();
  let totalZones = 0,
    totalCells = 0;

  for (const city of visibleCities) {
    const boundaryEntry = cityBoundaries[city.id];
    if (!boundaryEntry || !boundaryEntry.boundary) continue;

    const coords = boundaryEntry.boundary;
    let outerRing =
      Array.isArray(coords[0]) &&
      Array.isArray(coords[0][0]) &&
      typeof coords[0][0][0] === "number"
        ? coords[0]
        : Array.isArray(coords[0]) && typeof coords[0][0] === "number"
          ? coords
          : null;
    if (!outerRing || outerRing.length < 3) continue;

    if (!zoneCache.has(city.id)) {
      const pois = cityPOIs[city.id] ? cityPOIs[city.id].pois : null;
      const result = generateZonesForCity(city, outerRing, currentRecipe, pois);
      zoneCache.set(city.id, {
        zones: result.zones,
        geojson: zonesToGeoJSON(result.zones),
      });
      // Sync worldCitadels with snapped POI data and reposition markers
      const snappedCount = syncCitadelsWithZoneResults(
        worldCitadels,
        result.zones,
      );
      if (snappedCount > 0) {
        log(
          `📍 ${snappedCount} citadel marker(s) snapped to POIs in ${city.id}`,
          "info",
        );
      }
    }

    const cached = zoneCache.get(city.id);
    if (cached.geojson.features.length > 0) {
      const geoLayer = L.geoJSON(cached.geojson, {
        style: (feature) => ({
          color: feature.properties.color,
          weight: 1,
          fillOpacity: 0.2,
          fillColor: feature.properties.color,
          interactive: false,
        }),
      });
      zoneLayerGroup.addLayer(geoLayer);
      totalZones += cached.zones.length;
      totalCells += cached.geojson.features.length;
    }
  }

  if (totalZones > 0) {
    log(
      `Voronoi: ${totalZones} zones (${totalCells} cells) in ${(performance.now() - t0).toFixed(1)}ms`,
      "success",
    );
  }
}

function renderBoundaries() {
  boundaryLayerGroup.clearLayers();
  if (!visibility.cityBoundary) return;

  const zoom = map.getZoom();
  const bounds = map.getBounds();
  const pad = zoom < 8 ? 10.0 : 1.0;
  const boundsObj = {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
  };

  let visibleCities =
    zoom < 5
      ? cities.filter(
          (c) => cityBoundaries[c.id] && cityBoundaries[c.id].boundary,
        )
      : cities.filter(
          (c) =>
            c.lat >= boundsObj.south - pad &&
            c.lat <= boundsObj.north + pad &&
            (c.lng >= boundsObj.west - pad ||
              c.lng >= boundsObj.west + 360 - pad) &&
            (c.lng <= boundsObj.east + pad ||
              c.lng <= boundsObj.east - 360 + pad) &&
            cityBoundaries[c.id] &&
            cityBoundaries[c.id].boundary,
        );

  if (zoom >= 8 && visibleCities.length > 500) return;

  for (const city of visibleCities) {
    const coords = cityBoundaries[city.id].boundary;
    let geojsonCoords =
      Array.isArray(coords[0]) &&
      Array.isArray(coords[0][0]) &&
      typeof coords[0][0][0] === "number"
        ? [coords[0]]
        : Array.isArray(coords[0]) && typeof coords[0][0] === "number"
          ? [coords]
          : null;
    if (!geojsonCoords) continue;

    const color = cityColor(city.name || city.id);
    if (zoom >= 8) {
      boundaryLayerGroup.addLayer(
        L.geoJSON(
          {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: geojsonCoords },
            properties: { cityId: city.id },
          },
          {
            style: {
              color,
              weight: 2,
              fillOpacity: 0,
              dashArray: "8, 4",
              interactive: false,
            },
          },
        ),
      );
    } else {
      boundaryLayerGroup.addLayer(
        L.circleMarker([city.lat, city.lng], {
          radius: 4,
          fillColor: color,
          color,
          weight: 1,
          opacity: 0.9,
          fillOpacity: 0.7,
          interactive: false,
        }),
      );
    }
  }
}

function updateZoomLayers() {
  const zoom = map.getZoom();
  if (visibility.cityBoundary) {
    if (!map.hasLayer(boundaryLayerGroup)) map.addLayer(boundaryLayerGroup);
    renderBoundaries();
  } else map.removeLayer(boundaryLayerGroup);

  if (zoom >= 10 && visibility.district) {
    if (!map.hasLayer(zoneLayerGroup)) map.addLayer(zoneLayerGroup);
  } else map.removeLayer(zoneLayerGroup);

  if (zoom >= 10 && visibility.citadel) {
    if (!map.hasLayer(citadelClusterGroup)) map.addLayer(citadelClusterGroup);
  } else map.removeLayer(citadelClusterGroup);
}

let _moveTimeout = null;
function onMapMove() {
  clearTimeout(_moveTimeout);
  _moveTimeout = setTimeout(() => {
    updateZoomLayers();
    renderViewport();
  }, 150);
}

// ── World Stats API ──────────────────────────────────────────

/**
 * Compute expected entity counts from the current recipe + city data.
 * Returns counts per type and per-template distribution.
 * Can be called after generateWorld() has loaded cities.
 */
export function getWorldStats() {
  if (!cities || cities.length === 0) return null;

  const totalPop = cities.reduce((sum, c) => sum + (c.population || 0), 0);

  // Counts per entity type from density ratios
  const counts = {};
  for (const [type, ratio] of Object.entries(currentRecipe.densityRatios)) {
    counts[type] = Math.floor(totalPop / ratio);
  }

  // Template distribution per layer
  const templateDistribution = {};
  for (const [layerName, layer] of Object.entries(currentRecipe.layers)) {
    const totalWeight = layer.templates.reduce((s, t) => s + t.weight, 0);
    // Map layer name to density type: "monsters" -> "monster"
    const densityKey = layerName.replace(/s$/, "");
    const entityCount = counts[densityKey] || 0;
    templateDistribution[layerName] = layer.templates.map((t) => ({
      templateId: t.templateId,
      count: Math.round((entityCount * t.weight) / totalWeight),
      type: "generated",
    }));
  }

  return {
    counts,
    totalPopulation: totalPop,
    citadelCount: worldCitadels.length,
    templateDistribution,
    seed: currentRecipe.seed,
    densityRatios: { ...currentRecipe.densityRatios },
  };
}
