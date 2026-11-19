import { createRng } from '../core/random.js';
import {
  bounds, centroid, chamferAcute, insideConvex, isAxisRect, signedArea, simplify,
} from './geom.js';

// The city as pure data: a road graph (junctions joined by straight roads of any angle and
// width), the blocks it encloses (convex polygons), what each block is used for, and the
// pedestrian walk graph round the blocks. Built once, deterministically, at import time, so every
// system (rendering, traffic, police, pedestrians, the map) reads the same layout.
//
// Coordinates are metres on the ground plane: +X east, +Z south (down the screen).

export const CITY = {
  sidewalk: 3,
  curbHeight: 0.25,
  roadWidth: 14, // an ordinary street; avenues are wider
};

/** Height of the sea around the island; anything that goes over the edge falls to this. */
export const WATER_Y = -0.6;

const STREET = 14;
const AVENUE = 18;
const DIAGONAL = 16;
const N = 8; // blocks per side of the underlying lattice
const BLOCK_SIZES = [34, 40, 40, 44, 44, 48, 52, 58];

// Parking lot dimensions (m).
export const LOT = { bayWidth: 2.8, bayDepth: 5.2 };

/* ------------------------------------------------------------------------------------------ */
/* Road graph                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * Junctions (`nodes`) joined by straight roads (`edges`). Each edge has two half-edges, one per
 * direction of travel: half-edge `2e` runs a -> b, `2e + 1` runs b -> a. `node.out` lists the
 * half-edges leaving a node, sorted by angle.
 */
export class RoadGraph {
  constructor() {
    this.nodes = [];
    this.edges = [];
  }

  addNode(x, z) {
    const n = { id: this.nodes.length, x, z, out: [] };
    this.nodes.push(n);
    return n.id;
  }

  addEdge(a, b, width, kind = 'street') {
    const e = { id: this.edges.length, a, b, width, kind, removed: false };
    this.edges.push(e);
    return e.id;
  }

  // --- Half-edge helpers ---
  from(h) {
    const e = this.edges[h >> 1];
    return h & 1 ? e.b : e.a;
  }
  to(h) {
    const e = this.edges[h >> 1];
    return h & 1 ? e.a : e.b;
  }
  /** Unit direction of travel along half-edge h, as [dx, dz]. */
  dir(h) {
    const e = this.edges[h >> 1];
    return h & 1 ? [-e.dx, -e.dz] : [e.dx, e.dz];
  }
  edge(h) {
    return this.edges[h >> 1];
  }
  /** Distance from h's start node to where its junction ends (the curb line of the cross street). */
  setbackStart(h) {
    return this.setback[h];
  }
  setbackEnd(h) {
    return this.setback[h ^ 1];
  }

  /** Drops removed edges and nodes left without roads, renumbering everything. */
  compact() {
    const live = this.edges.filter((e) => !e.removed);
    const used = new Set(live.flatMap((e) => [e.a, e.b]));
    const remap = new Map();
    const nodes = [];
    for (const n of this.nodes) {
      if (!used.has(n.id)) continue;
      remap.set(n.id, nodes.length);
      nodes.push({ ...n, id: nodes.length, out: [] });
    }
    this.nodes = nodes;
    this.edges = live.map((e, i) => ({ ...e, id: i, a: remap.get(e.a), b: remap.get(e.b) }));
    return remap;
  }

  /** Computes directions, lengths, junction setbacks and signal phases. Call once, after building. */
  finalize() {
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      const dx = B.x - A.x, dz = B.z - A.z;
      e.len = Math.hypot(dx, dz);
      e.dx = dx / e.len;
      e.dz = dz / e.len;
      e.hw = e.width / 2;
      e.lane = e.width / 4; // one lane each way, centred in its half of the road
      A.out.push(e.id * 2);
      B.out.push(e.id * 2 + 1);
    }
    for (const n of this.nodes) {
      n.out.sort((p, q) => angleOf(this.dir(p)) - angleOf(this.dir(q)));
      n.deg = n.out.length;
      n.signal = n.deg >= 3;
    }

