import { LAYOUT } from '../world/CityLayout.js';

/**
 * Pedestrian walk graph (built in CityLayout.js): waypoints round every block's sidewalk, at
 * the corners and either side of each crosswalk. `WALK.nodes[k].links` lists { to, crossing }:
 * walking round the block has crossing = null; crossing a road has
 * crossing = { node, edge, mid } — the junction, the road being crossed, and the crosswalk's
 * midpoint (for checking traffic).
 */
export const WALK = LAYOUT.walk;

/** World position of waypoint `k` for a walker keeping `inset` metres in from the curb. */
export function waypoint(k, inset) {
  const n = WALK.nodes[k];
  return { x: n.x + n.vx * inset, z: n.z + n.vz * inset };
}

/** The waypoint nearest to (x, z). */
export function nearestWaypoint(x, z) {
  let best = -1, bestD = Infinity;
  for (let r = 16; best < 0 && r <= 256; r *= 2) {
    for (const k of WALK.hash.query(x - r, z - r, x + r, z + r)) {
      const n = WALK.nodes[k];
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bestD) (bestD = d), (best = k);
    }
  }
  return best < 0 ? 0 : best;
}

/** Waypoints within roughly `r` of (x, z) (so spawners only try sidewalks near the player). */
export function waypointsNear(x, z, r) {
  return WALK.hash.query(x - r, z - r, x + r, z + r);
}
