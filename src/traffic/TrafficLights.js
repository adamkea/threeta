import * as THREE from 'three';
import { CITY } from '../world/City.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon } from '../render/toon.js';
import { DIRS, HALF_ROAD, LANE_OFFSET, axisOf, isValidNode, nodeX, rightOf } from './RoadNetwork.js';

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
// Unlit lenses: dark, slightly tinted glass so you can still read which is which.
const DIM = {
  green: new THREE.Color(0x0d2a18),
  yellow: new THREE.Color(0x2e2408),
  red: new THREE.Color(0x2e0b0b),
};
const LAMPS = ['red', 'yellow', 'green']; // top to bottom

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
    const lenses = this.lenses;
    this.mounts.forEach(({ head }, k) => {
      const lit = this.state(head.i, head.j, head.axis);
      LAMPS.forEach((lamp, l) => lenses.setColorAt(k * 3 + l, lamp === lit ? COLORS[lamp] : DIM[lamp]));
    });
    lenses.instanceColor.needsUpdate = true;
  }

  /**
   * Each approach gets a signal on a mast arm out over its lane plus a second, lower head on the
   * pole itself (the one waiting drivers and pedestrians actually look at). Both are built from
   * shared instanced parts: backplate, housing, three visored lenses (red / yellow / green).
   */
  #buildMesh() {
    const heads = [];
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
          heads.push({ i, j, axis: axisOf(d), d, r, x, z });
        }
      }
    }
    this.heads = heads;

    const y0 = CITY.curbHeight;
    const armY = y0 + 5.55;
    const reach = corner - LANE_OFFSET; // pole -> over the centre of the approaching lane
    this.mounts = [];
    const arms = [];
    for (const head of heads) {
      const { d, r, x, z } = head;
      const yaw = Math.atan2(-d[0], -d[1]); // lenses (+Z local) face the oncoming drivers
      // Over-lane head, hanging from the end of the mast arm.
      this.mounts.push({ head, x: x - r[0] * reach, y: armY - 0.95, z: z - r[1] * reach, yaw, hanger: true });
      // Pole-mounted head, on the traffic side of the pole at eye level for a stopped driver.
      this.mounts.push({ head, x: x - r[0] * 0.42, y: y0 + 3.3, z: z - r[1] * 0.42, yaw, hanger: false });
      arms.push({ x, z, r, reach });
    }

    const group = new THREE.Group();
    const m = new THREE.Matrix4();
    const part = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);

    const instanced = (geo, mat, count, shadow = true) => {
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.castShadow = shadow;
      group.add(mesh);
      return mesh;
    };

    // --- Mast arms: a tapered tube from the pole out over the lane, with a small brace. ---
    const armMat = toon({ color: 0x2f5a3e }); // same dark green as the lamp posts
    const arm = instanced(new THREE.CylinderGeometry(0.06, 0.1, 1, 8), armMat, arms.length);
    const brace = instanced(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), armMat, arms.length);
    const collar = instanced(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10), armMat, arms.length);
    arms.forEach(({ x, z, r, reach }, k) => {
      const dir = v.set(-r[0], 0, -r[1]);
      q.setFromUnitVectors(up, dir);
      // CylinderGeometry tapers to radiusTop at +Y, so the thin end lands over the road.
      m.compose(new THREE.Vector3(x - r[0] * reach * 0.5, armY, z - r[1] * reach * 0.5), q, new THREE.Vector3(1, reach, 1));
      arm.setMatrixAt(k, m);
      // Diagonal brace from lower on the pole up to mid-arm.
      const bx = reach * 0.45;
      const drop = 0.9;
      const len = Math.hypot(bx, drop);
      q.setFromUnitVectors(up, new THREE.Vector3(-r[0] * bx, drop, -r[1] * bx).normalize());
      m.compose(new THREE.Vector3(x - r[0] * bx * 0.5, armY - drop * 0.5, z - r[1] * bx * 0.5), q, new THREE.Vector3(1, len, 1));
      brace.setMatrixAt(k, m);
      m.makeTranslation(x, armY, z);
      collar.setMatrixAt(k, m);
    });

    // --- Signal heads ---
    const W = 0.42; // housing width
    const H = 1.2; // housing height
    const D = 0.32; // housing depth
    const pitch = 0.38; // lens spacing
    const lensR = 0.135;

    const n = this.mounts.length;
    const frame = instanced(new THREE.BoxGeometry(W + 0.36, H + 0.36, 0.03), toon({ color: 0xf2c200 }), n);
    const plate = instanced(new THREE.BoxGeometry(W + 0.28, H + 0.28, 0.04), toon({ color: 0x17181a }), n);
    const housing = instanced(new RoundedBoxGeometry(W, H, D, 2, 0.05), toon({ color: 0x232527 }), n);
    const hanger = instanced(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6), armMat, n);
    const bracket = instanced(new THREE.BoxGeometry(0.1, 0.5, 0.32), armMat, n);

    // Sun visors: open half-tubes over each lens, hooded on top.
    const visorGeo = new THREE.CylinderGeometry(lensR + 0.04, lensR + 0.04, 0.26, 12, 1, true, -Math.PI / 2, Math.PI);
    visorGeo.rotateX(Math.PI / 2);
    visorGeo.translate(0, 0, 0.13);
    const visor = instanced(visorGeo, toon({ color: 0x1b1c1e, side: THREE.DoubleSide }), n * 3);

    // Lenses: a radial gradient gives a glassy, lit-from-behind look; instance colour tints it.
    const lensTex = radialTexture();
    const lenses = instanced(
      new THREE.CircleGeometry(lensR, 20),
      new THREE.MeshBasicMaterial({ map: lensTex, color: 0xffffff }),
      n * 3,
      false,
    );
    this.lenses = lenses;

    this.mounts.forEach((mt, k) => {
      const base = new THREE.Matrix4().compose(
        new THREE.Vector3(mt.x, mt.y, mt.z),
        q.setFromAxisAngle(up, mt.yaw),
        one,
      );
      const place = (mesh, idx, lx, ly, lz) => mesh.setMatrixAt(idx, m.multiplyMatrices(base, part.makeTranslation(lx, ly, lz)));

      place(frame, k, 0, 0, -D / 2 - 0.04);
      place(plate, k, 0, 0, -D / 2 - 0.015);
      place(housing, k, 0, 0, 0);
      if (mt.hanger) {
        place(hanger, k, 0, H / 2 + 0.2, 0);
        bracket.setMatrixAt(k, m.makeScale(0, 0, 0));
      } else {
        // Bolted to the pole behind it.
        place(bracket, k, 0, 0, -D / 2 - 0.2);
        hanger.setMatrixAt(k, m.makeScale(0, 0, 0));
      }
      LAMPS.forEach((lamp, l) => {
        const ly = (1 - l) * pitch;
        place(visor, k * 3 + l, 0, ly, D / 2);
        place(lenses, k * 3 + l, 0, ly, D / 2 + 0.005);
        lenses.setColorAt(k * 3 + l, DIM[lamp]);
      });
    });
    return group;
  }
}

/** White-hot centre fading to a softer rim, like light through a fresnel lens. */
function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 28, 2, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.45, '#e6e6e6');
  grad.addColorStop(0.85, '#a8a8a8');
  grad.addColorStop(1, '#6e6e6e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
