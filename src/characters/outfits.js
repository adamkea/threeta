import { CITY } from '../world/City.js';

/**
 * Character looks. A look is a plain object describing clothes + accessories; Pedestrian.setLook
 * applies it to the shared body. Roles are built so they read from the high overhead camera:
 * what you mostly see is the top of the head and the shoulders, so every role gets a distinct
 * piece of headwear and a strong shoulder/chest colour.
 *
 * Look fields (all optional):
 *   shirt      main torso colour (jacket colour when `inner` is set)
 *   inner      shirt showing down the front of an open jacket
 *   sleeves    arm colour (defaults to `shirt`)
 *   pants, shoes, skin, hair
 *   hat        { type: 'police'|'cap'|'beanie'|'durag'|'hood', color, trim, backwards }
 *   glasses    sunglasses
 *   mask       bandana colour pulled over the lower face
 *   chain      gold neck chain
 *   badge      gold badge on the chest
 *   epaulettes shoulder-board colour
 *   radio      shoulder radio
 *   belt       belt colour
 *   stripes    tracksuit stripe colour down the legs (and sleeves)
 *   scale      body size multiplier
 *   hairStyle  'short'|'long'|'ponytail'|'bun'|'afro'|'bald'
 *   body       { heavy, broad, curvy }: build, roughly -1..1 / 0..1 (see bodyShapes.js)
 *   face       { jaw, long, size }: face shape (-1..1) and head size (~1)
 */

const SKINS = [0xf1d0b5, 0xe0b48f, 0xc68e64, 0x8d5a3b, 0x5c3a24];
const HAIR = [0x2a1c14, 0x111111, 0x6b4a2f, 0xc9a35b, 0x8a8a8a, 0x9b3b1e];

/**
 * A random build and face. `frame` -1..1 runs from curvy (narrow shoulders, wide hips) to broad
 * (V-shaped); `heavy` from skinny to heavyset. Options skew the ranges for a role.
 */
function physique(rng, { heavy = [-0.6, 1], frame = [-1, 1] } = {}) {
  const f = rng.range(frame[0], frame[1]);
  // Most people are near average; a few are properly heavy or skinny.
  const h = (rng.range(heavy[0], heavy[1]) + rng.range(heavy[0], heavy[1])) / 2;
  return {
    body: { heavy: h, broad: Math.max(0, f), curvy: Math.max(0, -f) },
    face: { jaw: rng.range(-0.8, 0.9) + 0.4 * f, long: rng.range(-0.8, 0.8), size: rng.range(0.95, 1.05) },
  };
}

/** A hairstyle; long styles are likelier on curvier frames. */
function hairStyle(rng, body) {
  const longish = 0.15 + 0.6 * body.curvy;
  const r = rng.next();
  if (r < longish) return rng.pick(['long', 'long', 'ponytail', 'bun']);
  return rng.pick(['short', 'short', 'short', 'afro', 'bald', 'ponytail', 'long']);
}

// Civilians stay in everyday, slightly muted colours so the uniforms and gang colours pop.
const CIV_SHIRTS = [0x7fa7c9, 0xe8e2d0, 0xd9a066, 0x6c8f7d, 0xc98b8b, 0x9a9a9a, 0xd8c35a, 0x5b7a99, 0xe6b8c4, 0xf2f2f2];
const CIV_JACKETS = [0x5a4632, 0x3d4a5c, 0x6b6b6b, 0x7c6a4f, 0x2f3b33];
const CIV_PANTS = [0x2b2f3a, 0x4a3b2a, 0x1f3550, 0x5a5a5a, 0x7a6a4f, 0x3a3a3a, 0xb8a98a];
const CIV_HATS = [0x3b4b6b, 0x6e6a4a, 0x4f4f4f, 0xc9b98a, 0x2e5d4b];

export const POLICE = {
  uniform: 0x1b2a4e,
  shirt: 0x8fb3dc,
  gold: 0xf2c230,
  capTop: 0xf4f4f0,
};

/** The city's gangs. Each owns a slice of the outskirts; colours are reserved for them. */
export const GANGS = {
  reds: { name: 'Red Fangs', color: 0xd4202c, dark: 0x5a0c12 },
  purples: { name: 'Violet Saints', color: 0x8a3fd1, dark: 0x3b1a5e },
  greens: { name: 'Lime Vipers', color: 0x5fd12e, dark: 0x22461a },
};

