import { isSmall, overlaps } from '../world/colliders.js';

/**
 * True if the straight line from (ax, az) to (bx, bz) doesn't pass through any building.
 * Samples the segment every couple of metres against the static collider grid; `margin`
 * fattens the boxes (e.g. a car's half-width, so "clear" means it could drive there).
 */
export function clearLine(world, ax, az, bx, bz, margin = 0) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 2));
  for (let k = 1; k < steps; k++) {
    const t = k / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const b of world.query(x, z)) {
      if (isSmall(b)) continue; // lamp posts / trees don't block
      if (overlaps(b, x, z, margin)) return false;
    }
  }
  return true;
}
