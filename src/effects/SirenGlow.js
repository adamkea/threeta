import * as THREE from 'three';

/**
 * Layer for glows and light washes: drawn in the colour pass but left out of the ink
 * renderer's normal pass, so they don't pick up black outlines (see InkRenderer).
 */
export const GLOW_LAYER = 1;

const RED = new THREE.Color(0xff2a3a);
const BLUE = new THREE.Color(0x3a7cff);

let glowTex = null;
/** Soft round falloff, white so materials can tint it. */
function glowTexture() {
  if (glowTex) return glowTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.65)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const glowMat = (color) =>
  new THREE.MeshBasicMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

let haloGeo = null;
let washGeo = null;

/**
 * Flashing police beacons: a bright halo over each lightbar lamp (riding on the body, so they
 * tilt with it) and a red / blue light wash on the road around the car.
 */
export class SirenGlow {
  /**
   * @param {THREE.Object3D} root  the car's root (the wash stays flat on the ground)
   * @param {THREE.Object3D} body  the car body (halos follow its pitch / roll)
   * @param {{ red: number[], blue: number[] }} lamps  lamp positions in body space
   */
  constructor(root, body, lamps) {
    haloGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    washGeo ??= new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.red = glowMat(RED);
    this.blue = glowMat(BLUE);
    this.wash = glowMat(RED.clone());
    this.parts = [];
    const put = (geo, mat, parent, [x, y, z], size) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.setScalar(size);
      m.renderOrder = 5;
      m.layers.set(GLOW_LAYER);
      m.frustumCulled = false;
      m.visible = false;
      parent.add(m);
      this.parts.push(m);
      return m;
    };
    this.redHalo = put(haloGeo, this.red, body, [lamps.red[0], lamps.red[1] + 0.12, lamps.red[2]], 2.6);
    this.blueHalo = put(haloGeo, this.blue, body, [lamps.blue[0], lamps.blue[1] + 0.12, lamps.blue[2]], 2.6);
    this.washMesh = put(washGeo, this.wash, root, [0, 0.06, lamps.red[2]], 11);
    this.on = false;
  }

  /** `red` / `blue`: 0..1 brightness of each side this frame. */
  set(red, blue) {
    const on = red > 0 || blue > 0;
    if (on !== this.on) {
      this.on = on;
      for (const p of this.parts) p.visible = on;
    }
    if (!on) return;
    this.red.opacity = red;
    this.blue.opacity = blue;
    // The wash takes the colour of whichever side is lit.
    this.wash.color.copy(red >= blue ? RED : BLUE);
    this.wash.opacity = Math.max(red, blue) * 0.55;
    this.redHalo.scale.setScalar(2 + red * 1.2);
    this.blueHalo.scale.setScalar(2 + blue * 1.2);
  }
}
