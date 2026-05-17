// ==================== TERRITORY CANVAS LAYER ====================
// Leaflet custom layer: draws Voronoi territory polygons on HTML5 Canvas.
// Click-through enabled so underlying markers remain interactive.
//
// Usage:
//   import { TerritoryCanvasLayer } from './territory-canvas.js';
//   const layer = new TerritoryCanvasLayer();
//   layer.addTo(map);
//   layer.setTerritories(territories);
//   // where territories = [{ citadelId, color, boundary: [{lat,lng},...] }]

// ── Color Utilities ─────────────────────────────────────────────

/**
 * Generate a deterministic HSL color from a citadel ID string.
 * Uses a simple hash to spread IDs across the hue wheel.
 * @param {string} id - Citadel ID
 * @returns {string} CSS HSL color string
 */
function citadelColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

/**
 * Convert an HSL string to RGBA with alpha.
 * @param {string} hsl - e.g. "hsl(217, 65%, 45%)"
 * @param {number} alpha - 0–1
 * @returns {string} CSS rgba() string
 */
function hslToRgba(hsl, alpha) {
  const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return `rgba(128, 128, 128, ${alpha})`;

  const h = parseInt(match[1]) / 360;
  const s = parseInt(match[2]) / 100;
  const l = parseInt(match[3]) / 100;

  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

// ── Territory Canvas Layer ──────────────────────────────────────

/**
 * TerritoryCanvasLayer — Custom Leaflet L.Layer that renders filled territory
 * polygons and their borders onto an HTML5 Canvas overlay.
 *
 * The canvas has `pointer-events: none` so all mouse/touch events fall through
 * to the underlying Leaflet tiles and markers.
 *
 * Options:
 *   fillOpacity   {number}  Fill alpha for territory polygons (default 0.2)
 *   borderWidth   {number}  Stroke width in CSS pixels      (default 2)
 *   borderOpacity {number}  Stroke alpha for borders         (default 0.7)
 *   visible       {boolean} Initial visibility               (default true)
 */
export class TerritoryCanvasLayer extends L.Layer {
  constructor(options = {}) {
    super(options);
    this._canvas = null;
    this._ctx = null;
    this._territories = []; // { citadelId, color?, boundary: [{lat,lng}], ownerId?, ownerName? }
    this._h3Territories = []; // { citadelId, cells, hexBoundaries, ownerId?, ownerName?, color? }
    this._renderMode = "polygon"; // 'polygon' (legacy) or 'h3'
    this._fillOpacity = options.fillOpacity ?? 0.2;
    this._borderWidth = options.borderWidth ?? 2;
    this._borderOpacity = options.borderOpacity ?? 0.7;
    this._visible = options.visible ?? true;
  }

  // ── Leaflet lifecycle ───────────────────────────────────────

  onAdd(map) {
    this._map = map;

    // Create canvas element inside Leaflet's overlay pane
    this._canvas = L.DomUtil.create("canvas", "territory-canvas-layer");
    const pane = map.getPane("overlayPane");
    pane.appendChild(this._canvas);

    // Click-through: canvas must never capture pointer events
    this._canvas.style.pointerEvents = "none";
    this._canvas.style.position = "absolute";
    this._canvas.style.zIndex = "200"; // Above tiles, below markers (marker pane is z 600+)

    this._ctx = this._canvas.getContext("2d");

    // Redraw whenever the viewport changes
    map.on("moveend zoomend resize", this._redraw, this);

    this._resize();
    this._redraw();

    return this;
  }

  onRemove(map) {
    map.off("moveend zoomend resize", this._redraw, this);

    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;

    return this;
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Replace current territory data and trigger a redraw.
   *
   * @param {Array<Object>} territories
   *   Each entry:
   *     citadelId  {string}                   — unique id, also used for color hash
   *     color      {string|undefined}         — optional explicit HSL colour
   *     boundary   {Array<{lat,lng}>}         — polygon ring (≥ 3 points)
   *     ownerId    {string|undefined}         — uid of the king (informational)
   *     ownerName  {string|undefined}         — display name   (informational)
   */
  setTerritories(territories) {
    this._territories = territories || [];
    this._renderMode = "polygon";
    if (this._map) this._redraw();
  }

  /**
   * Replace current H3 territory data and switch to H3 render mode.
   *
   * @param {Array<Object>} h3Territories
   *   Each entry:
   *     citadelId      {string}                       — unique id, also used for color hash
   *     cells          {string[]}                     — H3 cell indices
   *     hexBoundaries  {Array<Array<{lat,lng}>>}      — array of hex polygons (each 6–7 points)
   *     ownerId        {string|undefined}             — uid of the king (informational)
   *     ownerName      {string|undefined}             — display name   (informational)
   *     color          {string|undefined}             — optional explicit HSL colour
   */
  setH3Territories(h3Territories) {
    this._h3Territories = h3Territories || [];
    this._renderMode = "h3";
    if (this._map) this._redraw();
  }

  /**
   * Manually switch render mode without replacing data.
   * @param {'polygon'|'h3'} mode
   */
  setRenderMode(mode) {
    if (mode !== "polygon" && mode !== "h3") return;
    this._renderMode = mode;
    if (this._map) this._redraw();
  }

  /**
   * Toggle visibility of the entire overlay.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._visible = visible;
    if (this._canvas) {
      this._canvas.style.display = visible ? "" : "none";
    }
    // Force redraw when becoming visible again so content is current
    if (visible && this._map) this._redraw();
  }

  /**
   * Update fill opacity and redraw.
   * @param {number} opacity - 0.0 to 1.0
   */
  setFillOpacity(opacity) {
    this._fillOpacity = opacity;
    if (this._map) this._redraw();
  }

  /**
   * Update border width and redraw.
   * @param {number} width - stroke width in CSS pixels
   */
  setBorderWidth(width) {
    this._borderWidth = width;
    if (this._map) this._redraw();
  }

  // ── Internal ──────────────────────────────────────────────────

  /** Match canvas bitmap size to the map container. */
  _resize() {
    if (!this._map || !this._canvas) return;
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
  }

  /** Clear and repaint all territories. */
  _redraw() {
    if (!this._map || !this._ctx || !this._visible) return;

    this._resize();

    const ctx = this._ctx;
    const map = this._map;

    // Clear entire canvas
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    // Align the canvas element with the current map viewport
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);

    if (this._renderMode === "h3") {
      this._redrawH3(ctx, map);
    } else {
      this._redrawPolygon(ctx, map);
    }
  }

  /** Render legacy Voronoi polygon territories. */
  _redrawPolygon(ctx, map) {
    if (this._territories.length === 0) return;

    // Viewport culling bounds
    const mapBounds = map.getBounds();
    const pad = 0.01;
    const north = mapBounds.getNorth() + pad;
    const south = mapBounds.getSouth() - pad;
    const east = mapBounds.getEast() + pad;
    const west = mapBounds.getWest() - pad;

    // Draw each territory polygon
    for (const territory of this._territories) {
      if (!territory.boundary || territory.boundary.length < 3) continue;

      // Viewport culling: check polygon centroid
      let cLat = 0,
        cLng = 0;
      for (const p of territory.boundary) {
        cLat += p.lat;
        cLng += p.lng;
      }
      cLat /= territory.boundary.length;
      cLng /= territory.boundary.length;
      if (cLat < south || cLat > north || cLng < west || cLng > east) continue;

      const color = territory.color || citadelColor(territory.citadelId);

      // Project geographic coords → container pixel coords
      const points = territory.boundary.map((p) => {
        const px = map.latLngToContainerPoint(L.latLng(p.lat, p.lng));
        return { x: px.x, y: px.y };
      });

      // Build polygon path
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.closePath();

      // Semi-transparent fill
      ctx.fillStyle = hslToRgba(color, this._fillOpacity);
      ctx.fill();

      // Solid-ish border
      ctx.strokeStyle = hslToRgba(color, this._borderOpacity);
      ctx.lineWidth = this._borderWidth;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  /** Render H3 hexagonal cell territories. */
  _redrawH3(ctx, map) {
    if (this._h3Territories.length === 0) return;

    const zoom = map.getZoom();
    const mapBounds = map.getBounds();
    // Pad bounds slightly to avoid pop-in
    const pad = 0.01; // ~1km
    const north = mapBounds.getNorth() + pad;
    const south = mapBounds.getSouth() - pad;
    const east = mapBounds.getEast() + pad;
    const west = mapBounds.getWest() - pad;

    ctx.lineJoin = "round";

    // DOTTED MODE: zoom <= 8 -> just draw small dots at hex centers
    if (zoom <= 8) {
      for (const territory of this._h3Territories) {
        if (!territory.hexBoundaries || territory.hexBoundaries.length === 0)
          continue;
        const color = territory.color || citadelColor(territory.citadelId);
        ctx.fillStyle = hslToRgba(color, 0.7);

        for (const hexRing of territory.hexBoundaries) {
          if (!hexRing || hexRing.length < 3) continue;
          // Calculate hex center
          let cLat = 0,
            cLng = 0;
          for (const p of hexRing) {
            cLat += p.lat;
            cLng += p.lng;
          }
          cLat /= hexRing.length;
          cLng /= hexRing.length;

          // Viewport culling
          if (cLat < south || cLat > north || cLng < west || cLng > east)
            continue;

          const px = map.latLngToContainerPoint(L.latLng(cLat, cLng));
          ctx.beginPath();
          ctx.arc(px.x, px.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    // OUTLINE-ONLY MODE: zoom 9-10 -> draw hex outlines only (no fill)
    const drawFill = zoom > 10;

    // Batch by territory (color)
    for (const territory of this._h3Territories) {
      if (!territory.hexBoundaries || territory.hexBoundaries.length === 0)
        continue;

      const color = territory.color || citadelColor(territory.citadelId);

      if (drawFill) {
        ctx.fillStyle = hslToRgba(color, this._fillOpacity);
      }
      ctx.strokeStyle = hslToRgba(color, this._borderOpacity * 0.5);
      ctx.lineWidth = drawFill ? 1 : 1.5;

      // Batch all hexes of this territory into one path
      ctx.beginPath();

      for (const hexRing of territory.hexBoundaries) {
        if (!hexRing || hexRing.length < 3) continue;

        // Viewport culling: check hex center
        let cLat = 0,
          cLng = 0;
        for (const p of hexRing) {
          cLat += p.lat;
          cLng += p.lng;
        }
        cLat /= hexRing.length;
        cLng /= hexRing.length;
        if (cLat < south || cLat > north || cLng < west || cLng > east)
          continue;

        const points = hexRing.map((p) => {
          const px = map.latLngToContainerPoint(L.latLng(p.lat, p.lng));
          return { x: px.x, y: px.y };
        });

        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
      }

      if (drawFill) ctx.fill();
      ctx.stroke();
    }
  }
}
