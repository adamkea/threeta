// Static collider queries. A collider is an axis-aligned box { minX, maxX, minZ, maxZ }; one with
// a `poly` (a convex CCW polygon, see geom.js) is that shape instead, and the box is its bounds.

const _push = { nx: 0, nz: 0, depth: 0 };

/**
 * If a circle at (x, z) with radius r overlaps collider b, returns how to push it out:
 * { nx, nz, depth } (a shared object — copy what you need). Otherwise null.
 */
export function circlePush(b, x, z, r) {
  if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) return null;
  return b.poly ? polyPush(b.poly, x, z, r) : boxPush(b, x, z, r);
}

function boxPush(b, cx, cz, r) {
  const px = Math.min(Math.max(cx, b.minX), b.maxX);
  const pz = Math.min(Math.max(cz, b.minZ), b.maxZ);
  let nx = cx - px, nz = cz - pz;
  const dist = Math.hypot(nx, nz);
  if (dist >= r) return null;
  if (dist > 1e-6) {
    _push.nx = nx / dist;
    _push.nz = nz / dist;
    _push.depth = r - dist;
  } else {
    // Centre inside the box: push out along the shallowest axis.
    const dl = cx - b.minX, dr = b.maxX - cx, dt = cz - b.minZ, db = b.maxZ - cz;
    const m = Math.min(dl, dr, dt, db);
    [nx, nz] = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt ? [0, -1] : [0, 1];
    _push.nx = nx;
    _push.nz = nz;
    _push.depth = m + r;
  }
  return _push;
}

function polyPush(poly, x, z, r) {
  const n = poly.length;
  // Deepest-inside test first: the largest outward distance to an edge's line.
  let worst = -Infinity, wnx = 0, wnz = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const ox = dz / len, oz = -dx / len; // outward normal
    const d = (x - p.x) * ox + (z - p.z) * oz;
    if (d > worst) (worst = d), (wnx = ox), (wnz = oz);
  }
  if (worst >= r) return null;
  if (worst <= 0) {
    // Centre inside: out through the nearest side.
    _push.nx = wnx;
    _push.nz = wnz;
    _push.depth = r - worst;
    return _push;
  }
  // Outside but close: the true nearest point on the outline (could be a corner).
  let best = Infinity, bx = 0, bz = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dx = q.x - p.x, dz = q.z - p.z;
    const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
    const cx = p.x + dx * t, cz = p.z + dz * t;
    const d2 = (x - cx) ** 2 + (z - cz) ** 2;
    if (d2 < best) (best = d2), (bx = cx), (bz = cz);
  }
  const dist = Math.sqrt(best);
  if (dist >= r) return null;
  _push.nx = (x - bx) / (dist || 1);
  _push.nz = (z - bz) / (dist || 1);
  _push.depth = r - dist;
  return _push;
}

/** True if (x, z) is inside collider b grown by `margin` (a square-cornered grow for boxes). */
export function overlaps(b, x, z, margin = 0) {
  if (x <= b.minX - margin || x >= b.maxX + margin || z <= b.minZ - margin || z >= b.maxZ + margin) return false;
  if (!b.poly) return true;
  const poly = b.poly;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    if (((x - p.x) * dz - (z - p.z) * dx) / len >= margin) return false;
  }
  return true;
}

/** True for lamp posts, trees and other thin things that don't block sight or bullets. */
export function isSmall(b) {
  return b.maxX - b.minX < 1.5 && b.maxZ - b.minZ < 1.5;
}

/**
 * Distance along a ray (origin o, unit direction d: Vector2-likes with x, y = world x, z) to
 * collider b: 0 if starting inside, null if it misses.
 */
export function rayCollider(o, d, b) {
  if (!b.poly) return slab(o, d, b.minX, b.maxX, b.minZ, b.maxZ);
  // Cyrus–Beck clip against each edge's half-plane.
  let t0 = 0, t1 = Infinity;
  const poly = b.poly;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const nx = q.z - p.z, nz = -(q.x - p.x); // outward (unnormalised)
    const num = (o.x - p.x) * nx + (o.y - p.z) * nz; // > 0 outside this edge
    const den = d.x * nx + d.y * nz;
    if (Math.abs(den) < 1e-12) {
      if (num > 0) return null;
      continue;
    }
    const t = -num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Distance along ray (o, d) into the box [x0, x1] × [z0, z1], 0 if starting inside, or null. */
export function slab(o, d, x0, x1, z0, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [p, v, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, z0, z1]]) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let a = (lo - p) / v, b = (hi - p) / v;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
