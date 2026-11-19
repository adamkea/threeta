import * as THREE from 'three';
import { circlePush } from '../world/colliders.js';
import { MODELS, buildCarMesh } from './carModels.js';
import { offIsland, WATER_Y } from '../world/City.js';
import { showBone } from '../render/skinBake.js';
import { VehicleDamage } from './damage.js';
import { SirenGlow } from '../effects/SirenGlow.js';

const GRAVITY = 25; // m/s² (a touch heavy, so falls read well from the high camera)
const SINK_DEPTH = -5; // how far a car sinks before settling on the seabed

let nextId = 1;
const _fwd = new THREE.Vector2();
const _right = new THREE.Vector2();
const _prevVel = new THREE.Vector2();
const WRECKED = { throttle: 0, steer: 0, handbrake: false };

const DEFAULTS = {
  engineAccel: 20, // m/s² at full throttle
  brakeDecel: 38,
  reverseAccel: 10,
  maxSpeed: 34, // ~122 km/h
  maxReverse: 9,
  drag: 0.35, // proportional drag (1/s)
  rolling: 2.0, // constant rolling resistance (m/s²)
  grip: 9, // lateral velocity damping (1/s) — higher = less sliding
  handbrakeGrip: 1.4,
  handbrakeDecel: 10,
  steerRate: 2.6, // max yaw rate (rad/s)
  steerResponse: 8, // how fast the wheel turns toward input
  length: 4.4,
  width: 2.0,
  collisionRadius: 1.05,
  restitution: 0.25,
  mass: 1, // relative, for car-vs-car impulses (a motorbike is much lighter)
};

const LEAN_MAX = 0.85; // rad: how far a bike can lean into a corner
const KICKSTAND_LEAN = -0.2; // parked bikes rest leaning to their left
const TOPPLED_LEAN = 1.4; // lying on its side

/**
 * Arcade car with top-down 2D physics on the XZ plane.
 * Heading 0 faces +Z. Forward vector = (sin h, cos h).
 */
export class Car {
  constructor({ model = 'sedan', color, stripes = null, ...opts } = {}) {
    this.modelName = model;
    this.model = MODELS[model];
    const m = this.model;
    // Base performance for this body style (traffic AI detunes it; see restorePerformance).
    this.perf = { ...DEFAULTS, ...m.cfg, collisionRadius: m.cfg.width / 2 + 0.05 };
    this.cfg = { ...this.perf, ...opts };
    this.position = new THREE.Vector2(0, 0); // x, z
    this.velocity = new THREE.Vector2(0, 0);
    this.heading = 0;
    this._fwd = new THREE.Vector2();
    this._right = new THREE.Vector2();
    this._fwdHeading = this._rightHeading = NaN;
    this.steer = 0; // smoothed -1..1
    this.braking = false;
    this.slip = 0;
    this.handbrake = false;
    this.id = nextId++;
    this.active = true; // inactive cars are pooled and skipped by physics/AI
    this.yawRate = 0; // extra spin from impacts (rad/s)
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    // Driven off the edge of the island: falls (y, vy) into the sea and sinks.
    this.overboard = false;
    this.y = 0;
    this.vy = 0;
    // Hardest crash (change in velocity, m/s) since the world last checked, and the velocity
    // at the start of the step it happened in (riders get thrown off bikes with it).
    this.jolt = 0;
    this.preVel = new THREE.Vector2();
    // Motorbikes: is someone on it (shows the rider; set by the world each step), and has it
    // been dropped on its side (it stays down until someone picks it up)?
    this.isBike = !!m.bike;
    this.ridden = false;
    this.toppled = 0; // 0 = upright, else -1 / 1 = lying on its left / right side
    const parts = buildCarMesh(model, color ?? m.paints[0]);
    this.mesh = parts.root;
    this.body = parts.body;
    this.paint = parts.paint;
    this.roofPaint = parts.roofPaint;
    this.stripeMat = parts.stripeMat;
    this.stripeGroup = parts.stripeGroup;
    this.tailMat = parts.tailMat;
    this.headMat = parts.headMat;
    this.wheels = parts.wheels;
    this.loose = parts.loose; // parts that can fall off in a crash
    this.sirenMats = parts.siren; // null unless the model has a lightbar
    this.sirenGlow = parts.siren ? new SirenGlow(this.mesh, this.body, parts.siren.lamps) : null;
    this.riderBone = parts.rider ?? null; // bikes only
    this.riderJacket = parts.riderJacket ?? null;
    this.helmet = parts.helmet ?? null;
    this.wheelR = parts.wheelR ?? 0.4;
    if (this.riderBone) showBone(this.riderBone, false); // nobody on it yet
    if (this.isBike) this.bodyRoll = KICKSTAND_LEAN;
    this.siren = false; // flashing lights on (police in pursuit)
    // Undamaged colours: damage tints from these (see VehicleDamage.refreshLook).
    this.baseColor = this.paint.color.clone();
    this.baseRoofColor = this.roofPaint.color.clone();
    this.baseStripeColor = this.stripeMat.color.clone();
    // Every vehicle can be damaged; the model's `damage` entry tunes it (see vehicles/damage.js).
    this.damage = new VehicleDamage(this, m.damage);
    this.setStripes(stripes);
  }

