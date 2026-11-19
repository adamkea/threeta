import * as THREE from 'three';
import { Car } from '../vehicles/Car.js';
import { GLOW_LAYER } from '../effects/SirenGlow.js';
import { GRAPH } from '../traffic/RoadNetwork.js';
import { distancesTo } from '../police/PursuitDriver.js';
import { CITY } from '../world/City.js';

const PHONE_RANGE = 1.9; // how close to a ringing phone you need to be to answer it
const COOLDOWN = 6; // seconds after a job ends before the phones ring again
const VAN_RANGE = [90, 320]; // how far from the phone the van is left (m, straight line)
const DELIVER_SPEED = 1.2; // m/s: stopped, near enough, in the bay
const VAN_COLOR = 0xf4f4f0;

// Marker colours: phones that are ringing, the van to collect, the bay to deliver to.
const PHONE_GLOW = 0x5be37a;
const VAN_GLOW = 0x4fb3ff;
const DROP_GLOW = 0xffd23a;

const money = (n) => `$${n.toLocaleString('en-US')}`;
const round10 = (n) => Math.round(n / 10) * 10;

/**
 * Missions, and the pay phones they come from. While you're free, every pay phone rings (a
 * pulsing green ring on the pavement, and on the map); walk up and press F to answer.
 *
 * The first (and so far only) kind of job is a **delivery**: a van has been left somewhere
 * nearby, and it needs taking to one of the warehouses before the clock runs out. Get in the van,
 * drive it to the warehouse and stop in the drop-off bay (with no police on your tail). The pay
 * goes up with the distance and down with any damage to the van. Wreck the van, sink it, run
 * out of time, get busted or die, and the job's off.
 *
 * New kinds of mission plug in as another `#start…` that sets `this.mission` to an object with
 * the same shape (title, objective, target, timeLeft, and step/finish logic).
 */
