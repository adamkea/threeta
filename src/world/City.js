import * as THREE from 'three';
import { createRng } from '../core/random.js';

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

/** World-space centre of road line `i` (0..blocks), on either axis. */
export function roadCenter(i) {
  return -CITY.half + CITY.roadWidth / 2 + i * CITY.cell;
}

/** World-space min corner of block `i` on either axis. */
function blockMin(i) {
  return -CITY.half + CITY.roadWidth + i * CITY.cell;
}

const BUILDING_COLORS = [
  0xd9a37a, 0xc76b5a, 0x8fa9b8, 0xe0c98f, 0xa7b59a, 0xb58fa8, 0xd8d2c4, 0x9a8f86, 0x7d9bb0, 0xe6b8a2,
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

  for (let bx = 0; bx < CITY.blocks; bx++) {
    for (let bz = 0; bz < CITY.blocks; bz++) {
      const x0 = blockMin(bx);
      const z0 = blockMin(bz);
      sidewalkMatrices.push(
        new THREE.Matrix4().makeTranslation(x0 + CITY.blockSize / 2, CITY.curbHeight / 2, z0 + CITY.blockSize / 2),
      );

      // Distance from centre drives building height: tall downtown, low outskirts.
      const cx = (bx + 0.5) / CITY.blocks - 0.5;
      const cz = (bz + 0.5) / CITY.blocks - 0.5;
      const downtown = 1 - Math.min(1, Math.hypot(cx, cz) * 2);

      if (rng.chance(0.1)) {
        parks.push({ x0, z0 });
        continue;
      }
      buildBlock(rng, x0, z0, downtown, walls, roofs, colliders);
    }
  }

  // Sidewalk slabs (one instanced mesh for every block).
  const sidewalkMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CITY.blockSize, CITY.curbHeight, CITY.blockSize),
    new THREE.MeshLambertMaterial({ color: 0xb9b6ae }),
    sidewalkMatrices.length,
  );
  sidewalkMatrices.forEach((m, i) => sidewalkMesh.setMatrixAt(i, m));
  sidewalkMesh.receiveShadow = true;
  group.add(sidewalkMesh);

  const wallMesh = new THREE.Mesh(
    walls.build(),
    new THREE.MeshLambertMaterial({ map: createWindowTexture(), vertexColors: true }),
  );
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  group.add(wallMesh);

  const roofMesh = new THREE.Mesh(roofs.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  group.add(roofMesh);

  group.add(createParks(rng, parks, colliders));
  group.add(createStreetLamps(colliders));

  addPerimeter(colliders);

  return { group, colliders };
}

function buildBlock(rng, x0, z0, downtown, walls, roofs, colliders) {
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
      roofs.top(minX, minZ, minX + cw, minZ + rw, y0 + h, color.clone().multiplyScalar(0.7));

      // Rooftop detail: an AC unit / stairwell box.
      if (rng.chance(0.7)) {
        const s = rng.range(2, Math.min(cw, rw) * 0.4);
        const px = rng.range(minX + 1, minX + cw - s - 1);
        const pz = rng.range(minZ + 1, minZ + rw - s - 1);
        const top = y0 + h + rng.range(1, 3);
        const dc = new THREE.Color(0x9a9a9a);
        roofs.boxSides(px, pz, px + s, pz + s, y0 + h, top, dc);
        roofs.top(px, pz, px + s, pz + s, top, dc.clone().multiplyScalar(0.8));
      }

      colliders.push({ minX, maxX: minX + cw, minZ, maxZ: minZ + rw });
    }
  }
}

function createGround() {
  const g = new THREE.Group();
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size, CITY.size),
    new THREE.MeshLambertMaterial({ color: 0x3b3d42 }),
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  // Water surrounding the island city.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY.size * 6, CITY.size * 6),
    new THREE.MeshLambertMaterial({ color: 0x2f6f8f }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  g.add(water);

  // Sea wall around the edge.
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a8577 });
  const t = 2;
  for (const [w, d, x, z] of [
    [CITY.size + t * 2, t, 0, -CITY.half - t / 2],
    [CITY.size + t * 2, t, 0, CITY.half + t / 2],
    [t, CITY.size, -CITY.half - t / 2, 0],
    [t, CITY.size, CITY.half + t / 2, 0],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, d), wallMat);
    m.position.set(x, 0.2, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function addPerimeter(colliders) {
  const h = CITY.half;
  const t = 5;
  colliders.push(
    { minX: -h - t, maxX: h + t, minZ: -h - t, maxZ: -h },
    { minX: -h - t, maxX: h + t, minZ: h, maxZ: h + t },
    { minX: -h - t, maxX: -h, minZ: -h, maxZ: h },
    { minX: h, maxX: h + t, minZ: -h, maxZ: h },
  );
}

function createRoadMarkings() {
  const dashLen = 3;
  const dashGap = 3;
  const dashes = [];
  const crossings = [];

  for (let line = 0; line <= CITY.blocks; line++) {
    const c = roadCenter(line);
    for (let seg = 0; seg < CITY.blocks; seg++) {
      const s0 = blockMin(seg);
      const s1 = s0 + CITY.blockSize;
      // Centre-line dashes along this road segment, in both orientations.
      for (let s = s0 + 4; s + dashLen < s1 - 3; s += dashLen + dashGap) {
        dashes.push([c, s + dashLen / 2, false]); // road running along Z
        dashes.push([s + dashLen / 2, c, true]); // road running along X
      }
      // Zebra crossings at both ends of the segment.
      for (const edge of [s0 + 1.5, s1 - 1.5]) {
        for (let k = -5; k <= 5; k += 1.6) {
          crossings.push([c + k, edge, false]);
          crossings.push([edge, c + k, true]);
        }
      }
    }
  }

  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xe8e2c8 });
  const place = (list, geo) => {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    list.forEach(([x, z, alongX], i) => {
      m.makeTranslation(x, 0.02, z);
      if (alongX) m.multiply(rot);
      mesh.setMatrixAt(i, m);
    });
    g.add(mesh);
  };
  place(dashes, new THREE.BoxGeometry(0.3, 0.02, dashLen));
  place(crossings, new THREE.BoxGeometry(0.8, 0.02, 2.5));
  return g;
}

function createParks(rng, parks, colliders) {
  const g = new THREE.Group();
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x6b9b4b });
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
    new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4a2f }),
    trees.length,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(2.2, 0),
    new THREE.MeshLambertMaterial({ color: 0x3f7a35, flatShading: true }),
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
    new THREE.CylinderGeometry(0.12, 0.15, 6, 6),
    new THREE.MeshLambertMaterial({ color: 0x2c2f36 }),
    spots.length,
  );
  const head = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.6, 0.25, 0.6),
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

/** Canvas texture of a single 3m x 3m facade tile with one window. */
function createWindowTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const grad = ctx.createLinearGradient(0, 14, 0, 46);
  grad.addColorStop(0, '#3a4a5c');
  grad.addColorStop(1, '#58708a');
  ctx.fillStyle = grad;
  ctx.fillRect(14, 14, 36, 32);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(12, 46, 40, 4); // sill shadow
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], 1, 1, color);
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
