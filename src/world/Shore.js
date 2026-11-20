import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { PROMENADE, SHORE_Y, WATER_LEVEL, sandHeight } from './shoreLayout.js';
import { QuadBuilder, canvasTexture } from './meshKit.js';
import { signedArea } from './geom.js';

// Meshes and colliders for the shore (laid out in shoreLayout.js): the promenade along the coast
// road, sandy beaches with palms, parasols and lifeguard towers, concrete docks with quay walls,
// bollards and stacks of shipping containers, and wooden piers.

const FLOOR = WATER_LEVEL - 2.5; // how far walls reach down below the waterline
const WHITE = new THREE.Color(0xffffff);
const DOCK = new THREE.Color(0xb3b0a7);
const QUAY = new THREE.Color(0x8f887a);
const SAND = new THREE.Color(0xf0dca2);
const WET_SAND = new THREE.Color(0xcdb07a);
const SEABED = new THREE.Color(0x9a8a5e);
const CONTAINER_COLORS = [0xb8432f, 0x2d6b8f, 0xd08a2a, 0x3f7d4a, 0x7a4f8c, 0xc9c2b2, 0x24566f, 0xa83a52];
const PARASOL_COLORS = [0xe8473a, 0x2f8fd8, 0xf2c230, 0x3fae6a, 0xf28ab0, 0xffffff];

/**
 * Builds the shore. Paving (promenade, docks, quay walls) goes into `slabs`, the city's sidewalk
 * builder, so it matches the sidewalks; everything else is returned in `group`. Solid things are
 * added to `colliders`. Returns spots for street lamps along the promenade and pleasure pier.
 */
