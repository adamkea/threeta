const EMPTY = [];

/**
 * Uniform spatial hash over static AABB colliders. Each box is inserted (with a margin)
 * into every cell it touches, so a single-cell lookup finds everything within `margin`.
 */
export class ColliderGrid {
  constructor(colliders, cellSize = 16, margin = 2.5) {
    this.cellSize = cellSize;
    this.cells = new Map();
    for (const b of colliders) {
      const x0 = this.#cell(b.minX - margin), x1 = this.#cell(b.maxX + margin);
      const z0 = this.#cell(b.minZ - margin), z1 = this.#cell(b.maxZ + margin);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = this.#key(x, z);
          let list = this.cells.get(k);
          if (!list) this.cells.set(k, (list = []));
          list.push(b);
        }
      }
    }
  }

  #cell(v) {
    return Math.floor(v / this.cellSize);
  }

  #key(cx, cz) {
    return cx * 100003 + cz;
  }

  query(x, z) {
    return this.cells.get(this.#key(this.#cell(x), this.#cell(z))) || EMPTY;
  }
}
