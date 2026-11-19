import * as THREE from 'three';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/**
 * Two-pass "comic ink" renderer.
 *  1. Colour pass  — the normal scene, into an MSAA target.
 *  2. Normal pass  — the scene with view-space normals + a depth texture.
 *  3. Composite    — draws thick black lines wherever depth jumps (silhouettes) or the
 *                    surface normal turns sharply (creases), and gives colours a little punch.
 *  4. SMAA         — smooths the jagged ink lines (they come from non-MSAA buffers, and the
 *                    final full-screen quad gets no hardware antialiasing).
 */
export class InkRenderer {
  constructor(renderer, { thickness = 1.25, saturation = 1.18, contrast = 1.06, ink = 0x14110f, smaa = true } = {}) {
    this.renderer = renderer;
    this.smaa = smaa;
    this.thickness = thickness;
    this.colorTarget = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
    this.normalTarget = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.normalMaterial = new THREE.MeshNormalMaterial();
    // Composite lands here (already sRGB-encoded) so SMAA can smooth it on the way to the screen.
    this.inkTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorTarget.texture },
        tNormal: { value: this.normalTarget.texture },
        tDepth: { value: this.normalTarget.depthTexture },
        texel: { value: new THREE.Vector2() },
        near: { value: 1 },
        far: { value: 1000 },
        thickness: { value: thickness },
        saturation: { value: saturation },
        contrast: { value: contrast },
        inkColor: { value: new THREE.Color(ink) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tColor, tNormal, tDepth;
        uniform vec2 texel;
        uniform float near, far, thickness, saturation, contrast;
        uniform vec3 inkColor;
        varying vec2 vUv;

        float viewDepth(vec2 uv) {
          return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far);
        }
        vec3 normalAt(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }

        void main() {
          vec4 base = texture2D(tColor, vUv);
          vec3 col = base.rgb;

          // Comic colour grade: a bit more saturation and contrast.
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, saturation);
          col = (col - 0.5) * contrast + 0.5;

          float d = viewDepth(vUv);
          vec3 n = normalAt(vUv);
          float edge = 0.0;
          vec2 o = texel * thickness;
          vec2 offs[8];
          offs[0] = vec2( 1, 0); offs[1] = vec2(-1, 0); offs[2] = vec2(0,  1); offs[3] = vec2(0, -1);
          offs[4] = vec2( 1, 1); offs[5] = vec2(-1, 1); offs[6] = vec2(1, -1); offs[7] = vec2(-1, -1);
          for (int i = 0; i < 8; i++) {
            vec2 uv = vUv + offs[i] * o;
            float dn = viewDepth(uv);
            // Silhouettes: only ink the nearer side so lines hug the object, not the background.
            float jump = (dn - d) / d;
            edge = max(edge, smoothstep(0.012, 0.03, jump));
            // Creases: normals that disagree strongly.
            float nd = dot(n, normalAt(uv));
            edge = max(edge, smoothstep(0.75, 0.45, nd) * step(d, dn + d * 0.01));
          }
          col = mix(col, inkColor, edge);
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
          // Encode to sRGB by hand: SMAA expects display-space values, and the renderer's
          // automatic conversion only happens when drawing straight to the canvas.
          gl_FragColor = sRGBTransferOETF(gl_FragColor);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.smaaPass = new SMAAPass();
    this.smaaPass.renderToScreen = true;
  }

  setSize(width, height) {
    const pr = this.renderer.getPixelRatio();
    const w = Math.floor(width * pr), h = Math.floor(height * pr);
    this.colorTarget.setSize(w, h);
    this.normalTarget.setSize(w, h);
    this.inkTarget.setSize(w, h);
    this.smaaPass.setSize(w, h);
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
    // Lines stay a consistent on-screen weight regardless of resolution.
    this.material.uniforms.thickness.value = this.thickness * Math.max(1, h / 720);
  }

  render(scene, camera) {
    const r = this.renderer;
    const u = this.material.uniforms;
    u.near.value = camera.near;
    u.far.value = camera.far;

    r.setRenderTarget(this.colorTarget);
    r.render(scene, camera);

    // Normal pass: no background, no shadow-map re-render.
    const bg = scene.background;
    const autoShadow = r.shadowMap.autoUpdate;
    scene.background = null;
    scene.overrideMaterial = this.normalMaterial;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.normalTarget);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(scene, camera);
    scene.overrideMaterial = null;
    scene.background = bg;
    r.shadowMap.autoUpdate = autoShadow;

    if (this.smaa) {
      r.setRenderTarget(this.inkTarget);
      r.render(this.quadScene, this.quadCamera);
      r.setClearColor(0x000000, 0); // SMAA's edge pass discards non-edges, so it needs a black clear
      this.smaaPass.render(r, null, this.inkTarget);
    } else {
      // Without SMAA the composite goes straight to the (sRGB) canvas.
      r.setRenderTarget(null);
      r.render(this.quadScene, this.quadCamera);
    }
  }
}
