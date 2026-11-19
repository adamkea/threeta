import * as THREE from 'three';
import { toon } from '../render/toon.js';

const BLAST_RADIUS = 9; // m
const BLAST_PED_DAMAGE = 180; // at the centre, falling to 0 at the edge
const BLAST_CAR_DAMAGE = 420;
const BLAST_PUSH = 16; // m/s shove at the centre
const CHAIN_DELAY = 0.25; // s before a blast reaches the next car (so chain reactions ripple)
const FX_RANGE = 130; // only cars this close to the camera smoke and burn
const MAX_PUFFS = 700;
const MAX_FLAMES = 400;
// Smoke puffs are lit (so they read as volumes); the city's bright sun and sky would wash dark
// smoke out to grey, so the puff material is dimmed and state colours are multiplied onto it.
const SMOKE_BASE = 0x808080;

const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _v = new THREE.Vector2();
const WHITE = new THREE.Color(0xffffff);
const FLAME_HOT = new THREE.Color(0xfff2a0);
const FLAME_COOL = new THREE.Color(0xe0361a);

/**
 * Runs vehicle damage for every car in the world: burns cars down, reacts to them changing
 * damage state (parts flying off, drivers bailing out, explosions) and draws the smoke, flames,
 * debris and blasts. The per-car rules live in VehicleDamage (vehicles/damage.js); this is the
 * part that needs to see the rest of the world.
 *
 * Hooks (all optional):
 *   onStateChange(car, state)            a car entered a new damage state
 *   onDestroyed(car, source)             a car blew up; `source` is who did it (for blame)
 *   onBlastHit(ped, killed, source)      an explosion hurt someone
 */
export class VehicleDamageSystem {
  /**
   * @param scene  THREE.Scene the effects go in
   * @param peds   () => Pedestrian[]  everyone who can be caught in a blast
   */
  constructor(scene, { peds }) {
    this.scene = scene;
    this.peds = peds;
    this.onStateChange = null;
    this.onDestroyed = null;
    this.onBlastHit = null;
    this.delayed = []; // blast damage on its way to nearby cars: { car, amount, source, t }
    this.puffs = new Particles(scene, MAX_PUFFS, new THREE.IcosahedronGeometry(0.5, 0), toon({ color: SMOKE_BASE }));
    this.flames = new Particles(scene, MAX_FLAMES, new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.debris = []; // { mesh, vel, spin, age }
    this.blasts = []; // { mesh, age }
    this.blastGeo = new THREE.IcosahedronGeometry(1, 1);
  }

  /** Fixed step: deliver delayed blast damage and react to every car's new damage states. */
  step(dt, cars) {
    for (let k = this.delayed.length - 1; k >= 0; k--) {
      const d = this.delayed[k];
      if ((d.t -= dt) > 0) continue;
      this.delayed.splice(k, 1);
      if (d.car.active) d.car.damage.hit(d.amount, d.source);
    }
    for (const car of cars) {
      const dmg = car.damage;
      while (dmg.transitions.length) {
        const state = dmg.transitions.shift();
        if (state.shed) for (const part of dmg.shedParts(state.shed)) this.#throwPart(car, part);
        this.onStateChange?.(car, state);
        if (state.destroyed) this.#explode(car, cars, dmg.lastSource);
      }
    }
  }

  /** Per frame: emit smoke / flames from damaged cars near `focus`, animate everything. */
  update(dt, cars, focus) {
    for (const car of cars) {
      if (!car.active || car.submerged) continue;
      const s = car.damage.state;
      if (!s.smoke && !s.fire) continue;
      if (Math.hypot(car.position.x - focus.x, car.position.y - focus.z) > FX_RANGE) continue;
      const dmg = car.damage;
      dmg.enginePoint(_p);
      if (dmg.emitting(s.smoke)) this.#emit(dt, car, s.smoke, (fx) => this.#puff(_p, fx, car));
      if (dmg.emitting(s.fire)) this.#emit(dt, car, s.fire, (fx) => this.#flame(_p, fx, car));
    }
    this.puffs.update(dt, (p, t) => {
      _c.copy(p.color).lerp(WHITE, t * 0.35);
      return Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - t * t); // grow, then shrink away
    });
    this.flames.update(dt, (p, t) => {
      _c.copy(FLAME_HOT).lerp(FLAME_COOL, Math.min(1, t * 1.4));
      return 1 - t;
    });
    this.#updateDebris(dt);
    this.#updateBlasts(dt);
  }

