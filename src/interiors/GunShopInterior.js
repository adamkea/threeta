import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { ColliderGrid } from '../world/ColliderGrid.js';
import { Pedestrian } from '../characters/Pedestrian.js';

// The inside of the Lock & Load gun shop: a set of its own, with its own scene, lights and
// colliders, so while you're in here nothing of the street outside is drawn. The room is centred
// on the origin, the door in the middle of the front (+Z) wall, which is cut away low so the
// overhead camera can see in (the same "doll's house" view the street gets).
//
//   back wall  z = -6   pegboard of rifles, the clerk behind a long glass counter
//   counter    z = -2.6 .. -1.6, wall to wall
//   shop floor z = -1.6 .. 6   gun rack, ammo shelves, the door at x = 0

const W = 8; // half-width
const D = 6; // half-depth
const H = 3.6; // wall height
const T = 0.4; // wall thickness
const DOOR = 1.2; // half-width of the doorway
const COUNTER = { minZ: -2.6, maxZ: -1.6, h: 1.05 };

export function createGunShopInterior() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0a09); // everything outside the room is black
  const colliders = [];
  const mats = new Map();
  const mat = (color) => {
    if (!mats.has(color)) mats.set(color, toon({ color }));
    return mats.get(color);
  };
  const box = (minX, minZ, maxX, maxZ, y0, y1, color, { solid = false, material, shadow = true } = {}) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, y1 - y0, maxZ - minZ), material ?? mat(color));
    mesh.position.set((minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (solid) colliders.push({ minX, maxX, minZ, maxZ });
    return mesh;
  };
  const plane = (x, y, z, w, h, tex, { rotX = 0, rotY = 0, transparent = false } = {}) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), toon({ map: tex, transparent }));
    mesh.rotation.set(rotX, rotY, 0, 'YXZ');
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  // --- Lights: warm shop lighting, one key light for the toon bands and crisp shadows ---
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a4038, 1.6));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.9);
  key.position.set(-6, 16, 9);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.04;
  key.shadow.intensity = 0.6;
  scene.add(key, key.target);

  // --- Shell: floor, walls (front cut away low), doorway ---
  const floor = plane(0, 0, 0, W * 2, D * 2 + T, checkerTexture(W, D), { rotX: -Math.PI / 2 });
  floor.position.z = T / 2;
  const WALL = 0xd9cfb8;
  const SKIRT = 0x5a3e2b;
  box(-W - T, -D - T, W + T, -D, 0, H, WALL, { solid: true });
  box(-W - T, -D, -W, D + T, 0, H, WALL, { solid: true });
  box(W, -D, W + T, D + T, 0, H, WALL, { solid: true });
  for (const [x0, x1] of [[-W - T, -DOOR], [DOOR, W + T]]) box(x0, D, x1, D + T, 0, 0.9, WALL, { solid: true });
  // Skirting boards and a dado rail, to give the walls some structure under the ink lines.
  box(-W, -D, W, -D + 0.08, 0, 0.3, SKIRT);
  box(-W, -D, -W + 0.08, D, 0, 0.3, SKIRT);
  box(W - 0.08, -D, W, D, 0, 0.3, SKIRT);
  // Door posts and a mat with EXIT painted on it, right in the doorway.
  for (const x of [-DOOR - 0.25, DOOR + 0.25]) box(x - 0.25, D - 0.05, x + 0.25, D + T + 0.05, 0, 2.6, 0x26354d, { solid: true });
  plane(0, 0.02, D + T / 2, DOOR * 2, 1.4, exitMatTexture(), { rotX: -Math.PI / 2 });

  // --- Back wall: pegboard of long guns and a neon sign ---
  plane(0, 2.1, -D + 0.02, 12, 2.2, pegboardTexture());
  for (const [y, xs] of [[2.75, [-4.5, 0, 4.5]], [1.75, [-4.5, 0, 4.5]]]) {
    for (const x of xs) scene.add(rifle(x, y, -D + 0.12, mat, y > 2));
  }
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.8), new THREE.MeshBasicMaterial({ map: neonTexture(), transparent: true }));
  neon.position.set(0, 3.35, -D + 0.03);
  scene.add(neon);

  // --- The counter: wooden base, glass display case of handguns, cash register ---
  box(-W, COUNTER.minZ, W, COUNTER.maxZ, 0, 0.62, 0x7a5232, { solid: true });
  box(-W, COUNTER.maxZ - 0.02, W, COUNTER.maxZ + 0.02, 0.05, 0.55, 0x5a3e2b); // kick panel line
  box(-W + 0.1, COUNTER.minZ + 0.1, W - 0.1, COUNTER.maxZ - 0.1, 0.62, 0.64, 0x8c1e22, { shadow: false }); // felt
  for (let x = -6.5; x <= 6.5; x += 1.3) {
    if (Math.abs(x - 3.9) < 0.8) continue; // leave room for the till
    box(x - 0.28, -2.2, x + 0.2, -2.05, 0.64, 0.7, 0x2a2d33, { shadow: false }); // slide
    box(x + 0.08, -2.12, x + 0.2, -1.92, 0.64, 0.69, 0x3a2a20, { shadow: false }); // grip
  }
  const glass = toon({ color: 0xbfe3f0, transparent: true, opacity: 0.35, depthWrite: false });
  box(-W, COUNTER.minZ, W, COUNTER.maxZ, 0.62, COUNTER.h, 0, { material: glass, shadow: false });
  box(-W, COUNTER.minZ, W, COUNTER.minZ + 0.06, 0.62, COUNTER.h + 0.03, 0x7a5232);
  box(-W, COUNTER.maxZ - 0.06, W, COUNTER.maxZ, 0.62, COUNTER.h + 0.03, 0x7a5232);
  box(3.4, -2.4, 4.4, -1.8, COUNTER.h, COUNTER.h + 0.45, 0x3a3d44); // till
  box(3.5, -2.45, 4.3, -2.0, COUNTER.h + 0.45, COUNTER.h + 0.7, 0x2a2d33);

  // --- Shop floor: a standing rack of long guns, ammo shelves, a target on the wall ---
  // Rack island, left of the door.
  box(-6, 1.2, -2.6, 2.4, 0, 0.35, 0x5a3e2b, { solid: true });
  box(-6, 1.7, -2.6, 1.9, 0.35, 1.9, 0x7a5232);
  for (let x = -5.6; x <= -3; x += 0.55) {
    const gun = rifle(0, 0, 0, mat, false);
    gun.rotation.z = -(Math.PI / 2 - 0.12); // stood on its butt, muzzle up, leaning on the rail
    gun.position.set(x, 1.15, 1.55);
    gun.scale.setScalar(0.85);
    scene.add(gun);
  }
  // Ammo shelves along the right wall.
  for (const y of [0.4, 1.1, 1.8]) {
    box(W - 0.9, -0.6, W, 4.4, y - 0.06, y, 0x7a5232, { solid: y === 0.4 });
    for (let z = -0.3; z < 4.2; z += 0.42) {
      const c = [0x3f7a3a, 0xc8141c, 0xd8b45a, 0x3f5f8f][Math.floor((z + y * 7) * 3) % 4];
      box(W - 0.75, z, W - 0.3, z + 0.3, y, y + 0.32, c);
    }
  }
  box(W - 0.95, -0.6, W - 0.85, 4.4, 0, 2.1, 0x5a3e2b); // shelf upright
  // Range target poster and a warning sign on the left wall.
  plane(-W + 0.02, 2.0, 3.2, 1.6, 1.9, targetTexture(), { rotY: Math.PI / 2 });
  plane(-W + 0.02, 1.9, -0.4, 1.8, 0.9, noticeTexture(), { rotY: Math.PI / 2 });

  // --- The clerk, behind the counter ---
  const clerk = new Pedestrian({
    shirt: 0x4f5a3a, inner: 0x2a2d33, pants: 0x3a3026, hair: 0x6b5a48, skin: 0xd09a74,
    glasses: true, belt: 0x2a2d33, hat: { type: 'cap', color: 0xc8141c, trim: 0xf5f1e8 }, scale: 1.08,
  });
  clerk.reset(0, -3.7, 0);
  scene.add(clerk.mesh);

  scene.traverse((o) => o.isMesh && o.material?.transparent && (o.castShadow = false));

  const world = new ColliderGrid(colliders);
  return {
    name: 'Lock & Load',
    scene,
    world,
    /** Where you come in: just inside the door, facing the counter. */
    spawn: { x: 0, z: D - 1.2, heading: Math.PI },
    /** Room centre, for the camera. */
    centre: new THREE.Vector2(0, 0.5),
    /** Standing at the counter in front of the clerk. */
    atCounter: (p) => Math.abs(p.x) < 3.2 && p.y > COUNTER.maxZ && p.y < COUNTER.maxZ + 2.2,
    /** Walked out through the door. */
    leaving: (p) => p.y > D + T * 0.6,
    /** Per-frame: the clerk keeps an eye on you. */
    update(dt, playerPos) {
      const target = Math.atan2(playerPos.x - clerk.position.x, playerPos.y - clerk.position.y);
      const diff = Math.atan2(Math.sin(target - clerk.heading), Math.cos(target - clerk.heading));
      clerk.heading += Math.max(-1, Math.min(1, diff)) * Math.min(1, 3 * dt);
      clerk.syncMesh(dt);
    },
  };
}