export function createShore(rng, shore, slabs, colliders) {
  const group = new THREE.Group();
  const { segs, at } = shore;
  const sand = new QuadBuilder(4);
  const wood = new QuadBuilder(2);
  const paint = new QuadBuilder(1);
  const lamps = [];
  const y = SHORE_Y.curb;
  const P = (i, d, h) => {
    const p = at(i, d);
    return [p.x, h, p.z];
  };

  // Where piers meet the shore: keep the quay edge clear there.
  const pierRoots = shore.piers.map((p) => ({ x: p.x0, z: p.z0, r: p.hw + 1.5, seg: p.seg }));
  const nearPier = (x, z, pad = 0) => pierRoots.some((r) => Math.hypot(r.x - x, r.z - z) < r.r + pad);

  let sinceLamp = 15;
  for (const s of segs) {
    const { i, j } = s;
    const beach = s.type === 'beach';

    // Promenade: a strip of paving along the curb, with the curb facing the road.
    flat(slabs, [P(i, 0, y), P(j, 0, y), P(j, PROMENADE, y), P(i, PROMENADE, y)], WHITE);
    wallFacing(slabs, at(i, 0), at(j, 0), 0, y, WHITE, -s.nx, -s.nz);
    sinceLamp += s.len;
    if (sinceLamp > 32) {
      const p = at(i, 1);
      if (!nearPier(p.x, p.z, 4)) {
        lamps.push([p.x, p.z]);
        sinceLamp = 0;
      }
    }

    if (!beach) {
      // Dock: concrete out to the quay wall, with a yellow line along the edge.
      flat(slabs, [P(i, PROMENADE, y), P(j, PROMENADE, y), P(j, s.w1, y), P(i, s.w0, y)], DOCK);
      wallFacing(slabs, at(i, s.w0), at(j, s.w1), FLOOR, y, QUAY, s.nx, s.nz);
      const l0 = at(i, s.w0 - 1.2), l1 = at(j, s.w1 - 1.2), l2 = at(j, s.w1 - 0.9), l3 = at(i, s.w0 - 0.9);
      flat(paint, [l0, l1, l2, l3].map((p) => [p.x, y + 0.012, p.z]), new THREE.Color(0xf2c230));
      // Ends of the dock where it meets a beach (or a dock of another width).
      if (s.prev.type !== 'dock' || Math.abs(s.prev.w1 - s.w0) > 0.01) {
        wallFacing(slabs, at(i, PROMENADE), at(i, s.w0), FLOOR, y, QUAY, -s.dx, -s.dz);
      }
      if (s.next.type !== 'dock' || Math.abs(s.next.w0 - s.w1) > 0.01) {
        wallFacing(slabs, at(j, PROMENADE), at(j, s.w1), FLOOR, y, QUAY, s.dx, s.dz);
      }
      continue;
    }

    // Beach: sand from the foot of the promenade wall down into the sea, darker where it's wet.
    wallFacing(slabs, at(i, PROMENADE), at(j, PROMENADE), SHORE_Y.sandTop - 0.3, y, WHITE, s.nx, s.nz);
    const rows = [0, 0.3, 0.55, 0.78, 0.92, 1];
    const ring = (k, end) => {
      const w = end ? s.w1 : s.w0;
      const d = PROMENADE + (w - PROMENADE) * rows[k];
      return { d, w, i: end ? j : i };
    };
    const sandColour = (k) => (k >= 4 ? WET_SAND : k >= 3 ? SAND.clone().lerp(WET_SAND, 0.5) : SAND);
    for (let k = 0; k + 1 < rows.length; k++) {
      const a0 = ring(k, false), a1 = ring(k, true), b1 = ring(k + 1, true), b0 = ring(k + 1, false);
      const pts = [a0, a1, b1, b0].map((r) => P(r.i, r.d, sandHeight(r.d, r.w)));
      sandFace(sand, pts, [sandColour(k), sandColour(k), sandColour(k + 1), sandColour(k + 1)]);
    }
    // Under the water: the sand carries on down a little way, so there's no gap at the waterline.
    const under = (end) => (end ? s.w1 : s.w0) + 6;
    sandFace(sand, [P(i, s.w0, WATER_LEVEL), P(j, s.w1, WATER_LEVEL), P(j, under(true), WATER_LEVEL - 1.2), P(i, under(false), WATER_LEVEL - 1.2)], [WET_SAND, WET_SAND, SEABED, SEABED]);
    // Where the beach runs out beside a dock, close off the end of the sand.
    for (const [end, other, sx] of [[false, s.prev, -1], [true, s.next, 1]]) {
      if (other.type === 'beach') continue;
      const v = end ? j : i;
      const w = end ? s.w1 : s.w0;
      const from = end ? other.w0 : other.w1;
      const ds = [from, w * 0.9, w, w + 6].filter((d, k, a) => d >= from && (k === 0 || d > a[k - 1]));
      for (let k = 0; k + 1 < ds.length; k++) {
        const pa = at(v, ds[k]), pb = at(v, ds[k + 1]);
        const ha = sandHeight(ds[k], w), hb = sandHeight(ds[k + 1], w);
        sideFace(sand, pa, pb, ha, hb, sx * s.dx, sx * s.dz, SEABED);
      }
    }
  }

  // --- Piers ---
  const posts = [];
  for (const p of shore.piers) {
    const top = SHORE_Y.pier, under = top - 0.35;
    const corner = (u, v) => ({ x: p.x0 + p.ux * u + p.vx * v, z: p.z0 + p.uz * u + p.vz * v });
    const c = [corner(0, -p.hw), corner(p.length, -p.hw), corner(p.length, p.hw), corner(0, p.hw)];
    const poly = signedArea(c) > 0 ? c : c.slice().reverse();
    flat(wood, poly.slice().reverse().map((q) => [q.x, top, q.z]), WHITE, 0.5);
    for (let k = 0; k < 4; k++) {
      const a = poly[k], b = poly[(k + 1) % 4];
      wood.wall(b.x, b.z, a.x, a.z, under, top, new THREE.Color(0x8a6a44));
    }
    for (let u = 2; u < p.length; u += 4.5) {
      for (const v of [-p.hw + 0.4, p.hw - 0.4]) posts.push(corner(u, v));
    }
    if (p.kind === 'pleasure') {
      // Railings down both sides, and lamps along it.
      for (const v of [-p.hw + 0.15, p.hw - 0.15]) {
        const a = corner(1.5, v), b = corner(p.length - 0.15, v);
        railing(group, a, b, top);
        colliders.push(segCollider(a, b, 0.15));
      }
      const end0 = corner(p.length - 0.15, -p.hw), end1 = corner(p.length - 0.15, p.hw);
      railing(group, end0, end1, top);
      colliders.push(segCollider(end0, end1, 0.15));
      for (let u = 14; u < p.length - 4; u += 16) for (const v of [-p.hw + 0.6, p.hw - 0.6]) lamps.push([corner(u, v).x, corner(u, v).z, top]);
    }
  }
  if (posts.length) {
    const len = SHORE_Y.pier - 0.35 - (WATER_LEVEL - 1.5);
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, len, 6), toon({ color: 0x6b4f33 }), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach((q, k) => mesh.setMatrixAt(k, m.makeTranslation(q.x, WATER_LEVEL - 1.5 + len / 2, q.z)));
    group.add(mesh);
  }

  // --- Dock dressing: bollards along the quay edge, containers stacked back from it ---
  const bollards = [];
  const containers = [];
  for (const s of segs) {
    if (s.type !== 'dock') continue;
    const steps = Math.max(1, Math.round(s.len / 8));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const d = s.w0 + (s.w1 - s.w0) * t - 0.7;
      const a = at(s.i, d), b = at(s.j, d);
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      if (nearPier(x, z)) continue;
      bollards.push([x, z]);
      colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 });
    }
    if (pierRoots.some((r) => [s.i, s.prev.i, s.next.i].includes(r.seg)) || !rng.chance(0.6)) continue;
    // One row (sometimes two) of containers, long side along the quay, leaving a lane by the edge.
    const rowsHere = rng.chance(0.35) ? [PROMENADE + 2.6, PROMENADE + 5.3] : [PROMENADE + 2.6];
    const t = rng.range(0.3, 0.7);
    for (const d of rowsHere) {
      if (d + 1.6 > Math.min(s.w0, s.w1) - 3) continue;
      const a = at(s.i, d), b = at(s.j, d);
      const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
      const height = rng.int(1, 3);
      const yaw = Math.atan2(-s.dz, s.dx);
      for (let h = 0; h < height; h++) containers.push({ x: cx, z: cz, y: y + h * 2.6, yaw: yaw + rng.range(-0.03, 0.03), color: rng.pick(CONTAINER_COLORS) });
      colliders.push(boxCollider(cx, cz, s.dx, s.dz, 3.05, 1.25));
    }
  }
  if (bollards.length) {
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.28, 0.7, 10), toon({ color: 0x26282b }), bollards.length);
    const m = new THREE.Matrix4();
    bollards.forEach(([x, z], k) => mesh.setMatrixAt(k, m.makeTranslation(x, y + 0.35, z)));
    mesh.castShadow = true;
    group.add(mesh);
  }
  if (containers.length) group.add(containerMesh(containers));

  // --- Beach dressing: palms along the back, parasols and towels, lifeguard towers ---
  const palms = [];
  const parasols = [];
  const towels = [];
  const towers = [];
  let sinceTower = 60;
  for (const s of segs) {
    if (s.type !== 'beach') continue;
    const w = Math.min(s.w0, s.w1);
    const spot = (d, t) => {
      const a = at(s.i, d), b = at(s.j, d);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };
    if (rng.chance(0.75)) {
      const p = spot(PROMENADE + rng.range(2, 4.5), rng.range(0.2, 0.8));
      if (!nearPier(p.x, p.z, 3)) {
        palms.push({ ...p, s: rng.range(0.85, 1.2), lean: rng.range(0.05, 0.22), turn: rng.range(0, Math.PI * 2) });
        colliders.push({ minX: p.x - 0.35, maxX: p.x + 0.35, minZ: p.z - 0.35, maxZ: p.z + 0.35 });
      }
    }
    sinceTower += s.len;
    if (sinceTower > 130 && w > 20) {
      const p = spot(PROMENADE + (w - PROMENADE) * 0.45, 0.5);
      if (!nearPier(p.x, p.z, 8)) {
        towers.push({ ...p, yaw: Math.atan2(s.nx, s.nz) });
        colliders.push(boxCollider(p.x, p.z, s.dx, s.dz, 1.3, 1.3));
        sinceTower = 0;
        continue;
      }
    }
    for (let k = 0; k < 2; k++) {
      if (!rng.chance(0.4)) continue;
      const d = rng.range(PROMENADE + 7, w - 5);
      const p = spot(d, rng.range(0.15, 0.85));
      if (nearPier(p.x, p.z, 3) || parasols.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 5)) continue;
      const h = sandHeight(d, w);
      parasols.push({ ...p, y: h, color: rng.pick(PARASOL_COLORS), tilt: rng.range(-0.15, 0.15) });
      colliders.push({ minX: p.x - 0.12, maxX: p.x + 0.12, minZ: p.z - 0.12, maxZ: p.z + 0.12 });
      const side = rng.chance(0.5) ? 1 : -1;
      towels.push({ x: p.x + s.dx * 1.3 * side, z: p.z + s.dz * 1.3 * side, y: h + 0.02, yaw: Math.atan2(s.nx, s.nz) + rng.range(-0.3, 0.3), color: rng.pick(PARASOL_COLORS) });
    }
  }
  group.add(palmMeshes(palms), parasolMeshes(parasols, towels));
  for (const t of towers) group.add(lifeguardTower(t));

  // --- Materials ---
  const sandMesh = new THREE.Mesh(sand.build(), toon({ map: sandTexture(), vertexColors: true }));
  sandMesh.receiveShadow = true;
  const woodMesh = new THREE.Mesh(wood.build(), toon({ map: plankTexture(), vertexColors: true }));
  woodMesh.receiveShadow = woodMesh.castShadow = true;
  const paintMesh = new THREE.Mesh(paint.build(), toon({ vertexColors: true }));
  paintMesh.receiveShadow = true;
  group.add(sandMesh, woodMesh, paintMesh);
  return { group, lamps };
}

