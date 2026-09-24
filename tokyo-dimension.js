// Tokyo Dive (ur_fortune's 'tokyodive'): the pocket of night Tokyo a car dives into. A one-way ~315 m course far from
// every course (ORIGIN): a neon street, the scramble crossing under giant screens, two drift corners through an izakaya
// alley and a spiral parking garage down to the exit gate. Built once per race for a local driver (getDimension).
// D.track has race.track's interface, so game.js's physics drive on it (car._.track); D.track.view(ctx, v) switches sky,
// fog, lights and rain to night Tokyo for the viewport of a car inside and returns the undo.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const ORIGIN = new THREE.Vector3(20000, 0, 20000);
const W2 = 6.5, WALL = 7.1, FAC = 8.6, STEP = 0.5;          // road half width, physical wall, building fronts (lateral m)
const LEVEL = 4.6, CEIL = 4.2, CEIL_EXIT = 3.6;               // garage: drop per turn, ceiling heights
const R_HELIX = 18, BAY = 13.5, GW = 8.3, SHELL = R_HELIX + BAY + 1.5;   // helix radius, bays' outer wall / walkway lateral, garage drum
const GRIP = 1.35, TIME = 1.25;   // more bite than a race track; its clock runs fast (a twisty course, but the dive pays by distance)
const PZ = { z0: 32, z1: 72, zc: 52, x: 24, rw: 10, side: 12, end: 80 };   // scramble crossing box (local, the path runs along +z)
// [kind 's'traight | 'a'rc, length | radius, degrees (+ = left), zone, drop]
const SEGS = [
  ['s', 32, 0, 'street'], ['s', 40, 0, 'cross'], ['s', 8, 0, 'street'],
  ['a', 28, -90, 'street'], ['s', 10, 0, 'alley'], ['a', 24, 70, 'alley'],
  ['s', 28, 0, 'garage'], ['a', R_HELIX, -360, 'helix', LEVEL], ['s', 12, 0, 'exit'],   // garage straight: from the drum wall to the helix
];
const GATE_S = 6, START_S = 9, BACK_S = 2;
// start -> exit gate (build: exitS = L - 5): the whole run in there, known without building it (a CPU's dive)
export const RUN = SEGS.reduce((s, [k, a, deg]) => s + (k === 's' ? a : Math.abs(deg) * Math.PI / 180 * a), 0) - 5 - START_S;
const INDOOR = new Set(['garage', 'helix', 'exit']);
const HOT = ['#ff7a1a', '#19f0e0', '#ff2f9e'];
const MORE = ['#ffb13b', '#2fb8ff', '#ff5bd8', '#b45cff', '#ff3b3b', '#39ff9a', '#fff0c8', '#ffe14a'];
const FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","YuGothic","Meiryo","Noto Sans JP",sans-serif';
const V_WORDS = ['ラーメン', 'カラオケ', '居酒屋', '焼肉', '寿司', '喫茶', '漫画', 'ホテル', '占い', '餃子', '酒場', 'ゲーム',
  'スナック', 'BAR', '薬局', '焼鳥', 'たこ焼', 'ホルモン', '古着', '中華', '夜市', 'ネオン', 'ドリフト', '東京', '24時間',
  '駐車場', 'ダーツ', '麻雀', 'うどん', '牛丼'];
const H_WORDS = ['カラオケ 24時間', 'ゲームセンター', 'ラーメン横丁', '焼肉 炎', '居酒屋 まつり', 'ホテル 夜桜', '漫画喫茶',
  'DRIFT CLUB', '東京ネオン', 'BAR 月光', '寿司 大漁', '占いの館', '深夜営業', '餃子の城', '夜カフェ', 'ゲーム 24H',
  'ドリフト 東京', 'とんこつラーメン', '駐車場 空あり', '24時間 営業中', 'ダーツ&ビリヤード', '立ち飲み 酒'];
// lit sign panels painted on the upper floors (one tenant per floor, Center-gai style)
const F_WORDS = ['2F 焼肉', '3F カラオケ', 'B1 BAR', '4F 雀荘', '5F ネイル', '2F 居酒屋', '3F 漫画喫茶', '6F ダーツ',
  '4F 整体', '2F ゲーム', '5F スナック', '3F ラーメン', '24時間', '7F 占い', '2F 牛丼', '4F ビリヤード'];
const BILLS = [['トーキョー・ダイブ', '異空間へようこそ'], ['ドリフト王', '今夜 決定戦'], ['ネオン・グランプリ', '全国大会 開催中'],
  ['夜の東京', 'NIGHT TOKYO'], ['ラーメン', '深夜まで営業'], ['カラオケ', '全室 半額']];
const NIGHT = {
  street: { fog: '#2a1030', near: 14, far: 190, hemi: ['#3a2a66', '#140a14', 0.55] },
  indoor: { fog: '#0b1210', near: 10, far: 110, hemi: ['#5c6a66', '#1a1c1e', 0.5] },
  sky: { top: '#030208', horizon: '#4a1650', bottom: '#07030c' },
  skyIn: '#070a09',   // the helix's open core: dark concrete void, never the night sky
  sun: { color: '#7d8cff', intensity: 0.18 },
  env: 0.08, exposure: 1.1,
};
const LIGHTS = 4;

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

const CACHE = new WeakMap();
export function getDimension(race) {
  let D = CACHE.get(race);
  if (!D) { D = build(race); CACHE.set(race, D); }
  return D;
}

// ======================================================================================
// Path + track object (same interface as game.js's buildTrack, but open-ended and level-aware)
// ======================================================================================
function makePath() {
  const S = [], segs = [];
  let x = 0, y = 0, z = 0, h = 0, s = 0;
  const push = zone => S.push({ lx: x, ly: y, lz: z, h, s, zone });
  push(SEGS[0][3]);
  for (const [kind, a, deg, zone, drop = 0] of SEGS) {
    const len = kind === 's' ? a : Math.abs(deg) * Math.PI / 180 * a;
    const n = Math.max(1, Math.round(len / STEP)), ds = len / n, w = kind === 'a' ? Math.sign(deg) / a : 0, i0 = S.length - 1;
    for (let i = 0; i < n; i++) {
      h += w * ds / 2; x += Math.sin(h) * ds; z += Math.cos(h) * ds; h += w * ds / 2;
      y -= drop / n; s += ds;
      push(zone);
    }
    segs.push({ kind, zone, i0, i1: S.length - 1 });
  }
  const N = S.length, L = s;
  S.forEach((p, i) => {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(N - 1, i + 1)], a3 = S[Math.max(0, i - 3)], b3 = S[Math.min(N - 1, i + 3)];
    p.local = new THREE.Vector3(p.lx, p.ly, p.lz);
    p.pos = p.local.clone().add(ORIGIN);
    p.tan = new THREE.Vector3(Math.sin(p.h), (b.ly - a.ly) / (b.s - a.s), Math.cos(p.h)).normalize();
    p.right = new THREE.Vector3(-Math.cos(p.h), 0, Math.sin(p.h));
    p.t = p.s / L;
    p.curv = (b3.h - a3.h) / (b3.s - a3.s);
  });
  return { S, N, L, segs };
}

function makeTrack({ S, N, L }) {
  const iAt = s => { let a = 0, b = N - 1; while (b - a > 1) { const m = (a + b) >> 1; if (S[m].s < s) a = m; else b = m; } return a; };
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { pos: p } of S) {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }
  const lerpAt = (t, key) => {
    const s = clamp(t, 0, 1) * L, i = iAt(s), a = S[i], b = S[Math.min(N - 1, i + 1)], k = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return a[key].clone().lerp(b[key], k);
  };
  return {
    samples: S, N, length: L, spacing: L / (N - 1), width: W2 * 2, wall: WALL, grip: GRIP, timeScale: TIME, laps: 1, bounds,
    def: { id: 'tokyodive', name: 'トーキョー・ダイブ', width: W2 * 2 }, iAt,
    // 3D-weighted: the garage levels stack 4.6 m apart and must never snap onto each other
    nearest(pos, hint) {
      let best = 0, bd = Infinity;
      const scan = (a, b) => {
        for (let i = Math.max(0, a); i <= Math.min(N - 1, b); i++) {
          const p = S[i].pos, d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2 + 16 * (p.y - pos.y) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      };
      if (Number.isInteger(hint) && hint >= 0 && hint < N) scan(hint - 80, hint + 80);
      if (bd > 900) { bd = Infinity; scan(0, N - 1); }
      const s = S[best], dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
      const along = dx * s.tan.x + dz * s.tan.z, lateral = dx * s.right.x + dz * s.right.z;
      return { index: best, t: clamp((s.s + along) / L, 0, 1), point: s.pos.clone().addScaledVector(s.tan, along), tangent: s.tan.clone(), lateral, dist: Math.abs(lateral) };
    },
    pointAt: t => lerpAt(t, 'pos'),
    tangentAt: t => lerpAt(t, 'tan').normalize(),
  };
}

