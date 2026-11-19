import * as THREE from 'three';
import { CITY } from '../world/City.js';
import { DIRS, HALF_ROAD, axisOf, isValidNode, nodeX, rightOf } from './RoadNetwork.js';

// Signal timings (seconds). The Z axis gets green first, then X; short all-red between.
const GREEN = 7;
const YELLOW = 2;
const ALL_RED = 1;
const CYCLE = 2 * (GREEN + YELLOW + ALL_RED);

const COLORS = {
  green: new THREE.Color(0x35ff7a),
  yellow: new THREE.Color(0xffc21f),
  red: new THREE.Color(0xff2a2a),
};

export class TrafficLights {
  constructor(rng) {
    const n = CITY.blocks + 1;
    this.n = n;
    this.time = 0;
    this.offsets = Array.from({ length: n * n }, () => rng.range(0, CYCLE));
    this.mesh = this.#buildMesh();
  }

  /** 'green' | 'yellow' | 'red' for traffic travelling along `axis` through node (i, j). */
  state(i, j, axis) {
    let t = (this.time + this.offsets[i * this.n + j]) % CYCLE;
    if (axis === 'x') t = (t + CYCLE / 2) % CYCLE;
    if (t < GREEN) return 'green';
    if (t < GREEN + YELLOW) return 'yellow';
    return 'red';
  }

  /** Seconds of green left for traffic along `axis` at node (i, j); 0 if not green. */
  greenRemaining(i, j, axis) {
    let t = (this.time + this.offsets[i * this.n + j]) % CYCLE;
    if (axis === 'x') t = (t + CYCLE / 2) % CYCLE;
    return t < GREEN ? GREEN - t : 0;
  }

  update(dt) {
    this.time += dt;
    this.heads.forEach(({ i, j, axis }, k) => this.mesh.setColorAt(k, COLORS[this.state(i, j, axis)]));
    this.mesh.instanceColor.needsUpdate = true;
  }

  // One signal head per approach, on the street-lamp pole at the near-right corner.
  #buildMesh() {
    this.heads = [];
    const corner = HALF_ROAD + 1.2; // matches lamp placement in City.js
    const limit = CITY.half - CITY.roadWidth;
    for (let i = 0; i < this.n; i++) {
      for (let j = 0; j < this.n; j++) {
        for (const d of DIRS) {
          if (!isValidNode(i - d[0], j - d[1])) continue; // nobody approaches from outside
          const r = rightOf(d);
          const x = nodeX(i) + (-d[0] + r[0]) * corner;
          const z = nodeX(j) + (-d[1] + r[1]) * corner;
          if (Math.abs(x) > limit || Math.abs(z) > limit) continue; // no pole there
          this.heads.push({ i, j, axis: axisOf(d), x: x - r[0] * 0.5, z: z - r[1] * 0.5 });
        }
      }
    }
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.6, 0.9),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      this.heads.length,
    );
    const m = new THREE.Matrix4();
    this.heads.forEach(({ x, z }, k) => {
      mesh.setMatrixAt(k, m.makeTranslation(x, CITY.curbHeight + 4.8, z));
      mesh.setColorAt(k, COLORS.red);
    });
    return mesh;
  }
}
