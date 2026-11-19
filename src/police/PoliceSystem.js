import * as THREE from 'three';
import { Car } from '../vehicles/Car.js';
import { headingOf, randomLaneSpot } from '../traffic/RoadNetwork.js';
import { PursuitDriver } from './PursuitDriver.js';
import { clearLine } from './sight.js';
import { WEAPONS, Weapon } from '../combat/weapons.js';

/** Patrol cars hunting the player at each wanted level. */
const UNITS_BY_STARS = [0, 1, 2, 3, 5, 7];
const CAR_SIGHT = 70; // how far a patrol car can spot the player (with a clear line)
const FOOT_SIGHT = 35;
const FOOT_GIVE_UP = 55; // cops on foot stop chasing beyond this
const DEPLOY_RANGE = 13; // officer jumps out when the car is this close to a slow/on-foot player
const BUST_RANGE = 1.5; // cop this close to a person on foot is making the arrest
const BUST_TIME = 0.9; // seconds of contact needed
const COP_RUN = 1.08; // cops run slightly faster than the player, so a foot chase can be lost only by breaking sight
const HEAR_RANGE = 18; // a chasing car this close keeps track of the player even without a clear view
const DISPATCH_EVERY = 5; // seconds between radio updates of the player's position to units that lost sight
const SPAWN_MIN = 65; // just outside the camera's view
const SPAWN_MAX = 115;
const DESPAWN = 240;
const SHOOT_AT_STARS = 3; // officers on foot draw their pistols at this wanted level
const SHOOT_RANGE = 24;
const SHOOT_MIN = 3.5; // closer than this they go for the arrest instead
const SHOT_GAP = [1.1, 2.0]; // seconds between an officer's shots
const COP_SPREAD = 4; // multiplier on the pistol's spread: running and gunning isn't accurate
const COP_DAMAGE = 0.6; // fraction of the pistol's damage (keeps fights survivable)

/**
 * Police response to the wanted level: spawns patrol cars that chase the player (and pulls in
 * patrol cars already in traffic), deploys officers on foot when the player is stopped, sends
 * nearby beat cops after the player, and decides when the player is busted.
 */
export class PoliceSystem {
  constructor(scene, rng, { traffic, npcs }) {
    this.scene = scene;
    this.rng = rng;
    this.traffic = traffic;
    this.npcs = npcs;
    this.units = []; // { car, driver, state: 'chase'|'deployed'|'idle', officer, cooldown }
    this.pool = [];
    this.bustTime = 0;
    this.busted = false;
    this.combat = null; // CombatSystem, once it exists (lets officers shoot)
  }

  /** Active patrol cars (for physics, traffic AI and collisions). */
  get cars() {
    return this.units.map((u) => u.car);
  }

  owns(car) {
    return this.units.some((u) => u.car === car);
  }

