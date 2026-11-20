import * as THREE from 'three';
import { toon } from '../render/toon.js';

// The sea round the island: a toon-lit plane whose colour is worked out in the shader from the
// distance to the coast (a distance field baked from the shore layout, see seaField). It deepens
// smoothly away from the island and soft ripple lines drift across it. Against the quays the water
// darkens and a thin lip of foam laps at the wall; off the beaches it's shallow and turquoise, and
// surf washes up the sand. The plane itself stays flat (the ink pass reads normals from the
// geometry), so all the motion is in the fragment shader.

/**
 * @param {{minX:number,minZ:number,cell:number,w:number,h:number,dist:Float32Array,beach:Float32Array}} field
 *   signed distance to the waterline (negative on land) and beach-ness, on a grid
 * @param {number} y      water level
 * @param {number} extent side of the water plane
 * @returns {{ mesh: THREE.Mesh, update(dt: number): void }}
 */
export function createWater(field, y, extent) {
  const texels = new Uint16Array(field.w * field.h * 2);
  for (let i = 0; i < field.w * field.h; i++) {
    texels[i * 2] = THREE.DataUtils.toHalfFloat(field.dist[i]);
    texels[i * 2 + 1] = THREE.DataUtils.toHalfFloat(field.beach[i]);
  }
  const coast = new THREE.DataTexture(texels, field.w, field.h, THREE.RGFormat, THREE.HalfFloatType);
  coast.minFilter = coast.magFilter = THREE.LinearFilter;
  coast.wrapS = coast.wrapT = THREE.ClampToEdgeWrapping;
  coast.needsUpdate = true;

  const uniforms = {
    uTime: { value: 0 },
    uCoast: { value: coast },
    uCoastMin: { value: new THREE.Vector2(field.minX, field.minZ) },
    uCoastSize: { value: new THREE.Vector2(field.w * field.cell, field.h * field.cell) },
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
uniform float uTime;
uniform sampler2D uCoast;
uniform vec2 uCoastMin, uCoastSize;

// 2D simplex noise (Ashima Arts / Stefan Gustavson, MIT). Unlike value noise on a square grid it
// is built on triangles, so the ripples don't show square cells when you look closely.
vec3 seaPermute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float seaSimplex(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = seaPermute(seaPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
/** Simplex noise remapped to 0..1. */
float seaNoise(vec2 p) { return 0.5 + 0.5 * seaSimplex(p); }
/** Three octaves, each rotated so no layer shares the others' orientation. */
float seaFbm(vec2 p) {
  const mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
  float n = seaNoise(p) * 0.6;
  p = R * p * 2.03 + 17.1;
  n += seaNoise(p) * 0.3;
  p = R * p * 2.01 - 9.7;
  return n + seaNoise(p) * 0.1;
}

vec3 seaColour(vec2 p) {
  float t = uTime;
  // Distance out from the waterline, and whether that bit of coast is a beach or a quay.
  vec2 coast = texture2D(uCoast, (p - uCoastMin) / uCoastSize).rg;
  float d = coast.r;
  float beach = clamp(coast.g, 0.0, 1.0);
  // Deepens smoothly from teal by the shore to dark blue out at sea; shallow turquoise off the beaches.
  vec3 col = mix(vec3(0.08, 0.36, 0.45), vec3(0.03, 0.17, 0.30), smoothstep(2.0, 60.0, d));
  col = mix(col, vec3(0.16, 0.62, 0.66), beach * (1.0 - smoothstep(0.0, 16.0, d)));
  // Soft moving ripples: difference of two drifting noise fields, lightening the crests.
  float r1 = seaFbm(p * vec2(0.19, 0.12) + vec2(t * 0.08, t * 0.03));
  float r2 = seaFbm(p * vec2(0.12, 0.19) - vec2(t * 0.03, t * 0.08));
  float rip = smoothstep(0.06, 0.0, abs(r1 - r2));
  col += vec3(0.10, 0.16, 0.18) * rip * 0.6;
  // Dark band where a quay wall meets the water.
  col *= mix(mix(0.55, 1.0, smoothstep(0.2, 1.6, d)), 1.0, beach);
  // Foam: a thin lip lapping at the quays; on the beaches, surf washing up and down the sand and
  // lines of breaking waves rolling in.
  float n = seaNoise(p * 0.35 + vec2(t * 0.2, -t * 0.15));
  float quayLip = 0.12 + 0.18 * (0.5 + 0.5 * sin(t * 1.6 + (p.x + p.y) * 0.4)) + seaNoise(p * 0.8 + t) * 0.15;
  float surf = 0.6 + 0.9 * (0.5 + 0.5 * sin(t * 0.9 + n * 3.0)) + n * 0.8;
  float lip = mix(quayLip, surf, beach);
  float wave = fract(t * 0.11 + n * 0.25);
  float waveLine = beach * smoothstep(0.55, 0.0, abs(d - (1.0 - wave) * 9.0 - 1.0)) * smoothstep(0.0, 0.25, wave) * (1.0 - wave) * step(0.45, n);
  float foam = max(step(d, lip), waveLine * 0.9);
  col = mix(col, vec3(0.85, 0.93, 0.95), foam);
  return col;
}
`;
