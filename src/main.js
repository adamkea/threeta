import * as THREE from 'three';
import { Input } from './core/Input.js';
import { CameraRig } from './core/CameraRig.js';
import { createCity, roadCenter, groundHeight, CITY, offIsland } from './world/City.js';
import { Car } from './vehicles/Car.js';
import { MODELS, randomModel } from './vehicles/carModels.js';
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
import { VehicleDamageSystem } from './vehicles/VehicleDamageSystem.js';
import { DevConsole } from './ui/DevConsole.js';
import { PerfStats } from './ui/PerfStats.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false }); // AA is handled in InkRenderer (MSAA colour + SMAA)
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

// --- Vehicle damage: drivers bail out of burning cars, wrecks explode ---
const damage = new VehicleDamageSystem(scene, { peds: allPeds });
const byPlayer = (source) => source != null && (source === player.ped || source === player.vehicle);
/** Whoever is driving a (non-player) car gets out on the driver's side and runs. */
function bailOut(car) {
  const side = car.right.multiplyScalar(-(car.cfg.width / 2 + 0.8));
  const spot = car.position.clone().add(side);
  if (traffic.drivers.has(car)) {
    traffic.release(car);
    player.freeCars.push(car);
    npcs.spawnFleeing(spot.x, spot.y, car.position, car.position);
  } else if (police.owns(car)) {
    police.surrender(car, spot);
    player.freeCars.push(car);
  }
}
damage.onStateChange = (car, state) => {
  if (state.bail && car !== player.vehicle) bailOut(car);
  // Still at the wheel when it goes up: thrown out, right into the blast.
  if (state.destroyed && car === player.vehicle) player.forceExit(world);
};
damage.onDestroyed = (car, source) => {
  if (car.modelName === 'police' && byPlayer(source)) wanted.report('destroyPoliceCar');
};
damage.onBlastHit = (ped, killed, source) => {
  if (ped === player.ped || !byPlayer(source)) return;
  const cop = ped.role === 'cop';
  wanted.report(killed ? (cop ? 'killCop' : 'killPerson') : cop ? 'shootCop' : 'shootPerson');
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
let respawnAt = null; // where the player comes back once it ends: the police station or the hospital
const landmark = (kind) => city.landmarks.find((l) => l.kind === kind);
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
  damage.step(dt, active);
  ramCooldown = Math.max(0, ramCooldown - dt);
}

function showBanner(text, kind, time = 2.5) {
  bannerEl.textContent = text;
  bannerEl.className = kind;
  bannerTimer = time;
}

/**
 * Arrested or killed: lose the car and walk out of the police station (busted) or the hospital
 * (dead) with full health and a clean slate.
 */
function finishArrest() {
  const { x, z, heading } = respawnAt.respawn;
  player.forceExit(world);
  player.ped.revive();
  player.ped.reset(x, z, heading);
  wanted.clear();
  police.standDown();
  // Cut straight to the new spot, and bring the streets around it to life.
  rig.initialised = false;
  const focus = { x, z };
  traffic.repopulate(focus, allCars());
  npcs.repopulate(focus);
  parked.manage(focus, allCars(), disposeObject, 0);
}

