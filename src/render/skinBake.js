import * as THREE from 'three';

/**
 * Helpers for drawing a whole articulated model (a person, a car) in a handful of draw calls.
 *
 * The model is still built as an ordinary Object3D tree and animated by moving its pivots, but
 * its parts are baked into a few SkinnedMeshes: every vertex is bound with full weight to the
 * nearest "bone" (an ordinary node of the tree) above its part. Parts that only differ in
 * colour share one mesh: each vertex carries a colour `slot`, and the material looks the colour
 * up in a per-model palette. Showing / hiding a part = scaling its bone to zero.
 */

const _inv = new THREE.Matrix4();

/** Nearest node at or above `node` that `isBone` accepts. */
export function boneOf(node, isBone) {
  let b = node;
  while (!isBone(b)) b = b.parent;
  return b;
}

/**
 * Copy of `src` moved from `node`'s space into `bone`'s space, bound with full weight to bone
 * index `boneIndex` and tagged with colour `slot`. Only position / normal (and uv if asked)
 * are kept, always indexed, so any mix of parts can be merged.
 */
export function bindPart(src, node, bone, boneIndex, slot = 0, uv = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  g.setAttribute('normal', src.getAttribute('normal').clone());
  if (uv) g.setAttribute('uv', src.getAttribute('uv').clone());
  const n = g.getAttribute('position').count;
  g.setIndex(src.index ? src.index.clone() : [...Array(n).keys()]);
  g.applyMatrix4(_inv.copy(bone.matrixWorld).invert().multiply(node.matrixWorld));
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) (skinIndex[k * 4] = boneIndex), (skinWeight[k * 4] = 1);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  g.setAttribute('slot', new THREE.Float32BufferAttribute(new Float32Array(n).fill(slot), 1));
  return g;
}

/**
 * Make `material` (toon or basic) colour each vertex from `palette` (array of Color) by its
 * `slot` attribute. Every material with the same type and palette size shares one program.
 */
