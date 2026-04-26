/**
 * canvas-renderer.js
 * High-performance Canvas rendering layer for Leaflet.
 * Replaces DOM-based L.marker for game entities (monsters, POIs).
 * Draws entities as emoji/icons on a single <canvas> element with
 * click/tap hit detection and automatic re-render on map pan/zoom.
 *
 * Includes grid-based clustering: when zoomed out (< 16), nearby entities
 * are grouped into numbered dots. At zoom >= 16, individual entities are shown.
 *
 * Usage:
 *   import { CanvasEntityLayer } from './canvas-renderer.js';
 *   const layer = new CanvasEntityLayer({ onClick: (entity) => { ... } });
 *   layer.addTo(map);
 *   layer.setEntities([{ id, lat, lng, icon, level, name, class, inactive, data }]);
 */

/* global L */

export class CanvasEntityLayer extends L.Layer {
  constructor(options = {}) {
    super(options);
    this._entities = new Map(); // id → entity data
    this._canvas = null;
    this._ctx = null;
    this._animFrameId = null;
    this._hitBoxes = []; // rebuilt every render for click detection
    this._onClick = options.onClick || null; // callback(entity)

    this._dpr = 1; // cached devicePixelRatio

    // Clustering config
    this._disableClusteringAtZoom = options.disableClusteringAtZoom ?? 16;
    this._clusterRadius = options.clusterRadius ?? 120; // grid cell size in px
  }

  // ───────────────────────── Leaflet lifecycle ─────────────────────────

  onAdd(map) {
    this._map = map;
    this._dpr = window.devicePixelRatio || 1;

    // Create canvas element
    this._canvas = L.DomUtil.create("canvas", "entity-canvas-layer");
    this._canvas.style.position = "absolute";
    this._canvas.style.top = "0";
    this._canvas.style.left = "0";
    this._canvas.style.pointerEvents = "none";
    this._canvas.style.zIndex = "450"; // Above tiles (200-400), below markers pane (600) & UI (1000+)

    const pane = map.getPane("overlayPane");
    pane.appendChild(this._canvas);

    this._ctx = this._canvas.getContext("2d");

    // Initial sizing
    this._resize();

    // Bind map event listeners
    map.on("move", this._onMove, this);
    map.on("zoom", this._onMove, this);
    map.on("viewreset", this._onViewReset, this);
    map.on("resize", this._onResize, this);
    map.on("moveend", this._onMoveEnd, this);
    map.on("zoomend", this._onMoveEnd, this);

    // Entity click detection via map click event (canvas is pointer-events:none)
    map.on("click", this._onMapClick, this);

    this._render();
    return this;
  }

  onRemove(map) {
    map.off("move", this._onMove, this);
    map.off("zoom", this._onMove, this);
    map.off("viewreset", this._onViewReset, this);
    map.off("resize", this._onResize, this);
    map.off("moveend", this._onMoveEnd, this);
    map.off("zoomend", this._onMoveEnd, this);

    map.off("click", this._onMapClick, this);

    if (this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }

    this._canvas = null;
    this._ctx = null;
    return this;
  }

  // ───────────────────────── Public API ─────────────────────────

  /**
   * Replace all entities at once.
   * @param {Array} entities - [{ id, lat, lng, icon, level, name, class, inactive, data }]
   */
  setEntities(entities) {
    this._entities.clear();
    for (const e of entities) {
      this._entities.set(e.id, e);
    }
    this._scheduleRender();
  }

  /**
   * Add or update a single entity.
   */
  addEntity(entity) {
    this._entities.set(entity.id, entity);
    this._scheduleRender();
  }

  /**
   * Remove a single entity by id.
   */
  removeEntity(id) {
    this._entities.delete(id);
    this._scheduleRender();
  }

  /**
   * Remove all entities and clear the canvas.
   */
  clearAll() {
    this._entities.clear();
    this._scheduleRender();
  }

  /**
   * Get entity data by id (or null).
   */
  getEntityById(id) {
    return this._entities.get(id) || null;
  }

  /**
   * Total number of tracked entities.
   */
  getEntityCount() {
    return this._entities.size;
  }

  // ───────────────────────── Internal: sizing ─────────────────────────

