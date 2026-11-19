import * as THREE from 'three';
import { createRng } from '../core/random.js';
import { toon } from '../render/toon.js';
import { createLandmark } from './Landmarks.js';
import { createPayPhones } from './PayPhones.js';
import { createStreetGrime } from './StreetGrime.js';
import { CITY, LAYOUT, LOT, WATER_Y, blockAt, groundHeight, offIsland, toWorld } from './CityLayout.js';
import {
  bounds, centroid, clipHalfPlane, insideConvex, isAxisRect, offsetConvex, offsetConvexPaired, signedArea,
} from './geom.js';

// The city's meshes and colliders, built from the layout in CityLayout.js (road graph + blocks).
export { CITY, LAYOUT, LOT, WATER_Y, blockAt, groundHeight, offIsland };

// Comic-city palette: warm brick, sandstone, slate and a few loud accents.
const BUILDING_COLORS = [
  0xc9744f, 0xb2473a, 0x7f9fb6, 0xe2c27d, 0x8fae7e, 0xb07aa0, 0xd9d1bf, 0x8c8079, 0x5f86a8, 0xe8a07c,
  0x6f6a73, 0xd8b45a,
];
const WHITE = new THREE.Color(0xffffff);

/**
 * Builds the city. Returns the scene group plus the static colliders vehicles and people can't
 * pass through: axis-aligned boxes { minX, maxX, minZ, maxZ }, some with a convex `poly` (CCW,
 * see geom.js) when the shape isn't axis-aligned — the box is then its bounds.
 */
export function createCity(seed = 1337) {
  const rng = createRng(seed);
  const group = new THREE.Group();
  const colliders = [];
  const { blocks } = LAYOUT;

  group.add(createGround());
  group.add(createRoadMarkings());

  const walls = new QuadBuilder();
  const roofs = new QuadBuilder();
  const slabs = new QuadBuilder(2);
  const grass = new QuadBuilder(2);
  const buildings = []; // footprints + colours, for the map
  const landmarks = [];
  const parks = [];
  const windowTex = createWindowTexture();
  const extras = { facades: [], roofTops: [] }; // for the street grime

  for (const b of blocks) {
    if (b.use !== 'lot') extrudeSlab(slabs, b.shape, 0, CITY.curbHeight);
    if (b.use === 'buildings') buildBlock(rng, b, walls, roofs, colliders, buildings, extras);
    else if (b.use === 'park') parks.push(b);
  }
  for (const l of LAYOUT.landmarks) {
    const lm = createLandmark(l.kind, l.cx, l.cz, CITY.curbHeight, { colliders, windowTex, angle: l.angle, name: l.name });
    group.add(lm.group);
    landmarks.push(lm);
    buildings.push({ ...lm.footprint, color: lm.color }, ...lm.buildings);
  }

  const sidewalkMat = toon({ map: createTileTexture(), vertexColors: true });
  const parking = createParkingLots(createRng(seed + 7), slabs, colliders);
  const slabMesh = new THREE.Mesh(slabs.build(), sidewalkMat);
  slabMesh.receiveShadow = true;
  group.add(slabMesh);

  const wallMesh = new THREE.Mesh(walls.build(), toon({ map: windowTex, vertexColors: true }));
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const roofMesh = new THREE.Mesh(roofs.build(), toon({ map: createRoofTexture(), vertexColors: true }));
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  group.add(roofMesh);

  group.add(createParks(rng, parks, grass, colliders));
  group.add(parking.group);
  group.add(createStreetLamps(colliders));

  const grime = createStreetGrime({ ...extras, colliders, seed: seed + 11 });
  group.add(grime.group);

  // Pay phones go in last, so they can keep clear of everything else on the sidewalks.
  const payPhones = createPayPhones(createRng(seed + 23), blocks, colliders, CITY.curbHeight);
  group.add(payPhones.group);

  return {
    group,
    colliders,
    buildings,
    parks,
    lots: LAYOUT.lots,
    blocks,
    landmarks,
    parkingSpots: parking.spots,
    payPhones: payPhones.phones,
    /** Per-frame animation of the city dressing (manhole steam). */
    update: grime.update,
  };
}