export class MissionSystem {
  constructor({ scene, city, player, wanted, world, allCars, rng }) {
    this.scene = scene;
    this.player = player;
    this.wanted = wanted;
    this.world = world;
    this.allCars = allCars;
    this.rng = rng;
    this.phones = city.payPhones;
    this.warehouses = city.landmarks.filter((l) => l.kind === 'warehouse' && l.dropZone);
    this.parkingSpots = city.parkingSpots;
    this.mission = null;
    this.cooldown = 2;
    this.t = 0;
    this.onBanner = null; // (text, kind, seconds) => void
    this.routeCache = null; // { key, dist } road distances to the current target

    this.phoneMarkers = this.phones.map((p) => this.#phoneMarker(p));
    this.vanMarker = arrowMarker(VAN_GLOW, 1.8);
    this.dropMarkers = new Map(this.warehouses.map((w) => [w, this.#dropMarker(w)]));
    scene.add(this.vanMarker);

    const el = document.getElementById('mission');
    this.hud = {
      el,
      title: el.querySelector('.title'),
      objective: el.querySelector('.objective'),
      timer: el.querySelector('.timer'),
      arrow: document.getElementById('objective-arrow'),
    };
    this.shown = {};
  }

  /** True while the phones are ringing (no job on, cooldown over). */
  get available() {
    return !this.mission && this.cooldown <= 0;
  }

  /** The ringing phone the player is stood at (on foot), or null. */
  phoneNear() {
    const { player } = this;
    if (!this.available || player.inVehicle || player.ped.isDown) return null;
    const p = player.ped.position;
    return this.phones.find((ph) => Math.hypot(p.x - ph.stand.x, p.y - ph.stand.z) < PHONE_RANGE) ?? null;
  }

  /** HUD prompt for whatever the player could do here, or ''. */
  prompt() {
    const m = this.mission;
    if (m?.phase === 'deliver' && this.player.vehicle === m.van && this.#inBay(m)) {
      if (this.wanted.stars > 0) return 'Lose the cops before you drop it off';
      if (m.van.speed > DELIVER_SPEED) return 'Stop in the bay';
    }
    return this.phoneNear() ? 'F — answer the phone' : '';
  }

  /** F pressed. Returns true if it was meant for a phone (so it doesn't also go to the cars). */
  use() {
    const phone = this.phoneNear();
    if (!phone) return false;
    if (!this.#startDelivery(phone)) this.onBanner?.('NO JOBS', 'escaped', 2);
    return true;
  }

  /** Start a delivery from the nearest phone, wherever the player is (dev console). */
  startNearest() {
    if (this.mission) throw new Error('A job is already on — "mission cancel" first.');
    const b = this.player.body.position;
    const phone = this.phones.reduce((a, p) => (Math.hypot(p.x - b.x, p.z - b.y) < Math.hypot(a.x - b.x, a.z - b.y) ? p : a));
    if (!this.#startDelivery(phone)) throw new Error('Nowhere to leave a van near here.');
    return this.mission.objective;
  }

  /** Call the job off: busted, dead, or cancelled. `banner` false when something else already has one up. */
  fail(reason, banner = true) {
    const m = this.mission;
    if (!m) return;
    if (m.van) m.van.keep = false; // just another car now
    this.mission = null;
    this.cooldown = COOLDOWN;
    this.routeCache = null;
    this.result = { text: reason, bad: true, time: 4 };
    if (banner) this.onBanner?.('JOB FAILED', 'busted', 3);
  }

  // --- Delivery jobs ---

  #startDelivery(phone) {
    const spot = this.#vanSpot(phone);
    if (!spot || !this.warehouses.length) return false;
    const van = new Car({ model: 'van', color: VAN_COLOR });
    van.reset(spot.x, spot.z, spot.heading);
    van.syncMesh();
    van.keep = true; // never tidied away while the job's on
    this.scene.add(van.mesh);
    this.player.freeCars.push(van);

    // Deliver to the warehouse further away by road (a short hop isn't much of a job).
    const ranked = this.warehouses
      .map((w) => ({ w, d: this.#roadDistance(spot.x, spot.z, w.dropZone) }))
      .sort((a, b) => b.d - a.d);
    const { w: to, d: route } = this.rng.chance(0.75) ? ranked[0] : ranked[ranked.length - 1];
    this.mission = {
      kind: 'delivery',
      title: 'Delivery',
      phase: 'toVan',
      van,
      to,
      route,
      pay: round10(250 + route * 2.2),
      timeLimit: Math.round(25 + route / 10.5),
      timeLeft: null, // the clock starts once you're in the van
      objective: 'Find the van',
    };
    this.routeCache = null;
    this.result = null;
    this.onBanner?.('DELIVERY', 'escaped', 2);
    return true;
  }

  /** Somewhere to leave the van: a free bay in a car park, else the kerb of a quiet street. */
  #vanSpot(phone) {
    const [lo, hi] = VAN_RANGE;
    const cars = this.allCars();
    const free = (x, z, r) => !cars.some((c) => c.active && Math.hypot(c.position.x - x, c.position.y - z) < r);
    const near = (s) => {
      const d = Math.hypot(s.x - phone.x, s.z - phone.z);
      return d > lo && d < hi;
    };
    const bays = this.parkingSpots.filter((s) => near(s) && free(s.x, s.z, 4));
    if (bays.length) return this.rng.pick(bays);

    // Kerbside: the right-hand edge of a longish road, facing along it.
    const kerbs = [];
    for (const e of GRAPH.edges) {
      if (e.len < 40) continue;
      for (const sgn of [1, -1]) {
        const [A, dx, dz] = sgn > 0 ? [GRAPH.nodes[e.a], e.dx, e.dz] : [GRAPH.nodes[e.b], -e.dx, -e.dz];
        const off = e.hw - 1.4;
        const s = { x: A.x + dx * e.len * 0.5 - dz * off, z: A.z + dz * e.len * 0.5 + dx * off, heading: Math.atan2(dx, dz) };
        if (near(s) && free(s.x, s.z, 6)) kerbs.push(s);
      }
    }
    return kerbs.length ? this.rng.pick(kerbs) : null;
  }

  #roadDistance(x, z, target) {
    const dist = distancesTo(target.x, target.z);
    let best = Infinity;
    for (const n of GRAPH.nodes) best = Math.min(best, Math.hypot(n.x - x, n.z - z) + dist[n.id]);
    return Number.isFinite(best) ? best : Math.hypot(x - target.x, z - target.z) * 1.4;
  }

  /** Is the van parked in its warehouse's drop-off bay? */
  #inBay(m) {
    const z = m.to.dropZone;
    const dx = m.van.position.x - z.x, dz = m.van.position.y - z.z;
    const c = Math.cos(z.heading), s = Math.sin(z.heading);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(lx) < z.hw + 0.6 && Math.abs(lz) < z.hd + 0.6;
  }

  #stepDelivery(dt, m) {
    const { van } = m;
    if (van.wrecked) return this.fail('The van was wrecked.');
    if (van.overboard) return this.fail('The van went in the sea.');
    const driving = this.player.vehicle === van;
    if (driving && m.phase === 'toVan') {
      m.phase = 'deliver';
      m.timeLeft = m.timeLimit;
    }
    if (m.timeLeft !== null) {
      m.timeLeft -= dt;
      if (m.timeLeft <= 0) return this.fail('Out of time.');
    }
    if (m.phase === 'toVan') m.objective = 'Find the van';
    else if (!driving) m.objective = 'Get back in the van';
    else m.objective = `Take the van to ${m.to.name}`;

    if (m.phase === 'deliver' && driving && this.#inBay(m) && van.speed < DELIVER_SPEED && this.wanted.stars === 0) {
      this.#completeDelivery(m);
    }
  }

  #completeDelivery(m) {
    const { van } = m;
    const condition = van.damage.fraction;
    const docked = round10(m.pay * (1 - condition));
    const paid = Math.max(50, m.pay - docked);
    this.player.money += paid;
    this.player.forceExit(this.world);
    van.keep = false;
    this.mission = null;
    this.cooldown = COOLDOWN;
    this.routeCache = null;
    this.result = {
      text: docked > 0 ? `Paid ${money(paid)} (${money(docked)} off for damage)` : `Paid ${money(paid)} — not a scratch on it`,
      bad: false,
      time: 5,
    };
    this.onBanner?.(`DELIVERED  +${money(paid)}`, 'escaped', 3);
  }

  // --- Per frame ---

  /** Out on the street: run the job, animate the markers, and update the HUD. */
  update(dt, camera) {
    this.t += dt;
    if (!this.mission) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.mission?.kind === 'delivery') this.#stepDelivery(dt, this.mission);
    this.#updateMarkers();
    this.#updateHud(dt, camera);
  }

  /** Where the player should be heading right now, or null: { x, z, kind }. */
  get target() {
    const m = this.mission;
    if (!m) return null;
    if (m.phase === 'toVan' || this.player.vehicle !== m.van) return { x: m.van.position.x, z: m.van.position.y, kind: 'van' };
    return { x: m.to.dropZone.x, z: m.to.dropZone.z, kind: 'drop' };
  }

  /**
   * GPS route for the map: junctions along the shortest road route from the player to the
   * target, as [{ x, z }], starting at the player and ending at the target. Null with no job on.
   */
  route() {
    const t = this.target;
    if (!t) return null;
    const key = `${t.kind}:${Math.round(t.x / 8)}:${Math.round(t.z / 8)}`;
    if (this.routeCache?.key !== key) this.routeCache = { key, dist: distancesTo(t.x, t.z) };
    const { dist } = this.routeCache;
    const p = this.player.body.position;
    const pts = [{ x: p.x, z: p.y }];
    // Join the road at whichever end of the nearest road is quicker, then walk downhill.
    const near = GRAPH.nearestLane(p.x, p.y, 0, 0, -2, 60);
    const starts = near ? [GRAPH.from(near.h), GRAPH.to(near.h)] : GRAPH.nodes.map((n) => n.id);
    let node = starts.reduce((a, b) => {
      const da = Math.hypot(GRAPH.nodes[a].x - p.x, GRAPH.nodes[a].z - p.y) + dist[a];
      const db = Math.hypot(GRAPH.nodes[b].x - p.x, GRAPH.nodes[b].z - p.y) + dist[b];
      return db < da ? b : a;
    });
    // Nearly there: straight to it.
    if (Math.hypot(t.x - p.x, t.z - p.y) < 30) return pts.concat([{ x: t.x, z: t.z }]);
    for (let guard = 0; guard < 200; guard++) {
      pts.push({ x: GRAPH.nodes[node].x, z: GRAPH.nodes[node].z });
      let next = null;
      for (const h of GRAPH.nodes[node].out) {
        const m = GRAPH.to(h);
        if (dist[m] + 1e-6 < dist[node] && (next === null || dist[m] + GRAPH.edge(h).len < dist[next.m] + next.len)) next = { m, len: GRAPH.edge(h).len };
      }
      if (!next) break;
      node = next.m;
    }
    pts.push({ x: t.x, z: t.z });
    return pts;
  }

  #updateMarkers() {
    const ring = this.available;
    const pulse = (this.t * 1.4) % 1;
    for (const mk of this.phoneMarkers) {
      mk.visible = ring;
      if (!ring) continue;
      const { ring: r, wave, arrow } = mk.userData;
      wave.scale.setScalar(1 + pulse * 1.6);
      wave.material.opacity = 0.7 * (1 - pulse);
      r.material.opacity = 0.6 + 0.3 * Math.sin(this.t * 10);
      arrow.position.y = 3.4 + Math.sin(this.t * 3) * 0.3;
      arrow.rotation.y += 0.03;
    }

    const m = this.mission;
    const showVan = !!m && this.player.vehicle !== m.van;
    this.vanMarker.visible = showVan;
    if (showVan) {
      this.vanMarker.position.set(m.van.position.x, 5.2 + Math.sin(this.t * 3) * 0.35, m.van.position.y);
      this.vanMarker.rotation.y += 0.03;
    }
    for (const [w, mk] of this.dropMarkers) {
      mk.visible = !!m && m.phase === 'deliver' && m.to === w;
      if (!mk.visible) continue;
      mk.userData.fill.material.opacity = 0.22 + 0.12 * Math.sin(this.t * 4);
      mk.userData.arrow.position.y = 5.5 + Math.sin(this.t * 3) * 0.35;
      mk.userData.arrow.rotation.y += 0.03;
    }
  }

  #updateHud(dt, camera) {
    const m = this.mission;
    const { hud } = this;
    if (this.result) this.result.time -= dt;
    if (!m && this.result?.time <= 0) this.result = null;
    const title = m ? m.title : this.result ? (this.result.bad ? 'Job failed' : 'Job done') : '';
    const text = m ? m.objective : this.result?.text ?? '';
    const timer = m?.timeLeft != null ? Math.max(0, Math.ceil(m.timeLeft)) : null;
    const state = `${title}|${text}|${timer}|${!!this.result?.bad}`;
    if (state !== this.shown.state) {
      this.shown.state = state;
      hud.el.classList.toggle('open', !!title);
      hud.el.classList.toggle('bad', !m && !!this.result?.bad);
      hud.title.textContent = title;
      hud.objective.textContent = text;
      hud.timer.textContent = timer === null ? '' : `${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}`;
      hud.timer.classList.toggle('low', timer !== null && timer <= 15);
    }
    this.#updateArrow(camera);
  }

