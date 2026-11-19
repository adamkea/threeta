import { CITY } from '../world/City.js';
import {
  DIRS, EXIT_DIST, LANE_OFFSET, STOP_DIST, axisOf, isValidNode, nodeX, rightOf,
} from './RoadNetwork.js';

const DECEL = 6; // comfortable braking (m/s²) used for speed planning
const TURN_SPEED = 6.5;
const FOLLOW_GAP = 3; // metres bumper-to-bumper when queued
const CAR_LEN = 4.4;

/**
 * AI that drives a Car along lanes: picks a random route at each intersection,
 * follows it with pure-pursuit steering, stops at red lights and behind other cars.
 */
export class TrafficDriver {
  /** Start on the lane heading from node `from` in direction `dir`, at world point (x, z). */
  constructor(car, rng, from, dir, x, z) {
    this.car = car;
    this.rng = rng;
    this.from = from;
    this.dir = dir;
    this.points = [{ x, z }];
    this.stops = [];
    this.cruise = rng.range(10, 14);
    this.lost = false; // knocked off its route; waits, then tries to rejoin a lane
    this.lostTime = 0;
    this.stuckTime = 0;
    this.ignoreCrossingTime = 0;
    this.blockedTime = 0;
    this.overtaking = null; // { car, time } while pulling around a stopped car
    this.shift = 0; // current lateral offset from the lane (m, positive = left)
    while (this.points.length < 8) this.#extend();
  }

  /** Append the next intersection (stop line, turn curve, exit) to the route. */
  #extend() {
    const [i, j] = this.from;
    const d = this.dir;
    const B = [i + d[0], j + d[1]];
    const bx = nodeX(B[0]);
    const bz = nodeX(B[1]);
    const r = rightOf(d);

    // Choose where to go next: never U-turn, favour going straight.
    const options = DIRS.filter((d2) => !(d2[0] === -d[0] && d2[1] === -d[1]) && isValidNode(B[0] + d2[0], B[1] + d2[1]));
    const straight = options.find((d2) => d2[0] === d[0] && d2[1] === d[1]);
    const d2 = straight && this.rng.chance(0.5) ? straight : this.rng.pick(options);
    const r2 = rightOf(d2);
    const turning = d2 !== straight;

    const p0 = { x: bx - d[0] * STOP_DIST + r[0] * LANE_OFFSET, z: bz - d[1] * STOP_DIST + r[1] * LANE_OFFSET };
    const p1 = { x: bx + d2[0] * EXIT_DIST + r2[0] * LANE_OFFSET, z: bz + d2[1] * EXIT_DIST + r2[1] * LANE_OFFSET };
    this.points.push(p0);
    this.stops.push({ ...p0, dir: d, node: B, axis: axisOf(d), turning });

