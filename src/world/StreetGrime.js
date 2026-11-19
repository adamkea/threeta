import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRng } from '../core/random.js';
import { toon } from '../render/toon.js';
import { GLOW_LAYER } from '../effects/SirenGlow.js';
import { CITY, LAYOUT } from './CityLayout.js';
import { insideConvex, signedArea } from './geom.js';
import {
  DECAL, GRAF, GRAF_COLS, GRAF_ROWS, GROUND_GRID,
  createGraffitiAtlas, createGroundAtlas, createPuffTexture, createStackTexture, createTankTexture, createWallGrimeTexture,
} from './grimeTextures.js';

// Gritty-city dressing laid over the clean layout: stains, cracks, potholes, manholes and litter on
// the ground; bin bags, trash cans, dumpsters, hydrants and newspaper boxes along the curbs;
// graffiti, posters and dirt on street-facing walls; fire escapes up the walk-ups; wooden water
// towers and painted throw-ups on the roofs; and steam rising from manholes and striped stacks.
//
// Flat decals live on GLOW_LAYER so the ink pass doesn't outline them (they'd draw boxes round
// every sticker); solid props stay on the default layer and get inked like everything else.

const CURB = CITY.curbHeight;
const ROAD_Y = 0.03; // just above the road paint (0.02)
const WALK_Y = CURB + 0.012;

/**
 * @param facades  ground-floor walls: { ax, az, bx, bz, nx, nz, len, y0, top, block, building }
 *                 (outward normal n; the wall's window grid starts at b)
 * @param roofTops { poly, top, height, box, building }: each flat roof and its rooftop box (if any)
 * @param colliders static colliders, appended to for the solid props
 */
export function createStreetGrime({ facades, roofTops, colliders, seed = 77 }) {
  const rng = createRng(seed);
  const group = new THREE.Group();
  const ground = new DecalBuilder(GROUND_GRID, GROUND_GRID);
  const graffiti = new DecalBuilder(GRAF_COLS, GRAF_ROWS);
  const grime = new DecalBuilder(1, 1);
  const props = new PropSet();
  const steam = [];

  dressRoads(rng, ground, props, steam, colliders);
  for (const b of LAYOUT.blocks) {
    if (b.use === 'buildings' || b.use === 'park') dressSidewalks(rng, b, ground, props, colliders);
  }
  const escaped = new Set();
  for (const f of facades) dressFacade(rng, f, graffiti, grime, props, escaped);
  for (const r of roofTops) dressRoof(rng, r, ground, graffiti, props);

  const decalMat = (map) => toon({ map, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.02 });
  const layers = [[ground, createGroundAtlas()], [grime, createWallGrimeTexture()], [graffiti, createGraffitiAtlas()]];
  layers.forEach(([builder, map], order) => {
    if (!builder.count) return;
    const mesh = new THREE.Mesh(builder.build(), decalMat(map));
    mesh.receiveShadow = true;
    mesh.layers.set(GLOW_LAYER);
    mesh.renderOrder = 1 + order; // graffiti over the wall dirt
    group.add(mesh);
  });
  group.add(props.build());

  const steamFx = createSteam(steam);
  if (steamFx) group.add(steamFx.points);

  return {
    group,
    update(dt) {
      steamFx?.update(dt);
    },
  };
}

/* ---------------------------------------------------------------------------------------- */
/* Placement                                                                                   */
/* ---------------------------------------------------------------------------------------- */

/** Picks a key from { key: weight }. */
function weighted(rng, table) {
  let total = 0;
  for (const k in table) total += table[k];
  let r = rng.range(0, total);
  for (const k in table) if ((r -= table[k]) <= 0) return k;
  return Object.keys(table)[0];
}

const ROAD_DECALS = { oil: 5, crack: 2, patch: 1, puddle: 0.4 };
const WALK_DECALS = { gum: 3, butts: 2, stain: 3, litter: 2.5, crack: 2, grime: 2, cup: 1, paper: 1, pizza: 0.5, glass: 0.4, puddle: 0.4, tag: 0.4 };
const GUTTER_DECALS = { litter: 3, grime: 3, butts: 1, cup: 1, paper: 1, glass: 0.5, puddle: 1 };

