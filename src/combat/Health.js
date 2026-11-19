/**
 * Hit points for anything that can be hurt. Deliberately tiny: damage, heal, dead or not.
 * Whoever owns it decides what dying means (a person falls over, a car could catch fire…).
 */
export class Health {
  constructor(max = 100) {
    this.max = max;
    this.hp = max;
    this.lastDamage = null; // { amount, source, time } of the most recent hit
  }

  get dead() {
    return this.hp <= 0;
  }

  /** 0..1 for HUD bars. */
  get fraction() {
    return Math.max(0, this.hp / this.max);
  }

  /** Back to full (optionally with a new maximum). */
  reset(max = this.max) {
    this.max = max;
    this.hp = max;
    this.lastDamage = null;
  }

  /**
   * Take `amount` damage. `source` is whatever caused it (a shooter, a car…), kept for blame.
   * Returns true if this hit was the one that killed.
   */
  damage(amount, source = null) {
    if (this.dead || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.lastDamage = { amount, source, time: performance.now() };
    return this.dead;
  }

  heal(amount) {
    if (this.dead) return;
    this.hp = Math.min(this.max, this.hp + amount);
  }
}
