import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon } from '../render/toon.js';

/*
 * Car body styles. Cabin numbers are fractions of the car's length, measured along +Z (forward):
 *   rear      where the rear window meets the body
 *   roofRear  back edge of the roof
 *   roofFront front edge of the roof
 *   front     where the windscreen meets the hood
 * `top` is the roof height above the body origin.
 */
const GENERAL = [0xf4f4f0, 0x24272e, 0x2f6fd0, 0x4caa3c, 0xd62b2b, 0xb7c0ca, 0x18a6a0, 0xf27a1a, 0x8a3fc4, 0x7a2430];

export const MODELS = {
  sedan: {
    cfg: { length: 4.4, width: 2.0 },
    cabin: { rear: -0.33, roofRear: -0.24, roofFront: 0.08, front: 0.22, top: 1.1, width: 0.8 },
    bPillar: true,
    paints: GENERAL,
    stripeChance: 0.1,
  },
  hatch: {
    cfg: { length: 3.9, width: 1.9, maxSpeed: 31 },
    cabin: { rear: -0.45, roofRear: -0.39, roofFront: 0.05, front: 0.2, top: 1.12, width: 0.82 },
    nose: 0.82,
    paints: [0xd62b2b, 0x2f6fd0, 0x9bd43a, 0xf4f4f0, 0xffc414, 0x18a6a0, 0xe86aa6],
    stripeChance: 0.15,
  },
  sports: {
    cfg: { length: 4.5, width: 2.05, maxSpeed: 38, engineAccel: 24 },
    cabin: { rear: -0.28, roofRear: -0.17, roofFront: 0.03, front: 0.18, top: 0.98, width: 0.76 },
    bodyH: 0.56,
    nose: 0.74,
    spoiler: true,
    scoop: true,
    paints: [0xe0281e, 0xffc414, 0xf27a1a, 0x2f6fd0, 0x111216, 0xf4f4f0],
    stripeChance: 0.6,
  },
  // Compact European hatchback: short overhangs, long flat roof ending in a roof spoiler over an
  // upright tailgate, thick C-pillars, and a slim black grille band joining the headlights.
  golf: {
    cfg: { length: 4.25, width: 1.95, maxSpeed: 36, engineAccel: 22 },
    cabin: { rear: -0.445, roofRear: -0.39, roofFront: 0.03, front: 0.23, top: 1.08, width: 0.83 },
    lamp: [0.5, 0.11], // slim, wide headlights
    bPillar: true,
    cPillar: 0.13, // painted C-pillar reaching this far (fraction of length) forward of the roof's rear edge
    roofSpoiler: true,
    grilleBand: true,
    nose: 0.86,
    tail: 0.92,
    paints: [0xa8aeb6, 0xf4f4f0, 0x3a3e45, 0x2f5fa8, 0xc62a2a, 0x17181c],
  },
  van: {
    cfg: { length: 5.0, width: 2.2, maxSpeed: 28, engineAccel: 15 },
    cabin: { rear: -0.49, roofRear: -0.49, roofFront: 0.2, front: 0.3, top: 2.05, width: 0.94 },
    paintedCabin: true, // panel van: only the cab has windows
    wheelR: 0.44,
    wheelZ: 0.33,
    nose: 0.9,
    tail: 0.98,
    paints: [0xf4f4f0, 0xb7c0ca, 0x2a4b7c, 0x6b4a32, 0x3f6b3a, 0xd9c79a],
  },
  pickup: {
    cfg: { length: 4.9, width: 2.1, maxSpeed: 31 },
    cabin: { rear: -0.07, roofRear: -0.05, roofFront: 0.12, front: 0.22, top: 1.35, width: 0.86 },
    bed: true,
    wheelR: 0.46,
    wheelZ: 0.33,
    nose: 0.88,
    tail: 0.96,
    paints: [0xb3261e, 0x2a4b7c, 0x3f6b3a, 0xc9a66b, 0x24272e, 0xf4f4f0],
  },
  taxi: {
    cfg: { length: 4.4, width: 2.0 },
    cabin: { rear: -0.33, roofRear: -0.24, roofFront: 0.08, front: 0.22, top: 1.1, width: 0.8 },
    bPillar: true,
    taxiSign: true,
    paints: [0xffc414],
  },
  police: {
    cfg: { length: 4.5, width: 2.0, maxSpeed: 36 },
    cabin: { rear: -0.33, roofRear: -0.24, roofFront: 0.08, front: 0.22, top: 1.1, width: 0.8 },
    bPillar: true,
    lightbar: true,
    roofColor: 0xf4f4f0, // black-and-white livery
    paints: [0x17181c],
  },
};