/** Flat face through points given geom-CW (as seen from above: front-facing for three.js). */
function flat(qb, pts, color, tileScale = 1) {
  const t = qb.tile / tileScale;
  qb.face(pts, [0, 1, 0], pts.map((p) => [p[0] / t, -p[2] / t]), color);
}

/** A sloping, up-facing quad (points as for `flat`) with a colour per corner. */
function sandFace(qb, pts, colors) {
  const t = qb.tile;
  qb.face(pts, [0, 1, 0], pts.map((p) => [p[0] / t, -p[2] / t]), colors);
}

/** A vertical wall between a and b, from y0 up to y1, facing (nx, nz). */
function wallFacing(qb, a, b, y0, y1, color, nx, nz) {
  const dx = b.x - a.x, dz = b.z - a.z;
  // QuadBuilder.wall faces left of a -> b: (-dz, dx).
  if (-dz * nx + dx * nz >= 0) qb.wall(a.x, a.z, b.x, b.z, y0, y1, color);
  else qb.wall(b.x, b.z, a.x, a.z, y0, y1, color);
}

/** A vertical face from the floor up to a sloping top edge (ha at a, hb at b), facing (nx, nz). */
function sideFace(qb, a, b, ha, hb, nx, nz, color) {
  let [p, q, hp, hq] = [a, b, ha, hb];
  const dx = q.x - p.x, dz = q.z - p.z;
  if (-dz * nx + dx * nz < 0) [p, q, hp, hq] = [b, a, hb, ha];
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  if (len < 1e-3) return;
  const n = [-(q.z - p.z) / len, 0, (q.x - p.x) / len];
  const t = qb.tile;
  qb.face(
    [[p.x, FLOOR, p.z], [q.x, FLOOR, q.z], [q.x, hq, q.z], [p.x, hp, p.z]],
    n,
    [[0, FLOOR / t], [len / t, FLOOR / t], [len / t, hq / t], [0, hp / t]],
    color,
  );
}