  /** Burnt-out shell: can't be driven or entered. */
  get wrecked() {
    return this.damage.destroyed;
  }

  /** Good as new: full health, all parts back on, fresh paint. */
  repair() {
    this.damage.repair();
  }

  get speed() {
    return this.velocity.length();
  }

  /**
   * Unit forward vector. Cached and shared (no allocation, AI reads it a lot): don't modify it,
   * and copy it if you need it to survive a change of heading.
   */
  get forward() {
    if (this._fwdHeading !== this.heading) {
      this._fwdHeading = this.heading;
      this._fwd.set(Math.sin(this.heading), Math.cos(this.heading));
    }
    return this._fwd;
  }

  /** Unit right vector; cached like `forward`. */
  get right() {
    if (this._rightHeading !== this.heading) {
      this._rightHeading = this.heading;
      this._right.set(-Math.cos(this.heading), Math.sin(this.heading));
    }
    return this._right;
  }

  reset(x, z, heading = 0, speed = 0) {
    this.position.set(x, z);
    this.heading = heading;
    this.velocity.copy(this.forward).multiplyScalar(speed);
    this.steer = 0;
    this.yawRate = 0;
    this.overboard = false;
    this.y = this.vy = this.bodyPitch = 0;
    this.toppled = 0;
    this.bodyRoll = this.isBike ? KICKSTAND_LEAN : 0;
  }

  /** Bikes: someone gets on (picking it up if it was lying down) or off. */
  setRidden(on) {
    if (on === this.ridden) return;
    this.ridden = on;
    if (on) this.toppled = 0;
    if (this.riderBone) showBone(this.riderBone, on);
  }

  /** Bikes: knocked over (rider thrown, burnt out). It lies on the side it was leaning toward. */
  topple() {
    if (this.isBike && !this.toppled) this.toppled = this.bodyRoll > 0 ? 1 : -1;
  }

  /** Under the surface: the car is lost (and anyone inside it). */
  get submerged() {
    return this.y < WATER_Y - 0.8;
  }

  setColor(color) {
    this.baseColor.set(color);
    this.damage?.refreshLook();
  }

  /** New random paint job from this model's palette (used when traffic respawns). */
  respray(rng) {
    this.setColor(rng.pick(this.model.paints));
    const sc = this.model.stripeChance ?? 0;
    this.setStripes(rng.chance(sc) ? rng.pick([0xffffff, 0x111111]) : null);
    if (this.isBike) this.dressRider(rng.pick(this.model.jackets), rng.pick(this.model.helmets));
  }

  /** Bikes: the rider's jacket and helmet colours. */
  dressRider(jacket, helmet) {
    this.riderJacket?.color.set(jacket);
    if (helmet != null) this.helmet?.color.set(helmet);
  }

  /** Undo AI detuning (e.g. once the player hijacks it). */
  restorePerformance() {
    this.cfg.engineAccel = this.perf.engineAccel;
    this.cfg.maxSpeed = this.perf.maxSpeed;
  }

  /** Twin racing stripes over hood, roof and trunk; pass null to remove. */
  setStripes(color) {
    showBone(this.stripeGroup, color != null);
    if (color != null) this.baseStripeColor.set(color);
    this.damage?.refreshLook();
  }

  /** Turning ability (0..1) at a given forward speed: none when stopped, slightly less when fast. */
  speedFactor(vF) {
    const s = Math.abs(vF);
    return Math.min(1, s / 5) * (1 - 0.35 * Math.min(1, s / this.cfg.maxSpeed));
  }

  /** Steering input (-1..1) needed to achieve a yaw rate (rad/s, positive = left). Used by AI. */
  steerForYawRate(yawRate) {
    const vF = this.velocity.dot(this.forward);
    const k = this.cfg.steerRate * this.speedFactor(vF) * Math.sign(vF);
    if (Math.abs(k) < 1e-3) return 0;
    return THREE.MathUtils.clamp(yawRate / k, -1, 1);
  }

  /** World positions of the two collision circles, written to `out` as [frontX, frontZ, rearX, rearZ]. */
  collisionCircles(out = new Float64Array(4)) {
    const fwd = this.forward;
    const o = this.cfg.length / 2 - this.cfg.collisionRadius;
    out[0] = this.position.x + fwd.x * o;
    out[1] = this.position.y + fwd.y * o;
    out[2] = this.position.x - fwd.x * o;
    out[3] = this.position.y - fwd.y * o;
    return out;
  }

