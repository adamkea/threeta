import * as THREE from 'three';
import { createRng } from '../core/random.js';
import { toon } from '../render/toon.js';
import { LANDMARK_BLOCKS, createLandmark } from './Landmarks.js';

// City layout constants (metres). The city is a square grid of blocks separated by roads.
export const CITY = {
  blocks: 8, // blocks per side
  blockSize: 40, // block footprint incl. sidewalk
  roadWidth: 14,
  sidewalk: 3,
  curbHeight: 0.25,
};
CITY.cell = CITY.blockSize + CITY.roadWidth;
CITY.size = CITY.blocks * CITY.blockSize + (CITY.blocks + 1) * CITY.roadWidth;
CITY.half = CITY.size / 2;

/** Height of the sea around the island; anything that goes over the edge falls to this. */
export const WATER_Y = -0.6;

/** True once a point is past the quayside, over open water. */
export function offIsland(x, z) {
  return Math.abs(x) > CITY.half || Math.abs(z) > CITY.half;
}

/** World-space centre of road line `i` (0..blocks), on either axis. */
export function roadCenter(i) {
  return -CITY.half + CITY.roadWidth / 2 + i * CITY.cell;
}

// Parking lot layout, in metres from a block's min corner. The lot sits at road level inside
// the sidewalk ring. Two aisles run along X, with driveways through the sidewalk at both ends;
// rows of bays face onto them: one row along each edge and a double row down the middle.
export const LOT = {
  bayWidth: 2.8,
  bayDepth: 5.2,
  bays: 12, // per row
};
LOT.x0 = CITY.sidewalk + (CITY.blockSize - 2 * CITY.sidewalk - LOT.bays * LOT.bayWidth) / 2;
{
  const s = CITY.sidewalk, d = LOT.bayDepth;
  const aisle = (CITY.blockSize - 2 * s - 4 * d) / 2;
  LOT.aisles = [
    [s + d, s + d + aisle],
    [s + 3 * d + aisle, s + 3 * d + 2 * aisle],
  ];
  // Each row: the z range of its bays and which way a car parked nose-in faces (+1 = +Z).
  LOT.rows = [
    { z0: s, z1: s + d, nose: -1 },
    { z0: s + d + aisle, z1: s + 2 * d + aisle, nose: 1 },
    { z0: s + 2 * d + aisle, z1: s + 3 * d + aisle, nose: -1 },
    { z0: s + 3 * d + 2 * aisle, z1: s + 4 * d + 2 * aisle, nose: 1 },
  ];
}

/** Blocks that are parking lots, as `bx * 100 + bz`. Filled in by createCity. */
const lotBlocks = new Set();

/** Block index (0..blocks-1) and offset into it along one axis, or null if on a road. */
function blockAt(v) {
  const o = v + CITY.half - CITY.roadWidth;
  if (o < 0 || o > CITY.size - 2 * CITY.roadWidth) return null;
  const local = o % CITY.cell;
  return local < CITY.blockSize ? [Math.floor(o / CITY.cell), local] : null;
}

/** Ground height at a point: raised on sidewalks/blocks, 0 on roads (and in parking lots). */
export function groundHeight(x, z) {
  const bx = blockAt(x);
  const bz = blockAt(z);
  if (!bx || !bz) return 0;
  if (lotBlocks.has(bx[0] * 100 + bz[0])) {
    const s = CITY.sidewalk;
    const [lx, lz] = [bx[1], bz[1]];
    const insideX = lx > s && lx < CITY.blockSize - s;
    const insideZ = lz > s && lz < CITY.blockSize - s;
    if (insideX && insideZ) return 0;
    if (insideZ && LOT.aisles.some(([a, b]) => lz > a && lz < b)) return 0; // driveway
  }
  return CITY.curbHeight;
}

/** World-space min corner of block `i` on either axis. */
export function blockMin(i) {
  return -CITY.half + CITY.roadWidth + i * CITY.cell;
}

