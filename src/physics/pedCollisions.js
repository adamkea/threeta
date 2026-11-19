const KNOCKDOWN_SPEED = 5; // m/s closing speed at which a car knocks a person over

/** Pushes pedestrians out of cars; fast impacts knock them down. Cars barely notice. */
export function resolvePedCarCollisions(peds, cars) {
  for (const p of peds) {
    if (!p.active) continue;
    for (const car of cars) {
      if (!car.active || car.position.distanceToSquared(p.position) > 16) continue;
      const r = car.cfg.collisionRadius + p.radius;
      for (const [cx, cz] of car.collisionCircles()) {
        let nx = p.position.x - cx;
        let nz = p.position.y - cz;
        const d = Math.hypot(nx, nz);
        if (d >= r) continue;
        if (d < 1e-5) (nx = 1), (nz = 0);
        else (nx /= d), (nz /= d);
        p.position.x += nx * (r - d);
        p.position.y += nz * (r - d);

        const closing = (car.velocity.x - p.velocity.x) * nx + (car.velocity.y - p.velocity.y) * nz;
        if (closing <= 0) continue;
        if (closing > KNOCKDOWN_SPEED && !p.isDown) {
          const impulse = car.velocity.clone().multiplyScalar(0.7);
          impulse.x += nx * closing * 0.5;
          impulse.y += nz * closing * 0.5;
          p.knockDown(impulse);
          car.velocity.multiplyScalar(0.94);
        } else {
          // Shoved along at the car's speed.
          p.velocity.x += closing * nx;
          p.velocity.y += closing * nz;
        }
      }
    }
  }
}