    // Setback: how far along each road its junction box reaches, i.e. where its curbs meet the
    // curbs of the roads either side of it. Square junctions: the cross street's half-width.
    this.setback = new Float64Array(this.edges.length * 2);
    for (const n of this.nodes) {
      const k = n.out.length;
      if (k < 2) continue;
      for (let i = 0; i < k; i++) {
        const h = n.out[i];
        let s = 0;
        for (const o of [n.out[(i + 1) % k], n.out[(i + k - 1) % k]]) {
          if (o === h) continue;
          const [ax, az] = this.dir(h), [bx, bz] = this.dir(o);
          const cos = ax * bx + az * bz;
          const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
          if (sin < 0.17 && cos < 0) continue; // carries straight on: no junction box
          const t = (this.edge(o).hw + this.edge(h).hw * cos) / Math.max(sin, 0.3);
          s = Math.max(s, t);
        }
        this.setback[h] = Math.min(s, 40);
      }
    }

    // Signal phases: roads arriving from opposite directions share a green; the rest get their own.
    for (const n of this.nodes) {
      n.phaseOf = new Map();
      if (!n.signal) continue;
      const left = n.out.slice();
      let phase = 0;
      while (left.length) {
        const h = left.shift();
        const [ax, az] = this.dir(h);
        let best = -1, bestDot = -0.8;
        left.forEach((o, i) => {
          const [bx, bz] = this.dir(o);
          const dot = ax * bx + az * bz;
          if (dot < bestDot) (bestDot = dot), (best = i);
        });
        n.phaseOf.set(h >> 1, phase);
        if (best >= 0) n.phaseOf.set(left.splice(best, 1)[0] >> 1, phase);
        phase++;
      }
      n.phases = phase;
    }

    this.edgeHash = new BucketGrid(32);
    for (const e of this.edges) {
      const A = this.nodes[e.a], B = this.nodes[e.b];
      this.edgeHash.insertBox(
        Math.min(A.x, B.x) - e.hw, Math.min(A.z, B.z) - e.hw, Math.max(A.x, B.x) + e.hw, Math.max(A.z, B.z) + e.hw, e.id,
      );
    }
  }

  /** Edge ids whose road could come within `r` of (x, z). */
  edgesNear(x, z, r) {
    return this.edgeHash.query(x - r, z - r, x + r, z + r);
  }

  /** The half-edge whose lane centre is closest to (x, z), with the distance and position along it. */
  nearestLane(x, z, fwdX = 0, fwdZ = 0, minDot = -2, r = 30) {
    let best = null;
    for (const id of this.edgesNear(x, z, r)) {
      for (const h of [id * 2, id * 2 + 1]) {
        const [dx, dz] = this.dir(h);
        if (dx * fwdX + dz * fwdZ < minDot) continue;
        const A = this.nodes[this.from(h)];
        const lane = this.edge(h).lane;
        const ax = A.x - dz * lane, az = A.z + dx * lane; // lane on the right of travel
        const s = Math.max(0, Math.min(this.edge(h).len, (x - ax) * dx + (z - az) * dz));
        const d = Math.hypot(x - (ax + dx * s), z - (az + dz * s));
        if (!best || d < best.dist) best = { h, dist: d, s };
      }
    }
    return best;
  }
}

const angleOf = ([dx, dz]) => Math.atan2(dz, dx);

/** Uniform bucket grid of ids by bounding box. */
class BucketGrid {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
  }
  #key(cx, cz) {
    return cx * 100003 + cz;
  }
  insertBox(minX, minZ, maxX, maxZ, id) {
    const c = this.cell;
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++) {
      for (let z = Math.floor(minZ / c); z <= Math.floor(maxZ / c); z++) {
        const k = this.#key(x, z);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(id);
      }
    }
  }
  /** Ids in the cell containing (x, z). May contain each id once. */
  at(x, z) {
    return this.cells.get(this.#key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? EMPTY;
  }
  /** Unique ids in every cell the box touches. */
  query(minX, minZ, maxX, maxZ) {
    const c = this.cell;
    const out = new Set();
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++) {
      for (let z = Math.floor(minZ / c); z <= Math.floor(maxZ / c); z++) {
        const list = this.cells.get(this.#key(x, z));
        if (list) for (const id of list) out.add(id);
      }
    }
    return [...out];
  }
}
const EMPTY = [];