/** Weighted pick for traffic. */
const TRAFFIC_MIX = [
  ['sedan', 30],
  ['hatch', 22],
  ['taxi', 12],
  ['van', 12],
  ['pickup', 12],
  ['sports', 8],
  ['golf', 10],
  ['police', 4],
];
export function randomModel(rng) {
  let r = rng.range(0, TRAFFIC_MIX.reduce((s, [, w]) => s + w, 0));
  for (const [name, w] of TRAFFIC_MIX) if ((r -= w) < 0) return name;
  return 'sedan';
}

// ---------------------------------------------------------------------------------------------
// Geometry (cached per model: every car of a style shares it)
// ---------------------------------------------------------------------------------------------

const cache = new Map();

/** Lower body: rounded, tapered plan outline extruded up and bevelled. */
function bodyGeometry(L, W, H, noseK, tailK) {
  const b = 0.12;
  const hl = L / 2 - b;
  const hw = W / 2 - b;
  const nose = hw * noseK, tail = hw * tailK, r = 0.45;
  const s = new THREE.Shape(); // drawn in (x, -z)
  s.moveTo(-nose + r, -hl);
  s.lineTo(nose - r, -hl);
  s.quadraticCurveTo(nose, -hl, nose + 0.05, -hl + r);
  s.quadraticCurveTo(hw, -hl * 0.55, hw, -hl * 0.3);
  s.quadraticCurveTo(hw - 0.06, 0, hw, hl * 0.4);
  s.lineTo(tail + 0.05, hl - r);
  s.quadraticCurveTo(tail, hl, tail - r, hl);
  s.lineTo(-tail + r, hl);
  s.quadraticCurveTo(-tail, hl, -tail - 0.05, hl - r);
  s.lineTo(-hw, hl * 0.4);
  s.quadraticCurveTo(-hw + 0.06, 0, -hw, -hl * 0.3);
  s.quadraticCurveTo(-hw, -hl * 0.55, -nose - 0.05, -hl + r);
  s.quadraticCurveTo(-nose, -hl, -nose + r, -hl);
  const depth = H - 2 * b;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 8 });
  g.rotateX(-Math.PI / 2).translate(0, -depth / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Cabin: side profile extruded across the car with soft edges. */
function cabinGeometry(pts, width) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (const [z, y] of pts.slice(1)) shape.lineTo(z, y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 1,
  });
  return g.translate(0, 0, -width / 2).rotateY(-Math.PI / 2); // profile x -> car z
}

function geometryFor(name, m) {
  if (cache.has(name)) return cache.get(name);
  const { length: L, width: W } = m.cfg;
  const H = m.bodyH ?? 0.62;
  const T = H - 0.01; // body top (body-group space)
  const c = m.cabin;
  const base = T - 0.03;
  const pts = [
    [c.rear * L, base],
    [c.roofRear * L, c.top],
    [c.roofFront * L, c.top],
    [c.front * L, base],
  ];
  const cabinW = W * c.width;
  const R = m.wheelR ?? 0.4;
  const g = {
    body: bodyGeometry(L, W, H, m.nose ?? 0.8, m.tail ?? 0.9),
    cabin: cabinGeometry(pts, cabinW),
    roof: new RoundedBoxGeometry(cabinW + 0.12, 0.1, (c.roofFront - c.roofRear) * L + 0.12, 2, 0.05),
    bumper: new RoundedBoxGeometry(W * 0.96, 0.22, 0.3, 2, 0.1),
    lamp: new RoundedBoxGeometry(...(m.lamp ?? [0.42, 0.16]), 0.08, 2, 0.04),
    mirror: new RoundedBoxGeometry(0.22, 0.14, 0.12, 2, 0.05),
    tyre: new THREE.CylinderGeometry(R, R, 0.34, 20).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.36, 14).rotateZ(Math.PI / 2),
    hubcap: new THREE.CylinderGeometry(R * 0.22, R * 0.22, 0.38, 8).rotateZ(Math.PI / 2),
    spoke: new THREE.BoxGeometry(0.37, R * 1.1, 0.07),
  };
  for (const v of Object.values(g)) v.userData.shared = true;
  const info = { g, L, W, H, T, base, pts, cabinW, R };
  cache.set(name, info);
  return info;
}

