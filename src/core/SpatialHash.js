/**
 * Uniform grid over moving things (cars, people), rebuilt every physics step, so "who is near
 * me?" looks at a few cells instead of every object in the world. Items are bucketed by their
 * `position` (Vector2 on the XZ plane). Queries return everything in the cells overlapping the
 * area (a superset): callers still do their own exact distance tests.
 *
 * Stored as a counting sort over a flat grid that just covers the items' current bounds: no
 * hashing, no per-step allocation once the buffers have grown, and memory follows the area
 * the items are spread over rather than the size of the map.
 */
const MAX_CELLS_PER_SIDE = 256;

export class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.s = cellSize; // cell size actually in use (see rebuild)
    this.x0 = this.z0 = 0; // cell coordinates of the grid's corner
    this.w = this.h = 0; // grid size in cells (cz runs fastest)
    this.start = new Int32Array(1); // items of cell c are sorted[start[c] .. start[c + 1])
    this.cellOf = new Int32Array(0);
    this.sorted = [];
  }

  /** Re-bucket `items` at their current positions. */
  rebuild(items) {
    const n = items.length;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = items[i].position;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minZ) minZ = p.y;
      if (p.y > maxZ) maxZ = p.y;
    }
    if (n === 0) {
      this.w = this.h = 0;
      return;
    }
    // Coarser cells if things are spread unusually far apart, so the grid never gets huge.
    const s = (this.s = Math.max(this.cellSize, (maxX - minX) / MAX_CELLS_PER_SIDE, (maxZ - minZ) / MAX_CELLS_PER_SIDE));
    this.x0 = Math.floor(minX / s);
    this.z0 = Math.floor(minZ / s);
    this.w = Math.floor(maxX / s) - this.x0 + 1;
    this.h = Math.floor(maxZ / s) - this.z0 + 1;
    const cells = this.w * this.h;
    if (this.start.length < cells + 1) this.start = new Int32Array(cells + 1);
    if (this.cellOf.length < n) this.cellOf = new Int32Array(n);
    const { start, cellOf, sorted } = this;
    start.fill(0, 0, cells + 1);
    for (let i = 0; i < n; i++) {
      const p = items[i].position;
      const c = (Math.floor(p.x / s) - this.x0) * this.h + (Math.floor(p.y / s) - this.z0);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    // Place each item, counting each cell's start back up as we go, then shift it back down.
    sorted.length = n;
    for (let i = 0; i < n; i++) sorted[start[cellOf[i]]++] = items[i];
    for (let c = cells; c > 0; c--) start[c] = start[c - 1];
    start[0] = 0;
  }

  /** Items in cells overlapping the box [minX, maxX] × [minZ, maxZ]. Fills and returns `out`. */
  queryBox(minX, minZ, maxX, maxZ, out) {
    out.length = 0;
    const s = this.s;
    const cx0 = Math.max(0, Math.floor(minX / s) - this.x0);
    const cx1 = Math.min(this.w - 1, Math.floor(maxX / s) - this.x0);
    const cz0 = Math.max(0, Math.floor(minZ / s) - this.z0);
    const cz1 = Math.min(this.h - 1, Math.floor(maxZ / s) - this.z0);
    if (cz0 > cz1) return out;
    const { start, sorted } = this;
    for (let cx = cx0; cx <= cx1; cx++) {
      // A column's cells are contiguous in `sorted`.
      const end = start[cx * this.h + cz1 + 1];
      for (let k = start[cx * this.h + cz0]; k < end; k++) out.push(sorted[k]);
    }
    return out;
  }

  /** Items in cells within `r` of (x, z) (square test). Fills and returns `out`. */
  query(x, z, r, out) {
    return this.queryBox(x - r, z - r, x + r, z + r, out);
  }
}

/**
 * The neighbour grids one physics step needs: active cars, everyone on foot, and the people
 * standing in the road (the only ones drivers brake for).
 */
export class Neighbourhood {
  constructor() {
    this.cars = new SpatialHash(16);
    this.peds = new SpatialHash(4);
    this.roadPeds = new SpatialHash(16);
  }

  rebuild(cars, peds, roadPeds) {
    this.cars.rebuild(cars);
    this.peds.rebuild(peds);
    this.roadPeds.rebuild(roadPeds);
  }
}