/* ------------------------------------------------------------------------------------------ */
/* Generation                                                                                  */
/* ------------------------------------------------------------------------------------------ */

function generate(seed) {
  const rng = createRng(seed);

  // --- Lattice lines: uneven block sizes, one wide avenue each way ---
  const bxs = Array.from({ length: N }, () => rng.pick(BLOCK_SIZES));
  const bzs = Array.from({ length: N }, () => rng.pick(BLOCK_SIZES));
  const avX = rng.int(2, 6), avZ = rng.int(2, 6);
  const wx = (i) => (i === avX ? AVENUE : STREET); // width of the road along line x_i (runs along Z)
  const wz = (j) => (j === avZ ? AVENUE : STREET);
  const span = (blocks, w) => blocks.reduce((a, b) => a + b, 0) + Array.from({ length: N + 1 }, (_, i) => w(i)).reduce((a, b) => a + b, 0);
  // Square island: pad the shorter axis evenly.
  let sx = span(bxs, wx), sz = span(bzs, wz);
  const pad = (blocks, diff) => {
    for (let k = 0; diff > 0; k = (k + 1) % N, diff -= 2) blocks[k] += Math.min(2, diff);
  };
  if (sx < sz) pad(bxs, sz - sx);
  else pad(bzs, sx - sz);
  sx = span(bxs, wx);
  sz = span(bzs, wz);
  const size = Math.max(sx, sz);
  const half = size / 2;
  const lines = (blocks, w) => {
    const out = [-half + w(0) / 2];
    for (let i = 0; i < N; i++) out.push(out[i] + w(i) / 2 + blocks[i] + w(i + 1) / 2);
    return out;
  };
  const xs = lines(bxs, wx), zs = lines(bzs, wz);

  const g = new RoadGraph();
  const grid = [];
  for (let i = 0; i <= N; i++) {
    grid.push([]);
    for (let j = 0; j <= N; j++) grid[i].push(g.addNode(xs[i], zs[j]));
  }
  const hEdge = [], vEdge = []; // hEdge[i][j]: (i,j)-(i+1,j) along X; vEdge[i][j]: (i,j)-(i,j+1) along Z
  for (let i = 0; i <= N; i++) {
    hEdge.push([]);
    vEdge.push([]);
    for (let j = 0; j <= N; j++) {
      if (i < N) hEdge[i][j] = g.addEdge(grid[i][j], grid[i + 1][j], wz(j), j === avZ ? 'avenue' : 'street');
      if (j < N) vEdge[i][j] = g.addEdge(grid[i][j], grid[i][j + 1], wx(i), i === avX ? 'avenue' : 'street');
    }
  }

  // --- A diagonal avenue cutting corner to corner through a run of blocks ---
  const reserved = new Set(); // blocks (bx * 100 + bz) that can't be merged
  const diagNodes = new Set();
  const DIAG = 6;
  for (let k = 0; k < DIAG; k++) {
    g.addEdge(grid[k][DIAG - k], grid[k + 1][DIAG - 1 - k], DIAGONAL, 'avenue');
    reserved.add(k * 100 + (DIAG - 1 - k));
    diagNodes.add(grid[k][DIAG - k]).add(grid[k + 1][DIAG - 1 - k]);
  }

  // --- Superblocks: a 2x2 park, plus pairs of blocks joined where a street is closed ---
  const touched = new Set(); // nodes next to a closed street
  const merged = new Map(); // block key -> group tag
  const close = (e) => {
    g.edges[e].removed = true;
    touched.add(g.edges[e].a).add(g.edges[e].b);
  };
  const PX = 5, PZ = 5; // park's top-left block
  for (const e of [vEdge[PX + 1][PZ], vEdge[PX + 1][PZ + 1], hEdge[PX][PZ + 1], hEdge[PX + 1][PZ + 1]]) close(e);
  for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) merged.set((PX + a) * 100 + PZ + b, 'park');

  const pairs = [];
  for (let bx = 0; bx < N; bx++) {
    for (let bz = 0; bz < N; bz++) {
      if (bx + 1 < N) pairs.push([bx, bz, bx + 1, bz, vEdge[bx + 1][bz]]);
      if (bz + 1 < N) pairs.push([bx, bz, bx, bz + 1, hEdge[bx][bz + 1]]);
    }
  }
  shuffle(pairs, rng);
  let joins = 0;
  for (const [ax, az, bx, bz, e] of pairs) {
    if (joins >= 5) break;
    const ka = ax * 100 + az, kb = bx * 100 + bz;
    if (reserved.has(ka) || reserved.has(kb) || merged.has(ka) || merged.has(kb)) continue;
    const { a, b } = g.edges[e];
    if (touched.has(a) || touched.has(b) || diagNodes.has(a) || diagNodes.has(b)) continue;
    // Only interior streets (both ends ordinary 4-way crossroads).
    if (isRing(g.nodes[a], xs, zs) || isRing(g.nodes[b], xs, zs)) continue;
    close(e);
    merged.set(ka, 'pair').set(kb, 'pair');
    joins++;
  }

  g.compact();
  g.finalize();

  const blocks = traceBlocks(g);
  const layout = { graph: g, blocks, size, half, lots: [], landmarks: [], spawn: null };
  assignUses(layout, rng);
  layout.walk = buildWalkGraph(g, blocks);
  layout.blockHash = new BucketGrid(16);
  for (const b of blocks) {
    const { minX, minZ, maxX, maxZ } = b.bounds;
    layout.blockHash.insertBox(minX, minZ, maxX, maxZ, b.id);
  }
  layout.signalHeads = buildSignalHeads(g, blocks);
  return layout;
}

