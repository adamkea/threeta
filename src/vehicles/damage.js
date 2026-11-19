import * as THREE from 'three';
import { Health } from '../combat/Health.js';

/*
 * Vehicle damage, shared by every car model.
 *
 * A vehicle has hit points (a Health) and walks down an ordered list of damage states as they
 * run out. States are plain data, so a new model gets the whole progression for free; a model
 * can tune it with a `damage` entry in carModels.js:
 *
 *   damage: { hp: 1100 }                       // tougher (default DEFAULT_HP)
 *   damage: { engine: -0.35 }                  // rear engine: smoke / fire come from the back
 *   damage: { states: [...] }                  // a completely different progression
 *
 * The last state is always the final one: the vehicle is destroyed (it explodes, leaves a
 * burnt-out shell, and can't be driven or entered).
 *
 * State fields (all optional; anything missing takes the neutral value in NEUTRAL):
 *   name       label (HUD, debugging)
 *   at         health fraction (0..1) at or below which this state begins
 *   power      engine multiplier (acceleration and top speed)
 *   steer      steering multiplier
 *   wear       0..1 how battered the paintwork looks (darkens toward grime, body sags)
 *   shed       loose parts (bumpers, mirrors, plates…) that fall off on entering the state
 *   lights     false = headlights smashed
 *   smoke      null | { color, rate (puffs/s), size, for (seconds, optional) }
 *   fire       null | { rate, size, for } flames from the engine bay
 *   bleed      health fraction lost per second while in this state (fires burn the car out)
 *   bail       AI drivers abandon the car on entering this state
 *   destroyed  the final state (set automatically on the last entry)
 */
export const DEFAULT_HP = 700;

export const DAMAGE_STATES = [
  { name: 'intact', at: 1 },
  { name: 'dented', at: 0.8, wear: 0.2, power: 0.97, shed: 1 },
  { name: 'smoking', at: 0.55, wear: 0.4, power: 0.9, shed: 1, smoke: { color: 0xdcdcdc, rate: 5, size: 0.7 } },
  { name: 'wrecked', at: 0.3, wear: 0.65, power: 0.7, steer: 0.85, shed: 2, lights: false, smoke: { color: 0x1a1a1e, rate: 12, size: 1.0 } },
  {
    name: 'burning',
    at: 0.12,
    wear: 0.8,
    power: 0.5,
    steer: 0.8,
    lights: false,
    bleed: 0.024, // ~5 s from catching fire to exploding
    bail: true,
    smoke: { color: 0x0c0c0e, rate: 16, size: 1.2 },
    fire: { rate: 26, size: 0.9 },
  },
  {
    name: 'destroyed',
    at: 0,
    wear: 1,
    power: 0,
    steer: 0,
    lights: false,
    bail: true,
    smoke: { color: 0x0e0e10, rate: 7, size: 1.2, for: 30 },
    fire: { rate: 18, size: 1.0, for: 12 },
  },
];

const NEUTRAL = { power: 1, steer: 1, wear: 0, shed: 0, lights: true, smoke: null, fire: null, bleed: 0, bail: false, destroyed: false };

/** Fill in defaults, sort best-first and mark the last state as the destroyed one. */
export function normaliseStates(states) {
  const list = states.map((s) => ({ ...NEUTRAL, ...s })).sort((a, b) => b.at - a.at);
  list[0].at = 1;
  const last = list[list.length - 1];
  last.at = 0;
  last.destroyed = true;
  return list;
}

const DEFAULT_LIST = normaliseStates(DAMAGE_STATES);

// Crashes: damage from the change in velocity an impact causes (m/s).
const IMPACT_MIN = 7; // bumps below this are free
const IMPACT_DAMAGE = 9; // hp per m/s above it

const GRIME = new THREE.Color(0x3a3430);
const CHAR = new THREE.Color(0x1b1a1a);
const BURNT_TRIM = new THREE.Color(0x2c2a28);

/**
 * One vehicle's damage: hit points, which state it's in, and the look that goes with it.
 * The vehicle's owner (VehicleDamageSystem) reads `transitions` to react to state changes.
 */
export class VehicleDamage {
  constructor(car, { hp = DEFAULT_HP, states = null, engine = 0.3 } = {}) {
    this.car = car;
    this.health = new Health(hp);
    this.states = states ? normaliseStates(states) : DEFAULT_LIST;
    this.engine = engine; // where the engine sits, as a fraction of length forward of centre
    this.index = 0;
    this.stateTime = 0; // seconds in the current state
    this.transitions = []; // states entered since the owner last looked, in order
    this.sag = { pitch: 0, roll: 0 }; // body knocked out of true
    this.hop = 0; // height thrown up by an explosion (m)
    this.hopV = 0;
    this.refreshLook();
  }