// Comic-city palette: warm brick, sandstone, slate and a few loud accents.
const BUILDING_COLORS = [
  0xc9744f, 0xb2473a, 0x7f9fb6, 0xe2c27d, 0x8fae7e, 0xb07aa0, 0xd9d1bf, 0x8c8079, 0x5f86a8, 0xe8a07c,
  0x6f6a73, 0xd8b45a,
];

/**
 * Procedurally builds the city. Returns the scene group plus a list of axis-aligned
 * colliders ({minX, maxX, minZ, maxZ}) that vehicles can't pass through.
 */
export function createCity(seed = 1337) {
  const rng = createRng(seed);
  const group = new THREE.Group();
  const colliders = [];

  group.add(createGround());
  group.add(createRoadMarkings());

  const walls = new QuadBuilder();
  const roofs = new QuadBuilder();
  const sidewalkMatrices = [];
  const parks = [];
  const lots = []; // parking lots: { x0, z0 } block corners
  const lotRng = createRng(seed + 7);
  lotBlocks.clear();
  const buildings = []; // footprints + colours, for the map
  const landmarks = []; // police station, hospital…
  const windowTex = createWindowTexture();

  for (let bx = 0; bx < CITY.blocks; bx++) {
    for (let bz = 0; bz < CITY.blocks; bz++) {
      const x0 = blockMin(bx);
      const z0 = blockMin(bz);

      // Distance from centre drives building height: tall downtown, low outskirts.
      const cx = (bx + 0.5) / CITY.blocks - 0.5;
      const cz = (bz + 0.5) / CITY.blocks - 0.5;
      const downtown = 1 - Math.min(1, Math.hypot(cx, cz) * 2);

      const park = rng.chance(0.1);
      // One lot is always right beside the player's starting point; others are scattered about.
      const lot = !park && ((bx === 4 && bz === 4) || lotRng.chance(0.09));
      const landmark = LANDMARK_BLOCKS.find((l) => l.bx === bx && l.bz === bz);
      if (landmark) {
        sidewalkMatrices.push(
          new THREE.Matrix4().makeTranslation(x0 + CITY.blockSize / 2, CITY.curbHeight / 2, z0 + CITY.blockSize / 2),
        );
        const l = createLandmark(landmark.kind, x0 + CITY.blockSize / 2, z0 + CITY.blockSize / 2, CITY.curbHeight, {
          colliders,
          windowTex,
        });
        group.add(l.group);
        landmarks.push(l);
        buildings.push({ ...l.footprint, color: l.color });
        buildings.push(...l.buildings);
        // Build (and throw away) the block that would have stood here, so the rest of the city keeps its layout.
        if (!park && !lot) buildBlock(rng, x0, z0, downtown, new QuadBuilder(), new QuadBuilder(), [], []);
        continue;
      }
      if (lot) {
        lots.push({ x0, z0 });
        lotBlocks.add(bx * 100 + bz);
        continue; // its sidewalk is a ring with driveways, built in createParkingLots
      }
      sidewalkMatrices.push(
        new THREE.Matrix4().makeTranslation(x0 + CITY.blockSize / 2, CITY.curbHeight / 2, z0 + CITY.blockSize / 2),
      );
      if (park) {
        parks.push({ x0, z0 });
        continue;
      }
      buildBlock(rng, x0, z0, downtown, walls, roofs, colliders, buildings);
    }
  }

  // Sidewalk slabs (one instanced mesh for every block).
  const sidewalkMat = toon({ map: createTileTexture() });
  const sidewalkMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CITY.blockSize, CITY.curbHeight, CITY.blockSize),
    sidewalkMat,
    sidewalkMatrices.length,
  );
  sidewalkMatrices.forEach((m, i) => sidewalkMesh.setMatrixAt(i, m));
  sidewalkMesh.receiveShadow = true;
  group.add(sidewalkMesh);

  const wallMesh = new THREE.Mesh(
    walls.build(),
    toon({ map: windowTex, vertexColors: true }),
  );
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const roofMesh = new THREE.Mesh(roofs.build(), toon({ map: createRoofTexture(), vertexColors: true }));
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  group.add(roofMesh);

  group.add(createParks(rng, parks, colliders));
  const parking = createParkingLots(lotRng, lots, sidewalkMat, colliders);
  group.add(parking.group);
  group.add(createStreetLamps(colliders));

  return { group, colliders, buildings, parks, lots, landmarks, parkingSpots: parking.spots };
}

