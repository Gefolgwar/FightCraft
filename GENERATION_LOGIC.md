# Monsters Generation Algorithm & Logic

## 1. Concept
The generation system uses **OpenStreetMap (OSM)** data to place monsters in contextually appropriate locations. It queries real-world map data (POIs, land use, waterways) and maps them to game entities based on defined rules.

## 2. Pseudocode / Algorithm
```javascript
FUNCTION GenerateMonsters(centerLat, centerLng, radius, density):
    1. CALCULATE bounding box (bbox) from centerLat/Lng and radius.
    2. CONSTRUCT Overpass QL query:
        - Query nodes/ways/relations with tags:
            - natural=water, waterway=* (Water Biome)
            - landuse=forest, leisure=park (Nature Biome)
            - landuse=residential, commercial (Urban Biome)
            - amenity=grave_yard (Undead)
            - historic=monument (Rare)
            - tourism=attraction (Elite)
            - highway=footway|pedestrian (Safe paths)
    3. FETCH data from Overpass API.
    4. PARSE response:
        - Extract geometry (lat/lng) for each element.
        - Determine "Biome/Type" based on tags.
    5. FILTER & PROCESS:
        - DISCARD points on `highway=motorway|trunk|primary|railway`.
        - KEEP points within 10m of `highway=footway` (if strict safety enabled).
        - ADJUST weight based on Time of Day (Night = more shadow monsters).
        - ADJUST level based on "Significance" (e.g., wikidata tag presence = higher level).
    6. INSTANTIATE Monsters:
        - For each valid point, spawn monster from matching template.
        - Add random jitter (1-5m) to prevent stacking.
    7. RETURN list of monster objects.
```

## 3. Example Overpass Query
This query fetches water, parks, and urban areas around a center point, excluding major roads.

```javascript
[out:json][timeout:25];
(
  // Water Bodies (Water Monsters)
  way["natural"="water"](around:radius, lat, lng);
  relation["natural"="water"](around:radius, lat, lng);
  
  // Parks & Forests (Nature Monsters)
  way["leisure"="park"](around:radius, lat, lng);
  way["landuse"="forest"](around:radius, lat, lng);
  
  // Urban Areas (City Monsters)
  way["landuse"="residential"](around:radius, lat, lng);
  way["landuse"="commercial"](around:radius, lat, lng);

  // POIs (Special Monsters)
  node["amenity"="grave_yard"](around:radius, lat, lng);
  node["historic"="monument"](around:radius, lat, lng);
  
  // Safe Paths (for proximity check)
  way["highway"~"footway|pedestrian"](around:radius, lat, lng);
);
out center;
```

## 4. Privacy & Safety Advice
1.  **Exclusion Zones**: Explicitly exclude `landuse=military`, `amenity=school`, and `amenity=kindergarten` tags to avoid sensitive areas.
2.  **Private Property**: Avoid spawning strictly inside `landuse=residential` polygons if possible, or snap spawns to public `highway` (roads/paths) *inside* those areas rather than random coordinates in backyards.
3.  **Path Snapping**: The best way to ensure accessibility is to **only spawn on nodes being part of a `highway`** (streets, paths) or within 5m of them.
4.  **Safety**: Blacklist `highway=motorway`, `trunk`, `primary` to prevent monsters appearing on dangerous roads.

## 5. Implementation in Project
See `js/generation-service.js` for the actual JavaScript implementation of this logic.