export function usePalette(material, palette) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.slotColors = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float slot;\nvarying float vSlot;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSlot = slot;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 slotColors[${palette.length}];\nvarying float vSlot;`)
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse * slotColors[ int( vSlot + 0.5 ) ], opacity );',
      );
  };
  material.customProgramCacheKey = () => `palette-${material.type}-${palette.length}`;
  return material;
}

/**
 * Skeleton whose bones are the given scene nodes, moved directly in world space, so the
 * SkinnedMeshes built on it follow the nodes exactly as child meshes would. By default the
 * bind pose is the identity (geometry from `bindPart`, in each vertex's own bone space). With
 * `restPose` the geometry is instead in world space as the model stood when it was built
 * (needed once a vertex follows more than one bone, see blendJoints).
 */
export function worldSkeleton(bones, restPose = false) {
  return new THREE.Skeleton(bones, bones.map((b) => (restPose ? b.matrixWorld.clone().invert() : new THREE.Matrix4())));
}

/** A SkinnedMesh on `skeleton` with fixed bounds (skips per-frame CPU skinning for culling). */
export function rigMesh(geometry, material, skeleton, sphere) {
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.boundingSphere = sphere;
  return mesh;
}

/** Show or hide a bone (and everything baked onto it). */
export function showBone(node, on) {
  node.scale.setScalar(on ? 1 : 0);
}

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _toSpace = new THREE.Matrix4();

/** A `bindPart` geometry moved out of its bone's space into world space (the rest pose). */
export function toRestPose(geo, bone) {
  return geo.applyMatrix4(bone.matrixWorld);
}

/**
 * Soften the hinges of a part made by `bindPart` and moved to the rest pose with `toRestPose`
 * (so far bound wholly to `bone`), for a skeleton made with `restPose`: vertices near a
 * joint share their weight with the bone on the other side of it, so a bent knee or elbow
 * bends the surface round the corner instead of two rigid pieces crossing.
 *
 * Each joint: { parent, child } bones, `center` and unit `axis` (pointing from the parent's
 * side into the child's) in the space of `space` (an Object3D; its current world matrix),
 * `band` = half the width of the blend along the axis, `reach` = how far from the axis it
 * applies. The blend is the same smooth ramp from both sides, so the surfaces meet without a
 * seam. `childOnly` joints only pull the child's vertices toward the parent (for joints where
 * the parent's own parts must stay put, e.g. the chest round a shoulder).
 */
export function blendJoints(geo, bone, bones, joints, space) {
  const mine = joints.filter((j) => j.child === bone || (j.parent === bone && !j.childOnly));
  if (!mine.length) return geo;
  _toSpace.copy(space.matrixWorld).invert();
  const pos = geo.getAttribute('position');
  const skinIndex = geo.getAttribute('skinIndex');
  const skinWeight = geo.getAttribute('skinWeight');
  const own = bones.indexOf(bone);
  for (let k = 0; k < pos.count; k++) {
    _p.fromBufferAttribute(pos, k).applyMatrix4(_toSpace);
    const w = new Map([[own, 1]]);
    for (const j of mine) {
      _d.subVectors(_p, j.center);
      const along = _d.dot(j.axis);
      const radial = _d.addScaledVector(j.axis, -along).length();
      if (radial >= j.reach) continue;
      const t = THREE.MathUtils.clamp((along + j.band) / (2 * j.band), 0, 1);
      const s = t * t * (3 - 2 * t); // child's share at this point along the joint
      const falloff = 1 - THREE.MathUtils.smoothstep(radial, j.reach * 0.7, j.reach);
      const isChild = j.child === bone;
      const give = (isChild ? 1 - s : s) * falloff;
      const other = bones.indexOf(isChild ? j.parent : j.child);
      const moved = w.get(own) * give;
      w.set(own, w.get(own) - moved);
      w.set(other, (w.get(other) ?? 0) + moved);
    }
    const top = [...w].filter(([, v]) => v > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, [, v]) => a + v, 0);
    for (let i = 0; i < 4; i++) {
      skinIndex.setComponent(k, i, top[i]?.[0] ?? 0);
      skinWeight.setComponent(k, i, top[i] ? top[i][1] / sum : 0);
    }
  }
  return geo;
}

const _q = new THREE.Vector3();
const _dq = new THREE.Vector3();

/**
 * Give a part (already in rest-pose world space, see toRestPose) `count` relative morph
 * targets. `delta(k, p, out)` writes the displacement of point `p` for target `k`. Normal
 * changes come from recomputing normals on the moved surface and taking the difference, so
 * shading follows the new shape (and any seams in the recomputed normals cancel out).
 */
export function addMorphs(geo, count, delta) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const normalsOf = (positions) => {
    const g = new THREE.BufferGeometry();
    g.setIndex(geo.index);
    g.setAttribute('position', positions);
    g.computeVertexNormals();
    return g.getAttribute('normal').array;
  };
  const base = normalsOf(pos);
  geo.morphAttributes.position = [];
  geo.morphAttributes.normal = [];
  for (let k = 0; k < count; k++) {
    const dp = new Float32Array(n * 3);
    const moved = new Float32Array(n * 3);
    let any = false;
    for (let i = 0; i < n; i++) {
      _q.fromBufferAttribute(pos, i);
      delta(k, _q, _dq);
      if (_dq.x || _dq.y || _dq.z) any = true;
      dp[i * 3] = _dq.x, dp[i * 3 + 1] = _dq.y, dp[i * 3 + 2] = _dq.z;
      moved[i * 3] = _q.x + _dq.x, moved[i * 3 + 1] = _q.y + _dq.y, moved[i * 3 + 2] = _q.z + _dq.z;
    }
    const dn = new Float32Array(n * 3);
    if (any) {
      const nm = normalsOf(new THREE.BufferAttribute(moved, 3));
      for (let i = 0; i < n * 3; i++) dn[i] = nm[i] - base[i];
    }
    geo.morphAttributes.position.push(new THREE.Float32BufferAttribute(dp, 3));
    geo.morphAttributes.normal.push(new THREE.Float32BufferAttribute(dn, 3));
  }
  geo.morphTargetsRelative = true;
  return geo;
}