function dressRoads(rng, ground, props, steam, colliders) {
  const g = LAYOUT.graph;
  for (const e of g.edges) {
    const A = g.nodes[e.a];
    const rx = -e.dz, rz = e.dx;
    const a0 = g.setback[e.id * 2] + 4, a1 = e.len - g.setback[e.id * 2 + 1] - 4;
    if (a1 - a0 < 4) continue;
    const at = (along, lat) => [A.x + e.dx * along + rx * lat, A.z + e.dz * along + rz * lat];
    const roadAngle = Math.atan2(e.dz, e.dx);

    const n = Math.round((a1 - a0) / 22);
    for (let i = 0; i < n; i++) {
      const kind = weighted(rng, ROAD_DECALS);
      const along = rng.range(a0, a1);
      let lat, sx, sz, rot = rng.range(0, Math.PI * 2);
      if (kind === 'oil') {
        // Drips collect down the middle of each lane, where engines sit at the lights.
        lat = rng.pick([-1, 1]) * e.lane + rng.range(-0.5, 0.5);
        sx = rng.range(1.2, 2.4);
        sz = sx * rng.range(0.7, 1);
      } else if (kind === 'patch') {
        lat = rng.range(-e.hw + 1.5, e.hw - 1.5);
        sx = rng.range(2, 4.5);
        sz = rng.range(1.4, 3);
        rot = roadAngle + rng.range(-0.1, 0.1);
      } else if (kind === 'puddle' || kind === 'paper' || kind === 'glass') {
        lat = rng.pick([-1, 1]) * (e.hw - rng.range(0.6, 1.4));
        sx = sz = rng.range(1, 2);
      } else {
        lat = rng.range(-e.hw + 0.8, e.hw - 0.8);
        sx = sz = rng.range(1.5, 3.5);
      }
      const [x, z] = at(along, lat);
      ground.flat(x, ROAD_Y + i * 1e-5, z, sx, sz, rot, DECAL[kind]);
    }

    // Grime and litter washed into the gutters.
    for (const side of [-1, 1]) {
      for (let i = 0, m = Math.round((a1 - a0) / 18); i < m; i++) {
        const kind = weighted(rng, GUTTER_DECALS);
        const [x, z] = at(rng.range(a0, a1), side * (e.hw - rng.range(0.4, 0.8)));
        const s = rng.range(0.8, 1.6);
        ground.flat(x, ROAD_Y + 0.001, z, kind === 'grime' ? s * 2.2 : s, s, kind === 'grime' ? roadAngle : rng.range(0, 6.3), DECAL[kind]);
      }
    }

    // Storm drains at the curb, just short of each junction.
    for (const [along, side] of [[a0 - 1.5, 1], [a1 + 1.5, -1]]) {
      if (!rng.chance(0.55)) continue;
      const [x, z] = at(along, side * (e.hw - 0.4));
      ground.flat(x, ROAD_Y + 0.002, z, 1.3, 0.75, roadAngle, DECAL.drain);
    }

    // Manholes in the lanes; some breathe steam, a few through an orange-and-white stack.
    for (let i = 0, m = e.len > 40 ? 1 : rng.int(0, 1); i < m; i++) {
      const along = rng.range(a0, a1);
      if (rng.chance(0.07)) {
        const [x, z] = at(along, rng.pick([-1, 1]) * (e.hw - 1.1));
        ground.flat(x, ROAD_Y + 0.003, z, 1.2, 1.2, 0, DECAL.manhole);
        props.stack(x, z);
        colliders.push({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 });
        steam.push({ x, y: 1.9, z, strength: 1.4 });
        continue;
      }
      const [x, z] = at(along, rng.pick([-1, 1]) * e.lane + rng.range(-0.4, 0.4));
      ground.flat(x, ROAD_Y + 0.003, z, 1.1, 1.1, rng.range(0, 6.3), DECAL.manhole);
      if (rng.chance(0.18)) steam.push({ x, y: 0.1, z, strength: 1 });
    }
  }
}

