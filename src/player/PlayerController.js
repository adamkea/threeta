import * as THREE from 'three';

const ENTER_RANGE = 3.6; // max distance from the person to a car's centre to get in
const MAX_ENTER_SPEED = 5; // can't jump into cars moving faster than this (m/s)
const MAX_EXIT_SPEED = 4;
const PARKED = { throttle: 0, steer: 0, handbrake: true };

/**
 * Owns the player's person and whichever car they're in. Handles getting in/out
 * (including pulling drivers out of traffic) and routes input to the right body.
 */
export class PlayerController {
  constructor({ ped, car, traffic, npcs, scene }) {
    this.ped = ped;
    this.vehicle = car;
    this.traffic = traffic;
    this.npcs = npcs;
    this.scene = scene;
    this.police = null; // PoliceSystem, once it exists (patrol cars can be stolen too)
    this.onCarjack = null; // (car) => void: told whenever the player takes a car that had a driver
    /** Non-AI cars in the world: ones the player owns, has driven, or abandoned. */
    this.freeCars = [car];
    ped.active = false;
    ped.mesh.visible = false;
  }

  get inVehicle() {
    return this.vehicle !== null;
  }

  /** What the camera should follow. */
  get body() {
    return this.vehicle ?? this.ped;
  }

  /** Nearest car the person could get into right now, or null. */
  findEnterableCar(cars) {
    if (this.inVehicle || this.ped.isDown) return null;
    let best = null;
    let bestD = ENTER_RANGE;
    for (const c of cars) {
      if (!c.active || c.speed > MAX_ENTER_SPEED) continue;
      const d = c.position.distanceTo(this.ped.position);
      if (d < bestD) (bestD = d), (best = c);
    }
    return best;
  }

  /** Toggle in/out of a vehicle. Returns true if something happened. */
  use(cars, world) {
    if (this.inVehicle) return this.#exit(world);
    const car = this.findEnterableCar(cars);
    if (!car) return false;

    if (this.traffic.drivers.has(car)) {
      // Carjack: the AI driver is thrown out on the driver's side and runs off.
      const spot = this.#sideSpot(car, -1);
      this.traffic.release(car);
      this.freeCars.push(car);
      this.npcs.spawnFleeing(spot.x, spot.y, this.ped.position, car.position);
      this.onCarjack?.(car);
    } else if (this.police?.owns(car)) {
      // Stealing a patrol car (an officer at the wheel gets thrown out — and gives chase).
      this.police.surrender(car, this.#sideSpot(car, -1));
      this.freeCars.push(car);
      this.onCarjack?.(car);
    }
    this.vehicle = car;
    this.ped.active = false;
    this.ped.mesh.visible = false;
    return true;
  }

  /** Get out of the car whatever its speed (e.g. being arrested). */
  forceExit(world) {
    return this.inVehicle && this.#exit(world, true);
  }

  #exit(world, force = false) {
    const car = this.vehicle;
    if (car.speed > MAX_EXIT_SPEED && !force) return false;
    // Prefer the driver's (left) side, then passenger side, then front/back.
    const candidates = [this.#sideSpot(car, -1), this.#sideSpot(car, 1), this.#endSpot(car, 1), this.#endSpot(car, -1)];
    const spot = candidates.find((p) => !blocked(world, p, this.ped.radius)) ?? candidates[0];
    this.ped.reset(spot.x, spot.y, car.heading);
    this.ped.active = true;
    this.ped.mesh.visible = true;
    this.vehicle = null;
    return true;
  }

  /** Point beside the car: side = -1 driver (left), +1 passenger (right). */
  #sideSpot(car, side) {
    const off = car.cfg.width / 2 + 0.8;
    return new THREE.Vector2(car.position.x + car.right.x * off * side, car.position.y + car.right.y * off * side);
  }

  #endSpot(car, dir) {
    const off = car.cfg.length / 2 + 0.8;
    return new THREE.Vector2(car.position.x + car.forward.x * off * dir, car.position.y + car.forward.y * off * dir);
  }

  /** Fixed-step update for the player's body plus any parked cars they own. */
  step(dt, input, world) {
    for (const c of this.freeCars) {
      if (c === this.vehicle) {
        c.update(dt, { throttle: input.throttle, steer: input.steer, handbrake: input.isDown('handbrake') }, world);
      } else {
        c.update(dt, PARKED, world);
      }
    }
    if (!this.inVehicle) this.ped.update(dt, input.move, input.isDown('sprint'), world);
  }

  /** Drop parked cars that are far from the action. */
  manage(focus, dispose) {
    this.freeCars = this.freeCars.filter((c) => {
      if (c === this.vehicle) return true;
      if (Math.hypot(c.position.x - focus.x, c.position.y - focus.z) < 220) return true;
      this.scene.remove(c.mesh);
      dispose(c.mesh);
      return false;
    });
  }
}

function blocked(world, p, r) {
  return world
    .query(p.x, p.y)
    .some((b) => p.x > b.minX - r && p.x < b.maxX + r && p.y > b.minZ - r && p.y < b.maxZ + r);
}
