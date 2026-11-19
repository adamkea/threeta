import * as THREE from 'three';
import { WEAPONS } from '../combat/weapons.js';
import { weaponIcon } from '../ui/weaponIcons.js';
import { createGunShopInterior } from './GunShopInterior.js';

const DOOR_RANGE = 1.4; // how close to a shop's door marker you need to be to go in
const FADE_OUT = 0.25; // seconds to black…
const FADE_IN = 0.35; // …and back

/** What the gun shop sells: each gun, then ammo for it once you own one. */
export const GUN_SHOP_STOCK = [
  { weapon: 'pistol', price: 300, ammo: { rounds: 36, price: 40 } },
  { weapon: 'shotgun', price: 1250, ammo: { rounds: 12, price: 90 } },
  { weapon: 'smg', price: 2000, ammo: { rounds: 90, price: 150 } },
];

/** Which interior each kind of enterable landmark leads into. */
const INTERIORS = { gunshop: createGunShopInterior };

/**
 * Buildings you can walk into. Outside, each has a glowing marker at its door; step on it and
 * press F to go in. Inside, the game draws the interior's own scene instead of the city (so the
 * street simply isn't there until you walk back out through the door) and the street outside is
 * frozen while you shop. Owns the cut to black either way, and the counter menu.
 */
export class Shops {
  constructor({ city, player, outside, canEnter = () => true }) {
    this.player = player;
    this.outside = outside; // the city's scene, where the player's body goes back to
    this.canEnter = canEnter;
    this.entrances = city.landmarks
      .filter((l) => l.entrance && INTERIORS[l.kind])
      .map((l) => ({ ...l.entrance, kind: l.kind, name: l.name, marker: l.group.getObjectByName('doorMarker') }));
    this.inside = null; // { entrance, interior } while in a shop
    this.interiors = new Map(); // built on first visit, then kept
    this.transition = null; // { t, swap, swapped } while cutting to / from black
    this.onEnter = null;
    this.onExit = null; // (entrance) => void, once the player is back on the street
    this.t = 0;
    this.camTarget = { position: new THREE.Vector2(), velocity: new THREE.Vector2(), speed: 0 };
    this.menu = new ShopMenu(document.getElementById('shop'), (i) => this.#buy(i), () => this.menu.close());
    this.fadeEl = document.getElementById('fade');
  }

  /** The player shouldn't be moving: mid-cut, or stood at the counter browsing. */
  get busy() {
    return this.transition !== null || this.menu.isOpen;
  }

  /** The scene to draw: the shop's interior while inside, else null (draw the city). */
  get scene() {
    return this.inside?.interior.scene ?? null;
  }

  /** Shop door the player is stood at (on foot), or null. */
  doorNear() {
    const { player } = this;
    if (this.inside || player.inVehicle || player.ped.isDown) return null;
    const p = player.ped.position;
    return this.entrances.find((e) => Math.hypot(p.x - e.x, p.y - e.z) < DOOR_RANGE) ?? null;
  }

  /** HUD prompt for whatever the player could do here, or ''. */
  prompt() {
    if (this.busy) return '';
    if (this.inside) return this.inside.interior.atCounter(this.player.ped.position) ? 'F — buy guns & ammo' : '';
    const door = this.doorNear();
    if (!door) return '';
    return this.canEnter() ? `F — enter ${door.name}` : `${door.name} — lose the cops first`;
  }

  /** F pressed. Returns true if it was meant for a shop (so it doesn't also go to the cars). */
  use() {
    if (this.busy) return true;
    if (this.inside) {
      if (this.inside.interior.atCounter(this.player.ped.position)) this.#openMenu();
      return true; // no cars in here
    }
    const door = this.doorNear();
    if (!door) return false;
    if (this.canEnter()) this.#cut(() => this.#enter(door));
    return true;
  }

  /** Fixed step while inside: just the player walking round the shop. */
  step(dt, input) {
    const { ped } = this.player;
    const { interior } = this.inside;
    ped.update(dt, input.move, input.isDown('sprint'), interior.world);
    if (!this.transition && interior.leaving(ped.position)) this.#cut(() => this.#exit());
  }

  /** Per frame: door markers, the cut to black, the counter menu, the clerk. */
  update(dt, input) {
    this.t += dt;
    for (const e of this.entrances) {
      const arrow = e.marker?.userData.arrow;
      if (arrow) {
        arrow.position.y = 2.4 + Math.sin(this.t * 3) * 0.25;
        arrow.rotation.y += dt * 1.5;
      }
    }

    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      if (!tr.swapped && tr.t >= FADE_OUT) (tr.swapped = true), tr.swap();
      const k = tr.t < FADE_OUT ? tr.t / FADE_OUT : 1 - (tr.t - FADE_OUT) / FADE_IN;
      this.fadeEl.style.opacity = Math.max(0, Math.min(1, k));
      if (tr.t >= FADE_OUT + FADE_IN) this.transition = null;
    }

    if (this.menu.isOpen) {
      if (input.wasPressed('up')) this.menu.move(-1);
      if (input.wasPressed('down')) this.menu.move(1);
      if (input.wasPressed('use')) this.menu.choose();
      if (input.wasPressed('back') || input.wasPressed('weapon')) this.menu.close();
    }

    if (this.inside) {
      const { interior } = this.inside;
      const p = this.player.ped.position;
      interior.update(dt, p);
      // Camera: mostly on the middle of the room, drifting a little towards the player.
      this.camTarget.position.copy(interior.centre).lerp(p, 0.35);
    }
  }

