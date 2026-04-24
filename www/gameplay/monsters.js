// Monster generation system
import { MONSTER_LIBRARY, CITY_ANCHORS } from './data.js';
import { getDistance } from '../map/map.js';
import { setStaticMonsters, getStaticMonsters, STATIC_MONSTER_KEY } from '../core/gameState.js';

// Constants
const GRID_SETTINGS = {
    spacingMeters: 500,
    radius: 5,
    respawnMs: 5 * 60 * 1000
};

const MAX_MONSTERS_PER_CITY = 800;

const LAT_STEP_DEG = 0.0001;

const LANDMARKS = [
    { id: 'brandenburg_gate', name: 'Brandenburg Gate', lat: 52.516275, lng: 13.377704, type: 'historic' },
    { id: 'tiergarten', name: 'Tiergarten Park', lat: 52.51453, lng: 13.35012, type: 'park' },
    { id: 'museumsinsel', name: 'Museum Island', lat: 52.516934, lng: 13.401067, type: 'cultural' },
    { id: 'alexanderplatz', name: 'Alexanderplatz', lat: 52.521918, lng: 13.413215, type: 'pedestrian' },
    { id: 'checkpoint_charlie', name: 'Checkpoint Charlie', lat: 52.507507, lng: 13.390373, type: 'historic' },
    { id: 'reichstag', name: 'Reichstag Dome', lat: 52.518623, lng: 13.376198, type: 'historic' },
    { id: 'st_michaels_kiev', name: "St. Michael's Golden-Domed Monastery", lat: 50.4547, lng: 30.5281, type: 'spiritual' },
    { id: 'khreshchatyk', name: 'Khreshchatyk (Pedestrian)', lat: 50.4473, lng: 30.5226, type: 'pedestrian' },
    { id: 'mariyinsky', name: 'Mariinsky Park', lat: 50.4465, lng: 30.5404, type: 'park' }
];

const CITY_REGIONS = CITY_ANCHORS.map((anchor, idx) => {
    const radius = anchor.id === 'berlin' ? 25 : (anchor.id === 'london' || anchor.id === 'paris' || anchor.id === 'rome') ? 24 : 20;
    return {
        id: anchor.id,
        name: anchor.name,
        lat: anchor.lat,
        lng: anchor.lng,
        radiusKm: radius,
        minLevel: 1,
        maxLevel: 40 + idx * 5
    };
});

// Berlin districts (simplified - full data would be too large)
const BERLIN_DISTRICTS = [
    {
        id: 'mitte',
        name: 'Mitte',
        color: '#e74c3c',
        fill: 'rgba(231,76,60,0.08)',
        borderOpacity: 0.8,
        minLevel: 1,
        maxLevel: 15,
        radius: 3000,
        center: { lat: 52.520008, lng: 13.404954 },
        polygon: [[52.535, 13.35], [52.535, 13.45], [52.505, 13.45], [52.505, 13.35]]
    },
    {
        id: 'fk',
        name: 'Friedrichshain-Kreuzberg',
        color: '#3498db',
        fill: 'rgba(52,152,219,0.08)',
        borderOpacity: 0.6,
        minLevel: 10,
        maxLevel: 25,
        radius: 4000,
        center: { lat: 52.507, lng: 13.437 },
        polygon: [[52.52, 13.40], [52.52, 13.48], [52.49, 13.48], [52.49, 13.40]]
    }
];

// Helper functions
function seedRandom(seed) {
    return function () {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
}

function getGridCellId(lat, lng) {
    const latIdx = Math.floor(lat / LAT_STEP_DEG);
    const lngIdx = Math.floor(lng / LAT_STEP_DEG);
    return `${latIdx}_${lngIdx}`;
}

function pickLandmarkForCell(lat, lng) {
    let best = null;
    let bestDist = Infinity;
    LANDMARKS.forEach(land => {
        const dist = getDistance(lat, lng, land.lat, land.lng);
        if (dist < 1000 && dist < bestDist) {
            best = land;
            bestDist = dist;
        }
    });
    return best;
}

function getMonsterByLandUse(type, random) {
    const pools = {
        park: ['wolf', 'boar', 'spirit'],
        pedestrian: ['goblin', 'hunter', 'mage'],
        historic: ['skeleton', 'fallen', 'wraith'],
        cultural: ['mage', 'wraith', 'golem'],
        waterfront: ['dragonling', 'wraith', 'hunter'],
        spiritual: ['fallen', 'mage', 'wraith'],
        industrial: ['golem', 'orc', 'skeleton']
    };
    const list = pools[type] || ['goblin', 'wolf', 'golem'];
    const templateId = list[Math.floor(random() * list.length)];
    return MONSTER_LIBRARY.find(m => m.templateId === templateId) || MONSTER_LIBRARY[0];
}

function assignDistrictForPoint(lat, lng, cityId) {
    if (cityId === 'berlin') {
        let selected = null;
        let minDist = Infinity;
        BERLIN_DISTRICTS.forEach(dist => {
            const inside = pointInPolygon(lat, lng, dist.polygon);
            if (inside) {
                const d = getDistance(lat, lng, dist.center.lat, dist.center.lng);
                if (d < minDist) {
                    minDist = d;
                    selected = dist;
                }
            }
        });
        return selected;
    }
    const city = CITY_REGIONS.find(c => c.id === cityId);
    if (city) {
        return {
            id: city.id,
            name: city.name,
            color: '#8b5cf6',
            fill: 'rgba(139,92,246,0.08)',
            borderOpacity: 0.4,
            minLevel: city.minLevel,
            maxLevel: city.maxLevel,
            radius: city.radiusKm * 1000,
            center: { lat: city.lat, lng: city.lng }
        };
    }
    return null;
}

function pointInPolygon(lat, lng, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) && (lng < (yj - yi) * (lat - xi) / (xj - xi) + yi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Main generation function
export function buildStaticMonsters() {
    console.log('🚫 Local monster generation disabled. Relying on Database Sync.');
    setStaticMonsters([]);
    return [];
}

export function saveStaticMonsters() {
    try {
        const monsters = getStaticMonsters();
        localStorage.setItem(STATIC_MONSTER_KEY, JSON.stringify(monsters));
    } catch (err) {
        console.warn('⚠️ Cannot save monsters to localStorage (quota exceeded). Data will be generated again on next launch.', err);
    }
}

export function loadStaticMonsters() {
    const saved = localStorage.getItem(STATIC_MONSTER_KEY);
    if (saved) {
        try {
            const monsters = JSON.parse(saved);
            if (!Array.isArray(monsters) || monsters.length === 0) {
                return [];
            } else {
                const isAdmin = window.gameState && window.gameState.player && window.gameState.player.role === "admin";
                const playerPos = window.gameState && window.gameState.player ? window.gameState.player.position : null;
                let filteredMonsters = monsters;
                if (!isAdmin && playerPos && window.turf) {
                    const playerPoint = turf.point([playerPos.lng, playerPos.lat]);
                    filteredMonsters = monsters.filter(m => {
                        if (!m.lng || !m.lat) return false;
                        const mPoint = turf.point([m.lng, m.lat]);
                        return turf.distance(playerPoint, mPoint, { units: "kilometers" }) <= 100;
                    });
                }

                setStaticMonsters(filteredMonsters);
                console.log(`✅ Loaded ${monsters.length} monsters from cache`);
                return filteredMonsters;
            }
        } catch (e) {
            return [];
        }
    } else {
        return [];
    }
}