  get state() {
    return this.states[this.index];
  }

  get destroyed() {
    return this.state.destroyed;
  }

  get fraction() {
    return this.health.fraction;
  }

  /** Who did the most recent damage (a shooter, another car…), for blame. */
  get lastSource() {
    return this.health.lastDamage?.source ?? null;
  }

  /** Take `amount` hit points. Returns true if this hit destroyed the vehicle. */
  hit(amount, source = null) {
    if (this.destroyed || amount <= 0) return false;
    this.health.damage(amount, source);
    return this.#refresh();
  }

  /** A crash that changed the vehicle's velocity by `dv` m/s. */
  impact(dv, source = null) {
    const over = dv - IMPACT_MIN;
    return over > 0 ? this.hit(over * IMPACT_DAMAGE, source) : false;
  }

  /** Good as new (used when pooled cars are reused). */
  repair() {
    this.health.reset();
    this.index = 0;
    this.stateTime = 0;
    this.transitions.length = 0;
    this.sag.pitch = this.sag.roll = 0;
    this.hop = this.hopV = 0;
    for (const p of this.car.loose) p.visible = true;
    for (const w of this.car.wheels) w.tyre.visible = true;
    this.refreshLook();
  }

  /** Fixed step: burning cars burn down; explosion hops fall back. */
  update(dt) {
    this.stateTime += dt;
    const bleed = this.state.bleed;
    if (bleed > 0) this.hit(bleed * this.health.max * dt, this.lastSource);
    if (this.hop > 0 || this.hopV > 0) {
      this.hopV -= 25 * dt;
      this.hop += this.hopV * dt;
      if (this.hop <= 0) (this.hop = 0), (this.hopV = 0);
    }
  }

  /** Is the state's smoke / fire still going? (Wrecks smoulder, then go out.) */
  emitting(fx) {
    return !!fx && (fx.for == null || this.stateTime < fx.for);
  }

  /** Engine bay position in world space (where smoke and flames come from). */
  enginePoint(out = new THREE.Vector3()) {
    const c = this.car;
    const f = c.forward;
    const o = c.cfg.length * this.engine;
    return out.set(c.position.x + f.x * o, c.y + 1.0 + this.hop, c.position.y + f.y * o);
  }

  /** Detach up to `n` loose parts; returns the meshes (still in place, now hidden) for debris. */
  shedParts(n, rng = Math.random) {
    const out = [];
    const left = this.car.loose.filter((p) => p.visible);
    while (n-- > 0 && left.length) {
      const p = left.splice(Math.floor(rng() * left.length), 1)[0];
      p.visible = false;
      out.push(p);
    }
    return out;
  }

  #refresh() {
    const f = this.health.fraction;
    let target = this.index;
    for (let k = this.index + 1; k < this.states.length; k++) if (f <= this.states[k].at) target = k;
    if (this.health.dead) target = this.states.length - 1;
    if (target === this.index) return false;
    for (let k = this.index + 1; k <= target; k++) this.transitions.push(this.states[k]);
    this.index = target;
    this.stateTime = 0;
    // Each knock bends the body a little further out of true.
    const w = this.state.wear;
    this.sag.pitch = (Math.random() - 0.5) * 0.06 * w;
    this.sag.roll = (Math.random() - 0.5) * 0.08 * w;
    if (this.destroyed) for (const wh of this.car.wheels) wh.tyre.visible = false; // burnt to the rims
    this.refreshLook();
    return this.destroyed;
  }

  /** Paint, lights and stripes for the current state. */
  refreshLook() {
    const c = this.car;
    const s = this.state;
    const tint = (mat, base) => {
      if (!mat) return;
      if (s.destroyed) mat.color.copy(CHAR);
      else mat.color.copy(base).lerp(GRIME, s.wear * 0.45);
    };
    tint(c.paint, c.baseColor);
    if (c.roofPaint !== c.paint) tint(c.roofPaint, c.baseRoofColor);
    if (c.stripeMat) {
      if (s.destroyed) c.stripeMat.color.copy(BURNT_TRIM);
      else c.stripeMat.color.copy(c.baseStripeColor).lerp(GRIME, s.wear * 0.45);
    }
    if (c.headMat) c.headMat.emissiveIntensity = s.lights ? 1 : 0;
    if (c.headMat) c.headMat.color.setHex(s.lights ? 0xffffee : 0x2a2a2a);
  }
}
