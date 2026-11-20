import * as THREE from 'three';
import { GrassSpray } from './GrassSpray.js';

const MAX = 1500; // segments in the ring buffer
const WIDTH = 0.32;
const STEP = 0.35; // metres of travel per segment
const LIFE = 10; // seconds fully dark
const FADE = 5; // seconds to fade out after that
const DARK = new THREE.Color(0.35, 0.35, 0.38); // multiply factor at full strength
// Torn turf: multiplied over the lawn's green this reads as dark, muddy brown-green.
const TURF = new THREE.Color(0.62, 0.48, 0.3);
const TURF_WIDTH = 0.42; // tyres dig a wider rut into grass than rubber leaves on tarmac
const SPRAY_RATE = 55; // grass chips per second per wheel at a full slide
const CLEAR = new THREE.Color(1, 1, 1);

/**
 * Rubber left on the ground by sliding rear tyres. Marks are short quads in one instanced
 * mesh, multiplied over whatever is underneath, fading out over time.
 */
export class SkidMarks {
  /**
   * `surface(x, z)` says what's under a point: `{ height, grass }`. Grass gets its own darker,
   * wider marks and kicks up turf.
   */
  constructor(scene, surface) {
    this.surface = surface;
    this.spray = new GrassSpray(scene);
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
    this.tints = Array.from({ length: MAX }, () => DARK); // full-strength colour of each mark
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
  #skidding(car, grass) {
    const speed = car.speed;
    if (speed < 3) return false;
    if (car.handbrake) return true;
    // Big sideways slide (spin-outs, crashes); turf tears up far more easily than rubber marks tarmac.
    return car.slip > (grass ? 2.5 : 4.5);
  }

  #rearWheels(car) {
    const { length: L, width: W } = car.cfg;
    const f = car.forward, r = car.right;
    const back = -L * 0.3, side = W / 2 - 0.14;
    if (car.isBike) return [new THREE.Vector2(car.position.x + f.x * back, car.position.y + f.y * back)];
    return [-1, 1].map((s) => new THREE.Vector2(
      car.position.x + f.x * back + r.x * side * s,
      car.position.y + f.y * back + r.y * side * s,
    ));
  }

  update(dt, cars) {
    this.time += dt;
    for (const car of cars) {
      const grass = car.active && this.surface(car.position.x, car.position.y).grass;
      if (!car.active || !this.#skidding(car, grass)) {
        this.trails.delete(car);
        continue;
      }
      const wheels = this.#rearWheels(car);
      if (grass) this.#spray(car, wheels, dt);
      const last = this.trails.get(car);
      if (!last) {
        this.trails.set(car, wheels);
        continue;
      }
      for (let k = 0; k < wheels.length; k++) {
        const a = last[k], b = wheels[k];
        const d = a.distanceTo(b);
        if (d < STEP) continue;
        if (d < 6) this.#add(a, b, d); // big jumps = teleport/reset, don't draw
        last[k] = b;
      }
    }
    this.spray.update(dt);
    this.#fade();
  }

  /** Kick turf up from each rear wheel that's on the lawn, more the harder the car slides. */
  #spray(car, wheels, dt) {
    const slide = THREE.MathUtils.clamp(Math.max(car.slip, car.handbrake ? car.speed * 0.5 : 0) / 10, 0.25, 1);
    for (const w of wheels) {
      const s = this.surface(w.x, w.y);
      if (!s.grass) continue;
      const n = Math.floor(SPRAY_RATE * slide * dt + Math.random());
      if (n) this.spray.emit(w.x, w.y, s.height, car.velocity.x, car.velocity.y, n);
    }
  }

  #add(a, b, len) {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    const x = (a.x + b.x) / 2, z = (a.y + b.y) / 2;
    const s = this.surface(x, z);
    const y = s.height + 0.03;
    this.tints[i] = s.grass ? TURF : DARK;
    this.q.setFromAxisAngle(this.up, Math.atan2(b.x - a.x, b.y - a.y));
    // Slight overlap so consecutive segments join without gaps.
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(s.grass ? TURF_WIDTH : WIDTH, 1, len + 0.08));
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
      this.c.copy(this.tints[i]).lerp(CLEAR, t);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
}
