import * as THREE from 'three';

// Small helpers shared by the world's mesh builders.

/** A repeating canvas texture, drawn by `draw(ctx, size)`. */
export function canvasTexture(size, draw, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Accumulates coloured, UV-mapped faces into a single merged BufferGeometry. */
export class QuadBuilder {
  constructor(tile = 3) {
    this.tile = tile;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  /**
   * Convex polygon fan; `pts` are [x, y, z], `uvs` are [u, v], wound front-facing. `color` is one
   * colour for the whole face, or an array with one per point.
   */
  face(pts, n, uvs, color) {
    const base = this.pos.length / 3;
    pts.forEach((p, i) => {
      const c = Array.isArray(color) ? color[i] : color;
      this.pos.push(...p);
      this.nrm.push(...n);
      this.uv.push(...uvs[i]);
      this.col.push(c.r, c.g, c.b);
    });
    for (let i = 1; i + 1 < pts.length; i++) this.idx.push(base, base + i, base + i + 1);
  }

  /** Vertical wall from (ax, az) to (bx, bz), facing (-(bz - az), bx - ax): to the left going a -> b. */
  wall(ax, az, bx, bz, y0, y1, color) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) return;
    const n = [-(bz - az) / len, 0, (bx - ax) / len];
    const w = len / this.tile, h = (y1 - y0) / this.tile;
    this.face([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n, [[0, 0], [w, 0], [w, h], [0, h]], color);
  }

  /** Flat, upward-facing convex polygon (CCW in x/z, see geom.js) at height y, UVs in world space. */
  polyTop(poly, y, color) {
    const t = this.tile;
    const pts = poly.slice().reverse();
    this.face(pts.map((p) => [p.x, y, p.z]), [0, 1, 0], pts.map((p) => [p.x / t, -p.z / t]), color);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
