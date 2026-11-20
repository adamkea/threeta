import * as THREE from 'three';
import { toon } from '../render/toon.js';

const MAX = 400; // live particles
const GRAVITY = 18;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// Turf colours: a few greens for torn blades, a couple of browns for clods of earth.
const COLORS = [0x2f6b1f, 0x9bd86a, 0x3d7f2a, 0xc2e88a, 0x6b4a2b, 0x55391f, 0x7a5532].map((c) => new THREE.Color(c));

/**
 * Clumps of grass and earth kicked up by tyres sliding on a lawn: small flat chips thrown up
 * and back from the wheel, tumbling, falling under gravity and shrinking away when they land.
 */
export class GrassSpray {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.35, 1), toon({ color: 0xffffff }), MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, HIDDEN);
      this.mesh.setColorAt(i, COLORS[0]);
    }
    this.p = Array.from({ length: MAX }, () => ({
      life: 0, max: 1, size: 0.1, floor: 0, landed: false,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(),
    }));
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    scene.add(this.mesh);
  }

  /**
   * Throw `n` chips from a wheel at (x, z) on a surface of height `floor`. `vx`, `vz` is the
   * car's velocity: chips fly back against it (the tyre flings them) and up.
   */
  emit(x, z, floor, vx, vz, n) {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      this.mesh.count = Math.max(this.mesh.count, i + 1);
      const p = this.p[i];
      const back = 0.25 + Math.random() * 0.35;
      p.pos.set(x + (Math.random() - 0.5) * 0.4, floor + 0.05, z + (Math.random() - 0.5) * 0.4);
      p.vel.set(
        -vx * back + (Math.random() - 0.5) * 4.5,
        2 + Math.random() * 3.5,
        -vz * back + (Math.random() - 0.5) * 4.5,
      );
      p.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      p.spin.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20);
      p.size = 0.18 + Math.random() * 0.22;
      p.floor = floor;
      p.landed = false;
      p.max = 0.9 + Math.random() * 0.8;
      p.life = p.max;
      this.mesh.setColorAt(i, COLORS[(Math.random() * COLORS.length) | 0]);
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  update(dt) {
    const n = this.mesh.count;
    if (!n) return;
    let any = false;
    for (let i = 0; i < n; i++) {
      const p = this.p[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, HIDDEN);
        any = true;
        continue;
      }
      if (!p.landed) {
        p.vel.y -= GRAVITY * dt;
        p.vel.x *= 1 - 1.5 * dt; // air drag on light bits of turf
        p.vel.z *= 1 - 1.5 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt;
        p.rot.y += p.spin.y * dt;
        p.rot.z += p.spin.z * dt;
        if (p.pos.y < p.floor + 0.02) {
          // Lands flat-ish and lies there for its remaining life.
          p.pos.y = p.floor + 0.02;
          p.rot.x = p.rot.z = 0;
          p.landed = true;
          p.life = Math.min(p.life, 0.5);
        }
      }
      const fade = Math.min(1, p.life / 0.35); // shrink away at the end
      this.s.setScalar(p.size * fade);
      this.q.setFromEuler(p.rot);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      any = true;
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
