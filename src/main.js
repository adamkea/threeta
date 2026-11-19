import * as THREE from 'three';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { createCity, roadCenter, CITY } from './world/City.js';
import { Car } from './vehicles/Car.js';
import { ColliderGrid } from './world/ColliderGrid.js';
import { TrafficLights } from './traffic/TrafficLights.js';
import { TrafficSystem } from './traffic/TrafficSystem.js';
import { resolveCarCollisions } from './physics/carCollisions.js';
import { createRng } from './core/random.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6d6);
scene.fog = new THREE.Fog(0x87b6d6, 160, 360);

const camera = new THREE.PerspectiveCamera(30, 1, 5, 800);

// --- Lighting ---
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4438, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -90;
sc.right = sc.top = 90;
sc.near = 1;
sc.far = 300;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const sunOffset = new THREE.Vector3(-60, 110, 40);

// --- World ---
const city = createCity();
scene.add(city.group);
const world = new ColliderGrid(city.colliders);

const car = new Car({ color: 0xd23b2f });
const spawn = () => car.reset(roadCenter(Math.floor(CITY.blocks / 2)) + 3.5, roadCenter(CITY.blocks / 2) + 20, Math.PI);
spawn();
scene.add(car.mesh);

// --- Traffic ---
const rng = createRng(42);
const lights = new TrafficLights(rng);
scene.add(lights.mesh);
const traffic = new TrafficSystem(scene, rng, lights);
const allCars = [car, ...traffic.cars];
traffic.populate({ x: car.position.x, z: car.position.y }, allCars);

const input = new Input();
const rig = new CameraRig(camera);
const speedEl = document.getElementById('speed-value');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Dev-only hook for debugging / automated tests.
if (import.meta.env.DEV) {
  window.__game = { car, traffic, lights, world, allCars, STEP: 1 / 120, resolveCarCollisions };
}

// --- Main loop: fixed-step physics, variable-rate rendering ---
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.wasPressed('reset')) spawn();

  const controls = { throttle: input.throttle, steer: input.steer, handbrake: input.isDown('handbrake') };
  acc += dt;
  while (acc >= STEP) {
    car.update(STEP, controls, world);
    traffic.step(STEP, allCars, world);
    resolveCarCollisions(allCars.filter((c) => c.active));
    acc -= STEP;
  }
  lights.update(dt);
  car.syncMesh();
  for (const c of traffic.cars) if (c.active) c.syncMesh();
  traffic.manage(rig.focus, allCars);
  rig.update(dt, car);

  // Keep the shadow frustum centred on the action.
  sun.target.position.copy(rig.focus);
  sun.position.copy(rig.focus).add(sunOffset);

  speedEl.textContent = Math.round(car.speed * 3.6);

  renderer.render(scene, camera);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
