// Dev page: a row of people in different outfits and poses, for judging the character models.
// Open /lineup/ with `npm run dev`. ?view=side|front|top, add &down to knock every other one over.
import * as THREE from 'three';
import { Pedestrian, WALK_SPEED, RUN_SPEED } from '../src/characters/Pedestrian.js';
import { civilianLook, copLook, gangLook, GANGS } from '../src/characters/outfits.js';
import { InkRenderer } from '../src/render/InkRenderer.js';
import { createRng } from '../src/core/random.js';
import { WEAPONS } from '../src/combat/weapons.js';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'side'; // side | top | front
const W = 1600, H = 900;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
const ink = new InkRenderer(renderer);
ink.setSize(W, H);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6d6);
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x5a5468, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.position.set(-60, 110, 40);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshToonMaterial({ color: 0x8d8f93 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const rng = createRng(7);
const looks = [
  { shirt: 0x6b3f22, inner: 0xf5f5f5, pants: 0x23262e, hair: 0x1a120c, chain: true },
  civilianLook(rng), copLook(rng), gangLook(rng, 'reds'), gangLook(rng, 'greens'), civilianLook(rng),
];
// pose: [speed, runBlend, gait, weapon]
const poses = [
  [0, 0, 0, false], [WALK_SPEED, 0, 0.4, false], [RUN_SPEED, 1, 1.6, false],
  [0, 0, 0, true], [WALK_SPEED, 0, 3.6, false], [RUN_SPEED, 1, 4.5, false],
];
looks.forEach((look, i) => {
  const p = new Pedestrian(look);
  const [sp, rb, g, gun] = poses[i];
  p.velocity.set(sp, 0);
  p.runBlend = rb;
  p.gait = g;
  if (gun) p.setWeapon(Object.values(WEAPONS)[0]);
  p.position.set((i - 2.5) * 2.6, 0);
  p.heading = view === 'front' ? 0 : Math.PI / 2;
  if (q.has('down') && i % 2 === 0) { p.downTime = 5; p.fall = 1; }
  p.syncMesh(0);
  p.mesh.rotation.y = view === 'front' ? 0 : view === 'top' ? 0.6 : Math.PI / 2;
  scene.add(p.mesh);
  p.mesh.traverse((o) => (o.castShadow = true));
});
const camera = new THREE.PerspectiveCamera(view === 'top' ? 30 : 30, W / H, 1, 400);
if (view === 'top') { camera.position.set(0, 85, 25); camera.lookAt(0, 0, 0); camera.fov = 5; }
else { camera.position.set(0, 1.8, 15.5); camera.lookAt(0, 1.5, 0); }
camera.updateProjectionMatrix();
ink.render(scene, camera);
window.done = true;