function isRing(n, xs, zs) {
  const eps = 0.01;
  return Math.abs(n.x - xs[0]) < eps || Math.abs(n.x - xs[N]) < eps || Math.abs(n.z - zs[0]) < eps || Math.abs(n.z - zs[N]) < eps;
}

function shuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Blocks                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Interior normal of half-edge h (the side its block is on: the right of travel). */
function inward(g, h) {
  const [dx, dz] = g.dir(h);
  return [-dz, dx];
}

/**
 * Where the curbs of half-edges `hIn` (arriving at node n) and `hOut` (leaving it) meet, pushed
 * `inset` metres further into the block: returns { x, z, vx, vz } so that the point for any inset
 * is (x + vx * inset, z + vz * inset).
 */
function cornerAt(g, n, hIn, hOut) {
  const [ax, az] = inward(g, hIn), [bx, bz] = inward(g, hOut);
  const w1 = g.edge(hIn).hw, w2 = g.edge(hOut).hw;
  const det = ax * bz - az * bx;
  const N_ = g.nodes[n];
  if (Math.abs(det) < 0.05) {
    // Straight on (a T-junction's flat side): just step in from the curb.
    const w = Math.max(w1, w2);
    return { x: N_.x + bx * w, z: N_.z + bz * w, vx: bx, vz: bz, straight: true };
  }
  const solve = (c1, c2) => [(c1 * bz - az * c2) / det, (ax * c2 - c1 * bx) / det];
  const [px, pz] = solve(w1, w2);
  const [vx, vz] = solve(1, 1);
  return { x: N_.x + px, z: N_.z + pz, vx, vz, straight: false };
}

