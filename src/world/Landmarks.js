import * as THREE from 'three';
import { toon } from '../render/toon.js';

// Special buildings that take up a whole block: the police station (where you're taken when
// you're busted), the hospital (where you wake up after you die) and the gun shop (which you can
// walk into: see interiors/Shops.js). Each one stands at the
// back of its block with its front facing +Z (towards the camera, so the facade and signs
// show), leaving a paved forecourt between the entrance and the street. Big roof markings
// make them easy to spot from the overhead camera.
//
// All coordinates below are block-local: (0, 0) is the block centre, y = 0 is the sidewalk.

// Which blocks hold them is decided in CityLayout.js (assignUses).

const BUILDERS = { police: policeStation, hospital, gunshop: gunShop, warehouse };

/**
 * Builds one landmark centred on (cx, cz) with its ground floor at height y0.
 * Adds its solid parts to `colliders` and returns { kind, name, group, respawn, footprint, color,
 * buildings, entrance }. `respawn` is where the player reappears: { x, z, heading }, outside the
 * front door. `buildings` are any extra footprints on the block (for the map). `entrance`, for
 * buildings you can walk into, is the spot on the pavement in front of the door: { x, z, heading },
 * heading pointing out of the door.
 */
export function createLandmark(kind, cx, cz, y0, { colliders, windowTex, angle = 0, name }) {
  const b = new Builder(cx, cz, angle, colliders, windowTex);
  const spec = BUILDERS[kind](b, { name });
  b.group.position.set(cx, y0, cz);
  b.group.rotation.y = angle;
  const [minX, minZ, maxX, maxZ] = spec.footprint;
  const poly = b.toWorldRect(minX, minZ, maxX, maxZ);
  const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
  const door = b.toWorld(spec.respawn[0], spec.respawn[1]);
  const bounds = (poly) => {
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), poly };
  };
  const entrance = spec.entrance && b.toWorld(spec.entrance[0], spec.entrance[1]);
  return {
    kind,
    name: spec.name,
    group: b.group,
    respawn: { x: door.x, z: door.z, heading: angle },
    footprint: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), poly, height: spec.height },
    color: spec.color,
    buildings: (spec.buildings ?? []).map(({ rect, height, color }) => ({ ...bounds(b.toWorldRect(...rect)), height, color })),
    entrance: entrance ? { x: entrance.x, z: entrance.z, heading: angle } : null,
    dropZone: spec.dropZone ? { ...b.toWorld(spec.dropZone.x, spec.dropZone.z), heading: angle, hw: spec.dropZone.hw, hd: spec.dropZone.hd } : null,
  };
}

function policeStation(b) {
  const BLUE = 0x3f5f8f;
  const WHITE = 0xe9e4da;
  const H = 9; // three storeys

  // Main building: police blue with a white cornice round the roof.
  b.facade(-15, -15, 15, 3, 0, H, BLUE, { solid: true });
  b.box(-15.3, -15.3, 15.3, 3.3, H, H + 0.6, WHITE);
  b.decal(0, -6, 22, 11, roofBadge('POLICE', '#22385c', '#ffffff'), H + 0.61);

  // Radio mast on the roof.
  b.cylinder(11, -11, 0.12, H + 0.6, H + 9, 0x8c9096);
  b.box(10.4, -11.6, 11.6, -10.4, H + 0.6, H + 1.4, 0xb8bcc2);

  // Entrance: white portico with the sign above it, glass doors, steps, blue lamps either side.
  b.box(-5, 3, 5, 6, 0, 4, WHITE, { solid: true });
  b.box(-2, 6, 2, 6.15, 0, 3, 0x1d2a3d);
  b.sign(-6.5, 5.6, 6.5, 6.3, 4, 5.8, signFace('POLICE', '#22385c', '#ffffff'));
  b.box(-5.5, 6, 5.5, 7.2, 0, 0.15, 0xc9c6bd);
  for (const x of [-4.2, 4.2]) {
    b.cylinder(x, 7.6, 0.1, 0, 2.2, 0x2a2d33, { solid: true });
    b.lamp(x, 7.6, 2.45, 0.35, 0x3a7bff);
  }

  // Flagpole out front.
  b.cylinder(-11, 13, 0.1, 0, 9, 0xd9d9d9, { solid: true });
  b.flag(-11, 13, 8.8, 0x22385c);

  return { name: 'Police Station', footprint: [-15.3, -15.3, 15.3, 3.3], height: H, color: BLUE, respawn: [0, 9.5] };
}