/** A raised slab: top polygon plus its sides down to y0. */
function extrudeSlab(qb, poly, y0, y1, color = WHITE) {
  qb.polyTop(poly, y1, color);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    qb.wall(b.x, b.z, a.x, a.z, y0, y1, color);
  }
}

const rectPoly = (minX, minZ, maxX, maxZ) => [
  { x: minX, z: minZ },
  { x: maxX, z: minZ },
  { x: maxX, z: maxZ },
  { x: minX, z: maxZ },
];

/**
 * Parking lots: a paved rectangle in the block's own frame, with driveways along both aisles out
 * to the streets either side, painted bays and a "P" sign. The rest of the block is sidewalk.
 * Returns the meshes and every bay as a parking spot { x, z, heading } (nose-in or out).
 */
function createParkingLots(rng, slabs, colliders) {
  const g = new THREE.Group();
  const spots = [];
  const lines = []; // [x, z, width, length, ux, uz]: painted strips, length along (ux, uz)
  const h = CITY.curbHeight;

  for (const lot of LAYOUT.lots) {
    const block = LAYOUT.blocks[lot.block];
    const { cx, cz, hw, hd, bays, bx0, rows, aisles } = lot;
    const at = (lx, lz) => toWorld(lot, cx, cz, lx, lz);
    const vx = -lot.uz, vz = lot.ux; // local +Z in world

    // Sidewalk = block minus the paving and the two driveway bands. Cut it into convex pieces
    // with half-planes in the lot's frame: n·(p - o) <= 0 keeps the side away from n.
    const keep = (poly, lx, lz, nx, nz) => {
      if (!poly) return null;
      const o = at(lx, lz);
      return clipHalfPlane(poly, o.x, o.z, nx * lot.ux + nz * vx, nx * lot.uz + nz * vz);
    };
    const pieces = [
      keep(block.shape, 0, -hd, 0, 1), // north of the paving
      keep(block.shape, 0, hd, 0, -1), // south of it
    ];
    const bands = [[-hd, aisles[0][0]], [aisles[0][1], aisles[1][0]], [aisles[1][1], hd]];
    for (const [z0, z1] of bands) {
      const band = keep(keep(block.shape, 0, z0, 0, -1), 0, z1, 0, 1);
      pieces.push(keep(band, -hw, 0, 1, 0), keep(band, hw, 0, -1, 0)); // west and east of the paving
    }
    for (const p of pieces) if (p && signedArea(p) > 0.5) extrudeSlab(slabs, p, 0, h);

    for (const row of rows) {
      const depth = row.z1 - row.z0;
      const zc = (row.z0 + row.z1) / 2;
      for (let k = 0; k <= bays; k++) {
        const p = at(bx0 + k * LOT.bayWidth, zc);
        lines.push([p.x, p.z, 0.15, depth, vx, vz]);
      }
      for (let k = 0; k < bays; k++) {
        const nose = rng.chance(0.75) ? row.nose : -row.nose; // most drivers park nose-in
        const p = at(bx0 + (k + 0.5) * LOT.bayWidth, zc);
        spots.push({ x: p.x, z: p.z, heading: lot.angle + (nose > 0 ? 0 : Math.PI) });
      }
    }
    // Line down the back of the middle double row, and along the inside of each edge row.
    const width = bays * LOT.bayWidth;
    for (const z of [rows[0].z1 - 0.1, rows[1].z1, rows[3].z0 + 0.1]) {
      const p = at(bx0 + width / 2, z);
      lines.push([p.x, p.z, 0.15, width, lot.ux, lot.uz]);
    }

    // "P" sign on the sidewalk west of the paving, between the driveways (if there's room).
    const sp = at(-hw - 1.5, (aisles[0][1] + aisles[1][0]) / 2);
    if (insideConvex(block.shape, sp.x, sp.z, -0.5)) {
      g.add(createParkingSign(sp.x, sp.z));
      colliders.push({ minX: sp.x - 0.15, maxX: sp.x + 0.15, minZ: sp.z - 0.15, maxZ: sp.z + 0.15 });
    }
  }

  if (lines.length) {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), toon({ color: 0xeeeae0 }), lines.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    lines.forEach(([x, z, w, l, ux, uz], i) => {
      q.setFromAxisAngle(up, Math.atan2(ux, uz));
      m.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(w, 1, l));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return { group: g, spots };
}

/**
 * Splits a convex footprint into building plots: cut across the longest side (leaving a gap
 * for an alley) until plots are small enough. Rectangles stay rectangles; triangles cut by the
 * diagonal avenue get plots square to it.
 */
function splitPlots(rng, poly, downtown, depth = 0, out = []) {
  const area = signedArea(poly);
  let li = 0, L = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > L) (L = l), (li = i);
  }
  const target = rng.range(140, 560) * (1 - downtown * 0.25);
  if (depth >= 5 || area < 110 || (area < target && L < 36)) {
    out.push(poly);
    return out;
  }
  const a = poly[li], b = poly[(li + 1) % poly.length];
  const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
  const t = rng.range(0.38, 0.62);
  const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
  const gap = 0.75;
  const p1 = clipHalfPlane(poly, px - ux * gap, pz - uz * gap, ux, uz);
  const p2 = clipHalfPlane(poly, px + ux * gap, pz + uz * gap, -ux, -uz);
  for (const p of [p1, p2]) if (p) splitPlots(rng, p, downtown, depth + 1, out);
  return out;
}