// Shared textures / materials (never disposed: flagged as shared below).
let shared = null;
function sharedAssets() {
  if (shared) return shared;
  const blob = document.createElement('canvas');
  blob.width = blob.height = 64;
  const ctx = blob.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const sign = document.createElement('canvas');
  sign.width = 128;
  sign.height = 32;
  const s = sign.getContext('2d');
  s.fillStyle = '#ffe680';
  s.fillRect(0, 0, 128, 32);
  s.fillStyle = '#14110f';
  s.font = 'bold 24px sans-serif';
  s.textAlign = 'center';
  s.textBaseline = 'middle';
  s.fillText('TAXI', 64, 17);
  const signTex = new THREE.CanvasTexture(sign);
  signTex.colorSpace = THREE.SRGBColorSpace;

  shared = {
    blob: new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }),
    dark: toon({ color: 0x1c1f26 }),
    glass: toon({ color: 0x1d2a3d }),
    glint: new THREE.MeshBasicMaterial({ color: 0x9cc4e8 }),
    grille: toon({ color: 0x0e0f12 }),
    plate: toon({ color: 0xf2efe4 }),
    tyre: toon({ color: 0x15161a }),
    rim: toon({ color: 0x9aa0aa }),
    chrome: toon({ color: 0xdfe3ea }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xfff6cc, emissiveIntensity: 1 }),
    indicator: new THREE.MeshBasicMaterial({ color: 0xffa21a }),
    bedLiner: toon({ color: 0x2a2b2f }),
    sign: toon({ map: signTex }),
    red: new THREE.MeshBasicMaterial({ color: 0xd8202a }),
    blue: new THREE.MeshBasicMaterial({ color: 0x2457e0 }),
  };
  shared.blob.depthTest = true;
  for (const m of Object.values(shared)) m.userData.shared = true;
  return shared;
}

const plane = (w, h) => new THREE.PlaneGeometry(w, h);

/**
 * Build a car's meshes. Returns the pieces the Car class animates or recolours.
 * Per-car materials: paint, roof paint (same as paint unless two-tone), stripes, tail lights.
 */
