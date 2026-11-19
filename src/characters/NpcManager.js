import * as THREE from 'three';
import { Pedestrian } from './Pedestrian.js';
import { groundHeight } from '../world/City.js';
import { WALK, nearestWaypoint, waypoint, waypointsNear } from './Sidewalks.js';

import { civilianLook, copLook, rollPerson } from './outfits.js';

const STAND = new THREE.Vector2();

const SCARE_RADIUS = 14; // people this close to someone getting run over panic
const CROSS_GREEN_NEEDED = 4; // seconds of green left needed to start crossing
const ARRIVE = 0.5;
const BODY_TIME = 25; // seconds a body stays on the street before it's cleared away
/** Hit points by role (a pistol does 34 a shot). */
const HEALTH = { civilian: 60, gang: 100, cop: 100 };

const _v = new THREE.Vector2();
// Neighbour lists from the grids (NPCs update one at a time, so these can be shared).
const _cars = [];
const _peds = [];
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

  /** After the player is moved across the city: drop people left far behind and fill in the new area. */
  repopulate(focus) {
    this.manage(0, focus);
    const live = this.npcs.filter((n) => n.active).length;
    for (let k = live; k < this.count; k++) this.#trySpawn(focus, 6, this.spawnMax, 30);
  }

  /** Spawn a panicked ex-driver at (x, z) who runs away from `threat` and from the car they left. */
  spawnFleeing(x, z, threat, car) {
    const n = this.#acquire({ role: 'civilian', gang: null, look: civilianLook(this.rng) });
    n.ped.reset(x, z);
    const fromThreat = new THREE.Vector2(x - threat.x, z - threat.y);
    const fromCar = new THREE.Vector2(x - car.x, z - car.y).normalize();
    const away = fromThreat.lengthSq() > 0.25 ? fromThreat.normalize().add(fromCar).normalize() : fromCar;
    // Veer a little so they don't all run in perfectly straight lines.
    away.rotateAround(STAND, this.rng.range(-0.5, 0.5));
    this.#flee(n, away, 5);
    return n.ped;
  }

  /**
   * Spawn a police officer at (x, z), e.g. jumping out of a patrol car. Returns the NPC so the
   * caller (PoliceSystem) can steer it with `n.busy` / `n.goal`.
   */
  spawnCop(x, z, heading = 0) {
    const n = this.#acquire({ role: 'cop', gang: null, look: copLook(this.rng) });
    n.ped.reset(x, z, heading);
    n.state = 'goto';
    n.busy = true;
    return n;
  }

  /** Remove an NPC from the world right away (e.g. an officer getting back into their car). */
  dismiss(n) {
    this.#release(n);
  }

  /** Hand a busy NPC back to the ambient AI: they carry on walking the sidewalks. */
  release(n) {
    n.ped.setWeapon(null);
    n.weapon = null;
    n.busy = false;
    n.goal = null;
    n.unit = null;
    this.#resnap(n);
  }

  /**
   * One fixed step for every NPC. NPCs with `busy` set are being driven by someone else: they
   * run to `n.goal` ({x, y}, at `n.goalSpeed`) and ignore their own fear and wandering. `peds` = everyone on foot (incl. the player),
   * `near` = the step's Neighbourhood (grids of active cars and of people).
   */
  step(dt, world, peds, near, lights) {
    const npcs = this.active;

    // Someone got knocked down (or killed): everyone nearby scatters.
    for (const p of peds) {
      if (!p.justKnocked) continue;
      p.justKnocked = false;
      this.alarm(p.position, SCARE_RADIUS);
    }

    for (const n of npcs) {
      const p = n.ped;
      if (p.dead) {
        p.update(dt, STAND, false, world);
        n.deadTime += dt;
        if (n.deadTime > BODY_TIME) this.#release(n);
        continue;
      }
      if (p.hurtFrom) {
        // Shot (but still standing): run away from whoever did it. Busy cops keep coming.
        if (!n.busy && n.role !== 'cop') this.#flee(n, _v.subVectors(p.position, p.hurtFrom).normalize(), this.rng.range(5, 8));
        p.hurtFrom = null;
      }
      if (p.isDown) {
        p.update(dt, STAND, false, world);
        if (!n.busy) n.state = 'recover';
        continue;
      }
      if (n.busy) {
        // Externally directed (police chasing the player): head straight for the goal.
        if (n.goal) {
          _move.set(n.goal.x - p.position.x, n.goal.y - p.position.y);
          const d = _move.length();
          if (d > 0.6) _move.multiplyScalar(Math.min(1, d / 2) * (n.goalSpeed ?? 1) / d);
          else _move.set(0, 0);
          // Wedged against a wall: veer off to one side for a moment to get round it.
          n.stuck = p.speed < 0.8 && d > 2 ? n.stuck + dt : 0;
          if (n.stuck > 0.4) (n.detour = 0.7), (n.detourSide = this.rng.chance(0.5) ? 1 : -1), (n.stuck = 0);
          if (n.detour > 0) (n.detour -= dt), _move.rotateAround(STAND, n.detourSide * 1.3);
          p.update(dt, _move, true, world);
        } else p.update(dt, STAND, false, world);
        n.stateTime += dt;
        continue;
      }
      if (n.state === 'recover') this.#flee(n, _v.set(this.rng.range(-1, 1), this.rng.range(-1, 1)).normalize(), 3);

      this.#dodgeCars(n, near.cars.query(p.position.x, p.position.y, 15, _cars));

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
          const green = lights.walkRemaining(c.node, c.edge);
          if (green > CROSS_GREEN_NEEDED && roadClear(near.cars.query(c.mid.x, c.mid.z, 17, _cars), c.mid)) {
            n.state = 'cross';
            n.stateTime = 0;
          } else if (n.stateTime > 20) {
            this.#chooseNext(n, false); // fed up waiting: walk somewhere else
          }
          break;
        }
        default: {
          // 'walk' or 'cross': head for the next waypoint.
          const t = waypoint(n.to, n.inset);
          _move.set(t.x - p.position.x, t.z - p.position.y);
          const d = _move.length();
          if (d < ARRIVE) {
            this.#chooseNext(n, true);
            p.update(dt, STAND, false, world);
            break;
          }
          _move.divideScalar(d);
          this.#avoidPeople(n, near.peds.query(p.position.x, p.position.y, 3, _peds));
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

  /**
   * Something frightening happened at `pos` (a gunshot, someone run over): everyone within
   * `radius` who isn't busy runs away from it. `except` is spared (e.g. the shooter).
   */
  alarm(pos, radius, { except = null, time = [3, 6], spareCops = false } = {}) {
    for (const n of this.active) {
      if (n.busy || n.ped.dead || n.ped === except || (spareCops && n.role === 'cop')) continue;
      _v.subVectors(n.ped.position, pos);
      const d = _v.length();
      if (d > radius) continue;
      if (d < 0.1) _v.set(this.rng.range(-1, 1), this.rng.range(-1, 1));
      this.#flee(n, _v.normalize().rotateAround(STAND, this.rng.range(-0.6, 0.6)), this.rng.range(...time));
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

  /** Get out of the way of a car bearing down on us (`cars` = those nearby): dive to whichever side we're already on. */
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

  /** Steer around other people (`peds` = those nearby), keeping right when meeting someone head-on. */
  #avoidPeople(n, peds) {
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
    const links = WALK.nodes[at].links;
    let options = links.filter((l) => l.to !== n.prev);
    if (!allowCrossing) options = options.filter((l) => !l.crossing);
    if (options.length === 0) options = links.filter((l) => !l.crossing);
    if (options.length === 0) options = links;
    // Weighted pick: crossing the street is a bit less likely than carrying on round the block.
    const weights = options.map((l) => (l.crossing ? 0.6 : 1));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    let pick = options[0];
    for (let k = 0; k < options.length; k++) if ((r -= weights[k]) <= 0) (pick = options[k]), (k = options.length);

    n.to = pick.to;
    n.stateTime = 0;
    n.stuck = 0;
    if (pick.crossing) {
      const a = WALK.nodes[at], b = WALK.nodes[pick.to];
      n.crossing = { ...pick.crossing, dir: new THREE.Vector2(b.x - a.x, b.z - a.z).normalize() };
      n.state = 'wait';
    } else {
      n.crossing = null;
      n.state = 'walk';
    }
  }

  /** Lost our place (after fleeing etc.): head to the nearest sidewalk corner and carry on. */
  #resnap(n) {
    const p = n.ped;
    n.to = nearestWaypoint(p.position.x, p.position.y);
    n.from = null;
    n.prev = null;
    n.crossing = null;
    n.state = 'walk';
    n.stateTime = 0;
    n.stuck = 0;
  }

  // --- Pool ---

  /** `person` = { role, gang, look } (see outfits.js rollPerson). */
  #acquire(person) {
    let n = this.npcs.find((x) => !x.active);
    if (!n) {
      const ped = new Pedestrian();
      this.scene.add(ped.mesh);
      n = { ped };
      this.npcs.push(n);
    }
    const rng = this.rng;
    n.ped.setLook(person.look);
    n.ped.role = person.role;
    n.ped.gang = person.gang;
    n.ped.health.reset(HEALTH[person.role] ?? 100);
    n.ped.hurtFrom = null;
    n.ped.setWeapon(null);
    Object.assign(n, {
      active: true,
      deadTime: 0,
      weapon: null, // a Weapon when this NPC has a gun out (cops at high wanted levels)
      busy: false,
      goal: null,
      unit: null,
      role: person.role,
      gang: person.gang,
      inset: rng.range(1.8, 2.4),
      // Cops walk a brisk beat; gang members take their time on their own turf.
      pace: person.role === 'cop' ? rng.range(0.8, 0.95) : person.role === 'gang' ? rng.range(0.5, 0.65) : rng.range(0.6, 0.85),
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
    // Only sidewalks that can reach the spawn ring around the focus.
    const near = waypointsNear(focus.x, focus.z, maxD);
    if (!near.length) return false;
    for (let t = 0; t < tries; t++) {
      const from = this.rng.pick(near);
      // Walk along this side of the block (not across a road).
      const side = WALK.nodes[from].links.filter((l) => !l.crossing);
      if (!side.length) continue;
      const to = this.rng.pick(side).to;
      const inset = this.rng.range(1.8, 2.4);
      const f = this.rng.next();
      const a = waypoint(from, inset), b = waypoint(to, inset);
      const x = a.x + (b.x - a.x) * f;
      const z = a.z + (b.z - a.z) * f;
      const dist = Math.hypot(x - focus.x, z - focus.z);
      if (dist < minD || dist > maxD) continue;
      if (this.npcs.some((o) => o.active && o.ped.position.distanceToSquared(_v.set(x, z)) < 4)) continue;

      const n = this.#acquire(rollPerson(this.rng, x, z));
      n.inset = inset;
      n.ped.reset(x, z, Math.atan2(b.x - a.x, b.z - a.z));
      n.from = from;
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