function buildBlock(rng, block, walls, roofs, colliders, buildings, extras) {
  const inner = offsetConvex(block.shape, CITY.sidewalk);
  if (!inner) return;
  const downtown = block.downtown;
  for (const plot of splitPlots(rng, inner, downtown)) {
    const area = signedArea(plot);
    let perim = 0;
    for (let i = 0; i < plot.length; i++) {
      const p = plot[i], q = plot[(i + 1) % plot.length];
      perim += Math.hypot(q.x - p.x, q.z - p.z);
    }
    if (area < 30 || (2 * area) / perim < 2.2) continue; // too small or thin to build on
    const base = 6 + downtown * 16;
    const h = rng.range(base * 0.6, base * 1.4) + (rng.chance(0.08 + downtown * 0.2) ? rng.range(8, 18) : 0);
    const color = new THREE.Color(rng.pick(BUILDING_COLORS)).offsetHSL(0, 0, rng.range(-0.05, 0.05));
    addBuilding(rng, plot, CITY.curbHeight, h, color, walls, roofs, { block, id: buildings.length, extras });
    const bb = bounds(plot);
    const rect = isAxisRect(plot);
    colliders.push(rect ? { ...bb } : { ...bb, poly: plot });
    buildings.push({ ...bb, poly: rect ? null : plot, height: h, color: color.getHex() });
  }
}

/**
 * Walls, a flat roof inside a parapet lip, and maybe a rooftop box, for one footprint. Records
 * the walls and roof in `meta.extras` (if given) for the street grime to dress.
 */