function dressSidewalks(rng, b, ground, props, colliders) {
  const shape = b.shape;
  const furnish = b.use === 'buildings';
  for (let i = 0; i < shape.length; i++) {
    const p = shape[i], q = shape[(i + 1) % shape.length];
    const L = Math.hypot(q.x - p.x, q.z - p.z);
    if (L < 4) continue;
    const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
    const ix = -dz, iz = dx; // into the block
    const at = (s, t) => [p.x + dx * s + ix * t, p.z + dz * s + iz * t];
    const angle = Math.atan2(dz, dx);
    const fits = (x, z, r) => insideConvex(shape, x, z, -r);

    // Ground-level grot: gum, butts, stains, cracked slabs, the odd crushed coffee cup.
    for (let k = 0, n = Math.round(L / 2.5); k < n; k++) {
      const kind = weighted(rng, WALK_DECALS);
      const s = kind === 'crack' ? rng.range(1.2, 2.4) : rng.range(0.7, 1.5);
      const [x, z] = at(rng.range(1, L - 1), rng.range(0.4, 2.8));
      if (!fits(x, z, s * 0.72)) continue; // keep clear of the curb edge
      ground.flat(x, WALK_Y + k * 1e-5, z, s, s, rng.range(0, 6.3), DECAL[kind]);
    }
    if (!furnish || L < 16) continue;

    // Street furniture, kept between the crosswalks and clear of each other.
    const taken = [];
    const claim = (s, half) => {
      if (s - half < 6 || s + half > L - 6) return false;
      if (taken.some(([a, c]) => s + half > a && s - half < c)) return false;
      taken.push([s - half, s + half]);
      return true;
    };
    const box = (x, z, r) => colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });

    // Bin bags piled at the curb, waiting for a collection that never comes.
    for (let k = 0, n = Math.floor(L / 22); k < n; k++) {
      if (!rng.chance(0.75)) continue;
      const s = rng.range(6, L - 6), half = rng.range(0.9, 1.8);
      if (!claim(s, half)) continue;
      const bags = Math.round(half * rng.range(2.5, 4));
      for (let j = 0; j < bags; j++) {
        const r = rng.range(0.32, 0.52);
        const [x, z] = at(s + rng.range(-half, half), rng.range(0.45, 1.05));
        const stacked = j > 2 && rng.chance(0.35);
        props.bag(rng, x, CURB + r * 0.55 + (stacked ? 0.45 : 0), z, r);
      }
      for (let j = 0; j < 3; j++) {
        const [x, z] = at(s + rng.range(-half - 0.6, half + 0.6), rng.range(0.3, 1.5));
        if (fits(x, z, 0.5)) ground.flat(x, WALK_Y + 0.002, z, 1, 1, rng.range(0, 6.3), DECAL[rng.pick(['litter', 'butts', 'pizza', 'stain'])]);
      }
    }

    // A wire trash can near the corner, overflowing.
    if (rng.chance(0.65)) {
      const s = rng.chance(0.5) ? rng.range(6.5, 9) : rng.range(L - 9, L - 6.5);
      if (claim(s, 0.5)) {
        const [x, z] = at(s, 0.6);
        props.can(x, z, rng.range(0, 6.3));
        box(x, z, 0.33);
        ground.flat(x, WALK_Y + 0.003, z, 1.6, 1.6, rng.range(0, 6.3), DECAL.litter);
        if (rng.chance(0.4)) props.bag(rng, x + rng.range(-0.6, 0.6), CURB + 0.2, z + rng.range(-0.6, 0.6), 0.3);
      }
    }

    // Fire hydrant.
    if (rng.chance(0.45)) {
      const s = rng.range(8, L - 8);
      if (claim(s, 0.4)) {
        const [x, z] = at(s, 0.5);
        props.hydrant(x, z, angle);
        box(x, z, 0.22);
        if (rng.chance(0.3)) ground.flat(x, WALK_Y + 0.003, z, 1.4, 1.4, 0, DECAL.puddle);
      }
    }

    // A row of newspaper boxes.
    if (rng.chance(0.22)) {
      const count = rng.int(2, 3);
      const s = rng.range(8, L - 8);
      if (claim(s, count * 0.33)) {
        for (let j = 0; j < count; j++) {
          const [x, z] = at(s + (j - (count - 1) / 2) * 0.6, 0.55);
          props.newsBox(rng, x, z, angle);
          box(x, z, 0.27);
        }
      }
    }

    // Dumpster at the curb, with its overflow round it.
    if (L > 28 && rng.chance(0.2)) {
      const s = rng.range(8, L - 8);
      if (claim(s, 1.3)) {
        const [x, z] = at(s, 0.85);
        props.dumpster(rng, x, z, angle);
        const corners = [[-0.98, -0.57], [0.98, -0.57], [0.98, 0.57], [-0.98, 0.57]].map(([lx, lz]) => ({
          x: x + dx * lx + ix * lz,
          z: z + dz * lx + iz * lz,
        }));
        if (signedArea(corners) < 0) corners.reverse();
        const xs = corners.map((c) => c.x), zs = corners.map((c) => c.z);
        colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), poly: corners });
        ground.flat(x, WALK_Y + 0.003, z, 3, 2, angle, DECAL.grime);
        for (let j = 0; j < rng.int(1, 3); j++) {
          const [bx, bz] = at(s + rng.pick([-1, 1]) * rng.range(1.2, 1.6), rng.range(0.5, 1.0));
          props.bag(rng, bx, CURB + 0.25, bz, rng.range(0.3, 0.45));
        }
      }
    }
  }
}