    if (turning) {
      // Quadratic Bézier through the corner where the entry and exit lane lines meet.
      const c = { x: bx + (r[0] + r2[0]) * LANE_OFFSET, z: bz + (r[1] + r2[1]) * LANE_OFFSET };
      for (let t = 0.2; t < 1.01; t += 0.2) {
        const u = 1 - t;
        this.points.push({
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
          z: u * u * p0.z + 2 * u * t * c.z + t * t * p1.z,
          curve: true,
        });
      }
    } else {
      this.points.push(p1);
    }
    this.from = B;
    this.dir = d2;
  }

  /** Returns controls for this physics step. `cars` = every car in the world (incl. player). */
  update(dt, cars, lights) {
    const car = this.car;
    if (this.lost) {
      this.lostTime += dt;
      if (this.lostTime > 1.5 && car.speed < 2) this.#rejoin();
      if (this.lost) return { throttle: 0, steer: 0, handbrake: true };
    }

    const pos = car.position;
    const fwd = car.forward;
    const right = car.right;
    const vF = car.velocity.dot(fwd);

    // --- Track progress along the route polyline ---
    let proj;
    for (;;) {
      const a = this.points[0];
      const b = this.points[1];
      const sx = b.x - a.x, sz = b.z - a.z;
      const len2 = sx * sx + sz * sz || 1;
      const t = ((pos.x - a.x) * sx + (pos.y - a.z) * sz) / len2;
      if (t >= 1) {
        this.points.shift();
        if (this.points.length < 8) this.#extend();
        continue;
      }
      const tc = Math.max(0, t);
      const len = Math.sqrt(len2);
      proj = { x: a.x + sx * tc, z: a.z + sz * tc, lx: sz / len, lz: -sx / len };
      break;
    }
    // Deviation from where we mean to be (the lane, shifted left while overtaking).
    const dev = Math.hypot(pos.x - (proj.x + proj.lx * this.shift), pos.y - (proj.z + proj.lz * this.shift));
    if (dev > 6) {
      this.lost = true;
      this.lostTime = 0;
      this.overtaking = null;
      return { throttle: 0, steer: 0, handbrake: true };
    }

    // --- Pure pursuit: aim at a point `look` metres further along the route ---
    const look = (this.overtaking || this.shift > 0.5 ? 5 : 3) + Math.abs(vF) * 0.35;
    const target = this.#pointAlong(proj, look);
    // Lateral offset changes per metre travelled (not per second), so a stopped car never drifts.
    const shiftGoal = this.overtaking ? LANE_OFFSET * 2 : 0;
    this.shift += (shiftGoal - this.shift) * Math.min(1, 0.3 * Math.abs(vF) * dt);
    const tx = target.x + target.lx * this.shift - pos.x;
    const tz = target.z + target.lz * this.shift - pos.y;
    const left = -(tx * right.x + tz * right.y);
    const curvature = (2 * left) / (tx * tx + tz * tz || 1);
    const steer = car.steerForYawRate(curvature * Math.max(vF, 0.5));

    // --- Speed planning ---
    let desired = this.cruise;
    let waitingForLight = false;
    if (this.points[1].curve || this.points[2]?.curve) desired = Math.min(desired, TURN_SPEED);

    while (this.stops.length && this.#along(this.stops[0]) < -1) this.stops.shift();
    const stop = this.stops[0];
    if (stop) {
      const dist = this.#along(stop);
      if (stop.turning) desired = Math.min(desired, Math.sqrt(TURN_SPEED ** 2 + 2 * DECEL * Math.max(0, dist)));
      const light = lights.state(stop.node[0], stop.node[1], stop.axis);
      const canStop = dist > (vF * vF) / (2 * DECEL * 1.5);
      if (light === 'red' || (light === 'yellow' && canStop)) {
        if (dist > -0.5) {
          desired = Math.min(desired, Math.sqrt(2 * DECEL * Math.max(0, dist - 0.3)));
          waitingForLight = desired < 0.5;
        }
      }
    }

    if (this.ignoreCrossingTime > 0) this.ignoreCrossingTime -= dt;
    const follow = this.#followLimit(cars, fwd, right, this.ignoreCrossingTime > 0);
    desired = Math.min(desired, follow.limit);
    this.#updateOvertake(dt, follow.blocker, stop, waitingForLight);
    if (this.overtaking) {
      // Crawl while pulling out until our side is clear of the car we're passing.
      const o = this.overtaking.car;
      const rx = o.position.x - pos.x, rz = o.position.y - pos.y;
      const sideClear = Math.abs(rx * right.x + rz * right.y) > 2.3;
      desired = Math.min(desired, sideClear ? 8 : 2);
    }

    // Gridlock breaker: cars waiting on each other across an intersection — creep forward.
    if (vF < 0.3 && desired < 0.3 && !waitingForLight && !follow.queued) {
      this.stuckTime += dt;
      if (this.stuckTime > 4) {
        this.ignoreCrossingTime = 1.5;
        this.stuckTime = 0;
      }
    } else this.stuckTime = 0;

    // --- Throttle / brake ---
    if (desired < 0.3 && vF < 1.5) return { throttle: 0, steer, handbrake: true };
    const err = desired - vF;
    let throttle = 0;
    if (err > 0) throttle = Math.min(1, err * 0.6);
    else if (vF > 1) throttle = Math.max(-1, err * 0.4);
    return { throttle, steer, handbrake: false };
  }

  /** After a crash: find the nearest lane heading roughly our way and rebuild the route from it. */
  #rejoin() {
    const pos = this.car.position;
    const fwd = this.car.forward;
    let best = null;
    const n = CITY.blocks;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        for (const d of DIRS) {
          if (!isValidNode(i + d[0], j + d[1]) || d[0] * fwd.x + d[1] * fwd.y < 0.3) continue;
          const r = rightOf(d);
          // Lane segment from leaving node (i, j) to the stop line of the next node.
          const ax = nodeX(i) + r[0] * LANE_OFFSET, az = nodeX(j) + r[1] * LANE_OFFSET;
          const s = (pos.x - ax) * d[0] + (pos.y - az) * d[1];
          const sc = Math.min(Math.max(s, EXIT_DIST), CITY.cell - STOP_DIST - 2);
          const px = ax + d[0] * sc, pz = az + d[1] * sc;
          const dist = Math.hypot(pos.x - px, pos.y - pz);
          if (!best || dist < best.dist) best = { dist, i, j, d, px, pz, sc };
        }
      }
    }
    if (!best || best.dist > 10) return; // stranded (e.g. in a park): stay put until recycled
    const ahead = Math.min(6, CITY.cell - STOP_DIST - best.sc);
    this.from = [best.i, best.j];
    this.dir = best.d;
    this.points = [{ x: pos.x, z: pos.y }, { x: best.px + best.d[0] * ahead, z: best.pz + best.d[1] * ahead }];
    this.stops = [];
    this.shift = 0;
    while (this.points.length < 8) this.#extend();
    this.lost = false;
  }

  /** Pull into the oncoming lane to pass a car that's stopped in our lane (e.g. the player). */
  #updateOvertake(dt, blocker, stop, waitingForLight) {
    if (this.overtaking) {
      const o = this.overtaking;
      o.time += dt;
      const rel = o.car.position.clone().sub(this.car.position).dot(this.car.forward);
      if (rel < -6 || o.time > 10 || !o.car.active) this.overtaking = null;
      return;
    }
    const stoppedBlocker = blocker && blocker.speed < 0.5;
    const nearJunction = stop && this.#along(stop) < 14;
    const curving = this.points[1].curve;
    if (stoppedBlocker && !waitingForLight && !nearJunction && !curving) {
      this.blockedTime += dt;
      if (this.blockedTime > 2.5) {
        this.overtaking = { car: blocker, time: 0 };
        this.blockedTime = 0;
      }
    } else this.blockedTime = 0;
  }

  /** Signed distance along a stop's travel direction from the car to the stop line. */
  #along(stop) {
    return (stop.x - this.car.position.x) * stop.dir[0] + (stop.z - this.car.position.y) * stop.dir[1];
  }

  #pointAlong(from, dist) {
    let px = from.x, pz = from.z;
    for (let k = 1; k < this.points.length; k++) {
      const q = this.points[k];
      const seg = Math.hypot(q.x - px, q.z - pz);
      if (seg >= dist) {
        const f = dist / (seg || 1);
        const ux = (q.x - px) / (seg || 1), uz = (q.z - pz) / (seg || 1);
        // lx/lz: unit vector to the left of the path here (left = -right = (dz, -dx)).
        return { x: px + (q.x - px) * f, z: pz + (q.z - pz) * f, lx: uz, lz: -ux };
      }
      dist -= seg;
      px = q.x;
      pz = q.z;
    }
    return { x: px, z: pz, lx: 0, lz: 0 };
  }

  /**
   * Max speed that keeps a safe gap to the nearest car in our path. `blocker` is that car;
   * `queued` means it's travelling our way (a queue, not a gridlock).
   */
  #followLimit(cars, fwd, right, ignoreCrossing) {
    let limit = Infinity;
    let blocker = null;
    let queued = false;
    const me = this.car;
    for (const other of cars) {
      if (other === me || !other.active || other === this.overtaking?.car) continue;
      const rx = other.position.x - me.position.x;
      const rz = other.position.y - me.position.y;
      if (rx * rx + rz * rz > 625) continue;
      const along = rx * fwd.x + rz * fwd.y;
      const lateral = Math.abs(rx * right.x + rz * right.y);
      if (along <= 0 || lateral > 2.4) continue;
      const align = other.forward.dot(fwd);
      // Oncoming cars normally just pass by — unless we're in their lane overtaking.
      if (align < -0.7 && !this.overtaking) continue;
      if (ignoreCrossing && Math.abs(align) < 0.7) continue;
      const leadSpeed = Math.max(0, other.velocity.dot(fwd));
      const gap = along - CAR_LEN;
      const l = Math.max(0, leadSpeed + 0.9 * (gap - FOLLOW_GAP));
      if (l < limit) {
        limit = l;
        blocker = other;
        queued = align > 0.7;
      }
    }
    return { limit, blocker, queued };
  }
}