/** Walks the planar graph's faces. Each bounded face is a city block. */
function traceBlocks(g) {
  const faceOf = new Int32Array(g.edges.length * 2).fill(-2);
  const blocks = [];
  for (let h0 = 0; h0 < g.edges.length * 2; h0++) {
    if (faceOf[h0] !== -2) continue;
    const hs = [];
    let h = h0;
    do {
      hs.push(h);
      const v = g.nodes[g.to(h)];
      const k = v.out.indexOf(h ^ 1);
      h = v.out[(k - 1 + v.out.length) % v.out.length];
    } while (h !== h0 && hs.length < 64);
    const poly = hs.map((x) => g.nodes[g.from(x)]);
    const area = signedArea(poly);
    const id = area > 0 ? blocks.length : -1;
    for (const x of hs) faceOf[x] = id;
    if (area <= 0) continue;

    // Curb outline: one corner per junction round the block.
    const corners = hs.map((hOut, k) => cornerAt(g, g.from(hOut), hs[(k + hs.length - 1) % hs.length], hOut));
    const curb = simplify(corners.map((c) => ({ x: c.x, z: c.z })));
    const shape = chamferAcute(curb, (65 * Math.PI) / 180, 2.5);
    const c = centroid(shape);
    blocks.push({
      id,
      halfEdges: hs,
      corners,
      curb,
      shape,
      bounds: bounds(shape),
      center: c,
      area: signedArea(shape),
      rect: isAxisRect(shape) ? bounds(shape) : null,
      use: 'buildings',
      group: null,
    });
  }
  g.faceOf = faceOf;
  return blocks;
}

