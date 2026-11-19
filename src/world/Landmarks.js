import * as THREE from 'three';
import { toon } from '../render/toon.js';

// Special buildings that take up a whole block: the police station (where you're taken when
// you're busted) and the hospital (where you wake up after you die). Each one stands at the
// back of its block with its front facing +Z (towards the camera, so the facade and signs
// show), leaving a paved forecourt between the entrance and the street. Big roof markings
// make them easy to spot from the overhead camera.
//
// All coordinates below are block-local: (0, 0) is the block centre, y = 0 is the sidewalk.

/** Which blocks hold which landmark (block indices, 0..CITY.blocks-1). */
export const LANDMARK_BLOCKS = [
  { kind: 'police', bx: 2, bz: 4 },
  { kind: 'hospital', bx: 5, bz: 2 },
];

/**
 * Builds one landmark centred on (cx, cz) with its ground floor at height y0.
 * Adds its solid parts to `colliders` and returns { kind, name, group, respawn, footprint, color }.
 * `respawn` is where the player reappears: { x, z, heading }, outside the front door.
 */
export function createLandmark(kind, cx, cz, y0, { colliders, windowTex }) {
  const b = new Builder(cx, cz, colliders, windowTex);
  const spec = kind === 'police' ? policeStation(b) : hospital(b);
  b.group.position.set(cx, y0, cz);
  const [minX, minZ, maxX, maxZ] = spec.footprint;
  return {
    kind,
    name: spec.name,
    group: b.group,
    respawn: { x: cx + spec.respawn[0], z: cz + spec.respawn[1], heading: 0 },
    footprint: { minX: cx + minX, maxX: cx + maxX, minZ: cz + minZ, maxZ: cz + maxZ, height: spec.height },
    color: spec.color,
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

/** Accumulates a landmark's meshes in a group, and its solid parts as world-space colliders. */
class Builder {
  constructor(cx, cz, colliders, windowTex) {
    this.group = new THREE.Group();
    this.cx = cx;
    this.cz = cz;
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

  solid(minX, minZ, maxX, maxZ) {
    const { cx, cz } = this;
    this.colliders.push({ minX: cx + minX, maxX: cx + maxX, minZ: cz + minZ, maxZ: cz + maxZ });
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

/** Roof marking: a rounded panel with a star badge and the station's name. */
function roofBadge(text, bg, fg) {
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
    star(ctx, 120, h / 2, 74);
    ctx.fillStyle = fg;
    ctx.font = 'bold 84px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 320, h / 2 + 4);
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

function hatchedBay() {
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
    ctx.fillText('AMBULANCE', w / 2, h - 16);
  });
}
