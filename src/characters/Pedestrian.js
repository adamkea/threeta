import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon } from '../render/toon.js';

let sharedGeo = null;
/** Rounded body parts, shared by every person. */
function pedGeometry() {
  if (sharedGeo) return sharedGeo;
  sharedGeo = {
    leg: new THREE.CapsuleGeometry(0.11, 0.8 - 0.22, 4, 10),
    arm: new THREE.CapsuleGeometry(0.08, 0.52 - 0.16, 4, 10),
    hand: new THREE.SphereGeometry(0.09, 10, 8),
    shoe: new THREE.SphereGeometry(0.12, 10, 8).scale(1, 0.6, 1.5),
    chest: new RoundedBoxGeometry(0.62, 0.62, 0.36, 4, 0.15),
    hips: new RoundedBoxGeometry(0.5, 0.2, 0.32, 3, 0.09),
    head: new THREE.SphereGeometry(0.25, 16, 12),
    hair: new THREE.SphereGeometry(0.265, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
    nose: new THREE.SphereGeometry(0.05, 8, 6),
  };
  for (const g of Object.values(sharedGeo)) g.userData.shared = true;
  return sharedGeo;
}

const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const ACCEL = 30;
const RADIUS = 0.4;
const BASE_SCALE = 1.35; // exaggerated so people read clearly from the high camera

export { WALK_SPEED, RUN_SPEED };

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
    this.justKnocked = false; // set on knockdown; observers (e.g. NpcManager) clear it
    this.mesh = this.#buildMesh(shirt, pants, skin, hair);
  }

  /** Recolour in place (lets pooled NPCs get a new look without rebuilding the mesh). */
  setLook({ shirt, pants, skin, hair, scale = 1 }) {
    this.mats.shirt.color.set(shirt);
    this.mats.pants.color.set(pants);
    this.mats.skin.color.set(skin);
    this.mats.hair.color.set(hair);
    this.mesh.scale.setScalar(BASE_SCALE * scale);
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
    this.justKnocked = true;
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
    root.scale.setScalar(BASE_SCALE);
    const body = new THREE.Group(); // pivots at the feet for falling over
    root.add(body);
    this.body = body;
    const mat = (c) => toon({ color: c });
    this.mats = { shirt: mat(shirt), pants: mat(pants), skin: mat(skin), hair: mat(hair) };
    const G = pedGeometry();
    const part = (geo, m) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      return mesh;
    };

    // Limbs hang from pivots at hip/shoulder height so rotation.x swings them.
    const limb = (x, y, geo, len, m, hand) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const p = part(geo, m);
      p.position.y = -len / 2;
      pivot.add(p);
      if (hand) {
        const h = part(G.hand, this.mats.skin);
        h.position.y = -len - 0.02;
        pivot.add(h);
      } else {
        const shoe = part(G.shoe, this.mats.shoe);
        shoe.position.set(0, -len + 0.04, 0.05);
        pivot.add(shoe);
      }
      return pivot;
    };
    this.mats.shoe = toon({ color: 0x1b1a1c });
    this.legL = limb(0.14, 0.85, G.leg, 0.8, this.mats.pants);
    this.legR = limb(-0.14, 0.85, G.leg, 0.8, this.mats.pants);
    body.add(this.legL, this.legR);

    const torso = new THREE.Group();
    torso.position.y = 1.15;
    this.torso = torso;
    body.add(torso);
    const shirtMat = this.mats.shirt;
    const chest = part(G.chest, shirtMat);
    chest.position.y = 0.05;
    const hips = part(G.hips, this.mats.pants);
    hips.position.y = -0.24;
    const head = part(G.head, this.mats.skin); // big round comic head
    head.position.y = 0.62;
    const hairMesh = part(G.hair, this.mats.hair);
    hairMesh.position.set(0, 0.64, -0.02);
    hairMesh.rotation.x = -0.35; // hairline sits back from the face
    const nose = part(G.nose, this.mats.skin); // shows which way they face
    nose.position.set(0, 0.6, 0.24);
    torso.add(chest, hips, head, hairMesh, nose);
    this.armL = limb(0.38, 0.3, G.arm, 0.52, shirtMat, true);
    this.armR = limb(-0.38, 0.3, G.arm, 0.52, shirtMat, true);
    torso.add(this.armL, this.armR);
    return root;
  }
}