/** A wall is street-facing when there's sidewalk in front of it and road just beyond. */
function streetFacing(f) {
  const mx = (f.ax + f.bx) / 2, mz = (f.az + f.bz) / 2;
  const shape = f.block.shape;
  return insideConvex(shape, mx + f.nx * 1, mz + f.nz * 1) && !insideConvex(shape, mx + f.nx * (CITY.sidewalk + 0.4), mz + f.nz * (CITY.sidewalk + 0.4));
}

const GRAFFITI_KINDS = { throwUps: 4, tags: 4, posters: 2, stickers: 0.6 };

function dressFacade(rng, f, graffiti, grime, props, escaped) {
  if (f.len < 2.5 || !streetFacing(f)) return;
  const ux = f.nz, uz = -f.nx; // along the wall, left to right as you face it
  const off = 0.035;
  const mx = (f.ax + f.bx) / 2 + f.nx * off, mz = (f.az + f.bz) / 2 + f.nz * off;

  // Dirt splashed up the bottom of the wall.
  const gh = 1.4;
  grime.quad(
    [
      [mx - ux * f.len / 2, f.y0, mz - uz * f.len / 2],
      [mx + ux * f.len / 2, f.y0, mz + uz * f.len / 2],
      [mx + ux * f.len / 2, f.y0 + gh, mz + uz * f.len / 2],
      [mx - ux * f.len / 2, f.y0 + gh, mz - uz * f.len / 2],
    ],
    [f.nx, 0, f.nz],
    [[0, 0], [f.len / 4, 0], [f.len / 4, 1], [0, 1]],
  );

  // Graffiti: walls the camera can see get the most.
  const visible = f.nz > -0.4;
  if (rng.chance(visible ? 0.7 : 0.25)) {
    const taken = [];
    for (let k = 0, n = rng.int(1, Math.max(1, Math.floor(f.len / 4))); k < n; k++) {
      const kind = weighted(rng, GRAFFITI_KINDS);
      const w = kind === 'throwUps' ? rng.range(2.6, 4.6) : kind === 'tags' ? rng.range(1.4, 2.8) : rng.range(1.8, 2.8);
      if (w > f.len - 0.4) continue;
      const s = rng.range(-f.len / 2 + w / 2 + 0.2, f.len / 2 - w / 2 - 0.2);
      if (taken.some(([a, c]) => s + w / 2 > a && s - w / 2 < c)) continue;
      taken.push([s - w / 2, s + w / 2]);
      const [first, count] = GRAF[kind];
      const base = f.y0 + (kind === 'posters' ? rng.range(0.5, 0.9) : rng.range(0.15, 0.7));
      const o = 0.01 + k * 0.004;
      graffiti.wall(mx + ux * s + f.nx * o, mz + uz * s + f.nz * o, ux, uz, f.nx, f.nz, base, w, w / 2, first + rng.int(0, count - 1));
    }
  }

  // Fire escape zig-zagging up a walk-up (one per building).
  const h = f.top - f.y0;
  if (h >= 9 && h <= 34 && f.len >= 9 && !escaped.has(f.building) && rng.chance(0.45)) {
    const cols = Math.floor(f.len / 3);
    const ks = [];
    for (let k = 1; k < cols; k++) if (3 * k - 2.8 >= 0.3 && 3 * k + 2.8 <= f.len - 0.3) ks.push(k);
    if (ks.length) {
      escaped.add(f.building);
      const s = 3 * rng.pick(ks); // from b, on a window-column boundary so it spans two windows
      const tx = (f.ax - f.bx) / f.len, tz = (f.az - f.bz) / f.len;
      props.fireEscape(f.bx + tx * s, f.bz + tz * s, f.nx, f.nz, f.y0, f.top);
    }
  }
}

