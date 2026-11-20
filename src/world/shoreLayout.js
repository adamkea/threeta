import { bounds, signedArea, simplify } from './geom.js';

// The shore round the island, as pure data: everything between the outer curb of the coast road
// and the sea. A paved promenade runs right round the island along the curb; beyond it each
// stretch of coast is either a sandy beach that slopes down into the water or a concrete dock
// that ends in a quay wall. Wooden piers stick out into the sea from some of them.
//
// The shore is built from the curb outline (a CCW polygon, see geom.js) by pushing each vertex
// outwards along its mitre, so every stretch of shore is a quad standing on one curb segment and
// "distance from the curb" is the same all along a row of it.

export const PROMENADE = 3; // width of the paved strip along the curb (m)
export const SHORE_Y = { curb: 0.25, sandTop: 0.05, pier: 0.4 };
export const WATER_LEVEL = -0.6;
const UNDERWATER = 6; // how far the sand carries on under the water
const BEACH_W = [22, 34]; // curb to waterline, beaches
const DOCK_W = 15; // curb to quay edge, docks
const STEP = 12; // length of the pieces the shore is built from

/**
 * @param {{x:number,z:number}[]} curbIn outer curb of the road network (any orientation)
 * @param {(x:number,z:number)=>'beach'|'dock'} typeAt which kind of shore a stretch of coast is
 */