/** A long gun lying along X, muzzle at -X: wooden stock and fore-end, dark metal. */
function rifle(x, y, z, mat, scoped) {
  const g = new THREE.Group();
  const part = (w, h, d, px, py, color) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
  };
  part(0.7, 0.16, 0.07, 0.75, -0.04, 0x7a4a2a); // stock
  part(0.6, 0.12, 0.08, 0.15, 0, 0x2a2d33); // receiver
  part(0.3, 0.07, 0.07, 0.25, -0.12, 0x2a2d33); // grip / mag
  part(0.5, 0.09, 0.07, -0.35, -0.01, 0x7a4a2a); // fore-end
  part(0.55, 0.035, 0.035, -0.85, 0.02, 0x1a1c20); // barrel
  if (scoped) part(0.36, 0.07, 0.07, 0.12, 0.12, 0x1a1c20);
  g.position.set(x, y, z);
  return g;
}

// --- Painted textures ---

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Black-and-cream linoleum checks, 1m squares. */
function checkerTexture(hw, hd) {
  const tex = canvasTex(32, 32, (ctx) => {
    ctx.fillStyle = '#e9e1cc';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#3a3d44';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
  });
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(hw, hd + 0.2);
  return tex;
}

function pegboardTexture() {
  const tex = canvasTex(128, 24, (ctx, w, h) => {
    ctx.fillStyle = '#c9a877';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(60,40,20,0.45)';
    for (let x = 4; x < w; x += 8) for (let y = 4; y < h; y += 8) ctx.fillRect(x, y, 2, 2);
    ctx.strokeStyle = '#5a3e2b';
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  });
  return tex;
}

