import * as THREE from 'three';
import { Pedestrian } from './Pedestrian.js';
import { groundHeight } from '../world/City.js';

const STAND = { x: 0, y: 0 };
const SHIRTS = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xecf0f1, 0x34495e, 0xe67e22];

/** Non-player pedestrians. For now: drivers who flee after being pulled out of their car. */
export class NpcManager {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.npcs = [];
  }

  get peds() {
    return this.npcs.map((n) => n.ped);
  }

  /** Spawn a panicked ex-driver at (x, z) who runs away from `threat` and from the car they left. */
  spawnFleeing(x, z, threat, car) {
    const ped = new Pedestrian({ shirt: this.rng.pick(SHIRTS), pants: this.rng.pick([0x2b2f3a, 0x4a3b2a, 0x1f3550]) });
    ped.reset(x, z);
    this.scene.add(ped.mesh);
    const fromThreat = new THREE.Vector2(x - threat.x, z - threat.y);
    const fromCar = new THREE.Vector2(x - car.x, z - car.y).normalize();
    const away = fromThreat.lengthSq() > 0.25 ? fromThreat.normalize().add(fromCar).normalize() : fromCar;
    // Veer a little so they don't all run in perfectly straight lines.
    away.rotateAround(new THREE.Vector2(), this.rng.range(-0.5, 0.5));
    this.npcs.push({ ped, dir: away, time: 0 });
  }

  step(dt, world) {
    for (const n of this.npcs) {
      n.time += dt;
      const running = n.time < 5;
      n.ped.update(dt, n.time < 25 ? n.dir : STAND, running, world);
      // Ran into a wall? Pick a new direction along it.
      if (!n.ped.isDown && n.ped.speed < 0.5 && n.time > 0.5) n.dir.rotateAround(new THREE.Vector2(), Math.PI / 2);
    }
  }

  /** Per-frame: animate and remove NPCs far from the camera focus. */
  manage(dt, focus) {
    this.npcs = this.npcs.filter((n) => {
      const far = Math.hypot(n.ped.position.x - focus.x, n.ped.position.y - focus.z) > 110;
      if (far || n.time > 60) {
        this.scene.remove(n.ped.mesh);
        disposeObject(n.ped.mesh);
        return false;
      }
      n.ped.groundY = groundHeight(n.ped.position.x, n.ped.position.y);
      n.ped.syncMesh(dt);
      return true;
    });
  }
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) [].concat(o.material).forEach((m) => m.dispose());
  });
}