function addBuilding(rng, poly, y0, h, color, walls, roofs, meta = null) {
  const top = y0 + h;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    walls.wall(b.x, b.z, a.x, a.z, y0, top, color);
    if (meta) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len > 1e-3) {
        meta.extras.facades.push({
          ax: a.x, az: a.z, bx: b.x, bz: b.z, len,
          nx: (b.z - a.z) / len, nz: -(b.x - a.x) / len, // outward (CCW footprint)
          y0, top, block: meta.block, building: meta.id,
        });
      }
    }
  }
  // Flat grey roof inside a parapet lip — gives the ink pass a crisp rooftop outline.
  const roofCol = new THREE.Color(0x7d7a78).lerp(color, 0.25);
  const lip = color.clone().multiplyScalar(0.85);
  const lipTop = lip.clone().multiplyScalar(1.1);
  const ph = 0.7;
  const inner = offsetConvexPaired(poly, 0.5);
  const roofTop = meta ? { poly: inner ?? poly, top, height: h, box: null, building: meta.id } : null;
  if (roofTop) meta.extras.roofTops.push(roofTop);
  if (inner) {
    roofs.polyTop(inner, top, roofCol);
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], ia = inner[i], ib = inner[(i + 1) % n];
      roofs.wall(b.x, b.z, a.x, a.z, top, top + ph, lip);
      roofs.wall(ia.x, ia.z, ib.x, ib.z, top, top + ph, lip);
      roofs.polyTop([a, b, ib, ia], top + ph, lipTop);
    }
  } else {
    roofs.polyTop(poly, top, roofCol);
  }

  // Rooftop detail: an AC unit / stairwell box, if one fits.
  if (rng.chance(0.7)) {
    const c = centroid(poly);
    const s = rng.range(2, 5);
    const px = c.x + rng.range(-2, 2) - s / 2, pz = c.z + rng.range(-2, 2) - s / 2;
    const box = rectPoly(px, pz, px + s, pz + s);
    if (box.every((p) => insideConvex(poly, p.x, p.z, -1))) {
      const unitTop = top + rng.range(1, 3);
      const dc = new THREE.Color(rng.pick([0xb8bcc2, 0x9aa3ad, 0xc9b79a]));
      for (let i = 0; i < 4; i++) {
        const a = box[i], b = box[(i + 1) % 4];
        roofs.wall(b.x, b.z, a.x, a.z, top, unitTop, dc);
      }
      roofs.polyTop(box, unitTop, dc.clone().multiplyScalar(1.1));
      if (roofTop) roofTop.box = { minX: px, maxX: px + s, minZ: pz, maxZ: pz + s };
    }
  }
}

function createGround() {
  const g = new THREE.Group();
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(CITY.size, CITY.size), toon({ map: createAsphaltTexture() }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  // Water surrounding the island city.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(CITY.size * 6, CITY.size * 6), toon({ color: 0x2f8fb8 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  g.add(water);

  // Open quayside: the island is a slab standing in the sea, with no wall to stop you going over.
  const quay = new THREE.Mesh(new THREE.BoxGeometry(CITY.size, 4, CITY.size), toon({ color: 0x9a9384 }));
  quay.position.y = -2.01; // top sits just under the asphalt
  g.add(quay);
  return g;
}

/**
 * Paint for every road: double yellow centre line and white edge lines between the junctions,
 * zebra crossings and stop lines at signalled junctions. Each strip is [x, z, width, length, ux, uz]
 * with its length running along (ux, uz).
 */
function createRoadMarkings() {
  const g = LAYOUT.graph;
  const yellow = [], white = [], crossings = [], stops = [];

  for (const e of g.edges) {
    const A = g.nodes[e.a], B = g.nodes[e.b];
    const dx = e.dx, dz = e.dz;
    const rx = -dz, rz = dx; // right of travel a -> b
    const sa = g.setback[e.id * 2], sb = g.setback[e.id * 2 + 1];
    const at = (along, lateral) => [A.x + dx * along + rx * lateral, A.z + dz * along + rz * lateral];
    const a0 = A.signal ? sa + 3.8 : sa;
    const a1 = e.len - (B.signal ? sb + 3.8 : sb);
    if (a1 > a0) {
      const mid = (a0 + a1) / 2, len = a1 - a0;
      for (const k of [-0.22, 0.22]) yellow.push([...at(mid, k), 0.22, len, dx, dz]);
      for (const k of [-(e.hw - 0.7), e.hw - 0.7]) white.push([...at(mid, k), 0.25, len, dx, dz]);
    }
    for (const [node, along, sgn] of [[A, sa, 1], [B, e.len - sb, -1]]) {
      if (!node.signal) continue;
      // Zebra crossing just outside the junction.
      for (let k = -e.hw + 1; k <= e.hw - 1; k += 1.5) crossings.push([...at(along + 1.5 * sgn, k), 0.9, 2.5, dx, dz]);
      // Stop line across the lane arriving at this junction (traffic drives on the right).
      const lateral = (-sgn * e.hw) / 2;
      stops.push([...at(along + 3.4 * sgn, lateral), 0.6, e.hw - 0.4, rx, rz]);
    }
  }

  const group = new THREE.Group();
  const place = (list, color, y) => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), toon({ color }), list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    list.forEach(([x, z, w, len, ux, uz], i) => {
      q.setFromAxisAngle(up, Math.atan2(ux, uz));
      m.compose(p.set(x, y, z), q, s.set(w, 1, len));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  place(yellow, 0xf2c230, 0.02);
  place(white, 0xeeeae0, 0.02);
  place(crossings, 0xeeeae0, 0.021);
  place(stops, 0xeeeae0, 0.022);
  return group;
}

function createParks(rng, parks, grass, colliders) {
  const g = new THREE.Group();
  const trees = [];
  for (const b of parks) {
    const inner = offsetConvex(b.shape, CITY.sidewalk);
    if (!inner) continue;
    extrudeSlab(grass, inner, CITY.curbHeight, CITY.curbHeight + 0.1);
    const zone = offsetConvex(inner, 3);
    if (!zone) continue;
    const bb = bounds(zone);
    const count = Math.max(3, Math.min(40, Math.round(signedArea(zone) / 110)));
    for (let i = 0, tries = 0; i < count && tries < count * 20; tries++) {
      const x = rng.range(bb.minX, bb.maxX), z = rng.range(bb.minZ, bb.maxZ);
      if (!insideConvex(zone, x, z)) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5)) continue;
      const s = rng.range(0.8, 1.3);
      trees.push({ x, z, s });
      colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
      i++;
    }
  }
  const grassMesh = new THREE.Mesh(grass.build(), toon({ color: 0x5fae3f, vertexColors: true }));
  grassMesh.receiveShadow = true;
  g.add(grassMesh);

  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 2.5, 8), toon({ color: 0x7a5232 }), trees.length);
  const leaves = new THREE.InstancedMesh(
    new THREE.SphereGeometry(2.3, 12, 8).scale(1, 0.8, 1), // round, cartoon canopy
    toon({ color: 0x3f9a3a }),
    trees.length,
  );
  const m = new THREE.Matrix4();
  trees.forEach(({ x, z, s }, i) => {
    m.makeScale(s, s, s).setPosition(x, CITY.curbHeight + 1.25 * s, z);
    trunk.setMatrixAt(i, m);
    m.makeScale(s, s, s).setPosition(x, CITY.curbHeight + 3.6 * s, z);
    leaves.setMatrixAt(i, m);
  });
  trunk.castShadow = leaves.castShadow = true;
  g.add(trunk, leaves);
  return g;
}

