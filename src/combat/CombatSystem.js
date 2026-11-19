import * as THREE from 'three';

const PED_HIT_RADIUS = 0.55; // people are drawn big, so they're a bit fatter to bullets than to cars
const MUZZLE_FORWARD = 1.05; // where the muzzle sits relative to a person holding a gun out (m)
const MUZZLE_SIDE = 0.38; // …to their right
const MUZZLE_HEIGHT = 1.95;

const _dir = new THREE.Vector2();
const _right = new THREE.Vector2();
const _origin = new THREE.Vector2();
const _end = new THREE.Vector2();
const _axis = new THREE.Vector3(0, 0, 1);

/** Where a person's gun barrel is, in world space (x, height, z). */
export function muzzleOf(ped, out = new THREE.Vector3()) {
  const h = ped.heading;
  const fx = Math.sin(h), fz = Math.cos(h);
  const rx = -Math.cos(h), rz = Math.sin(h);
  return out.set(
    ped.position.x + fx * MUZZLE_FORWARD + rx * MUZZLE_SIDE,
    ped.groundY + MUZZLE_HEIGHT,
    ped.position.y + fz * MUZZLE_FORWARD + rz * MUZZLE_SIDE,
  );
}

/**
 * Resolves gunfire. Bullets are instant hitscan rays on the ground plane (heights are ignored;
 * people lying down are below the line of fire). A ray stops at the first person, car or building
 * it meets. Also owns the short-lived visuals: tracers, muzzle flashes and impact puffs.
 *
 * `onShot({ shooter, weapon, origin })` fires for every shot, `onHit({ shooter, weapon, target,
 * kind, killed, point })` for every bullet that hits something (kind: 'ped' | 'car' | 'wall').
 */
export class CombatSystem {
  /**
   * @param scene  THREE.Scene the effects go in
   * @param world  ColliderGrid of static boxes (buildings etc.)
   * @param peds   () => Pedestrian[]  everyone who can be shot
   * @param cars   () => Car[]         every car that can be shot
   * @param npcs   NpcManager (gunshots make people panic)
   */
  constructor(scene, { world, peds, cars, npcs }) {
    this.scene = scene;
    this.world = world;
    this.peds = peds;
    this.cars = cars;
    this.npcs = npcs;
    this.onShot = null;
    this.onHit = null;
    this.effects = new Effects(scene);
  }

  /**
   * `shooter` (a Pedestrian) fires `weapon` toward `aim` (Vector2 world point, or null = straight
   * ahead). `spreadMul` scales the gun's inaccuracy (e.g. worse for hurried NPCs), `damageMul` its damage.
   * Returns false if the gun couldn't fire (cooling down, reloading, empty).
   */
  fire(shooter, weapon, aim = null, { spreadMul = 1, damageMul = 1 } = {}) {
    if (shooter.isDown || !weapon.tryFire()) return false;
    const def = weapon.def;
    const muzzle = muzzleOf(shooter);
    // Bullets travel from the shooter's centre (so point-blank shots still land); the tracer is
    // drawn from the muzzle. Aim at the target point, unless it's right on top of us.
    _origin.copy(shooter.position);
    if (aim && aim.distanceTo(shooter.position) > 1.2) _dir.subVectors(aim, _origin).normalize();
    else _dir.set(Math.sin(shooter.heading), Math.cos(shooter.heading));
    shooter.recoil = 1;

    for (let k = 0; k < (def.pellets ?? 1); k++) {
      const d = _dir.clone().rotateAround(_end.set(0, 0), (Math.random() * 2 - 1) * def.spread * spreadMul);
      const hit = this.raycast(_origin, d, def.range, shooter);
      const dist = hit ? hit.distance : def.range;
      _end.copy(_origin).addScaledVector(d, dist);
      if (dist > MUZZLE_FORWARD + 0.5) this.effects.tracer(muzzle, _end); // point-blank: no streak
      if (hit) this.#applyHit(shooter, weapon, d, hit, def.damage * damageMul);
    }
    this.effects.flash(muzzle, shooter.heading);
    this.npcs.alarm(shooter.position, def.noise, { except: shooter, spareCops: true });
    this.onShot?.({ shooter, weapon, origin: shooter.position });
    return true;
  }

  #applyHit(shooter, weapon, dir, hit, damage) {
    const def = weapon.def;
    let killed = false;
    if (hit.kind === 'ped') {
      killed = hit.target.hurt(damage, dir.clone().multiplyScalar(def.knockback), shooter.position, shooter);
    } else if (hit.kind === 'car') {
      // Cars don't have health yet; they just take a nudge. (`car.health` is honoured if added.)
      hit.target.velocity.addScaledVector(dir, 0.15);
      killed = hit.target.health?.damage(damage, shooter) ?? false;
    }
    this.effects.impact(hit.point, hit.kind);
    this.onHit?.({ shooter, weapon, target: hit.target, kind: hit.kind, killed, point: hit.point });
  }

  /**
   * Nearest thing along a ray from `origin` (Vector2) in direction `dir` (unit Vector2) within
   * `range`: { kind, target, distance, point } or null. `ignore` is never hit (the shooter).
   */
  raycast(origin, dir, range, ignore = null) {
    let best = null;
    const consider = (t, kind, target) => {
      if (t !== null && t <= range && (!best || t < best.distance)) best = { kind, target, distance: t };
    };
    for (const p of this.peds()) {
      if (p === ignore || !p.active || p.isDown) continue;
      consider(rayCircle(origin, dir, p.position.x, p.position.y, PED_HIT_RADIUS), 'ped', p);
    }
    for (const c of this.cars()) {
      if (!c.active) continue;
      if (c.position.distanceToSquared(origin) > (range + 5) ** 2) continue;
      consider(rayCar(origin, dir, c), 'car', c);
    }
    // Buildings: check the grid cells the ray passes through (the grid stores boxes with a margin,
    // so sampling every few metres finds everything the ray could touch).
    const seen = new Set();
    const steps = Math.ceil(range / 4);
    for (let k = 0; k <= steps; k++) {
      const s = Math.min(range, k * 4);
      if (best && s > best.distance + 4) break;
      for (const b of this.world.query(origin.x + dir.x * s, origin.y + dir.y * s)) {
        if (seen.has(b)) continue;
        seen.add(b);
        if (b.maxX - b.minX < 1.5 && b.maxZ - b.minZ < 1.5) continue; // lamp posts / trees: shoot past
        consider(rayBox(origin, dir, b), 'wall', b);
      }
    }
    if (best) best.point = new THREE.Vector2().copy(origin).addScaledVector(dir, best.distance);
    return best;
  }

  /** Per-frame: animate and expire effects. */
  update(dt) {
    this.effects.update(dt);
  }
}

