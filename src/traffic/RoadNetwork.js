import { CITY, roadCenter } from '../world/City.js';

// Intersections are grid nodes (i, j) with i, j in 0..CITY.blocks. Cars drive on the right.
export const HALF_ROAD = CITY.roadWidth / 2;
export const LANE_OFFSET = 3.5; // lane centre distance from the road centre line
export const STOP_DIST = HALF_ROAD + 3.5; // node centre -> stop line (just before the crosswalk)
export const EXIT_DIST = HALF_ROAD + 2; // node centre -> where a turn finishes
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const nodeX = (i) => roadCenter(i);

export function isValidNode(i, j) {
  return i >= 0 && j >= 0 && i <= CITY.blocks && j <= CITY.blocks;
}

/** Right-hand side of a travel direction on the XZ plane (matches Car.right). */
export function rightOf([dx, dz]) {
  return [-dz, dx];
}

/** Heading (Car convention: forward = (sin h, cos h)) for a travel direction. */
export function headingOf([dx, dz]) {
  return Math.atan2(dx, dz);
}

/** 'x' if travelling along the X axis, else 'z'. */
export function axisOf([dx]) {
  return dx !== 0 ? 'x' : 'z';
}
