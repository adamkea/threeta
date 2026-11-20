import * as THREE from 'three';

/**
 * Body and face variety for the shared person mesh.
 *
 * Every person shares one skinned geometry, so shapes can't be built per person. Instead the
 * geometry carries a few morph targets, each a displacement field defined over a body region
 * (in that region's bone space, at rest); each person just sets how much of each to use.
 *
 *   heavy  heavier set: thicker waist, belly, limbs, neck and jowls (negative = skinny)
 *   broad  broad shoulders, chest and upper arms, slimmer hips (a V-shape)
 *   curvy  narrower shoulders and waist, wider hips and thighs, a slight bust
 *   jaw    wider, squarer jaw (negative = narrow, pointed chin)
 *   long   longer lower face and chin (negative = shorter, rounder face)
 *
 * Regions: 'torso', 'thigh', 'shin', 'upperArm', 'forearm', 'head' and 'none'. Limb regions hang
 * down -Y from their pivot with the limb's axis at x = z = 0.
 */
export const MORPHS = ['heavy', 'broad', 'curvy', 'jaw', 'long'];

const ss = THREE.MathUtils.smoothstep;
/** smoothstep that also works with edges given high-to-low. */
const ramp = (x, a, b) => (a < b ? ss(x, a, b) : 1 - ss(x, b, a));
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));

// Parts that never change shape (props held or worn rigidly).
const RIGID = new Set(['gunSlide', 'gunGrip', 'shoe', 'radio', 'badge', 'buckle', 'holster', 'glasses']);

/** Push a point out from the limb axis (or the torso's centre line) by `k` of its offset. */
function radial(p, kx, kz, out) {
  return out.set(p.x * kx, 0, p.z * kz);
}

const LIMB_LEN = { thigh: 0.54, shin: 0.46, upperArm: 0.36, forearm: 0.3 };

/**
 * Displacement of point `p` (region space, at rest) of part `name` for morph `target`,
 * written to `out` (returned).
 */
export function morphDelta(target, region, name, p, out) {
  out.set(0, 0, 0);
  if (RIGID.has(name) || region === 'none') return out;

  if (region === 'torso') {
    const y = p.y;
    if (name === 'neck') {
      if (target === 'heavy') radial(p, 0.3, 0.3, out);
      return out;
    }
    const front = Math.max(0, p.z) / 0.19; // 0 at the sides/back .. 1 at the front of the chest
    if (target === 'heavy') {
      // Girth all round, tapering off over the shoulders, plus a belly.
      const k = 0.17 * (1 - 0.65 * ss(y, 0.18, 0.4));
      radial(p, k, k * 1.25, out);
      out.z += 0.075 * gauss(y + 0.06, 0.16) * front;
    } else if (target === 'broad') {
      const sh = ss(y, -0.05, 0.3) * (1 - ss(y, 0.36, 0.42));
      const hip = ramp(y, -0.1, -0.25);
      radial(p, 0.15 * sh - 0.05 * hip, 0.05 * sh, out);
    } else if (target === 'curvy') {
      const sh = ss(y, 0.05, 0.3) * (1 - ss(y, 0.36, 0.42));
      const waist = gauss(y + 0.06, 0.09);
      const hip = ramp(y, -0.1, -0.27);
      radial(p, -0.12 * sh - 0.11 * waist + 0.22 * hip, -0.07 * waist + 0.12 * hip, out);
      if (p.z < 0) out.z -= 0.05 * hip * Math.min(1, -p.z / 0.17); // seat
      // A slight bust: two soft swellings on the front of the chest.
      out.z += 0.045 * gauss(y - 0.12, 0.075) * gauss(Math.abs(p.x) - 0.1, 0.07) * front;
    }
    return out;
  }

  if (region in LIMB_LEN) {
    const t = THREE.MathUtils.clamp(-p.y / LIMB_LEN[region], 0, 1); // 0 at the pivot .. 1 at the end
    let k = 0;
    if (name === 'hand') {
      if (target === 'heavy') k = 0.08;
      // Hands swell about their own centre, not the arm's axis.
      return out.set(p.x * k, (p.y + 0.31) * k, p.z * k);
    }
    if (region === 'thigh') {
      if (target === 'heavy') k = 0.22 * (1 - 0.4 * t);
      else if (target === 'curvy') k = 0.2 * (1 - 0.6 * t);
      else if (target === 'broad') k = 0.04;
    } else if (region === 'shin') {
      if (target === 'heavy') k = 0.12;
      else if (target === 'curvy') k = 0.05 * gauss(t - 0.3, 0.3); // calf
      else if (target === 'broad') k = 0.04;
    } else if (region === 'upperArm') {
      if (target === 'heavy') k = 0.2;
      else if (target === 'broad') k = 0.14 * (1 - 0.5 * t);
      else if (target === 'curvy') k = -0.08;
    } else if (region === 'forearm') {
      if (target === 'heavy') k = 0.12;
      else if (target === 'broad') k = 0.07;
      else if (target === 'curvy') k = -0.06;
    }
    return radial(p, k, k, out);
  }

  if (region === 'head') {
    // Head space: centre of the head, modelled at radius ~0.25. Only the lower face moves.
    const lower = ramp(p.y, 0.02, -0.2); // 0 above the cheekbones .. 1 at the chin
    const face = ss(p.z, -0.2, 0.02); // the front of the head, not the back or long hair
    if (target === 'heavy') {
      out.x = p.x * 0.1 * ramp(p.y, 0.05, -0.15) * face; // jowls
    } else if (target === 'jaw') {
      out.x = p.x * 0.17 * lower * face;
      out.z = 0.012 * lower * face;
    } else if (target === 'long') {
      const w = ramp(p.y, 0, -0.22) * face;
      out.y = -0.055 * w;
      out.z = 0.012 * w;
    }
    return out;
  }
  return out;
}

