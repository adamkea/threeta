import * as THREE from 'three';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { createCity, roadCenter, groundHeight, CITY } from './world/City.js';
import { Car } from './vehicles/Car.js';
import { ColliderGrid } from './world/ColliderGrid.js';
import { TrafficLights } from './traffic/TrafficLights.js';
import { TrafficSystem } from './traffic/TrafficSystem.js';
import { resolveCarCollisions } from './physics/carCollisions.js';
import { resolvePedCarCollisions, resolvePedPedCollisions } from './physics/pedCollisions.js';
import { Pedestrian } from './characters/Pedestrian.js';
import { NpcManager, disposeObject } from './characters/NpcManager.js';
import { PlayerController } from './player/PlayerController.js';
import { createRng } from './core/random.js';
import { InkRenderer } from './render/InkRenderer.js';
import { SkidMarks } from './effects/SkidMarks.js';
import { Wanted } from './police/Wanted.js';
import { PoliceSystem } from './police/PoliceSystem.js';
import { CityMap } from './ui/CityMap.js';
import { weaponIcon } from './ui/weaponIcons.js';
import { CombatSystem } from './combat/CombatSystem.js';
import { ParkedCars } from './vehicles/ParkedCars.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // crisp, graphic shadows
const ink = new InkRenderer(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b6d6);
scene.fog = new THREE.Fog(0x87b6d6, 160, 360);

const camera = new THREE.PerspectiveCamera(30, 1, 5, 800);

// --- Lighting ---
// Bright, flat fill plus a strong sun: toon materials band the sun into hard steps.
scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x5a5468, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -90;
sc.right = sc.top = 90;
sc.near = 1;
sc.far = 300;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
sun.shadow.intensity = 0.75;
scene.add(sun, sun.target);
const sunOffset = new THREE.Vector3(-60, 110, 40);

// --- World ---
const city = createCity();
scene.add(city.group);
const world = new ColliderGrid(city.colliders);

const SPAWN = { x: roadCenter(Math.floor(CITY.blocks / 2)) + 3.5, z: roadCenter(CITY.blocks / 2) + 20 };
const playerCar = new Car({ model: 'golf', color: 0xa8aeb6 }); // silver hatchback
playerCar.reset(SPAWN.x, SPAWN.z, Math.PI);
scene.add(playerCar.mesh);

// --- Traffic & people ---
const rng = createRng(42);
const lights = new TrafficLights(rng);
scene.add(lights.mesh);
const traffic = new TrafficSystem(scene, rng, lights);
const npcs = new NpcManager(scene, rng);
const skids = new SkidMarks(scene, groundHeight);

// The player: brown leather jacket over a white tee, no hat, so they never blend into a crowd.
const playerPed = new Pedestrian({ shirt: 0x6b3f22, inner: 0xf5f5f5, pants: 0x23262e, hair: 0x1a120c, chain: true });
scene.add(playerPed.mesh);
const player = new PlayerController({ ped: playerPed, car: playerCar, traffic, npcs, scene });

// --- Police & wanted level ---
const wanted = new Wanted();
const police = new PoliceSystem(scene, rng, { traffic, npcs });
player.police = police;
const isPoliceCar = (c) => police.owns(c) || (c.modelName === 'police' && traffic.drivers.has(c));
player.onCarjack = (car) => {
  if (car.modelName === 'police') wanted.report('stealPoliceCar');
  else if (police.witnesses(car.position, world)) wanted.report('carjack');
};
// Running people over is always seen by someone — and hitting a cop is a big deal.
const onKnockdown = (p, car) => {
  if (car === player.vehicle) wanted.report(p.role === 'cop' ? 'hitCop' : 'hitPerson');
};
let ramCooldown = 0;
const onCarHit = (a, b, impulse) => {
  if (ramCooldown > 0 || impulse < 3 || !player.inVehicle) return;
  const other = a === player.vehicle ? b : b === player.vehicle ? a : null;
  if (other && isPoliceCar(other)) {
    wanted.report('ramPolice');
    ramCooldown = 1.5;
  }
};

const allCars = () => player.freeCars.concat(traffic.cars, police.cars);
const allPeds = () => (player.ped.active ? [player.ped] : []).concat(npcs.peds);

