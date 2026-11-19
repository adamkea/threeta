import * as THREE from 'three';

const MAX = 1500; // segments in the ring buffer
const WIDTH = 0.32;
const STEP = 0.35; // metres of travel per segment
const LIFE = 10; // seconds fully dark
const FADE = 5; // seconds to fade out after that
const DARK = new THREE.Color(0.35, 0.35, 0.38); // multiply factor at full strength
const CLEAR = new THREE.Color(1, 1, 1);

/**
 * Rubber left on the ground by sliding rear tyres. Marks are short quads in one instanced
 * mesh, multiplied over whatever is underneath, fading out over time.
 */
export class SkidMarks {
  constructor(scene, groundHeight) {
    this.groundHeight = groundHeight;
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        blending: THREE.MultiplyBlending,
        premultipliedAlpha: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      MAX,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.count = 0;
    this.births = new Float32Array(MAX).fill(-1e9);
    this.next = 0;
    this.time = 0;
    this.trails = new Map(); // car -> [lastPointLeft, lastPointRight] (or null when not skidding)
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.c = new THREE.Color();
    scene.add(this.mesh);
  }

  /** Is this car laying rubber right now? */
  #skidding(car) {
    const speed = car.speed;
    if (speed < 3) return false;
    if (car.handbrake) return true;
    return car.slip > 4.5; // big sideways slide (spin-outs, crashes)
  }

  #rearWheels(car) {
    const { length: L, width: W } = car.cfg;
    const f = car.forward, r = car.right;
    const back = -L * 0.3, side = W / 2 - 0.14;
    return [-1, 1].map((s) => new THREE.Vector2(
      car.position.x + f.x * back + r.x * side * s,
      car.position.y + f.y * back + r.y * side * s,
    ));
  }

  update(dt, cars) {
    this.time += dt;
    for (const car of cars) {
      if (!car.active || !this.#skidding(car)) {
        this.trails.delete(car);
        continue;
      }
      const wheels = this.#rearWheels(car);
      const last = this.trails.get(car);
      if (!last) {
        this.trails.set(car, wheels);
        continue;
      }
      for (let k = 0; k < 2; k++) {
        const a = last[k], b = wheels[k];
        const d = a.distanceTo(b);
        if (d < STEP) continue;
        if (d < 6) this.#add(a, b, d); // big jumps = teleport/reset, don't draw
        last[k] = b;
      }
    }
    this.#fade();
  }

  #add(a, b, len) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    const x = (a.x + b.x) / 2, z = (a.y + b.y) / 2;
    const y = this.groundHeight(x, z) + 0.03;
    this.q.setFromAxisAngle(this.up, Math.atan2(b.x - a.x, b.y - a.y));
    // Slight overlap so consecutive segments join without gaps.
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(WIDTH, 1, len + 0.08));
    this.mesh.setMatrixAt(i, this.m);
    this.births[i] = this.time;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  #fade() {
    const n = this.mesh.count;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const age = this.time - this.births[i];
      const t = THREE.MathUtils.clamp((age - LIFE) / FADE, 0, 1); // 0 = fresh, 1 = gone
      this.c.copy(DARK).lerp(CLEAR, t);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}
