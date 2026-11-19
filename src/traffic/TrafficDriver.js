import { CITY } from '../world/City.js';
import {
  DIRS, EXIT_DIST, LANE_OFFSET, STOP_DIST, axisOf, isValidNode, nodeRange, nodeX, rightOf,
} from './RoadNetwork.js';

const DECEL = 6; // comfortable braking (m/s²) used for speed planning
const TURN_SPEED = 6.5;
const FOLLOW_GAP = 3; // metres bumper-to-bumper when queued
const CAR_LEN = 4.4;
const MAX_CLOSING = 40; // m/s: faster than any car, for sizing the oncoming-lane search
// Neighbour lists from the grid (drivers update one at a time, so these can be shared).
const _cars = [];
const _peds = [];
const _wide = [];


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
    this.reverseTime = 0; // backing up to make room to pull out
    this.waitTime = 0; // how long we've been stuck behind something other than a red light
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
    const leftTurn = d2[0] === -r[0] && d2[1] === -r[1];

    const p0 = { x: bx - d[0] * STOP_DIST + r[0] * LANE_OFFSET, z: bz - d[1] * STOP_DIST + r[1] * LANE_OFFSET };
    const p1 = { x: bx + d2[0] * EXIT_DIST + r2[0] * LANE_OFFSET, z: bz + d2[1] * EXIT_DIST + r2[1] * LANE_OFFSET };
    this.points.push(p0);
    this.stops.push({ ...p0, dir: d, node: B, axis: axisOf(d), turning, leftTurn });

    if (leftTurn) {
      // Cubic that cuts inside the junction centre, so opposing left turns pass side by side.
      const h = 4;
      const c1 = { x: p0.x + d[0] * h, z: p0.z + d[1] * h };
      const c2 = { x: p1.x - d2[0] * h, z: p1.z - d2[1] * h };
      for (let t = 1 / 6; t < 1.01; t += 1 / 6) {
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
        this.points.push({
          x: a * p0.x + b * c1.x + c * c2.x + e * p1.x,
          z: a * p0.z + b * c1.z + c * c2.z + e * p1.z,
          curve: true,
        });
      }
    } else if (turning) {
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

  /**
   * Returns controls for this physics step. `near` = the step's Neighbourhood (grids of cars
   * and of people standing in the road).
   */
  update(dt, near, lights) {
    const car = this.car;
    this.near = near;
    if (this.lost) {
      this.lostTime += dt;
      if (this.lostTime > 1.5 && car.speed < 2) this.#rejoin();
      if (this.lost) return { throttle: 0, steer: 0, handbrake: true };
    }

    const pos = car.position;
    const fwd = car.forward;
    const right = car.right;
    const vF = car.velocity.dot(fwd);
    // Everything the checks below look at is within 25 m (cars) / 20 m (people), plus a margin
    // for cars that have already moved this step.
    const cars = near.cars.query(pos.x, pos.y, 26, _cars);
    const peds = near.roadPeds.query(pos.x, pos.y, 21, _peds);

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
    // How far outside the road corridor we are: our lane through to the oncoming lane is fine.
    const lat = (pos.x - proj.x) * proj.lx + (pos.y - proj.z) * proj.lz; // + = left
    const corridor = LANE_OFFSET * 2 + 1;
    const dev = lat < -1 ? -1 - lat : lat > corridor ? lat - corridor : 0;
    if (dev > 6) {
      this.lost = true;
      this.lostTime = 0;
      this.overtaking = null;
      return { throttle: 0, steer: 0, handbrake: true };
    }

    // Backing up (nose swinging out) to get room to pass a stopped obstacle.
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      if (this.#clearBehind(cars)) return { throttle: vF > -1.5 ? -0.35 : 0, steer: -1, handbrake: false };
      this.reverseTime = 0;
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
      // (Yielding only matters within braking range: from 20 m out, sqrt(2·DECEL·dist) is
      // already above any cruise speed, so further away there's nothing to check.)
      const mustYield = stop.leftTurn && dist > -0.5 && dist < 20 && this.#oncomingTraffic(stop);
      if (light === 'red' || (light === 'yellow' && canStop) || mustYield) {
        if (dist > -0.5) {
          desired = Math.min(desired, Math.sqrt(2 * DECEL * Math.max(0, dist - 0.3)));
          waitingForLight = desired < 0.5;
        }
      }
    }

    if (this.ignoreCrossingTime > 0) this.ignoreCrossingTime -= dt;
    const follow = this.#followLimit(cars, peds, fwd, right, this.ignoreCrossingTime > 0);
    desired = Math.min(desired, follow.limit);
    this.#updateOvertake(dt, follow.blocker, stop, waitingForLight);
    if (this.overtaking) {
      // Crawl while pulling out until our side is clear of the car we're passing.
      // Crawl while pulling out, and never drive into what we're passing.
      const o = this.overtaking.car;
      const rx = o.position.x - pos.x, rz = o.position.y - pos.y;
      const isCar = !!o.cfg;
      const sideClear = Math.abs(rx * right.x + rz * right.y) > (isCar ? 2.3 : 1.7);
      if (!sideClear) {
        const along = rx * fwd.x + rz * fwd.y;
        const room = along - CAR_LEN / 2 - (isCar ? CAR_LEN / 2 : 0.4) - 0.6;
        desired = Math.min(desired, along > 0 ? Math.max(0, Math.min(2, 0.9 * room)) : 2);
        // Boxed in: back up a bit (swinging the nose out) if nothing's behind us.
        if (along > 0 && room < 0.4 && Math.abs(vF) < 0.3 && this.#clearBehind(cars)) this.reverseTime = 1.4;
      } else desired = Math.min(desired, 8);
    }

    this.waitTime = vF < 0.3 && desired < 0.3 && !waitingForLight ? this.waitTime + dt : 0;

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
    // Only lanes that could be within the 10 m we'll accept.
    const ri = nodeRange(pos.x, 10);
    const rj = nodeRange(pos.y, 10);
    if (!ri || !rj) return;
    for (let i = ri[0]; i <= ri[1]; i++) {
      for (let j = rj[0]; j <= rj[1]; j++) {
        for (const d of DIRS) {
          if (!isValidNode(i + d[0], j + d[1]) || d[0] * fwd.x + d[1] * fwd.y < 0.3) continue;
          const r = rightOf(d);
          // Lane segment from leaving node (i, j) to the stop line of the next node.
          const ax = nodeX(i) + r[0] * LANE_OFFSET, az = nodeX(j) + r[1] * LANE_OFFSET;
          const maxS = CITY.cell - STOP_DIST - 1;
          const s = (pos.x - ax) * d[0] + (pos.y - az) * d[1];
          const sc = Math.min(Math.max(s, 0), maxS);
          const px = ax + d[0] * sc, pz = az + d[1] * sc;
          const dist = Math.hypot(pos.x - px, pos.y - pz);
          // Aim a few metres further along the lane — it must be in front of us.
          const ts = Math.min(sc + 5, maxS);
          const tx = ax + d[0] * ts, tz = az + d[1] * ts;
          if ((tx - pos.x) * fwd.x + (tz - pos.y) * fwd.y < 1) continue;
          if (!best || dist < best.dist) best = { dist, i, j, d, tx, tz };
        }
      }
    }
    if (!best || best.dist > 10) return; // stranded (e.g. in a park): stay put until recycled
    this.from = [best.i, best.j];
    this.dir = best.d;
    this.points = [{ x: pos.x, z: pos.y }, { x: best.tx, z: best.tz }];
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
      const f = this.car.forward;
      const rel = (o.car.position.x - this.car.position.x) * f.x + (o.car.position.y - this.car.position.y) * f.y;
      if (rel < -6 || o.time > 12 || !o.car.active) {
        this.overtaking = null;
        this.shift = Math.max(0, this.#lateralOffset()); // ease back from where we actually are
      }
      return;
    }
    const stoppedBlocker = blocker && blocker.speed < 0.5;
    // Need room to get past before the junction: measure from the obstacle, not from us.
    const nearJunction =
      stop && blocker && (stop.x - blocker.position.x) * stop.dir[0] + (stop.z - blocker.position.y) * stop.dir[1] < 14;
    const curving = this.points[1].curve;
    if (stoppedBlocker && !waitingForLight && !curving && !nearJunction && this.#oncomingLaneClear(blocker)) {
      this.blockedTime += dt;
      if (this.blockedTime > 2.5) {
        this.overtaking = { car: blocker, time: 0 };
        this.blockedTime = 0;
      }
    } else this.blockedTime = 0;
  }

  /** Left turns yield to oncoming cars heading through the same junction (unless also turning left). */
  #oncomingTraffic(stop) {
    const me = this.car;
    // The zone is 0..40 m past our stop line, up to 12 m to the left.
    const cars = this.near.cars.query(stop.x + stop.dir[0] * 20, stop.z + stop.dir[1] * 20, 34, _wide);
    const [dx, dz] = stop.dir;
    const [rx, rz] = rightOf(stop.dir);
    for (const o of cars) {
      if (o === me || !o.active) continue;
      if (o.forward.x * dx + o.forward.y * dz > -0.7) continue; // not coming toward us
      // Position relative to our stop line: ahead (through the junction) and in the opposite lanes.
      const ox = o.position.x - stop.x, oz = o.position.y - stop.z;
      const along = ox * dx + oz * dz;
      const side = ox * rx + oz * rz; // negative = to our left
      if (along < 0 || along > 40 || side > -3 || side < -12) continue;
      const theirStop = o.ai?.stops[0];
      if (theirStop?.leftTurn && theirStop.node[0] === stop.node[0] && theirStop.node[1] === stop.node[1]) continue;
      // A car waiting far back (e.g. queued) isn't a threat; anything moving or close is.
      if (o.speed < 0.5 && along > 22) continue;
      // Already past the junction centre heading away? Then it's clear.
      const toNode = (nodeX(stop.node[0]) - o.position.x) * o.forward.x + (nodeX(stop.node[1]) - o.position.y) * o.forward.y;
      if (toNode < -3) continue;
      return true;
    }
    return false;
  }

  /** True if there's room to reverse: no car close behind us. */
  #clearBehind(cars) {
    const me = this.car;
    const fwd = me.forward;
    const right = me.right;
    for (const o of cars) {
      if (o === me || !o.active) continue;
      const rx = o.position.x - me.position.x, rz = o.position.y - me.position.y;
      const along = rx * fwd.x + rz * fwd.y;
      if (along < 0 && along > -CAR_LEN - 3 && Math.abs(rx * right.x + rz * right.y) < 2.6) return false;
    }
    return true;
  }

  /** Nothing in the oncoming lane between us and a bit past the obstacle (or heading our way soon). */
  #oncomingLaneClear(blocker) {
    const me = this.car;
    const fwd = me.forward, right = me.right;
    const bAlong = (blocker.position.x - me.position.x) * fwd.x + (blocker.position.y - me.position.y) * fwd.y;
    // Search a strip along the oncoming lane: from just behind us to past the blocker, far enough
    // ahead to see anything that could close the gap at up to MAX_CLOSING.
    const x0 = me.position.x, z0 = me.position.y;
    const reach = bAlong + 10 + MAX_CLOSING * 4;
    const lx = -right.x, lz = -right.y; // left
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const a of [-4, reach]) {
      for (const l of [0, 11]) {
        const x = x0 + fwd.x * a + lx * l, z = z0 + fwd.y * a + lz * l;
        minX = Math.min(minX, x), maxX = Math.max(maxX, x), minZ = Math.min(minZ, z), maxZ = Math.max(maxZ, z);
      }
    }
    const cars = this.near.cars.queryBox(minX - 1, minZ - 1, maxX + 1, maxZ + 1, _wide);
    for (const o of cars) {
      if (o === me || o === blocker || !o.active) continue;
      const rx = o.position.x - me.position.x, rz = o.position.y - me.position.y;
      const along = rx * fwd.x + rz * fwd.y;
      const left = -(rx * right.x + rz * right.y);
      if (left < 3.5 - 2.5 || left > 3.5 * 2 + 2.5) continue; // not in the oncoming lane
      const closing = Math.max(0, -o.velocity.dot(fwd)); // its speed toward us
      if (along > -3 && along < bAlong + 10 + closing * 4) return false;
    }
    return true;
  }

  /** True while physically over in the oncoming lane (overtaking or returning from it). */
  get inOncomingLane() {
    return !this.lost && this.#lateralOffset() > 1.5;
  }

  /** Current offset to the left of the route's current segment (m). */
  #lateralOffset() {
    const a = this.points[0], b = this.points[1];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const lx = (b.z - a.z) / len, lz = -(b.x - a.x) / len;
    return (this.car.position.x - a.x) * lx + (this.car.position.y - a.z) * lz;
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
  #followLimit(cars, peds, fwd, right, ignoreCrossing) {
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
      // Mutual block (each sees the other ahead, e.g. side by side mid-junction): lower id goes.
      const of = other.forward;
      const theirAlong = -(rx * of.x + rz * of.y);
      const theirLateral = Math.abs(rx * of.y - rz * of.x);
      if (theirAlong > 0 && theirLateral < 2.4 && me.id < other.id) continue;
      // Oncoming cars in their own lane just pass by. One in *our* lane (overtaking toward us)
      // does matter — except mid-turn, where the cone sweeps across the other lanes.
      const headOn = this.inOncomingLane || !!other.ai?.inOncomingLane;
      if (align < -0.7 && !this.overtaking && (this.points[1].curve || !headOn)) continue;
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
    // People in the road: stop short of them (and pass them if they just stand there).
    for (const p of peds) {
      if (!p.active || p === this.overtaking?.car) continue;
      const rx = p.position.x - me.position.x;
      const rz = p.position.y - me.position.y;
      if (rx * rx + rz * rz > 400) continue;
      const along = rx * fwd.x + rz * fwd.y;
      const lateral = Math.abs(rx * right.x + rz * right.y);
      if (along <= 0 || lateral > 1.9) continue;
      const l = Math.max(0, 0.9 * (along - CAR_LEN / 2 - 4.5));
      if (l < limit) {
        limit = l;
        blocker = p;
        queued = false;
      }
    }
    return { limit, blocker, queued };
  }
}

