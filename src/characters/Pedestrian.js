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
    // --- Clothing & accessories ---
    placket: new RoundedBoxGeometry(0.22, 0.58, 0.06, 2, 0.03), // shirt showing through an open jacket
    collar: new THREE.TorusGeometry(0.15, 0.045, 6, 16).rotateX(Math.PI / 2),
    // Police cap: wide flat crown (reads as a disc from above), black band, peak and badge.
    capCrown: new THREE.CylinderGeometry(0.33, 0.27, 0.13, 20),
    capBand: new THREE.CylinderGeometry(0.275, 0.275, 0.08, 20),
    peak: new THREE.CylinderGeometry(0.19, 0.19, 0.03, 16, 1, false, -Math.PI / 2, Math.PI).scale(1.15, 1, 1),
    capBadge: new RoundedBoxGeometry(0.1, 0.09, 0.03, 1, 0.012),
    // Baseball cap: dome + bill.
    dome: new THREE.SphereGeometry(0.272, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
    bill: new THREE.CylinderGeometry(0.17, 0.17, 0.025, 16, 1, false, -Math.PI / 2, Math.PI).scale(1.1, 1, 1.25),
    pompom: new THREE.SphereGeometry(0.085, 10, 8),
    tail: new RoundedBoxGeometry(0.07, 0.22, 0.03, 1, 0.012),
    // Hood: a big open-fronted shell around the head.
    hood: new THREE.SphereGeometry(0.33, 18, 12, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.72),
    mask: new THREE.SphereGeometry(0.262, 14, 6, Math.PI / 2 - 1.25, 2.5, Math.PI * 0.53, Math.PI * 0.3),
    glasses: new RoundedBoxGeometry(0.36, 0.08, 0.06, 1, 0.02),
    chain: new THREE.TorusGeometry(0.16, 0.022, 6, 20).rotateX(Math.PI / 2 - 0.5),
    badge: new RoundedBoxGeometry(0.11, 0.13, 0.03, 1, 0.015),
    epaulette: new RoundedBoxGeometry(0.2, 0.05, 0.16, 1, 0.02),
    radio: new RoundedBoxGeometry(0.09, 0.14, 0.06, 1, 0.02),
    belt: new RoundedBoxGeometry(0.54, 0.08, 0.36, 2, 0.03),
    buckle: new RoundedBoxGeometry(0.1, 0.07, 0.03, 1, 0.01),
    holster: new RoundedBoxGeometry(0.08, 0.18, 0.14, 1, 0.03),
    legStripe: new THREE.BoxGeometry(0.035, 0.62, 0.07),
    armStripe: new THREE.BoxGeometry(0.03, 0.4, 0.06),
  };
  for (const g of Object.values(sharedGeo)) g.userData.shared = true;
  return sharedGeo;
}

const WALK_SPEED = 4.2;
const RUN_SPEED = 8;
const ACCEL = 30;
const RADIUS = 0.4;
const BASE_SCALE = 1.35; // exaggerated so people read clearly from the high camera

// Accessory colours shared by everyone.
let sharedMats = null;
function accessoryMats() {
  sharedMats ??= {
    gold: toon({ color: 0xf2c230 }),
    black: toon({ color: 0x141416 }),
    lens: toon({ color: 0x101418 }),
  };
  return sharedMats;
}

export { WALK_SPEED, RUN_SPEED };

/**
 * A person on foot (player or NPC). Same 2D conventions as Car: position/velocity are
 * Vector2 on the XZ plane, heading 0 faces +Z, forward = (sin h, cos h).
 */
export class Pedestrian {
  constructor(look = {}) {
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
    this.mesh = this.#buildMesh();
    this.setLook(look);
  }