function dressRoof(rng, r, ground, graffiti, props) {
  const { poly, top } = r;
  const bb = polyBounds(poly);
  const inside = (x, z, m) => insideConvex(poly, x, z, -m);
  const clearOfBox = (x, z, rad) => !r.box || x + rad < r.box.minX || x - rad > r.box.maxX || z + rad < r.box.minZ || z - rad > r.box.maxZ;
  const randomPoint = (m) => {
    for (let t = 0; t < 12; t++) {
      const x = rng.range(bb.minX, bb.maxX), z = rng.range(bb.minZ, bb.maxZ);
      if (inside(x, z, m)) return [x, z];
    }
    return null;
  };

  // Tar stains and puddles.
  for (let k = 0; k < rng.int(0, 3); k++) {
    const s = rng.range(1.5, 3.5);
    const pt = randomPoint(s * 0.6);
    if (pt) ground.flat(pt[0], top + 0.02 + k * 1e-4, pt[1], s, s, rng.range(0, 6.3), DECAL[rng.pick(['grime', 'puddle', 'stain'])]);
  }

  // A rooftop throw-up, painted to be read from the air.
  if (rng.chance(0.2)) {
    let li = 0, L = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l > L) (L = l), (li = i);
    }
    const a = poly[li], b = poly[(li + 1) % poly.length];
    let rot = Math.atan2(b.z - a.z, b.x - a.x);
    if (Math.cos(rot) < 0) rot += Math.PI; // letters upright on screen (north up)
    const c = polyCentroid(poly);
    for (let w = Math.min(10, L * 0.8); w >= 4; w -= 1.5) {
      const hw = w / 2, hh = w / 4;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const ok = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].every(([lx, lz]) => inside(c.x + lx * cs - lz * sn, c.z + lx * sn + lz * cs, 0.3));
      if (!ok) continue;
      graffiti.flat(c.x, top + 0.03, c.z, w, w / 2, rot, GRAF.throwUps[0] + rng.int(0, GRAF.throwUps[1] - 1));
      break;
    }
  }

  // Wooden water tower on stilts.
  if (r.height >= 10 && r.height <= 45 && rng.chance(0.4)) {
    const rad = rng.range(1.2, 1.8);
    for (let t = 0; t < 8; t++) {
      const pt = randomPoint(rad + 0.4);
      if (pt && clearOfBox(pt[0], pt[1], rad + 0.3)) {
        props.waterTower(pt[0], top, pt[1], rad, rng.range(2.4, 3.4), rng.range(1.4, 2.2));
        break;
      }
    }
  }
}

function polyBounds(poly) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function polyCentroid(poly) {
  let x = 0, z = 0;
  for (const p of poly) (x += p.x), (z += p.z);
  return { x: x / poly.length, z: z / poly.length };
}

/* ---------------------------------------------------------------------------------------- */
/* Geometry                                                                                    */
/* ---------------------------------------------------------------------------------------- */

