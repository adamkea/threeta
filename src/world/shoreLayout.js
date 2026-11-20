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
const WHARF_W = 12; // curb to the edge of the wooden wharf
const SEAWALL_W = PROMENADE + 0.9; // the seawall: the promenade and the barrier along its top
const YARD_W = 32; // curb to quay edge in the shipyard: room for a container yard and the crane lane
const STEP = 12; // length of the pieces the shore is built from

/**
 * @param {{x:number,z:number}[]} curbIn outer curb of the road network (any orientation)
 * @param {(x:number,z:number)=>'beach'|'yard'|'wharf'|'seawall'} kindAt which kind of shore a
 *   stretch of coast is. Everything but beach is built as a "dock" (flat, ending in an edge with
 *   water straight below it): the shipyard's deep concrete quay, the west's wooden wharf, or the
 *   north's seawall, just the promenade with a barrier along the top.
 */
export function buildShore(curbIn, rng, kindAt) {
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
  // Which way each vertex pushes out. A plain mitre would put all of a corner's turn on one
  // vertex, and rows 30 m out would fold over; instead the outward direction is averaged over the
  // coast either side, so corners round off over a few pieces. Scaled so that on a straight run
  // `d` is exactly the distance out from the curb.
  const SMOOTH = 36;
  const mitre = curb.map((p, i) => {
    let ux = 0, uz = 0;
    for (const dir of [1, -1]) {
      let along = 0;
      for (let k = 0; along < SMOOTH && k < n; k++) {
        const e = edges[(dir > 0 ? i + k : i - 1 - k + n * 2) % n];
        const wgt = (1 - along / SMOOTH) * Math.min(e.len, SMOOTH - along);
        ux += e.nx * wgt;
        uz += e.nz * wgt;
        along += e.len;
      }
    }
    const l = Math.hypot(ux, uz) || 1;
    ux /= l;
    uz /= l;
    const e0 = edges[(i + n - 1) % n], e1 = edges[i];
    const cos = Math.max(0.4, (ux * (e0.nx + e1.nx) + uz * (e0.nz + e1.nz)) / 2);
    return { x: ux / cos, z: uz / cos };
  });

  // What each stretch is, and how wide: beach widths wander gently along the coast.
  const segs = edges.map((e, i) => {
    const mx = (e.a.x + e.b.x) / 2 + e.nx * 10, mz = (e.a.z + e.b.z) / 2 + e.nz * 10;
    const kind = kindAt(mx, mz);
    return { i, ...e, kind, type: kind === 'beach' ? 'beach' : 'dock', yard: kind === 'yard' };
  });
  const ph = Array.from({ length: 3 }, () => rng.range(0, Math.PI * 2));
  let run = 0;
  const beachW = curb.map((p, i) => {
    if (i) run += edges[i - 1].len;
    const wave = 0.45 * Math.sin(run / 70 + ph[0]) + 0.35 * Math.sin(run / 29 + ph[1]) + 0.2 * Math.sin(run / 13 + ph[2]);
    return BEACH_W[0] + (BEACH_W[1] - BEACH_W[0]) * (0.5 + 0.5 * wave);
  });
  // Widths are kept per vertex for each kind of shore, so neighbouring pieces of the same kind
  // meet without a step.
  const kindOf = (s) => s.kind;
  const W = {
    beach: beachW,
    wharf: curb.map(() => WHARF_W),
    yard: curb.map(() => YARD_W),
    seawall: curb.map(() => SEAWALL_W),
  };
  // In a bay the rows still close in on each other: narrow the shore there, and taper the
  // narrowing gently along the coast so it doesn't leave notches.
  for (let pass = 0; pass < 40; pass++) {
    let ok = true;
    for (const s of segs) {
      const w = W[kindOf(s)], j = (s.i + 1) % n;
      const m0 = mitre[s.i], m1 = mitre[j];
      const far = s.len + (m1.x * (w[j] + UNDERWATER) - m0.x * (w[s.i] + UNDERWATER)) * s.dx + (m1.z * (w[j] + UNDERWATER) - m0.z * (w[s.i] + UNDERWATER)) * s.dz;
      if (far < 4) {
        w[s.i] = Math.max(PROMENADE + 4, w[s.i] * 0.92);
        w[j] = Math.max(PROMENADE + 4, w[j] * 0.92);
        ok = false;
      }
    }
    for (const w of Object.values(W)) {
      for (let k = 0; k < 2 * n; k++) {
        const i = k % n, prev = (i + n - 1) % n;
        w[i] = Math.min(w[i], w[prev] + edges[prev].len * 0.35);
        const r = n - 1 - i, next = (r + 1) % n;
        w[r] = Math.min(w[r], w[next] + edges[r].len * 0.35);
      }
    }
    if (ok) break;
  }
  for (const s of segs) {
    const w = W[kindOf(s)];
    s.w0 = w[s.i];
    s.w1 = w[(s.i + 1) % n];
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
  // Along the wharf, piers of all lengths every 35 m or so (not too near either end of it).
  const runs = [];
  for (const s of segs) {
    if (s.kind !== 'wharf') continue;
    if (runs.length && runs.at(-1).at(-1) === s.prev) runs.at(-1).push(s);
    else runs.push([s]);
  }
  if (runs.length > 1 && runs[0][0].prev === runs.at(-1).at(-1)) runs[0].unshift(...runs.pop());
  for (const r of runs) {
    const total = r.reduce((a, q) => a + q.len, 0);
    let along = 0;
    let last = -10;
    for (const s of r) {
      along += s.len;
      if (along - last > 35 && along > 18 && total - along > 18 && Math.abs(s.w0 - s.w1) < 0.5) {
        pier(s, s.w0 - 0.5, rng.range(18, 44), rng.pick([6, 7, 9]), 'wharf');
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

  const ships = berthShips(segs, coast, at);

  const bb = bounds([...coast, ...piers.flatMap((p) => p.poly), ...segs.flatMap((s) => s.quad), ...ships.flatMap((s) => s.poly)]);
  const shore = { curb, segs, coast, piers, ships, bounds: bb, mitre, at };

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

/**
 * Cargo ships tied up along the shipyard quay: wherever the quay runs straight enough for a whole
 * hull to lie alongside it, clear of the shore and of each other.
 * Each ship: { x, z, ux, uz (bow direction), length, beam, poly (CCW hull outline, bow pointed) }.
 */
function berthShips(segs, coast, at) {
  const ships = [];
  const LENGTH = 60, BEAM = 12, GAP = 1.2;
  for (const s of segs) {
    if (!s.yard || !s.prev.yard || !s.next.yard) continue;
    const mid = at(s.i, 0), mid1 = at(s.j, 0);
    const w = (s.w0 + s.w1) / 2;
    const cx0 = (mid.x + mid1.x) / 2, cz0 = (mid.z + mid1.z) / 2;
    const off = w + GAP + BEAM / 2;
    const x = cx0 + s.nx * off, z = cz0 + s.nz * off;
    if (ships.some((o) => Math.hypot(o.x - x, o.z - z) < LENGTH + 10)) continue;
    // The quay must run along the whole near side of the hull, and the hull must be in open water.
    let ok = true;
    for (let k = -1; k <= 1 && ok; k += 0.1) {
      const ax = x + s.dx * k * LENGTH * 0.5, az = z + s.dz * k * LENGTH * 0.5;
      const near = BEAM / 2 + GAP;
      for (const v of [-near + 0.3, 0, near]) {
        if (inPolygon(coast, ax - s.nx * v, az - s.nz * v)) ok = false;
      }
      if (!inPolygon(coast, ax - s.nx * (near + 3.5), az - s.nz * (near + 3.5))) ok = false;
    }
    if (!ok) continue;
    const hl = LENGTH / 2, hb = BEAM / 2;
    const pt = (u, v) => ({ x: x + s.dx * u + s.nx * v, z: z + s.dz * u + s.nz * v });
    let poly = [pt(-hl, -hb), pt(hl - 10, -hb), pt(hl, 0), pt(hl - 10, hb), pt(-hl, hb)];
    if (signedArea(poly) < 0) poly = poly.reverse();
    ships.push({ x, z, ux: s.dx, uz: s.dz, vx: s.nx, vz: s.nz, length: LENGTH, beam: BEAM, poly });
  }
  return ships;
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
    // Solve a + t (b - a) + d (m0 + t (m1 - m0)) = p for (t, d): the piece is a bilinear patch
    // between the curb and the rows further out. A few Newton steps from the straight-run guess.
    const m0 = s.mitre0, m1 = s.mitre1;
    let d = (x - s.a.x) * s.nx + (z - s.a.z) * s.nz;
    let t = ((x - s.a.x) * s.dx + (z - s.a.z) * s.dz) / s.len;
    for (let k = 0; k < 6; k++) {
      const mx = m0.x + t * (m1.x - m0.x), mz = m0.z + t * (m1.z - m0.z);
      const fx = s.a.x + t * (s.b.x - s.a.x) + d * mx - x;
      const fz = s.a.z + t * (s.b.z - s.a.z) + d * mz - z;
      const tx = s.b.x - s.a.x + d * (m1.x - m0.x), tz = s.b.z - s.a.z + d * (m1.z - m0.z);
      const det = tx * mz - tz * mx;
      if (Math.abs(det) < 1e-9) break;
      t -= (fx * mz - fz * mx) / det;
      d -= (tx * fz - tz * fx) / det;
    }
    t = Math.max(0, Math.min(1, t));
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
