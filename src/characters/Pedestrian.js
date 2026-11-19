import * as THREE from 'three';

const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const ACCEL = 30;
const RADIUS = 0.4;

/**
 * A person on foot (player or NPC). Same 2D conventions as Car: position/velocity are
 * Vector2 on the XZ plane, heading 0 faces +Z, forward = (sin h, cos h).
 */
export class Pedestrian {
  constructor({ shirt = 0x3b6fd1, pants = 0x2b2f3a, skin = 0xe0b48f, hair = 0x2a1c14 } = {}) {
    this.position = new THREE.Vector2();
    this.velocity = new THREE.Vector2();
    this.heading = 0;
    this.radius = RADIUS;
    this.active = true;
    this.downTime = 0; // > 0 while knocked down
    this.fall = 0; // 0 standing .. 1 lying flat (animated)
    this.stride = 0;
    this.groundY = 0;
    this.mesh = this.#buildMesh(shirt, pants, skin, hair);
  }

  get speed() {
    return this.velocity.length();
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  get isDown() {
    return this.downTime > 0;
  }

  reset(x, z, heading = 0) {
    this.position.set(x, z);
    this.velocity.set(0, 0);
    this.heading = heading;
    this.downTime = 0;
    this.fall = 0;
  }

  /**
   * Fixed-step update. `move` is a desired direction (Vector2, length 0..1) in world space;
   * `run` sprints. Ignored while knocked down.
   */
  update(dt, move, run, world) {
    if (this.downTime > 0) {
      this.downTime -= dt;
      this.velocity.multiplyScalar(Math.exp(-3 * dt));
    } else {
      const max = run ? RUN_SPEED : WALK_SPEED;
      const tx = move.x * max - this.velocity.x;
      const tz = move.y * max - this.velocity.y;
      const len = Math.hypot(tx, tz);
      const step = Math.min(len, ACCEL * dt);
      if (len > 1e-5) this.velocity.x += (tx / len) * step, this.velocity.y += (tz / len) * step;

      if (move.x * move.x + move.y * move.y > 0.01) {
        // Turn smoothly toward the movement direction.
        const target = Math.atan2(move.x, move.y);
        let diff = target - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, 14 * dt);
      }
    }

    this.position.addScaledVector(this.velocity, dt);
    this.#collideStatic(world);
    this.stride += this.speed * dt;
  }

  /** Thrown by an impact (e.g. hit by a car). */
  knockDown(impulse) {
    this.velocity.copy(impulse);
    this.downTime = 2.2;
    if (impulse.lengthSq() > 0.01) this.heading = Math.atan2(-impulse.x, -impulse.y); // fall backwards
  }

  #collideStatic(world) {
    const r = this.radius;
    for (const b of world.query(this.position.x, this.position.y)) {
      const cx = this.position.x, cz = this.position.y;
      const px = Math.min(Math.max(cx, b.minX), b.maxX);
      const pz = Math.min(Math.max(cz, b.minZ), b.maxZ);
      let nx = cx - px, nz = cz - pz;
      const d = Math.hypot(nx, nz);
      if (d >= r) continue;
      let depth;
      if (d > 1e-6) {
        nx /= d; nz /= d; depth = r - d;
      } else {
        const dl = cx - b.minX, dr = b.maxX - cx, dt = cz - b.minZ, db = b.maxZ - cz;
        const m = Math.min(dl, dr, dt, db);
        [nx, nz] = m === dl ? [-1, 0] : m === dr ? [1, 0] : m === dt ? [0, -1] : [0, 1];
        depth = m + r;
      }
      this.position.x += nx * depth;
      this.position.y += nz * depth;
      const vn = this.velocity.x * nx + this.velocity.y * nz;
      if (vn < 0) this.velocity.x -= vn * nx, this.velocity.y -= vn * nz;
    }
  }

  syncMesh(dt) {
    this.fall += ((this.isDown ? 1 : 0) - this.fall) * Math.min(1, (this.isDown ? 10 : 3) * dt);
    this.mesh.position.set(this.position.x, this.groundY, this.position.y);
    this.mesh.rotation.y = this.heading;
    this.body.rotation.x = -this.fall * (Math.PI / 2);
    this.body.position.y = this.fall * 0.25;

    const s = this.isDown ? 0 : Math.min(1, this.speed / WALK_SPEED);
    const swing = Math.sin(this.stride * 2.4) * 0.8 * s;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = -swing * 0.8;
    this.armR.rotation.x = swing * 0.8;
    this.torso.position.y = 1.15 + Math.abs(Math.cos(this.stride * 2.4)) * 0.05 * s;
  }

  #buildMesh(shirt, pants, skin, hair) {
    const root = new THREE.Group();
    root.scale.setScalar(1.35); // exaggerated so people read clearly from the high camera
    const body = new THREE.Group(); // pivots at the feet for falling over
    root.add(body);
    this.body = body;
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const box = (w, h, d, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.castShadow = true;
      return mesh;
    };

    // Limbs hang from pivots at hip/shoulder height so rotation.x swings them.
    const limb = (x, y, w, h, m) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const part = box(w, h, w, m);
      part.position.y = -h / 2;
      pivot.add(part);
      return pivot;
    };
    this.legL = limb(0.15, 0.85, 0.22, 0.85, mat(pants));
    this.legR = limb(-0.15, 0.85, 0.22, 0.85, mat(pants));
    body.add(this.legL, this.legR);

    const torso = new THREE.Group();
    torso.position.y = 1.15;
    this.torso = torso;
    body.add(torso);
    const shirtMat = mat(shirt);
    const chest = box(0.55, 0.65, 0.3, shirtMat);
    chest.position.y = 0.05;
    const head = box(0.3, 0.32, 0.3, mat(skin));
    head.position.y = 0.58;
    const hairMesh = box(0.32, 0.1, 0.32, mat(hair));
    hairMesh.position.y = 0.76;
    torso.add(chest, head, hairMesh);
    this.armL = limb(0.36, 0.33, 0.15, 0.6, shirtMat);
    this.armR = limb(-0.36, 0.33, 0.15, 0.6, shirtMat);
    torso.add(this.armL, this.armR);
    return root;
  }
}
