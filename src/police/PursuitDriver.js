import { CITY } from '../world/City.js';
import { DIRS, isValidNode, nodeX } from '../traffic/RoadNetwork.js';
import { clearLine } from './sight.js';

const DIRECT_RANGE = 35; // closer than this with a clear view: drive straight at the target
const CORNER_SPEED = 10; // m/s through a turn at a junction
const BRAKE = 14; // m/s² used to plan slowing for corners

/** Index of the road line nearest to a coordinate. */
const nearestLine = (v) => Math.max(0, Math.min(CITY.blocks, Math.round((v - nodeX(0)) / CITY.cell)));

/**
 * Police driver: navigates the road grid junction by junction toward the target, then drives
 * straight at it (ramming welcome) once it's close and in view. Backs out when stuck.
 */
export class PursuitDriver {
  constructor(car) {
    this.car = car;
    this.node = null; // [i, j] junction we're heading for
    this.prev = null; // junction we came from (to avoid U-turns)
    this.direct = false;
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.reverseSteer = 0;
  }

  /**
   * Controls for one step. `target` = { position: Vector2, velocity: Vector2 } (car or person).
   * `stopNear` = pull up this far from a slow target instead of ramming it (officer will get out).
   */
  update(dt, target, world, stopNear = 0) {
    const car = this.car;
    const pos = car.position;
    const fwd = car.forward;
    const vF = car.velocity.dot(fwd);
    const tp = target.position;
    const dist = Math.hypot(tp.x - pos.x, tp.y - pos.y);

    // --- Where to aim ---
    this.direct = dist < DIRECT_RANGE && clearLine(world, pos.x, pos.y, tp.x, tp.y, 1.2);
    let ax, az;
    let cornerLimit = Infinity;
    if (this.direct) {
      // Lead the target a little so we cut it off instead of trailing behind.
      const lead = Math.min(0.3, dist / 40);
      ax = tp.x + target.velocity.x * lead;
      az = tp.y + target.velocity.y * lead;
      this.node = null;
    } else {
      if (!this.node) this.#plan(tp);
      let nx = nodeX(this.node[0]), nz = nodeX(this.node[1]);
      // Switch to the next junction a bit early so we carve the corner.
      if (Math.hypot(nx - pos.x, nz - pos.y) < Math.max(6, Math.abs(vF) * 0.45)) {
        this.#advance(tp);
        nx = nodeX(this.node[0]);
        nz = nodeX(this.node[1]);
      }
      ax = nx;
      az = nz;
      // Slow down for the junction if the following leg turns.
      const next = this.#bestNext(this.node, this.prev, tp, true);
      if (next && this.prev) {
        const inX = this.node[0] - this.prev[0], inZ = this.node[1] - this.prev[1];
        const outX = next[0] - this.node[0], outZ = next[1] - this.node[1];
        if (inX * outX + inZ * outZ < 1) {
          const d = Math.hypot(nx - pos.x, nz - pos.y);
          cornerLimit = Math.sqrt(CORNER_SPEED ** 2 + 2 * BRAKE * Math.max(0, d - 8));
        }
      }
    }

    // --- Steering toward the aim point (angle > 0 = to our left) ---
    const dx = ax - pos.x, dz = az - pos.y;
    const right = car.right;
    const angle = Math.atan2(-(dx * right.x + dz * right.y), dx * fwd.x + dz * fwd.y);

    // Reversing out of trouble (stuck on a wall, or target right behind us).
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      return { throttle: -1, steer: this.reverseSteer, handbrake: false };
    }

    let desired = car.cfg.maxSpeed;
    desired = Math.min(desired, cornerLimit);
    if (Math.abs(angle) > 1.2) desired = Math.min(desired, 9); // way off line: slow and turn
    if (this.direct && stopNear > 0) {
      // Pull up beside a slow target rather than through it.
      // Inside the stop distance, stop — don't keep pace with (and bulldoze) someone on foot.
      const keepPace = dist > stopNear ? target.velocity.length() : 0;
      desired = Math.min(desired, Math.max(0, (dist - stopNear) * 1.2) + keepPace);
    }

    // Target behind us and we're slow: three-point turn by reversing with opposite lock.
    if (Math.abs(angle) > 2.2 && Math.abs(vF) < 4 && dist > 6) {
      this.reverseTime = 0.9;
      this.reverseSteer = -Math.sign(angle);
      return { throttle: -1, steer: this.reverseSteer, handbrake: false };
    }

    const steer = Math.max(-1, Math.min(1, angle * 1.6));
    let throttle;
    const err = desired - vF;
    if (err > 0) throttle = Math.min(1, 0.3 + err * 0.3);
    else throttle = vF > 1 ? Math.max(-1, err * 0.25) : 0;
    // Handbrake slide for hard turns at speed: looks great and actually helps.
    const handbrake = Math.abs(angle) > 0.9 && vF > 14;

    // Stuck: flooring it but not moving.
    if (throttle > 0.3 && Math.abs(vF) < 1) {
      this.stuckTime += dt;
      if (this.stuckTime > 0.8) {
        this.stuckTime = 0;
        this.reverseTime = 1.1;
        this.reverseSteer = -Math.sign(angle || 1);
        this.node = null; // re-plan from wherever we end up
      }
    } else this.stuckTime = 0;

    return { throttle, steer, handbrake };
  }

  /** Choose the first junction to head for: close by, roughly ahead, and toward the target. */
  #plan(tp) {
    const pos = this.car.position;
    const fwd = this.car.forward;
    const ci = nearestLine(pos.x), cj = nearestLine(pos.y);
    let best = null;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (!isValidNode(i, j)) continue;
        const nx = nodeX(i), nz = nodeX(j);
        // Only junctions reachable along a road: on the same road line as us (or the one we're in).
        const onRoadX = Math.abs(pos.y - nz) < CITY.roadWidth / 2 + 1;
        const onRoadZ = Math.abs(pos.x - nx) < CITY.roadWidth / 2 + 1;
        if (!onRoadX && !onRoadZ) continue;
        const behind = (nx - pos.x) * fwd.x + (nz - pos.y) * fwd.y < -2;
        const score =
          Math.hypot(nx - pos.x, nz - pos.y) + Math.abs(nx - tp.x) + Math.abs(nz - tp.y) + (behind ? 30 : 0);
        if (!best || score < best.score) best = { score, node: [i, j] };
      }
    }
    // Off the road grid entirely (e.g. in a park): just head for the nearest junction.
    this.node = best ? best.node : [ci, cj];
    this.prev = null;
  }

  #advance(tp) {
    const next = this.#bestNext(this.node, this.prev, tp, false);
    this.prev = this.node;
    this.node = next ?? this.prev;
  }

  /** Neighbouring junction that gets us closest to the target, avoiding U-turns. */
  #bestNext(node, prev, tp, peek) {
    if (!node) return null;
    let best = null;
    for (const d of DIRS) {
      const n = [node[0] + d[0], node[1] + d[1]];
      if (!isValidNode(n[0], n[1])) continue;
      const uTurn = prev && n[0] === prev[0] && n[1] === prev[1];
      const straight = prev && n[0] - node[0] === node[0] - prev[0] && n[1] - node[1] === node[1] - prev[1];
      const score =
        Math.abs(nodeX(n[0]) - tp.x) + Math.abs(nodeX(n[1]) - tp.y) + (uTurn ? CITY.cell * 1.5 : 0) - (straight ? 4 : 0);
      if (!best || score < best.score) best = { score, n };
    }
    return best?.n ?? (peek ? null : node);
  }
}
