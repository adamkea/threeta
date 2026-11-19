import * as THREE from 'three';
import { toon } from '../render/toon.js';
import { ColliderGrid } from './ColliderGrid.js';
import { overlaps } from './colliders.js';

const COUNT = 12; // phones round town
const SPACING = 110; // at least this far apart
const INSET = 0.75; // metres in from the curb

/**
 * Pay phones: kerbside pedestals dotted round the city, spread out so there's always one within
 * a block or two. They're where missions come from (see missions/MissionSystem.js). Placed on
 * ordinary blocks' sidewalks, clear of the lamps, hydrants and bins already there.
 *
 * Returns { group, phones: [{ id, x, z, heading, stand: { x, z } }] }; `heading` is the way the
 * phone faces (into the block, towards whoever's using it), `stand` where they'd stand.
 */
export function createPayPhones(rng, blocks, colliders, y0) {
  const grid = new ColliderGrid(colliders);
  const clear = (x, z, r) => !grid.query(x, z).some((b) => overlaps(b, x, z, r));
  const phones = [];
  const order = blocks.filter((b) => b.use === 'buildings').map((b) => ({ b, k: rng.next() })).sort((a, c) => a.k - c.k);

  for (const { b } of order) {
    if (phones.length >= COUNT) break;
    if (phones.some((p) => Math.hypot(p.x - b.center.x, p.z - b.center.z) < SPACING)) continue;
    const spot = findSpot(b.shape, clear);
    if (!spot) continue;
    if (phones.some((p) => Math.hypot(p.x - spot.x, p.z - spot.z) < SPACING)) continue;
    phones.push({ id: phones.length, ...spot });
  }

  const group = new THREE.Group();
  const parts = phoneParts();
  for (const p of phones) {
    const g = new THREE.Group();
    for (const mesh of parts) g.add(mesh.clone());
    g.position.set(p.x, y0, p.z);
    g.rotation.y = p.heading;
    g.traverse((o) => (o.castShadow = o.receiveShadow = true));
    group.add(g);
    colliders.push({ minX: p.x - 0.3, maxX: p.x + 0.3, minZ: p.z - 0.3, maxZ: p.z + 0.3 });
  }
  return { group, phones };
}

/** A clear kerbside spot along one of the block's longer edges, or null. */
function findSpot(shape, clear) {
  const edges = shape
    .map((p, i) => ({ p, q: shape[(i + 1) % shape.length] }))
    .map((e) => ({ ...e, L: Math.hypot(e.q.x - e.p.x, e.q.z - e.p.z) }))
    .filter((e) => e.L > 24)
    .sort((a, c) => c.L - a.L);
  for (const { p, q, L } of edges) {
    const dx = (q.x - p.x) / L, dz = (q.z - p.z) / L;
    const ix = -dz, iz = dx; // into the block
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const x = p.x + dx * L * t + ix * INSET;
      const z = p.z + dz * L * t + iz * INSET;
      // Room for the phone itself and for someone stood in front of it.
      if (!clear(x, z, 0.9) || !clear(x + ix * 1.2, z + iz * 1.2, 0.6)) continue;
      return { x, z, heading: Math.atan2(ix, iz), stand: { x: x + ix * 1.1, z: z + iz * 1.1 } };
    }
  }
  return null;
}

/** One phone's meshes (shared geometry and materials, cloned per phone). Front faces +Z. */
function phoneParts() {
  const blue = toon({ color: 0x1f4f8f });
  const steel = toon({ color: 0xb8bcc2 });
  const dark = toon({ color: 0x1c1d21 });
  const sign = toon({ map: phoneSign() });
  const at = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  return [
    at(new THREE.BoxGeometry(0.16, 1.1, 0.16), steel, 0, 0.55, -0.05), // post
    at(new THREE.BoxGeometry(0.62, 0.8, 0.38), blue, 0, 1.45, 0), // box
    at(new THREE.BoxGeometry(0.4, 0.5, 0.04), steel, 0, 1.45, 0.2), // faceplate
    at(new THREE.BoxGeometry(0.1, 0.36, 0.08), dark, -0.24, 1.48, 0.24), // handset
    at(new THREE.BoxGeometry(0.8, 0.08, 0.6), blue, 0, 2.05, 0.04), // hood
    at(new THREE.BoxGeometry(0.62, 0.24, 0.04), [dark, dark, dark, dark, sign, sign], 0, 2.24, 0), // PHONE sign on top
  ];
}

function phoneSign() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const g = c.getContext('2d');
  g.fillStyle = '#1f4f8f';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#ffffff';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PHONE', 64, 26);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
