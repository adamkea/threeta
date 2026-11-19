import * as THREE from 'three';
import { Pedestrian } from './Pedestrian.js';
import { groundHeight } from '../world/City.js';
import { SIZE, coord, crossingOf, isValid, nearestIndex, neighbours } from './Sidewalks.js';

const STAND = new THREE.Vector2();
const SHIRTS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22, 0x16a085, 0xd35d8c];
const PANTS = [0x2b2f3a, 0x4a3b2a, 0x1f3550, 0x5a5a5a, 0x7a6a4f, 0x222222];
const SKINS = [0xf1d0b5, 0xe0b48f, 0xc68e64, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2a1c14, 0x111111, 0x6b4a2f, 0xc9a35b, 0x8a8a8a, 0x9b3b1e];

const SCARE_RADIUS = 14; // people this close to someone getting run over panic
const CROSS_GREEN_NEEDED = 4; // seconds of green left needed to start crossing
const ARRIVE = 0.5;

const _v = new THREE.Vector2();
const _move = new THREE.Vector2();

/**
 * Non-player people: ambient pedestrians who stroll the sidewalks, cross at zebra crossings
 * when the lights allow, and scatter from danger; plus drivers fleeing a carjacking (who calm
 * down and become ordinary pedestrians). Pooled and kept alive around the camera focus.
 */
export class NpcManager {
  constructor(scene, rng, { count = 60, spawnMin = 55, spawnMax = 105, despawn = 125 } = {}) {
    this.scene = scene;
    this.rng = rng;
    this.count = count;
    this.spawnMin = spawnMin;
    this.spawnMax = spawnMax;
    this.despawn = despawn;
    this.npcs = [];
  }

  get active() {
    return this.npcs.filter((n) => n.active);
  }

  get peds() {
    return this.active.map((n) => n.ped);
  }

  /** Fill the streets immediately around `focus` ({x, z}). */
  populate(focus) {
    for (let k = 0; k < this.count; k++) this.#trySpawn(focus, 6, this.spawnMax, 30);
  }

  /** Spawn a panicked ex-driver at (x, z) who runs away from `threat` and from the car they left. */
  spawnFleeing(x, z, threat, car) {
    const n = this.#acquire();
    n.ped.reset(x, z);
    const fromThreat = new THREE.Vector2(x - threat.x, z - threat.y);
    const fromCar = new THREE.Vector2(x - car.x, z - car.y).normalize();
    const away = fromThreat.lengthSq() > 0.25 ? fromThreat.normalize().add(fromCar).normalize() : fromCar;
    // Veer a little so they don't all run in perfectly straight lines.
    away.rotateAround(STAND, this.rng.range(-0.5, 0.5));
    this.#flee(n, away, 5);
  }

  /**
   * One fixed step for every NPC. `peds` = everyone on foot (incl. the player), `cars` = active cars.
   */
  step(dt, world, peds, cars, lights) {
    const npcs = this.active;

    // Someone got knocked down: everyone nearby scatters.
    for (const p of peds) {
      if (!p.justKnocked) continue;
      p.justKnocked = false;
      for (const n of npcs) {
        _v.subVectors(n.ped.position, p.position);
        const d = _v.length();
        if (d > SCARE_RADIUS) continue;
        if (d < 0.1) _v.set(this.rng.range(-1, 1), this.rng.range(-1, 1));
        this.#flee(n, _v.normalize().rotateAround(STAND, this.rng.range(-0.6, 0.6)), this.rng.range(3, 6));
      }
    }

    for (const n of npcs) {
      const p = n.ped;
      if (p.isDown) {
        p.update(dt, STAND, false, world);
        n.state = 'recover';
        continue;
      }
      if (n.state === 'recover') this.#flee(n, _v.set(this.rng.range(-1, 1), this.rng.range(-1, 1)).normalize(), 3);

      this.#dodgeCars(n, cars);

      switch (n.state) {
        case 'flee': {
          n.fleeTime -= dt;
          p.update(dt, n.dir, true, world);
          // Ran into a wall? Pick a new direction along it.
          if (p.speed < 0.5 && n.stateTime > 0.4) n.dir.rotateAround(STAND, Math.PI / 2), (n.stateTime = 0);
          if (n.fleeTime <= 0) this.#resnap(n);
          break;
        }
        case 'wait': {
          p.update(dt, STAND, false, world);
          const c = n.crossing;
          const faceTo = Math.atan2(c.dir.x, c.dir.y);
          const diff = Math.atan2(Math.sin(faceTo - p.heading), Math.cos(faceTo - p.heading));
          p.heading += diff * Math.min(1, 6 * dt);
          const green = lights.greenRemaining(c.node[0], c.node[1], c.greenAxis);
          if (green > CROSS_GREEN_NEEDED && roadClear(cars, c.mid)) {
            n.state = 'cross';
            n.stateTime = 0;
          } else if (n.stateTime > 20) {
            this.#chooseNext(n, false); // fed up waiting: walk somewhere else
          }
          break;
        }
        default: {
          // 'walk' or 'cross': head for the next waypoint.
          const tx = coord(n.to[0], n.inset), tz = coord(n.to[1], n.inset);
          _move.set(tx - p.position.x, tz - p.position.y);
          const d = _move.length();
          if (d < ARRIVE) {
            this.#chooseNext(n, true);
            p.update(dt, STAND, false, world);
            break;
          }
          _move.divideScalar(d);
          this.#avoidPeople(n, npcs, peds);
          const hurry = n.state === 'cross' && n.hurry > 0;
          _move.multiplyScalar(hurry ? 1 : n.pace);
          p.update(dt, _move, hurry, world);
          n.hurry -= dt;
          // Wedged against something for a while: give up on this waypoint.
          n.stuck = p.speed < 0.4 ? n.stuck + dt : 0;
          if (n.stuck > 3) this.#resnap(n);
        }
      }
      n.stateTime += dt;
    }
  }

