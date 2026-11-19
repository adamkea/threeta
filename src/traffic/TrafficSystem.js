import { Car } from '../vehicles/Car.js';
import { randomModel } from '../vehicles/carModels.js';
import { CITY } from '../world/City.js';
import { DIRS, HALF_ROAD, LANE_OFFSET, headingOf, isValidNode, nodeRange, nodeX, rightOf } from './RoadNetwork.js';
import { TrafficDriver } from './TrafficDriver.js';


/**
 * Keeps a pool of AI cars alive around the player: spawns them on lanes just out of view,
 * recycles them once they're far away (or wrecked and off-screen).
 */
export class TrafficSystem {
  constructor(scene, rng, lights, { count = 28, spawnMin = 85, spawnMax = 170, despawn = 200 } = {}) {
    this.scene = scene;
    this.rng = rng;
    this.lights = lights;
    this.spawnMin = spawnMin;
    this.spawnMax = spawnMax;
    this.despawn = despawn;
    this.cars = [];
    this.drivers = new Map();
    for (let k = 0; k < count; k++) this.cars.push(this.#createPooledCar());
  }

  #createPooledCar() {
    const car = new Car({ model: randomModel(this.rng), engineAccel: 12, maxSpeed: 20 });
    car.active = false;
    car.mesh.visible = false;
    this.scene.add(car.mesh);
    return car;
  }

  /**
   * Remove a car from AI control (e.g. the player hijacks it). It stays in the world but is no
   * longer pooled; a fresh car takes its place in the pool so traffic density is unchanged.
   */
  release(car) {
    const k = this.cars.indexOf(car);
    if (k < 0) return;
    this.drivers.delete(car);
    car.ai = null;
    this.cars[k] = this.#createPooledCar();
    car.restorePerformance(); // full engine back now a player's driving it
  }

  /** Fill the city immediately (used at start, so traffic isn't only off-screen). */
  populate(focus, avoid) {
    for (const car of this.cars) this.#trySpawn(car, focus, 15, this.spawnMax, avoid, 30);
  }

  /** Run AI and physics for one fixed step. `near` = the step's Neighbourhood. */
  step(dt, near, world) {
    for (const car of this.cars) {
      if (!car.active) continue;
      const controls = this.drivers.get(car).update(dt, near, this.lights);
      car.update(dt, controls, world);
    }
  }

  /** Per-frame bookkeeping: recycle far / wrecked cars and respawn them near the focus point. */
  manage(focus, allCars) {
    for (const car of this.cars) {
      if (car.active) {
        const d = Math.hypot(car.position.x - focus.x, car.position.y - focus.z);
        const driver = this.drivers.get(car);
        // Wrecked or hopelessly stuck cars vanish once nobody can see them.
        const stuckOffscreen = (driver.lost || driver.waitTime > 20) && d > 80;
        if (d > this.despawn || stuckOffscreen) {
          car.active = false;
          car.mesh.visible = false;
        }
      } else {
        this.#trySpawn(car, focus, this.spawnMin, this.spawnMax, allCars, 4);
      }
    }
  }

  #trySpawn(car, focus, minD, maxD, others, tries) {
    // Only roads that can reach the spawn ring around the focus.
    const ri = nodeRange(focus.x, maxD);
    const rj = nodeRange(focus.z, maxD);
    if (!ri || !rj) return false;
    for (let t = 0; t < tries; t++) {
      const i = this.rng.int(ri[0], ri[1]);
      const j = this.rng.int(rj[0], rj[1]);
      const d = this.rng.pick(DIRS);
      if (!isValidNode(i + d[0], j + d[1])) continue;
      const r = rightOf(d);
      const s = HALF_ROAD + 6 + this.rng.range(0, CITY.blockSize - 14);
      const x = nodeX(i) + d[0] * s + r[0] * LANE_OFFSET;
      const z = nodeX(j) + d[1] * s + r[1] * LANE_OFFSET;
      const dist = Math.hypot(x - focus.x, z - focus.z);
      if (dist < minD || dist > maxD) continue;
      if (others.some((o) => o !== car && o.active && Math.hypot(o.position.x - x, o.position.y - z) < 10)) continue;

      car.respray(this.rng);
      car.reset(x, z, headingOf(d), 9);
      car.active = true;
      car.mesh.visible = true;
      const driver = new TrafficDriver(car, this.rng, [i, j], d, x, z);
      this.drivers.set(car, driver);
      car.ai = driver; // lets other drivers read this car's intentions
      return true;
    }
    return false;
  }
}
