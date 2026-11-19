// On-screen controls for phones and tablets. Drives the same `Input` as the keyboard and mouse:
// buttons hold virtual key codes ('Touch…', bound in Input.js) and the two thumbsticks feed
// `input.stick` (move / drive) and `input.aimStick` (aim + fire). Shown once the device has a
// touch screen as its main pointer, or as soon as anyone touches the screen.

const STICK_RADIUS = 56; // px the thumb travels from the stick's centre to full deflection
const SPRINT_AT = 0.92; // on foot, pushing the move stick this far runs
const FIRE_AT = 0.45; // pushing the aim stick this far pulls the trigger

const BUTTONS = [
  // id, label, virtual code, which situations show it (see #update's classes)
  ['use', 'Get in', 'TouchUse', 'b-use'],
  ['brake', 'Brake', 'TouchHandbrake', 'b-car'],
  ['weapon', 'Gun', 'TouchWeapon', 'b-foot'],
  ['reload', 'Reload', 'TouchReload', 'b-armed'],
  ['reset', 'Reset', 'TouchReset', 'b-street'],
  ['map', 'Map', 'TouchMap', 'b-map'],
];

export class TouchControls {
  constructor(input, hud) {
    this.input = input;
    this.enabled = false;
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="zone left"></div>
      <div class="zone right"></div>
      <div class="stick move"><div class="knob"></div></div>
      <div class="stick aim"><div class="knob"></div></div>
      <div class="buttons"></div>
      <button class="tbtn fullscreen" aria-label="Full screen">⛶</button>`;
    hud.prepend(this.root); // under the shop menu and map, so those still get taps
    // Push the move stick hard to run; push the aim stick past halfway to shoot.
    const threshold = (code, at) => (len) => (len >= at ? input.pressVirtual(code) : input.releaseVirtual(code));
    this.moveStick = this.#stick(this.root.querySelector('.zone.left'), this.root.querySelector('.stick.move'), input.stick, threshold('TouchSprint', SPRINT_AT));
    this.aimStick = this.#stick(this.root.querySelector('.zone.right'), this.root.querySelector('.stick.aim'), input.aimStick, threshold('TouchFire', FIRE_AT));

    const box = this.root.querySelector('.buttons');
    this.buttons = {};
    for (const [id, label, code, cls] of BUTTONS) {
      const b = document.createElement('button');
      b.className = `tbtn ${id} ${cls}`;
      b.textContent = label;
      this.#hold(b, code);
      box.appendChild(b);
      this.buttons[id] = b;
    }

    const fs = this.root.querySelector('.fullscreen');
    const canFullscreen = document.documentElement.requestFullscreen && document.fullscreenEnabled;
    if (!canFullscreen) fs.remove();
    fs.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    });

    // A touch that lands on no control mustn't turn into an emulated mouse click (= a gunshot).
    this.root.addEventListener('touchstart', (e) => e.target === this.root && e.preventDefault());

    if (window.matchMedia?.('(pointer: coarse)').matches) this.enable();
    window.addEventListener('touchstart', () => this.enable(), { capture: true, passive: true });
    // On a laptop with a touch screen, going back to the mouse brings back mouse aiming.
    window.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && this.disable());
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.input.touch = false;
    document.body.classList.remove('touch');
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.input.touch = true;
    document.body.classList.add('touch');
  }

  /**
   * Per frame: show the buttons that make sense right now and label the action button.
   * `state` = { inVehicle, armed, onFoot, inShop, menuOpen, mapOpen, action } where `action`
   * is what the use button would do ('' for nothing in reach).
   */
  update(state) {
    if (!this.enabled) return;
    const c = this.root.classList;
    c.toggle('in-car', state.inVehicle);
    c.toggle('on-foot', state.onFoot);
    c.toggle('armed', state.armed);
    c.toggle('in-shop', state.inShop);
    c.toggle('menu', state.menuOpen || state.mapOpen);
    c.toggle('has-action', !!state.action);
    const label = state.action || 'Use';
    if (this.buttons.use.textContent !== label) this.buttons.use.textContent = label;
    // The aim stick only means something with a gun out; drop it the moment that stops.
    if (!state.armed && this.aimStick.active) this.aimStick.cancel();
  }

  /** A button that holds `code` down while a finger is on it. */
  #hold(el, code) {
    const fingers = new Set();
    const down = (e) => {
      e.preventDefault(); // no emulated mouse click (which would also fire the gun)
      for (const t of e.changedTouches) fingers.add(t.identifier);
      this.input.pressVirtual(code);
      el.classList.add('down');
    };
    const up = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) fingers.delete(t.identifier);
      if (fingers.size) return;
      this.input.releaseVirtual(code);
      el.classList.remove('down');
    };
    el.addEventListener('touchstart', down);
    el.addEventListener('touchend', up);
    el.addEventListener('touchcancel', up);
  }

  /**
   * A floating thumbstick: it appears wherever a finger lands in `zone` and reports the
   * deflection (-1..1 each way, screen axes: +y is down) into `out`.
   */
  #stick(zone, el, out, onMove) {
    const knob = el.querySelector('.knob');
    const s = { id: null, ox: 0, oy: 0, active: false };
    const set = (x, y) => {
      let dx = (x - s.ox) / STICK_RADIUS;
      let dy = (y - s.oy) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) (dx /= len), (dy /= len);
      out.x = dx;
      out.y = dy;
      onMove(Math.min(1, len));
      knob.style.transform = `translate(${dx * STICK_RADIUS}px, ${dy * STICK_RADIUS}px)`;
    };
    const end = () => {
      s.id = null;
      s.active = out.active = false;
      out.x = out.y = 0;
      onMove(0);
      el.classList.remove('on');
      knob.style.transform = '';
    };
    s.cancel = end;
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (s.id !== null) return;
      const t = e.changedTouches[0];
      s.id = t.identifier;
      s.ox = t.clientX;
      s.oy = t.clientY;
      s.active = out.active = true;
      el.style.left = `${s.ox}px`;
      el.style.top = `${s.oy}px`;
      el.classList.add('on');
      set(t.clientX, t.clientY);
    });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === s.id) set(t.clientX, t.clientY);
    });
    const lift = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === s.id) end();
    };
    zone.addEventListener('touchend', lift);
    zone.addEventListener('touchcancel', lift);
    return s;
  }
}
