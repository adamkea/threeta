import * as THREE from 'three';

/**
 * Comic-book shading: direct light is quantised into a few hard bands (lit / mid / shadow),
 * which together with the ink-outline pass gives the flat, hand-inked look.
 */
let gradient = null;
function gradientMap() {
  if (gradient) return gradient;
  const tones = new Uint8Array([90, 175, 255]);
  gradient = new THREE.DataTexture(tones, tones.length, 1, THREE.RedFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

/** MeshToonMaterial with the shared 3-band gradient. Takes the usual material params. */
export function toon(params = {}) {
  return new THREE.MeshToonMaterial({ gradientMap: gradientMap(), ...params });
}
