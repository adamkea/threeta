/**
 * Performance overlay for the dev console: frame rate, where the CPU time goes (simulation,
 * per-frame game logic, render submission), GPU time where the browser supports timer queries,
 * renderer counters (draw calls / triangles across every pass, including shadows), live
 * entity counts and JS heap. Measures only while visible; the text refreshes a few times a
 * second so the overlay itself stays cheap.
 */
import { Vector2 } from 'three';

const WINDOW = 1; // seconds of history behind the averages
const GRAPH_SAMPLES = 150;

export class PerfStats {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {() => Record<string, number | string>} counts extra rows (entity counts etc.)
   */
  constructor(renderer, counts) {
    this.renderer = renderer;
    this.counts = counts;
    this.visible = false;
    this.frames = []; // { t, dt, sim, logic, render, steps }
    this.graph = new Float32Array(GRAPH_SAMPLES);
    this.graphPos = 0;
    this.cur = null;
    this.textTimer = 0;
    this.gpuMs = null;

    // GPU timing (WebGL2 + EXT_disjoint_timer_query_webgl2: desktop Chrome / Edge, not Safari / Firefox).
    const gl = renderer.getContext();
    this.gl = gl;
    this.timerExt = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    this.queries = []; // in flight, oldest first
    this.gpuSamples = [];

    this.el = document.createElement('div');
    this.el.id = 'perf';
    this.el.innerHTML = '<canvas width="300" height="56"></canvas><pre></pre>';
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this.textEl = this.el.querySelector('pre');
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.classList.toggle('open', v);
    // Count every render call in a frame (colour, normals, shadows, post) instead of just the last.
    this.renderer.info.autoReset = !v;
    if (v) this.frames.length = 0;
  }

  beginFrame(dt) {
    if (!this.visible) return;
    this.renderer.info.reset();
    this.cur = { t: performance.now(), dt, sim: 0, logic: 0, render: 0, steps: 0 };
  }

  /** Time a section of this frame ('sim' or 'render'); `fn`'s return value is passed through. */
  measure(section, fn) {
    if (!this.cur) return fn();
    const t0 = performance.now();
    const out = fn();
    this.cur[section] += performance.now() - t0;
    return out;
  }

  /** Like `measure`, also timing the GPU work it issues. */
  measureRender(fn) {
    if (!this.cur || !this.timerExt || this.queries.length > 4) return this.measure('render', fn);
    const gl = this.gl;
    const q = gl.createQuery();
    gl.beginQuery(this.timerExt.TIME_ELAPSED_EXT, q);
    const out = this.measure('render', fn);
    gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.queries.push(q);
    return out;
  }

  addSteps(n) {
    if (this.cur) this.cur.steps += n;
  }

  endFrame() {
    const f = this.cur;
    if (!f) return;
    this.cur = null;
    // Everything in the frame that wasn't physics or rendering: AI, spawning, HUD, camera…
    f.logic = Math.max(0, performance.now() - f.t - f.sim - f.render);
    this.pollGpu();
    this.frames.push(f);
    while (this.frames.length && f.t - this.frames[0].t > WINDOW * 1000) this.frames.shift();
    this.graph[this.graphPos] = f.dt * 1000;
    this.graphPos = (this.graphPos + 1) % GRAPH_SAMPLES;
    this.textTimer -= f.dt;
    if (this.textTimer <= 0) {
      this.textTimer = 0.25;
      this.writeText();
    }
    this.drawGraph();
  }

  pollGpu() {
    if (!this.timerExt) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.timerExt.GPU_DISJOINT_EXT);
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!disjoint) this.gpuSamples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      this.queries.shift();
    }
    if (this.gpuSamples.length > 30) this.gpuSamples.splice(0, this.gpuSamples.length - 30);
    if (this.gpuSamples.length) this.gpuMs = this.gpuSamples.reduce((a, b) => a + b, 0) / this.gpuSamples.length;
  }

  writeText() {
    const fr = this.frames;
    if (!fr.length) return;
    const avg = (k) => fr.reduce((a, f) => a + f[k], 0) / fr.length;
    const dts = fr.map((f) => f.dt * 1000);
    const avgDt = dts.reduce((a, b) => a + b, 0) / dts.length;
    const worst = Math.max(...dts);
    const info = this.renderer.info;
    const pr = this.renderer.getPixelRatio();
    const size = this.renderer.getDrawingBufferSize(this._size ??= new Vector2());
    const ms = (v) => `${v.toFixed(2).padStart(6)} ms`;
    const rows = [
      `FPS      ${(1000 / avgDt).toFixed(0).padStart(6)}    frame ${avgDt.toFixed(1)} ms  (worst ${worst.toFixed(1)})`,
      `CPU sim  ${ms(avg('sim'))}   ${avg('steps').toFixed(1)} steps/frame`,
      `CPU game ${ms(avg('logic'))}`,
      `CPU draw ${ms(avg('render'))}`,
      `GPU      ${this.timerExt ? (this.gpuMs == null ? '     …' : ms(this.gpuMs)) : '   n/a (no timer queries)'}`,
      `draws    ${String(info.render.calls).padStart(6)}    tris ${fmt(info.render.triangles)}`,
      `geoms    ${String(info.memory.geometries).padStart(6)}    textures ${info.memory.textures}   shaders ${info.programs?.length ?? '?'}`,
      `buffer   ${size.x}×${size.y} @${pr}x`,
    ];
    const mem = performance.memory;
    if (mem) rows.push(`JS heap  ${(mem.usedJSHeapSize / 1048576).toFixed(0).padStart(6)} MB / ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB`);
    for (const [k, v] of Object.entries(this.counts())) rows.push(`${k.padEnd(8)} ${String(v).padStart(6)}`);
    this.textEl.textContent = rows.join('\n');
  }

  drawGraph() {
    const c = this.ctx2d;
    const { width: w, height: h } = this.canvas;
    const maxMs = 50;
    const y = (ms) => h - Math.min(1, ms / maxMs) * h;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(233,228,218,.25)';
    c.beginPath();
    for (const ms of [16.7, 33.3]) c.moveTo(0, y(ms) + 0.5), c.lineTo(w, y(ms) + 0.5);
    c.stroke();
    const bw = w / GRAPH_SAMPLES;
    for (let i = 0; i < GRAPH_SAMPLES; i++) {
      const ms = this.graph[(this.graphPos + i) % GRAPH_SAMPLES];
      if (!ms) continue;
      c.fillStyle = ms > 33.4 ? '#ff6a5a' : ms > 17.5 ? '#ffd23a' : '#7fd17f';
      c.fillRect(i * bw, y(ms), Math.ceil(bw), h - y(ms));
    }
  }
}

const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
