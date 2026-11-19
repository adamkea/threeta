// 2D polygon helpers on the ground plane. Points are { x, z }. Polygons are arrays of points in
// counter-clockwise order in (x, z) maths terms (positive signed area). On screen (+Z down) that
// reads clockwise. The outward normal of edge a -> b is (dz, -dx) / len.

export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function centroid(poly) {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const c = p.x * q.z - q.x * p.z;
    a += c;
    cx += (p.x + q.x) * c;
    cz += (p.z + q.z) * c;
  }
  if (Math.abs(a) < 1e-9) return { x: poly[0].x, z: poly[0].z };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export function bounds(poly) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Drops vertices that sit on a straight line between their neighbours (and duplicates). */
export function simplify(poly, eps = 1e-3) {
  let out = poly.slice();
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
      const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
      if (Math.abs(cross) / len < eps || Math.hypot(b.x - a.x, b.z - a.z) < eps) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** True if (x, z) is inside a convex CCW polygon (on the edge counts as inside). */
export function insideConvex(poly, x, z, margin = 0) {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    // Outward distance from this edge.
    if (((x - p.x) * dz - (z - p.z) * dx) / len > margin) return false;
  }
  return true;
}

/** Largest outward distance from any edge: <= 0 inside, the true distance inside the polygon. */
export function edgeDistance(poly, x, z) {
  let worst = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const d = ((x - p.x) * dz - (z - p.z) * dx) / len;
    if (d > worst) worst = d;
  }
  return worst;
}

/** Keeps the part of a convex polygon where (p - o) · n <= 0 (Sutherland–Hodgman, one plane). */
export function clipHalfPlane(poly, ox, oz, nx, nz) {
  const out = [];
  const side = (p) => (p.x - ox) * nx + (p.z - oz) * nz;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out.length >= 3 ? out : null;
}

/**
 * Shrinks a convex polygon by moving every edge inward by `dist`: the intersection of the moved
 * edges' half-planes, so short edges (chamfers) that vanish simply drop out. Null if nothing is left.
 */
export function offsetConvex(poly, dist) {
  let out = poly;
  for (let i = 0; i < poly.length && out; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ox = dz / len, oz = -dx / len; // outward normal
    out = clipHalfPlane(out, p.x - ox * dist, p.z - oz * dist, ox, oz);
  }
  return out && signedArea(out) > 1 ? simplify(out) : null;
}

/**
 * Like offsetConvex, but vertex i of the result corresponds to vertex i of the input (for
 * building matching inner and outer outlines). Returns null if any edge would vanish.
 */
export function offsetConvexPaired(poly, dist) {
  const n = poly.length;
  const d = typeof dist === 'function' ? dist : () => dist;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const dx = q.x - p.x, dz = q.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len; // inward normal
    const o = d(i);
    lines.push({ x: p.x + nx * o, z: p.z + nz * o, dx: dx / len, dz: dz / len });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n], b = lines[i];
    const p = intersectLines(a.x, a.z, a.dx, a.dz, b.x, b.z, b.dx, b.dz);
    out.push(p ?? { x: b.x, z: b.z });
  }
  // A collapsed polygon flips orientation or ends up with edges pointing backwards.
  if (signedArea(out) <= 1) return null;
  for (let i = 0; i < n; i++) {
    const p = out[i], q = out[(i + 1) % n];
    if ((q.x - p.x) * lines[i].dx + (q.z - p.z) * lines[i].dz < -1e-6) return null;
  }
  return out;
}

/** Intersection of two lines given as point + direction, or null if (nearly) parallel. */
export function intersectLines(ax, az, adx, adz, bx, bz, bdx, bdz) {
  const den = adx * bdz - adz * bdx;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((bx - ax) * bdz - (bz - az) * bdx) / den;
  return { x: ax + adx * t, z: az + adz * t };
}

/** Interior angle (radians) at vertex i of a CCW polygon. */
export function interiorAngle(poly, i) {
  const n = poly.length;
  const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
  const ux = a.x - b.x, uz = a.z - b.z, vx = c.x - b.x, vz = c.z - b.z;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz) || 1))));
}

/** Cuts the tips off corners sharper than `minAngle`, `cut` metres back from the point. */
export function chamferAcute(poly, minAngle, cut) {
  let out = poly;
  for (let i = 0; i < out.length; i++) {
    if (interiorAngle(out, i) >= minAngle) continue;
    const n = out.length;
    const a = out[(i + n - 1) % n], b = out[i], c = out[(i + 1) % n];
    const ua = norm(a.x - b.x, a.z - b.z), uc = norm(c.x - b.x, c.z - b.z);
    const bis = norm(ua.x + uc.x, ua.z + uc.z); // points into the polygon
    const clipped = clipHalfPlane(out, b.x + bis.x * cut, b.z + bis.z * cut, -bis.x, -bis.z);
    if (clipped) {
      out = clipped;
      i++; // skip the new vertex pair
    }
  }
  return out;
}

export function norm(x, z) {
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

export function isAxisRect(poly) {
  if (poly.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4];
    if (Math.abs(p.x - q.x) > 1e-3 && Math.abs(p.z - q.z) > 1e-3) return false;
  }
  return true;
}

/** Closest point to (x, z) on segment a-b. */
export function closestOnSegment(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return { x: ax + dx * t, z: az + dz * t, t };
}