/** Distance along the ray to a circle, or null if it misses (or we start inside it). */
function rayCircle(o, d, cx, cz, r) {
  const ox = cx - o.x, oz = cz - o.y;
  const along = ox * d.x + oz * d.y;
  if (along < 0) return null;
  const perp2 = ox * ox + oz * oz - along * along;
  if (perp2 > r * r) return null;
  const t = along - Math.sqrt(r * r - perp2);
  return t >= 0 ? t : null;
}

/** Ray vs a car's body: an oriented box (length × width) around its position. */
function rayCar(o, d, car) {
  const f = car.forward, r = car.right;
  const rx = o.x - car.position.x, rz = o.y - car.position.y;
  // Origin and direction in the car's own frame (x = right, y = forward).
  const lo = { x: rx * r.x + rz * r.y, y: rx * f.x + rz * f.y };
  const ld = { x: d.x * r.x + d.y * r.y, y: d.x * f.x + d.y * f.y };
  const hw = car.cfg.width / 2, hl = car.cfg.length / 2;
  return slab(lo, ld, -hw, hw, -hl, hl);
}

/** Slab test against an axis-aligned box on the ground plane. */
function rayBox(o, d, b) {
  return slab(o, d, b.minX, b.maxX, b.minZ, b.maxZ);
}

/** Distance along ray (o, d) into the box [x0, x1] × [z0, z1], 0 if starting inside, or null. */
function slab(o, d, x0, x1, z0, z1) {
  let t0 = 0, t1 = Infinity;
  for (const [p, v, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, z0, z1]]) {
    if (Math.abs(v) < 1e-9) {
      if (p < lo || p > hi) return null;
      continue;
    }
    let a = (lo - p) / v, c = (hi - p) / v;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

const IMPACT_COLORS = { ped: 0xc8141c, car: 0xffd23a, wall: 0xd8d2c4 };

/** Pooled, short-lived gunfire visuals. */
class Effects {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.free = { tracer: [], flash: [], impact: [] };
    this.geo = {
      tracer: new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5), // unit length along +Z
      flash: new THREE.OctahedronGeometry(0.3, 0).scale(0.8, 0.5, 1.4),
      impact: new THREE.IcosahedronGeometry(0.22, 0),
    };
  }

  #get(type, color) {
    let m = this.free[type].pop();
    if (!m) {
      m = new THREE.Mesh(this.geo[type], new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.userData.type = type;
      this.scene.add(m);
    }
    m.material.color.set(color);
    m.material.opacity = 1;
    m.visible = true;
    m.scale.setScalar(1);
    m.rotation.set(0, 0, 0);
    return m;
  }

  /** Streak from the muzzle (Vector3) to `end` (Vector2 on the ground plane, same height). */
  tracer(from, end) {
    const m = this.#get('tracer', 0xfff3a8);
    const to = new THREE.Vector3(end.x, from.y, end.y);
    const len = from.distanceTo(to);
    m.position.copy(from);
    m.quaternion.setFromUnitVectors(_axis, to.sub(from).normalize());
    m.scale.set(0.16, 0.16, len);
    this.live.push({ m, age: 0, life: 0.07, kind: 'tracer' });
  }

  flash(at, heading) {
    const m = this.#get('flash', 0xffc23a);
    m.position.copy(at);
    m.rotation.y = heading;
    m.scale.setScalar(0.8 + Math.random() * 0.5);
    this.live.push({ m, age: 0, life: 0.05, kind: 'flash' });
  }

  impact(point, kind) {
    const m = this.#get('impact', IMPACT_COLORS[kind]);
    m.position.set(point.x, kind === 'ped' ? 1.6 : 1.4, point.y);
    this.live.push({ m, age: 0, life: kind === 'ped' ? 0.35 : 0.2, kind: 'impact' });
  }

  update(dt) {
    for (let k = this.live.length - 1; k >= 0; k--) {
      const e = this.live[k];
      e.age += dt;
      const t = e.age / e.life;
      if (t >= 1) {
        e.m.visible = false;
        this.free[e.m.userData.type].push(e.m);
        this.live.splice(k, 1);
        continue;
      }
      e.m.material.opacity = 1 - t;
      if (e.kind === 'impact') e.m.scale.setScalar(1 + t * 1.6);
    }
  }
}