export function buildCarMesh(name, color) {
  const m = MODELS[name];
  const { g, L, W, T, base, pts, cabinW, R } = geometryFor(name, m);
  const S = sharedAssets();
  const c = m.cabin;

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.45 + (R - 0.4);
  root.add(body);

  const paint = toon({ color });
  const roofPaint = m.roofColor != null ? toon({ color: m.roofColor }) : paint;
  const stripeMat = toon({ color: 0xffffff });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.4 });

  const add = (geo, mat, x, y, z, parent = body, shadow = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    parent.add(mesh);
    return mesh;
  };
  /** Flat decal lying on a horizontal surface. */
  const decalTop = (w, len, mat, x, y, z, parent = body) => add(plane(w, len).rotateX(-Math.PI / 2), mat, x, y, z, parent, false);

  // Soft contact shadow under the car — grounds it even where the sun shadow falls elsewhere.
  const blob = add(plane(W + 0.9, L + 0.9).rotateX(-Math.PI / 2), S.blob, 0, 0.035, 0, root, false);
  blob.renderOrder = 1;

  // --- Body & cabin ---
  add(g.body, paint, 0, (m.bodyH ?? 0.62) / 2 - 0.01, 0);
  add(g.cabin, m.paintedCabin ? roofPaint : S.glass, 0, 0, 0);
  const roofZ = ((c.roofFront + c.roofRear) / 2) * L;
  const roofLen = (c.roofFront - c.roofRear) * L;
  add(g.roof, roofPaint, 0, c.top + 0.07, roofZ);

  // Window pillars: paint-coloured struts along the cabin edges so it reads as a real glasshouse.
  const centre = [(pts[0][0] + pts[3][0]) / 2, (base + c.top) / 2];
  const strut = (a, b, x) => {
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dz, dy);
    let nz = dy / len, ny = -dz / len;
    const mz = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (nz * (mz - centre[0]) + ny * (my - centre[1]) < 0) (nz = -nz), (ny = -ny);
    const p = add(new THREE.BoxGeometry(0.13, 0.11, len + 0.06), roofPaint, x, my + ny * 0.05, mz + nz * 0.05);
    p.rotation.x = Math.atan2(-dy, dz);
    return p;
  };
  const sideX = cabinW / 2 + 0.03;
  if (!m.paintedCabin) {
    for (const sx of [-sideX, sideX]) {
      strut(pts[3], pts[2], sx); // A pillar
      if (c.rear !== c.roofRear) strut(pts[0], pts[1], sx); // C pillar
      if (m.bPillar) add(new THREE.BoxGeometry(0.1, c.top - base, 0.14), roofPaint, sx + Math.sign(sx) * 0.04, (c.top + base) / 2, roofZ - roofLen * 0.05);
    }
  } else {
    // Panel van: glass only in the cab — windscreen plus front side windows.
    const [a, b] = [pts[3], pts[2]];
    const dz = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dz, dy);
    const ws = add(plane(cabinW - 0.15, len - 0.15), S.glass, 0, (a[1] + b[1]) / 2 + 0.06, (a[0] + b[0]) / 2 + 0.06, body, false);
    ws.rotation.x = Math.atan2(dz, dy); // plane's up axis along the slope, facing forward
    for (const s of [-1, 1]) {
      const win = add(plane(0.9, 0.55), S.glass, s * (cabinW / 2 + 0.085), c.top - 0.45, b[0] - 0.55, body, false);
      win.rotation.y = s * Math.PI / 2;
    }
  }

  // Windscreen highlight streak.
  {
    const [a, b] = [pts[3], pts[2]];
    const tilt = Math.atan2(b[1] - a[1], a[0] - b[0]);
    const streak = decalTop(cabinW * 0.55, 0.1, S.glint, -0.1, (a[1] + b[1]) / 2 + 0.11, (a[0] + b[0]) / 2 + 0.09);
    streak.rotation.set(tilt, 0.35, 0, 'YXZ');
  }

  // Thick painted C-pillars: solid panels over the rear of the glasshouse on each side.
  if (m.cPillar) {
    const fz = (c.roofRear + m.cPillar) * L;
    const prof = [pts[0], pts[1], [fz, c.top], [fz - 0.25, base]];
    const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
    geo.translate(0, 0, -0.025).rotateY(-Math.PI / 2);
    for (const sx of [-1, 1]) add(geo, roofPaint, sx * (cabinW / 2 + 0.07), 0, 0);
  }

  // Wing mirrors at the base of the A pillars.
  for (const s of [-1, 1]) add(g.mirror, paint, s * (cabinW / 2 + 0.2), base + 0.12, pts[3][0] - 0.25);

  // --- Front & rear details ---
  const bumperY = 0.14;
  add(g.bumper, S.dark, 0, bumperY, L / 2 - 0.05);
  add(g.bumper, S.dark, 0, bumperY, -L / 2 + 0.05);
  const lampY = T - 0.2;
  const lampX = W / 2 - 0.42;
  const frontFace = add(plane(lampX * 2 - 0.55, 0.16), S.grille, 0, lampY - 0.02, L / 2 + 0.01, body, false); // grille
  frontFace.renderOrder = 0;
  add(plane(0.5, 0.12), S.plate, 0, bumperY + 0.02, L / 2 + 0.11, body, false); // number plates
  add(plane(0.5, 0.12), S.plate, 0, bumperY + 0.02, -L / 2 - 0.11, body, false).rotation.y = Math.PI;
  for (const s of [-1, 1]) {
    add(g.lamp, S.head, s * lampX, lampY, L / 2 - 0.02);
    add(g.lamp, tailMat, s * lampX, lampY, -L / 2 + 0.02);
    add(new THREE.BoxGeometry(0.12, 0.08, 0.05), S.indicator, s * (W / 2 - 0.16), lampY, L / 2 - 0.12, body, false);
  }

  // --- Racing stripes (decals over hood / roof / trunk) ---
  const stripeGroup = new THREE.Group();
  body.add(stripeGroup);
  const hoodStart = pts[3][0] + 0.12, hoodEnd = L / 2 - 0.3;
  const trunkStart = -L / 2 + 0.3, trunkEnd = pts[0][0] - 0.12;
  for (const sx of [-0.24, 0.24]) {
    if (hoodEnd > hoodStart) decalTop(0.26, hoodEnd - hoodStart, stripeMat, sx, T + 0.005, (hoodStart + hoodEnd) / 2, stripeGroup);
    decalTop(0.26, roofLen, stripeMat, sx, c.top + 0.126, roofZ, stripeGroup);
    if (!m.bed && trunkEnd > trunkStart + 0.2) decalTop(0.26, trunkEnd - trunkStart, stripeMat, sx, T + 0.005, (trunkStart + trunkEnd) / 2, stripeGroup);
  }

  // --- Model extras ---
  if (m.scoop) {
    const scoop = add(new RoundedBoxGeometry(0.46, 0.12, 0.6, 2, 0.05), paint, 0, T + 0.04, (hoodStart + hoodEnd) / 2 - 0.1);
    add(plane(0.3, 0.06), S.grille, 0, T + 0.06, (hoodStart + hoodEnd) / 2 + 0.205, body, false); // intake mouth
  }
  if (m.spoiler) {
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.3, 0.12), S.dark, s * (W / 2 - 0.45), T + 0.14, -L / 2 + 0.3);
    add(new RoundedBoxGeometry(W * 0.78, 0.07, 0.36, 2, 0.03), paint, 0, T + 0.31, -L / 2 + 0.3);
  }
  if (m.roofSpoiler) {
    add(new RoundedBoxGeometry(cabinW + 0.04, 0.07, 0.34, 2, 0.03), roofPaint, 0, c.top + 0.09, c.roofRear * L - 0.08);
  }
  if (m.grilleBand) {
    // Slim black band running headlight to headlight, a chrome line through it and a round badge.
    add(new RoundedBoxGeometry(lampX * 2 + 0.3, 0.13, 0.06, 2, 0.03), S.grille, 0, lampY, L / 2 - 0.03);
    add(plane(lampX * 2 - 0.4, 0.025), S.chrome, 0, lampY + 0.02, L / 2 + 0.005, body, false);
    add(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16).rotateX(Math.PI / 2), S.chrome, 0, lampY, L / 2 + 0.01);
    // Wide lower intake in the bumper.
    add(plane(W * 0.55, 0.1), S.grille, 0, bumperY + 0.06, L / 2 + 0.1, body, false);
  }
  if (m.taxiSign) {
    add(new RoundedBoxGeometry(0.85, 0.26, 0.32, 2, 0.06), S.sign, 0, c.top + 0.25, roofZ);
  }
  let siren = null;
  if (m.lightbar) {
    // Per-car lamp materials so each car's siren can flash on its own (see Car.syncMesh).
    siren = { red: S.red.clone(), blue: S.blue.clone() };
    add(new RoundedBoxGeometry(1.3, 0.12, 0.34, 2, 0.05), S.dark, 0, c.top + 0.18, roofZ + 0.1);
    add(new RoundedBoxGeometry(0.55, 0.14, 0.28, 2, 0.05), siren.red, -0.33, c.top + 0.27, roofZ + 0.1);
    add(new RoundedBoxGeometry(0.55, 0.14, 0.28, 2, 0.05), siren.blue, 0.33, c.top + 0.27, roofZ + 0.1);
  }
  if (m.bed) {
    const z0 = -L / 2 + 0.2, z1 = pts[0][0] - 0.12;
    const len = z1 - z0, zc = (z0 + z1) / 2;
    const wx = W / 2 - 0.16;
    decalTop(wx * 2 - 0.1, len, S.bedLiner, 0, T + 0.004, zc);
    for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.14, 0.38, len, 2, 0.05), paint, s * wx, T + 0.17, zc);
    add(new RoundedBoxGeometry(wx * 2 + 0.14, 0.38, 0.14, 2, 0.05), paint, 0, T + 0.17, z0); // tailgate
    add(new RoundedBoxGeometry(wx * 2 + 0.14, 0.38, 0.14, 2, 0.05), paint, 0, T + 0.17, z1); // bulkhead
  }

  // --- Wheels: pivot (steer) -> spin (roll) -> tyre, rim, hubcap, spoke ---
  const wheels = [];
  const wz = (m.wheelZ ?? 0.3) * L;
  for (const [x, z, front] of [
    [W / 2 - 0.14, wz, true],
    [-W / 2 + 0.14, wz, true],
    [W / 2 - 0.14, -wz, false],
    [-W / 2 + 0.14, -wz, false],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, R, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    const tyre = new THREE.Mesh(g.tyre, S.tyre);
    tyre.castShadow = true;
    spin.add(tyre, new THREE.Mesh(g.rim, S.rim), new THREE.Mesh(g.hubcap, S.chrome), new THREE.Mesh(g.spoke, S.rim));
    root.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  return { root, body, paint, roofPaint, stripeMat, stripeGroup, tailMat, wheels, siren };
}