  /**
   * Fixed-step physics update. `controls` = { throttle, steer, handbrake };
   * `world.query(x, z)` returns static AABB colliders near a point.
   */
  update(dt, controls, world) {
    if (!this.overboard && offIsland(this.position.x, this.position.y)) this.overboard = true;
    this.preVel.copy(this.velocity);
    this.damage.update(dt);
    if (this.overboard) return this.#fall(dt);
    const c = this.cfg;
    // Damage saps the engine and steering; a wreck gets no input at all.
    const dmg = this.damage.state;
    if (dmg.destroyed) this.topple();
    if (dmg.destroyed || this.toppled) controls = WRECKED;
    const maxSpeed = c.maxSpeed * Math.max(0.05, dmg.power);
    const engineAccel = c.engineAccel * dmg.power;
    // The pre-turn frame, held through the step (copies: the cached vectors follow the heading).
    const fwd = _fwd.copy(this.forward);
    const right = _right.copy(this.right);

    let vF = this.velocity.dot(fwd);
    let vR = this.velocity.dot(right);
    // Read by effects (skid marks): sideways slide speed and whether the handbrake is on.
    this.slip = Math.abs(vR);
    this.handbrake = !!controls.handbrake;

    // --- Throttle / brake / reverse ---
    this.braking = false;
    if (controls.throttle > 0) {
      if (vF < -0.5) {
        vF += c.brakeDecel * controls.throttle * dt;
        this.braking = true;
      } else {
        vF += engineAccel * controls.throttle * (1 - Math.max(0, vF) / maxSpeed) * dt * 1.6;
      }
    } else if (controls.throttle < 0) {
      if (vF > 0.5) {
        vF -= c.brakeDecel * -controls.throttle * dt;
        this.braking = true;
      } else {
        vF -= c.reverseAccel * dmg.power * -controls.throttle * dt;
      }
    }

    // --- Resistance ---
    vF -= vF * c.drag * dt;
    const roll = (controls.throttle === 0 ? c.rolling : c.rolling * 0.3) * dt;
    vF = Math.abs(vF) <= roll ? 0 : vF - Math.sign(vF) * roll;
    if (controls.handbrake) {
      const hb = c.handbrakeDecel * dt;
      vF = Math.abs(vF) <= hb ? 0 : vF - Math.sign(vF) * hb;
      this.braking = true;
    }
    if (dmg.destroyed) vF *= Math.exp(-2.5 * dt); // burnt tyres: it scrapes to a halt
    if (this.toppled) vF *= Math.exp(-1.8 * dt); // a dropped bike slides along on its side
    vF = THREE.MathUtils.clamp(vF, -c.maxReverse, Math.max(maxSpeed, c.maxSpeed * 0.3));

    // --- Lateral grip (low grip under handbrake = drift) ---
    const grip = controls.handbrake ? c.handbrakeGrip : c.grip;
    vR *= Math.exp(-grip * dt);

    // --- Steering ---
    this.steer += (controls.steer - this.steer) * Math.min(1, c.steerResponse * dt);
    // Need some speed to turn; turning gets a little less sharp at high speed.
    const drift = controls.handbrake ? 1.35 : 1;
    const h0 = this.heading;
    this.heading += this.steer * c.steerRate * dmg.steer * this.speedFactor(vF) * drift * Math.sign(vF) * dt;
    this.heading += this.yawRate * dt;
    this.yawRate *= Math.exp(-3 * dt);

    // Recompose velocity in the (old) car frame. Using the pre-turn frame means the
    // velocity lags behind the new heading slightly, which is what gives slides.
    this.velocity.set(fwd.x * vF + right.x * vR, fwd.y * vF + right.y * vR);

    const prevVel = _prevVel.copy(this.velocity);
    this.position.addScaledVector(this.velocity, dt);
    this.#collide(world);

    // --- Visual state ---
    this.wheelSpin += (vF * dt) / this.wheelR;
    const accel = (this.velocity.dot(fwd) - prevVel.dot(fwd)) / dt;
    this.bodyPitch += (THREE.MathUtils.clamp(-accel * 0.004, -0.06, 0.06) - this.bodyPitch) * Math.min(1, 6 * dt);
    if (this.isBike) return this.#lean(dt, vF, (this.heading - h0) / dt);
    const lateral = this.steer * Math.abs(vF) * 0.004 + vR * 0.01;
    this.bodyRoll += (THREE.MathUtils.clamp(lateral, -0.08, 0.08) - this.bodyRoll) * Math.min(1, 6 * dt);
  }

