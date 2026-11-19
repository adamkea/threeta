import { CITY, roadCenter } from '../world/City.js';

/**
 * Pedestrian walk graph. Every block has a sidewalk ring with a waypoint at each corner; the
 * corners line up into a global grid of (ix, iz), ix/iz in 0..SIZE-1. Along one axis,
 * index k sits on block k >> 1, at its near edge if k is even or far edge if odd.
 *
 * - Moving k -> k ^ 1 walks along one side of a block.
 * - Moving between k's of different blocks crosses a road at the zebra crossing.
 */
export const SIZE = CITY.blocks * 2;

/** World coordinate of waypoint index `k`, `inset` metres in from the curb. */
export function coord(k, inset) {
  const min = roadCenter(k >> 1) + CITY.roadWidth / 2;
  return k & 1 ? min + CITY.blockSize - inset : min + inset;
}

export function isValid(ix, iz) {
  return ix >= 0 && iz >= 0 && ix < SIZE && iz < SIZE;
}

/** Index of the waypoint nearest to world coordinate `v` on one axis. */
export function nearestIndex(v, inset) {
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < SIZE; k++) {
    const d = Math.abs(coord(k, inset) - v);
    if (d < bestD) (bestD = d), (best = k);
  }
  return best;
}

/** Road line (0..blocks) closest to waypoint index `k`. */
const roadLineOf = (k) => (k + 1) >> 1;

/**
 * If walking from -> to crosses a road, describes the crossing: the junction node it's at,
 * which traffic axis must have a green for people to cross, and the crosswalk midpoint.
 */
export function crossingOf([fx, fz], [tx, tz]) {
  if (fx !== tx) {
    if (fx >> 1 === tx >> 1) return null;
    const line = Math.max(fx, tx) / 2; // road running along Z
    const j = roadLineOf(fz);
    return { node: [line, j], greenAxis: 'x', mid: { x: roadCenter(line), z: coord(fz, 2) } };
  }
  if (fz >> 1 === tz >> 1) return null;
  const line = Math.max(fz, tz) / 2; // road running along X
  const i = roadLineOf(fx);
  return { node: [i, line], greenAxis: 'z', mid: { x: coord(fx, 2), z: roadCenter(line) } };
}

/** All waypoints reachable in one hop from (ix, iz). */
export function neighbours(ix, iz) {
  const out = [];
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (isValid(ix + dx, iz + dz)) out.push([ix + dx, iz + dz]);
  }
  return out;
}