/**
 * Parking lots: a sidewalk ring with driveways, painted bays, and a "P" sign. Returns the
 * meshes and every bay as a parking spot { x, z, heading } (heading faces nose-in or out).
 */
function createParkingLots(rng, lots, sidewalkMat, colliders) {
  const g = new THREE.Group();
  const spots = [];
  const lines = []; // [x, z, width, length] painted strips running along Z
  const bs = CITY.blockSize, s = CITY.sidewalk, h = CITY.curbHeight;
  const [[a0, a1], [b0, b1]] = LOT.aisles;
  // Sidewalk ring in block-local rects [minX, minZ, maxX, maxZ], with gaps where the aisles exit.
  const ring = [
    [0, 0, bs, s],
    [0, bs - s, bs, bs],
  ];
  for (const [xa, xb] of [[0, s], [bs - s, bs]]) {
    ring.push([xa, s, xb, a0], [xa, a1, xb, b0], [xa, b1, xb, bs - s]);
  }

  for (const { x0, z0 } of lots) {
    for (const [ax, az, bx, bz] of ring) {
      const w = bx - ax, d = bz - az;
      const geo = new THREE.BoxGeometry(w, h, d);
      // Keep the paving tiles the same size as on the full-block slabs.
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / bs, (uv.getY(i) * d) / bs);
      const m = new THREE.Mesh(geo, sidewalkMat);
      m.position.set(x0 + ax + w / 2, h / 2, z0 + az + d / 2);
      m.receiveShadow = true;
      g.add(m);
    }

    for (const row of LOT.rows) {
      const depth = row.z1 - row.z0;
      const zc = z0 + (row.z0 + row.z1) / 2;
      for (let k = 0; k <= LOT.bays; k++) lines.push([x0 + LOT.x0 + k * LOT.bayWidth, zc, 0.15, depth]);
      for (let k = 0; k < LOT.bays; k++) {
        const nose = rng.chance(0.75) ? row.nose : -row.nose; // most drivers park nose-in
        spots.push({
          x: x0 + LOT.x0 + (k + 0.5) * LOT.bayWidth,
          z: zc,
          heading: nose > 0 ? 0 : Math.PI,
        });
      }
    }
    // Line down the back of the middle double row, and along the inside of each edge row.
    const width = LOT.bays * LOT.bayWidth;
    for (const z of [LOT.rows[0].z1 - 0.1, LOT.rows[1].z1, LOT.rows[3].z0 + 0.1]) {
      lines.push([x0 + LOT.x0 + width / 2, z0 + z, width, 0.15]);
    }

    // "P" sign on the sidewalk between the two west driveways.
    const sx = x0 + s / 2, sz = z0 + (a1 + b0) / 2;
    g.add(createParkingSign(sx, sz));
    colliders.push({ minX: sx - 0.15, maxX: sx + 0.15, minZ: sz - 0.15, maxZ: sz + 0.15 });
  }

  if (lines.length) {
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      toon({ color: 0xeeeae0 }),
      lines.length,
    );
    const m = new THREE.Matrix4();
    lines.forEach(([x, z, w, l], i) => mesh.setMatrixAt(i, m.makeScale(w, 1, l).setPosition(x, 0.02, z)));
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return { group: g, spots };
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