  /** Close the menu and walk straight out (e.g. busted / dev reset). */
  forceExit() {
    this.menu.close();
    if (this.inside) this.#exit();
  }

  #cut(swap) {
    this.transition = { t: 0, swap, swapped: false };
  }

  #enter(entrance) {
    const { player } = this;
    let interior = this.interiors.get(entrance);
    if (!interior) this.interiors.set(entrance, (interior = INTERIORS[entrance.kind]()));
    // Guns away: no shooting in the shop.
    player.equipped = -1;
    player.ped.setWeapon(null);
    const { x, z, heading } = interior.spawn;
    player.ped.reset(x, z, heading);
    player.ped.groundY = 0;
    interior.scene.add(player.ped.mesh); // moves the body out of the city's scene
    this.inside = { entrance, interior };
    this.onEnter?.(entrance);
  }

  #exit() {
    const { entrance } = this.inside;
    this.menu.close();
    this.outside.add(this.player.ped.mesh);
    // A step out from the door (off the marker, so you're not offered straight back in).
    this.player.ped.reset(entrance.x + Math.sin(entrance.heading) * 1.6, entrance.z + Math.cos(entrance.heading) * 1.6, entrance.heading);
    this.inside = null;
    this.onExit?.(entrance);
  }

  // --- The counter ---

  /** One row per gun in stock: buy it, or (once you have it) buy ammo for it. */
  #rows() {
    const { player } = this;
    return GUN_SHOP_STOCK.map((item) => {
      const def = WEAPONS[item.weapon];
      const have = player.weapons.find((w) => w.def === def);
      if (!have) {
        const kind = def.pellets > 1 ? `${def.pellets} pellets a shot` : def.auto ? 'full auto' : 'semi-auto';
        return { def, name: def.name, detail: `${kind} · ${def.magSize}-round mag · ${def.reserve} rounds`, price: item.price,
          buy: () => player.giveWeapon(def), done: `Bought a ${def.name.toLowerCase()} — Q to draw it outside` };
      }
      const { rounds, price } = item.ammo;
      return { def, name: `${def.name} ammo`, detail: `+${rounds} rounds · carrying ${have.mag + have.reserve}`, price,
        buy: () => have.addAmmo(rounds), done: `+${rounds} ${def.name.toLowerCase()} rounds` };
    });
  }

  #openMenu() {
    this.menu.open(this.#rows(), this.player.money);
  }

  #buy(i) {
    const row = this.menu.rows[i];
    if (!row) return;
    if (this.player.money < row.price) return this.menu.show(this.#rows(), this.player.money, "Can't afford that", true);
    this.player.money -= row.price;
    row.buy();
    this.menu.show(this.#rows(), this.player.money, row.done);
  }
}

const money = (n) => `$${n.toLocaleString('en-US')}`;

/** The counter menu: a list of items with prices; keyboard (via Shops.update) or mouse. */
class ShopMenu {
  constructor(el, onBuy, onClose) {
    this.el = el;
    this.list = el.querySelector('.items');
    this.cashEl = el.querySelector('.cash');
    this.msgEl = el.querySelector('.msg');
    this.rows = [];
    this.sel = 0;
    this.onBuy = onBuy;
    this.onClose = onClose;
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      this.sel = Number(li.dataset.i);
      this.choose();
    });
    this.list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('li');
      if (li && Number(li.dataset.i) !== this.sel) (this.sel = Number(li.dataset.i)), this.#highlight();
    });
    // Clicks on the menu are for the menu, not the gun.
    el.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  get isOpen() {
    return this.el.classList.contains('open');
  }

  open(rows, cash) {
    this.sel = 0;
    this.el.classList.add('open');
    this.show(rows, cash, '');
  }

  close() {
    this.el.classList.remove('open');
  }

  move(d) {
    const n = this.rows.length + 1; // + "Done"
    this.sel = (this.sel + d + n) % n;
    this.#highlight();
  }

  choose() {
    if (this.sel === this.rows.length) this.onClose();
    else this.onBuy(this.sel);
  }

  show(rows, cash, msg, bad = false) {
    this.rows = rows;
    this.cash = cash;
    this.list.innerHTML = '';
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      li.dataset.i = i;
      li.classList.toggle('cant', cash < r.price);
      li.innerHTML = `<span class="icon">${weaponIcon(r.def)}</span><span><div class="name"></div><div class="detail"></div></span><span class="price">${money(r.price)}</span>`;
      li.querySelector('.name').textContent = r.name;
      li.querySelector('.detail').textContent = r.detail;
      this.list.appendChild(li);
    });
    const done = document.createElement('li');
    done.dataset.i = rows.length;
    done.innerHTML = '<span></span><span class="name">Done</span><span></span>';
    this.list.appendChild(done);
    this.cashEl.textContent = money(cash);
    this.msgEl.textContent = msg;
    this.msgEl.classList.toggle('bad', bad);
    this.#highlight();
  }

  #highlight() {
    [...this.list.children].forEach((li, i) => li.classList.toggle('sel', i === this.sel));
  }
}
