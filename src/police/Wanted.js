/**
 * The player's wanted level. Crimes add heat; heat maps to 0–5 stars. While police can see the
 * player the level holds; once out of sight for long enough (longer at higher levels) the
 * police give up and it drops to zero.
 */

/** Heat needed for each star (index = stars). */
const THRESHOLDS = [0, 30, 160, 380, 750, 1250];

/** How much heat each crime is worth. */
export const CRIMES = {
  carjack: 35, // pulling someone out of their car in front of the police
  stealPoliceCar: 160,
  hitPerson: 60, // knocking someone down with a car
  hitCop: 220,
  ramPolice: 45,
};

export class Wanted {
  constructor() {
    this.clear();
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    this.seen = false; // any police unit has eyes on the player right now
    this.unseenTime = 0;
  }

  /** Seconds out of sight before the police give up, at the current level. */
  get evadeTime() {
    return 7 + this.stars * 2;
  }

  /** 0..1 progress toward losing the police (for the HUD). */
  get evadeProgress() {
    return this.stars ? Math.min(1, this.unseenTime / this.evadeTime) : 0;
  }

  report(crime) {
    const heat = CRIMES[crime] ?? 0;
    this.heat += heat;
    if (heat) this.unseenTime = 0; // a fresh crime tells them exactly where you are
    let stars = 0;
    while (stars < 5 && this.heat >= THRESHOLDS[stars + 1]) stars++;
    this.stars = Math.max(this.stars, stars);
  }

  /** `seen` = police can currently see the player. */
  update(dt, seen) {
    this.seen = seen;
    if (!this.stars) return;
    if (seen) {
      this.unseenTime = 0;
      // Being chased slowly makes things worse, up to three stars.
      if (this.stars < 3) this.heat = Math.min(THRESHOLDS[3] - 1, this.heat + dt * 3);
      this.report();
    } else {
      this.unseenTime += dt;
      if (this.unseenTime >= this.evadeTime) this.clear();
    }
  }
}