function hospital(b) {
  const WHITE = 0xeef0ec;
  const RED = 0xd23a2f;
  const H = 15; // five storeys

  // Main block: clean white with a grey lip round the roof.
  b.facade(-16, -16, 16, 1, 0, H, WHITE, { solid: true });
  b.box(-16.3, -16.3, 16.3, 1.3, H, H + 0.5, 0xb8bcc2);
  // Rooftop helipad and a big red cross.
  b.decal(-7, -7.5, 13, 13, helipad(), H + 0.51);
  b.decal(8.5, -7.5, 10, 10, redCross(true), H + 0.51);

  // Name board high on the front, glass doors at street level.
  b.sign(-9, 1, 9, 1.4, 11.2, 13.6, signFace('HOSPITAL', '#ffffff', '#d23a2f', true));
  b.box(-3.5, 1, 3.5, 1.15, 0, 3, 0x2b4a66);

  // Emergency entrance canopy on two pillars, with a red fascia.
  b.box(-8, 1.3, 8, 8, 3.6, 4, WHITE);
  b.sign(-8, 7.7, 8, 8.2, 3.1, 4.1, signFace('EMERGENCY', '#d23a2f', '#ffffff'));
  for (const x of [-7.3, 7.3]) b.cylinder(x, 7.3, 0.3, 0, 3.6, WHITE, { solid: true });

  // Ambulance bay: a hatched box painted on the forecourt beside the canopy.
  b.decal(12, 9, 5, 9, hatchedBay(), 0.02);

  return { name: 'Hospital', footprint: [-16.3, -16.3, 16.3, 1.3], height: H, color: WHITE, respawn: [0, 11] };
}

/**
 * A gun shop in a row of ordinary buildings: a squat two-storey storefront with display windows,
 * a striped awning and a big sign, and a glowing marker on the pavement at its door. The
 * interior is a separate set (see interiors/GunShopInterior.js) that you're taken into.
 */
function gunShop(b) {
  const SHOP = 0x2f4a3a; // dark gunmetal green
  const TRIM = 0xd8b45a;
  const BRICK = 0xb2473a;
  const SAND = 0xd9d1bf;
  const H = 6.4;

  // Neighbours: a tall block behind, lower ones either side, so the shop sits in a terrace.
  b.facade(-17, -17, 17, -5, 0, 15, SAND, { solid: true });
  b.box(-17.2, -17.2, 17.2, -4.8, 15, 15.6, 0x9d968a);
  b.facade(-17, -5, -9.2, 11, 0, 9, BRICK, { solid: true });
  b.box(-17.2, -5, -9, 11.2, 9, 9.5, 0x8c3a30);
  b.facade(9.2, -5, 17, 11, 0, 12, 0x7f9fb6, { solid: true });
  b.box(9, -5, 17.2, 11.2, 12, 12.5, 0x66808f);

  // The shop: plain ground floor (it's all shopfront), windows upstairs, a gold cornice.
  b.box(-9, -5, 9, 9, 0, 3.4, SHOP, { solid: true });
  b.facade(-9, -5, 9, 9, 3.4, H, SHOP);
  b.box(-9.2, -5.2, 9.2, 9.2, H, H + 0.4, 0x5a5c60); // flat roof
  b.box(-9.3, 9, 9.3, 9.35, H - 0.4, H + 0.55, TRIM); // gold cornice along the front
  b.decal(0, 2, 11, 11, crosshairBadge(), H + 0.41);

  // Shopfront: dark display windows either side of a glass door in a gold frame.
  for (const [x0, x1] of [[-8, -2], [2, 8]]) {
    b.box(x0, 9, x1, 9.12, 0.6, 2.9, 0x26354d);
    b.box(x0 - 0.15, 9, x1 + 0.15, 9.2, 0.45, 0.6, TRIM);
  }
  b.box(-1.5, 9, 1.5, 9.2, 0, 2.9, TRIM);
  b.box(-1.1, 9.1, 1.1, 9.25, 0, 2.6, 0x1d2a3d);
  // Window lettering, standing just proud of the glass.
  b.sign(-7.6, 9.12, -2.4, 9.16, 1.3, 2.2, signFace('AMMO', '#26354d', '#f2c230'));
  b.sign(2.4, 9.12, 7.6, 9.16, 1.3, 2.2, signFace('ARMS', '#26354d', '#f2c230'));

  // Striped awning over the whole front, the shop sign above it.
  b.box(-9, 9, 9, 10.6, 3.0, 3.35, 0, { material: b.awning() });
  b.sign(-7.5, 9, 7.5, 9.5, 3.7, 5.9, signFace('LOCK & LOAD', '#c8141c', '#ffffff'));

  // Door marker: a glowing ring on the pavement with an arrow bobbing over it (animated by Shops).
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.8, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.85 }),
  );
  ring.position.y = 0.03;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd23a }));
  arrow.position.y = 2.4;
  marker.add(ring, arrow);
  marker.userData.arrow = arrow;
  marker.name = 'doorMarker';
  b.add(marker, 0, 0, 11.6);
  marker.traverse((o) => (o.castShadow = o.receiveShadow = false));

  return {
    name: 'Lock & Load',
    footprint: [-9.2, -5.2, 9.2, 9.2],
    height: H,
    color: SHOP,
    respawn: [0, 12],
    entrance: [0, 11.6],
    buildings: [
      { rect: [-17, -17, 17, -5], height: 15, color: SAND },
      { rect: [-17, -5, -9.2, 11], height: 9, color: BRICK },
      { rect: [9.2, -5, 17, 11], height: 12, color: 0x7f9fb6 },
    ],
  };
}

