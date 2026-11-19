/**
 * HUD silhouettes for the weapon panel, keyed by weapon id. Each is a 64x32 SVG drawn in
 * `currentColor` with a thick ink outline so it matches the HUD's stroked comic text.
 * Adding a gun to WEAPONS? Add its icon here; unknown ids fall back to the pistol.
 */
const wrap = (body) =>
  `<svg viewBox="0 0 64 32" aria-hidden="true">` +
  `<g fill="currentColor" stroke="#14110f" stroke-width="2.5" stroke-linejoin="round">${body}</g></svg>`;

export const WEAPON_ICONS = {
  // Side-on semi-auto, muzzle pointing left.
  pistol: wrap(
    '<path d="M6 7 H56 L58 9 V16 H46 L42 18 L44 28 L34 29 L31 18 H24 L22 21 H18 L17 16 H6 Z"/>' +
      '<path d="M24 18 Q25 24 31 22" fill="none"/>',
  ),
  // Unarmed: a clenched fist.
  fist: wrap(
    '<path d="M18 10 Q18 6 22 6 H44 Q48 6 48 10 V20 Q48 27 41 27 H26 Q19 27 18 21 Z"/>' +
      '<path d="M26 6 V14 M33 6 V14 M40 6 V14" fill="none"/>' +
      '<path d="M18 16 Q14 14 12 17 Q11 21 16 23 L19 23" />',
  ),
};

export function weaponIcon(def) {
  if (!def) return WEAPON_ICONS.fist;
  return WEAPON_ICONS[def.id] ?? WEAPON_ICONS.pistol;
}