  /** Any police (car or on foot) that could see `pos`, within `range`? */
  witnesses(pos, world, range = 40) {
    for (const u of this.units) {
      if (u.state !== 'idle' && this.#sees(u.car.position, pos, range, world)) return true;
    }
    for (const c of this.traffic.cars) {
      if (c.active && c.modelName === 'police' && this.#sees(c.position, pos, range, world)) return true;
    }
    for (const n of this.npcs.active) {
      if (n.role === 'cop' && !n.ped.isDown && this.#sees(n.ped.position, pos, range, world)) return true;
    }
    return false;
  }

  /** Is anyone in the police currently keeping track of the player? */
  canSee(pos, world) {
    for (const u of this.units) {
      if (u.state !== 'chase') continue;
      if (u.car.position.distanceTo(pos) < HEAR_RANGE || this.#sees(u.car.position, pos, CAR_SIGHT, world)) return true;
    }
    for (const n of this.npcs.active) {
      if (n.role === 'cop' && n.busy && !n.ped.isDown && this.#sees(n.ped.position, pos, FOOT_SIGHT, world)) return true;
    }
    return false;
  }

  #sees(from, to, range, world) {
    const dx = to.x - from.x, dz = to.y - from.y;
    if (dx * dx + dz * dz > range * range) return false;
    return clearLine(world, from.x, from.y, to.x, to.y);
  }

  /**
   * The player took a patrol car. If an officer was still at the wheel they're thrown out at
   * `spot` (and they're not happy about it).
   */
  surrender(car, spot) {
    const u = this.units.find((x) => x.car === car);
    if (!u) return;
    this.units.splice(this.units.indexOf(u), 1);
    car.siren = false;
    car.restorePerformance();
    if (u.state === 'chase') {
      const n = this.npcs.spawnCop(spot.x, spot.y, car.heading);
      n.goalSpeed = COP_RUN;
    }
    if (u.officer?.active) u.officer.unit = null;
  }

  /** Everyone stands down (wanted level cleared or player busted). */
  standDown() {
    this.bustTime = 0;
    this.busted = false;
    for (const u of this.units) {
      u.state = 'idle';
      u.car.siren = false;
      if (u.officer?.active) this.npcs.release(u.officer);
      u.officer = null;
      u.returning = false;
    }
    for (const n of this.npcs.active) if (n.role === 'cop' && n.busy) this.npcs.release(n);
  }

  /** One fixed step: drive the patrol cars, direct cops on foot, check for an arrest. */
  step(dt, { player, wanted, world }) {
    const target = player.body;
    const tp = target.position;
    const playerSlow = !player.inVehicle || target.speed < 3;
    const hunting = wanted.stars > 0 && !this.busted && !(!player.inVehicle && player.ped.dead);

    for (const u of this.units) {
      const car = u.car;
      u.cooldown = Math.max(0, u.cooldown - dt);
      let controls = { throttle: 0, steer: 0, handbrake: false };
      const dist = Math.hypot(tp.x - car.position.x, tp.y - car.position.y);

      if (!hunting && u.state !== 'idle') u.state = 'idle';
      if (u.state === 'chase') {
        car.siren = true;
        // Faster at higher wanted levels, with a burst of catch-up speed when far behind.
        // Close in they're a match for a sports car (so you can still shake them with good driving).
        // Even flat out they only just match the quickest cars, so good driving loses them.
        const far = dist > 60;
        car.cfg.maxSpeed = far ? 36 : 29 + wanted.stars;
        car.cfg.engineAccel = far ? 23 : 17 + wanted.stars;
        // Units only know where the player is while they can see (or hear) them; otherwise they
        // head for the last sighting, refreshed now and then by dispatch.
        u.dispatch -= dt;
        if (dist < HEAR_RANGE || this.#sees(car.position, tp, CAR_SIGHT, world)) {
          u.lastKnown.copy(tp);
          u.lastVel.copy(target.velocity);
          u.dispatch = DISPATCH_EVERY;
        } else if (u.dispatch <= 0) {
          u.lastKnown.copy(tp);
          u.lastVel.set(0, 0);
          u.dispatch = DISPATCH_EVERY;
        }
        u.ghost.position = u.lastKnown;
        u.ghost.velocity = u.lastVel;
        controls = u.driver.update(dt, u.ghost, world, playerSlow ? 7 : 0);
        // Close to a stopped (or on-foot) suspect: an officer gets out to make the arrest.
        // Right on top of them: stop and get out rather than nudging them down the street.
        const stopped = car.speed < (dist < 6 ? 7 : 3);
        if (playerSlow && dist < DEPLOY_RANGE && stopped && u.cooldown === 0 && (u.driver.direct || dist < 6)) {
          const side = car.right.clone().multiplyScalar(-(car.cfg.width / 2 + 0.8));
          u.officer = this.npcs.spawnCop(car.position.x + side.x, car.position.y + side.y, car.heading);
          u.officer.unit = u;
          u.officer.goalSpeed = COP_RUN;
          u.state = 'deployed';
        }
      } else if (u.state === 'deployed') {
        controls = { throttle: 0, steer: 0, handbrake: true };
        const o = u.officer;
        if (!o?.active || o.unit !== u || o.ped.dead) {
          // Officer lost track of (despawned far away): the car carries on alone.
          u.officer = null;
          u.state = 'chase';
        } else {
          const toCar = o.ped.position.distanceTo(car.position);
          const toSuspect = o.ped.position.distanceTo(tp);
          // Suspect's driving off: run back to the car and give chase. Turn back if they stop again.
          if (player.inVehicle && target.speed > 6 && toSuspect > 9) u.returning = true;
          else if (playerSlow && toSuspect < 8) u.returning = false;
          if (u.returning) {
            u.boardSpot.copy(car.position).addScaledVector(car.right, -(car.cfg.width / 2 + 0.6));
            o.goal = u.boardSpot;
            if (toCar < 2.8) {
              this.npcs.dismiss(o);
              u.officer = null;
              u.returning = false;
              u.state = 'chase';
              u.cooldown = 5;
            }
          }
        }
      } else {
        car.siren = false;
        controls = { throttle: 0, steer: 0, handbrake: car.speed < 2 };
      }
      car.update(dt, controls, world);
    }

    // --- Cops on foot ---
    let arresting = false;
    for (const n of this.npcs.active) {
      if (n.role !== 'cop') continue;
      const p = n.ped;
      const d = p.position.distanceTo(tp);
      const ownUnit = n.unit && this.units.includes(n.unit) ? n.unit : null;
      if (!hunting) {
        if (n.busy) this.npcs.release(n);
        continue;
      }
      if (!n.busy) {
        // Beat cops join in when they see the suspect nearby.
        if (d < FOOT_SIGHT * 0.8 && !p.isDown && clearLine(world, p.position.x, p.position.y, tp.x, tp.y)) {
          n.busy = true;
          n.state = 'goto';
          n.goalSpeed = COP_RUN;
        } else continue;
      } else if (d > FOOT_GIVE_UP && !ownUnit) {
        this.npcs.release(n);
        continue;
      }
      if (!ownUnit?.returning) n.goal = tp;
      if (p.isDown || n.goal !== tp) continue;
      this.#shootAt(n, d, dt, { player, wanted, world });

      // Arrest: right next to someone on foot, or at the door of a car that's stopped.
      if (player.inVehicle) {
        const reach = target.cfg.width / 2 + 1.2;
        const inCarReach = target.speed < 1.5 && d < Math.max(reach, target.cfg.length / 2 + 0.6);
        if (inCarReach) arresting = true;
      } else if (d < BUST_RANGE) arresting = true;
    }
    this.bustTime = arresting ? this.bustTime + dt : Math.max(0, this.bustTime - dt * 2);
    if (this.bustTime > BUST_TIME && hunting) this.busted = true;
  }

  /** An officer chasing on foot opens fire at a dangerous suspect who's also on foot. */
  #shootAt(n, d, dt, { player, wanted, world }) {
    const p = n.ped;
    const tp = player.ped.position;
    const draw = this.combat && wanted.stars >= SHOOT_AT_STARS && !player.inVehicle;
    if (!draw) {
      if (n.weapon) (n.weapon = null), p.setWeapon(null);
      return;
    }
    if (!n.weapon) {
      n.weapon = new Weapon(WEAPONS.pistol, { reserve: Infinity });
      n.shotWait = this.rng.range(...SHOT_GAP); // draw, then a moment to aim
      p.setWeapon(n.weapon.def);
    }
    n.weapon.update(dt);
    n.shotWait -= dt;
    if (n.shotWait > 0 || d < SHOOT_MIN || d > SHOOT_RANGE) return;
    if (!clearLine(world, p.position.x, p.position.y, tp.x, tp.y)) return;
    p.heading = Math.atan2(tp.x - p.position.x, tp.y - p.position.y); // square up to the target
    if (this.combat.fire(p, n.weapon, tp, { spreadMul: COP_SPREAD, damageMul: COP_DAMAGE })) n.shotWait = this.rng.range(...SHOT_GAP);
  }

  /** Per-frame bookkeeping: bring in or retire patrol cars to match the wanted level. */
  manage({ player, wanted, world }, allCars) {
    const tp = player.body.position;
    // Retire cars that are far away (or no longer needed and out of view).
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      const d = u.car.position.distanceTo(tp);
      if (d > DESPAWN || (u.state === 'idle' && d > 90)) this.#retire(u);
    }
    if (!wanted.stars || this.busted) return;

    // Patrol cars already in traffic that spot the player join the chase.
    for (const car of this.traffic.cars) {
      if (!car.active || car.modelName !== 'police') continue;
      if (!this.#sees(car.position, tp, 60, world)) continue;
      this.traffic.release(car);
      this.#enlist(car);
    }

    const chasing = this.units.filter((u) => u.state !== 'idle').length;
    const idle = this.units.find((u) => u.state === 'idle');
    if (chasing < UNITS_BY_STARS[wanted.stars]) {
      // Re-task a stood-down car nearby before calling in a new one.
      if (idle) (idle.state = 'chase'), (idle.driver = new PursuitDriver(idle.car)), (idle.dispatch = 0);
      else this.#trySpawn(player.body, allCars);
    }
  }

  #enlist(car) {
    car.active = true;
    car.mesh.visible = true;
    car.ai = null;
    const u = {
      car,
      driver: new PursuitDriver(car),
      state: 'chase',
      officer: null,
      cooldown: 0,
      returning: false,
      boardSpot: new THREE.Vector2(),
      lastKnown: new THREE.Vector2(Infinity, Infinity), // filled on the first step
      lastVel: new THREE.Vector2(),
      dispatch: 0,
      ghost: { position: null, velocity: null },
    };
    this.units.push(u);
    return u;
  }

  #retire(u) {
    this.units.splice(this.units.indexOf(u), 1);
    if (u.officer?.active) this.npcs.release(u.officer);
    u.car.active = false;
    u.car.mesh.visible = false;
    u.car.siren = false;
    this.pool.push(u.car);
  }

  /** Bring a new patrol car in on a road out of view, pointed roughly at the player. */
  #trySpawn(target, others) {
    const tp = target.position;
    const v = target.velocity;
    const moving = v.length() > 8;
    for (let t = 0; t < 10; t++) {
      const spot = randomLaneSpot(this.rng, tp.x, tp.y, SPAWN_MAX);
      if (!spot) continue;
      const { x, z, d } = spot;
      const dist = Math.hypot(x - tp.x, z - tp.y);
      if (dist < SPAWN_MIN || dist > SPAWN_MAX) continue;
      if ((tp.x - x) * d[0] + (tp.y - z) * d[1] < 0) continue; // face the player's way
      // A suspect on the move gets cut off from ahead rather than followed from behind.
      if (moving && ((x - tp.x) * v.x + (z - tp.y) * v.y) / v.length() < 10) continue;
      if (others.some((o) => o.active && Math.hypot(o.position.x - x, o.position.y - z) < 8)) continue;

      let car = this.pool.pop();
      if (!car) {
        car = new Car({ model: 'police' });
        this.scene.add(car.mesh);
      }
      car.repair();
      car.reset(x, z, headingOf(d), 12);
      this.#enlist(car);
      return true;
    }
    return false;
  }
}
