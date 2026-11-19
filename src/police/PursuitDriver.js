import { GRAPH } from '../traffic/RoadNetwork.js';
import { clearLine } from './sight.js';

const DIRECT_RANGE = 35; // closer than this with a clear view: drive straight at the target
const CORNER_SPEED = 10; // m/s through a turn at a junction
const BRAKE = 14; // m/s² used to plan slowing for corners

/**
 * Road distance from every junction to a target point: Dijkstra over the road graph, seeded
 * from both ends of the road nearest the target.
 */
export function distancesTo(x, z) {
  const g = GRAPH;
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const near = g.nearestLane(x, z, 0, 0, -2, 60);
  const seeds = near
    ? [g.from(near.h), g.to(near.h)]
    : [g.nodes.reduce((b, n) => (Math.hypot(n.x - x, n.z - z) < Math.hypot(b.x - x, b.z - z) ? n : b)).id];
  const open = [];
  for (const id of seeds) {
    dist[id] = Math.hypot(g.nodes[id].x - x, g.nodes[id].z - z);
    open.push(id);
  }
  // The graph is small (~100 junctions): a linear scan for the closest open node is plenty.
  const done = new Uint8Array(g.nodes.length);
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[k]]) k = i;
    const n = open.splice(k, 1)[0];
    if (done[n]) continue;
    done[n] = 1;
    for (const h of g.nodes[n].out) {
      const m = g.to(h);
      const d = dist[n] + g.edge(h).len;
      if (d < dist[m]) {
        dist[m] = d;
        open.push(m);
      }
    }
  }
  return dist;
}

const nodePos = (id) => GRAPH.nodes[id];

/**
 * Police driver: navigates the road grid junction by junction toward the target, then drives
 * straight at it (ramming welcome) once it's close and in view. Backs out when stuck.
 */
export class PursuitDriver {
  constructor(car) {
    this.car = car;
    this.node = null; // junction (node id) we're heading for
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
      if (this.node === null) this.#plan(tp);
      let { x: nx, z: nz } = nodePos(this.node);
      // Switch to the next junction a bit early so we carve the corner.
      if (Math.hypot(nx - pos.x, nz - pos.y) < Math.max(6, Math.abs(vF) * 0.45)) {
        this.#advance(tp);
        ({ x: nx, z: nz } = nodePos(this.node));
      }
      ax = nx;
      az = nz;
      // Slow down for the junction if the following leg turns.
      const next = this.#bestNext(this.node, this.prev, tp, true);
      if (next !== null && this.prev !== null) {
        const P = nodePos(this.prev), C = nodePos(this.node), X = nodePos(next);
        const inX = C.x - P.x, inZ = C.z - P.z, outX = X.x - C.x, outZ = X.z - C.z;
        if (inX * outX + inZ * outZ < 0.95 * Math.hypot(inX, inZ) * Math.hypot(outX, outZ)) {
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

  /** Choose the first junction to head for: an end of the road we're on, roughly ahead and toward the target. */
  #plan(tp) {
    const g = GRAPH;
    const pos = this.car.position;
    const fwd = this.car.forward;
    this.dist = distancesTo(tp.x, tp.y);
    this.distAge = 0;
    const near = g.nearestLane(pos.x, pos.y, 0, 0, -2, 40);
    let best = null;
    const ends = near ? [g.from(near.h), g.to(near.h)] : [];
    for (const id of ends) {
      const n = g.nodes[id];
      const behind = (n.x - pos.x) * fwd.x + (n.z - pos.y) * fwd.y < -2;
      const score = Math.hypot(n.x - pos.x, n.z - pos.y) + this.dist[id] + (behind ? 30 : 0);
      if (!best || score < best.score) best = { score, id };
    }
    // Off the roads entirely (e.g. in a park): just head for the nearest junction.
    this.node = best ? best.id : g.nodes.reduce((b, n) => (Math.hypot(n.x - pos.x, n.z - pos.y) < Math.hypot(b.x - pos.x, b.z - pos.y) ? n : b)).id;
    this.prev = null;
  }

  #advance(tp) {
    // The target moves: refresh the road distances to it every few junctions.
    if (++this.distAge > 2 || !this.dist) {
      this.dist = distancesTo(tp.x, tp.y);
      this.distAge = 0;
    }
    const next = this.#bestNext(this.node, this.prev, tp, false);
    this.prev = this.node;
    this.node = next ?? this.prev;
  }

  /** Neighbouring junction on the shortest road route to the target, avoiding U-turns. */
  #bestNext(node, prev, tp, peek) {
    if (node === null) return null;
    const g = GRAPH;
    const C = g.nodes[node];
    const P = prev !== null ? g.nodes[prev] : null;
    let best = null;
    for (const h of C.out) {
      const n = g.to(h);
      const N = g.nodes[n];
      const uTurn = n === prev;
      let straight = false;
      if (P) {
        const ix = C.x - P.x, iz = C.z - P.z, ox = N.x - C.x, oz = N.z - C.z;
        straight = ix * ox + iz * oz > 0.95 * Math.hypot(ix, iz) * Math.hypot(ox, oz);
      }
      const score = g.edge(h).len + this.dist[n] + (uTurn ? 120 : 0) - (straight ? 4 : 0);
      if (!best || score < best.score) best = { score, n };
    }
    return best?.n ?? (peek ? null : node);
  }
}