  /** Emit `fx.rate` particles per second (fractional counts carried between frames). */
  #emit(dt, car, fx, spawn) {
    const key = fx === car.damage.state.fire ? '_fireAcc' : '_smokeAcc';
    car[key] = (car[key] ?? 0) + fx.rate * dt;
    while (car[key] >= 1) {
      car[key] -= 1;
      spawn(fx);
    }
  }

  #puff(at, fx, car) {
    this.puffs.spawn({
      x: at.x + rand(0.4), y: at.y, z: at.z + rand(0.4),
      vx: car.velocity.x * 0.3 + rand(0.6), vy: 2 + Math.random() * 1.5, vz: car.velocity.y * 0.3 + rand(0.6),
      size: fx.size * (0.8 + Math.random() * 0.6), life: 1.4 + Math.random() * 0.8, color: new THREE.Color(fx.color),
      grow: 1.1,
    });
  }

  #flame(at, fx, car) {
    this.flames.spawn({
      x: at.x + rand(0.6), y: at.y - 0.2, z: at.z + rand(0.6),
      vx: car.velocity.x * 0.5 + rand(0.4), vy: 2.5 + Math.random() * 2, vz: car.velocity.y * 0.5 + rand(0.4),
      size: fx.size * (0.7 + Math.random() * 0.6), life: 0.35 + Math.random() * 0.3, color: null, grow: 0,
      spin: true,
    });
  }

  /** The final state: fireball, shove and hurt everything nearby, chain into other cars. */
  #explode(car, cars, source) {
    const dmg = car.damage;
    dmg.hopV = 7;
    car.yawRate += rand(2);
    dmg.enginePoint(_p);
    const cx = car.position.x, cz = car.position.y;

    // Fireball, flash and a cloud of black smoke.
    const flash = new THREE.Mesh(this.blastGeo, new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, depthWrite: false }));
    flash.position.set(cx, 1.2, cz);
    this.scene.add(flash);
    this.blasts.push({ mesh: flash, age: 0 });
    for (let k = 0; k < 40; k++) {
      const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      this.flames.spawn({ x: cx, y: 1.2, z: cz, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 7, vz: Math.sin(a) * sp,
        size: 1.2 + Math.random() * 1.4, life: 0.4 + Math.random() * 0.4, color: null, grow: 0, spin: true, drag: 3 });
    }
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5;
      this.puffs.spawn({ x: cx, y: 1.5, z: cz, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 4, vz: Math.sin(a) * sp,
        size: 1.2 + Math.random() * 1.0, life: 1.8 + Math.random() * 1.2, color: new THREE.Color(0x0c0c0e), grow: 1.3, drag: 1.5 });
    }
    for (const part of dmg.shedParts(car.loose.length)) this.#throwPart(car, part, 12);

    // People caught in it.
    for (const p of this.peds()) {
      if (!p.active || p.dead) continue;
      const d = Math.hypot(p.position.x - cx, p.position.y - cz);
      if (d > BLAST_RADIUS) continue;
      const k = 1 - d / BLAST_RADIUS;
      const away = _v.set(p.position.x - cx, p.position.y - cz).normalize().multiplyScalar(BLAST_PUSH * k).clone();
      const killed = p.hurt(BLAST_PED_DAMAGE * k, away, car.position, source);
      if (!killed && !p.dead) p.knockDown(away, 2.5);
      this.onBlastHit?.(p, killed, source);
    }
    // Other cars: shoved now, damaged a moment later (so chain reactions ripple outward).
    for (const o of cars) {
      if (o === car || !o.active || o.wrecked) continue;
      const d = Math.hypot(o.position.x - cx, o.position.y - cz);
      if (d > BLAST_RADIUS) continue;
      const k = 1 - d / BLAST_RADIUS;
      o.velocity.add(_v.set(o.position.x - cx, o.position.y - cz).normalize().multiplyScalar(BLAST_PUSH * 0.5 * k));
      o.yawRate += rand(1.5 * k);
      o.damage.hopV = Math.max(o.damage.hopV, 3 * k);
      this.delayed.push({ car: o, amount: BLAST_CAR_DAMAGE * k, source, t: CHAIN_DELAY + d * 0.03 });
    }
    this.onDestroyed?.(car, source);
  }

  /** A part knocked off a car: a copy tumbles away and lies in the road for a while. */
  #throwPart(car, part, speed = 5) {
    part.updateWorldMatrix(true, false);
    const mesh = part.clone();
    part.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.visible = true;
    this.scene.add(mesh);
    const out = _v.set(mesh.position.x - car.position.x, mesh.position.z - car.position.y).normalize();
    this.debris.push({
      mesh,
      vel: new THREE.Vector3(car.velocity.x * 0.6 + out.x * speed * Math.random(), 3 + Math.random() * speed * 0.5, car.velocity.y * 0.6 + out.y * speed * Math.random()),
      spin: new THREE.Vector3(rand(8), rand(8), rand(8)),
      age: 0,
    });
    if (this.debris.length > 60) this.#dropDebris(0);
  }

  #updateDebris(dt) {
    for (let k = this.debris.length - 1; k >= 0; k--) {
      const d = this.debris[k];
      d.age += dt;
      if (d.age > 15) {
        this.#dropDebris(k);
        continue;
      }
      const m = d.mesh;
      if (m.position.y > 0.08 || d.vel.y > 0) {
        d.vel.y -= 25 * dt;
        m.position.addScaledVector(d.vel, dt);
        m.rotation.x += d.spin.x * dt;
        m.rotation.y += d.spin.y * dt;
        m.rotation.z += d.spin.z * dt;
        if (m.position.y < 0.08) {
          m.position.y = 0.08;
          d.vel.multiplyScalar(0.35);
          d.vel.y = d.vel.y < -3 ? -d.vel.y * 0.3 : 0; // one small bounce, then it lies there
          d.spin.multiplyScalar(0.3);
        }
      }
      if (d.age > 13) m.scale.multiplyScalar(Math.exp(-4 * dt));
    }
  }

  #dropDebris(k) {
    this.scene.remove(this.debris[k].mesh);
    this.debris.splice(k, 1);
  }

  #updateBlasts(dt) {
    for (let k = this.blasts.length - 1; k >= 0; k--) {
      const b = this.blasts[k];
      b.age += dt;
      const t = b.age / 0.35;
      if (t >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.material.dispose();
        this.blasts.splice(k, 1);
        continue;
      }
      b.mesh.scale.setScalar(1 + t * 6);
      b.mesh.material.opacity = 1 - t;
    }
  }
}

/** A capped pool of simple particles drawn as one InstancedMesh. */
class Particles {
  constructor(scene, max, geo, mat) {
    this.list = [];
    this.max = max;
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, WHITE);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    p.age = 0;
    p.rot = Math.random() * Math.PI;
    this.list.push(p);
  }

  /** `shade(p, t)` sets _c to the particle's colour and returns its size factor. */
  update(dt, shade) {
    let n = 0;
    for (let k = this.list.length - 1; k >= 0; k--) {
      const p = this.list[k];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.list.splice(k, 1);
        continue;
      }
      const drag = Math.exp(-(p.drag ?? 0.8) * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy *= Math.exp(-0.6 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.spin) p.rot += 6 * dt;
      const size = p.size * (1 + p.grow * t) * shade(p, t);
      _q.setFromAxisAngle(_s.set(0, 1, 0), p.rot);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(Math.max(0.001, size)));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const rand = (r) => (Math.random() * 2 - 1) * r;
