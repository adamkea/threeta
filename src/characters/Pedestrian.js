import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toon } from '../render/toon.js';
import { Health } from '../combat/Health.js';

/** Smooth solid of revolution from (radius, y) pairs, squashed front-to-back by `depth`. */
function lathe(profile, depth = 1, segments = 24) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, segments).scale(1, 1, depth);
}

/** Limb segment hanging down from its pivot: rounded ends, tapering from `r0` to `r1`. */
function taperedLimb(len, r0, r1) {
  const pts = [];
  const steps = 6;
  for (let k = 0; k <= steps; k++) {
    const a = (k / steps) * (Math.PI / 2);
    pts.push([Math.sin(a) * r0, -r0 + Math.cos(a) * r0]); // top cap
  }
  for (let k = steps; k >= 0; k--) {
    const a = (k / steps) * (Math.PI / 2);
    pts.push([Math.sin(a) * r1, -len + r1 - Math.cos(a) * r1]); // bottom cap
  }
  return lathe(pts.reverse(), 0.92, 16); // lathe profiles run bottom-up so normals face out
}

const TORSO_DEPTH = 0.62; // torso is an ellipse in cross-section, not a barrel
const THIGH = 0.42; // upper leg length (knee pivot)
const SHIN = 0.4;
const UPPER_ARM = 0.27;
const FOREARM = 0.25;

/** Smooth bump peaking at 1 when phase `p` is at `center` (wraps around the cycle). */
function bump(p, center, width) {
  const d = Math.atan2(Math.sin(p - center), Math.cos(p - center));
  return Math.exp(-(d * d) / (2 * width * width));
}