// ======================================================================================
// Canvas helpers
// ======================================================================================
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { repeat = false, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, amp) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
const _c = new THREE.Color(), _w = new THREE.Color(1, 1, 1);
const hot = (color, k) => _c.set(color).lerp(_w, k).getStyle();
function glowText(g, text, x, y, size, color, { blur = 0.35, weight = 900, core = 0.55, font = FONT } = {}) {
  g.font = `${weight} ${size}px ${font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = size * blur;
  g.fillStyle = color; g.fillText(text, x, y);
  g.shadowBlur = size * blur * 0.35; g.fillStyle = hot(color, core); g.fillText(text, x, y);
  g.shadowBlur = 0;
}
function fitSize(g, text, size, maxW) {
  g.font = `900 ${size}px ${FONT}`;
  const w = g.measureText(text).width;
  return w > maxW ? size * maxW / w : size;
}
function neonFrame(g, w, h, color, inset = 6, lw = 4) {
  g.strokeStyle = hot(color, 0.3); g.lineWidth = lw; g.shadowColor = color; g.shadowBlur = 14;
  g.strokeRect(inset, inset, w - 2 * inset, h - 2 * inset);
  g.shadowBlur = 0;
}

// shelf-packed atlas; add() returns the uv rect { u0, v0, u1, v1 } (flipY: v1 = top row)
function makeAtlas(W, H) {
  const c = canvas(W, H), g = c.getContext('2d'), P = 4;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  let x = 0, y = 0, row = 0;
  return {
    c, g,
    add(w, h, draw) {
      w = Math.round(w); h = Math.round(h);
      if (x + w > W) { x = 0; y += row + P; row = 0; }
      if (y + h > H) { console.warn('[tokyo] atlas full'); return { u0: 0, v0: 0, u1: 1 / W, v1: 1 / H }; }
      g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip(); draw(g, w, h); g.restore();
      const r = { u0: (x + 0.5) / W, u1: (x + w - 0.5) / W, v0: 1 - (y + h - 0.5) / H, v1: 1 - (y + 0.5) / H };
      x += w + P; row = Math.max(row, h);
      return r;
    },
  };
}

// quads for merged meshes: corners counter-clockwise as seen from the front (bl, br, tr, tl)
class Batch {
  constructor() { this.p = []; this.uv = []; this.ix = []; }
  quad(bl, br, tr, tl, r) {
    const n = this.p.length / 3;
    this.p.push(bl.x, bl.y, bl.z, br.x, br.y, br.z, tr.x, tr.y, tr.z, tl.x, tl.y, tl.z);
    this.uv.push(r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1);
    this.ix.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  // upright card at c facing horizontal direction n
  card(c, n, w, h, r) {
    const x = new THREE.Vector3().crossVectors(UP, n).normalize().multiplyScalar(w / 2), y = new THREE.Vector3(0, h / 2, 0);
    this.quad(c.clone().sub(x).sub(y), c.clone().add(x).sub(y), c.clone().add(x).add(y), c.clone().sub(x).add(y), r);
  }
  // vertical wall on the ground segment a -> b facing `facing` (swapped if needed), u per end, v over y0..y1
  wall(a, b, ua, ub, y0, y1, v0, v1, facing) {
    const dx = b.x - a.x, dz = b.z - a.z;
    if (dx * facing.z - dz * facing.x < 0) [a, b, ua, ub] = [b, a, ub, ua];   // normal (b - a) x up = (-dz, 0, dx) must point along facing
    this.quad(new THREE.Vector3(a.x, a.y + y0, a.z), new THREE.Vector3(b.x, b.y + y0, b.z), new THREE.Vector3(b.x, b.y + y1, b.z), new THREE.Vector3(a.x, a.y + y1, a.z),
      { u0: ua, u1: ub, v0, v1 });
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.ix);
    g.computeVertexNormals();
    return g;
  }
  mesh(mat) { const m = new THREE.Mesh(this.geometry(), mat); m.matrixAutoUpdate = false; return m; }
}

// ======================================================================================
// Painters
// ======================================================================================
function vSign(g, w, h, text, color, lit) {
  if (lit) {   // backlit plastic box: bright face, dark lettering
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, hot(color, 0.25)); gr.addColorStop(0.5, hot(color, 0.6)); gr.addColorStop(1, hot(color, 0.25));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1a0a12'; g.lineWidth = 5; g.strokeRect(3, 3, w - 6, h - 6);
  } else {
    g.fillStyle = '#0c0710'; g.fillRect(0, 0, w, h);
    neonFrame(g, w, h, color, 7, 4);
  }
  const ch = [...text], pad = w * 0.28, step = (h - 2 * pad) / ch.length, size = Math.min(w * 0.66, step * 0.9);
  ch.forEach((c, k) => {
    const y = pad + (k + 0.5) * step;
    if (lit) { g.font = `900 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1a0610'; g.fillText(c, w / 2, y); }
    else glowText(g, c, w / 2, y, size, color);
  });
}
function hSign(g, w, h, text, color, lit) {
  if (lit) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, hot(color, 0.55)); gr.addColorStop(1, hot(color, 0.15));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = `900 ${fitSize(g, text, h * 0.62, w * 0.88)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#1a0610'; g.fillText(text, w / 2, h * 0.53);
  } else {
    g.fillStyle = '#0b0710'; g.fillRect(0, 0, w, h);
    neonFrame(g, w, h, color, 6, 3);
    glowText(g, text, w / 2, h * 0.53, fitSize(g, text, h * 0.58, w * 0.86), color);
  }
}
function billboard(g, w, h, [title, sub], a, b) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, a); gr.addColorStop(1, b);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.18; g.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) g.fillRect(i * w / 9 + w * 0.02, 0, w * 0.015, h);
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h * 0.72, w, h * 0.28);
  glowText(g, title, w / 2, h * 0.4, fitSize(g, title, h * 0.36, w * 0.9), '#ffffff', { blur: 0.12, core: 0.9 });
  glowText(g, sub, w / 2, h * 0.86, fitSize(g, sub, h * 0.16, w * 0.8), hot(b, 0.6), { blur: 0.2, weight: 800 });
  g.strokeStyle = '#111'; g.lineWidth = 8; g.strokeRect(0, 0, w, h);
}
function vending(g, w, h, color, k) {
  g.fillStyle = hot(color, 0.1); g.fillRect(0, 0, w, h);
  g.fillStyle = '#f4fbff'; g.fillRect(w * 0.08, h * 0.06, w * 0.84, h * 0.5);          // lit display
  const cols = ['#e8322e', '#2d7df0', '#f2c230', '#2fb86b', '#f07a2d', '#8a4bd8'];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
    g.fillStyle = cols[(r * 5 + c + k) % cols.length];
    g.fillRect(w * (0.12 + c * 0.16), h * (0.09 + r * 0.115), w * 0.1, h * 0.08);
    g.fillStyle = '#333'; g.fillRect(w * (0.12 + c * 0.16), h * (0.18 + r * 0.115), w * 0.1, h * 0.012);
  }
  g.fillStyle = '#1a1d22'; g.fillRect(w * 0.08, h * 0.6, w * 0.84, h * 0.08);
  g.fillStyle = '#0d0f12'; g.fillRect(w * 0.15, h * 0.8, w * 0.7, h * 0.12);           // pickup slot
  g.fillStyle = '#9fe8ff'; g.fillRect(w * 0.7, h * 0.62, w * 0.1, h * 0.04);
}

function facadeTile(g, k, x0, W, H, rnd) {
  const bases = ['#16171d', '#1d1a22', '#221b19', '#141a22', '#1b1b1b', '#201822', '#171f1f', '#231d16'];
  g.save(); g.translate(x0, 0);
  g.fillStyle = bases[k]; g.fillRect(0, 0, W, H);
  const FL = 64, GF = 96, style = k % 4;
  const LIT = ['#b8875a', '#d8a868', '#7f9cc0', '#b87898', '#86b8a0', '#d8c088', '#c87040'];   // dim, warm: signs outshine windows
  const PANEL = ['#ff3b3b', '#ffe14a', '#2fb8ff', '#ff5bd8', '#39ff9a', '#ff7a1a', '#ffffff', '#b45cff'];
  for (let f = 0; f < 15; f++) {
    const y1 = H - GF - f * FL, y0 = y1 - FL;
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, y1 - 5, W, 5);
    // lower floors: a tenant's lit sign panel across the floor, now backlit plastic, now neon on black
    if (f < 6 && style !== 1 && rnd() < (style === 3 ? 0.75 : 0.55)) {
      const c = PANEL[(rnd() * PANEL.length) | 0], word = F_WORDS[(rnd() * F_WORDS.length) | 0], pw = W * (0.55 + rnd() * 0.4), px = (W - pw) * rnd();
      if (rnd() < 0.55) {
        g.fillStyle = hot(c, 0.15); g.fillRect(px, y0 + 10, pw, FL - 22);
        g.fillStyle = '#140810'; g.font = `900 ${fitSize(g, word, 30, pw * 0.86)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(word, px + pw / 2, y0 + FL / 2 - 1);
      } else {
        g.fillStyle = '#07050a'; g.fillRect(px, y0 + 10, pw, FL - 22);
        g.strokeStyle = hot(c, 0.3); g.lineWidth = 3; g.shadowColor = c; g.shadowBlur = 10;
        g.strokeRect(px + 4, y0 + 14, pw - 8, FL - 30); g.shadowBlur = 0;
        glowText(g, word, px + pw / 2, y0 + FL / 2 - 1, fitSize(g, word, 30, pw * 0.86), c);
      }
      continue;
    }
    if (style === 1) {   // office: one ribbon window per floor, lit in stretches
      g.fillStyle = '#0a0d14'; g.fillRect(8, y0 + 14, W - 16, FL - 26);
      for (let x = 8; x < W - 8; x += 24) if (rnd() < 0.4) { g.fillStyle = rnd() < 0.7 ? '#8fa8c8' : '#c8b898'; g.fillRect(x + 1, y0 + 15, 22, FL - 28); }
      continue;
    }
    const cols = 3 + (k % 3), cw = (W - 24) / cols;
    for (let c = 0; c < cols; c++) {
      const x = 12 + c * cw + 5, w = cw - 10, y = y0 + 12, h = FL - 24;
      if (rnd() < (style === 3 ? 0.25 : 0.4)) {
        const col = LIT[(rnd() * LIT.length) | 0], gr = g.createLinearGradient(0, y, 0, y + h);
        gr.addColorStop(0, col); gr.addColorStop(1, _c.set(col).multiplyScalar(0.7).getStyle());
        g.fillStyle = gr; g.fillRect(x, y, w, h);
        if (rnd() < 0.4) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let b = y + 3; b < y + h; b += 5) g.fillRect(x, b, w, 2); }   // blinds
      } else {
        g.fillStyle = '#0a0c12'; g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(120,140,190,0.08)'; g.fillRect(x, y, w * 0.4, h);
      }
    }
    if (style === 2) { g.fillStyle = 'rgba(200,200,210,0.16)'; g.fillRect(4, y1 - 16, W - 8, 3); g.fillRect(4, y1 - 9, W - 8, 2); }   // balconies
  }
  if (style === 3) {   // LED strips up the corners
    const c = HOT[k % 3];
    g.shadowColor = c; g.shadowBlur = 10; g.fillStyle = hot(c, 0.4);
    g.fillRect(3, 0, 4, H - GF); g.fillRect(W - 7, 0, 4, H - GF);
    g.shadowBlur = 0;
  }
  // ground floor: lit shop name band, awning, then a glass front full of bright shelves
  const G0 = H - GF;
  const shop = ['#ffb060', '#60c8ff', '#ff70b0', '#ffe070', '#60f0c0', '#ff8050', '#c090ff', '#ff5a5a'][k];
  const name = ['ラーメン 一番', 'カラオケ', 'ゲームセンター', '居酒屋 灯', 'ドラッグ 薬', '牛丼 24時間', 'たこ焼 大玉', '古着 USED'][k];
  g.fillStyle = _c.set(shop).multiplyScalar(0.4).getStyle(); g.fillRect(0, G0, W, 26);
  g.fillStyle = '#fff6e6'; g.font = `900 ${fitSize(g, name, 22, W * 0.8)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, W / 2, G0 + 14);
  const aw = ['#b0102a', '#16704f', '#1b4194', '#b88a00', '#6a1a94'][k % 5];
  for (let x = 0; x < W; x += 16) { g.fillStyle = (x / 16) % 2 ? aw : '#8a847e'; g.fillRect(x, G0 + 26, 16, 12); }
  const gr = g.createLinearGradient(0, G0 + 38, 0, H);
  gr.addColorStop(0, _c.set(shop).multiplyScalar(0.3).getStyle()); gr.addColorStop(1, _c.set(shop).multiplyScalar(0.05).getStyle());
  g.fillStyle = gr; g.fillRect(6, G0 + 38, W - 12, GF - 38);
  g.fillStyle = '#fff4d8';
  for (let x = 14; x < W - 14; x += 30) g.fillRect(x, G0 + 40, 16, 2);                     // ceiling lights
  const goods = ['#ff3b3b', '#ffe14a', '#2fb8ff', '#ffffff', '#39ff9a', '#ff5bd8'];
  for (let n = 0; n < 60; n++) {                                                             // packed shelves
    g.fillStyle = goods[(rnd() * goods.length) | 0];
    g.globalAlpha = 0.35 + rnd() * 0.4; g.fillRect(10 + rnd() * (W - 24), G0 + 46 + ((rnd() * 4) | 0) * 9, 3 + rnd() * 6, 5);
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(8,4,8,0.75)';
  for (let x = 20; x < W - 30; x += 46 + ((x * 7) % 20)) g.fillRect(x, G0 + 66 + (x % 3) * 3, 7, 22 - (x % 3) * 3);   // shoppers
  g.fillStyle = '#0c0b0e';
  for (let x = 6; x < W; x += 50) g.fillRect(x, G0 + 38, 4, GF - 38);                       // mullions
  g.fillRect(0, H - 8, W, 8);
  g.restore();
}

// ======================================================================================
// Shared portal gate (also used by abilities.js for the gates in the main world)
// ======================================================================================
let swirl = null;
function swirlTex() {
  if (swirl) return swirl;
  const c = canvas(256, 256), g = c.getContext('2d');
  const core = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  core.addColorStop(0, 'rgba(255,255,255,0.95)'); core.addColorStop(0.25, 'rgba(255,255,255,0.35)'); core.addColorStop(0.9, 'rgba(255,255,255,0.12)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  for (let arm = 0; arm < 7; arm++) {
    for (let r = 8; r < 124; r += 2) {
      const a = arm / 7 * Math.PI * 2 + r * 0.045, a2 = a + 0.05;
      g.strokeStyle = `rgba(255,255,255,${0.55 * (1 - r / 130)})`;
      g.lineWidth = 2 + r * 0.06;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); g.lineTo(128 + Math.cos(a2) * (r + 2), 128 + Math.sin(a2) * (r + 2)); g.stroke();
    }
  }
  return (swirl = tex(c));
}

// Neon ring gate facing +Z (rotate it to a heading). userData: spin(t), fade(opacity), dispose()
export function makePortal(radius, colors = ['#ff8a1f', '#ff2f9e', '#19f0e0']) {
  const mat = (color, extra) => new THREE.MeshBasicMaterial({
    color, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.05, 10, 72), mat(colors[0]));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.08, radius * 0.02, 6, 72), mat(colors[2]));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.97, 48), mat(colors[1], { map: swirlTex(), side: THREE.DoubleSide }));
  const g = new THREE.Group();
  g.add(disc, halo, ring);
  const parts = [ring, halo, disc];
  g.userData.spin = t => { disc.rotation.z = -t * 3; halo.rotation.z = t * 0.7; };
  g.userData.fade = o => { ring.material.opacity = o; halo.material.opacity = o * 0.9; disc.material.opacity = o * 0.8; };
  g.userData.dispose = () => { for (const m of parts) { m.geometry.dispose(); m.material.dispose(); } };
  return g;
}

// wet-asphalt reflection streaks (the city theme's technique): each light leaves a streak on the floor plane where it
// mirrors toward the camera, spread along the camera->light line so it depth-tests like the road. Local coordinates.
// gfloor = (floor y, 1 if indoor): each light mirrors on its own floor, and only the set (street / garage) the camera is in shows
const GLINT_VS = `attribute vec3 hcol; attribute float gsize; attribute vec2 corner; attribute vec2 gfloor; uniform float uIndoor; uniform vec3 uOrigin;
  varying vec3 vC; varying vec2 vQ;
  void main(){ vec3 cam = cameraPosition - uOrigin; float floorY = gfloor.x, hc = cam.y - floorY, hl = position.y - floorY;
    vec2 dv = position.xz - cam.xz; float D = max(length(dv), 0.01); vec2 dir = dv / D, rt = vec2(-dir.y, dir.x);
    float dp = D * hc / max(hc + hl, 0.01);
    float ok = step(0.3, hc) * step(1.0, hl);
    float along = corner.y < 0.0 ? corner.y * dp * 0.35 : corner.y * (D - dp) * 0.75;
    vec2 xz = cam.xz + dir * (dp + along) + rt * corner.x * dp * (0.014 + gsize * 0.003);
    vQ = corner;
    vC = hcol * ok * (1.0 - abs(gfloor.y - uIndoor)) * (1.0 - smoothstep(50.0, 140.0, D)) * smoothstep(3.0, 9.0, dp);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(xz.x, floorY + 0.03, xz.y, 1.0); }`;
const GLINT_FS = `varying vec3 vC; varying vec2 vQ;
  void main(){ float t = 1.0 - abs(vQ.y), a = (exp(-vQ.x * vQ.x * 5.0) - 0.0067) * t * t * (vQ.y > 0.0 ? 1.0 : t);
    gl_FragColor = vec4(vC * max(a, 0.0), 1.0);
    #include <colorspace_fragment>
  }`;
// neon haze: soft camera-facing glow round each sign, faded in close and far away (the film's wet, bloomy air)
const HAZE_VS = `attribute vec3 hcol; attribute float hsize; attribute vec2 corner; varying vec3 vC; varying vec2 vQ;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); mv.xy += corner * hsize; vQ = corner;
    float d = -mv.z; vC = hcol * smoothstep(2.0, 9.0, d) * (1.0 - smoothstep(70.0, 150.0, d));
    gl_Position = projectionMatrix * mv; }`;
const HAZE_FS = `varying vec3 vC; varying vec2 vQ;
  void main(){ float r = 1.0 - dot(vQ, vQ); if (r <= 0.0) discard; gl_FragColor = vec4(vC * r * r, 1.0);
    #include <colorspace_fragment>
  }`;

// ======================================================================================
// Build
// ======================================================================================
function build(race) {
  const P = makePath(), { S, N, L, segs } = P;
  const track = makeTrack(P);
  const rnd = seeded(20260925);
  const pick = a => a[(rnd() * a.length) | 0];
  const group = new THREE.Group();
  group.name = 'tokyo-dive';
  group.position.copy(ORIGIN);
  const seg = z => segs.find(q => q.zone === z);
  const hel = seg('helix'), gar = seg('garage'), ext = seg('exit'), corner1 = segs[3];
  const iAt = track.iAt;
  const at = (i, lat, dy = 0) => new THREE.Vector3(S[i].lx + S[i].right.x * lat, S[i].ly + dy, S[i].lz + S[i].right.z * lat);
  const A = S[hel.i0], C = new THREE.Vector3(A.lx + A.right.x * R_HELIX, 0, A.lz + A.right.z * R_HELIX);
  const inShell = (p, m = 0) => Math.hypot(p.x - C.x, p.z - C.z) < SHELL + m;
  const exitS = L - 5;
  const lights = [];   // light sources: glints on the wet road + point-light anchors  { p, c, size, k, s, I, floor: y of the floor it mirrors on (null: street) }
  const light = (p, color, size, k, s, I = 0, floor = null) => lights.push({ p: p.clone(), c: new THREE.Color(color), size, k, s, I, floor });
  const face = (i, sg) => S[i].right.clone().multiplyScalar(-sg);   // toward the road from side sg

  // ---------------- textures ----------------
  const SA = makeAtlas(2048, 2048);
  const strip = {};
  for (const c of [...HOT, ...MORE]) strip[c] = SA.add(8, 64, (g, w, h) => { g.fillStyle = hot(c, 0.35); g.fillRect(0, 0, w, h); });
  const dark = SA.add(16, 16, g => { g.fillStyle = '#0d0b12'; g.fillRect(0, 0, 16, 16); });
  const vSigns = V_WORDS.map((w, k) => {
    const color = k % 4 < 3 ? HOT[k % 3] : MORE[k % MORE.length], lit = k % 5 === 1, len = 4 + (k * 7) % 5;
    return { w, color, lit, len };
  });
  // tallest first: the shelves stay even and the whole set still fits the 2048 sheet
  [...vSigns].sort((a, b) => b.len - a.len).forEach(d => { d.rect = SA.add(76, d.len * 64, (g, W, H) => vSign(g, W, H, d.w, d.color, d.lit)); });
  const hSigns = H_WORDS.map((w, k) => {
    const color = k % 3 < 2 ? HOT[(k + 1) % 3] : MORE[k % MORE.length], lit = k % 4 === 2;
    const wm = clamp(2.6 + [...w].length * 0.62, 4, 9), hm = 1.3;
    return { rect: SA.add(wm * 64, hm * 64, (g, W, H) => hSign(g, W, H, w, color, lit)), color, w: wm, h: hm };
  });
  const bills = BILLS.map((b, k) => {
    const a = HOT[k % 3], c = MORE[(k * 3) % MORE.length];
    return { rect: SA.add(480, 240, (g, W, H) => billboard(g, W, H, b, _c.set(a).multiplyScalar(0.8).getStyle(), c)), color: a };
  });
  const vends = ['#e8322e', '#2d7df0', '#f4f4f4'].map((c, k) => SA.add(64, 128, (g, W, H) => vending(g, W, H, c, k)));
  const arch = SA.add(896, 112, (g, W, H) => { hSign(g, W, H, 'ネオン通り 商店街', '#ff7a1a', false); });
  const pSign = SA.add(256, 256, (g, W, H) => {
    g.fillStyle = '#06122e'; g.fillRect(0, 0, W, H); neonFrame(g, W, H, '#2f8bff', 10, 8);
    glowText(g, 'P', W / 2, H * 0.54, H * 0.78, '#3d9bff', { font: 'Arial, sans-serif' });
  });
  const garageSign = SA.add(512, 128, (g, W, H) => hSign(g, W, H, '駐車場 PARKING', '#2fb8ff', true));
  const vacant = SA.add(96, 96, (g, W, H) => { g.fillStyle = '#041a0c'; g.fillRect(0, 0, W, H); glowText(g, '空', W / 2, H / 2, 70, '#39ff9a'); });
  const lvl = t => SA.add(192, 96, (g, W, H) => { g.fillStyle = '#e6e2d4'; g.fillRect(0, 0, W, H); g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1b4fb5'; g.fillText(t, W / 2, H / 2 + 2); });
  const lv1 = lvl('1F'), lvB1 = lvl('B1F');
  const slow = SA.add(192, 96, (g, W, H) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, W, H); g.font = `900 60px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#111'; g.fillText('徐行', W / 2, H / 2 + 2); });
  const exitSign = SA.add(448, 96, (g, W, H) => { g.fillStyle = '#06341a'; g.fillRect(0, 0, W, H); glowText(g, '出口 EXIT →', W / 2, H / 2, 56, '#39ff9a', { blur: 0.2 }); });
  const gateCap = SA.add(640, 96, (g, W, H) => { g.fillStyle = '#0b0710'; g.fillRect(0, 0, W, H); neonFrame(g, W, H, '#ff2f9e', 5, 3); glowText(g, '異空間 TOKYO DIVE', W / 2, H / 2, 54, '#ff7a1a'); });
  const walk = SA.add(32, 48, (g, W, H) => { g.fillStyle = '#041208'; g.fillRect(0, 0, W, H); glowText(g, '●', W / 2, H / 2, 26, '#39ff9a'); });
  const signTex = tex(SA.c);
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });

  // buildings: 8 tiles of 12 m x 48 m
  const FA = canvas(2048, 1024), fg = FA.getContext('2d');
  for (let k = 0; k < 8; k++) facadeTile(fg, k, k * 256, 256, 1024, rnd);
  noise(fg, 2048, 1024, 10);
  const facadeTex = tex(FA);
  const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, emissiveMap: facadeTex, emissive: 0xffffff, emissiveIntensity: 0.95, roughness: 0.85 });
  const tileU = k => [k / 8 + 0.5 / 2048, (k + 1) / 8 - 0.5 / 2048];

  // night city reflected in everything wet: equirect, neon smears along the horizon
  // (a wall of lit buildings up to ~40 degrees, so the smooth puddles mirror signs instead of black sky)
  const EC = canvas(1024, 512), eg = EC.getContext('2d');
  const sky = eg.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#020106'); sky.addColorStop(0.3, '#1a0a24'); sky.addColorStop(0.5, '#4a1a48'); sky.addColorStop(0.53, '#120812'); sky.addColorStop(1, '#050306');
  eg.fillStyle = sky; eg.fillRect(0, 0, 1024, 512);
  for (let x = 0; x < 1024;) {
    const w = 14 + rnd() * 40, top = 140 + rnd() * 90;
    eg.fillStyle = `rgb(${14 + rnd() * 14},${10 + rnd() * 10},${18 + rnd() * 16})`; eg.fillRect(x, top, w, 256 - top);
    for (let y = top + 4; y < 250; y += 6) for (let wx = x + 2; wx < x + w - 3; wx += 5) {
      if (rnd() < 0.3) { eg.fillStyle = pick(['#c8905a', '#e0b070', '#8fa8d0', '#d890b0']); eg.fillRect(wx, y, 3, 3); }
    }
    x += w + 1;
  }
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 1024, y = 150 + rnd() * 106, v = rnd() < 0.4, w = v ? 3 + rnd() * 5 : 8 + rnd() * 26, h = v ? 12 + rnd() * 30 : 3 + rnd() * 8, c = rnd() < 0.6 ? HOT[i % 3] : pick(MORE);
    eg.shadowColor = c; eg.shadowBlur = 10; eg.fillStyle = hot(c, 0.3); eg.fillRect(x, y, w, h);
  }
  eg.shadowBlur = 0;
  const envTex = tex(EC);
  envTex.mapping = THREE.EquirectangularReflectionMapping;

  // road: repeating 13 m x 8 m tile + puddle roughness
  const RC = canvas(256, 512), rg = RC.getContext('2d');
  rg.fillStyle = '#17181d'; rg.fillRect(0, 0, 256, 512);
  noise(rg, 256, 512, 16);
  for (let i = 0; i < 300; i++) { rg.fillStyle = `rgba(0,0,0,${rnd() * 0.18})`; rg.fillRect(rnd() * 256, rnd() * 512, 2 + rnd() * 6, 2 + rnd() * 9); }
  rg.fillStyle = 'rgba(0,0,0,0.22)'; rg.fillRect(256 * 0.26, 0, 26, 512); rg.fillRect(256 * 0.64, 0, 26, 512);   // tyre-polished lanes
  rg.fillStyle = '#cfd0d2'; rg.fillRect(256 * 0.03, 0, 4, 512); rg.fillRect(256 * 0.97 - 4, 0, 4, 512);
  rg.fillRect(126, 0, 4, 256);
  const roadTex = tex(RC, { repeat: true });
  const RR = canvas(128, 256), rr = RR.getContext('2d');
  rr.fillStyle = 'rgb(110,110,110)'; rr.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 128, y = rnd() * 256, r = 6 + rnd() * 22, gr = rr.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgb(40,40,40)'); gr.addColorStop(0.7, 'rgba(40,40,40,0.8)'); gr.addColorStop(1, 'rgba(40,40,40,0)');
    for (const dy of [-256, 0, 256]) { rr.fillStyle = gr; rr.save(); rr.translate(0, dy); rr.fillRect(x - r, y - r, 2 * r, 2 * r); rr.restore(); }
  }
  rr.fillStyle = 'rgb(20,20,20)'; rr.fillRect(0, 0, 10, 256); rr.fillRect(118, 0, 10, 256);   // gutters
  const roughTex = tex(RR, { repeat: true, srgb: false });
  const wet = (map, extra) => new THREE.MeshStandardMaterial({ map, roughnessMap: roughTex, roughness: 1, metalness: 0.05, envMap: envTex, envMapIntensity: 1.25, ...extra });
  const roadMat = wet(roadTex);

  // sidewalk paving with a yellow tactile strip (2 m tile)
  const WC = canvas(128, 128), wg = WC.getContext('2d');
  wg.fillStyle = '#34343c'; wg.fillRect(0, 0, 128, 128);
  wg.strokeStyle = '#1f1f25'; wg.lineWidth = 2;
  for (let p = 0; p <= 128; p += 19) { wg.beginPath(); wg.moveTo(p, 0); wg.lineTo(p, 128); wg.moveTo(0, p); wg.lineTo(128, p); wg.stroke(); }
  wg.fillStyle = '#b89a1c'; wg.fillRect(40, 0, 18, 128);
  noise(wg, 128, 128, 14);
  const walkMat = wet(tex(WC, { repeat: true }), { envMapIntensity: 0.7 });

  // ---------------- batches ----------------
  const B = { sign: new Batch(), facade: new Batch(), road: new Batch(), walk: new Batch(), floor: new Batch(), ceil: new Batch(), gwall: new Batch() };

  // ---------------- street road + sidewalks ----------------
  const outdoor = i => !INDOOR.has(S[i].zone) && S[i].zone !== 'cross';
  for (let i = 0; i < N - 1; i++) {
    if (!outdoor(i) || !outdoor(i + 1)) continue;
    const a = S[i], b = S[i + 1];
    B.road.quad(at(i, -W2, 0.02), at(i, W2, 0.02), at(i + 1, W2, 0.02), at(i + 1, -W2, 0.02), { u0: 0, u1: 1, v0: a.s / 8, v1: b.s / 8 });
    for (const sg of [-1, 1]) {
      const [l0, l1] = sg < 0 ? [-FAC, -W2] : [W2, FAC];
      B.walk.quad(at(i, l0, 0.1), at(i, l1, 0.1), at(i + 1, l1, 0.1), at(i + 1, l0, 0.1), { u0: 0, u1: 1, v0: a.s / 2, v1: b.s / 2 });
      B.walk.wall(at(i, sg * W2), at(i + 1, sg * W2), 0, 1, 0, 0.1, 0, 0.05, face(i, sg));   // curb face
    }
  }

  // ---------------- facades along the path ----------------
  const lanterns = [], poles = [], wires = [];
  const signFacing = (i, sg, lat, y, d, len, color) => {   // vertical box sign sticking out of the facade
    const n = S[i].tan.clone().setY(0).normalize(), c = at(i, sg * lat, y);
    B.sign.card(c.clone().addScaledVector(n, -0.18), n.clone().negate(), 1.2, len, d.rect);
    B.sign.card(c.clone().addScaledVector(n, 0.18), n, 1.2, len, d.rect);
    B.sign.card(at(i, sg * (lat - 0.6), y), face(i, sg), 0.36, len, strip[color] || dark);
  };
  for (const sg of [1, -1]) {
    const ok = i => (S[i].zone === 'street' || S[i].zone === 'alley') && !inShell(at(i, sg * FAC), 1.5);
    let i = 0, lastH = 0;
    while (i < N - 1) {
      if (!ok(i)) { i++; lastH = 0; continue; }
      let e = i;
      while (e < N - 1 && ok(e + 1)) e++;
      // run i..e: blocks of 9-16 m
      let b0 = i;
      while (b0 < e) {
        const want = 9 + rnd() * 7;
        let b1 = b0;
        while (b1 < e && S[b1].s - S[b0].s < want) b1++;
        if (e - b1 < 8) b1 = e;   // no sliver at the end of a run
        const tile = (rnd() * 8) | 0, [ua, ub] = tileU(tile), sb = S[b0].s, Lb = Math.max(1, S[b1].s - sb);
        const alley = S[b0].zone === 'alley';
        let h = alley ? 8 + rnd() * 9 : 14 + rnd() * 24;
        if (Math.abs(S[b0].s - PZ.z0) < 14 || Math.abs(S[b0].s - PZ.z1) < 14) h = 30 + rnd() * 14;   // taller round the crossing
        if (S[b0].s >= S[corner1.i0].s - 4 && S[b0].s <= S[corner1.i1].s && sg < 0) h = Math.max(h, 30);   // screen at the apex
        const u = s => { const f = (s - sb) / Lb; return ua + (sg > 0 ? 1 - f : f) * (ub - ua); };
        for (let j = b0; j < b1; j += 4) {
          const k = Math.min(b1, j + 4);
          B.facade.wall(at(j, sg * FAC), at(k, sg * FAC), u(S[j].s), u(S[k].s), -0.3, h, 0, h / 48, face(j, sg));
        }
        // step face toward a lower neighbour
        if (lastH && Math.abs(lastH - h) > 1) {
          const n = S[b0].tan.clone().setY(0).normalize().multiplyScalar(h > lastH ? -1 : 1);
          B.facade.wall(at(b0, sg * FAC), at(b0, sg * (FAC + 10)), ua, ua + (ub - ua) * 0.8, Math.min(h, lastH), Math.max(h, lastH), Math.min(h, lastH) / 48, Math.max(h, lastH) / 48, n);
        }
        lastH = h;
        // signs on this block
        const pickS = () => Math.min(b1, b0 + 2 + ((rnd() * Math.max(1, b1 - b0 - 4)) | 0));
        // vertical signs spread along the block, often stacked into a column of two (Center-gai)
        const nV = alley ? 1 + (rnd() < 0.4 ? 1 : 0) : 2 + (rnd() < 0.5 ? 1 : 0) + (rnd() < 0.25 ? 1 : 0);
        for (let q = 0; q < nV; q++) {
          const j = Math.min(b1, b0 + Math.round((q + 0.3 + 0.4 * rnd()) / nV * (b1 - b0)));
          let yb = 4.6 + rnd() * Math.max(0, Math.min(6, h - 14));
          for (let tier = 0; tier < 2; tier++) {
            const d = pick(vSigns);
            if (yb + d.len > h - 0.5) break;
            signFacing(j, sg, FAC - 0.6, yb + d.len / 2, d, d.len, d.color);
            light(at(j, sg * (FAC - 0.6), yb + d.len / 2), d.color, 1.4, 0.3, S[j].s, 22);
            yb += d.len + 0.4;
            if (rnd() < 0.55) break;
          }
        }
        const nH = rnd() < 0.8 ? 1 + (rnd() < 0.45 && h > 16 ? 1 : 0) : 0;
        for (let q = 0; q < nH; q++) {
          const d = pick(hSigns), j = Math.round(b0 + (b1 - b0) * (nH > 1 ? 0.3 + q * 0.4 : 0.5)), y = q ? 11 + rnd() * Math.max(0, h - 15) : 5.4 + rnd() * 2;
          if (Lb > d.w + 1 && y < h - 1) {
            B.sign.card(at(j, sg * (FAC - 0.05), y), face(j, sg), d.w, d.h, d.rect);
            light(at(j, sg * (FAC - 0.2), y), d.color, d.w * 0.5, 0.22, S[j].s, 18);
          }
        }
        if (!alley && Lb > 9 && rnd() < 0.6) {   // rooftop billboard
          const d = pick(bills), j = Math.round((b0 + b1) / 2);
          B.sign.card(at(j, sg * (FAC + 1.5), h + 3), face(j, sg), 9, 4.5, d.rect);
          light(at(j, sg * (FAC + 1.5), h + 3), d.color, 4, 0.12, S[j].s);
        }
        if (!alley && rnd() < 0.3) {   // vending machines, recessed into the shop front
          const j0 = pickS(), n = 2 + ((rnd() * 2) | 0);
          for (let q = 0; q < n; q++) {
            const j = Math.min(b1, j0 + q * 2);
            const c = at(j, sg * (FAC - 0.22), 0.95);
            B.sign.card(c, face(j, sg), 0.92, 1.9, pick(vends));
          }
          light(at(j0, sg * (FAC - 0.3), 1.2), '#e8f6ff', 1.2, 0.35, S[j0].s);
        }
        if (alley || rnd() < 0.25) {   // izakaya lanterns along the front
          const j0 = pickS(), n = 4 + ((rnd() * 4) | 0);
          for (let q = 0; q < n; q++) {
            const j = Math.min(b1, j0 + q * 3);
            lanterns.push({ p: at(j, sg * (FAC - 0.45), 3.3), c: rnd() < 0.8 ? '#ff3020' : '#fff0dc', s: 1 });
          }
          light(at(Math.min(b1, j0 + n), sg * (FAC - 0.45), 3.3), '#ff4020', 1.2, 0.35, S[j0].s, 14);
        }
        b0 = b1;
      }
      i = e + 1;
      lastH = 0;
    }
  }
  // utility poles every 24 m, wires along both sides and now and then across
  const poleAt = [];
  for (let s = 14, side = 1; s < S[gar.i0].s - 10; s += 24, side = -side) {
    const i = iAt(s);
    if (!outdoor(i)) continue;
    for (const sg of [1, -1]) {
      const p = at(i, sg * 8.25);
      if (inShell(p, 3)) continue;
      poles.push({ p, h: S[i].h });
      poleAt.push({ sg, s, top: p.clone().setY(8.8), i });
    }
  }
  for (const sg of [1, -1]) {
    const ps = poleAt.filter(q => q.sg === sg);
    for (let k = 0; k + 1 < ps.length; k++) for (const dy of [0, -0.45, 0.4]) wires.push([ps[k].top.clone().setY(ps[k].top.y + dy), ps[k + 1].top.clone().setY(ps[k + 1].top.y + dy), 0.7]);
  }
  for (let k = 0; k < poleAt.length; k += 4) {
    const o = poleAt.find(q => q.s === poleAt[k].s && q.sg !== poleAt[k].sg);
    if (o) wires.push([poleAt[k].top.clone().setY(8.4), o.top.clone().setY(8.4), 0.6]);
  }
  // lantern strings across the alley
  {
    const al = segs.filter(q => q.zone === 'alley');
    for (const q of al) {
      for (let s = S[q.i0].s + 3; s < S[q.i1].s - 2; s += 7) {
        const i = iAt(s);
        for (let k = 0; k <= 8; k++) {
          const lat = -7.6 + k * 1.9, sag = 0.9 * (1 - (lat / 7.6) ** 2);
          lanterns.push({ p: at(i, lat, 6.6 - sag), c: k % 2 ? '#ff3020' : '#ffb040', s: 0.8 });
        }
        wires.push([at(i, -8.4, 6.9), at(i, 8.4, 6.9), 1.0]);
        light(at(i, 0, 6.2), '#ff5a20', 3, 0.18, s, 12);
      }
    }
  }
  // arch sign over the entry street
  {
    const i = iAt(20), n = S[i].tan.clone().setY(0).normalize();
    B.sign.card(at(i, 0, 7.4).addScaledVector(n, -0.12), n.clone().negate(), 14, 1.75, arch);
    B.sign.card(at(i, 0, 7.4).addScaledVector(n, 0.12), n, 14, 1.75, arch);
    B.sign.card(at(i, 0, 8.3).addScaledVector(n, -0.13), n.clone().negate(), 14, 0.12, strip['#ff7a1a']);
    for (const sg of [1, -1]) poles.push({ p: at(i, sg * 8.25), h: S[i].h, arch: true });
    light(at(i, 0, 7.4), '#ff7a1a', 6, 0.3, 20, 30);
  }
  // back wall behind the entry gate + the gate itself
  const entryGate = makePortal(4.4);
  {
    const [ua, ub] = tileU(5);
    B.facade.wall(at(0, -FAC), at(0, FAC), ua, ub, -0.3, 26, 0, 26 / 48, S[0].tan.clone().setY(0));
    const gi = iAt(GATE_S);
    entryGate.position.copy(at(gi, 0, 4.4));
    entryGate.rotation.y = S[gi].h;
    group.add(entryGate);
    B.sign.card(at(gi, 0, 9.6).addScaledVector(S[gi].tan, -0.05), S[gi].tan.clone().setY(0).negate(), 8, 1.2, gateCap);
    light(at(gi, 0, 4.4), '#ff7a1a', 5, 0.3, GATE_S + 6, 40);
  }

  // ---------------- scramble crossing ----------------
  const PC = canvas(2048, 512), pg = PC.getContext('2d'), PW = 2 * PZ.end, PD = PZ.z1 - PZ.z0;
  const px = x => (PZ.end - x) / PW * 2048, pz = z => (PZ.z1 - z) / PD * 512;   // canvas coords of local (x, z)
  pg.fillStyle = '#16171c'; pg.fillRect(0, 0, 2048, 512);
  noise(pg, 2048, 512, 14);
  pg.fillStyle = '#2e2e35';   // sidewalks along the cross road
  for (const sx of [1, -1]) {
    const x0 = px(sx * PZ.x), x1 = px(sx * PZ.end);
    for (const [z0, z1] of [[PZ.zc - PZ.side, PZ.zc - PZ.rw], [PZ.zc + PZ.rw, PZ.zc + PZ.side], [PZ.z0, PZ.zc - PZ.side], [PZ.zc + PZ.side, PZ.z1]]) pg.fillRect(Math.min(x0, x1), pz(z1), Math.abs(x1 - x0), pz(z0) - pz(z1));
  }
  const zebra = (x0, z0, x1, z1, width) => {   // crosswalk from (x0,z0) to (x1,z1): bars across the walking line
    const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
    pg.fillStyle = 'rgba(232,232,232,0.92)';
    const ex = -dx * 0.45 * 2048 / PW, ez = -dz * 0.45 * 512 / PD;   // bar thickness along the walk, in canvas px
    for (let d = 0.3; d < len - 0.3; d += 0.9) {
      const cx = x0 + dx * d, cz = z0 + dz * d, a = [px(cx - dz * width / 2), pz(cz + dx * width / 2)], b = [px(cx + dz * width / 2), pz(cz - dx * width / 2)];
      pg.beginPath(); pg.moveTo(a[0], a[1]); pg.lineTo(b[0], b[1]); pg.lineTo(b[0] + ex, b[1] + ez); pg.lineTo(a[0] + ex, a[1] + ez); pg.closePath(); pg.fill();
    }
  };
  zebra(-PZ.x + 2, PZ.z0 + 2.5, PZ.x - 2, PZ.z0 + 2.5, 4);
  zebra(-PZ.x + 2, PZ.z1 - 2.5, PZ.x - 2, PZ.z1 - 2.5, 4);
  zebra(PZ.x - 2.5, PZ.zc - PZ.rw + 1, PZ.x - 2.5, PZ.zc + PZ.rw - 1, 4);
  zebra(-PZ.x + 2.5, PZ.zc - PZ.rw + 1, -PZ.x + 2.5, PZ.zc + PZ.rw - 1, 4);
  zebra(-PZ.x + 6, PZ.z0 + 6, PZ.x - 6, PZ.z1 - 6, 4);
  zebra(PZ.x - 6, PZ.z0 + 6, -PZ.x + 6, PZ.z1 - 6, 4);
  pg.fillStyle = '#e8e8e8';
  for (const sx of [1, -1]) {
    pg.fillRect(px(sx * PZ.x) - 3, pz(PZ.zc + PZ.rw), 6, pz(PZ.zc - PZ.rw) - pz(PZ.zc + PZ.rw));   // stop lines
    for (let x = PZ.x + 3; x < PZ.end; x += 6) pg.fillRect(Math.min(px(sx * x), px(sx * (x + 3))), pz(PZ.zc) - 2, Math.abs(px(sx * (x + 3)) - px(sx * x)), 4);
  }
  pg.fillStyle = '#e6b422';
  for (const sx of [1, -1]) pg.fillRect(Math.min(px(sx * PZ.x), px(sx * PZ.end)), pz(PZ.zc) - 9, Math.abs(px(sx * PZ.end) - px(sx * PZ.x)), 3);
  const plazaRough = roughTex.clone();
  plazaRough.repeat.set(PW / 13, PD / 8);
  const plazaMat = wet(tex(PC), { roughnessMap: plazaRough });
  B.plaza = new Batch();
  B.plaza.quad(new THREE.Vector3(PZ.end, 0.02, PZ.z0), new THREE.Vector3(-PZ.end, 0.02, PZ.z0), new THREE.Vector3(-PZ.end, 0.02, PZ.z1), new THREE.Vector3(PZ.end, 0.02, PZ.z1), { u0: 0, u1: 1, v0: 0, v1: 1 });

  // buildings round the crossing: box corners, the cross road's fronts and its two end walls
  const V3 = (x, z) => new THREE.Vector3(x, 0, z);
  const blockFront = (a, b, h, facing, k = (rnd() * 8) | 0) => { const [ua, ub] = tileU(k); B.facade.wall(a, b, ua, ub, -0.3, h, 0, h / 48, facing); };
  const toBox = p => new THREE.Vector3(-p.x, 0, PZ.zc - p.z).normalize();
  const plazaSigns = (a, b, h, facing, count, sVal) => {   // signs on a front a->b (facing the plaza or the cross road)
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    d.normalize();
    for (let q = 0; q < count; q++) {
      const f = (q + 0.5) / count, p = a.clone().addScaledVector(d, len * f);
      if (rnd() < 0.6) {
        const s = pick(vSigns), yb = 5 + rnd() * 4;
        if (yb + s.len < h - 1) {
          const c = p.clone().addScaledVector(facing, 0.6).setY(yb + s.len / 2);
          B.sign.card(c.clone().addScaledVector(d, 0.18), d, 1.2, s.len, s.rect);
          B.sign.card(c.clone().addScaledVector(d, -0.18), d.clone().negate(), 1.2, s.len, s.rect);
          B.sign.card(c.clone().addScaledVector(facing, 0.6), facing, 0.36, s.len, strip[s.color] || dark);
          light(c, s.color, 1.4, 0.3, sVal, 20);
        }
      } else {
        const s = pick(hSigns);
        if (s.w < len * 0.9) {
          const c = p.clone().addScaledVector(facing, 0.05).setY(3.3 + (rnd() < 0.5 ? 0 : 4 + rnd() * 5));
          B.sign.card(c, facing, s.w, s.h, s.rect);
          light(c, s.color, s.w * 0.5, 0.22, sVal, 16);
        }
      }
    }
  };
  for (const sx of [1, -1]) {
    const hS = 36 + rnd() * 10, hN = 38 + rnd() * 10;
    blockFront(V3(sx * FAC, PZ.z0), V3(sx * PZ.x, PZ.z0), hS, new THREE.Vector3(0, 0, 1));
    blockFront(V3(sx * PZ.x, PZ.z0), V3(sx * PZ.x, PZ.zc - PZ.side), hS, new THREE.Vector3(-sx, 0, 0));
    blockFront(V3(sx * FAC, PZ.z1), V3(sx * PZ.x, PZ.z1), hN, new THREE.Vector3(0, 0, -1));
    blockFront(V3(sx * PZ.x, PZ.z1), V3(sx * PZ.x, PZ.zc + PZ.side), hN, new THREE.Vector3(-sx, 0, 0));
    plazaSigns(V3(sx * FAC, PZ.z0), V3(sx * PZ.x, PZ.z0), hS, new THREE.Vector3(0, 0, 1), 2, PZ.z0);
    plazaSigns(V3(sx * PZ.x, PZ.z1), V3(sx * PZ.x, PZ.zc + PZ.side), hN, new THREE.Vector3(-sx, 0, 0), 1, PZ.zc);
    // rooftop billboards on the corner towers, facing the crossing
    const d = pick(bills), c = V3(sx * (PZ.x - 6), PZ.z1 + 2).setY(hN + 4);
    B.sign.card(c, toBox(c), 12, 6, d.rect);
    // cross road fronts
    for (const [z, fz] of [[PZ.zc - PZ.side, 1], [PZ.zc + PZ.side, -1]]) {
      for (let x = PZ.x; x < PZ.end - 0.5;) {
        const w = Math.min(PZ.end - x, 11 + rnd() * 5), h = 14 + rnd() * 20;
        const a = V3(sx * x, z), b = V3(sx * (x + w), z), f = new THREE.Vector3(0, 0, fz);
        blockFront(a, b, h, f);
        plazaSigns(a, b, h, f, rnd() < 0.5 ? 2 : 1, PZ.zc);
        x += w;
      }
    }
    blockFront(V3(sx * PZ.end, PZ.zc - PZ.side), V3(sx * PZ.end, PZ.zc + PZ.side), 34, new THREE.Vector3(-sx, 0, 0));
  }
  // giant screens: two over the far side of the crossing, one at each end of the cross road, one on corner 1's apex
  const SC = canvas(512, 1024), sg2 = SC.getContext('2d');
  const frames = [
    g => { const gr = g.createLinearGradient(0, 0, 512, 256); gr.addColorStop(0, '#ff2f9e'); gr.addColorStop(1, '#4a1aff'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      g.fillStyle = 'rgba(255,255,255,0.25)'; for (let i = 0; i < 14; i++) g.fillRect(0, 20 + i * 17, 512 * (0.3 + 0.7 * ((i * 37) % 10) / 10), 3);
      glowText(g, 'ネオン・グランプリ', 256, 110, 54, '#ffffff', { blur: 0.1 }); glowText(g, '全国大会 開催中', 256, 190, 30, '#ffe14a', { blur: 0.2 }); },
    g => { g.fillStyle = '#070b18'; g.fillRect(0, 0, 512, 256); g.fillStyle = '#ff7a1a'; g.beginPath(); g.moveTo(0, 256); g.lineTo(200, 0); g.lineTo(290, 0); g.lineTo(90, 256); g.fill();
      g.fillStyle = '#19f0e0'; g.beginPath(); g.moveTo(330, 256); g.lineTo(512, 40); g.lineTo(512, 120); g.lineTo(400, 256); g.fill();
      glowText(g, 'トーキョー・ダイブ', 256, 118, 56, '#ffb13b'); glowText(g, 'NEW', 440, 48, 34, '#19f0e0'); },
    g => { g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 18; i++) { const x = 40 + i * 26, r = 30 + (i * 13) % 40, gr = g.createRadialGradient(x, 200, 0, x, 200, r); gr.addColorStop(0, 'rgba(200,200,210,0.35)'); gr.addColorStop(1, 'rgba(200,200,210,0)'); g.fillStyle = gr; g.fillRect(x - r, 200 - r, 2 * r, 2 * r); }
      glowText(g, 'ドリフト王', 256, 100, 96, '#ff7a1a'); glowText(g, '今夜 決定戦', 256, 200, 34, '#ffffff', { blur: 0.15 }); },
    g => { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0fb8c9'); gr.addColorStop(1, '#1a2a8c'); g.fillStyle = gr; g.fillRect(0, 0, 512, 256);
      g.fillStyle = '#fff8e0'; g.beginPath(); g.arc(420, 60, 30, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#05060c'; for (let x = 0; x < 512; x += 22) { const hh = 40 + ((x * 7919) % 90); g.fillRect(x, 256 - hh, 20, hh); }
      glowText(g, '夜の東京へ', 220, 90, 64, '#ffffff', { blur: 0.12 }); },
  ];
  frames.forEach((f, k) => { sg2.save(); sg2.translate(0, k * 256); sg2.beginPath(); sg2.rect(0, 0, 512, 256); sg2.clip(); f(sg2); sg2.restore(); });
  sg2.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 1024; y += 3) sg2.fillRect(0, y, 512, 1);   // scanlines
  const screenSrc = tex(SC), screens = [], screenColors = ['#ff2f9e', '#ff7a1a', '#ff7a1a', '#19f0e0'];
  const screen = (c, n, w, h, phase, sVal) => {
    const t = screenSrc.clone();
    t.repeat.set(1, 0.25);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    m.position.copy(c);
    m.rotation.y = Math.atan2(n.x, n.z);
    group.add(m);
    B.sign.card(c.clone().addScaledVector(n, -0.08), n, w + 0.8, h + 0.8, dark);
    screens.push({ m, t, phase });
    light(c, screenColors[phase % 4], w * 0.45, 0.2, sVal, 60);
  };
  for (const sx of [1, -1]) screen(V3(sx * (FAC + PZ.x) / 2, PZ.z1 - 0.15).setY(15), new THREE.Vector3(0, 0, -1), 13, 7.3, sx > 0 ? 0 : 2, PZ.z1 - 8);
  for (const sx of [1, -1]) screen(V3(sx * (FAC + PZ.x) / 2, PZ.z1 - 0.15).setY(26.5), new THREE.Vector3(0, 0, -1), 13, 7.3, sx > 0 ? 3 : 1, PZ.z1 - 8);   // stacked, Shibuya style
  for (const sx of [1, -1]) screen(V3(sx * (PZ.x - 0.15), PZ.z1 - 4).setY(19), new THREE.Vector3(-sx, 0, 0), 7.2, 4, sx > 0 ? 2 : 0, PZ.z1 - 12);
  for (const sx of [1, -1]) screen(V3(sx * (PZ.end - 0.15), PZ.zc).setY(12), new THREE.Vector3(-sx, 0, 0), 20, 11, sx > 0 ? 1 : 3, PZ.zc);
  { const i = Math.round((corner1.i0 + corner1.i1) / 2); screen(at(i, -(FAC - 0.7), 17), S[i].right.clone(), 14, 7.9, 3, S[i].s - 10); }
  // glowing bollards lining the race lane through the crossing, pedestrian signals on the corners
  const bollards = [];
  for (let z = PZ.z0 + 1; z <= PZ.z1 - 1; z += 2.5) for (const sx of [1, -1]) bollards.push(V3(sx * GW, z));
  for (const sx of [1, -1]) for (const z of [PZ.z0 + 0.8, PZ.z1 - 0.8]) {
    poles.push({ p: V3(sx * (PZ.x - 0.8), z), h: 0, signal: true });
    B.sign.card(V3(sx * (PZ.x - 0.8), z).setY(3.1).add(new THREE.Vector3(0, 0, z < PZ.zc ? 0.2 : -0.2)), new THREE.Vector3(0, 0, z < PZ.zc ? 1 : -1), 0.32, 0.48, walk);
  }
  // the crowd waiting on the corners under umbrellas: dark cut-outs, rim-lit by the neon
  const CW = canvas(512, 128), cw = CW.getContext('2d');
  for (let f = 0; f < 8; f++) {
    const rim = [...HOT, ...MORE][(f * 5) % 11];
    cw.save(); cw.translate(f * 64 + 32, 0);
    cw.shadowColor = rim; cw.shadowBlur = 5; cw.fillStyle = '#0d0a12';
    cw.fillRect(-7, 86, 5, 42); cw.fillRect(2 + (f % 3), 86, 5, 42);                            // legs
    cw.beginPath(); cw.moveTo(-10 - (f % 2) * 2, 48); cw.lineTo(10, 48); cw.lineTo(13, 94); cw.lineTo(-13, 94); cw.closePath(); cw.fill();   // coat
    cw.beginPath(); cw.arc(0, 40, 7, 0, Math.PI * 2); cw.fill();                                 // head
    if (f % 4 !== 3) {                                                                            // umbrella: clear vinyl, black, red, navy
      cw.fillStyle = ['rgba(215,228,255,0.8)', '#141418', '#b01830', '#1b2a6a'][f % 4];
      cw.beginPath(); cw.ellipse(0, 28, 30, 17, 0, Math.PI, 0); cw.fill();
      cw.fillStyle = '#0d0a12'; cw.fillRect(-1, 28, 2, 22);
    }
    cw.restore();
  }
  const crowdMat = new THREE.MeshBasicMaterial({ map: tex(CW), alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
  B.crowd = new Batch();
  const person = (x, z, nx, nz) => {
    const f = (rnd() * 8) | 0, sc = 0.92 + rnd() * 0.16;
    B.crowd.card(V3(x, z).setY(1.1 * sc), new THREE.Vector3(nx, 0, nz).normalize(), 1.1 * sc, 2.2 * sc, { u0: f / 8 + 0.001, u1: (f + 1) / 8 - 0.001, v0: 0, v1: 1 });
  };
  for (const sx of [1, -1]) {
    for (let q = 0; q < 14; q++) person(sx * (10 + rnd() * 11), PZ.z0 + 0.6 + rnd() * 2.6, (rnd() - 0.5) * 0.6, 1);
    for (let q = 0; q < 14; q++) person(sx * (10 + rnd() * 11), PZ.z1 - 0.6 - rnd() * 2.6, (rnd() - 0.5) * 0.6, -1);
    for (const [z0, fz] of [[PZ.zc - PZ.side, 1], [PZ.zc + PZ.rw, -1]]) for (let q = 0; q < 8; q++) person(sx * (26 + rnd() * 26), z0 + 0.4 + rnd() * 1.2, (rnd() - 0.5) * 0.5, fz);
  }

  // ---------------- garage ----------------
  const GF = canvas(256, 256), gf = GF.getContext('2d');   // floor tile: lateral -BAY..+GW across, 10 m along
  const gu = lat => (lat + BAY) / (BAY + GW) * 256;
  gf.fillStyle = '#4a514c'; gf.fillRect(0, 0, 256, 256);
  noise(gf, 256, 256, 18);
  for (let i = 0; i < 14; i++) { const x = rnd() * 256, y = rnd() * 256, r = 4 + rnd() * 14, gr = gf.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(20,22,20,0.45)'); gr.addColorStop(1, 'rgba(20,22,20,0)'); gf.fillStyle = gr; gf.fillRect(x - r, y - r, 2 * r, 2 * r); }
  gf.fillStyle = '#2f6b4f'; gf.fillRect(gu(W2), 0, gu(GW) - gu(W2), 256);   // green walkway
  gf.fillStyle = '#e8c21c'; gf.fillRect(gu(-W2) - 2, 0, 4, 256);
  gf.fillStyle = '#e6e6e0'; gf.fillRect(gu(W2) - 2, 0, 4, 256);
  for (let v = 0; v < 256; v += 64) gf.fillRect(0, v, gu(-GW), 3);        // parking bays, every 2.5 m
  gf.fillRect(0, 0, 3, 256);
  gf.beginPath(); gf.moveTo(gu(0), 40); gf.lineTo(gu(0) + 16, 72); gf.lineTo(gu(0) + 6, 72); gf.lineTo(gu(0) + 6, 110); gf.lineTo(gu(0) - 6, 110); gf.lineTo(gu(0) - 6, 72); gf.lineTo(gu(0) - 16, 72); gf.closePath(); gf.fill();   // arrow
  gf.strokeStyle = 'rgba(10,10,10,0.35)'; gf.lineWidth = 5;
  for (let i = 0; i < 5; i++) { gf.beginPath(); gf.arc(gu(-2 + rnd() * 4), 128, 90 + rnd() * 80, -0.5, 0.5); gf.stroke(); }   // drift marks
  const floorMat = new THREE.MeshStandardMaterial({ map: tex(GF, { repeat: true }), roughness: 0.45, envMap: envTex, envMapIntensity: 0.5 });
  const CC = canvas(128, 128), cg = CC.getContext('2d');    // ceiling tile: mirrored across (u0 at +GW), 6 m along
  cg.fillStyle = '#2a2d2f'; cg.fillRect(0, 0, 128, 128);
  noise(cg, 128, 128, 6);
  cg.fillStyle = '#16181a'; cg.fillRect(0, 0, 128, 14);            // cross beam every 6 m
  cg.fillStyle = 'rgba(255,255,255,0.06)'; cg.fillRect(0, 14, 128, 2);
  for (const lat of [-2.8, 2.8, -10.9]) {
    const x = (GW - lat) / (BAY + GW) * 128, gr = cg.createRadialGradient(x, 64, 0, x, 64, 34);
    gr.addColorStop(0, 'rgba(220,240,255,0.55)'); gr.addColorStop(1, 'rgba(220,240,255,0)');
    cg.fillStyle = gr; cg.fillRect(x - 34, 30, 68, 68);
  }
  const ceilTex = tex(CC, { repeat: true });
  const ceilMat = new THREE.MeshStandardMaterial({ map: ceilTex, emissiveMap: ceilTex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.9 });
  const WLC = canvas(256, 128), wl = WLC.getContext('2d');  // wall: 12 m x 4.2 m
  wl.fillStyle = '#5b605c'; wl.fillRect(0, 0, 256, 128);
  noise(wl, 256, 128, 16);
  wl.fillStyle = '#1f7a4d'; wl.fillRect(0, 128 - 40, 256, 10);
  wl.fillStyle = '#e8e8e2'; wl.fillRect(0, 128 - 30, 256, 3);
  for (let x = -16; x < 256; x += 16) { wl.fillStyle = '#e8c21c'; wl.beginPath(); wl.moveTo(x, 128); wl.lineTo(x + 8, 128); wl.lineTo(x + 16, 119); wl.lineTo(x + 8, 119); wl.fill(); }
  wl.fillStyle = '#141414'; for (let x = -8; x < 256; x += 16) { wl.beginPath(); wl.moveTo(x, 128); wl.lineTo(x + 8, 128); wl.lineTo(x + 16, 119); wl.lineTo(x + 8, 119); wl.fill(); }
  for (let i = 0; i < 6; i++) { wl.fillStyle = 'rgba(30,25,20,0.2)'; wl.fillRect(rnd() * 256, 0, 3 + rnd() * 6, 40 + rnd() * 60); }
  const wallTex = tex(WLC, { repeat: true });
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  const garageFloor = i => INDOOR.has(S[i].zone);
  const gHeight = i => (S[i].zone === 'exit' ? CEIL_EXIT : CEIL);
  const tubes = [];
  for (let i = 0; i < N - 1; i++) {
    if (!garageFloor(i) || !garageFloor(i + 1)) continue;
    const a = S[i], b = S[i + 1], hx = a.zone === 'helix' || b.zone === 'helix', lo = hx ? -BAY : -GW, H = Math.min(gHeight(i), gHeight(i + 1));
    B.floor.quad(at(i, lo, 0.02), at(i, GW, 0.02), at(i + 1, GW, 0.02), at(i + 1, lo, 0.02), { u0: (lo + BAY) / (BAY + GW), u1: 1, v0: a.s / 10, v1: b.s / 10 });
    B.ceil.quad(at(i, GW, H), at(i, lo, H), at(i + 1, lo, H), at(i + 1, GW, H), { u0: 0, u1: (GW - lo) / (BAY + GW), v0: a.s / 6, v1: b.s / 6 });
    // walls: tunnel both sides; helix outer wall beyond the bays and a parapet over the core
    const v0 = a.s / 12, v1 = b.s / 12;
    const wallSeg = (lat, y0, y1) => B.gwall.wall(at(i, lat), at(i + 1, lat), v0, v1, y0, y1, y0 / CEIL, y1 / CEIL, face(i, Math.sign(lat)));
    if (hx) {
      wallSeg(-BAY, -0.3, H);
      wallSeg(GW, -0.45, 1.1);
      B.gwall.wall(at(i, GW + 0.3), at(i + 1, GW + 0.3), v0, v1, -0.45, 1.1, 0, 1.1 / CEIL, S[i].right.clone());   // core side of the parapet
      B.gwall.quad(at(i, GW, 1.1), at(i, GW + 0.3, 1.1), at(i + 1, GW + 0.3, 1.1), at(i + 1, GW, 1.1), { u0: 0, u1: 0.02, v0: 0.9, v1: 0.95 });
      const t = strip['#19f0e0'], o = strip['#ff7a1a'];   // neon lines: along the outer wall, under the parapet rail
      B.sign.wall(at(i, -BAY + 0.04), at(i + 1, -BAY + 0.04), t.u0, t.u1, 2.5, 2.6, t.v0, t.v1, face(i, -1));
      B.sign.wall(at(i, GW - 0.02), at(i + 1, GW - 0.02), o.u0, o.u1, 0.95, 1.02, o.v0, o.v1, face(i, 1));
    } else { wallSeg(-GW, -0.3, H); wallSeg(GW, -0.3, H); }
    if (Math.floor(a.s / 6) !== Math.floor(b.s / 6)) {
      for (const lat of hx ? [-2.8, 2.8, -10.9] : [-2.8, 2.8]) {
        tubes.push({ p: at(i, lat, H - 0.08), h: a.h, flick: tubes.length % 23 === 7 });
        light(at(i, lat, H - 0.08), '#dff0ff', 0.8, 0.16, a.s, 0, a.ly);   // its streak on the sealed concrete
      }
      if (a.zone === 'helix' || a.zone === 'exit' || a.zone === 'garage') light(at(i, 0, H - 0.3), '#d6f7e8', 0, 0, a.s, a.zone === 'exit' ? 10 : 16);
    }
  }
  // caps where the bays begin / end, the dead end past the exit gate
  B.gwall.wall(at(hel.i0, -GW), at(hel.i0, -BAY), 0, 0.4, -0.3, CEIL, 0, 1, S[hel.i0].tan.clone().setY(0));
  B.gwall.wall(at(hel.i1, -GW), at(hel.i1, -BAY), 0, 0.4, -0.3, CEIL, 0, 1, S[hel.i1].tan.clone().setY(0).negate());
  B.gwall.wall(at(N - 1, -GW), at(N - 1, GW), 0, 1.4, -0.3, CEIL_EXIT, 0, 1, S[N - 1].tan.clone().setY(0).negate());
  // columns: at the core parapet and between the bays
  const cols = [];
  for (let s = S[hel.i0].s + 3; s < S[hel.i1].s - 1; s += 7) { const i = iAt(s); cols.push({ p: at(i, GW + 0.15), h: S[i].h }, { p: at(i, -GW - 0.2), h: S[i].h }); }
  // cars parked nose-in, one per 2.5 m bay, some bays empty
  const parked = [], PCOL = ['#d8dade', '#f2f2f0', '#18191c', '#8a1420', '#1d3a78', '#5a5e64', '#c8a040', '#2a2c30'];
  for (let s = S[hel.i0].s + 1.25; s < S[hel.i1].s - 2; s += 2.5) {
    const i = iAt(s), p = at(i, -(GW + BAY) / 2 - 0.1);
    if (rnd() < 0.3 || cols.some(c => c.p.distanceTo(at(i, -GW - 0.2)) < 1.6)) continue;
    parked.push({ p, h: S[i].h + Math.PI / 2 + (rnd() - 0.5) * 0.08, c: pick(PCOL) });
  }
  // garage signage
  B.sign.card(at(iAt(S[hel.i0].s + 4), -BAY + 0.06, 1.9), face(iAt(S[hel.i0].s + 4), -1), 1.6, 0.8, slow);
  B.sign.card(at(iAt(S[hel.i0].s + 20), -BAY + 0.06, 2.2), face(iAt(S[hel.i0].s + 20), -1), 1.6, 0.8, lv1);
  B.sign.card(at(iAt(S[hel.i1].s - 18), -BAY + 0.06, 2.2), face(iAt(S[hel.i1].s - 18), -1), 1.6, 0.8, lvB1);
  { const i = iAt(S[ext.i0].s + 2); B.sign.card(at(i, -GW + 0.06, 2.3), face(i, -1), 4.2, 0.9, exitSign); }
  // exit gate: neon frame + swirl curtain across the lane
  const exitGate = (() => {
    const i = iAt(exitS), n = S[i].tan.clone().setY(0).normalize(), g = new THREE.Group(), H = CEIL_EXIT - 0.2;
    const barMat = new THREE.MeshBasicMaterial({ color: '#19f0e0', toneMapped: false, fog: false });
    const bars = mergeGeometries([
      new THREE.BoxGeometry(15.4, 0.14, 0.14).translate(0, H, 0), new THREE.BoxGeometry(15.4, 0.14, 0.14).translate(0, 0.05, 0),
      new THREE.BoxGeometry(0.14, H, 0.14).translate(7.7, H / 2, 0), new THREE.BoxGeometry(0.14, H, 0.14).translate(-7.7, H / 2, 0),
    ]);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(15.4, H), new THREE.MeshBasicMaterial({
      map: swirlTex(), color: '#ff2f9e', toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.9,
    }));
    curtain.position.y = H / 2;
    g.add(new THREE.Mesh(bars, barMat), curtain);
    g.position.copy(at(i, 0, 0));
    g.rotation.y = Math.atan2(n.x, n.z);
    group.add(g);
    light(at(i, 0, 2.4), '#ff2f9e', 0, 0, exitS - 6, 30);
    return { g, curtain };
  })();
  // garage building round the helix: a concrete drum with the slot the street runs into, the big P over it
  {
    const mouth = S.slice(gar.i0, gar.i0 + 60).map(p => p.local);
    const nearMouth = p => mouth.some(m => Math.hypot(m.x - p.x, m.z - p.z) < 9.2);
    const n = 64;
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
      const p0 = new THREE.Vector3(C.x + Math.cos(a0) * SHELL, 0, C.z + Math.sin(a0) * SHELL), p1 = new THREE.Vector3(C.x + Math.cos(a1) * SHELL, 0, C.z + Math.sin(a1) * SHELL);
      const out = new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)), u0 = k / n * 16, u1 = (k + 1) / n * 16;
      if (!nearMouth(p0.clone().lerp(p1, 0.5))) B.gwall.wall(p0, p1, u0, u1, -0.3, CEIL, 0, 1, out);
      B.gwall.wall(p0, p1, u0, u1, CEIL, 14, 1, 14 / CEIL, out);
    }
    const m = S[gar.i0].local, out = new THREE.Vector3(m.x - C.x, 0, m.z - C.z).normalize();
    const top = m.clone().addScaledVector(out, 0.4);
    B.sign.card(top.clone().setY(9.4), out, 5.4, 5.4, pSign);
    B.sign.card(top.clone().setY(5.3), out, 9, 2.25, garageSign);
    const side = new THREE.Vector3().crossVectors(UP, out).normalize();
    B.sign.card(top.clone().addScaledVector(side, -6.2).setY(9.4), out, 1.3, 1.3, vacant);
    light(top.clone().setY(8), '#2f8bff', 5, 0.3, S[gar.i0].s - 4, 40);
  }

  // ---------------- instanced props ----------------
  const dummy = new THREE.Object3D(), tc = new THREE.Color();
  const inst = (geo, mat, list, place) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((q, k) => { dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); const c = place(dummy, q); dummy.updateMatrix(); m.setMatrixAt(k, dummy.matrix); if (c) m.setColorAt(k, tc.set(c)); });
    m.count = list.length;
    group.add(m);
    return m;
  };
  // lanterns
  const LC = canvas(128, 128), lg = LC.getContext('2d');
  lg.fillStyle = '#ffffff'; lg.fillRect(0, 0, 128, 128);
  lg.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 8; y < 128; y += 9) lg.fillRect(0, y, 128, 2);
  lg.fillStyle = '#1a1a1a'; lg.fillRect(0, 0, 128, 12); lg.fillRect(0, 116, 128, 12);
  for (const x of [16, 80]) { lg.font = `900 44px ${FONT}`; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText('酒', x, 64); }
  const lanternMat = new THREE.MeshBasicMaterial({ map: tex(LC), toneMapped: false });
  inst(new THREE.SphereGeometry(0.3, 14, 10).scale(1, 1.35, 1), lanternMat, lanterns, (d, q) => { d.position.copy(q.p); d.scale.setScalar(q.s); return q.c; });
  // poles (concrete), arch posts, signal posts
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.17, 9.4, 8).translate(0, 4.7, 0),
    new THREE.BoxGeometry(0.1, 0.1, 1.8).translate(0, 8.8, 0), new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0, 8.35, 0),
    new THREE.CylinderGeometry(0.26, 0.26, 0.9, 10).translate(0.34, 7.3, 0),
  ]);
  const postGeo = new THREE.CylinderGeometry(0.1, 0.1, 1, 8).translate(0, 0.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: '#6d6a66', roughness: 0.8 });
  inst(poleGeo, poleMat, poles.filter(q => !q.arch && !q.signal), (d, q) => { d.position.copy(q.p); d.rotation.y = q.h; });
  inst(postGeo, poleMat, poles.filter(q => q.arch || q.signal), (d, q) => { d.position.copy(q.p); d.scale.set(1, q.arch ? 8.3 : 3.4, 1); });
  // wires
  {
    const pts = [];
    for (const [a, b, sag] of wires) {
      for (let k = 0; k < 8; k++) {
        const f0 = k / 8, f1 = (k + 1) / 8, y = f => -sag * 4 * f * (1 - f);
        pts.push(a.x + (b.x - a.x) * f0, a.y + (b.y - a.y) * f0 + y(f0), a.z + (b.z - a.z) * f0, a.x + (b.x - a.x) * f1, a.y + (b.y - a.y) * f1 + y(f1), a.z + (b.z - a.z) * f1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#0c0c10' })));
  }
  // bollards through the crossing: grey posts with glowing heads
  inst(new THREE.CylinderGeometry(0.13, 0.13, 0.95, 8).translate(0, 0.475, 0), poleMat, bollards, (d, q) => { d.position.copy(q); });
  inst(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 8).translate(0, 1.0, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), bollards, (d, q) => { d.position.copy(q); return q.z % 5 < 2.5 ? '#ff7a1a' : '#19f0e0'; });
  // garage columns and fluorescent tubes (one flickers)
  const colTex = tex((() => {
    const c = canvas(64, 128), g = c.getContext('2d');
    g.fillStyle = '#6a6f6b'; g.fillRect(0, 0, 64, 128); noise(g, 64, 128, 16);
    for (let y = 100; y < 128; y += 8) { g.fillStyle = (y / 8) % 2 ? '#e8c21c' : '#151515'; g.fillRect(0, y, 64, 8); }
    return c;
  })());
  inst(new THREE.BoxGeometry(0.7, CEIL, 0.7).translate(0, CEIL / 2 - 0.2, 0), new THREE.MeshStandardMaterial({ map: colTex, roughness: 0.85 }), cols, (d, q) => { d.position.copy(q.p); d.rotation.y = q.h; });
  const carGeo = mergeGeometries([   // body, glass cabin, wheels: vertex shade x the car's paint
    [new THREE.BoxGeometry(1.8, 0.62, 4.2).translate(0, 0.62, 0), 1],
    [new THREE.BoxGeometry(1.56, 0.5, 2.1).translate(0, 1.18, -0.15), 0.1],
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => [new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2).translate(x * 0.8, 0.33, z * 1.35), 0.05]),
  ].map(([g, k]) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(k), 3))));
  inst(carGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3, envMap: envTex, envMapIntensity: 0.6 }), parked, (d, q) => { d.position.copy(q.p); d.rotation.y = q.h; return q.c; });
  const tubeGeo = new THREE.BoxGeometry(0.14, 0.07, 1.5);
  inst(tubeGeo, new THREE.MeshBasicMaterial({ color: '#e6fff4', toneMapped: false }), tubes.filter(q => !q.flick), (d, q) => { d.position.copy(q.p); d.rotation.y = q.h; });
  const flickMat = new THREE.MeshBasicMaterial({ color: '#e6fff4', toneMapped: false });
  inst(tubeGeo, flickMat, tubes.filter(q => q.flick), (d, q) => { d.position.copy(q.p); d.rotation.y = q.h; });

  // ---------------- merged meshes ----------------
  group.add(B.road.mesh(roadMat), B.walk.mesh(walkMat), B.plaza.mesh(plazaMat), B.facade.mesh(facadeMat), B.sign.mesh(signMat),
    B.floor.mesh(floorMat), B.ceil.mesh(ceilMat), B.gwall.mesh(wallMat), B.crowd.mesh(crowdMat));

  // ---------------- glints: street signs on the wet asphalt, garage tubes on the sealed floor ----------------
  const glintMesh = (() => {
    const src = lights.filter(q => q.k > 0), n = src.length, V = 6;
    const p = new Float32Array(n * V * 3), c = new Float32Array(n * V * 3), s = new Float32Array(n * V), k = new Float32Array(n * V * 2), fl = new Float32Array(n * V * 2), idx = [];
    const corners = [-1, -1, 1, -1, -1, 0, 1, 0, -1, 1, 1, 1];
    src.forEach((q, i) => {
      const col = q.c.clone().multiplyScalar(q.k);
      for (let v = 0; v < V; v++) {
        const j = i * V + v;
        p.set([q.p.x, q.p.y, q.p.z], j * 3); c.set([col.r, col.g, col.b], j * 3); s[j] = q.size; k.set([corners[v * 2], corners[v * 2 + 1]], j * 2);
        fl.set([q.floor ?? 0, q.floor == null ? 0 : 1], j * 2);
      }
      const b = i * V;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2, b + 2, b + 3, b + 5, b + 2, b + 5, b + 4);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('hcol', new THREE.BufferAttribute(c, 3));
    g.setAttribute('gsize', new THREE.BufferAttribute(s, 1));
    g.setAttribute('corner', new THREE.BufferAttribute(k, 2));
    g.setAttribute('gfloor', new THREE.BufferAttribute(fl, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uIndoor: { value: 0 }, uOrigin: { value: ORIGIN.clone() } }, vertexShader: GLINT_VS, fragmentShader: GLINT_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    m.frustumCulled = false;
    m.renderOrder = 1;
    m.visible = false;
    group.add(m);
    return m;
  })();

  // ---------------- haze: a glow sprite per street sign, nudged off the facade toward the road so walls don't cut it ----------------
  const haze = (() => {
    const side = q => { const r = S[iAt(q.s)]; return Math.abs((q.p.x - r.lx) * r.right.x + (q.p.z - r.lz) * r.right.z) > 3; };   // not the ones over the road: they stack up at the vanishing point
    const src = lights.filter(q => q.k > 0 && q.floor == null && side(q)), n = src.length, corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    const p = new Float32Array(n * 12), c = new Float32Array(n * 12), s = new Float32Array(n * 4), k = new Float32Array(n * 8), idx = [];
    src.forEach((q, i) => {
      const r = S[iAt(q.s)].local, d = new THREE.Vector3(r.x - q.p.x, 0, r.z - q.p.z).normalize().multiplyScalar(1.2).add(q.p);
      const col = q.c.clone().multiplyScalar(0.1), size = clamp(1.4 + q.size * 0.5, 2, 4.2);
      for (let v = 0; v < 4; v++) { p.set([d.x, d.y, d.z], (i * 4 + v) * 3); c.set([col.r, col.g, col.b], (i * 4 + v) * 3); s[i * 4 + v] = size; k.set(corners.slice(v * 2, v * 2 + 2), (i * 4 + v) * 2); }
      idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('hcol', new THREE.BufferAttribute(c, 3));
    g.setAttribute('hsize', new THREE.BufferAttribute(s, 1));
    g.setAttribute('corner', new THREE.BufferAttribute(k, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: HAZE_VS, fragmentShader: HAZE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    m.frustumCulled = false;
    m.renderOrder = 5;
    m.visible = false;
    group.add(m);
    return m;
  })();

  // ---------------- rain: streaks wrapped into a box round the rendering camera ----------------
  const rain = (() => {
    const n = 2800, p = new Float32Array(n * 6), e = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); p.set([x, y, z, x, y, z], i * 6); e.set([0, 1], i * 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(e, 1));
    const m = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uBox: { value: new THREE.Vector3(44, 18, 44) }, uOrigin: { value: ORIGIN.clone() } },
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uBox; uniform vec3 uOrigin; varying float vA;
        void main(){ vec3 cam = cameraPosition - uOrigin; vec3 p = position * uBox;
          p.y -= uTime * 24.0; p.x += uTime * 1.5;
          vec3 rel = mod(p - cam + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec3 w = cam + rel + vec3(0.04, 0.95, 0.0) * aEnd;
          vA = (0.25 + 0.75 * aEnd) * smoothstep(0.5 * uBox.x, 0.25 * uBox.x, length(rel.xz)) * smoothstep(0.8, 3.0, length(rel));
          gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0); }`,
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.8, 0.82, 0.95, 0.5 * vA); }',
      transparent: true, depthWrite: false,
    }));
    m.frustumCulled = false;
    m.renderOrder = 6;
    m.visible = false;
    group.add(m);
    return m;
  })();

  // ---------------- point lights: parked on the anchors nearest the viewing car, dark otherwise ----------------
  const anchors = lights.filter(q => q.I > 0).sort((a, b) => a.s - b.s);
  const lamps = [];
  for (let k = 0; k < LIGHTS; k++) { const l = new THREE.PointLight(0xffffff, 0, 34, 1.5); group.add(l); lamps.push(l); }

  race.scene.add(group);
  group.updateMatrixWorld(true);
  group.visible = false;   // drawn only in a diver's viewport (track.view): elsewhere its lamps would light every fragment for nothing

  const start = S[iAt(START_S)];
  const D = {
    track, group, exitS, startS: START_S, backS: BACK_S, length: L,
    start: { pos: start.pos.clone(), heading: start.h, index: iAt(START_S), s: start.s },
    zoneAt: i => S[clamp(i | 0, 0, N - 1)].zone,
    // per viewport: lights on the nearest anchors ahead, rain / glints outdoors, animation
    frame(time, car) {
      const i = clamp(car.trackIndex | 0, 0, N - 1), zone = S[i].zone, out = !INDOOR.has(zone), s0 = S[i].s + 12;
      const near = anchors.map(q => [Math.abs(q.s - s0) + (q.s < S[i].s - 8 ? 40 : 0), q]).sort((a, b) => a[0] - b[0]);
      lamps.forEach((l, k) => {
        const q = near[k]?.[1];
        if (!q) { l.intensity = 0; return; }
        l.position.copy(q.p);
        l.color.copy(q.c);
        l.intensity = q.I;
      });
      rain.visible = haze.visible = out;
      glintMesh.visible = true;
      rain.material.uniforms.uTime.value = time;
      glintMesh.material.uniforms.uIndoor.value = out ? 0 : 1;
      entryGate.userData.spin(time);
      exitGate.curtain.rotation.z = Math.sin(time * 2) * 0.02;
      exitGate.curtain.material.opacity = 0.75 + 0.2 * Math.sin(time * 7);
      for (const q of screens) q.t.offset.y = 0.75 - ((Math.floor(time / 3.2) + q.phase) % 4) * 0.25;
      flickMat.color.setScalar(Math.sin(time * 37) > 0.2 && time % 3 < 1.4 ? 0.08 : 1);
    },
    off() { for (const l of lamps) l.intensity = 0; rain.visible = glintMesh.visible = haze.visible = group.visible = false; },
    // at load (game.js race.warmups): link the programs for the pocket's lighting and upload its ~30 MB of canvas
    // textures now, not in the first dive's frame. compile() counts the lights of both what it compiles and the scene
    // it is given, so what it compiles leaves the scene meanwhile.
    warm(ctx, cam) {
      const r = ctx.renderer, undo = track.view(ctx, { car: { trackIndex: D.start.index } });
      try {
        for (const o of [group, ...ctx.race.cars.filter(c => c.control === 'p1' || c.control === 'p2').map(c => c.mesh)]) {
          const p = o?.parent;
          if (!p) continue;
          p.remove(o);
          try { r.compile(o, cam, ctx.scene); } finally { p.add(o); }
        }
        const seen = new Set();   // envMap: only its PMREM copy is sampled, and compile() made that
        group.traverse(o => [].concat(o.material || []).forEach(m => Object.entries(m).forEach(([k, t]) => {
          if (t?.isTexture && k !== 'envMap' && !seen.has(t)) { seen.add(t); r.initTexture(t); }
        })));
      } finally { undo(); }
    },
  };
  track.view = viewHook(D);
  (race.warmups ||= []).push(D.warm);
  return D;
}

// ======================================================================================
// Per-viewport night: swap the world's sky / fog / sun / hemi / exposure, hide the course scenery, light the neon
// ======================================================================================
function viewHook(D) {
  const col = c => new THREE.Color(c);
  const fogS = col(NIGHT.street.fog), fogI = col(NIGHT.indoor.fog), top = col(NIGHT.sky.top), hor = col(NIGHT.sky.horizon), bot = col(NIGHT.sky.bottom), skyIn = col(NIGHT.skyIn);
  const sunC = col(NIGHT.sun.color), hemiC = { street: NIGHT.street.hemi.slice(0, 2).map(col), indoor: NIGHT.indoor.hemi.slice(0, 2).map(col) };
  const sv = { fog: new THREE.Color(), bg: new THREE.Color(), sun: new THREE.Color(), hs: new THREE.Color(), hg: new THREE.Color(), top: new THREE.Color(), hor: new THREE.Color(), bot: new THREE.Color() };
  return (ctx, v) => {
    const scene = ctx.scene, car = v.car, fog = scene.fog, r = ctx.renderer, sun = ctx.sun, U = ctx.sky?.material?.uniforms;
    // the course's own scenery (some of it pinned to the camera: snowfall, sunset dome...) must not show here, nor its
    // lights count (the pocket's own lamps replace them: ≤ 8 real lights)
    const kids = ctx.world?.children || [];
    const hide = kids.filter(o => o !== ctx.sky && o !== sun && o !== sun?.target && !o.isHemisphereLight);
    const hemi = kids.find(o => o.isHemisphereLight) || null;
    D.group.visible = true;
    const indoor = INDOOR.has(D.zoneAt(car.trackIndex)), N = indoor ? NIGHT.indoor : NIGHT.street;
    const was = hide.map(o => o.visible);
    for (const o of hide) o.visible = false;
    const f0 = fog && [fog.near, fog.far];
    if (fog) { sv.fog.copy(fog.color); fog.color.copy(indoor ? fogI : fogS); fog.near = N.near; fog.far = N.far; }
    const bg = scene.background?.isColor ? scene.background : null;
    if (bg) { sv.bg.copy(bg); bg.copy(indoor ? fogI : fogS); }
    const env0 = scene.environmentIntensity, exp0 = r.toneMappingExposure;
    scene.environmentIntensity = NIGHT.env; r.toneMappingExposure = NIGHT.exposure;
    const sun0 = sun?.intensity;
    if (sun) { sv.sun.copy(sun.color); sun.color.copy(sunC); sun.intensity = NIGHT.sun.intensity; }
    const hemi0 = hemi?.intensity;
    if (hemi) {
      const [hs, hg] = hemiC[indoor ? 'indoor' : 'street'];
      sv.hs.copy(hemi.color); sv.hg.copy(hemi.groundColor); hemi.color.copy(hs); hemi.groundColor.copy(hg); hemi.intensity = N.hemi[2];
    }
    let sky0 = null;
    if (U) {
      sv.top.copy(U.top.value); sv.hor.copy(U.horizon.value); sv.bot.copy(U.bottom.value); sky0 = [U.glow.value, U.stars.value];
      if (indoor) { U.top.value.copy(skyIn); U.horizon.value.copy(skyIn); U.bottom.value.copy(skyIn); U.stars.value = 0; }
      else { U.top.value.copy(top); U.horizon.value.copy(hor); U.bottom.value.copy(bot); U.stars.value = 0.25; }
      U.glow.value = 0;
    }
    const others = [];   // another local car diving at the same time: its own space, not shown here
    for (const c of ctx.race.cars) if (c !== car && c._?.track === D.track && c.mesh.visible) { c.mesh.visible = false; others.push(c); }
    D.frame(ctx.clock, car);
    return () => {
      hide.forEach((o, k) => { o.visible = was[k]; });
      if (fog) { fog.color.copy(sv.fog); [fog.near, fog.far] = f0; }
      if (bg) bg.copy(sv.bg);
      scene.environmentIntensity = env0; r.toneMappingExposure = exp0;
      if (sun) { sun.color.copy(sv.sun); sun.intensity = sun0; }
      if (hemi) { hemi.color.copy(sv.hs); hemi.groundColor.copy(sv.hg); hemi.intensity = hemi0; }
      if (U) { U.top.value.copy(sv.top); U.horizon.value.copy(sv.hor); U.bottom.value.copy(sv.bot); [U.glow.value, U.stars.value] = sky0; }
      for (const c of others) c.mesh.visible = true;
      D.off();
    };
  };
}
