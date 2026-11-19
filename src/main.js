import * as THREE from 'three';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { createCity, roadCenter, groundHeight, CITY } from './world/City.js';
import { Car } from './vehicles/Car.js';
import { ColliderGrid } from './world/ColliderGrid.js';
import { TrafficLights } from './traffic/TrafficLights.js';
import { TrafficSystem } from './traffic/TrafficSystem.js';
import { resolveCarCollisions } from './physics/carCollisions.js';
import { resolvePedCarCollisions } from './physics/pedCollisions.js';
import { Pedestrian } from './characters/Pedestrian.js';
import { NpcManager, disposeObject } from './characters/NpcManager.js';
import { PlayerController } from './player/PlayerController.js';
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

const SPAWN = { x: roadCenter(Math.floor(CITY.blocks / 2)) + 3.5, z: roadCenter(CITY.blocks / 2) + 20 };
const playerCar = new Car({ color: 0xd23b2f });
playerCar.reset(SPAWN.x, SPAWN.z, Math.PI);
scene.add(playerCar.mesh);

// --- Traffic & people ---
const rng = createRng(42);
const lights = new TrafficLights(rng);
scene.add(lights.mesh);
const traffic = new TrafficSystem(scene, rng, lights);
const npcs = new NpcManager(scene, rng);

const playerPed = new Pedestrian({ shirt: 0xf5f5f5, pants: 0x23262e });
scene.add(playerPed.mesh);
const player = new PlayerController({ ped: playerPed, car: playerCar, traffic, npcs, scene });

const allCars = () => player.freeCars.concat(traffic.cars);
const allPeds = () => (player.ped.active ? [player.ped] : []).concat(npcs.peds);
traffic.populate({ x: SPAWN.x, z: SPAWN.z }, allCars());

// --- Camera, input, HUD ---
const input = new Input();
const rig = new CameraRig(camera);
const ZOOM = { car: [85, 120], foot: [40, 46] };
const speedBox = document.getElementById('speed');
const speedEl = document.getElementById('speed-value');
const promptEl = document.getElementById('prompt');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function resetPlayer() {
  if (player.inVehicle) {
    const c = player.vehicle;
    c.reset(c.position.x, c.position.y, c.heading); // stop and un-spin in place
  } else {
    player.ped.reset(SPAWN.x - 9, SPAWN.z);
  }
}

/** One fixed physics step for everything. */
function step(dt) {
  const cars = allCars();
  const peds = allPeds();
  player.step(dt, input, world);
  traffic.step(dt, cars, world, peds);
  npcs.step(dt, world);
  const active = cars.filter((c) => c.active);
  resolveCarCollisions(active);
  resolvePedCarCollisions(peds, active);
}

// Dev-only hook for debugging / automated tests.
if (import.meta.env.DEV) {
  window.__game = { player, traffic, npcs, lights, world, allCars, allPeds, step, input, STEP: 1 / 120 };
}

// --- Main loop: fixed-step physics, variable-rate rendering ---
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.wasPressed('reset')) resetPlayer();
  if (input.wasPressed('use')) player.use(allCars(), world);

  acc += dt;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
  }

  // --- Per-frame bookkeeping & visuals ---
  lights.update(dt);
  for (const c of allCars()) if (c.active) c.syncMesh();
  if (player.ped.active) {
    player.ped.groundY = groundHeight(player.ped.position.x, player.ped.position.y);
    player.ped.syncMesh(dt);
  }
  traffic.manage(rig.focus, allCars());
  npcs.manage(dt, rig.focus);
  player.manage(rig.focus, disposeObject);

  rig.setZoom(...(player.inVehicle ? ZOOM.car : ZOOM.foot));
  rig.update(dt, player.body);
  sun.target.position.copy(rig.focus); // keep the shadow frustum on the action
  sun.position.copy(rig.focus).add(sunOffset);

  speedBox.style.visibility = player.inVehicle ? 'visible' : 'hidden';
  speedEl.textContent = Math.round(player.body.speed * 3.6);
  const canEnter = player.findEnterableCar(allCars());
  promptEl.textContent = player.inVehicle ? '' : canEnter ? (traffic.drivers.has(canEnter) ? 'F — hijack car' : 'F — get in') : '';

  renderer.render(scene, camera);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
