import { LAYOUT } from '../world/CityLayout.js';

// Driving on the road graph (see CityLayout.js). Cars drive on the right, one lane each way.
// A car's route is a sequence of half-edges: half-edge h runs from node graph.from(h) to
// graph.to(h); its lane sits `edge.lane` metres right of the centre line.
export const GRAPH = LAYOUT.graph;

export const STOP_GAP = 3.5; // junction edge (setback) -> stop line, just before the crosswalk
export const EXIT_GAP = 2; // junction edge -> where a turn finishes

/** Right-hand side of a travel direction on the XZ plane (matches Car.right). */
export function rightOf([dx, dz]) {
  return [-dz, dx];
}

/** Heading (Car convention: forward = (sin h, cos h)) for a travel direction. */
export function headingOf([dx, dz]) {
  return Math.atan2(dx, dz);
}

/** Distance from h's start node to its stop line at the far end. */
export function stopAlong(h) {
  return GRAPH.edge(h).len - GRAPH.setbackEnd(h) - STOP_GAP;
}

/** World point `s` metres along half-edge h's lane (from its start node), plus its direction. */
export function lanePoint(h, s) {
  const d = GRAPH.dir(h);
  const A = GRAPH.nodes[GRAPH.from(h)];
  const lane = GRAPH.edge(h).lane;
  return { x: A.x + d[0] * s - d[1] * lane, z: A.z + d[1] * s + d[0] * lane, d };
}

/**
 * Picks a random spot in a lane within `maxD` of (x, z): a half-edge and a distance along it,
 * clear of both junctions. Returns { h, s, x, z, d } or null.
 */
export function randomLaneSpot(rng, x, z, maxD) {
  const ids = GRAPH.edgesNear(x, z, maxD);
  if (!ids.length) return null;
  const h = rng.pick(ids) * 2 + (rng.chance(0.5) ? 1 : 0);
  const s0 = GRAPH.setbackStart(h) + 6;
  const s1 = stopAlong(h) - 4;
  if (s1 <= s0) return null;
  const s = rng.range(s0, s1);
  return { h, s, ...lanePoint(h, s) };
}
