const KNOCKDOWN_SPEED = 5; // m/s closing speed at which a car knocks a person over

/**
 * Pushes pedestrians out of cars; fast impacts knock them down. Cars barely notice.
 * `onKnockdown(ped, car)` is called for each person a car knocks over.
 */
export function resolvePedCarCollisions(peds, cars, onKnockdown = null) {
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
        // Only the car's own motion knocks people over — running into a parked car doesn't.
        const carClosing = car.velocity.x * nx + car.velocity.y * nz;
        if (closing > KNOCKDOWN_SPEED && carClosing > KNOCKDOWN_SPEED * 0.6 && !p.isDown) {
          const impulse = car.velocity.clone().multiplyScalar(0.7);
          impulse.x += nx * closing * 0.5;
          impulse.y += nz * closing * 0.5;
          p.knockDown(impulse);
          onKnockdown?.(p, car);
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

/** Keeps people from walking through each other (equal push, no knockdown). */
export function resolvePedPedCollisions(peds) {
  for (let a = 0; a < peds.length; a++) {
    const p = peds[a];
    if (!p.active) continue;
    for (let b = a + 1; b < peds.length; b++) {
      const q = peds[b];
      if (!q.active) continue;
      let nx = q.position.x - p.position.x;
      let nz = q.position.y - p.position.y;
      const r = p.radius + q.radius;
      const d2 = nx * nx + nz * nz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-5) (nx = 1), (nz = 0);
      else (nx /= d), (nz /= d);
      const push = (r - d) / 2;
      p.position.x -= nx * push;
      p.position.y -= nz * push;
      q.position.x += nx * push;
      q.position.y += nz * push;
    }
  }
}