  /** Screen-edge arrow pointing at the objective while it's off screen. */
  #updateArrow(camera) {
    const { arrow } = this.hud;
    const t = this.target;
    if (!t || !camera) return void (arrow.style.display = 'none');
    const v = _v.set(t.x, CITY.curbHeight, t.z).project(camera);
    if (Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88 && v.z < 1) return void (arrow.style.display = 'none');
    const w = window.innerWidth, h = window.innerHeight;
    let dx = v.x * (w / 2), dy = -v.y * (h / 2);
    if (v.z > 1) (dx = -dx), (dy = -dy);
    const ang = Math.atan2(dy, dx);
    const k = Math.min((w / 2 - 48) / Math.abs(dx || 1e-6), (h / 2 - 48) / Math.abs(dy || 1e-6));
    arrow.style.display = 'block';
    arrow.className = t.kind;
    arrow.style.transform = `translate(${w / 2 + dx * k}px, ${h / 2 + dy * k}px) translate(-50%, -50%) rotate(${ang}rad)`;
  }

  // --- Markers ---

  #phoneMarker(p) {
    const g = new THREE.Group();
    const ring = flatRing(0.55, 0.85, PHONE_GLOW, 0.85);
    const wave = flatRing(0.8, 0.95, PHONE_GLOW, 0.6);
    const arrow = arrowMarker(PHONE_GLOW, 1);
    ring.position.y = wave.position.y = 0.03;
    g.add(ring, wave, arrow);
    g.userData = { ring, wave, arrow };
    g.position.set(p.stand.x, CITY.curbHeight, p.stand.z);
    g.traverse((o) => o.layers.set(GLOW_LAYER));
    this.scene.add(g);
    return g;
  }

  #dropMarker(w) {
    const z = w.dropZone;
    const g = new THREE.Group();
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(z.hw * 2, z.hd * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: DROP_GLOW, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    fill.position.y = 0.06;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(z.hw * 2, 0.01, z.hd * 2)),
      new THREE.LineBasicMaterial({ color: DROP_GLOW }),
    );
    edge.position.y = 0.08;
    const arrow = arrowMarker(DROP_GLOW, 2);
    g.add(fill, edge, arrow);
    g.userData = { fill, arrow };
    g.position.set(z.x, CITY.curbHeight, z.z);
    g.rotation.y = z.heading;
    g.visible = false;
    g.traverse((o) => o.layers.set(GLOW_LAYER));
    this.scene.add(g);
    return g;
  }
}

const _v = new THREE.Vector3();

function flatRing(r0, r1, color, opacity) {
  return new THREE.Mesh(
    new THREE.RingGeometry(r0, r1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

/** A bobbing, spinning downward-pointing arrow (an upside-down square pyramid). */
function arrowMarker(color, scale) {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color }));
  mesh.scale.setScalar(scale);
  mesh.layers.set(GLOW_LAYER);
  return mesh;
}