let sharedGeo = null;
/** Smooth body parts, shared by every person. */
function pedGeometry() {
  if (sharedGeo) return sharedGeo;
  sharedGeo = {
    thigh: taperedLimb(THIGH + 0.06, 0.125, 0.1),
    shin: taperedLimb(SHIN, 0.1, 0.075),
    upperArm: taperedLimb(UPPER_ARM + 0.05, 0.09, 0.075),
    forearm: taperedLimb(FOREARM, 0.075, 0.062),
    hand: new THREE.SphereGeometry(0.085, 14, 10).scale(0.85, 1.1, 0.95),
    // Shoe: a rounded wedge, longer in front of the ankle than behind.
    shoe: new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.6),
    // Chest tapers from broad shoulders to a narrower waist.
    chest: lathe(
      [
        [0, -0.2], [0.21, -0.19], [0.235, -0.12], [0.245, -0.02], [0.27, 0.08], [0.295, 0.18],
        [0.3, 0.25], [0.275, 0.32], [0.21, 0.375], [0.11, 0.4], [0, 0.405],
      ],
      TORSO_DEPTH,
    ),
    hips: lathe([[0, -0.37], [0.15, -0.365], [0.225, -0.32], [0.25, -0.24], [0.24, -0.15], [0, -0.13]], 0.72),
    neck: new THREE.CylinderGeometry(0.085, 0.1, 0.16, 14),
    head: new THREE.SphereGeometry(0.25, 24, 18).scale(0.96, 1.04, 1),
    ear: new THREE.SphereGeometry(0.05, 10, 8).scale(0.6, 1, 1),
    hair: new THREE.SphereGeometry(0.265, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    nose: new THREE.SphereGeometry(0.05, 10, 8),
    // --- Clothing & accessories ---
    placket: new RoundedBoxGeometry(0.22, 0.58, 0.06, 2, 0.03), // shirt showing through an open jacket
    neckline: new THREE.SphereGeometry(0.15, 16, 10).scale(1, 0.75, 0.75), // shirt showing at an open neck
    // Jacket collar: round the back of the neck, open at the front.
    collar: new THREE.TorusGeometry(0.13, 0.04, 8, 20, Math.PI * 2 - 1.8)
      .rotateX(Math.PI / 2)
      .rotateY(-(Math.PI / 2 + 0.9))
      .scale(1.15, 1, 0.85),
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
    belt: new THREE.CylinderGeometry(0.252, 0.247, 0.08, 24).scale(1, 1, 0.74),
    buckle: new RoundedBoxGeometry(0.1, 0.07, 0.03, 1, 0.01),
    holster: new RoundedBoxGeometry(0.08, 0.18, 0.14, 1, 0.03),
    thighStripe: new RoundedBoxGeometry(0.03, THIGH - 0.02, 0.07, 1, 0.012),
    shinStripe: new RoundedBoxGeometry(0.03, SHIN - 0.08, 0.06, 1, 0.012),
    armStripe: new RoundedBoxGeometry(0.03, UPPER_ARM - 0.02, 0.055, 1, 0.012),
    // Handgun, modelled in the hand's frame: barrel along -Y (down the arm), grip along -Z.
    gunSlide: new RoundedBoxGeometry(0.075, 0.27, 0.09, 1, 0.015).translate(0, -0.1, 0.02),
    gunGrip: new RoundedBoxGeometry(0.07, 0.08, 0.16, 1, 0.015).rotateX(-0.25).translate(0, 0.01, -0.08),
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
    grip: toon({ color: 0x4a3426 }),
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
    this.gait = 0; // gait cycle phase (radians); left foot strikes at 0, right at PI
    this.runBlend = 0; // 0 walking .. 1 running (smoothed)
    this.groundY = 0;
    this.justKnocked = false; // set on knockdown; observers (e.g. NpcManager) clear it
    this.health = new Health(100);
    this.hurtFrom = null; // Vector2 position of whoever last hurt us (non-fatally); observers clear it
    this.weapon = null; // weapon definition being held (visual + aim pose), or null
    this.recoil = 0; // 0..1 kick of the gun arm, decays
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
    return this.downTime > 0 || this.dead;
  }

  get dead() {
    return this.health.dead;
  }

  /** Show (or put away) a gun. `def` is a weapon definition from combat/weapons.js, or null. */
  setWeapon(def) {
    this.weapon = def;
    this.acc.gun.visible = def !== null;
  }

  reset(x, z, heading = 0) {
    this.position.set(x, z);
    this.velocity.set(0, 0);
    this.heading = heading;
    this.downTime = 0;
    this.fall = this.dead ? 1 : 0;
  }

  /** Back on your feet at full health. */
  revive() {
    this.health.reset();
    this.downTime = 0;
    this.fall = 0;
    this.hurtFrom = null;
  }

  /**
   * Fixed-step update. `move` is a desired direction (Vector2, length 0..1) in world space;
   * `run` sprints. Ignored while knocked down. `face` (radians), if given, overrides which way
   * we turn (e.g. toward an aim point) so we can strafe and backpedal.
   */
  update(dt, move, run, world, face = null) {
    this.recoil = Math.max(0, this.recoil - dt * 8);
    if (this.isDown) {
      this.downTime = Math.max(0, this.downTime - dt);
      this.velocity.multiplyScalar(Math.exp(-3 * dt));
    } else {
      const max = run ? RUN_SPEED : WALK_SPEED;
      const tx = move.x * max - this.velocity.x;
      const tz = move.y * max - this.velocity.y;
      const len = Math.hypot(tx, tz);
      const step = Math.min(len, ACCEL * dt);
      if (len > 1e-5) this.velocity.x += (tx / len) * step, this.velocity.y += (tz / len) * step;

      if (face !== null || move.x * move.x + move.y * move.y > 0.01) {
        // Turn smoothly toward the movement direction (or the aim direction, snappier).
        const target = face ?? Math.atan2(move.x, move.y);
        let diff = target - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * Math.min(1, (face !== null ? 25 : 14) * dt);
      }
    }

    this.position.addScaledVector(this.velocity, dt);
    this.#collideStatic(world);
    // Strides get longer as well as quicker when running, so cadence doesn't go frantic.
    const sp = this.speed;
    const runT = Math.min(1, Math.max(0, (sp - WALK_SPEED * 1.05) / (RUN_SPEED * 0.92 - WALK_SPEED * 1.05)));
    this.runBlend += (runT - this.runBlend) * Math.min(1, 8 * dt);
    const cycleLen = 2.8 + (4.9 - 2.8) * this.runBlend; // metres travelled per full gait cycle
    this.gait = (this.gait + (sp / cycleLen) * Math.PI * 2 * dt) % (Math.PI * 2);
  }

  /** Thrown by an impact (e.g. hit by a car). */
  knockDown(impulse, downTime = 2.2) {
    this.velocity.copy(impulse);
    if (this.dead) return; // bodies just get shoved about
    this.downTime = Math.max(this.downTime, downTime);
    this.justKnocked = true;
    if (impulse.lengthSq() > 0.01) this.heading = Math.atan2(-impulse.x, -impulse.y); // fall backwards
  }

  /**
   * Take damage. `impulse` (Vector2, m/s) shoves us; `from` (Vector2) is where it came from.
   * A fatal hit drops us for good. Returns true if this hit killed.
   */
  hurt(amount, impulse = null, from = null, source = null) {
    if (this.dead) return false;
    const killed = this.health.damage(amount, source);
    if (killed) {
      this.downTime = 0;
      this.justKnocked = true; // bystanders scatter just as for a knockdown
      if (impulse) {
        this.velocity.copy(impulse);
        if (impulse.lengthSq() > 0.01) this.heading = Math.atan2(-impulse.x, -impulse.y); // fall backwards
      }
    } else {
      if (impulse) this.velocity.add(impulse);
      if (from) this.hurtFrom = from.clone();
    }
    return killed;
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

    const s = this.isDown ? 0 : Math.min(1, this.speed / (WALK_SPEED * 0.6)); // amplitude (0 = idle)
    const r = this.isDown ? 0 : this.runBlend; // walk -> run blend
    const p = this.gait;
    this.#posLeg(this.legL, this.kneeL, this.footL, p, s, r);
    this.#posLeg(this.legR, this.kneeR, this.footR, p + Math.PI, s, r);
    // Arms swing opposite to the legs: left arm goes back as the left leg comes forward.
    this.#posArm(this.armL, this.elbowL, p, s, r, 1);
    this.#posArm(this.armR, this.elbowR, p + Math.PI, s, r, -1);
    if (this.weapon && !this.isDown) {
      // Gun arm held straight out in front, kicking up a little with each shot.
      this.armR.rotation.set(-Math.PI / 2 - this.recoil * 0.45, 0, 0.12);
      this.elbowR.rotation.x = -this.recoil * 0.3;
    }

    const c2 = Math.cos(2 * p);
    // Walk: highest over the planted foot, lowest in double support.
    // Run: compressed at mid-stance, highest in the flight phase between steps.
    const walkBob = -c2 * 0.035;
    const runBob = Math.cos(2 * (p - 0.75 * Math.PI)) * 0.075;
    this.body.position.y += (walkBob + (runBob - walkBob) * r) * s;

    // Lean into a run; shoulders counter-rotate against the hips; weight sways over the stance leg.
    const lean = (0.05 + 0.2 * r) * s;
    this.torso.rotation.x = lean;
    this.torso.position.z = lean * 0.3; // keep the hips over the feet as the chest tips forward
    this.torso.position.y = 1.15 - 0.03 * r * s;
    this.torso.rotation.y = Math.cos(p) * (0.13 + 0.07 * r) * s;
    this.torso.rotation.z = -Math.sin(p) * (0.045 - 0.025 * r) * s;
  }

  /** One leg at gait phase `p` (0 = this foot striking the ground, PI = pushing off behind). */
  #posLeg(hip, knee, foot, p, s, r) {
    const cp = Math.cos(p);
    // Hip: + swings the leg back. Running drives the knee higher in front and reaches further back.
    const walkHip = -cp * 0.55;
    const runHip = -cp * 0.78 - 0.18 + Math.sin(p) * 0.12; // sin term: quick forward recovery
    const hipX = (walkHip + (runHip - walkHip) * r) * s;
    // Knee: + bends the shin back. A small give on landing, then a big fold while the foot recovers.
    const walkKnee = 0.06 + 0.22 * bump(p, 0.15 * Math.PI, 0.18 * Math.PI) + 1.05 * bump(p, 1.4 * Math.PI, 0.26 * Math.PI);
    const runKnee = 0.2 + 0.55 * bump(p, 0.15 * Math.PI, 0.2 * Math.PI) + 1.95 * bump(p, 1.28 * Math.PI, 0.38 * Math.PI);
    const kneeX = 0.04 + (walkKnee + (runKnee - walkKnee) * r - 0.04) * s;
    hip.rotation.x = hipX;
    knee.rotation.x = kneeX;
    // Ankle: keep the sole flat to the ground in stance, toes point down at push-off and in swing.
    const stance = bump(p, 0.3 * Math.PI, 0.38 * Math.PI);
    const pushOff = bump(p, 0.95 * Math.PI, 0.18 * Math.PI);
    foot.rotation.x = (-(hipX + kneeX) * stance + 0.3 * pushOff + (0.15 + 0.25 * r) * (1 - stance)) * s;
  }

  /** One arm; `p` is the phase of the leg on the same side, `side` +1 left / -1 right. */
  #posArm(shoulder, elbow, p, s, r, side) {
    const cp = Math.cos(p);
    const walkArm = cp * 0.42;
    const runArm = cp * 0.75 - 0.12; // pumps from the shoulder, biased forward
    shoulder.rotation.x = (walkArm + (runArm - walkArm) * r) * s;
    shoulder.rotation.z = side * (0.06 + 0.06 * r * s); // hands clear of the hips
    // Elbow: - bends the forearm forward. Loose when walking, held near 90 degrees when running,
    // closing further as the arm drives forward.
    const fwd = Math.max(0, -cp);
    const walkElbow = -0.22 - 0.35 * fwd;
    const runElbow = -1.35 - 0.4 * fwd + 0.2 * Math.max(0, cp);
    elbow.rotation.x = -0.18 + (walkElbow + (runElbow - walkElbow) * r + 0.18) * s;
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

    const stripe = (geo, x, y) => {
      const st = part(geo, m.stripe, x, y, 0);
      acc.stripes.push(st);
      return st;
    };
    // Two-segment limbs: hip/shoulder pivot swings the whole limb, knee/elbow pivot bends it.
    const leg = (x) => {
      const out = Math.sign(x);
      const hip = new THREE.Group();
      hip.position.set(x, 0.85, 0);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      hip.add(part(G.thigh, m.pants), stripe(G.thighStripe, out * 0.11, -THIGH / 2), knee);
      const ankle = new THREE.Group();
      ankle.position.y = -SHIN + 0.02;
      ankle.add(part(G.shoe, m.shoe, 0, -0.04, 0.06));
      knee.add(part(G.shin, m.pants), stripe(G.shinStripe, out * 0.088, -SHIN / 2), ankle);
      return [hip, knee, ankle];
    };
    const arm = (x) => {
      const out = Math.sign(x);
      const shoulder = new THREE.Group();
      shoulder.position.set(x, 0.3, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -UPPER_ARM;
      shoulder.add(part(G.upperArm, m.sleeve), stripe(G.armStripe, out * 0.08, -UPPER_ARM / 2), elbow);
      const hand = part(G.hand, m.skin, 0, -FOREARM - 0.03, 0);
      elbow.add(part(G.forearm, m.sleeve), hand);
      return [shoulder, elbow, hand];
    };
    [this.legL, this.kneeL, this.footL] = leg(0.13);
    [this.legR, this.kneeR, this.footR] = leg(-0.13);
    body.add(this.legL, this.legR);

    const torso = new THREE.Group();
    torso.position.y = 1.15;
    this.torso = torso;
    body.add(torso);
    const head = part(G.head, m.skin, 0, 0.62, 0); // big round comic head
    head.add(part(G.ear, m.skin, 0.235, -0.02, -0.01), part(G.ear, m.skin, -0.235, -0.02, -0.01));
    const hairMesh = part(G.hair, m.hair, 0, 0.64, -0.02);
    hairMesh.rotation.x = -0.35; // hairline sits back from the face
    this.hairMesh = hairMesh;
    const nose = part(G.nose, m.skin, 0, 0.6, 0.24); // shows which way they face
    torso.add(part(G.chest, m.shirt), part(G.hips, m.pants), part(G.neck, m.skin, 0, 0.42, 0), head, hairMesh, nose);
    [this.armL, this.elbowL] = arm(0.325);
    let handR;
    [this.armR, this.elbowR, handR] = arm(-0.325);
    torso.add(this.armL, this.armR);
    acc.gun = new THREE.Group();
    acc.gun.add(part(G.gunSlide, S.black), part(G.gunGrip, S.grip));
    acc.gun.visible = false;
    handR.add(acc.gun);

    // --- Clothing ---
    acc.placket = part(G.placket, m.inner, 0, 0.07, 0.155);
    acc.placket.rotation.x = -0.08;
    acc.placket.add(part(G.neckline, m.inner, 0, 0.26, -0.06));
    acc.collar = part(G.collar, m.shirt, 0, 0.37, 0);
    acc.chain = part(G.chain, S.gold, 0, 0.34, 0.03);
    acc.badge = part(G.badge, S.gold, 0.14, 0.16, 0.175);
    acc.radio = part(G.radio, S.black, -0.15, 0.24, 0.18);
    for (const sx of [1, -1]) {
      const e = part(G.epaulette, m.epaulette, sx * 0.22, 0.335, 0);
      e.rotation.z = -sx * 0.4; // lie along the slope of the shoulder
      acc.epaulettes.push(e);
      torso.add(e);
    }
    acc.belt = part(G.belt, m.belt, 0, -0.17, 0);
    acc.belt.add(part(G.buckle, S.gold, 0, 0, 0.185));
    acc.holster = part(G.holster, S.black, -0.27, -0.26, 0.02);
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
