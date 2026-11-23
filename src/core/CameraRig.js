import * as THREE from 'three';

/**
 * Chinatown Wars–style camera: high, steeply angled, fixed orientation (north-up).
 * Looks ahead in the direction of travel and pulls back as speed rises.
 */
export class CameraRig {
  constructor(camera, { height = 50, maxHeight = 72, tilt = 0.3, lookAhead = 0.55, maxLeadPerHeight = 0.14 } = {}) {
    this.camera = camera;
    this.height = height;
    this.maxHeight = maxHeight;
    this.tilt = tilt; // horizontal offset per unit height (0 = straight down)
    this.lookAhead = lookAhead; // seconds of velocity to lead the target by
    this.maxLeadPerHeight = maxLeadPerHeight; // lead cap as a fraction of camera height
    this.focus = new THREE.Vector3();
    this.currentHeight = height;
    this.initialised = false;
  }

  /** Change zoom (e.g. closer on foot); the camera eases to it. */
  setZoom(height, maxHeight) {
    this.height = height;
    this.maxHeight = maxHeight;
  }

  update(dt, target) {
    if (!this.initialised) this.currentHeight = this.height;
    const lead = new THREE.Vector3(target.velocity.x, 0, target.velocity.y).multiplyScalar(this.lookAhead);
    // Scale the lead with zoom so a close camera never pushes the target off screen.
    lead.clampLength(0, Math.min(16, this.currentHeight * this.maxLeadPerHeight));
    const desired = new THREE.Vector3(target.position.x, 0, target.position.y).add(lead);

    const speedT = Math.min(1, target.speed / 30);
    const desiredHeight = THREE.MathUtils.lerp(this.height, this.maxHeight, speedT);

    if (!this.initialised) {
      this.focus.copy(desired);
      this.currentHeight = desiredHeight;
      this.initialised = true;
    }
    this.focus.lerp(desired, 1 - Math.exp(-4 * dt));
    this.currentHeight += (desiredHeight - this.currentHeight) * (1 - Math.exp(-1.5 * dt));

    const h = this.currentHeight;
    this.camera.position.set(this.focus.x, h, this.focus.z + h * this.tilt);
    this.camera.lookAt(this.focus);
  }
}