export function civilianLook(rng) {
  const look = {
    shirt: rng.pick(CIV_SHIRTS),
    pants: rng.pick(CIV_PANTS),
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIR),
    scale: rng.range(0.9, 1.08),
    ...physique(rng),
  };
  look.hairStyle = hairStyle(rng, look.body);
  if (rng.chance(0.3)) {
    look.inner = look.shirt;
    look.shirt = look.sleeves = rng.pick(CIV_JACKETS);
  }
  const r = rng.next();
  if (r < 0.18) look.hat = { type: 'cap', color: rng.pick(CIV_HATS), backwards: rng.chance(0.2) };
  else if (r < 0.28) look.hat = { type: 'beanie', color: rng.pick(CIV_HATS) };
  if (rng.chance(0.12)) look.glasses = true;
  return look;
}

export function copLook(rng) {
  return {
    shirt: POLICE.uniform,
    sleeves: POLICE.shirt,
    pants: POLICE.uniform,
    shoes: 0x0c0c0e,
    skin: rng.pick(SKINS),
    hair: rng.pick(HAIR),
    // White-topped cap: a bright disc from overhead that nobody else wears.
    hat: { type: 'police', color: POLICE.capTop, trim: POLICE.uniform },
    badge: true,
    epaulettes: POLICE.gold,
    radio: true,
    belt: 0x0c0c0e,
    glasses: rng.chance(0.35),
    scale: rng.range(1.02, 1.1),
    ...physique(rng, { heavy: [-0.3, 0.9], frame: [-0.6, 1] }),
    hairStyle: rng.pick(['short', 'short', 'ponytail', 'bald']),
  };
}

export function gangLook(rng, gang) {
  const g = GANGS[gang];
  const base = { skin: rng.pick(SKINS), hair: rng.pick(HAIR), scale: rng.range(0.98, 1.1), ...physique(rng, { heavy: [-0.7, 0.7] }) };
  base.hairStyle = hairStyle(rng, base.body);
  switch (gang) {
    case 'reds': // red do-rag, black jacket with red sleeves, bandana masks, gold chains
      return {
        ...base,
        shirt: 0x1a1a1c,
        inner: g.color,
        sleeves: g.color,
        pants: 0x1a1a1c,
        hat: { type: 'durag', color: g.color },
        mask: rng.chance(0.5) ? g.color : null,
        chain: rng.chance(0.6),
        belt: g.color,
      };
    case 'purples': // matching purple tracksuits with white stripes, backwards caps, shades
      return {
        ...base,
        shirt: g.color,
        pants: g.color,
        stripes: 0xf5f5f5,
        shoes: 0xf5f5f5,
        hat: { type: 'cap', color: g.dark, backwards: true },
        glasses: rng.chance(0.7),
        chain: rng.chance(0.4),
      };
    case 'greens': // lime hoodies with the hood up
    default:
      return {
        ...base,
        shirt: g.color,
        pants: 0x3a3d33,
        hat: { type: 'hood', color: g.color },
        mask: rng.chance(0.3) ? 0x161616 : null,
        belt: g.dark,
      };
  }
}

const DOWNTOWN_RADIUS = CITY.half * 0.32;

/**
 * Whose turf a point is on. Downtown is neutral; the outskirts are split into three wedges.
 * Returns a key of GANGS, or null.
 */
export function turfAt(x, z) {
  if (Math.hypot(x, z) < DOWNTOWN_RADIUS) return null;
  const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
  return ['reds', 'purples', 'greens'][Math.floor((a / (Math.PI * 2)) * 3) % 3];
}

/**
 * Pick who to spawn at (x, z): cops patrol everywhere (more downtown), gang members hang out
 * on their own turf. Returns { role, gang, look }.
 */
export function rollPerson(rng, x, z) {
  const turf = turfAt(x, z);
  const copChance = turf ? 0.06 : 0.12;
  if (rng.chance(copChance)) return { role: 'cop', gang: null, look: copLook(rng) };
  if (turf && rng.chance(0.3)) return { role: 'gang', gang: turf, look: gangLook(rng, turf) };
  return { role: 'civilian', gang: null, look: civilianLook(rng) };
}
