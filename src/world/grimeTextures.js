import * as THREE from 'three';
import { createRng } from '../core/random.js';

// Canvas-drawn textures for the street grime (see StreetGrime.js): a ground-decal atlas (stains,
// cracks, litter, manholes...), a graffiti atlas (throw-ups, tags, wheatpaste posters), the dirt
// band along the foot of walls, water-tower staves and steam-stack stripes.

/** Ground decal atlas: GROUND_GRID x GROUND_GRID cells, indexed by these names. */
export const GROUND_GRID = 4;
export const DECAL = {
  oil: 0, stain: 1, crack: 2, patch: 3,
  manhole: 4, litter: 5, butts: 6, puddle: 7,
  paper: 8, grime: 9, drain: 10, tag: 11,
  gum: 12, cup: 13, pizza: 14, glass: 15,
};

/** Graffiti atlas: GRAF_COLS x GRAF_ROWS cells, each twice as wide as it is tall. */
export const GRAF_COLS = 4;
export const GRAF_ROWS = 8;
export const GRAF = {
  throwUps: [0, 12], // [first, count]: bubble-letter pieces
  tags: [12, 12], // spray/marker handstyles
  posters: [24, 6], // wheatpaste posters and flyers
  stickers: [30, 2], // sticker bombs and stencils
};

const WORDS = [
  'ZEKE', 'RIOT', 'KRUSH', 'FUME', 'VEXA', 'NOIZ', 'GRIM', 'SKUM', 'DREK', 'BLAZ', 'OKUR', 'WAXO',
  'SOAR', 'MOLE', 'GHOST', 'YUCK', 'PAWN', 'TOXY', 'BEEF', 'HYPE', 'SLUG', 'RAZE', 'MUGZ', 'DUSK',
];
const SPRAY = ['#e8412f', '#f0c23a', '#3aa6e8', '#5ed35a', '#e85bb4', '#f08a2c', '#9b5be8', '#ffffff', '#36d6c3', '#d8e83a'];
const OUTLINES = ['#111111', '#1b1b3a', '#2a0f12'];
const CHROME = ['#d9dde2', '#c4c9cf'];

function makeTexture(canvas, { repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return tex;
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Runs `draw(ctx, w, h, rng)` inside one atlas cell, clipped to it with a small transparent margin. */
function cell(ctx, x, y, w, h, rng, draw) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 3, y + 3, w - 6, h - 6);
  ctx.clip();
  ctx.translate(x, y);
  draw(ctx, w, h, rng);
  ctx.restore();
}

function blob(ctx, cx, cy, r, rng, color, n = 10) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(0, r * 0.55);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * rng.range(0.3, 0.6), r * rng.range(0.25, 0.5), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
}

function crackLine(ctx, x, y, a, len, w, rng, depth = 0) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  const steps = Math.max(3, Math.round(len / 6));
  for (let i = 0; i < steps; i++) {
    a += rng.range(-0.35, 0.35);
    x += Math.cos(a) * (len / steps);
    y += Math.sin(a) * (len / steps);
    ctx.lineTo(x, y);
    if (depth < 1 && rng.chance(0.15)) {
      ctx.stroke();
      crackLine(ctx, x, y, a + rng.range(-1.4, 1.4), len * 0.45, w * 0.7, rng, depth + 1);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  }
  ctx.stroke();
}