function buildBlock(rng, x0, z0, downtown, walls, roofs, colliders, buildings) {
  const inset = CITY.sidewalk;
  const lot = CITY.blockSize - inset * 2;
  const cols = rng.int(1, 3);
  const rows = rng.int(1, 3);
  const gap = 1.5;
  const cw = (lot - gap * (cols - 1)) / cols;
  const rw = (lot - gap * (rows - 1)) / rows;

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const minX = x0 + inset + c * (cw + gap);
      const minZ = z0 + inset + r * (rw + gap);
      const base = 6 + downtown * 16;
      const h = rng.range(base * 0.6, base * 1.4) + (rng.chance(0.08 + downtown * 0.2) ? rng.range(8, 18) : 0);
      const color = new THREE.Color(rng.pick(BUILDING_COLORS)).offsetHSL(0, 0, rng.range(-0.05, 0.05));
      const y0 = CITY.curbHeight;

      walls.boxSides(minX, minZ, minX + cw, minZ + rw, y0, y0 + h, color);
      // Flat grey roof inside a parapet lip — gives the ink pass a crisp rooftop outline.
      const top = y0 + h;
      const roofCol = new THREE.Color(0x7d7a78).lerp(color, 0.25);
      const lip = color.clone().multiplyScalar(0.85);
      const p = 0.5, ph = 0.7;
      roofs.top(minX, minZ, minX + cw, minZ + rw, top, roofCol);
      for (const [ax, az, bx, bz] of [
        [minX, minZ, minX + cw, minZ + p],
        [minX, minZ + rw - p, minX + cw, minZ + rw],
        [minX, minZ + p, minX + p, minZ + rw - p],
        [minX + cw - p, minZ + p, minX + cw, minZ + rw - p],
      ]) {
        roofs.boxSides(ax, az, bx, bz, top, top + ph, lip);
        roofs.top(ax, az, bx, bz, top + ph, lip.clone().multiplyScalar(1.1));
      }

      // Rooftop detail: an AC unit / stairwell box.
      if (rng.chance(0.7)) {
        const s = rng.range(2, Math.min(cw, rw) * 0.4);
        const px = rng.range(minX + 1, minX + cw - s - 1);
        const pz = rng.range(minZ + 1, minZ + rw - s - 1);
        const unitTop = top + rng.range(1, 3);
        const dc = new THREE.Color(rng.pick([0xb8bcc2, 0x9aa3ad, 0xc9b79a]));
        roofs.boxSides(px, pz, px + s, pz + s, top, unitTop, dc);
        roofs.top(px, pz, px + s, pz + s, unitTop, dc.clone().multiplyScalar(1.1));
      }

      colliders.push({ minX, maxX: minX + cw, minZ, maxZ: minZ + rw });
      buildings.push({ minX, maxX: minX + cw, minZ, maxZ: minZ + rw, height: h, color: color.getHex() });
    }
  }
}

function createGround() {
  const g = new THREE.Group();
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size, CITY.size),
    toon({ map: createAsphaltTexture() }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  // Water surrounding the island city.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size * 6, CITY.size * 6),
    toon({ color: 0x2f8fb8 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  g.add(water);

  // Open quayside: the island is a slab standing in the sea, with no wall to stop you going over.
  const quay = new THREE.Mesh(new THREE.BoxGeometry(CITY.size, 4, CITY.size), toon({ color: 0x9a9384 }));
  quay.position.y = -2.01; // top sits just under the asphalt
  g.add(quay);
  return g;
}

function createRoadMarkings() {
  const half = CITY.roadWidth / 2;
  const yellow = []; // [x, z, length, alongX]
  const white = [];
  const crossings = [];
  const stops = [];

  for (let line = 0; line <= CITY.blocks; line++) {
    const c = roadCenter(line);
    for (let seg = 0; seg < CITY.blocks; seg++) {
      const s0 = blockMin(seg);
      const s1 = s0 + CITY.blockSize;
      const a = s0 + 3.8, b = s1 - 3.8; // between the stop lines
      const mid = (a + b) / 2, len = b - a;
      // Double yellow centre line.
      for (const k of [-0.22, 0.22]) {
        yellow.push([c + k, mid, len, false], [mid, c + k, len, true]);
      }
      // Solid white edge lines just inside the curbs.
      for (const k of [-(half - 0.7), half - 0.7]) {
        white.push([c + k, mid, len, false], [mid, c + k, len, true]);
      }
      // Zebra crossings at both ends of the segment.
      for (const edge of [s0 + 1.5, s1 - 1.5]) {
        for (let k = -half + 1; k <= half - 1; k += 1.5) {
          crossings.push([c + k, edge, 2.5, false], [edge, c + k, 2.5, true]);
        }
      }
      // Stop lines across the approaching lanes (traffic drives on the right).
      const sl = half / 2;
      stops.push(
        [c - sl, s1 - 3.4, 0, false], // +Z traffic, lane at -X
        [c + sl, s0 + 3.4, 0, false], // -Z traffic, lane at +X
        [s1 - 3.4, c + sl, 0, true], // +X traffic, lane at +Z
        [s0 + 3.4, c - sl, 0, true], // -X traffic, lane at -Z
      );
    }
  }

  const g = new THREE.Group();
  const place = (list, w, color, y) => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), toon({ color }), list.length);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const scl = new THREE.Matrix4();
    list.forEach(([x, z, len, alongX], i) => {
      m.makeTranslation(x, y, z);
      if (alongX) m.multiply(rot);
      m.multiply(scl.makeScale(w, 1, len));
      mesh.setMatrixAt(i, m);
    });
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  place(yellow, 0.22, 0xf2c230, 0.02);
  place(white, 0.25, 0xeeeae0, 0.02);
  place(crossings, 0.9, 0xeeeae0, 0.021);
  // Stop lines: thick bars spanning half the road. Encode as rotated wide strips.
  place(
    stops.map(([x, z, , alongX]) => [x, z, half - 0.4, !alongX]),
    0.6,
    0xeeeae0,
    0.022,
  );
  return g;
}