function neonTexture() {
  return canvasTex(256, 48, (ctx, w, h) => {
    ctx.font = 'bold italic 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff3a2a';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ff5a4a';
    ctx.fillText('GUNS • AMMO', w / 2, h / 2 + 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd0c8';
    ctx.fillText('GUNS • AMMO', w / 2, h / 2 + 2);
  });
}

function exitMatTexture() {
  return canvasTex(128, 80, (ctx, w, h) => {
    ctx.fillStyle = '#8c1e22';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#f2c230';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EXIT', w / 2, h / 2 + 2);
  });
}

function targetTexture() {
  return canvasTex(96, 112, (ctx, w, h) => {
    ctx.fillStyle = '#f5f1e8';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#14110f';
    // Silhouette target: head and shoulders.
    ctx.beginPath();
    ctx.arc(w / 2, 34, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(14, h - 6), ctx.quadraticCurveTo(w / 2, 32, w - 14, h - 6);
    ctx.fill();
    ctx.strokeStyle = '#f5f1e8';
    ctx.lineWidth = 2;
    for (const r of [8, 16, 24]) {
      ctx.beginPath();
      ctx.arc(w / 2, 80, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#c8141c';
    for (const [x, y] of [[48, 80], [53, 76], [44, 85], [49, 34]]) ctx.fillRect(x - 2, y - 2, 4, 4);
  });
}

function noticeTexture() {
  return canvasTex(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f2c230';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#14110f';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = '#14110f';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('NO REFUNDS', w / 2, 27);
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('CASH ONLY', w / 2, 47);
  });
}