/** Merged textured quads whose UVs pick cells out of a cols x rows atlas. */
class DecalBuilder {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
    this.count = 0;
  }

  cellUV(i) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    return [c / this.cols, 1 - (r + 1) / this.rows, (c + 1) / this.cols, 1 - r / this.rows];
  }

  quad(pts, n, uvs) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...pts[i]);
      this.nrm.push(...n);
      this.uv.push(...uvs[i]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
  }

  /** Flat on the ground at height y, sx by sz, turned by rot; the image's top faces -z at rot 0. */
  flat(x, y, z, sx, sz, rot, cellIndex) {
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const hx = sx / 2, hz = sz / 2;
    const p = (lx, lz) => [x + lx * cs - lz * sn, y, z + lx * sn + lz * cs];
    const [u0, v0, u1, v1] = this.cellUV(cellIndex);
    this.quad([p(-hx, hz), p(hx, hz), p(hx, -hz), p(-hx, -hz)], [0, 1, 0], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  }

  /** Upright on a wall: centred at (x, z) along (ux, uz), facing (nx, nz), from y0 up h. */
  wall(x, z, ux, uz, nx, nz, y0, w, h, cellIndex) {
    const hw = w / 2;
    const [u0, v0, u1, v1] = this.cellUV(cellIndex);
    this.quad(
      [[x - ux * hw, y0, z - uz * hw], [x + ux * hw, y0, z + uz * hw], [x + ux * hw, y0 + h, z + uz * hw], [x - ux * hw, y0 + h, z - uz * hw]],
      [nx, 0, nz],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
    );
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Gives a geometry a flat vertex colour so differently-coloured parts can share one mesh. */
function tinted(geom, hex) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function bagGeometry() {
  const body = new THREE.IcosahedronGeometry(1, 1);
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.13 * Math.sin(x * 7.1 + y * 3.3) * Math.cos(z * 5.7 - y * 2.1); // crinkles (same at shared corners)
    p.setXYZ(i, x * k, y * k * 0.72, z * k);
  }
  const knot = new THREE.ConeGeometry(0.22, 0.45, 5).translate(0, 0.86, 0);
  const g = mergeGeometries([tinted(body, 0xffffff), tinted(knot, 0xbbbbbb)]);
  g.computeVertexNormals(); // flat facets: crinkled plastic
  return g;
}

function canGeometry() {
  return mergeGeometries([
    tinted(new THREE.CylinderGeometry(0.34, 0.27, 0.92, 10, 1, true).translate(0, 0.46, 0), 0x35513b),
    tinted(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 10).translate(0, 0.82, 0), 0x2a2622), // the rubbish inside
    tinted(new THREE.TorusGeometry(0.34, 0.035, 4, 12).rotateX(Math.PI / 2).translate(0, 0.92, 0), 0x2a3d2e),
    tinted(new THREE.SphereGeometry(0.16, 6, 4).translate(0.08, 0.86, -0.06), 0xe9e6dc), // a crumpled bag poking out
  ]);
}

function hydrantGeometry() {
  return mergeGeometries([
    tinted(new THREE.CylinderGeometry(0.22, 0.24, 0.08, 10).translate(0, 0.04, 0), 0x9a2a22),
    tinted(new THREE.CylinderGeometry(0.15, 0.16, 0.5, 10).translate(0, 0.32, 0), 0xc8352b),
    tinted(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.56, 0), 0xd8d8d0),
    tinted(new THREE.CylinderGeometry(0.06, 0.06, 0.44, 8).rotateZ(Math.PI / 2).translate(0, 0.42, 0), 0xd8d8d0),
    tinted(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0.4, 0.15), 0xd8d8d0),
  ]);
}

function newsBoxGeometry() {
  return mergeGeometries([
    tinted(new THREE.BoxGeometry(0.5, 0.95, 0.45).translate(0, 0.62, 0), 0xffffff),
    tinted(new THREE.BoxGeometry(0.06, 0.16, 0.06).translate(-0.18, 0.08, 0.15), 0x555555),
    tinted(new THREE.BoxGeometry(0.06, 0.16, 0.06).translate(0.18, 0.08, -0.15), 0x555555),
    tinted(new THREE.BoxGeometry(0.06, 0.16, 0.06).translate(-0.18, 0.08, -0.15), 0x555555),
    tinted(new THREE.BoxGeometry(0.06, 0.16, 0.06).translate(0.18, 0.08, 0.15), 0x555555),
    tinted(new THREE.BoxGeometry(0.38, 0.3, 0.47).translate(0, 0.82, 0), 0xb8c4cc), // window onto today's paper
  ]);
}

function dumpsterGeometry() {
  return mergeGeometries([
    tinted(new THREE.BoxGeometry(1.9, 1.0, 1.1).translate(0, 0.58, 0), 0xffffff),
    tinted(new THREE.BoxGeometry(1.96, 0.08, 1.16).translate(0, 1.12, 0), 0x707070), // lid
    tinted(new THREE.BoxGeometry(1.96, 0.12, 1.16).translate(0, 0.2, 0), 0x8a8a8a), // base rail
    tinted(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8).rotateX(Math.PI / 2).translate(-0.8, 0.08, 0.45), 0x222222),
    tinted(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8).rotateX(Math.PI / 2).translate(0.8, 0.08, 0.45), 0x222222),
    tinted(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8).rotateX(Math.PI / 2).translate(-0.8, 0.08, -0.45), 0x222222),
    tinted(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8).rotateX(Math.PI / 2).translate(0.8, 0.08, -0.45), 0x222222),
  ]);
}

