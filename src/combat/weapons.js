/**
 * Weapon definitions. Every gun is just data: adding a new one (SMG, shotgun…) means adding an
 * entry here; `Weapon` handles ammo/reload/fire-rate and `CombatSystem` resolves the shots.
 *
 *  damage      hit points per bullet
 *  fireRate    shots per second (max)
 *  auto        keep firing while the trigger is held
 *  magSize     rounds per magazine
 *  reserve     spare rounds carried when picked up
 *  reloadTime  seconds
 *  range       metres a bullet travels before it's spent
 *  spread      max random deviation (radians) from the aim line
 *  pellets     bullets per shot (shotguns)
 *  knockback   m/s shove given to a person who's hit
 *  noise       metres within which people hear the shot (and panic)
 */
export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'Pistol',
    damage: 34,
    fireRate: 4,
    auto: false,
    magSize: 12,
    reserve: 60,
    reloadTime: 1.2,
    range: 48,
    spread: 0.035,
    pellets: 1,
    knockback: 2.5,
    noise: 32,
  },
};

/** A gun someone is carrying: ammo state, cooldown and reload timer. */
export class Weapon {
  constructor(def, { reserve = def.reserve } = {}) {
    this.def = def;
    this.mag = def.magSize;
    this.reserve = reserve;
    this.cooldown = 0;
    this.reloading = 0; // seconds left on a reload, 0 when not reloading
  }

  get canFire() {
    return this.cooldown <= 0 && this.reloading <= 0 && this.mag > 0;
  }

  /** 0..1 reload progress (for the HUD), or null when not reloading. */
  get reloadProgress() {
    return this.reloading > 0 ? 1 - this.reloading / this.def.reloadTime : null;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const take = Math.min(this.def.magSize - this.mag, this.reserve);
        this.mag += take;
        this.reserve -= take;
      }
    }
  }

  /** Spend a round if we can. Auto-reloads on an empty mag. Returns true if a shot goes off. */
  tryFire() {
    if (!this.canFire) {
      if (this.mag === 0) this.reload();
      return false;
    }
    this.mag--;
    this.cooldown = 1 / this.def.fireRate;
    if (this.mag === 0) this.reload();
    return true;
  }

  reload() {
    if (this.reloading > 0 || this.mag === this.def.magSize || this.reserve === 0) return false;
    this.reloading = this.def.reloadTime;
    return true;
  }

  addAmmo(rounds) {
    this.reserve += rounds;
  }
}
