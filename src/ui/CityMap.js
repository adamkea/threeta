import { CITY, LAYOUT, LOT } from '../world/City.js';
import { offsetConvex } from '../world/geom.js';

// Map of the whole city on a 2D canvas over the game. Same north-up view as the camera:
// +X is right, +Z is down. The streets and buildings are drawn once to an offscreen
// canvas, built from the city's own layout data. Each frame the cars and the player are drawn on top.

const INK = '#14110f';
const WATER = '#2f8fb8';
const ROAD = '#5b5d63';
const SIDEWALK = '#c9c6bd';
const GRASS = '#5fae3f';
const MARGIN = 18; // metres of water shown round the island

export class CityMap {
  constructor(city, el) {
    this.city = city;
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.open = false;
    this.base = null; // offscreen canvas holding the static streets and buildings
    this.baseSize = 0;
    this.t = 0;
  }

  toggle() {
    this.open = !this.open;
    this.el.classList.toggle('open', this.open);
  }

  /** Canvas size: a square that fits the window, sharp on high-DPI screens. */
  layout() {
    const css = Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.86);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = this.canvas.height = px;
      this.canvas.style.width = this.canvas.style.height = `${css}px`;
    }
    if (this.baseSize !== px) this.drawBase(px);
  }

  /** Map metres -> canvas pixels for a square canvas of `size` px. */
  scaleFor(size) {
    return size / (CITY.size + MARGIN * 2);
  }

  toPx(x, z, size) {
    const s = this.scaleFor(size);
    return [(x + CITY.half + MARGIN) * s, (z + CITY.half + MARGIN) * s];
  }

  drawBase(size) {
    const c = (this.base ??= document.createElement('canvas'));
    c.width = c.height = size;
    this.baseSize = size;
    const g = c.getContext('2d');
    const s = this.scaleFor(size);
    const rect = (minX, minZ, maxX, maxZ) => {
      const [x0, y0] = this.toPx(minX, minZ, size);
      return [x0, y0, (maxX - minX) * s, (maxZ - minZ) * s];
    };

    g.fillStyle = WATER;
    g.fillRect(0, 0, size, size);
    // Island of asphalt, with the sea wall as an inked border.
    g.fillStyle = ROAD;
    g.fillRect(...rect(-CITY.half, -CITY.half, CITY.half, CITY.half));
    g.lineWidth = Math.max(2, 2 * s);
    g.strokeStyle = '#9a9384';
    g.strokeRect(...rect(-CITY.half, -CITY.half, CITY.half, CITY.half));

    const path = (poly) => {
      g.beginPath();
      poly.forEach((p, i) => {
        const [x, y] = this.toPx(p.x, p.z, size);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.closePath();
    };

    // Double-yellow centre lines along every road.
    const graph = LAYOUT.graph;
    g.strokeStyle = '#f2c230';
    g.lineWidth = Math.max(1, 0.5 * s);
    g.beginPath();
    for (const e of graph.edges) {
      const A = graph.nodes[e.a], B = graph.nodes[e.b];
      const [ax, ay] = this.toPx(A.x, A.z, size);
      const [bx, by] = this.toPx(B.x, B.z, size);
      g.moveTo(ax, ay), g.lineTo(bx, by);
    }
    g.stroke();

    // Blocks (sidewalks), then parks, then buildings shaded by height.
    g.fillStyle = SIDEWALK;
    for (const b of this.city.blocks) {
      if (b.use === 'lot') continue;
      path(b.shape);
      g.fill();
    }
    g.fillStyle = GRASS;
    for (const b of this.city.parks) {
      const inner = offsetConvex(b.shape, CITY.sidewalk);
      if (!inner) continue;
      path(inner);
      g.fill();
    }
    this.drawLots(g, size, s, path);

    g.lineWidth = Math.max(1, 0.35 * s);
    g.strokeStyle = INK;
    const maxH = Math.max(...this.city.buildings.map((b) => b.height));
    for (const b of this.city.buildings) {
      // Taller buildings are drawn a little brighter, so downtown stands out.
      const k = 0.75 + 0.35 * (b.height / maxH);
      const r = Math.min(255, ((b.color >> 16) & 255) * k);
      const gg = Math.min(255, ((b.color >> 8) & 255) * k);
      const bl = Math.min(255, (b.color & 255) * k);
      g.fillStyle = `rgb(${r | 0},${gg | 0},${bl | 0})`;
      if (b.poly) {
        path(b.poly);
        g.fill();
        g.stroke();
      } else {
        const rr = rect(b.minX, b.minZ, b.maxX, b.maxZ);
        g.fillRect(...rr);
        g.strokeRect(...rr);
      }
    }
    this.drawLandmarks(g, size, s);
  }

  /** Police station (blue badge with a star) and hospital (white badge with a red cross). */
  drawLandmarks(g, size, s) {
    for (const { kind, footprint: f } of this.city.landmarks) {
      const [cx, cy] = this.toPx((f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2, size);
      const r = 8 * s;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fillStyle = kind === 'police' ? '#22385c' : '#ffffff';
      g.fill();
      g.lineWidth = Math.max(1.5, 0.6 * s);
      g.strokeStyle = INK;
      g.stroke();
      if (kind === 'police') {
        g.fillStyle = '#f2c230';
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = (i % 2 ? 0.27 : 0.65) * r;
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
      } else {
        const t = r * 0.42, l = r * 1.3;
        g.fillStyle = '#d23a2f';
        g.fillRect(cx - t / 2, cy - l / 2, t, l);
        g.fillRect(cx - l / 2, cy - t / 2, l, t);
      }
    }
  }

  /** Parking lots: road-coloured with bay lines and a big "P" so they're easy to find. */
  drawLots(g, size, s, path) {
    for (const lot of this.city.lots) {
      // Draw in the lot's own frame: metres, local +X along (ux, uz).
      const [ox, oy] = this.toPx(lot.cx, lot.cz, size);
      g.save();
      path(this.city.blocks[lot.block].shape);
      g.clip();
      g.translate(ox, oy);
      g.transform(lot.ux * s, lot.uz * s, -lot.uz * s, lot.ux * s, 0, 0);
      g.fillStyle = ROAD;
      g.fillRect(-lot.hw, -lot.hd, lot.hw * 2, lot.hd * 2);
      for (const [a, b] of lot.aisles) g.fillRect(-lot.hw - 12, a, lot.hw * 2 + 24, b - a);
      g.strokeStyle = 'rgba(238,234,224,0.7)';
      g.lineWidth = 0.2;
      g.beginPath();
      for (const row of lot.rows) {
        for (let k = 0; k <= lot.bays; k++) {
          const x = lot.bx0 + k * LOT.bayWidth;
          g.moveTo(x, row.z0), g.lineTo(x, row.z1);
        }
      }
      g.stroke();
      g.restore();
      const cx = ox, cy = oy;
      const r = 7 * s;
      g.fillStyle = '#1f5fbf';
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
      g.lineWidth = Math.max(1, 0.5 * s);
      g.strokeStyle = '#ffffff';
      g.strokeRect(cx - r, cy - r, r * 2, r * 2);
      g.fillStyle = '#ffffff';
      g.font = `bold ${Math.round(r * 1.6)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', cx, cy + r * 0.08);
    }
  }

  /**
   * Draw one frame of the map. `player` is what the player controls (a car or a person:
   * position is an (x, z) Vector2, heading faces (sin h, cos h)).
   */
  render(dt, { player, inVehicle, cars, policeCars, cops }) {
    if (!this.open) return;
    this.t += dt;
    this.layout();
    const g = this.ctx;
    const size = this.canvas.width;
    const s = this.scaleFor(size);
    g.drawImage(this.base, 0, 0);

    const dot = (x, z, r, fill) => {
      const [px, py] = this.toPx(x, z, size);
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      g.lineWidth = Math.max(1, r * 0.35);
      g.strokeStyle = INK;
      g.stroke();
    };

    const r = Math.max(4, 2.6 * s);
    for (const c of cars) if (c.active && c !== player) dot(c.position.x, c.position.y, r * 0.8, '#e9e4da');
    // Police: flash red / blue like the sirens.
    const flash = Math.floor(this.t * 4) % 2 ? '#ff4a3a' : '#3a7bff';
    for (const c of policeCars) if (c.active && c !== player) dot(c.position.x, c.position.y, r * 1.1, flash);
    for (const p of cops) dot(p.position.x, p.position.y, r * 0.7, '#3a7bff');

    this.drawPlayer(g, player, size, s, inVehicle);
  }

  drawPlayer(g, body, size, s, inVehicle) {
    const [px, py] = this.toPx(body.position.x, body.position.y, size);
    const len = Math.max(13, (inVehicle ? 8 : 6.5) * s);
    const fx = Math.sin(body.heading), fy = Math.cos(body.heading);
    const rx = -fy, ry = fx;
    // Pulsing ring so the player is easy to find at a glance.
    const pulse = (this.t * 1.2) % 1;
    g.beginPath();
    g.arc(px, py, len * (1 + pulse * 1.6), 0, Math.PI * 2);
    g.strokeStyle = `rgba(255,210,58,${1 - pulse})`;
    g.lineWidth = Math.max(2, 0.6 * s);
    g.stroke();
    // Arrow pointing the way the player is facing.
    g.beginPath();
    g.moveTo(px + fx * len, py + fy * len);
    g.lineTo(px - fx * len * 0.6 + rx * len * 0.7, py - fy * len * 0.6 + ry * len * 0.7);
    g.lineTo(px - fx * len * 0.25, py - fy * len * 0.25);
    g.lineTo(px - fx * len * 0.6 - rx * len * 0.7, py - fy * len * 0.6 - ry * len * 0.7);
    g.closePath();
    g.fillStyle = '#ffd23a';
    g.fill();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(2, 0.5 * s);
    g.strokeStyle = INK;
    g.stroke();
  }
}