  /**
   * Bikes lean into corners (by the angle that balances the turn: tan lean = v·ω / g), stand on
   * the kickstand when parked, and lie flat once dropped. Pitch stays flat: no nose-dive under
   * braking on two wheels. Positive roll leans the bike to its right.
   */
  #lean(dt, vF, yaw) {
    let target;
    if (this.toppled) target = this.toppled * TOPPLED_LEAN;
    else if (!this.ridden && Math.abs(vF) < 1) target = KICKSTAND_LEAN;
    else target = THREE.MathUtils.clamp(-Math.atan((vF * yaw) / 9.81), -LEAN_MAX, LEAN_MAX);
    const rate = this.toppled ? 7 : 5;
    this.bodyRoll += (target - this.bodyRoll) * Math.min(1, rate * dt);
    this.bodyPitch *= Math.exp(-8 * dt);
  }

  /** Off the edge: no grip, no control. Momentum carries it out, the nose drops, then it sinks. */
  #fall(dt) {
    this.braking = this.handbrake = false;
    this.slip = 0;
    const inWater = this.y < WATER_Y;
    if (inWater) {
      // Water slows everything right down; the car settles slowly toward the bottom.
      this.velocity.multiplyScalar(Math.exp(-2.5 * dt));
      this.vy += (-1.2 - this.vy) * Math.min(1, 4 * dt);
    } else {
      this.vy -= GRAVITY * dt;
    }
    this.y = Math.max(SINK_DEPTH, this.y + this.vy * dt);
    this.position.addScaledVector(this.velocity, dt);
    this.heading += this.yawRate * dt;
    this.yawRate *= Math.exp(-3 * dt);
    // Nose-dive while airborne (the front wheels leave the quay first), easing level once afloat.
    const pitch = inWater ? 0.35 : Math.min(0.9, -this.vy * 0.06);
    this.bodyPitch += (pitch - this.bodyPitch) * Math.min(1, 5 * dt);
    this.bodyRoll *= Math.exp(-2 * dt);
  }

  /** Two collision circles along the car's long axis, resolved against AABBs. */
  #collide(world) {
    const c = this.cfg;
    const fwd = this.forward;
    const offset = c.length / 2 - c.collisionRadius;
    const r = c.collisionRadius;
    let worst = 0; // hardest hit this step (m/s into the wall)

    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const sign of [1, -1]) {
        const cx = this.position.x + fwd.x * offset * sign;
        const cz = this.position.y + fwd.y * offset * sign;
        for (const b of world.query(cx, cz)) {
          const push = circlePush(b, cx, cz, r);
          if (!push) continue;
          const { nx, nz, depth } = push;

          this.position.x += nx * depth;
          this.position.y += nz * depth;

          const vn = this.velocity.x * nx + this.velocity.y * nz;
          if (vn < 0) {
            worst = Math.max(worst, -vn);
            // Remove (and slightly bounce) the into-wall component, scrub some tangential speed.
            this.velocity.x -= (1 + c.restitution) * vn * nx;
            this.velocity.y -= (1 + c.restitution) * vn * nz;
            this.velocity.multiplyScalar(0.92);
            // Nudge heading so glancing hits deflect the car along the wall.
            const cross = fwd.x * nz - fwd.y * nx;
            this.heading += cross * Math.min(0.05, -vn * 0.004) * sign;
          }
          hit = true;
        }
      }
      if (!hit) break;
    }
    if (worst > 0) this.damage.impact(worst * (1 + c.restitution));
  }

  /** Copy physics state onto the Three.js mesh. Call once per rendered frame. */
  syncMesh() {
    const d = this.damage;
    // A burnt-out shell sits down on its rims; explosions throw the car up.
    this.mesh.position.set(this.position.x, this.y + d.hop - (d.destroyed ? 0.15 : 0), this.position.y);
    this.mesh.rotation.y = this.heading;
    this.body.rotation.set(this.bodyPitch + d.sag.pitch, 0, this.bodyRoll + d.sag.roll);
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer * (this.isBike ? 0.35 : 0.5);
    }
    this.tailMat.emissiveIntensity = d.destroyed ? 0 : this.braking ? 2.2 : 0.4;
    if (this.sirenMats) {
      // Alternate red / blue with a quick double-flash; dim and steady when off.
      const t = performance.now() / 1000 + this.id * 0.37;
      const phase = (t * 2.5) % 1;
      const flash = (k) => this.siren && phase > k && phase < k + 0.5 && (phase - k) % 0.25 < 0.17;
      if (d.destroyed) this.siren = false;
      this.sirenMats.red.color.setHex(flash(0) ? 0xff3040 : this.siren ? 0x4a0a10 : 0xa01820);
      this.sirenMats.blue.color.setHex(flash(0.5) ? 0x4a8cff : this.siren ? 0x0a1440 : 0x1c3ea8);
      this.sirenGlow.set(flash(0) ? 1 : 0, flash(0.5) ? 1 : 0);
    }
  }
}