/**
 * A freight warehouse: a long corrugated shed across the back of the block with roller doors and
 * a loading dock, and a yard out front with pallets, crates and a painted drop-off bay. Delivery
 * missions end in the bay (see missions/MissionSystem.js, which lights it up while it's wanted).
 */
function warehouse(b, { name = 'Warehouse' } = {}) {
  const SHED = 0x8d9298; // galvanised steel
  const ROOF = 0x6a6f75;
  const TRIM = 0xe0a526; // safety yellow
  const DOOR = 0x4d5660;
  const H = 8;

  // The shed, with its own lip of roof and a sign board on the front.
  b.box(-17, -17, 17, -1, 0, H, SHED, { solid: true, material: b.corrugated(SHED) });
  b.box(-17.4, -17.4, 17.4, -0.6, H, H + 0.5, ROOF);
  b.decal(0, -9, 26, 12, roofBadge(name.split(' ')[0].toUpperCase(), '#3b4148', '#e0a526', false), H + 0.51);
  b.sign(-8, -1, 8, -0.6, H - 2.4, H - 0.4, signFace(name.toUpperCase(), '#1d2228', '#e0a526'));

  // Three roller doors on a raised loading dock with yellow bumpers.
  for (const x of [-11, 0, 11]) {
    b.box(x - 3.4, -1, x + 3.4, -0.8, 0, 4.6, DOOR, { material: b.rollerDoor() });
    b.box(x - 3.6, -0.8, x + 3.6, -0.6, 4.6, 4.9, TRIM);
  }
  b.box(-16, -1, 16, 0.6, 0, 1.0, 0x5d5a55, { solid: true }); // dock
  for (const x of [-14.5, -7.5, -3.5, 3.5, 7.5, 14.5]) b.box(x - 0.3, 0.6, x + 0.3, 0.8, 0.3, 0.9, 0x1c1c1e);

  // Yard clutter down both sides, out of the way of the drop-off bay.
  const pallet = (x, z, h) => {
    b.box(x - 0.6, z - 0.6, x + 0.6, z + 0.6, 0, 0.15, 0xa8834f, { solid: true });
    if (h) b.box(x - 0.55, z - 0.55, x + 0.55, z + 0.55, 0.15, 0.15 + h, 0xc49a5c);
  };
  for (const [x, z, h] of [[-15, 3, 1.1], [-15, 4.6, 0.7], [-13.4, 3, 1.4], [-15, 7, 0], [14.8, 3.2, 1.2], [14.8, 4.8, 1.2], [13.2, 3.2, 0.6], [14.8, 9, 0]]) pallet(x, z, h);
  b.box(-16, 9, -13.6, 15, 0, 2.6, 0x2d6b8f, { solid: true }); // a shipping container in the corner
  b.box(-16.05, 8.95, -13.55, 9.05, 0.1, 2.5, 0x24566f);
  // Bollards with yellow tops either side of the yard mouth.
  for (const x of [-11, 11]) {
    b.cylinder(x, 17, 0.18, 0, 1, 0x2a2d33, { solid: true });
    b.cylinder(x, 17, 0.2, 1, 1.15, TRIM);
  }

  // The drop-off bay: hatched yellow box painted on the yard.
  b.decal(0, 8, 8, 9, hatchedBay('DROP OFF'), 0.02);

  return {
    name,
    footprint: [-17.4, -17.4, 17.4, -0.6],
    height: H,
    color: SHED,
    respawn: [0, 14],
    dropZone: { x: 0, z: 8, hw: 4, hd: 4.5 },
  };
}

