import * as THREE from 'three';
import { CITY, LAYOUT } from '../world/CityLayout.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon } from '../render/toon.js';
import { GRAPH } from './RoadNetwork.js';

// Signal timings (seconds). Each junction's phases (roads arriving from opposite directions
// share one) take turns: green, yellow, then a short all-red before the next.
const GREEN = 7;
const YELLOW = 2;
const ALL_RED = 1;
const SLOT = GREEN + YELLOW + ALL_RED;

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
    this.time = 0;
    this.offsets = GRAPH.nodes.map((n) => rng.range(0, SLOT * (n.phases || 1)));
    this.mesh = this.#buildMesh();
  }

  /** Where junction `node` is in its cycle: [active phase, seconds into that phase's slot]. */
  #slot(node) {
    const n = GRAPH.nodes[node];
    const t = (this.time + this.offsets[node]) % (SLOT * n.phases);
    const phase = Math.floor(t / SLOT);
    return [phase, t - phase * SLOT, n];
  }

  /** 'green' | 'yellow' | 'red' for traffic arriving at junction `node` along road `edge`. */
  state(node, edge) {
    if (!GRAPH.nodes[node].signal) return 'green';
    const [phase, t, n] = this.#slot(node);
    if (n.phaseOf.get(edge) !== phase) return 'red';
    return t < GREEN ? 'green' : t < GREEN + YELLOW ? 'yellow' : 'red';
  }

  /**
   * Seconds left for people to cross road `edge` at junction `node`: while its own traffic is
   * held at red, until that traffic is next about to get a green. Infinity without signals.
   */
  walkRemaining(node, edge) {
    const n = GRAPH.nodes[node];
    if (!n.signal) return Infinity;
    const [phase, t] = this.#slot(node);
    const mine = n.phaseOf.get(edge);
    if (mine === phase) return 0;
    const slotsUntil = (mine - phase + n.phases) % n.phases; // full slots before ours starts
    return slotsUntil * SLOT - t - YELLOW - ALL_RED;
  }

  update(dt) {
    this.time += dt;
    const lenses = this.lenses;
    this.mounts.forEach(({ head }, k) => {
      const lit = this.state(head.node, head.edge);
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
    // Poles stand where City.js puts a street lamp for each one (see CityLayout signalHeads).
    const heads = LAYOUT.signalHeads;
    this.heads = heads;

    const y0 = CITY.curbHeight;
    const armY = y0 + 5.55;
    this.mounts = [];
    const arms = [];
    for (const head of heads) {
      const { d, r, x, z, reach } = head; // reach: pole -> over the centre of the approaching lane
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