  _resize() {
    if (!this._map || !this._canvas) return;

    const size = this._map.getSize();
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;

    // Set the backing-store size to physical pixels
    this._canvas.width = size.x * dpr;
    this._canvas.height = size.y * dpr;

    // CSS size stays in logical pixels
    this._canvas.style.width = size.x + "px";
    this._canvas.style.height = size.y + "px";

    // Scale context so all draw commands use logical-pixel coordinates
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ───────────────────────── Internal: map events ─────────────────────────

  _onMove() {
    // During continuous pan/zoom: reposition canvas & schedule repaint
    this._repositionCanvas();
    this._scheduleRender();
  }

  _onViewReset() {
    this._resize();
    this._repositionCanvas();
    this._render();
  }

  _onResize() {
    this._resize();
    this._repositionCanvas();
    this._render();
  }

  _onMoveEnd() {
    // Final paint after interaction ends — guarantees crisp result
    this._repositionCanvas();
    this._render();
  }

  _repositionCanvas() {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._canvas, topLeft);
  }

  // ───────────────────────── Internal: render scheduling ─────────────────────────

  _scheduleRender() {
    if (this._animFrameId) return; // already scheduled
    this._animFrameId = requestAnimationFrame(() => {
      this._animFrameId = null;
      this._render();
    });
  }

  // ───────────────────────── Internal: clustering ─────────────────────────

  /**
   * Grid-based spatial clustering.
   * Divides screen into cells of _clusterRadius px.
   * Entities falling into the same cell are grouped.
   * Returns { clusters: [...], singles: [...] }.
   */
  _buildClusters(visibleItems) {
    const r = this._clusterRadius;
    const grid = new Map(); // "col:row" → [item, ...]

    for (const item of visibleItems) {
      const col = Math.floor(item.px / r);
      const row = Math.floor(item.py / r);
      const key = col + ":" + row;
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(item);
    }

    const clusters = [];
    const singles = [];

    for (const bucket of grid.values()) {
      if (bucket.length === 1) {
        singles.push(bucket[0]);
      } else {
        // Compute centroid of the cluster in screen pixels
        let cx = 0;
        let cy = 0;
        for (const item of bucket) {
          cx += item.px;
          cy += item.py;
        }
        cx /= bucket.length;
        cy /= bucket.length;
        clusters.push({
          x: cx,
          y: cy,
          count: bucket.length,
          entities: bucket,
        });
      }
    }

    return { clusters, singles };
  }

  // ───────────────────────── Internal: render loop ─────────────────────────

  _render() {
    if (!this._map || !this._ctx) return;

    const ctx = this._ctx;
    const size = this._map.getSize();
    const bounds = this._map.getBounds();
    const zoom = this._map.getZoom();

    // Ensure transform matches current DPR (may have changed on display switch)
    const dpr = window.devicePixelRatio || 1;
    if (dpr !== this._dpr) {
      this._resize(); // handles setTransform
    }

    // Clear the entire canvas (logical coordinates)
    ctx.clearRect(0, 0, size.x, size.y);

    // Reposition canvas in overlay pane
    this._repositionCanvas();

    // Viewport bounds (pre-extract for fast frustum culling)
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const west = bounds.getWest();
    const east = bounds.getEast();

    // Rebuild hitbox list from scratch each frame
    this._hitBoxes = [];

    // --- Collect visible entities with their screen positions ---
    const visibleItems = [];
    for (const [id, entity] of this._entities) {
      if (
        entity.lat < south ||
        entity.lat > north ||
        entity.lng < west ||
        entity.lng > east
      ) {
        continue;
      }
      const point = this._map.latLngToContainerPoint([entity.lat, entity.lng]);
      visibleItems.push({ id, entity, px: point.x, py: point.y });
    }

    // --- Decide: cluster or individual ---
    const shouldCluster = zoom < this._disableClusteringAtZoom;

    if (shouldCluster && visibleItems.length > 1) {
      const { clusters, singles } = this._buildClusters(visibleItems);

      // Draw clusters (numbered dots)
      for (const cl of clusters) {
        this._drawCluster(ctx, cl);
      }

      // Draw lone entities individually
      for (const item of singles) {
        this._drawEntity(ctx, item, zoom);
      }
    } else {
      // Zoom >= threshold or 0-1 entities: draw everything individually
      for (const item of visibleItems) {
        this._drawEntity(ctx, item, zoom);
      }
    }
  }

  // ───────────────────────── Internal: draw helpers ─────────────────────────