/** Accumulates a landmark's meshes in a group, and its solid parts as world-space colliders. */
class Builder {
  constructor(cx, cz, angle, colliders, windowTex) {
    this.group = new THREE.Group();
    this.cx = cx;
    this.cz = cz;
    // The group is turned by `angle` about Y: block-local (x, z) maps to world as below.
    this.cos = Math.cos(angle);
    this.sin = Math.sin(angle);
    this.colliders = colliders;
    this.windowTex = windowTex;
    this.mats = new Map();
  }

  mat(color) {
    if (!this.mats.has(color)) this.mats.set(color, toon({ color }));
    return this.mats.get(color);
  }

  add(mesh, x, y, z) {
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Block-local point -> world. */
  toWorld(x, z) {
    return { x: this.cx + x * this.cos + z * this.sin, z: this.cz - x * this.sin + z * this.cos };
  }

  /** Block-local rectangle -> world polygon (CCW, see geom.js). */
  toWorldRect(minX, minZ, maxX, maxZ) {
    return [this.toWorld(minX, minZ), this.toWorld(maxX, minZ), this.toWorld(maxX, maxZ), this.toWorld(minX, maxZ)];
  }

  solid(minX, minZ, maxX, maxZ) {
    const poly = this.toWorldRect(minX, minZ, maxX, maxZ);
    const xs = poly.map((p) => p.x), zs = poly.map((p) => p.z);
    const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    // Turned at all? Then it's a polygon collider; the box is just its bounds.
    this.colliders.push(Math.abs(this.sin) > 1e-3 ? { ...box, poly } : box);
  }

  box(minX, minZ, maxX, maxZ, y0, y1, color, { solid = false, material } = {}) {
    const geo = new THREE.BoxGeometry(maxX - minX, y1 - y0, maxZ - minZ);
    if (solid) this.solid(minX, minZ, maxX, maxZ);
    return this.add(new THREE.Mesh(geo, material ?? this.mat(color)), (minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2);
  }

  /** A building block with the city's window facade tiled over its walls (3m tiles) and a flat roof. */
  facade(minX, minZ, maxX, maxZ, y0, y1, color, opts) {
    const w = maxX - minX, h = y1 - y0, d = maxZ - minZ;
    const wall = toon({ map: this.windowTex, color });
    const roof = this.mat(0x7d7a78);
    const mesh = this.box(minX, minZ, maxX, maxZ, y0, y1, color, { ...opts, material: [wall, wall, roof, roof, wall, wall] });
    // BoxGeometry faces: +X, -X (depth x height), +Y, -Y (width x depth), +Z, -Z (width x height).
    const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const uv = mesh.geometry.attributes.uv;
    for (let f = 0; f < 6; f++) {
      for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, (uv.getX(i) * sizes[f][0]) / 3, (uv.getY(i) * sizes[f][1]) / 3);
    }
    return mesh;
  }

  /** Red-and-white candy-stripe awning material (stripes run front to back). */
  awning() {
    const tex = labelTexture(256, 32, (ctx, w, h) => {
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? '#f5f1e8' : '#c8141c';
        ctx.fillRect((i * w) / 16, 0, w / 16, h);
      }
    });
    return toon({ map: tex });
  }

  /** Ribbed sheet-metal wall material. */
  corrugated(color) {
    const tex = labelTexture(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.fillRect((i * w) / 8, 0, w / 16, h);
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(8, 2);
    const side = toon({ map: tex, color });
    const top = this.mat(0x6a6f75);
    return [side, side, top, top, side, side];
  }

  /** Slatted roller-shutter material. */
  rollerDoor() {
    const tex = labelTexture(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#9aa3ad';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5d6670';
      for (let y = 0; y < h; y += 8) ctx.fillRect(0, y, w, 2);
    });
    return toon({ map: tex });
  }