// --- Guns ---
const combat = new CombatSystem(scene, { world, peds: allPeds, cars: allCars, npcs });
player.combat = combat;
police.combat = combat;
const GUN_HEARING = 45; // police this close (with a clear line) notice gunfire
combat.onShot = ({ shooter, origin }) => {
  if (shooter === player.ped && police.witnesses(origin, world, GUN_HEARING)) wanted.report('gunfire');
};
combat.onHit = ({ shooter, target, kind, killed }) => {
  if (shooter !== player.ped) return;
  if (kind === 'ped') {
    const cop = target.role === 'cop';
    wanted.report(cop ? 'shootCop' : 'shootPerson');
    if (killed) wanted.report(cop ? 'killCop' : 'killPerson');
  } else if (kind === 'car' && isPoliceCar(target)) wanted.report('shootPoliceCar');
};
traffic.populate({ x: SPAWN.x, z: SPAWN.z }, allCars());
npcs.populate({ x: SPAWN.x, z: SPAWN.z });
const parked = new ParkedCars(scene, rng, city.parkingSpots, () => player.freeCars);
parked.populate({ x: SPAWN.x, z: SPAWN.z }, allCars(), disposeObject);
// Drivers only need to watch for people who are actually in the road.
const onRoad = (p) => !p.dead && groundHeight(p.position.x, p.position.y) === 0;

// --- Camera, input, HUD ---
const input = new Input();
const rig = new CameraRig(camera);
const ZOOM = { car: [85, 120], foot: [40, 46] };
const speedBox = document.getElementById('speed');
const speedEl = document.getElementById('speed-value');
const promptEl = document.getElementById('prompt');
const wantedEl = document.getElementById('wanted');
const starEls = [...wantedEl.querySelectorAll('i')];
const bannerEl = document.getElementById('banner');
const cityMap = new CityMap(city, document.getElementById('map'));
const healthEl = document.getElementById('health');
const hurtEl = document.getElementById('hurt');
const versionEl = document.getElementById('version');
versionEl.textContent = `v${__GAME_VERSION__}`;
if (__GAME_COMMIT__) versionEl.title = __GAME_COMMIT__;
const weaponEl = document.getElementById('weapon');
const weaponNameEl = weaponEl.querySelector('.name');
const weaponAmmoEl = weaponEl.querySelector('.ammo');
const weaponIconEl = weaponEl.querySelector('.icon');
let shownIconDef;
let lastHp = playerPed.health.hp;
let hurtFlash = 0;

