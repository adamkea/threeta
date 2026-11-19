import * as THREE from 'three';
import { toon } from '../render/toon.js';

// Tunable handling parameters (SI-ish units: metres, seconds).
let nextId = 1;

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
};

/**
 * Arcade car with top-down 2D physics on the XZ plane.
 * Heading 0 faces +Z. Forward vector = (sin h, cos h).
 */
export class Car {
  constructor({ color = 0xd23b2f, stripes = null, ...opts } = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.position = new THREE.Vector2(0, 0); // x, z
    this.velocity = new THREE.Vector2(0, 0);
    this.heading = 0;
    this.steer = 0; // smoothed -1..1
    this.braking = false;
    this.id = nextId++;
    this.active = true; // inactive cars are pooled and skipped by physics/AI
    this.yawRate = 0; // extra spin from impacts (rad/s)
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.mesh = this.#buildMesh(color);
    this.setStripes(stripes);
  }

  get speed() {
    return this.velocity.length();
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  get right() {
    return new THREE.Vector2(-Math.cos(this.heading), Math.sin(this.heading));
  }

  reset(x, z, heading = 0, speed = 0) {
    this.position.set(x, z);
    this.heading = heading;
    this.velocity.copy(this.forward).multiplyScalar(speed);
    this.steer = 0;
    this.yawRate = 0;
  }

  setColor(color) {
    this.paint.color.set(color);
  }

  /** Twin racing stripes over hood, roof and trunk; pass null to remove. */
  setStripes(color) {
    this.stripeGroup.visible = color != null;
    if (color != null) this.stripeMat.color.set(color);
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

  /** World positions of the two collision circles (front, rear). */
  collisionCircles() {
    const fwd = this.forward;
    const o = this.cfg.length / 2 - this.cfg.collisionRadius;
    return [
      [this.position.x + fwd.x * o, this.position.y + fwd.y * o],
      [this.position.x - fwd.x * o, this.position.y - fwd.y * o],
    ];
  }

  /**
   * Fixed-step physics update. `controls` = { throttle, steer, handbrake };
   * `world.query(x, z)` returns static AABB colliders near a point.
   */
  update(dt, controls, world) {
    const c = this.cfg;
    const fwd = this.forward;
    const right = this.right;

    let vF = this.velocity.dot(fwd);
    let vR = this.velocity.dot(right);

    // --- Throttle / brake / reverse ---
    this.braking = false;
    if (controls.throttle > 0) {
      if (vF < -0.5) {
        vF += c.brakeDecel * controls.throttle * dt;
        this.braking = true;
      } else {
        vF += c.engineAccel * controls.throttle * (1 - Math.max(0, vF) / c.maxSpeed) * dt * 1.6;
      }
    } else if (controls.throttle < 0) {
      if (vF > 0.5) {
        vF -= c.brakeDecel * -controls.throttle * dt;
        this.braking = true;
      } else {
        vF -= c.reverseAccel * -controls.throttle * dt;
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
    vF = THREE.MathUtils.clamp(vF, -c.maxReverse, c.maxSpeed);

    // --- Lateral grip (low grip under handbrake = drift) ---
    const grip = controls.handbrake ? c.handbrakeGrip : c.grip;
    vR *= Math.exp(-grip * dt);

    // --- Steering ---
    this.steer += (controls.steer - this.steer) * Math.min(1, c.steerResponse * dt);
    // Need some speed to turn; turning gets a little less sharp at high speed.
    const drift = controls.handbrake ? 1.35 : 1;
    this.heading += this.steer * c.steerRate * this.speedFactor(vF) * drift * Math.sign(vF) * dt;
    this.heading += this.yawRate * dt;
    this.yawRate *= Math.exp(-3 * dt);

    // Recompose velocity in the (old) car frame. Using the pre-turn frame means the
    // velocity lags behind the new heading slightly, which is what gives slides.
    this.velocity.set(fwd.x * vF + right.x * vR, fwd.y * vF + right.y * vR);

    const prevVel = this.velocity.clone();
    this.position.addScaledVector(this.velocity, dt);
    this.#collide(world);

    // --- Visual state ---
    this.wheelSpin += (vF * dt) / 0.4;
    const accel = (this.velocity.dot(fwd) - prevVel.dot(fwd)) / dt;
    this.bodyPitch += (THREE.MathUtils.clamp(-accel * 0.004, -0.06, 0.06) - this.bodyPitch) * Math.min(1, 6 * dt);
    const lateral = this.steer * Math.abs(vF) * 0.004 + vR * 0.01;
    this.bodyRoll += (THREE.MathUtils.clamp(lateral, -0.08, 0.08) - this.bodyRoll) * Math.min(1, 6 * dt);
  }

  /** Two collision circles along the car's long axis, resolved against AABBs. */
  #collide(world) {
    const c = this.cfg;
    const fwd = this.forward;
    const offset = c.length / 2 - c.collisionRadius;
    const r = c.collisionRadius;

    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const sign of [1, -1]) {
        const cx = this.position.x + fwd.x * offset * sign;
        const cz = this.position.y + fwd.y * offset * sign;
        for (const b of world.query(cx, cz)) {
          if (cx < b.minX - r || cx > b.maxX + r || cz < b.minZ - r || cz > b.maxZ + r) continue;
          const px = THREE.MathUtils.clamp(cx, b.minX, b.maxX);
          const pz = THREE.MathUtils.clamp(cz, b.minZ, b.maxZ);
          let nx = cx - px;
          let nz = cz - pz;
          let dist = Math.hypot(nx, nz);
          if (dist >= r) continue;

          let depth;
          if (dist > 1e-6) {
            nx /= dist;
            nz /= dist;
            depth = r - dist;
          } else {
            // Circle centre inside the box: push out along the shallowest axis.
            const dl = cx - b.minX, dr = b.maxX - cx, dt = cz - b.minZ, db = b.maxZ - cz;
            const m = Math.min(dl, dr, dt, db);
            [nx, nz] = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt ? [0, -1] : [0, 1];
            depth = m + r;
          }

          this.position.x += nx * depth;
          this.position.y += nz * depth;

          const vn = this.velocity.x * nx + this.velocity.y * nz;
          if (vn < 0) {
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
  }

  /** Copy physics state onto the Three.js mesh. Call once per rendered frame. */
  syncMesh() {
    this.mesh.position.set(this.position.x, 0, this.position.y);
    this.mesh.rotation.y = this.heading;
    this.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer * 0.5;
    }
    this.tailMat.emissiveIntensity = this.braking ? 2.2 : 0.4;
  }

  #buildMesh(color) {
    const root = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = 0.45;
    root.add(body);
    this.body = body;

    const { length: L, width: W } = this.cfg;
    const paint = (this.paint = toon({ color }));
    const dark = toon({ color: 0x1c1f26 });
    const glass = toon({ color: 0x1d2a3d });
    const glint = new THREE.MeshBasicMaterial({ color: 0x9cc4e8 });
    const add = (geo, mat, x, y, z, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    add(new THREE.BoxGeometry(W, 0.6, L), paint, 0, 0.3, 0); // lower body
    add(new THREE.BoxGeometry(W * 0.86, 0.55, L * 0.5), glass, 0, 0.87, -0.2); // cabin glass
    add(new THREE.BoxGeometry(W * 0.8, 0.08, L * 0.42), paint, 0, 1.17, -0.25); // roof
    // Windscreen highlight streak — reads as glass from the high camera.
    add(new THREE.BoxGeometry(W * 0.5, 0.02, 0.12), glint, -0.15, 1.15, L * 0.02).rotation.y = 0.5;

    this.stripeMat = toon({ color: 0xffffff });
    this.stripeGroup = new THREE.Group();
    body.add(this.stripeGroup);
    for (const sx of [-0.24, 0.24]) {
      add(new THREE.BoxGeometry(0.26, 0.02, L * 0.42), this.stripeMat, sx, 0.611, L * 0.29, this.stripeGroup); // hood
      add(new THREE.BoxGeometry(0.26, 0.02, L * 0.42), this.stripeMat, sx, 1.221, -0.25, this.stripeGroup); // roof
      add(new THREE.BoxGeometry(0.26, 0.02, L * 0.08), this.stripeMat, sx, 0.611, -L * 0.46, this.stripeGroup); // trunk
    }
    add(new THREE.BoxGeometry(W * 1.02, 0.18, 0.25), dark, 0, 0.12, L / 2); // front bumper
    add(new THREE.BoxGeometry(W * 1.02, 0.18, 0.25), dark, 0, 0.12, -L / 2); // rear bumper

    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xfff6cc, emissiveIntensity: 1 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.4 });
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.45, 0.18, 0.06), headMat, s * (W / 2 - 0.35), 0.42, L / 2 + 0.01);
      add(new THREE.BoxGeometry(0.45, 0.18, 0.06), this.tailMat, s * (W / 2 - 0.35), 0.42, -L / 2 - 0.01);
    }

    // Wheels: pivot (steering) -> spin (rolling) -> tyre mesh
    this.wheels = [];
    const tyreGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 14).rotateZ(Math.PI / 2);
    const tyreMat = toon({ color: 0x15161a });
    const hubGeo = new THREE.BoxGeometry(0.34, 0.18, 0.18);
    const hubMat = toon({ color: 0xc8ccd4 });
    for (const [x, z, front] of [
      [W / 2 - 0.12, L * 0.32, true],
      [-W / 2 + 0.12, L * 0.32, true],
      [W / 2 - 0.12, -L * 0.32, false],
      [-W / 2 + 0.12, -L * 0.32, false],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.4, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      spin.add(tyre, new THREE.Mesh(hubGeo, hubMat));
      root.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }
    return root;
  }
}
