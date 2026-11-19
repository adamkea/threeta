import { Car } from './Car.js';
import { randomModel } from './carModels.js';

/**
 * Fills parking lot bays with empty, unlocked cars near the player. Parked cars join the
 * player's free cars (so they have physics, can be bumped, and can be taken with no
 * carjacking). Bays are re-rolled each time they come back into range, out of view.
 */
export class ParkedCars {
  constructor(scene, rng, spots, freeCars, { fill = 0.55, near = 120, far = 165 } = {}) {
    this.scene = scene;
    this.rng = rng;
    this.spots = spots.map((s) => ({ ...s, inRange: false, car: null }));
    this.freeCars = freeCars; // () => the player's free-car list (it's replaced when filtered)
    this.fill = fill;
    this.near = near;
    this.far = far;
  }

  /** Fill every bay in range straight away (at the start, so lots near the player aren't empty). */
  populate(focus, allCars, dispose) {
    this.manage(focus, allCars, dispose, 0);
  }

  /**
   * Per-frame: park cars in bays coming into range (only beyond `minSpawn`, so nothing pops in
   * on screen), and clear away cars still sitting in bays far behind the player.
   */
  manage(focus, allCars, dispose, minSpawn = 85) {
    for (const spot of this.spots) {
      const d = Math.hypot(spot.x - focus.x, spot.z - focus.z);
      const car = spot.car;
      if (car) {
        // Once a parked car has been driven or shoved out of its bay it's just another free car.
        const moved = Math.hypot(car.position.x - spot.x, car.position.y - spot.z) > 1.5;
        if (moved || !this.freeCars().includes(car)) {
          spot.car = null;
        } else if (d > this.far) {
          this.#remove(car, dispose);
          spot.car = null;
        }
      }
      if (d > this.near) {
        spot.inRange = false;
      } else if (!spot.inRange && d >= minSpawn) {
        spot.inRange = true;
        if (!spot.car && this.rng.chance(this.fill) && !this.#occupied(spot, allCars)) spot.car = this.#park(spot);
      }
    }
  }

  #occupied(spot, cars) {
    return cars.some((c) => c.active && Math.hypot(c.position.x - spot.x, c.position.y - spot.z) < 3.5);
  }

  #park(spot) {
    let model = randomModel(this.rng);
    if (model === 'police' || model === 'taxi') model = 'sedan'; // nobody leaves those in a car park
    const car = new Car({ model });
    car.respray(this.rng);
    // A little slop so the rows don't look machine-placed.
    const jx = this.rng.range(-0.15, 0.15);
    const jz = this.rng.range(-0.25, 0.25);
    car.reset(spot.x + jx, spot.z + jz, spot.heading + this.rng.range(-0.04, 0.04));
    car.syncMesh();
    this.scene.add(car.mesh);
    this.freeCars().push(car);
    return car;
  }

  #remove(car, dispose) {
    const list = this.freeCars();
    const k = list.indexOf(car);
    if (k >= 0) list.splice(k, 1);
    this.scene.remove(car.mesh);
    dispose(car.mesh);
  }
}
