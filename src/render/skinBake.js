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
 * Skeleton whose bones are the given scene nodes, moved directly in world space (identity bind
 * pose), so the SkinnedMeshes built on it follow the nodes exactly as child meshes would.
 */
export function worldSkeleton(bones) {
  return new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4()));
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