/** Decides what goes on each block: landmarks, the starting car park, parks, other lots, buildings. */
function assignUses(layout, rng) {
  const { blocks, half, graph: g } = layout;
  const dims = (b) => (b.rect ? [b.rect.maxX - b.rect.minX, b.rect.maxZ - b.rect.minZ] : [0, 0]);
  const free = (b) => b.use === 'buildings' && !b.taken;
  for (const b of blocks) {
    b.downtown = 1 - Math.min(1, Math.hypot(b.center.x, b.center.z) / half);
    const [w, d] = dims(b);
    // Superblocks show up as unusually big faces.
    b.superblock = b.rect && (w > 70 || d > 70);
    if (b.superblock && w > 70 && d > 70) b.use = 'park';
  }

  const lotFits = (b) => {
    if (!b.rect) return null;
    const [w, d] = dims(b);
    const s = CITY.sidewalk;
    const aisle = (d - 2 * s - 4 * LOT.bayDepth) / 2;
    const bays = Math.floor((w - 2 * s - 2) / LOT.bayWidth);
    if (aisle < 6 || aisle > 10 || bays < 6 || w > 70) return null;
    return { aisle, bays, w, d };
  };
  const nearest = (x, z, ok) => {
    let best = null, bd = Infinity;
    for (const b of blocks) {
      if (!free(b) || !ok(b)) continue;
      const d = Math.hypot(b.center.x - x, b.center.z - z);
      if (d < bd) (bd = d), (best = b);
    }
    return best;
  };

  // The starting car park, nearest the middle of town.
  const makeLot = (b) => {
    const fit = lotFits(b);
    const s = CITY.sidewalk, d = LOT.bayDepth, a = fit.aisle;
    b.use = 'lot';
    b.lot = {
      x0: b.rect.minX,
      z0: b.rect.minZ,
      w: fit.w,
      d: fit.d,
      bays: fit.bays,
      bx0: s + (fit.w - 2 * s - fit.bays * LOT.bayWidth) / 2,
      aisles: [
        [s + d, s + d + a],
        [s + 3 * d + a, s + 3 * d + 2 * a],
      ],
      // Each row: its z range and which way a car parked nose-in faces (+1 = +Z).
      rows: [
        { z0: s, z1: s + d, nose: -1 },
        { z0: s + d + a, z1: s + 2 * d + a, nose: 1 },
        { z0: s + 2 * d + a, z1: s + 3 * d + a, nose: -1 },
        { z0: s + 3 * d + 2 * a, z1: s + 4 * d + 2 * a, nose: 1 },
      ],
    };
    layout.lots.push(b.lot);
  };
  const start = nearest(0, 0, (b) => lotFits(b) && !b.superblock);
  makeLot(start);

  // Landmarks: square-ish blocks big enough for them, near where they'd sit in town.
  const landmarkFits = (b) => {
    const [w, d] = dims(b);
    return w >= 40 && d >= 40 && w <= 60 && d <= 60;
  };
  for (const [kind, fx, fz] of [['police', -0.3, 0.15], ['hospital', 0.3, -0.35]]) {
    const b = nearest(fx * half, fz * half, landmarkFits);
    if (!b) continue;
    b.use = kind;
    layout.landmarks.push({ kind, block: b, cx: (b.rect.minX + b.rect.maxX) / 2, cz: (b.rect.minZ + b.rect.maxZ) / 2 });
  }

  for (const b of blocks) {
    if (!free(b)) continue;
    if (!b.rect) {
      if (rng.chance(0.35)) b.use = 'park'; // triangular plazas
    } else if (rng.chance(b.superblock ? 0.3 : 0.1)) b.use = 'park';
    else if (lotFits(b) && rng.chance(0.09)) makeLot(b);
  }

  // Start beside the car park, in the lane heading north along its west side.
  const west = start.halfEdges.find((h) => {
    const [dx, dz] = g.dir(h);
    return dz < -0.99 && Math.abs(dx) < 0.01;
  }) ?? start.halfEdges[0];
  const [dx, dz] = g.dir(west);
  const A = g.nodes[g.from(west)];
  const lane = g.edge(west).lane;
  const along = g.edge(west).len / 2;
  layout.spawn = {
    x: A.x + dx * along - dz * lane,
    z: A.z + dz * along + dx * lane,
    heading: Math.atan2(dx, dz),
    // A spot on the car park's sidewalk, beside the car, for starting on foot.
    footX: A.x + dx * along - dz * (g.edge(west).hw + 1.5),
    footZ: A.z + dz * along + dx * (g.edge(west).hw + 1.5),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Pedestrian walk graph                                                                       */
/* ------------------------------------------------------------------------------------------ */

/**
 * Waypoints round every block's sidewalk: one at each corner, plus one each side of every
 * crosswalk. Links run round the block (both ways) and across crosswalks to the facing block.
 * A waypoint's position depends on how far in from the curb a walker keeps (`inset`):
 * (x + vx * inset, z + vz * inset).
 */
function buildWalkGraph(g, blocks) {
  const nodes = [];
  const add = (p, block) => {
    nodes.push({ id: nodes.length, x: p.x, z: p.z, vx: p.vx, vz: p.vz, block, links: [] });
    return nodes.length - 1;
  };
  const link = (a, b, crossing = null) => {
    if (a === b || nodes[a].links.some((l) => l.to === b)) return;
    nodes[a].links.push({ to: b, crossing });
    nodes[b].links.push({ to: a, crossing });
  };
  const at = (id, inset = 2) => ({ x: nodes[id].x + nodes[id].vx * inset, z: nodes[id].z + nodes[id].vz * inset });
  const crossPoint = new Map(); // `${halfEdge}:${node}` -> waypoint by a crosswalk at that end

  for (const b of blocks) {
    const hs = b.halfEdges;
    const cornerIds = b.corners.map((c) => add(c, b.id));
    for (let k = 0; k < hs.length; k++) {
      const h = hs[k];
      const e = g.edge(h);
      const [dx, dz] = g.dir(h);
      const [nx, nz] = inward(g, h);
      const A = g.nodes[g.from(h)], B = g.nodes[g.to(h)];
      const chain = [cornerIds[k]];
      const sideways = (node, along) => ({
        x: node.x + dx * along + nx * e.hw,
        z: node.z + dz * along + nz * e.hw,
        vx: nx,
        vz: nz,
      });
      const ends = [];
      if (A.signal) ends.push([A, g.setbackStart(h) + 2]);
      if (B.signal) ends.push([B, e.len - g.setbackEnd(h) - 2]);
      for (const [node, along] of ends) {
        const p = sideways(A, along);
        // Close enough to a corner? Then the corner is the crosswalk's end.
        const near = [cornerIds[k], cornerIds[(k + 1) % hs.length]].find((c) => {
          const q = at(c);
          return Math.hypot(q.x - (p.x + p.vx * 2), q.z - (p.z + p.vz * 2)) < 1.2;
        });
        const id = near ?? add(p, b.id);
        if (near === undefined) chain.push(id);
        crossPoint.set(`${h}:${node.id}`, id);
      }
      chain.push(cornerIds[(k + 1) % hs.length]);
      for (let i = 0; i + 1 < chain.length; i++) link(chain[i], chain[i + 1]);
    }
  }

  // Crosswalks: across each road at each signalled end, joining the blocks either side.
  for (const e of g.edges) {
    for (const nodeId of [e.a, e.b]) {
      const node = g.nodes[nodeId];
      if (!node.signal) continue;
      const p = crossPoint.get(`${e.id * 2}:${nodeId}`);
      const q = crossPoint.get(`${e.id * 2 + 1}:${nodeId}`);
      if (p === undefined || q === undefined) continue; // the far side is the quay
      const along = g.setback[nodeId === e.a ? e.id * 2 : e.id * 2 + 1] + 2;
      const sgn = nodeId === e.a ? 1 : -1;
      const mid = { x: node.x + e.dx * along * sgn, z: node.z + e.dz * along * sgn };
      link(p, q, { node: nodeId, edge: e.id, mid });
    }
  }

  const hash = new BucketGrid(16);
  for (const n of nodes) hash.insertBox(n.x - 3, n.z - 3, n.x + 3, n.z + 3, n.id);
  return { nodes, hash };
}

/* ------------------------------------------------------------------------------------------ */
/* Traffic signal positions                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * One signal per approach to a signalled junction, on a pole at the near right corner (on the
 * sidewalk of the block to the right of the arriving traffic).
 */
function buildSignalHeads(g, blocks) {
  const heads = [];
  for (const n of g.nodes) {
    if (!n.signal) continue;
    for (const hOut of n.out) {
      const a = hOut ^ 1; // arriving at n
      const block = g.faceOf[a];
      if (block < 0) continue;
      const e = g.edge(a);
      const [dx, dz] = g.dir(a);
      const rx = -dz, rz = dx;
      // At a sharp corner the tip is cut off: slide the pole back along the curb until it's on the sidewalk.
      for (let back = g.setbackStart(hOut) + 1.2, tries = 0; tries < 8; back += 1, tries++) {
        const x = n.x - dx * back + rx * (e.hw + 1.2);
        const z = n.z - dz * back + rz * (e.hw + 1.2);
        if (!insideConvex(blocks[block].shape, x, z, -0.3)) continue;
        heads.push({ node: n.id, edge: e.id, d: [dx, dz], r: [rx, rz], x, z, reach: e.hw + 1.2 - e.lane });
        break;
      }
    }
  }
  return heads;
}

/* ------------------------------------------------------------------------------------------ */

export const LAYOUT = generate(4242);
CITY.size = LAYOUT.size;
CITY.half = LAYOUT.half;

/** True once a point is past the quayside, over open water. */
export function offIsland(x, z) {
  return Math.abs(x) > CITY.half || Math.abs(z) > CITY.half;
}

/** The block (sidewalk slab) under a point, or null on the road. */
export function blockAt(x, z) {
  for (const id of LAYOUT.blockHash.at(x, z)) {
    const b = LAYOUT.blocks[id];
    const bb = b.bounds;
    if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) continue;
    if (insideConvex(b.shape, x, z)) return b;
  }
  return null;
}

/** Ground height at a point: raised on sidewalks/blocks, 0 on roads (and in parking lots). */
export function groundHeight(x, z) {
  const b = blockAt(x, z);
  if (!b) return 0;
  if (b.lot) {
    const { x0, z0, w, d, aisles } = b.lot;
    const s = CITY.sidewalk;
    const lx = x - x0, lz = z - z0;
    const insideX = lx > s && lx < w - s;
    const insideZ = lz > s && lz < d - s;
    if (insideX && insideZ) return 0;
    if (insideZ && aisles.some(([a, c]) => lz > a && lz < c)) return 0; // driveway
  }
  return CITY.curbHeight;
}


