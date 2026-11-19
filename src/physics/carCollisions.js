/**
 * Resolves car-vs-car overlaps (each car = two circles) with an equal-mass impulse,
 * plus a bit of spin so glancing hits rotate the cars.
 */
export function resolveCarCollisions(cars, restitution = 0.3) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (a.position.distanceToSquared(b.position) > 36) continue;
      const r = a.cfg.collisionRadius + b.cfg.collisionRadius;
      for (const [ax, az] of a.collisionCircles()) {
        for (const [bx, bz] of b.collisionCircles()) {
          let nx = bx - ax;
          let nz = bz - az;
          const dist = Math.hypot(nx, nz);
          if (dist >= r || dist < 1e-4) continue;
          nx /= dist;
          nz /= dist;
          const push = (r - dist) / 2;
          a.position.x -= nx * push;
          a.position.y -= nz * push;
          b.position.x += nx * push;
          b.position.y += nz * push;

          const relVel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * nz;
          if (relVel >= 0) continue;
          const jImp = (-(1 + restitution) * relVel) / 2;
          a.velocity.x -= nx * jImp;
          a.velocity.y -= nz * jImp;
          b.velocity.x += nx * jImp;
          b.velocity.y += nz * jImp;

          // Torque about +Y: tau = lz*Fx - lx*Fz, with lever from car centre to contact.
          const cx = (ax + bx) / 2;
          const cz = (az + bz) / 2;
          const spin = 0.12;
          a.yawRate += spin * ((cz - a.position.y) * -nx - (cx - a.position.x) * -nz) * jImp;
          b.yawRate += spin * ((cz - b.position.y) * nx - (cx - b.position.x) * nz) * jImp;
        }
      }
    }
  }
}
