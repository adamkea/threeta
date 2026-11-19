// Keyboard + mouse + touch state tracker (mouse buttons show up as 'Mouse0', 'Mouse1'… codes; on-screen
// touch buttons as 'Touch…' codes, see ui/TouchControls.js). Exposes normalized axes so game code doesn't
// care about key bindings.
const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space', 'TouchHandbrake'],
  reset: ['KeyR', 'TouchReset'],
  use: ['KeyF', 'Enter', 'TouchUse'], // enter / exit vehicles
  sprint: ['ShiftLeft', 'ShiftRight', 'TouchSprint'],
  map: ['KeyM', 'TouchMap'],
  fire: ['Mouse0', 'ControlLeft', 'ControlRight', 'TouchFire'],
  weapon: ['KeyQ', 'TouchWeapon'], // draw / holster / cycle weapons
  reload: ['KeyE', 'TouchReload'],
  back: ['Escape', 'Backspace'], // close menus
};

const STICK_DEADZONE = 0.15;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const isTextField = (el) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    target.addEventListener('keydown', (e) => {
      if (isTextField(e.target)) return; // typing in the dev console isn't driving
      if (Object.values(BINDINGS).flat().includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    /** Pointer position in CSS pixels (client coordinates), for aiming. */
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, moved: false };
    target.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved = true;
    });
    target.addEventListener('mousedown', (e) => {
      const code = `Mouse${e.button}`;
      if (!this.keys.has(code)) this.pressedThisFrame.add(code);
      this.keys.add(code);
    });
    target.addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    /** True once the on-screen touch controls are in use. */
    this.touch = false;
    /** Touch thumbsticks: deflection -1..1 in screen axes (+y down), set by TouchControls. */
    this.stick = { x: 0, y: 0, active: false };
    this.aimStick = { x: 0, y: 0, active: false };
  }

  /** Hold / release a virtual key (on-screen buttons). */
  pressVirtual(code) {
    if (!this.keys.has(code)) this.pressedThisFrame.add(code);
    this.keys.add(code);
  }

  releaseVirtual(code) {
    this.keys.delete(code);
  }

  /** The move stick's deflection with the dead zone taken out, or null if it isn't held. */
  #stickVec() {
    const { x, y, active } = this.stick;
    const len = Math.hypot(x, y);
    if (!active || len < STICK_DEADZONE) return null;
    const k = Math.min(1, (len - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / len;
    return { x: x * k, y: y * k, len: len * k };
  }

  /**
   * Controls for a car the player is driving. Keys steer the car directly; the touch stick
   * instead points where you want to go on screen (north-up camera) and the car turns that way,
   * with throttle from how far it's pushed. Pull it back behind the car to brake, then reverse.
   */
  driveControls(car) {
    const handbrake = this.isDown('handbrake');
    const v = this.#stickVec();
    if (!v) return { throttle: this.throttle, steer: this.steer, handbrake };
    // Screen right = +X, screen down = +Z; heading 0 faces +Z and +steer turns towards +heading.
    const want = Math.atan2(v.x, v.y);
    const diff = wrapAngle(want - car.heading);
    const clamp = (a) => Math.max(-1, Math.min(1, a));
    const vF = car.velocity.x * car.forward.x + car.velocity.y * car.forward.y;
    // Behind the car: brake / reverse, steering the tail towards the stick.
    const backwards = Math.abs(diff) > (vF > 2 ? 2.4 : 2.0);
    if (backwards) return { throttle: -v.len, steer: clamp(-wrapAngle(diff - Math.PI) * 2.5), handbrake };
    // Ease off for tight turns so the car doesn't just slide wide.
    const throttle = v.len * (Math.abs(diff) > 1.2 ? 0.6 : 1);
    return { throttle, steer: clamp(diff * 2.5), handbrake };
  }

  /** Drop every held key/button (e.g. when focus moves to a text field). */
  releaseAll() {
    this.keys.clear();
    this.stick.active = this.aimStick.active = false;
  }

  isDown(action) {
    return BINDINGS[action].some((k) => this.keys.has(k));
  }

  wasPressed(action) {
    return BINDINGS[action].some((k) => this.pressedThisFrame.has(k));
  }

  /** -1..1 throttle (forward positive) */
  get throttle() {
    return (this.isDown('up') ? 1 : 0) - (this.isDown('down') ? 1 : 0);
  }

  /** -1..1 steering (left positive) */
  get steer() {
    return (this.isDown('left') ? 1 : 0) - (this.isDown('right') ? 1 : 0);
  }

  /**
   * On-foot movement as a world-space direction (x, z), screen-relative for the north-up
   * camera: up = -Z, right = +X. Length is 0 or 1.
   */
  get move() {
    const v = this.#stickVec();
    if (v) return { x: v.x, y: v.y };
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const z = (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, y: z / len };
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }
}