export function buildShore(curbIn, rng, typeAt) {
  let curb = simplify(curbIn, 0.05);
  if (signedArea(curb) < 0) curb = curb.slice().reverse();
  // Merge very short edges (they come from tight junction corners) into their neighbours.
  for (let i = 0; i < curb.length && curb.length > 8; ) {
    const a = curb[i], b = curb[(i + 1) % curb.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 3) curb.splice((i + 1) % curb.length, 1);
    else i++;
  }
  // Cut long edges into short pieces, so the waterline can wander along them.
  const fine = [];
  curb.forEach((a, i) => {
    const b = curb[(i + 1) % curb.length];
    const k = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / STEP));
    for (let t = 0; t < k; t++) fine.push({ x: a.x + ((b.x - a.x) * t) / k, z: a.z + ((b.z - a.z) * t) / k, corner: t === 0, edge: i });
  });
  curb = fine;
  const n = curb.length;

  // Outward unit normal of each edge, and the mitre at each vertex: p + m * d is d metres out
  // from both edges meeting there.
  const edges = curb.map((a, i) => {
    const b = curb[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    return { a, b, len, dx, dz, nx: dz, nz: -dx, edge: a.edge };
  });
  const mitre = curb.map((p, i) => {
    const e0 = edges[(i + n - 1) % n], e1 = edges[i];
    const k = 1 + e0.nx * e1.nx + e0.nz * e1.nz;
    let mx = (e0.nx + e1.nx) / Math.max(k, 0.2), mz = (e0.nz + e1.nz) / Math.max(k, 0.2);
    const l = Math.hypot(mx, mz);
    if (l > 2.5) (mx *= 2.5 / l), (mz *= 2.5 / l);
    return { x: mx, z: mz };
  });

  // What each stretch is, and how wide: beach widths wander gently along the coast.
  const segs = edges.map((e, i) => {
    const mx = (e.a.x + e.b.x) / 2 + e.nx * 10, mz = (e.a.z + e.b.z) / 2 + e.nz * 10;
    return { i, ...e, type: typeAt(mx, mz) };
  });
  const ph = Array.from({ length: 3 }, () => rng.range(0, Math.PI * 2));
  let run = 0;
  const beachW = curb.map((p, i) => {
    if (i) run += edges[i - 1].len;
    const wave = 0.45 * Math.sin(run / 70 + ph[0]) + 0.35 * Math.sin(run / 29 + ph[1]) + 0.2 * Math.sin(run / 13 + ph[2]);
    return BEACH_W[0] + (BEACH_W[1] - BEACH_W[0]) * (0.5 + 0.5 * wave);
  });
  for (const s of segs) {
    const j = (s.i + 1) % n;
    s.w0 = s.type === 'dock' ? DOCK_W : beachW[s.i];
    s.w1 = s.type === 'dock' ? DOCK_W : beachW[j];
  }
  // In a bay the mitres close in on each other: narrow the shore where its rows would cross.
  for (let pass = 0; pass < 20; pass++) {
    let ok = true;
    for (const s of segs) {
      const m0 = mitre[s.i], m1 = mitre[(s.i + 1) % n];
      const far = (w0, w1) => s.len + (m1.x * w1 - m0.x * w0) * s.dx + (m1.z * w1 - m0.z * w0) * s.dz;
      if (far(s.w0 + UNDERWATER, s.w1 + UNDERWATER) < 4) {
        s.w0 = Math.max(PROMENADE + 4, s.w0 * 0.85);
        s.w1 = Math.max(PROMENADE + 4, s.w1 * 0.85);
        ok = false;
      }
    }
    if (ok) break;
  }

  const at = (i, d) => ({ x: curb[i].x + mitre[i].x * d, z: curb[i].z + mitre[i].z * d });
  for (const s of segs) {
    const j = (s.i + 1) % n;
    s.j = j;
    s.mitre0 = mitre[s.i];
    s.mitre1 = mitre[j];
    // Everything this stretch owns, out past the waterline: for lookups.
    s.quad = [curb[s.i], curb[j], at(j, s.w1 + UNDERWATER), at(s.i, s.w0 + UNDERWATER)];
    s.hit = s.quad.slice().reverse(); // CCW, for the inside test
    s.prev = segs[(s.i + n - 1) % n];
    s.next = segs[j];
  }

  // The waterline. Where a dock meets a beach the shore steps out or in along the mitre.
  const coast = [];
  for (const s of segs) {
    const p = s.prev;
    coast.push(at(s.i, p.w1));
    if (Math.abs(p.w1 - s.w0) > 0.01) coast.push(at(s.i, s.w0));
  }

  // Piers: a short one off the middle of each long dock, and one long pleasure pier off the
  // longest beach.
  const piers = [];
  const pier = (s, from, length, width, kind) => {
    const t = 0.5;
    const cx = s.a.x + (s.b.x - s.a.x) * t, cz = s.a.z + (s.b.z - s.a.z) * t;
    const hw = width / 2;
    const p0 = { x: cx + s.nx * from, z: cz + s.nz * from };
    const p1 = { x: p0.x + s.nx * length, z: p0.z + s.nz * length };
    const poly = [
      { x: p0.x + s.dx * hw, z: p0.z + s.dz * hw },
      { x: p1.x + s.dx * hw, z: p1.z + s.dz * hw },
      { x: p1.x - s.dx * hw, z: p1.z - s.dz * hw },
      { x: p0.x - s.dx * hw, z: p0.z - s.dz * hw },
    ];
    if (signedArea(poly) < 0) poly.reverse();
    piers.push({ kind, poly, x0: p0.x, z0: p0.z, ux: s.nx, uz: s.nz, vx: s.dx, vz: s.dz, length, hw, seg: s.i });
  };
  // Along each run of dock, a pier every 50 m or so (not too near either end of the run).
  const runs = [];
  for (const s of segs) {
    if (s.type !== 'dock') continue;
    if (s.prev.type === 'dock' && runs.length && runs.at(-1).at(-1) === s.prev) runs.at(-1).push(s);
    else runs.push([s]);
  }
  if (runs.length > 1 && segs[0].type === 'dock' && segs.at(-1).type === 'dock') runs[0].unshift(...runs.pop());
  for (const r of runs) {
    let along = 0;
    let last = 0;
    for (const s of r) {
      along += s.len;
      const total = r.reduce((a, q) => a + q.len, 0);
      if (along - last > 50 && along > 24 && total - along > 24) {
        pier(s, s.w0 - 0.5, 24, 7, 'dock');
        last = along;
      }
    }
  }
  // The pleasure pier: off the middle of the longest straight stretch of beach.
  let best = null;
  for (const s of segs) {
    if (s.type !== 'beach' || [s.prev, s.next, s.prev.prev, s.next.next].some((q) => q.type !== 'beach')) continue;
    const len = edges.filter((e) => e.edge === s.edge).reduce((a, e) => a + e.len, 0);
    const piece = segs.filter((q) => q.edge === s.edge);
    if (piece[piece.length >> 1] !== s) continue;
    if (!best || len > best.len) best = { s, len };
  }
  if (best) pier(best.s, PROMENADE - 0.2, Math.max(best.s.w0, best.s.w1) + 46, 8, 'pleasure');

  const bb = bounds([...coast, ...piers.flatMap((p) => p.poly), ...segs.flatMap((s) => s.quad)]);
  const shore = { curb, segs, coast, piers, bounds: bb, mitre, at };

  // Spatial hash of stretches and piers for the point lookups.
  const CELL = 24;
  const cells = new Map();
  const key = (cx, cz) => cx * 100003 + cz;
  const insert = (poly, item) => {
    const b = bounds(poly);
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) {
      for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
        const k = key(x, z);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(item);
      }
    }
  };
  for (const s of segs) insert(s.quad, s);
  for (const p of piers) insert(p.poly, p);
  shore.near = (x, z) => cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
  return shore;
}

/** Is (x, z) inside a convex CCW polygon? */
function inConvex(poly, x, z) {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if ((x - p.x) * (q.z - p.z) - (z - p.z) * (q.x - p.x) > 1e-9) return false;
  }
  return true;
}

/** Is (x, z) inside a simple polygon (any orientation)? Even-odd rule. */
export function inPolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Where a point is on a stretch of shore: { seg, d, w } with d its distance out from the curb and
 * w the stretch's width (curb to waterline) at that point. Null if it isn't over any stretch.
 */
