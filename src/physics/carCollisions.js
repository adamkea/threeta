const _near = [];
const _ca = new Float64Array(4);
const _cb = new Float64Array(4);

/**
 * Resolves car-vs-car overlaps (each car = two circles) with an impulse weighted by `cfg.mass`,
 * plus a bit of spin so glancing hits rotate the cars. `onHit(a, b, impulse)` is told about
 * every impact (used to spot the player ramming police). Both cars take crash damage from the
 * hardest hit each suffered this step (see VehicleDamage.impact). `grid` is a SpatialHash of `cars`.
 */
const hardest = new Map(); // car -> { dv, by }
export function resolveCarCollisions(cars, grid, restitution = 0.3, onHit = null) {
  hardest.clear();
  const note = (car, dv, by) => {
    const h = hardest.get(car);
    if (!h || dv > h.dv) hardest.set(car, { dv, by });
  };
  for (const a of cars) {
    // Each nearby pair once (lower id handles it). Cars move < 1 m between the grid rebuild and
    // here, hence the margin on the 6 m pair range.
    for (const b of grid.query(a.position.x, a.position.y, 7, _near)) {
      if (b.id <= a.id || !b.active || b.overboard) continue;
      if (a.position.distanceToSquared(b.position) > 36) continue;
      const r = a.cfg.collisionRadius + b.cfg.collisionRadius;
      a.collisionCircles(_ca);
      b.collisionCircles(_cb);
      for (let i = 0; i < 2; i++) {
        const ax = _ca[i * 2], az = _ca[i * 2 + 1];
        for (let j = 0; j < 2; j++) {
          const bx = _cb[j * 2], bz = _cb[j * 2 + 1];
          let nx = bx - ax;
          let nz = bz - az;
          const dist = Math.hypot(nx, nz);
          if (dist >= r || dist < 1e-4) continue;
          nx /= dist;
          nz /= dist;
          // Lighter vehicles (motorbikes) get pushed and knocked about more.
          const ia = 1 / a.cfg.mass, ib = 1 / b.cfg.mass, share = ia / (ia + ib);
          const push = r - dist;
          a.position.x -= nx * push * share;
          a.position.y -= nz * push * share;
          b.position.x += nx * push * (1 - share);
          b.position.y += nz * push * (1 - share);

          const relVel = (b.velocity.x - a.velocity.x) * nx + (b.velocity.y - a.velocity.y) * nz;
          if (relVel >= 0) continue;
          const jImp = (-(1 + restitution) * relVel) / (ia + ib);
          const dva = jImp * ia, dvb = jImp * ib; // change in each one's speed
          a.velocity.x -= nx * dva;
          a.velocity.y -= nz * dva;
          b.velocity.x += nx * dvb;
          b.velocity.y += nz * dvb;
          onHit?.(a, b, (dva + dvb) / 2);
          note(a, dva, b);
          note(b, dvb, a);

          // Torque about +Y: tau = lz*Fx - lx*Fz, with lever from car centre to contact.
          const cx = (ax + bx) / 2;
          const cz = (az + bz) / 2;
          const spin = 0.12;
          a.yawRate += spin * ((cz - a.position.y) * -nx - (cx - a.position.x) * -nz) * dva;
          b.yawRate += spin * ((cz - b.position.y) * nx - (cx - b.position.x) * nz) * dvb;
        }
      }
    }
  }
  for (const [car, { dv, by }] of hardest) car.damage.impact(dv, by);
}
