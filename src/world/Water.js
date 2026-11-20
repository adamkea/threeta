import * as THREE from 'three';
import { toon } from '../render/toon.js';

// The sea round the island: a toon-lit plane whose colour is worked out in the shader from the
// distance to the quay. Shallow turquoise against the quay wall steps down through flat comic
// bands to deep blue out at sea, with white foam slapping against the wall, swell lines rolling in
// to the shore and wavy glints drifting across open water. The plane itself stays flat (the ink
// pass reads normals from the geometry), so all the motion is in the fragment shader.

const SHALLOW = new THREE.Color(0x5cbcca);
const MID = new THREE.Color(0x3393bf);
const DEEP = new THREE.Color(0x2a74a9);
const FOAM = new THREE.Color(0xeaf6f9);
const GLINT = new THREE.Color(0xb9ecf5);

/**
 * @param {number} half   half-size of the (square) island, in metres
 * @param {number} y      water level
 * @param {number} extent side of the water plane
 * @returns {{ mesh: THREE.Mesh, update(dt: number): void }}
 */
export function createWater(half, y, extent) {
  const uniforms = {
    uTime: { value: 0 },
    uHalf: { value: half },
    uShallow: { value: SHALLOW },
    uMid: { value: MID },
    uDeep: { value: DEEP },
    uFoam: { value: FOAM },
    uGlint: { value: GLINT },
  };

  const mat = toon({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vSeaPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SEA_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = seaColour(vSeaPos);');
  };
  mat.customProgramCacheKey = () => 'threeta-sea';

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.receiveShadow = true; // the quay and tall buildings shade the water beside them

  return {
    mesh,
    update(dt) {
      uniforms.uTime.value = (uniforms.uTime.value + dt) % 1000;
    },
  };
}

const SEA_GLSL = /* glsl */ `
varying vec2 vSeaPos;
uniform float uTime, uHalf;
uniform vec3 uShallow, uMid, uDeep, uFoam, uGlint;

float seaHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float seaNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1, 0)), u.x),
             mix(seaHash(i + vec2(0, 1)), seaHash(i + vec2(1, 1)), u.x), u.y);
}
float seaFbm(vec2 p) {
  return seaNoise(p) * 0.6 + seaNoise(p * 2.03 + 17.1) * 0.3 + seaNoise(p * 4.1 - 9.7) * 0.1;
}

vec3 seaColour(vec2 p) {
  float t = uTime;
  // Distance out from the quay (a square island), and how far along the nearest stretch of it.
  vec2 q = abs(p) - uHalf;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  float along = q.x > q.y ? p.y : p.x;

  // A slow wobble so the band edges and wave fronts look hand-drawn rather than ruled.
  float wob = (seaFbm(p * 0.06 + vec2(t * 0.03, -t * 0.02)) - 0.5) * 6.0;
  float dw = d + wob;

  // Flat comic depth bands: shallow by the wall, mid, then deep. Hard steps, no gradient.
  vec3 col = uDeep;
  col = mix(col, uMid, step(dw, 34.0));
  col = mix(col, uShallow, step(dw, 9.0));

  // Out at sea: wavy glints drifting with the current, thinning out near the shore.
  vec2 gp = p * vec2(0.11, 0.19) + vec2(t * 0.05, t * 0.08);
  float g = seaFbm(gp + seaFbm(gp * 0.7 - t * 0.04) * 1.6);
  float glint = 1.0 - smoothstep(0.012, 0.03, abs(g - 0.55));
  glint *= step(0.45, seaNoise(p * 0.08 - t * 0.03)) * smoothstep(6.0, 16.0, d);
  col = mix(col, mix(col, uGlint, 0.75), glint);

  // Swell lines rolling in toward the quay, breaking up into dashes as they come.
  float phase = (d + wob * 0.4) * 0.16 + t * 0.5;
  // Each line thins to nothing at its ends rather than stopping square.
  float dash = smoothstep(0.38, 0.58, seaNoise(vec2(along * 0.09, floor(phase) * 3.7)));
  float edge = 0.5 - 0.06 * dash;
  float swell = step(0.001, dash) * smoothstep(edge, edge + 0.02, abs(fract(phase) - 0.5));
  swell *= smoothstep(30.0, 14.0, d) * smoothstep(1.5, 4.0, d);
  col = mix(col, mix(col, uFoam, 0.7), swell);

  // Foam against the quay wall: it surges out and drains back, ragged along its edge.
  float surge = 0.5 + 0.5 * sin(t * 1.3 + along * 0.05);
  float rag = seaFbm(vec2(along * 0.35, t * 0.4)) * 0.5;
  float foam = step(d, 0.25 + surge * 0.55 + rag);
  // A second, broken ring a little further out, chasing the surge.
  float ringW = 0.18 * smoothstep(0.35, 0.6, seaNoise(vec2(along * 0.22, t * 0.3)));
  float ring = 1.0 - smoothstep(ringW - 0.05, ringW, abs(d - (1.4 + surge * 1.2 + rag)));
  ring *= step(0.001, ringW);
  col = mix(col, uFoam, max(foam, ring * 0.9));

  return col;
}
`;