function locate(shore, x, z) {
  for (const s of shore.near(x, z)) {
    if (!s.hit || !inConvex(s.hit, x, z)) continue;
    const d = (x - s.a.x) * s.nx + (z - s.a.z) * s.nz;
    // How far along: measured along the row at this distance out.
    const r0x = s.a.x + s.mitre0.x * d, r0z = s.a.z + s.mitre0.z * d;
    const r1x = s.b.x + s.mitre1.x * d, r1z = s.b.z + s.mitre1.z * d;
    const rl = (r1x - r0x) * s.dx + (r1z - r0z) * s.dz;
    const t = Math.max(0, Math.min(1, ((x - r0x) * s.dx + (z - r0z) * s.dz) / (rl || 1)));
    return { seg: s, d, t, w: s.w0 + (s.w1 - s.w0) * t };
  }
  return null;
}

/** Sand height at distance d out from the curb on a beach whose waterline is w out. */
export function sandHeight(d, w) {
  if (d <= w) return SHORE_Y.sandTop + (WATER_LEVEL - SHORE_Y.sandTop) * Math.max(0, (d - PROMENADE) / (w - PROMENADE));
  return WATER_LEVEL - 1.2 * Math.min(1, (d - w) / UNDERWATER);
}

/** The pier under (x, z), if any. */
export function pierAt(shore, x, z) {
  for (const p of shore.near(x, z)) if (!p.hit && inConvex(p.poly, x, z)) return p;
  return null;
}

/**
 * Ground under a point on the shore: { height, kind } where kind is 'promenade', 'dock', 'sand',
 * 'pier' or 'sea'. Null if the point isn't on the shore (it's in town, or out at sea).
 */
export function shoreGround(shore, x, z) {
  if (pierAt(shore, x, z)) return { height: SHORE_Y.pier, kind: 'pier' };
  const l = locate(shore, x, z);
  if (!l) return null;
  if (l.d < PROMENADE) return { height: SHORE_Y.curb, kind: 'promenade' };
  if (l.seg.type === 'dock') return l.d <= l.w ? { height: SHORE_Y.curb, kind: 'dock' } : { height: WATER_LEVEL, kind: 'sea' };
  return { height: sandHeight(l.d, l.w), kind: l.d <= l.w ? 'sand' : 'sea' };
}

/**
 * The sea's view of the coast, sampled on a grid: signed distance to the waterline (negative on
 * land) and how "beachy" the nearest coast is (1 = beach, 0 = quay). For the water shader.
 */
export function seaField(shore, cell = 2, margin = 140) {
  const b = shore.bounds;
  const minX = b.minX - margin, minZ = b.minZ - margin;
  const w = Math.ceil((b.maxX - b.minX + margin * 2) / cell), h = Math.ceil((b.maxZ - b.minZ + margin * 2) / cell);
  const dist = new Float32Array(w * h), beach = new Float32Array(w * h);
  // Waterline segments, each tagged with the kind of shore it belongs to.
  const lines = [];
  const at = shore.at;
  for (const s of shore.segs) {
    const p = s.prev;
    if (Math.abs(p.w1 - s.w0) > 0.01) lines.push([at(s.i, p.w1), at(s.i, s.w0), 0]); // dock end wall
    lines.push([at(s.i, s.w0), at(s.j, s.w1), s.type === 'beach' ? 1 : 0]);
  }
  // Unsigned distance, near each segment only (further out the sea is just "far").
  const FAR = 70;
  dist.fill(FAR);
  for (const [a, q, kind] of lines) {
    const x0 = Math.max(0, Math.floor((Math.min(a.x, q.x) - FAR - minX) / cell));
    const x1 = Math.min(w - 1, Math.ceil((Math.max(a.x, q.x) + FAR - minX) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(a.z, q.z) - FAR - minZ) / cell));
    const z1 = Math.min(h - 1, Math.ceil((Math.max(a.z, q.z) + FAR - minZ) / cell));
    for (let z = z0; z <= z1; z++) {
      const pz = minZ + (z + 0.5) * cell;
      for (let x = x0; x <= x1; x++) {
        const i = z * w + x;
        const d = segDist(a, q, minX + (x + 0.5) * cell, pz);
        if (d < dist[i]) (dist[i] = d), (beach[i] = kind);
      }
    }
  }
  // Sign: negative on land. Scanline fill of the coast polygon, row by row.
  const poly = shore.coast;
  for (let z = 0; z < h; z++) {
    const pz = minZ + (z + 0.5) * cell;
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const A = poly[i], B = poly[j];
      if (A.z > pz !== B.z > pz) xs.push(A.x + ((pz - A.z) * (B.x - A.x)) / (B.z - A.z));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil((xs[k] - minX) / cell - 0.5));
      const x1 = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / cell - 0.5));
      for (let x = x0; x <= x1; x++) dist[z * w + x] = -dist[z * w + x];
    }
  }
  return { minX, minZ, cell, w, h, dist, beach };
}

function segDist(a, b, x, z) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2));
  return Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
}