  /** A sign board: `face` texture on its front (+Z) side, plain backing elsewhere. */
  sign(minX, minZ, maxX, maxZ, y0, y1, face) {
    const back = this.mat(0x2a2d33);
    const front = toon({ map: face });
    return this.box(minX, minZ, maxX, maxZ, y0, y1, 0, { material: [back, back, back, back, front, back] });
  }

  /** Flat painted marking lying on a roof or on the ground at height y, top of the texture to the north. */
  decal(x, z, w, d, tex, y) {
    const geo = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2);
    const mesh = this.add(new THREE.Mesh(geo, toon({ map: tex, transparent: true })), x, y, z);
    mesh.castShadow = false;
    return mesh;
  }

  cylinder(x, z, r, y0, y1, color, { solid = false } = {}) {
    if (solid) this.solid(x - r - 0.05, z - r - 0.05, x + r + 0.05, z + r + 0.05);
    return this.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 10), this.mat(color)), x, (y0 + y1) / 2, z);
  }

  /** Glowing globe lamp (unlit material, so it reads as lit up). */
  lamp(x, z, y, r, color) {
    const mesh = this.add(new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color })), x, y, z);
    mesh.castShadow = false;
    return mesh;
  }

  flag(x, z, top, color) {
    const tex = labelTexture(128, 80, (ctx, w, h) => {
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      star(ctx, w / 2, h / 2, h * 0.32);
    });
    const mat = toon({ map: tex, side: THREE.DoubleSide });
    this.add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5), mat), x + 1.25, top - 0.75, z);
  }
}

// --- Painted textures ---

function labelTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function cross(ctx, x, y, size, color) {
  const t = size / 3;
  ctx.fillStyle = color;
  ctx.fillRect(x - t / 2, y - size / 2, t, size);
  ctx.fillRect(x - size / 2, y - t / 2, size, t);
}

/** Lettering on a board (with an optional red cross before the text). */
function signFace(text, bg, fg, withCross = false) {
  return labelTexture(512, 96, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = fg;
    ctx.font = 'bold 58px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tx = withCross ? w / 2 + 34 : w / 2;
    ctx.fillText(text, tx, h / 2 + 3);
    if (withCross) cross(ctx, tx - ctx.measureText(text).width / 2 - 44, h / 2, 54, '#d23a2f');
  });
}

/** Roof marking: a rounded panel with (optionally) a star badge and the building's name. */
function roofBadge(text, bg, fg, withStar = true) {
  return labelTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.strokeStyle = fg;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(22, 22, w - 44, h - 44, 18);
    ctx.stroke();
    ctx.fillStyle = '#f2c230';
    if (withStar) star(ctx, 120, h / 2, 74);
    ctx.fillStyle = fg;
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, withStar ? 320 : w / 2, h / 2 + 4, withStar ? 300 : w - 70);
  });
}

/** Roof marking for the gun shop: a gold crosshair in a dark disc. */
function crosshairBadge() {
  return labelTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#26354d';
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 14;
    for (const r of [c - 30, c * 0.35]) {
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(c, 14), ctx.lineTo(c, c - 18);
    ctx.moveTo(c, c + 18), ctx.lineTo(c, w - 14);
    ctx.moveTo(14, c), ctx.lineTo(c - 18, c);
    ctx.moveTo(c + 18, c), ctx.lineTo(w - 14, c);
    ctx.stroke();
  });
}

function helipad() {
  return labelTexture(256, 256, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = '#3d4046';
    ctx.beginPath();
    ctx.arc(c, c, c - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(c, c, c - 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 150px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', c, c + 8);
  });
}

function redCross(onWhite) {
  return labelTexture(256, 256, (ctx, w) => {
    if (onWhite) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, w);
    }
    cross(ctx, w / 2, w / 2, w * 0.78, '#d23a2f');
  });
}

function hatchedBay(label = 'AMBULANCE') {
  return labelTexture(128, 224, (ctx, w, h) => {
    ctx.strokeStyle = '#f2c230';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.save();
    ctx.beginPath();
    ctx.rect(4, 4, w - 8, h - 8);
    ctx.clip();
    ctx.lineWidth = 6;
    for (let y = -w; y < h + w; y += 26) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + w);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#f2c230';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, w / 2, h - 16, w - 20);
  });
}