function createParks(rng, parks, colliders) {
  const g = new THREE.Group();
  const grassMat = toon({ color: 0x5fae3f });
  const trees = [];
  for (const { x0, z0 } of parks) {
    const inner = CITY.blockSize - CITY.sidewalk * 2;
    const grass = new THREE.Mesh(new THREE.BoxGeometry(inner, 0.1, inner), grassMat);
    grass.position.set(x0 + CITY.blockSize / 2, CITY.curbHeight + 0.05, z0 + CITY.blockSize / 2);
    grass.receiveShadow = true;
    g.add(grass);
    const count = rng.int(6, 12);
    for (let i = 0; i < count; i++) {
      const x = x0 + CITY.sidewalk + rng.range(3, inner - 3);
      const z = z0 + CITY.sidewalk + rng.range(3, inner - 3);
      const s = rng.range(0.8, 1.3);
      trees.push({ x, z, s });
      colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
    }
  }

  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.25, 0.35, 2.5, 8),
    toon({ color: 0x7a5232 }),
    trees.length,
  );
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

function createStreetLamps(colliders) {
  const spots = [];
  const o = 1.2; // offset in from the curb corner
  for (let bx = 0; bx < CITY.blocks; bx++) {
    for (let bz = 0; bz < CITY.blocks; bz++) {
      const x0 = blockMin(bx);
      const z0 = blockMin(bz);
      const x1 = x0 + CITY.blockSize;
      const z1 = z0 + CITY.blockSize;
      spots.push([x0 + o, z0 + o], [x1 - o, z0 + o], [x0 + o, z1 - o], [x1 - o, z1 - o]);
    }
  }
  const pole = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.18, 6, 8),
    toon({ color: 0x2f5a3e }), // classic dark-green city lamp posts
    spots.length,
  );
  const head = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.8, 0.35, 0.8),
    new THREE.MeshBasicMaterial({ color: 0xfff1b8 }),
    spots.length,
  );
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
    CITY.blockSize / 2,
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
class QuadBuilder {
  constructor(tile = 3) {
    this.tile = tile;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }

  quad(a, b, c, d, n, uw, uh, color) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(...p);
    for (let i = 0; i < 4; i++) {
      this.nrm.push(...n);
      this.col.push(color.r, color.g, color.b);
    }
    this.uv.push(0, 0, uw, 0, uw, uh, 0, uh);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  boxSides(x0, z0, x1, z1, y0, y1, color) {
    const t = this.tile;
    const h = (y1 - y0) / t;
    const w = (x1 - x0) / t;
    const d = (z1 - z0) / t;
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], w, h, color); // +Z
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], w, h, color); // -Z
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], d, h, color); // +X
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], d, h, color); // -X
  }

  top(x0, z0, x1, z1, y, color) {
    const t = this.tile;
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], (x1 - x0) / t, (z1 - z0) / t, color);
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