const BAG_COLORS = [0x303338, 0x303338, 0x3a3d42, 0x262a2e, 0x3d4a36, 0xd2d2c8, 0x6f8fb0];
const DUMPSTER_COLORS = [0x2f6b3f, 0x2c4f7c, 0x8a4a2a, 0x4a5a3a];
const NEWS_COLORS = [0x2c5fb8, 0xc8322a, 0xe0b62c, 0x2f8a4a, 0xe8e4da];
const IRON = 0x3a3d42;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _basis = new THREE.Matrix4();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

/** Collects instance transforms per prop kind, then builds one InstancedMesh each. */
class PropSet {
  constructor() {
    this.kinds = {};
  }

  add(kind, x, y, z, rotY, sx, sy, sz, color = 0xffffff, q = null) {
    (this.kinds[kind] ??= []).push({ m: _m.compose(_p.set(x, y, z), q ?? _q.setFromEuler(_e.set(0, rotY, 0)), _s.set(sx, sy, sz)).clone(), color });
  }

  bag(rng, x, y, z, r) {
    this.add('bag', x, y, z, rng.range(0, 6.3), r, r * rng.range(0.85, 1.1), r * rng.range(0.85, 1.15), rng.pick(BAG_COLORS));
  }
  can(x, z, rot) {
    this.add('can', x, CURB, z, rot, 1, 1, 1);
  }
  hydrant(x, z, rot) {
    this.add('hydrant', x, CURB, z, rot, 1, 1, 1);
  }
  newsBox(rng, x, z, rot) {
    // Faces the road: the box's front (+z) points out of the block, i.e. rot about the curb direction.
    this.add('news', x, CURB, z, -rot + Math.PI, 1, 1, 1, rng.pick(NEWS_COLORS));
  }
  dumpster(rng, x, z, rot) {
    this.add('dumpster', x, CURB, z, -rot, 1, 1, 1, rng.pick(DUMPSTER_COLORS));
  }
  stack(x, z) {
    this.add('stack', x, 0, z, 0, 1, 1, 1);
  }
  waterTower(x, y, z, r, h, legs) {
    this.add('tank', x, y + legs, z, 0, r, h, r);
    this.add('tankRoof', x, y + legs + h, z, 0, r * 1.08, 0.9, r * 1.08);
    this.add('iron', x, y + legs - 0.08, z, 0, r * 2, 0.16, r * 2); // platform
    for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]]) {
      this.add('iron', x + lx * r, y + legs / 2, z + lz * r, 0, 0.14, legs, 0.14);
    }
  }

  /** Platforms, railings and stairs up a wall facing (nx, nz), centred on (x, z). */
  fireEscape(x, z, nx, nz, y0, top) {
    _u.set(nz, 0, -nx); // along the wall
    _n.set(nx, 0, nz);
    _basis.makeBasis(_u, _up, _n);
    const wallQ = new THREE.Quaternion().setFromRotationMatrix(_basis);
    const W = 5.4, D = 0.9;
    const piece = (along, y, out, sx, sy, sz, q = wallQ) => {
      this.add('iron', x + _u.x * along + nx * out, y, z + _u.z * along + nz * out, 0, sx, sy, sz, 0xffffff, q);
    };
    const floors = [];
    for (let k = 1; y0 + 3 * k + 0.55 + 1.6 < top; k++) floors.push(y0 + 3 * k + 0.55);
    floors.forEach((py, k) => {
      piece(0, py, D / 2, W, 0.08, D); // grating
      piece(0, py + 0.95, D, W, 0.06, 0.06); // top rail
      piece(0, py + 0.5, D, W, 0.04, 0.04); // mid rail
      for (const a of [-W / 2, 0, W / 2]) piece(a, py + 0.47, D, 0.05, 0.95, 0.05); // posts
      for (const a of [-W / 2, W / 2]) piece(a, py + 0.95, D / 2, 0.06, 0.06, D); // side rails
      if (k + 1 < floors.length) {
        // Stair up to the next landing, switching back each floor.
        const dir = k % 2 ? 1 : -1;
        const run = W - 1.2, rise = 3;
        const len = Math.hypot(run, rise);
        _qz.setFromAxisAngle(_zAxis, Math.atan2(rise, run) * dir);
        piece(0, py + rise / 2, D * 0.55, len, 0.06, 0.5, wallQ.clone().multiply(_qz));
      }
    });
    if (floors.length) {
      // Drop ladder hanging from the first landing.
      const py = floors[0];
      piece(W / 2 - 0.5, py - 0.9, D * 0.8, 0.05, 1.8, 0.05);
      piece(W / 2 - 0.1, py - 0.9, D * 0.8, 0.05, 1.8, 0.05);
      for (let r = 0; r < 5; r++) piece(W / 2 - 0.3, py - 0.2 - r * 0.35, D * 0.8, 0.4, 0.04, 0.04);
    }
  }

  build() {
    const g = new THREE.Group();
    const defs = {
      bag: () => [bagGeometry(), toon({ vertexColors: true })],
      can: () => [canGeometry(), toon({ vertexColors: true, side: THREE.DoubleSide })],
      hydrant: () => [hydrantGeometry(), toon({ vertexColors: true })],
      news: () => [newsBoxGeometry(), toon({ vertexColors: true })],
      dumpster: () => [dumpsterGeometry(), toon({ vertexColors: true })],
      stack: () => [new THREE.CylinderGeometry(0.34, 0.42, 1.8, 12).translate(0, 0.9, 0), toon({ map: createStackTexture() })],
      tank: () => [
        new THREE.CylinderGeometry(1, 1, 1, 16).translate(0, 0.5, 0),
        toon({ map: createTankTexture() }),
      ],
      tankRoof: () => [new THREE.ConeGeometry(1, 1, 16).translate(0, 0.5, 0), toon({ color: 0x4a3b30 })],
      iron: () => [new THREE.BoxGeometry(1, 1, 1), toon({ color: IRON })],
    };
    for (const [kind, list] of Object.entries(this.kinds)) {
      const [geom, mat] = defs[kind]();
      const mesh = new THREE.InstancedMesh(geom, mat, list.length);
      const col = new THREE.Color();
      list.forEach(({ m, color }, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.set(color));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      g.add(mesh);
    }
    return g;
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Steam                                                                                       */
/* ---------------------------------------------------------------------------------------- */

const PUFFS = 12;

/** Steam rising from manholes and stacks: GPU-animated point sprites, drifting on the wind. */
function createSteam(sources) {
  if (!sources.length) return null;
  const pos = new Float32Array(sources.length * PUFFS * 3);
  const seed = new Float32Array(sources.length * PUFFS);
  const strength = new Float32Array(sources.length * PUFFS);
  sources.forEach((s, i) => {
    const off = (i * 0.618) % 1;
    for (let k = 0; k < PUFFS; k++) {
      const j = i * PUFFS + k;
      pos.set([s.x, s.y, s.z], j * 3);
      seed[j] = (k / PUFFS + off) % 1;
      strength[j] = s.strength;
    }
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  geom.setAttribute('strength', new THREE.BufferAttribute(strength, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScale: { value: 400 },
      uMap: { value: createPuffTexture() },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uScale;
      attribute float seed, strength;
      varying float vAlpha;
      void main() {
        float t = fract(uTime * 0.22 + seed);
        vec3 p = position;
        float wob = seed * 43.0;
        p.y += t * 6.0 * strength;
        p.x += t * 2.6 + sin(wob + uTime * 1.3) * 0.4 * t;
        p.z += -t * 1.0 + cos(wob * 0.7 + uTime * 0.9) * 0.4 * t;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = mix(0.9, 4.2, t) * strength;
        gl_PointSize = size * uScale * projectionMatrix[1][1] / -mv.z;
        vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - t) * 0.6;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.93, 0.94, 0.95), a);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geom, material);
  points.frustumCulled = false;
  points.layers.set(GLOW_LAYER);
  points.renderOrder = 2;
  const vp = new THREE.Vector4();
  points.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(vp);
    material.uniforms.uScale.value = vp.w / 2;
  };
  return {
    points,
    update(dt) {
      material.uniforms.uTime.value += dt;
    },
  };
}