  /** Per-frame: recycle far NPCs, spawn new ones out of view, update meshes. */
  manage(dt, focus) {
    let live = 0;
    for (const n of this.npcs) {
      if (!n.active) continue;
      const p = n.ped;
      if (Math.hypot(p.position.x - focus.x, p.position.y - focus.z) > this.despawn) {
        this.#release(n);
        continue;
      }
      live++;
      p.groundY = groundHeight(p.position.x, p.position.y);
      p.syncMesh(dt);
    }
    for (let k = live; k < this.count && k < live + 2; k++) this.#trySpawn(focus, this.spawnMin, this.spawnMax, 3);
  }

  // --- Behaviour ---

  #flee(n, dir, time) {
    n.state = 'flee';
    n.dir = (n.dir ?? new THREE.Vector2()).copy(dir);
    n.fleeTime = time;
    n.stateTime = 0;
  }

  /** Get out of the way of a car bearing down on us: dive to whichever side we're already on. */
  #dodgeCars(n, cars) {
    const p = n.ped;
    for (const car of cars) {
      const speed = car.speed;
      if (speed < 5) continue;
      const rx = p.position.x - car.position.x;
      const rz = p.position.y - car.position.y;
      if (rx * rx + rz * rz > 196) continue;
      const vx = car.velocity.x / speed, vz = car.velocity.y / speed;
      const along = rx * vx + rz * vz;
      const side = rx * vz - rz * vx;
      if (along < -1 || along > Math.max(5, speed * 1.1) || Math.abs(side) > 2.8) continue;
      if (n.state === 'cross' && n.crossing && Math.abs(n.crossing.dir.x * vx + n.crossing.dir.y * vz) < 0.5) {
        n.hurry = 1.5; // mid-crossing: just run for the other side
        return;
      }
      if (n.state !== 'flee') {
        const s = side >= 0 ? 1 : -1;
        this.#flee(n, _v.set(vz * s, -vx * s), this.rng.range(1.2, 2.2));
      }
      return;
    }
  }

  /** Steer around other people, keeping right when meeting someone head-on. */
  #avoidPeople(n, npcs, peds) {
    const p = n.ped;
    let ax = 0, az = 0;
    for (const o of peds) {
      if (o === p) continue;
      const rx = o.position.x - p.position.x;
      const rz = o.position.y - p.position.y;
      const d2 = rx * rx + rz * rz;
      if (d2 > 6.25 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const ahead = (rx * _move.x + rz * _move.y) / d;
      if (ahead < 0.2) continue;
      const w = (1 - d / 2.5) * ahead;
      // Sidestep to the right of our heading (right of (x, z) is (-z, x)), and away from them.
      ax += (-_move.y * 0.8 - (rx / d) * 0.6) * w;
      az += (_move.x * 0.8 - (rz / d) * 0.6) * w;
    }
    if (ax || az) {
      _move.x += ax;
      _move.y += az;
      _move.normalize();
    }
  }

  /** Arrived at a waypoint (or need a new plan): pick where to go next. */
  #chooseNext(n, arrived) {
    if (arrived) (n.prev = n.from), (n.from = n.to);
    const at = n.from;
    const allowCrossing = arrived;
    let options = neighbours(at[0], at[1]).filter((o) => !(n.prev && o[0] === n.prev[0] && o[1] === n.prev[1]));
    if (!allowCrossing) options = options.filter((o) => !crossingOf(at, o));
    if (options.length === 0) options = neighbours(at[0], at[1]).filter((o) => !crossingOf(at, o));
    // Weighted pick: crossing the street is a bit less likely than carrying on round the block.
    const weights = options.map((o) => (crossingOf(at, o) ? 0.6 : 1));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    let pick = options[0];
    for (let k = 0; k < options.length; k++) if ((r -= weights[k]) <= 0) (pick = options[k]), (k = options.length);

    n.to = pick;
    n.stateTime = 0;
    n.stuck = 0;
    const c = crossingOf(at, pick);
    if (c) {
      c.dir = new THREE.Vector2(pick[0] - at[0], pick[1] - at[1]);
      n.crossing = c;
      n.state = 'wait';
    } else {
      n.crossing = null;
      n.state = 'walk';
    }
  }

  /** Lost our place (after fleeing etc.): head to the nearest sidewalk corner and carry on. */
  #resnap(n) {
    const p = n.ped;
    n.to = [nearestIndex(p.position.x, n.inset), nearestIndex(p.position.y, n.inset)];
    n.from = null;
    n.prev = null;
    n.crossing = null;
    n.state = 'walk';
    n.stateTime = 0;
    n.stuck = 0;
  }

  // --- Pool ---

  #acquire() {
    let n = this.npcs.find((x) => !x.active);
    if (!n) {
      const ped = new Pedestrian();
      this.scene.add(ped.mesh);
      n = { ped };
      this.npcs.push(n);
    }
    const rng = this.rng;
    n.ped.setLook({
      shirt: rng.pick(SHIRTS),
      pants: rng.pick(PANTS),
      skin: rng.pick(SKINS),
      hair: rng.pick(HAIR),
      scale: rng.range(0.9, 1.08),
    });
    Object.assign(n, {
      active: true,
      inset: rng.range(1.8, 2.4),
      pace: rng.range(0.6, 0.85),
      state: 'walk',
      stateTime: 0,
      stuck: 0,
      hurry: 0,
      from: null,
      prev: null,
      to: null,
      crossing: null,
    });
    n.ped.active = true;
    n.ped.justKnocked = false;
    n.ped.mesh.visible = true;
    return n;
  }

  #release(n) {
    n.active = false;
    n.ped.active = false;
    n.ped.mesh.visible = false;
  }

  /** Place a walker somewhere along a block's sidewalk, `minD`..`maxD` from the focus. */
  #trySpawn(focus, minD, maxD, tries) {
    for (let t = 0; t < tries; t++) {
      const ix = this.rng.int(0, SIZE - 1);
      const iz = this.rng.int(0, SIZE - 1);
      // Walk along this side of the block: partner corner on the same block is index ^ 1.
      const to = this.rng.chance(0.5) ? [ix ^ 1, iz] : [ix, iz ^ 1];
      if (!isValid(...to)) continue;
      const inset = this.rng.range(1.8, 2.4);
      const f = this.rng.next();
      const x = coord(ix, inset) + (coord(to[0], inset) - coord(ix, inset)) * f;
      const z = coord(iz, inset) + (coord(to[1], inset) - coord(iz, inset)) * f;
      const dist = Math.hypot(x - focus.x, z - focus.z);
      if (dist < minD || dist > maxD) continue;
      if (this.npcs.some((o) => o.active && o.ped.position.distanceToSquared(_v.set(x, z)) < 4)) continue;

      const n = this.#acquire();
      n.inset = inset;
      n.ped.reset(x, z, Math.atan2(to[0] - ix, to[1] - iz));
      n.from = [ix, iz];
      n.to = to;
      return true;
    }
    return false;
  }
}

/** No car moving toward the crosswalk nearby. */
function roadClear(cars, mid) {
  for (const car of cars) {
    const rx = mid.x - car.position.x;
    const rz = mid.z - car.position.y;
    const d2 = rx * rx + rz * rz;
    if (d2 > 256) continue;
    if (car.speed > 2.5 && car.velocity.x * rx + car.velocity.y * rz > 0) return false;
  }
  return true;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}