  /**
   * Draw a cluster dot with a count number.
   * Colors match _gameClusterIcon in map.js:
   *   < 10 → red, 10-49 → amber, 50+ → purple
   */
  _drawCluster(ctx, cluster) {
    const { x, y, count } = cluster;

    let radius, bg, borderColor, glowColor;
    if (count < 10) {
      radius = 18;
      bg = "rgba(239,68,68,0.85)";
      borderColor = "#fca5a5";
      glowColor = "rgba(239,68,68,0.45)";
    } else if (count < 50) {
      radius = 22;
      bg = "rgba(245,158,11,0.9)";
      borderColor = "#fcd34d";
      glowColor = "rgba(245,158,11,0.45)";
    } else {
      radius = 26;
      bg = "rgba(168,85,247,0.9)";
      borderColor = "#c4b5fd";
      glowColor = "rgba(168,85,247,0.5)";
    }

    ctx.save();

    // Outer glow
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = glowColor;
    ctx.fill();

    // Main circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Count number
    const fs = count >= 100 ? 11 : 13;
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 2;
    ctx.fillText(String(count), x, y);
    ctx.shadowBlur = 0;

    ctx.restore();

    // Hitbox — clicking a cluster zooms in
    const hitHalf = radius + 6;
    this._hitBoxes.push({
      id: "__cluster__",
      x: x - hitHalf,
      y: y - hitHalf,
      w: hitHalf * 2,
      h: hitHalf * 2,
      entity: null,
      cluster: cluster,
    });
  }

  /**
   * Draw a single entity (monster / POI) at its screen position.
   */
  _drawEntity(ctx, item, zoom) {
    const { entity, px: x, py: y } = item;

    const iconRadius = zoom >= 16 ? 20 : zoom >= 14 ? 16 : zoom >= 12 ? 12 : 8;
    const fontSize = zoom >= 16 ? 24 : zoom >= 14 ? 18 : zoom >= 12 ? 14 : 10;
    const showLabels = zoom >= 14;

    // Class → background colour mapping
    const classColors = {
      normal: "#374151",
      champion: "#7c3aed",
      unique: "#d97706",
      superUnique: "#dc2626",
    };

    ctx.save();

    // Inactive (defeated / cooldown) entities are translucent
    if (entity.inactive) {
      ctx.globalAlpha = 0.35;
    }

    // --- Background circle ---
    const bgColor = classColors[entity.class] || classColors.normal;
    ctx.beginPath();
    ctx.arc(x, y, iconRadius, 0, Math.PI * 2);
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.strokeStyle = entity.inactive ? "#666666" : "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // --- Emoji icon ---
    ctx.font = `${fontSize}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(entity.icon, x, y);

    // --- Level label (only when zoomed in enough) ---
    if (showLabels && entity.level != null) {
      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#fbbf24";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`Lv.${entity.level}`, x, y + iconRadius + 3);
    }

    ctx.restore();

    // --- Store hitbox for click detection ---
    const hitPadding = 4;
    const hitHalf = iconRadius + hitPadding;
    this._hitBoxes.push({
      id: entity.id || entity.data?.id,
      x: x - hitHalf,
      y: y - hitHalf,
      w: hitHalf * 2,
      h: hitHalf * 2,
      entity,
      cluster: null,
    });
  }

  // ───────────────────────── Internal: click detection ─────────────────────────

  _onMapClick(e) {
    if (this._hitBoxes.length === 0) return;

    // Leaflet provides containerPoint directly
    const x = e.containerPoint.x;
    const y = e.containerPoint.y;

    // Walk hitboxes in reverse order so the topmost (last-drawn) entity wins
    for (let i = this._hitBoxes.length - 1; i >= 0; i--) {
      const hb = this._hitBoxes[i];
      if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) {
        // Cluster click → zoom in to reveal individual entities
        if (hb.cluster) {
          const map = this._map;
          if (map) {
            const center = map.containerPointToLatLng([
              hb.cluster.x,
              hb.cluster.y,
            ]);
            map.setView(center, map.getZoom() + 2, { animate: true });
          }
          L.DomEvent.stop(e.originalEvent);
          return;
        }

        // Entity click → fire callback
        if (this._onClick && hb.entity) {
          this._onClick(hb.entity);
          L.DomEvent.stop(e.originalEvent);
          return;
        }
      }
    }
    // No entity hit — event passes to other map handlers normally
  }
}