  /**
   * Dress in place (lets pooled NPCs get a new look without rebuilding the mesh).
   * See outfits.js for the fields.
   */
  setLook(look) {
    const {
      shirt = 0x3b6fd1,
      inner = null,
      sleeves = shirt,
      pants = 0x2b2f3a,
      shoes = 0x1b1a1c,
      skin = 0xe0b48f,
      hair = 0x2a1c14,
      hat = null,
      glasses = false,
      mask = null,
      chain = false,
      badge = false,
      epaulettes = null,
      radio = false,
      belt = null,
      stripes = null,
      scale = 1,
    } = look;
    const m = this.mats;
    const a = this.acc;
    m.shirt.color.set(shirt);
    m.inner.color.set(inner ?? shirt);
    m.sleeve.color.set(sleeves);
    m.pants.color.set(pants);
    m.shoe.color.set(shoes);
    m.skin.color.set(skin);
    m.hair.color.set(hair);
    this.mesh.scale.setScalar(BASE_SCALE * scale);

    a.placket.visible = a.collar.visible = inner !== null;
    a.chain.visible = chain;
    a.badge.visible = badge;
    a.radio.visible = radio;
    a.glasses.visible = glasses;
    for (const e of a.epaulettes) e.visible = epaulettes !== null;
    if (epaulettes !== null) m.epaulette.color.set(epaulettes);
    a.belt.visible = belt !== null;
    a.holster.visible = belt !== null && badge;
    if (belt !== null) m.belt.color.set(belt);
    for (const st of a.stripes) st.visible = stripes !== null;
    if (stripes !== null) m.stripe.color.set(stripes);
    a.mask.visible = mask !== null;
    if (mask !== null) m.mask.color.set(mask);

    for (const [type, g] of Object.entries(a.hats)) g.visible = hat?.type === type;
    // Hats that cover the whole crown hide the hair; caps leave a fringe showing.
    this.hairMesh.visible = !hat || hat.type === 'cap' || hat.type === 'police';
    if (hat) {
      m.hat.color.set(hat.color);
      m.hatTrim.color.set(hat.trim ?? hat.color);
      a.hats.cap.rotation.y = hat.backwards ? Math.PI : 0;
    }
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

  #buildMesh() {
    const root = new THREE.Group();
    root.scale.setScalar(BASE_SCALE);
    const body = new THREE.Group(); // pivots at the feet for falling over
    root.add(body);
    this.body = body;
    const mat = () => toon({ color: 0xffffff });
    const m = (this.mats = {
      shirt: mat(), // outer torso (jacket when open)
      inner: mat(), // shirt under an open jacket
      sleeve: mat(),
      pants: mat(),
      shoe: mat(),
      skin: mat(),
      hair: mat(),
      hat: toon({ color: 0xffffff, side: THREE.DoubleSide }),
      hatTrim: mat(),
      mask: toon({ color: 0xffffff, side: THREE.DoubleSide }),
      epaulette: mat(),
      belt: mat(),
      stripe: mat(),
    });
    const S = accessoryMats();
    const G = pedGeometry();
    const part = (geo, mt, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(geo, mt);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };
    const acc = (this.acc = { stripes: [], epaulettes: [] });

    // Limbs hang from pivots at hip/shoulder height so rotation.x swings them.
    const limb = (x, y, geo, len, mt, hand) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(part(geo, mt, 0, -len / 2, 0));
      const out = Math.sign(x); // outer side of the limb
      if (hand) {
        pivot.add(part(G.hand, m.skin, 0, -len - 0.02, 0));
        const st = part(G.armStripe, m.stripe, out * 0.075, -len / 2 + 0.02, 0);
        acc.stripes.push(st);
        pivot.add(st);
      } else {
        pivot.add(part(G.shoe, m.shoe, 0, -len + 0.04, 0.05));
        const st = part(G.legStripe, m.stripe, out * 0.1, -len / 2 + 0.04, 0);
        acc.stripes.push(st);
        pivot.add(st);
      }
      return pivot;
    };
    this.legL = limb(0.14, 0.85, G.leg, 0.8, m.pants);
    this.legR = limb(-0.14, 0.85, G.leg, 0.8, m.pants);
    body.add(this.legL, this.legR);