// Mouse aim: the ground point under the cursor, at roughly gun height.
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.9);
const _ndc = new THREE.Vector2();
const _aimHit = new THREE.Vector3();
function updateAim() {
  _ndc.set((input.mouse.x / window.innerWidth) * 2 - 1, -(input.mouse.y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  if (raycaster.ray.intersectPlane(aimPlane, _aimHit)) player.aim.set(_aimHit.x, _aimHit.z);
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  ink.setSize(w, h);
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

// While being arrested (or dead) the player has no control.
const NO_INPUT = { throttle: 0, steer: 0, move: { x: 0, y: 0 }, isDown: () => false, wasPressed: () => false };
let bustedTimer = 0; // > 0 while the BUSTED / FLATLINED sequence plays
let bannerTimer = 0;
const policeCtx = { player, wanted, world };

/** One fixed physics step for everything. */
function step(dt) {
  const cars = allCars();
  const peds = allPeds();
  const active = cars.filter((c) => c.active && !c.overboard);
  player.step(dt, bustedTimer > 0 ? NO_INPUT : input, world);
  traffic.step(dt, cars, world, peds.filter(onRoad));
  police.step(dt, policeCtx);
  npcs.step(dt, world, peds, active, lights);
  resolveCarCollisions(active, 0.3, onCarHit);
  resolvePedCarCollisions(peds, active, onKnockdown);
  resolvePedPedCollisions(peds);
  ramCooldown = Math.max(0, ramCooldown - dt);
}

function showBanner(text, kind, time = 2.5) {
  bannerEl.textContent = text;
  bannerEl.className = kind;
  bannerTimer = time;
}

/** Arrested or killed: lose the car, start again back at the start with full health and a clean slate. */
function finishArrest() {
  player.forceExit(world);
  player.ped.revive();
  player.ped.reset(SPAWN.x - 9, SPAWN.z);
  wanted.clear();
  police.standDown();
}

function updateWanted(dt) {
  const hadStars = wanted.stars;
  if (bustedTimer === 0 && player.inVehicle && player.vehicle.submerged) {
    bustedTimer = 4; // went into the sea with the car
    showBanner('DROWNED', 'dead', 4);
  } else if (bustedTimer === 0 && !player.inVehicle && player.ped.dead) {
    bustedTimer = 4;
    showBanner(player.ped.overboard ? 'DROWNED' : 'FLATLINED', 'dead', 4);
  } else if (police.busted && bustedTimer === 0) {
    bustedTimer = 3;
    showBanner('BUSTED', 'busted', 3);
  }
  if (bustedTimer > 0) {
    bustedTimer -= dt;
    if (bustedTimer <= 0) (bustedTimer = 0), finishArrest();
  } else {
    wanted.update(dt, police.canSee(player.body.position, world));
    if (hadStars && !wanted.stars) {
      police.standDown();
      showBanner('LOST THE COPS', 'escaped');
    }
  }
  starEls.forEach((el, k) => el.classList.toggle('on', k < wanted.stars));
  wantedEl.classList.toggle('evading', wanted.stars > 0 && !wanted.seen);
  wantedEl.style.setProperty('--evade', wanted.evadeProgress);
  bannerTimer -= dt;
  if (bannerTimer <= 0) bannerEl.className = '';
}

function updateCombatHud(dt) {
  const hp = player.ped.health;
  healthEl.style.setProperty('--hp', hp.fraction);
  healthEl.classList.toggle('low', hp.fraction < 0.3);
  if (hp.hp < lastHp) hurtFlash = 1;
  lastHp = hp.hp;
  hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
  hurtEl.style.opacity = hurtFlash * 0.8;

  const w = player.weapon;
  weaponEl.style.visibility = player.inVehicle ? 'hidden' : 'visible';
  weaponEl.classList.toggle('holstered', !w);
  weaponEl.classList.toggle('reloading', w?.reloadProgress != null);
  weaponEl.style.setProperty('--reload', w?.reloadProgress ?? 0);
  weaponEl.classList.toggle('empty', !!w && w.mag === 0 && w.reserve === 0);
  weaponNameEl.textContent = w ? w.def.name : 'Unarmed';
  const iconDef = w?.def ?? null;
  if (iconDef !== shownIconDef) {
    weaponIconEl.innerHTML = weaponIcon(iconDef);
    shownIconDef = iconDef;
  }
  weaponAmmoEl.innerHTML = w ? `${w.mag}<small>/${w.reserve}</small>` : '<small>Q — draw</small>';
  canvas.style.cursor = player.armed && bustedTimer === 0 ? 'crosshair' : '';
}

// Dev-only hook for debugging / automated tests.
if (import.meta.env.DEV) {
  window.__game = { parked, skids, player, traffic, npcs, lights, world, allCars, allPeds, step, input, wanted, police, combat, STEP: 1 / 120 };
}

// --- Main loop: fixed-step physics, variable-rate rendering ---
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (bustedTimer === 0) {
    if (input.wasPressed('reset')) resetPlayer();
    if (input.wasPressed('use')) player.use(allCars(), world);
    if (input.wasPressed('weapon') && !player.inVehicle) player.cycleWeapon();
    if (input.wasPressed('fire')) player.pullTrigger();
  }
  updateAim();
  if (input.wasPressed('map')) cityMap.toggle();

  acc += dt;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
  }

  // --- Per-frame bookkeeping & visuals ---
  lights.update(dt);
  for (const c of allCars()) if (c.active) c.syncMesh();
  skids.update(dt, allCars());
  if (player.ped.active) {
    player.ped.groundY = groundHeight(player.ped.position.x, player.ped.position.y);
    player.ped.syncMesh(dt);
  }
  combat.update(dt);
  traffic.manage(rig.focus, allCars());
  updateWanted(dt);
  police.manage(policeCtx, allCars());
  npcs.manage(dt, rig.focus);
  parked.manage(rig.focus, allCars(), disposeObject);
  player.manage(rig.focus, disposeObject);

  rig.setZoom(...(player.inVehicle ? ZOOM.car : ZOOM.foot));
  rig.update(dt, player.body);
  sun.target.position.copy(rig.focus); // keep the shadow frustum on the action
  sun.position.copy(rig.focus).add(sunOffset);

  speedBox.style.visibility = player.inVehicle ? 'visible' : 'hidden';
  speedEl.textContent = Math.round(player.body.speed * 3.6);
  const canEnter = player.findEnterableCar(allCars());
  const occupied = traffic.drivers.has(canEnter) || police.owns(canEnter);
  promptEl.textContent = player.inVehicle || bustedTimer > 0 ? '' : canEnter ? (occupied ? 'F — hijack car' : 'F — get in') : '';
  updateCombatHud(dt);

  ink.render(scene, camera);
  cityMap.render(dt, {
    player: player.body,
    inVehicle: player.inVehicle,
    cars: allCars().filter((c) => !isPoliceCar(c)),
    policeCars: allCars().filter(isPoliceCar),
    cops: npcs.peds.filter((p) => p.role === 'cop' && !p.isDown),
  });
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
