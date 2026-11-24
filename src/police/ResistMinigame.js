/**
 * Resisting arrest: a red bar with a green zone and an arrow sweeping back and forth across it.
 * Stop the arrow (Space / click) inside the green to shake the officer off; miss, or run out of
 * time, and you're cuffed. Every attempt while you're wanted is harder than the last: a narrower
 * green zone and a faster arrow.
 */

const ZONE_WIDTH = 0.3; // first attempt: green zone as a fraction of the bar
const ZONE_SHRINK = 0.72; // ...times this for each attempt after
const ZONE_MIN = 0.06;
const SPEED = 0.85; // first attempt: bar lengths per second
const SPEED_GROWTH = 1.3; // ...times this for each attempt after
const SPEED_MAX = 3.6;
const TIME_LIMIT = 3.5; // seconds to stop the arrow before they get the cuffs on anyway
const VERDICT_TIME = 0.45; // the result stays on screen this long before it takes effect

export class ResistMinigame {
  /** `el` is the #resist HUD element (see index.html). */
  constructor(el, rng = Math.random) {
    this.el = el;
    this.rng = rng;
    this.zoneEl = el.querySelector('.zone');
    this.arrowEl = el.querySelector('.arrow');
    this.timerEl = el.querySelector('.timer');
    this.labelEl = el.querySelector('.label');
    this.active = false;
  }

  /** Begin an attempt; `attempt` = how many times you've already resisted this time you're wanted. */
  start(attempt) {
    this.attempt = attempt;
    this.width = Math.max(ZONE_MIN, ZONE_WIDTH * ZONE_SHRINK ** attempt);
    this.speed = Math.min(SPEED_MAX, SPEED * SPEED_GROWTH ** attempt);
    // Green zone somewhere in the middle-to-far part of the bar, so it's never a freebie at the start.
    const lo = 0.3 + this.width / 2;
    const hi = 0.97 - this.width / 2;
    this.zone = lo + this.rng() * Math.max(0, hi - lo);
    this.pos = 0;
    this.dir = 1;
    this.timeLeft = TIME_LIMIT;
    this.verdict = null; // 'win' | 'lose' once decided
    this.verdictTime = 0;
    this.active = true;
    this.labelEl.textContent = attempt ? `RESIST! ×${attempt + 1}` : 'RESIST!';
    this.el.className = 'on';
    this.#render();
  }

  /** Stop without a verdict (e.g. the officer was knocked flat by something else). */
  cancel() {
    this.active = false;
    this.el.className = '';
  }

  /**
   * Per-frame update. `pressed` = the resist key went down this frame. Returns 'win' or 'lose'
   * once the verdict has been shown, otherwise null.
   */
  update(dt, pressed) {
    if (!this.active) return null;
    if (this.verdict) {
      this.verdictTime -= dt;
      if (this.verdictTime > 0) return null;
      this.cancel();
      return this.verdict;
    }
    this.pos += this.dir * this.speed * dt;
    if (this.pos > 1) (this.pos = 2 - this.pos), (this.dir = -1);
    if (this.pos < 0) (this.pos = -this.pos), (this.dir = 1);
    this.timeLeft -= dt;
    if (pressed) this.#decide(Math.abs(this.pos - this.zone) <= this.width / 2 ? 'win' : 'lose');
    else if (this.timeLeft <= 0) this.#decide('lose');
    this.#render();
    return null;
  }

  #decide(verdict) {
    this.verdict = verdict;
    this.verdictTime = VERDICT_TIME;
    this.labelEl.textContent = verdict === 'win' ? 'BROKE FREE!' : 'CUFFED';
    this.el.className = `on ${verdict}`;
  }

  #render() {
    this.zoneEl.style.left = `${(this.zone - this.width / 2) * 100}%`;
    this.zoneEl.style.width = `${this.width * 100}%`;
    this.arrowEl.style.left = `${this.pos * 100}%`;
    this.timerEl.style.setProperty('--left', Math.max(0, this.timeLeft / TIME_LIMIT));
  }
}