    const torso = new THREE.Group();
    torso.position.y = 1.15;
    this.torso = torso;
    body.add(torso);
    const head = part(G.head, m.skin, 0, 0.62, 0); // big round comic head
    const hairMesh = part(G.hair, m.hair, 0, 0.64, -0.02);
    hairMesh.rotation.x = -0.35; // hairline sits back from the face
    this.hairMesh = hairMesh;
    const nose = part(G.nose, m.skin, 0, 0.6, 0.24); // shows which way they face
    torso.add(part(G.chest, m.shirt, 0, 0.05, 0), part(G.hips, m.pants, 0, -0.24, 0), head, hairMesh, nose);
    this.armL = limb(0.38, 0.3, G.arm, 0.52, m.sleeve, true);
    this.armR = limb(-0.38, 0.3, G.arm, 0.52, m.sleeve, true);
    torso.add(this.armL, this.armR);

    // --- Clothing ---
    acc.placket = part(G.placket, m.inner, 0, 0.05, 0.165);
    acc.collar = part(G.collar, m.shirt, 0, 0.36, 0);
    acc.chain = part(G.chain, S.gold, 0, 0.3, 0.05);
    acc.badge = part(G.badge, S.gold, 0.15, 0.17, 0.18);
    acc.radio = part(G.radio, S.black, -0.17, 0.25, 0.19);
    for (const sx of [1, -1]) {
      const e = part(G.epaulette, m.epaulette, sx * 0.24, 0.355, 0);
      acc.epaulettes.push(e);
      torso.add(e);
    }
    acc.belt = part(G.belt, m.belt, 0, -0.17, 0);
    acc.belt.add(part(G.buckle, S.gold, 0, 0, 0.18));
    acc.holster = part(G.holster, S.black, -0.3, -0.25, 0.02);
    acc.glasses = part(G.glasses, S.lens, 0, 0.67, 0.215);
    acc.mask = part(G.mask, m.mask, 0, 0.62, 0);
    torso.add(acc.placket, acc.collar, acc.chain, acc.badge, acc.radio, acc.belt, acc.holster, acc.glasses, acc.mask);

    // --- Headwear (one shown at a time) ---
    const hatGroup = (...parts) => {
      const g = new THREE.Group();
      g.position.y = 0.62; // head centre
      g.add(...parts);
      torso.add(g);
      return g;
    };
    const peak = part(G.peak, S.black, 0, 0.17, 0.2);
    peak.rotation.x = 0.12;
    const bill = part(G.bill, m.hat, 0, 0.1, 0.22);
    bill.rotation.x = 0.08;
    const tailL = part(G.tail, m.hat, 0.05, -0.02, -0.25);
    const tailR = part(G.tail, m.hat, -0.05, -0.04, -0.25);
    tailL.rotation.set(0.35, 0, 0.25);
    tailR.rotation.set(0.35, 0, -0.2);
    const domeOf = (mt) => {
      const d = part(G.dome, mt, 0, 0.03, -0.01);
      d.rotation.x = -0.25;
      return d;
    };
    acc.hats = {
      police: hatGroup(
        part(G.capBand, m.hatTrim, 0, 0.17, 0),
        part(G.capCrown, m.hat, 0, 0.27, 0),
        part(G.capBadge, S.gold, 0, 0.25, 0.3),
        peak,
      ),
      cap: hatGroup(domeOf(m.hat), bill),
      beanie: hatGroup(domeOf(m.hat), part(G.pompom, m.hat, 0, 0.29, -0.04)),
      durag: hatGroup(domeOf(m.hat), tailL, tailR),
      hood: hatGroup(part(G.hood, m.hat, 0, -0.02, -0.03)),
    };
    return root;
  }
}