/**
 * The head, sculpted from a sphere: narrower than it is deep, a flatter face, a cranium that
 * swells at the back, and a jaw that tapers to the chin (rather than a ball).
 * Takes a point on a sphere of radius 0.25 and returns where it goes.
 */
export function sculptHead(v) {
  let { x, y, z } = v;
  const low = ramp(y, 0.03, -0.25); // 0 above the cheekbones .. 1 at the chin
  x *= 0.88 * (1 - 0.17 * low);
  if (z < 0) z *= 1 - 0.3 * low; // the back of the jaw tucks in toward the neck
  else z *= 0.94 + 0.04 * low; // flatter face, chin a touch forward
  z -= 0.022 * ss(y, -0.08, 0.12) * ss(-z, 0.0, 0.2); // cranium
  y *= 1.07;
  return v.set(x, y, z);
}

/** A point on the sculpted head's surface, looking out from the centre along (x, y, +z). */
export function onHead(x, y, inset = 0) {
  const v = new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).multiplyScalar(0.25);
  sculptHead(v);
  return v.addScaledVector(v.clone().normalize(), -inset);
}

/**
 * Hair that hugs the sculpted head. `hairline(a)` gives how far down from the crown the hair
 * reaches (radians from straight up) at angle `a` round from the face (0 = front, PI = back);
 * `thickness(t, a)` how far it stands off the scalp, `t` running 0 at the crown .. 1 at the
 * hairline. An open shell: it's drawn double-sided.
 */
export function hairCap(hairline, thickness, { rings = 12, segments = 28 } = {}) {
  const g = new THREE.SphereGeometry(1, segments, rings, 0, Math.PI * 2, 0, 1);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.acos(THREE.MathUtils.clamp(v.y, -1, 1)); // 0..1 down the cap
    const phi = Math.atan2(v.z, -v.x); // three's sphere: +Z (the face) at PI / 2
    const a = Math.abs(Math.atan2(Math.sin(phi - Math.PI / 2), Math.cos(phi - Math.PI / 2)));
    const theta = t * hairline(a);
    v.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
    const dir = v.clone();
    sculptHead(v.multiplyScalar(0.25)).addScaledVector(dir, thickness(t, a));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** Hairline that sits high on the forehead, comes down at the temples and lower at the nape. */
export const hairline = (front, side, back) => (a) => {
  const s = a / Math.PI; // 0 front .. 1 back
  // Drops quickly behind the ears to the nape, rather than creeping round to it.
  return s < 0.5 ? THREE.MathUtils.lerp(front, side, ss(s, 0, 0.5)) : THREE.MathUtils.lerp(side, back, ss(s, 0.5, 0.7));
};