/**
 * Street lamps: one on every traffic-signal pole (the signals hang off them, see
 * TrafficLights.js), plus one at each other block corner.
 */
function createStreetLamps(colliders) {
  const spots = [];
  const near = (x, z, r) => spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < r);
  for (const h of LAYOUT.signalHeads) if (!near(h.x, h.z, 0.5)) spots.push([h.x, h.z]);
  for (const b of LAYOUT.blocks) {
    if (b.use === 'lot') continue;
    for (const c of b.corners) {
      if (c.straight) continue;
      const x = c.x + c.vx * 1.2, z = c.z + c.vz * 1.2;
      if (!insideConvex(b.shape, x, z, -0.4) || near(x, z, 3)) continue;
      spots.push([x, z]);
    }
  }
  const pole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.18, 6, 8),
    toon({ color: 0x2f5a3e }), // classic dark-green city lamp posts
    spots.length,
  );
  const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.35, 0.8), new THREE.MeshBasicMaterial({ color: 0xfff1b8 }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => {
    m.makeTranslation(x, CITY.curbHeight + 3, z);
    pole.setMatrixAt(i, m);
    m.makeTranslation(x, CITY.curbHeight + 6.1, z);
    head.setMatrixAt(i, m);
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 });
  });
  pole.castShadow = true;
  const g = new THREE.Group();
  g.add(pole, head);
  return g;
}