/** Oriented box collider: centre, unit long axis (ux, uz), half-length and half-width. */
function boxCollider(cx, cz, ux, uz, hl, hw) {
  const vx = -uz, vz = ux;
  let poly = [
    { x: cx - ux * hl - vx * hw, z: cz - uz * hl - vz * hw },
    { x: cx + ux * hl - vx * hw, z: cz + uz * hl - vz * hw },
    { x: cx + ux * hl + vx * hw, z: cz + uz * hl + vz * hw },
    { x: cx - ux * hl + vx * hw, z: cz - uz * hl + vz * hw },
  ];
  if (signedArea(poly) < 0) poly = poly.reverse();
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), poly };
}

/** Thin collider along a segment. */
function segCollider(a, b, hw) {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  return boxCollider((a.x + b.x) / 2, (a.z + b.z) / 2, (b.x - a.x) / len, (b.z - a.z) / len, len / 2, hw);
}

let railParts = null;
/** White railing (posts and a top rail) from a to b, standing on a deck at height y. */
function railing(group, a, b, y) {
  railParts ??= { mat: toon({ color: 0xf2efe6 }) };
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, len), railParts.mat);
  rail.position.set((a.x + b.x) / 2, y + 1.0, (a.z + b.z) / 2);
  rail.rotation.y = yaw;
  rail.castShadow = true;
  group.add(rail);
  const n = Math.max(2, Math.round(len / 2.5));
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 1.0, 0.1), railParts.mat, n + 1);
  const m = new THREE.Matrix4();
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    posts.setMatrixAt(k, m.makeTranslation(a.x + (b.x - a.x) * t, y + 0.5, a.z + (b.z - a.z) * t));
  }
  group.add(posts);
}

