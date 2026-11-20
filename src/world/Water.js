import * as THREE from 'three';
import { toon } from '../render/toon.js';

// The sea round the island: a toon-lit plane whose colour is worked out in the shader from the
// distance to the quay. It deepens smoothly away from the island, soft ripple lines drift across
// it, the water darkens where it meets the quay wall and a thin lip of foam laps against the wall.
// The plane itself stays flat (the ink pass reads normals from the geometry), so all the motion
// is in the fragment shader.

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
  // Deepens smoothly from teal by the quay to dark blue out at sea.
  vec3 col = mix(vec3(0.08, 0.36, 0.45), vec3(0.03, 0.17, 0.30), smoothstep(2.0, 60.0, d));
  // Soft moving ripples: difference of two drifting noise fields, lightening the crests.
  float r1 = seaFbm(p * vec2(0.35, 0.22) + vec2(t * 0.15, t * 0.05));
  float r2 = seaFbm(p * vec2(0.22, 0.35) - vec2(t * 0.06, t * 0.14));
  float rip = smoothstep(0.08, 0.0, abs(r1 - r2));
  col += vec3(0.10, 0.16, 0.18) * rip * 0.6;
  // Dark band where the wall meets the water.
  col *= mix(0.55, 1.0, smoothstep(0.2, 1.6, d));
  // Thin lip of foam lapping against the wall.
  float lip = 0.12 + 0.18 * (0.5 + 0.5 * sin(t * 1.6 + along * 0.4)) + seaNoise(vec2(along * 0.8, t)) * 0.15;
  col = mix(col, vec3(0.85, 0.93, 0.95), step(d, lip));
  return col;
}
`;
