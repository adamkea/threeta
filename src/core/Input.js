// Keyboard state tracker. Exposes normalized axes so game code doesn't care about key bindings.
const BINDINGS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  reset: ['KeyR'],
  use: ['KeyF', 'Enter'], // enter / exit vehicles
  sprint: ['ShiftLeft', 'ShiftRight'],
  map: ['KeyM'],
};

export class Input {
  constructor(target = window) {
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    target.addEventListener('keydown', (e) => {
      if (Object.values(BINDINGS).flat().includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
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
    const x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const z = (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
    const len = Math.hypot(x, z) || 1;
    return { x: x / len, y: z / len };
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }
}