function containerMesh(list) {
  const geo = new THREE.BoxGeometry(6.06, 2.59, 2.44).translate(0, 1.295, 0);
  const mesh = new THREE.InstancedMesh(geo, toon({ map: corrugatedTexture() }), list.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  list.forEach((k, idx) => {
    q.setFromAxisAngle(up, k.yaw);
    m.compose(new THREE.Vector3(k.x, k.y, k.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(idx, m);
    mesh.setColorAt(idx, c.setHex(k.color));
  });
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Palm trees: a leaning, tapering trunk and a crown of drooping fronds. */
function palmMeshes(palms) {
  const g = new THREE.Group();
  if (!palms.length) return g;
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.32, 7, 7).translate(0, 3.5, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, toon({ color: 0x8a6a45 }), palms.length);
  const crown = new THREE.InstancedMesh(frondGeometry(), toon({ color: 0x3f9a3a, side: THREE.DoubleSide }), palms.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  palms.forEach((p, k) => {
    e.set(p.lean, p.turn, 0, 'YXZ');
    q.setFromEuler(e);
    s.setScalar(p.s);
    m.compose(new THREE.Vector3(p.x, SHORE_Y.sandTop - 0.2, p.z), q, s);
    trunk.setMatrixAt(k, m);
    // The crown sits on top of the leaning trunk.
    const top = new THREE.Vector3(0, 7 * p.s, 0).applyQuaternion(q);
    m.compose(new THREE.Vector3(p.x + top.x, SHORE_Y.sandTop - 0.2 + top.y, p.z + top.z), q, s);
    crown.setMatrixAt(k, m);
  });
  trunk.castShadow = crown.castShadow = true;
  g.add(trunk, crown);
  return g;
}

function frondGeometry() {
  const pos = [];
  const idx = [];
  const FRONDS = 7, SEG = 4, L = 3.6;
  for (let f = 0; f < FRONDS; f++) {
    const a = (f / FRONDS) * Math.PI * 2 + (f % 2) * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const base = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const r = t * L, y = 0.5 * t - 1.6 * t * t;
      const w = 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 0.05;
      pos.push(ca * r - sa * w, y, sa * r + ca * w, ca * r + sa * w, y, sa * r - ca * w);
      if (k) {
        const o = base + (k - 1) * 2;
        idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function parasolMeshes(parasols, towels) {
  const g = new THREE.Group();
  if (parasols.length) {
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5).translate(0, 1.2, 0), toon({ color: 0xeeeae0 }), parasols.length);
    const canopy = new THREE.InstancedMesh(new THREE.ConeGeometry(1.7, 0.6, 8).translate(0, 2.4, 0), toon({ color: 0xffffff }), parasols.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    parasols.forEach((p, k) => {
      q.setFromEuler(new THREE.Euler(p.tilt, 0, p.tilt * 0.6));
      m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(k, m);
      canopy.setMatrixAt(k, m);
      canopy.setColorAt(k, c.setHex(p.color));
    });
    pole.castShadow = canopy.castShadow = true;
    g.add(pole, canopy);
  }
  if (towels.length) {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1.9).rotateX(-Math.PI / 2), toon({ color: 0xffffff }), towels.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    towels.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.yaw);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.setHex(t.color));
    });
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

let towerParts = null;
/** A lifeguard hut on stilts, looking out to sea. */
function lifeguardTower({ x, z, yaw }) {
  towerParts ??= {
    leg: new THREE.BoxGeometry(0.18, 2.4, 0.18),
    hut: new THREE.BoxGeometry(2.2, 1.6, 2.2),
    roof: new THREE.BoxGeometry(2.7, 0.2, 2.7),
    deck: new THREE.BoxGeometry(2.8, 0.15, 3.2),
    white: toon({ color: 0xf2efe6 }),
    red: toon({ color: 0xd8473a }),
    blue: toon({ color: 0x2f8fd8 }),
  };
  const t = towerParts;
  const g = new THREE.Group();
  for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const leg = new THREE.Mesh(t.leg, t.white);
    leg.position.set(lx, 1.2, lz);
    g.add(leg);
  }
  const deck = new THREE.Mesh(t.deck, t.white);
  deck.position.set(0, 2.45, 0.3);
  const hut = new THREE.Mesh(t.hut, t.red);
  hut.position.set(0, 3.3, 0);
  const roof = new THREE.Mesh(t.roof, t.blue);
  roof.position.set(0, 4.2, 0);
  g.add(deck, hut, roof);
  g.traverse((o) => (o.castShadow = true));
  g.position.set(x, SHORE_Y.sandTop - 0.1, z);
  g.rotation.y = yaw;
  return g;
}

/** Fine speckled sand (tinted by vertex colour). */
function sandTexture() {
  return canvasTexture(128, (ctx, n) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 2200; k++) {
      const v = Math.random() < 0.5;
      ctx.fillStyle = v ? `rgba(120,90,40,${Math.random() * 0.14})` : `rgba(255,255,255,${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * n, Math.random() * n, 1.5, 1.5);
    }
    // A few ripples left by the wind.
    ctx.strokeStyle = 'rgba(120,90,40,0.08)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 6; k++) {
      const yy = Math.random() * n;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.bezierCurveTo(n * 0.3, yy - 6, n * 0.6, yy + 6, n, yy);
      ctx.stroke();
    }
  });
}

/** Deck planks: warm boards with dark gaps between them. */
function plankTexture() {
  return canvasTexture(64, (ctx, n) => {
    ctx.fillStyle = '#b48a5a';
    ctx.fillRect(0, 0, n, n);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = `rgba(${k % 2 ? 90 : 140},${k % 2 ? 60 : 100},40,0.18)`;
      ctx.fillRect(0, (k * n) / 4, n, n / 4);
      ctx.fillStyle = '#5e4429';
      ctx.fillRect(0, (k * n) / 4, n, 2);
    }
    for (let k = 0; k < 300; k++) {
      ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.1})`;
      ctx.fillRect(Math.random() * n, Math.random() * n, 4, 1);
    }
  });
}

/** Ribbed steel for the containers (tinted per container). */
function corrugatedTexture() {
  return canvasTexture(64, (ctx, n) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x, 0, 3, n);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(x + 4, 0, 1, n);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, n, 3);
    ctx.fillRect(0, n - 3, n, 3);
  });
}