let signParts = null;
function createParkingSign(x, z) {
  signParts ??= {
    pole: new THREE.CylinderGeometry(0.08, 0.08, 3, 6),
    poleMat: toon({ color: 0x8c9096 }),
    board: new THREE.BoxGeometry(0.12, 1.2, 1.2),
    faceMat: toon({
      map: canvasTexture(64, (ctx) => {
        ctx.fillStyle = '#1f5fbf';
        ctx.fillRect(0, 0, 64, 64);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(5, 5, 54, 54);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 44px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('P', 32, 35);
      }),
    }),
  };
  const sign = new THREE.Group();
  const pole = new THREE.Mesh(signParts.pole, signParts.poleMat);
  pole.position.set(x, CITY.curbHeight + 1.5, z);
  const board = new THREE.Mesh(signParts.board, signParts.faceMat);
  board.position.set(x, CITY.curbHeight + 3.3, z);
  pole.castShadow = board.castShadow = true;
  sign.add(pole, board);
  return sign;
}

function canvasTexture(size, draw, repeat = 1) {
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

/** Facade tile (3m x 3m): white wall (tinted by vertex colour), a framed window with a glint. */
function createWindowTexture() {
  return canvasTexture(64, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; // floor band
    ctx.fillRect(0, 56, 64, 8);
    ctx.fillStyle = '#e9e4da'; // frame
    ctx.fillRect(11, 10, 42, 40);
    ctx.fillStyle = '#26354d'; // glass
    ctx.fillRect(14, 13, 36, 34);
    ctx.fillStyle = 'rgba(140,190,235,0.55)'; // diagonal reflection glint
    ctx.beginPath();
    ctx.moveTo(20, 47); ctx.lineTo(34, 13); ctx.lineTo(42, 13); ctx.lineTo(28, 47);
    ctx.fill();
    ctx.fillStyle = '#e9e4da'; // mullion
    ctx.fillRect(14, 29, 36, 2);
    ctx.fillStyle = '#1a1714'; // inked outline round the frame
    ctx.strokeStyle = '#1a1714';
    ctx.lineWidth = 2;
    ctx.strokeRect(11, 10, 42, 40);
  });
}

/** Tar-and-gravel rooftop: speckled, with the odd seam. Tinted by vertex colour. */
function createRoofTexture() {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, n, n);
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * n, Math.random() * n, 2, 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(0, 0, n, 3);
    ctx.fillRect(0, 0, 3, n);
  });
}

/** Paving slabs: light grey squares with dark grout lines. Repeats 2m tiles over a block. */
function createTileTexture() {
  return canvasTexture(
    64,
    (ctx) => {
      ctx.fillStyle = '#c9c6bd';
      ctx.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
        ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
      }
      ctx.fillStyle = '#8f8b82';
      ctx.fillRect(0, 0, 64, 2);
      ctx.fillRect(0, 0, 2, 64);
    },
    1,
  );
}

/** Asphalt: mid grey with speckle and a few darker patches. */
function createAsphaltTexture() {
  return canvasTexture(
    256,
    (ctx, n) => {
      ctx.fillStyle = '#5b5d63';
      ctx.fillRect(0, 0, n, n);
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = `rgba(30,30,35,${0.03 + Math.random() * 0.04})`;
        ctx.beginPath();
        ctx.ellipse(Math.random() * n, Math.random() * n, 10 + Math.random() * 40, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 4000; i++) {
        const v = Math.random() < 0.5 ? 255 : 0;
        ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * 0.08})`;
        ctx.fillRect(Math.random() * n, Math.random() * n, 1, 1);
      }
    },
    CITY.size / 16,
  );
}

/** Accumulates coloured, UV-mapped quads into a single merged BufferGeometry. */
/** Accumulates coloured, UV-mapped faces into a single merged BufferGeometry. */
class QuadBuilder {
  constructor(tile = 3) {
    this.tile = tile;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  /** Convex polygon fan; `pts` are [x, y, z], `uvs` are [u, v], wound front-facing. */
  face(pts, n, uvs, color) {
    const base = this.pos.length / 3;
    pts.forEach((p, i) => {
      this.pos.push(...p);
      this.nrm.push(...n);
      this.uv.push(...uvs[i]);
      this.col.push(color.r, color.g, color.b);
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