function updateWanted(dt) {
  const hadStars = wanted.stars;
  if (bustedTimer === 0 && player.inVehicle && player.vehicle.submerged) {
    bustedTimer = 4; // went into the sea with the car
    respawnAt = landmark('hospital');
    showBanner('DROWNED', 'dead', 4);
  } else if (bustedTimer === 0 && !player.inVehicle && player.ped.dead) {
    bustedTimer = 4;
    respawnAt = landmark('hospital');
    showBanner(player.ped.overboard ? 'DROWNED' : 'FLATLINED', 'dead', 4);
  } else if (police.busted && bustedTimer === 0) {
    bustedTimer = 3;
    respawnAt = landmark('police');
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

// --- Dev console (` to toggle) ---
const devConsole = new DevConsole({ onOpen: () => input.releaseAll() });

/** Set the wanted level from the console, standing the police down when it hits zero. */
function setWanted(stars) {
  const had = wanted.stars;
  wanted.setStars(stars);
  if (had && !wanted.stars) police.standDown();
}

const wantedStatus = () =>
  `Wanted: ${wanted.stars} star${wanted.stars === 1 ? '' : 's'}${wanted.suppressed ? ' (wanted level disabled)' : ''}`;

devConsole.register('wanted', 'wanted [clear | up [n] | down [n] | 0-5 | off | on] — show / change the wanted level', ([sub, n]) => {
  const count = n === undefined ? 1 : Number(n);
  if (n !== undefined && !Number.isFinite(count)) throw new Error(`Not a number: "${n}"`);
  if (sub === 'off' || sub === 'on') {
    wanted.suppressed = sub === 'off';
    if (wanted.suppressed) setWanted(0);
    return wanted.suppressed ? 'Wanted level disabled — crimes are ignored.' : 'Wanted level enabled.';
  }
  if (sub !== undefined && sub !== 'clear' && wanted.suppressed) {
    throw new Error('Wanted level is disabled — run "wanted on" first.');
  }
  if (sub === undefined) return wantedStatus();
  if (sub === 'clear') setWanted(0);
  else if (sub === 'up') setWanted(wanted.stars + count);
  else if (sub === 'down') setWanted(wanted.stars - count);
  else if (/^[0-5]$/.test(sub)) setWanted(Number(sub));
  else throw new Error(`Unknown option "${sub}". Try: clear, up, down, 0-5, off, on.`);
  return wantedStatus();
});

/** A clear spot for a new car near the player: ahead first, then to the sides, then behind. */
function spawnSpot() {
  const from = player.inVehicle ? player.vehicle : player.ped;
  const h = from.heading;
  const fwd = new THREE.Vector2(Math.sin(h), Math.cos(h));
  const right = new THREE.Vector2(-fwd.y, fwd.x);
  const R = 2.6; // clearance around the new car's centre
  for (const dist of [6, 9, 12]) {
    for (const [f, r] of [[1, 0], [0, 1], [0, -1], [-1, 0]]) {
      const ahead = player.inVehicle && f === 1 ? dist + 4 : dist; // leave room in front of a moving car
      const x = from.position.x + (fwd.x * f + right.x * r) * ahead;
      const z = from.position.y + (fwd.y * f + right.y * r) * ahead;
      if (offIsland(x, z)) continue;
      if (world.query(x, z).some((b) => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R)) continue;
      if (allCars().some((c) => c.active && Math.hypot(c.position.x - x, c.position.y - z) < 5)) continue;
      return { x, z, heading: h };
    }
  }
  return null;
}

const modelList = () => Object.keys(MODELS).join(', ');
devConsole.register('spawn', 'spawn <model | random> — park a car next to you (no model lists them)', ([name]) => {
  if (!name) return `Models: ${modelList()}, random`;
  const model = name === 'random' ? randomModel(rng) : name;
  if (!MODELS[model]) throw new Error(`Unknown model "${name}". Models: ${modelList()}, random`);
  const spot = spawnSpot();
  if (!spot) throw new Error('No room to spawn a car here — move somewhere more open.');
  const car = new Car({ model });
  car.respray(rng);
  car.reset(spot.x, spot.z, spot.heading);
  car.syncMesh();
  scene.add(car.mesh);
  player.freeCars.push(car);
  return `Spawned a ${model}.`;
});

// Performance overlay: shown while the console is open, or pinned with `stats on`.
const perf = new PerfStats(renderer, () => {
  const cars = allCars();
  return {
    cars: `${cars.filter((c) => c.active).length} / ${cars.length}`,
    peds: allPeds().length,
    police: police.units.length,
  };
});
let perfPinned = false;
devConsole.register('stats', 'stats [on | off] — keep the performance overlay up with the console closed', ([sub]) => {
  if (sub !== 'on' && sub !== 'off') throw new Error('Usage: stats on | off');
  perfPinned = sub === 'on';
  return perfPinned ? 'Performance overlay pinned.' : 'Performance overlay shows only while the console is open.';
});

// Dev-only hook for debugging / automated tests.
if (import.meta.env.DEV) {
  window.__game = { parked, skids, player, traffic, npcs, lights, world, allCars, allPeds, step, input, wanted, police, combat, damage, rig, city, devConsole, STEP: 1 / 120 };
}

// --- Main loop: fixed-step physics, variable-rate rendering ---
const STEP = 1 / 120;
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  perf.setVisible(perfPinned || devConsole.isOpen);
  perf.beginFrame(dt);

  if (bustedTimer === 0) {
    if (input.wasPressed('reset')) resetPlayer();
    if (input.wasPressed('use')) player.use(allCars(), world);
    if (input.wasPressed('weapon') && !player.inVehicle) player.cycleWeapon();
    if (input.wasPressed('fire')) player.pullTrigger();
  }
  updateAim();
  if (input.wasPressed('map')) cityMap.toggle();

  acc += dt;
  perf.measure('sim', () => {
    while (acc >= STEP) {
      step(STEP);
      acc -= STEP;
      perf.addSteps(1);
    }
  });

  // --- Per-frame bookkeeping & visuals ---
  lights.update(dt);
  for (const c of allCars()) if (c.active) c.syncMesh();
  skids.update(dt, allCars());
  if (player.ped.active) {
    player.ped.groundY = groundHeight(player.ped.position.x, player.ped.position.y);
    player.ped.syncMesh(dt);
  }
  combat.update(dt);
  damage.update(dt, allCars(), rig.focus);
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

  perf.measureRender(() => ink.render(scene, camera));
  cityMap.render(dt, {
    player: player.body,
    inVehicle: player.inVehicle,
    cars: allCars().filter((c) => !isPoliceCar(c)),
    policeCars: allCars().filter(isPoliceCar),
    cops: npcs.peds.filter((p) => p.role === 'cop' && !p.isDown),
  });
  input.endFrame();
  perf.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