const GROUND_DRAW = {
  oil(ctx, w, h, rng) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w * 0.46);
    g.addColorStop(0, 'rgba(12,10,10,0.45)');
    g.addColorStop(0.55, 'rgba(20,18,20,0.25)');
    g.addColorStop(1, 'rgba(20,18,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.46, h * 0.36, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // Faint rainbow sheen.
    ctx.strokeStyle = 'rgba(120,90,160,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.25, h * 0.18, 0.3, 0.4, 2.6);
    ctx.stroke();
  },
  stain(ctx, w, h, rng) {
    blob(ctx, w / 2, h / 2, w * 0.38, rng, 'rgba(60,45,30,0.18)', 14);
    blob(ctx, w / 2, h / 2, w * 0.2, rng, 'rgba(40,30,20,0.22)', 6);
  },
  crack(ctx, w, h, rng) {
    ctx.strokeStyle = 'rgba(22,20,20,0.6)';
    ctx.lineCap = ctx.lineJoin = 'round';
    crackLine(ctx, rng.range(6, 20), rng.range(30, h - 30), rng.range(-0.3, 0.3), w * 0.95, 1.6, rng);
  },
  patch(ctx, w, h, rng) {
    const x = 12, y = 18, pw = w - 24, ph = h - 36;
    ctx.fillStyle = 'rgba(52,53,58,0.95)';
    ctx.fillRect(x, y, pw, ph);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.08)})`;
      ctx.fillRect(x + rng.range(0, pw), y + rng.range(0, ph), 1.5, 1.5);
    }
    ctx.strokeStyle = 'rgba(25,25,28,0.95)';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, pw, ph);
  },
  manhole(ctx, w, h) {
    const cx = w / 2, cy = h / 2, r = w * 0.43;
    ctx.fillStyle = '#2b2b2d';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4a4c';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = '#333335';
    ctx.lineWidth = 3;
    for (let k = -r; k <= r; k += 9) {
      ctx.beginPath(); ctx.moveTo(cx + k, cy - r); ctx.lineTo(cx + k, cy + r); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - r, cy + k); ctx.lineTo(cx + r, cy + k); ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#3a3a3c';
    ctx.fillRect(cx - r * 0.55, cy - 7, r * 1.1, 14);
    ctx.fillStyle = '#5a5a5c';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SEWER', cx, cy + 1);
    ctx.strokeStyle = '#1a1a1b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  },
  litter(ctx, w, h, rng) {
    for (let i = 0; i < 9; i++) {
      ctx.save();
      ctx.translate(rng.range(15, w - 15), rng.range(15, h - 15));
      ctx.rotate(rng.range(0, Math.PI));
      ctx.scale(1.4, 1.4);
      const kind = rng.int(0, 3);
      if (kind === 0) { // paper scrap
        ctx.fillStyle = rng.pick(['#e9e6dc', '#f2e7b5', '#dcdcdc']);
        ctx.fillRect(-9, -6, 18, 12);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-6, -2, 12, 2);
      } else if (kind === 1) { // can
        ctx.fillStyle = rng.pick(['#c8282c', '#2c6bc8', '#d8d8d8', '#3fa34a']);
        ctx.fillRect(-7, -4, 14, 8);
        ctx.fillStyle = '#bbbbbb';
        ctx.fillRect(5, -4, 2, 8);
      } else if (kind === 2) { // wrapper
        ctx.fillStyle = rng.pick(['#e8b62c', '#e86a2c', '#b42ce8']);
        ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(8, -6); ctx.lineTo(6, 5); ctx.lineTo(-7, 4); ctx.fill();
      } else { // butt
        ctx.fillStyle = '#e8a35a';
        ctx.fillRect(-4, -1.5, 3, 3);
        ctx.fillStyle = '#f2f2ee';
        ctx.fillRect(-1, -1.5, 5, 3);
      }
      ctx.restore();
    }
  },
  butts(ctx, w, h, rng) {
    for (let i = 0; i < 26; i++) {
      ctx.save();
      ctx.translate(rng.range(10, w - 10), rng.range(10, h - 10));
      ctx.rotate(rng.range(0, Math.PI));
      ctx.fillStyle = '#e8a35a';
      ctx.fillRect(-3, -1.2, 2.5, 2.4);
      ctx.fillStyle = '#f2f2ee';
      ctx.fillRect(-0.5, -1.2, 4, 2.4);
      ctx.restore();
    }
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = 'rgba(30,30,30,0.55)';
      ctx.beginPath();
      ctx.arc(rng.range(10, w - 10), rng.range(10, h - 10), rng.range(1.5, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  puddle(ctx, w, h, rng) {
    blob(ctx, w / 2, h / 2, w * 0.4, rng, 'rgba(48,62,80,0.5)', 12);
    ctx.strokeStyle = 'rgba(190,215,235,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.42, w * 0.15, 3.4, 4.6);
    ctx.stroke();
  },
  paper(ctx, w, h, rng) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rng.range(-0.5, 0.5));
    ctx.fillStyle = '#dedad0';
    ctx.fillRect(-44, -32, 88, 64);
    ctx.fillStyle = '#cfcac0';
    ctx.fillRect(0, -32, 44, 64);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-38, -26, 40, 9);
    ctx.fillStyle = 'rgba(40,40,40,0.5)';
    for (let y = -12; y < 26; y += 5) {
      ctx.fillRect(-38, y, 34, 2);
      ctx.fillRect(6, y - 10, 32, 2);
    }
    ctx.fillStyle = 'rgba(60,60,60,0.35)';
    ctx.fillRect(8, 16, 30, 12);
  },
  grime(ctx, w, h, rng) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.47);
    g.addColorStop(0, 'rgba(25,22,18,0.4)');
    g.addColorStop(1, 'rgba(25,22,18,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    blob(ctx, w / 2, h / 2, w * 0.3, rng, 'rgba(30,26,20,0.12)', 10);
  },
  drain(ctx, w, h) {
    ctx.fillStyle = '#1e1e20';
    ctx.fillRect(20, 40, w - 40, h - 80);
    ctx.fillStyle = '#58585a';
    for (let x = 26; x < w - 26; x += 9) ctx.fillRect(x, 44, 4, h - 88);
    ctx.strokeStyle = '#3a3a3c';
    ctx.lineWidth = 4;
    ctx.strokeRect(20, 40, w - 40, h - 80);
    const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(20,18,14,0.35)');
    g.addColorStop(1, 'rgba(20,18,14,0)');
    ctx.fillStyle = g;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillRect(0, 0, w, h);
  },
  tag(ctx, w, h, rng) {
    // A spray-painted tag on the ground, with a ring of overspray.
    const color = rng.pick(SPRAY);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rng.range(-0.5, 0.5));
    ctx.transform(1, 0, -0.3, 1, 0, 0);
    ctx.font = `italic bold 40px ${TAG_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    const word = rng.pick(WORDS);
    ctx.strokeText(word, 0, 0);
    ctx.fillText(word, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-44, 22);
    ctx.quadraticCurveTo(0, 30, 46, 16);
    ctx.stroke();
  },
  gum(ctx, w, h, rng) {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(40,40,40,${rng.range(0.25, 0.6)})`;
      ctx.beginPath();
      ctx.arc(rng.range(8, w - 8), rng.range(8, h - 8), rng.range(1.5, 3.5), 0, Math.PI * 2);
      ctx.fill();
    }
  },
  cup(ctx, w, h, rng) {
    // The classic blue-and-white paper coffee cup, on its side, plus a splash.
    blob(ctx, w * 0.62, h * 0.55, w * 0.22, rng, 'rgba(90,60,30,0.3)', 6);
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rng.range(0, Math.PI * 2));
    ctx.fillStyle = '#2f5fb8';
    ctx.beginPath(); ctx.moveTo(-22, -12); ctx.lineTo(22, -16); ctx.lineTo(22, 16); ctx.lineTo(-22, 12); ctx.fill();
    ctx.fillStyle = '#f4f4ee';
    ctx.fillRect(-14, -12, 6, 25);
    ctx.fillRect(6, -14, 6, 28);
    ctx.fillStyle = '#f4f4ee';
    ctx.fillRect(20, -16, 4, 32);
  },
  pizza(ctx, w, h, rng) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rng.range(-0.6, 0.6));
    ctx.fillStyle = '#b8935e';
    ctx.fillRect(-42, -42, 84, 84);
    ctx.strokeStyle = '#8a6a3c';
    ctx.lineWidth = 3;
    ctx.strokeRect(-42, -42, 84, 84);
    ctx.fillStyle = '#c8322a';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PIZZA', 0, 6);
    for (let i = 0; i < 4; i++) blob(ctx, rng.range(-30, 30), rng.range(-30, 30), 10, rng, 'rgba(110,70,20,0.3)', 3);
  },
  glass(ctx, w, h, rng) {
    for (let i = 0; i < 22; i++) {
      const x = w / 2 + rng.range(-40, 40), y = h / 2 + rng.range(-40, 40), s = rng.range(3, 9);
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(190,225,200,0.8)' : 'rgba(120,80,40,0.8)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + s, y + rng.range(-s, s));
      ctx.lineTo(x + rng.range(-s, s), y + s);
      ctx.fill();
    }
  },
};

/** A loose, fast handstyle scrawl across a box: joined loops and spikes. */
function scribble(ctx, x, y, w, h, rng, letters) {
  ctx.beginPath();
  let px = x, py = y + h * 0.7;
  ctx.moveTo(px, py);
  const step = w / letters;
  for (let i = 0; i < letters; i++) {
    const lx = x + i * step;
    const top = y + rng.range(0, h * 0.3), bot = y + h * rng.range(0.75, 1);
    ctx.bezierCurveTo(lx + step * 0.1, bot, lx + step * 0.2, top, lx + step * 0.45, top);
    ctx.bezierCurveTo(lx + step * 0.7, top, lx + step * 0.3, bot, lx + step, y + h * rng.range(0.5, 0.9));
  }
  ctx.stroke();
}

export function createGroundAtlas(seed = 9) {
  const rng = createRng(seed);
  const n = 128, c = canvas(n * GROUND_GRID, n * GROUND_GRID);
  const ctx = c.getContext('2d');
  for (const [name, i] of Object.entries(DECAL)) {
    cell(ctx, (i % GROUND_GRID) * n, Math.floor(i / GROUND_GRID) * n, n, n, rng, GROUND_DRAW[name]);
  }
  return makeTexture(c);
}

/* ---------------------------------------------------------------------------------------- */
/* Graffiti                                                                                   */
/* ---------------------------------------------------------------------------------------- */

const BUBBLE_FONT = '"Arial Black", "Arial Rounded MT Bold", Impact, "Helvetica Neue", sans-serif';
const TAG_FONT = '"Brush Script MT", "Segoe Script", "Comic Sans MS", cursive';

/** Fat bubble letters: outline, fill, fade, shine and drips, sometimes over a cloud. */
function throwUp(ctx, w, h, rng) {
  const word = rng.pick(WORDS).slice(0, rng.int(3, 5));
  const fill = rng.pick(rng.chance(0.3) ? CHROME : SPRAY);
  const outline = rng.pick(OUTLINES);
  const second = rng.pick(SPRAY);
  const size = Math.min(h * 0.72, (w * 1.15) / word.length);
  ctx.font = `900 ${size}px ${BUBBLE_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const adv = word.split('').map((ch) => ctx.measureText(ch).width * 0.82);
  const total = adv.reduce((a, b) => a + b, 0);
  let x = (w - total) / 2;
  const letters = word.split('').map((ch, i) => {
    const l = { ch, x: x + adv[i] / 2, y: h / 2 + rng.range(-6, 6), r: rng.range(-0.18, 0.18) };
    x += adv[i];
    return l;
  });
  const each = (fn) => letters.forEach((l) => {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(l.r);
    fn(l.ch);
    ctx.restore();
  });

  if (rng.chance(0.4)) { // background cloud
    ctx.fillStyle = rng.pick(SPRAY);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 5;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(w * rng.range(0.15, 0.85), h * rng.range(0.35, 0.65), h * 0.32, h * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = outline;
  ctx.lineWidth = size * 0.3;
  each((ch) => ctx.strokeText(ch, 0, 0));
  ctx.strokeStyle = second;
  ctx.lineWidth = size * 0.16;
  each((ch) => ctx.strokeText(ch, 0, 0));
  ctx.fillStyle = fill;
  each((ch) => ctx.fillText(ch, 0, 0));
  // Fade: a darker sweep across the lower half of the fill.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const fade = ctx.createLinearGradient(0, h * 0.45, 0, h * 0.85);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  each((ch) => ctx.strokeText(ch, 0, 0));
  // Shines.
  ctx.fillStyle = '#ffffff';
  for (const l of letters) {
    ctx.beginPath();
    ctx.ellipse(l.x - size * 0.15, l.y - size * 0.2, size * 0.06, size * 0.03, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Drips.
  ctx.strokeStyle = fill;
  ctx.lineCap = 'round';
  for (let i = 0; i < rng.int(2, 6); i++) {
    const dx = rng.range(w * 0.15, w * 0.85), dy = h / 2 + size * 0.3;
    ctx.lineWidth = rng.range(2, 4);
    ctx.beginPath();
    ctx.moveTo(dx, dy);
    ctx.lineTo(dx, Math.min(h - 6, dy + rng.range(8, 30)));
    ctx.stroke();
  }
}

function handTag(ctx, w, h, rng) {
  const color = rng.pick(['#111111', '#111111', '#cfd3d8', '#e8412f', '#3a6ee8', '#ffffff', '#5ed35a']);
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineCap = ctx.lineJoin = 'round';
  if (rng.chance(0.55)) {
    const word = rng.pick(WORDS) + (rng.chance(0.5) ? ` ${rng.int(1, 199)}` : '');
    ctx.save();
    ctx.translate(w / 2, h * 0.55);
    ctx.transform(1, 0, -0.35, 1, 0, 0);
    ctx.rotate(rng.range(-0.12, 0.08));
    const size = Math.min(h * 0.6, (w * 1.5) / word.length);
    ctx.font = `italic bold ${size}px ${TAG_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = rng.range(2, 4);
    ctx.strokeText(word, 0, 0);
    ctx.fillText(word, 0, 0);
    ctx.restore();
  } else {
    ctx.lineWidth = rng.range(3, 6);
    scribble(ctx, w * 0.1, h * 0.25, w * 0.8, h * 0.45, rng, rng.int(4, 7));
  }
  // Underline swoosh, maybe a crown or star.
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.12, h * 0.85);
  ctx.quadraticCurveTo(w * 0.5, h * rng.range(0.7, 0.95), w * 0.88, h * 0.78);
  ctx.stroke();
  if (rng.chance(0.4)) {
    const cx = w * rng.range(0.2, 0.8), cy = h * 0.15;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy + 8); ctx.lineTo(cx - 12, cy - 4); ctx.lineTo(cx - 5, cy + 2);
    ctx.lineTo(cx, cy - 8); ctx.lineTo(cx + 5, cy + 2); ctx.lineTo(cx + 12, cy - 4); ctx.lineTo(cx + 12, cy + 8);
    ctx.stroke();
  }
}

function poster(ctx, w, h, rng) {
  const n = rng.int(2, 4);
  for (let i = 0; i < n; i++) {
    const pw = rng.range(40, 64), ph = rng.range(60, 100);
    const x = rng.range(8, w - pw - 8), y = rng.range(8, Math.max(9, h - ph - 8));
    ctx.save();
    ctx.translate(x + pw / 2, y + ph / 2);
    ctx.rotate(rng.range(-0.08, 0.08));
    ctx.fillStyle = rng.pick(['#efe9d8', '#f2d64a', '#ef7fa8', '#8fd0ef', '#f08a2c', '#ffffff']);
    // Torn bottom edge.
    ctx.beginPath();
    ctx.moveTo(-pw / 2, -ph / 2);
    ctx.lineTo(pw / 2, -ph / 2);
    for (let k = 6; k >= 0; k--) ctx.lineTo(-pw / 2 + (pw * k) / 6, ph / 2 - rng.range(0, 10));
    ctx.fill();
    ctx.fillStyle = rng.pick(['#111111', '#b8182a', '#1b3a8a']);
    ctx.fillRect(-pw / 2 + 5, -ph / 2 + 6, pw - 10, 12);
    if (rng.chance(0.6)) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-pw / 2 + 8, -ph / 2 + 24, pw - 16, ph * 0.35);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (let k = 0; k < 3; k++) ctx.fillRect(-pw / 2 + 6, ph * 0.12 + k * 6, pw - 12 - rng.range(0, 14), 2.5);
    ctx.restore();
  }
}

function stickers(ctx, w, h, rng) {
  if (rng.chance(0.5)) {
    // Stencil: a blocky face, spray-mist round it.
    ctx.fillStyle = 'rgba(17,17,17,0.15)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 50, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111111';
    ctx.fillRect(w / 2 - 34, h / 2 - 36, 68, 72);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(w / 2 - 22, h / 2 - 18, 14, 10);
    ctx.fillRect(w / 2 + 8, h / 2 - 18, 14, 10);
    ctx.fillRect(w / 2 - 20, h / 2 + 12, 40, 8);
    ctx.fillStyle = '#111111';
    ctx.fillRect(w / 2 - 12, h / 2 + 12, 4, 8);
    ctx.fillRect(w / 2 + 8, h / 2 + 12, 4, 8);
    ctx.font = `bold 22px ${BUBBLE_FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText(rng.pick(WORDS), w / 2 + 44, h / 2 + 8);
  } else {
    for (let i = 0; i < 16; i++) {
      ctx.save();
      ctx.translate(rng.range(16, w - 16), rng.range(16, h - 16));
      ctx.rotate(rng.range(-0.4, 0.4));
      ctx.fillStyle = rng.pick(['#ffffff', '#f2d64a', '#e8412f', '#3aa6e8', '#111111']);
      ctx.fillRect(-14, -9, 28, 18);
      ctx.fillStyle = rng.pick(['#e8412f', '#111111', '#3aa6e8']);
      ctx.fillRect(-10, -3, 20, 6);
      ctx.restore();
    }
  }
}

export function createGraffitiAtlas(seed = 31) {
  const rng = createRng(seed);
  const cw = 256, ch = 128;
  const c = canvas(cw * GRAF_COLS, ch * GRAF_ROWS);
  const ctx = c.getContext('2d');
  const at = (i, fn) => cell(ctx, (i % GRAF_COLS) * cw, Math.floor(i / GRAF_COLS) * ch, cw, ch, rng, fn);
  for (const [key, fn] of [['throwUps', throwUp], ['tags', handTag], ['posters', poster], ['stickers', stickers]]) {
    const [first, count] = GRAF[key];
    for (let i = 0; i < count; i++) at(first + i, fn);
  }
  return makeTexture(c);
}

/** Dirt along the foot of a wall: dark at the bottom, streaky, fading out upwards. Tiles in u. */
export function createWallGrimeTexture(seed = 5) {
  const rng = createRng(seed);
  const w = 256, h = 64, c = canvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, 'rgba(28,24,20,0.55)');
  g.addColorStop(0.35, 'rgba(28,24,20,0.25)');
  g.addColorStop(1, 'rgba(28,24,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, w), len = rng.range(10, h * 0.9), sw = rng.range(2, 8);
    const s = ctx.createLinearGradient(0, h, 0, h - len);
    s.addColorStop(0, `rgba(25,20,15,${rng.range(0.1, 0.3)})`);
    s.addColorStop(1, 'rgba(25,20,15,0)');
    ctx.fillStyle = s;
    ctx.fillRect(x, h - len, sw, len);
  }
  return makeTexture(c, { repeat: true });
}

/** Wooden water-tower staves with iron hoops. */
export function createTankTexture() {
  const w = 128, h = 64, c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a6440';
  ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) {
    ctx.fillStyle = `rgba(0,0,0,${0.08 + ((x * 7) % 5) * 0.03})`;
    ctx.fillRect(x, 0, 8, h);
    ctx.fillStyle = 'rgba(30,18,8,0.6)';
    ctx.fillRect(x, 0, 1.5, h);
  }
  ctx.fillStyle = '#2a2622';
  for (const y of [8, 24, 40, 56]) ctx.fillRect(0, y, w, 3);
  const tex = makeTexture(c, { repeat: true });
  tex.repeat.set(3, 1);
  return tex;
}

/** Orange-and-white hazard stripes for the steam stacks in the road. */
export function createStackTexture() {
  const c = canvas(32, 64);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? '#f4f1ea' : '#f06a1c';
    ctx.fillRect(0, i * 16, 32, 16);
  }
  return makeTexture(c, { repeat: true });
}

/** Soft round puff for steam particles. */
export function createPuffTexture() {
  const s = 64, c = canvas(s, s);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return makeTexture(c);
}
