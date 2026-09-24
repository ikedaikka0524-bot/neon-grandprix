// Midnight City theme (ミッドナイト・シティ): lit-window towers, Japanese / English neon signs, streetlights, the raised
// part of the course as a concrete viaduct, elevated expressways with moving traffic, a Ferris wheel and a TV spire,
// a moon, and a distant glowing skyline around the horizon.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) * k | 0},${(n >> 8 & 255) * k | 0},${(n & 255) * k | 0})`; };

const GROUND = -0.2;                   // the whole city is flat; the raised course runs on its own viaduct
const FOG = { color: '#1b1631', near: 70, far: 780 };
const NEON = ['#ff2bd6', '#26e8ff', '#ffd23f', '#9b6bff', '#3dff9e', '#ff4d6d', '#ff8a2b'];
const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo",sans-serif';
const EN = '"Arial Black","Segoe UI","Helvetica Neue",Arial,sans-serif';

// ======================================================================================
// Canvas painters
// ======================================================================================
// wet concrete paving; puddles are drawn at the 9 tile offsets so the texture stays seamless
function paintGround(g, w, h) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 12; d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.15; }
  g.putImageData(img, 0, 0);
  for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(x, y, 32, 32); }
  g.fillStyle = 'rgba(0,0,0,0.4)';
  for (let k = 0; k < w; k += 32) { g.fillRect(k, 0, 1, h); g.fillRect(0, k, w, 1); }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let k = 1; k < w; k += 32) { g.fillRect(k, 0, 1, h); g.fillRect(0, k, w, 1); }
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 50;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, 'rgba(6,8,20,0.45)'); gr.addColorStop(1, 'rgba(6,8,20,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
}

// facade window grids: 32 x 32 cells of 16 px (one cell = 3.2 m wide, 3.6 m floor); pixel (0,0) is facade (roofs use it)
const WINDOWS = [
  { facade: '#12141a', mx: 2, my: 4, lit: ['#ffe3a3', '#fff1cf', '#ffd27a', '#ffeab8'], dark: ['#1c2331', '#171d29', '#222a3b'], floor: 0.3, on: 0.65, off: 0.06, glow: 1.0 },  // offices
  { facade: '#0b1120', mx: 1, my: 2, lit: ['#c4e8ff', '#eaf6ff', '#9fd0ff'], dark: ['#10203a', '#0e1a30', '#132642'], floor: 0.25, on: 0.8, off: 0.04, glow: 0.95 },           // glass
  { facade: '#1b1817', mx: 4, my: 5, lit: ['#ffcf7a', '#ffb45c', '#ffe0a0', '#8fb8ff', '#ff9ec7'], dark: ['#231f25', '#1d1a21'], floor: 0, on: 0, off: 0.3, glow: 0.9 },    // flats
  { facade: '#07060d', mx: 1, my: 1, lit: ['#e0f8ff'], dark: ['#0d0b19', '#110d22'], floor: 0.1, on: 0.5, off: 0.02, glow: 1.2, led: true },                                   // neon glass
];
const paintWindows = st => (g, w, h) => {
  const C = 16, n = w / C, any = a => a[Math.floor(Math.random() * a.length)];
  g.fillStyle = st.facade; g.fillRect(0, 0, w, h);
  for (let fy = 0; fy < n; fy++) {
    const p = Math.random() < st.floor ? st.on : st.off;
    for (let fx = 0; fx < n; fx++) {
      const x = fx * C + st.mx, y = fy * C + st.my, w1 = C - 2 * st.mx, h1 = C - 2 * st.my, lit = Math.random() < p;
      g.fillStyle = lit ? any(st.lit) : any(st.dark); g.fillRect(x, y, w1, h1);
      if (!lit) continue;
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.45})`; g.fillRect(x, y, w1, h1);          // dimmer rooms
      if (Math.random() < 0.3) { g.fillStyle = 'rgba(0,0,0,0.35)'; for (let k = y + 1; k < y + h1; k += 2) g.fillRect(x, k, w1, 1); }   // blinds
    }
  }
  if (st.led) for (let fx = 4; fx < n; fx += 8) { g.fillStyle = fx % 16 === 4 ? '#ff2bd6' : '#26e8ff'; g.fillRect(fx * C + C / 2 - 1, 0, 2, h); }
};

// neon sign atlas 1024²: 8 vertical signs (128x512) on top, 8 horizontal (512x128) below
const VSIGNS = [['ラーメン', '#ff3b3b', 'box'], ['カラオケ', '#ff2bd6', 'neon'], ['居酒屋', '#ffb13b', 'box'], ['ホテル', '#26e8ff', 'neon'],
  ['ゲーム', '#3dff9e', 'neon'], ['焼肉', '#ff5a3c', 'neon'], ['寿司', '#e8202a', 'white'], ['漫画喫茶', '#ffd23f', 'box']];
const HSIGNS = [['NEON GP', '#ff2bd6'], ['HOTEL', '#26e8ff'], ['BAR 24H', '#ffb13b'], ['DRIFT CLUB', '#9b6bff'],
  ['ARCADE', '#3dff9e'], ['SUSHI', '#ff4d6d'], ['KARAOKE', '#ff8a2b'], ['ネオン横丁', '#26e8ff']];
const cellUV = (x, y, w, h, color, th = 1024) => ({ u0: (x + 3) / 1024, v0: 1 - (y + h - 3) / th, uw: (w - 6) / 1024, vh: (h - 6) / th, color });
const VCELLS = VSIGNS.map((s, i) => cellUV(i * 128, 0, 128, 512, s[1]));
const HCELLS = HSIGNS.map((s, i) => cellUV((i % 2) * 512, 512 + (i >> 1) * 128, 512, 128, s[1]));

function glowText(g, txt, x, y, c, blur) {
  g.shadowColor = c; g.fillStyle = c;
  g.shadowBlur = blur; g.fillText(txt, x, y);
  g.shadowBlur = blur * 0.4; g.fillText(txt, x, y);
  g.shadowBlur = 0; g.globalAlpha = 0.5; g.fillStyle = '#fff'; g.fillText(txt, x, y); g.globalAlpha = 1;
}
function fitFont(g, txt, font, size, maxW) {
  g.font = font(size);
  const w = g.measureText(txt).width;
  if (w > maxW) g.font = font(Math.floor(size * maxW / w));
}
function paintSigns(g) {
  VSIGNS.forEach(([txt, c, style], i) => {
    const W = 128, H = 512, ch = [...txt], fs = Math.min(90, 420 / ch.length), neon = style === 'neon';
    g.save(); g.translate(i * W, 0);
    if (neon) {
      g.fillStyle = '#0b0a12'; g.fillRect(3, 3, W - 6, H - 6);
      g.strokeStyle = c; g.lineWidth = 4; g.shadowColor = c; g.shadowBlur = 14; g.strokeRect(13, 13, W - 26, H - 26); g.shadowBlur = 0;
    } else {
      const bg = style === 'white' ? '#f4f1e8' : c, gr = g.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, shade(bg, 0.72)); gr.addColorStop(0.5, bg); gr.addColorStop(1, shade(bg, 0.72));
      g.fillStyle = gr; g.fillRect(3, 3, W - 6, H - 6);
      g.strokeStyle = style === 'white' ? c : 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.strokeRect(11, 11, W - 22, H - 22);
    }
    g.font = `900 ${fs}px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    ch.forEach((k, j) => {
      g.save(); g.translate(W / 2, H / 2 + (j - (ch.length - 1) / 2) * fs * 1.08);
      if (k === 'ー') g.rotate(Math.PI / 2);   // long vowel mark stands upright in vertical text
      if (neon) glowText(g, k, 0, 0, c, 16);
      else { g.fillStyle = style === 'white' ? c : '#fff'; g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 6; g.fillText(k, 0, 0); g.shadowBlur = 0; }
      g.restore();
    });
    g.restore();
  });
  HSIGNS.forEach(([txt, c], i) => {
    const W = 512, H = 128, jp = /[^\x00-\x7f]/.test(txt);
    g.save(); g.translate((i % 2) * W, 512 + (i >> 1) * H);
    g.fillStyle = '#0a0911'; g.fillRect(3, 3, W - 6, H - 6);
    g.strokeStyle = c; g.lineWidth = 3; g.shadowColor = c; g.shadowBlur = 12; g.strokeRect(12, 12, W - 24, H - 24); g.shadowBlur = 0;
    fitFont(g, txt, s => (jp ? `900 ${s}px ${JP}` : `${i % 2 ? 'italic ' : ''}900 ${s}px ${EN}`), 70, W - 70);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    glowText(g, txt, W / 2, H / 2 + 3, c, 18);
    g.restore();
  });
}

// billboard atlas 1024²: 6 ads of 512x256 (the game's own cars and events)
const ADS = [
  { bg: ['#ff3b2f', '#ff9a1f'], title: 'ニトロ・ファルコン', sub: '最速を、その手に。', deco: 'speed' },
  { bg: ['#ff5d9e', '#ffc2d9'], title: 'SUSHI PHANTOM', sub: 'すり抜けろ。', deco: 'sushi' },
  { bg: ['#2a0b5c', '#7b2cbf'], title: 'クロノ・ドラゴン', sub: 'TIME IS YOURS', deco: 'clock' },
  { bg: ['#021a2e', '#0a4d7a'], title: 'NEON GRAND PRIX', sub: 'ミッドナイト・シティ 開幕', deco: 'grid' },
  { bg: ['#141414', '#2b2b2b'], title: 'DRIFT KING', sub: 'ドリフト職人 募集中', deco: 'stripes', ink: '#ffd23f' },
  { bg: ['#b8860b', '#ffd23f'], title: 'ガチャ10連', sub: 'SR以上 1枠確定！', deco: 'stars', ink: '#3a2200' },
];
const AD_CELLS = ADS.map((a, i) => cellUV((i % 2) * 512, (i >> 1) * 256, 512, 256));
function paintAds(g) {
  ADS.forEach((ad, i) => {
    const W = 512, H = 256;
    g.save(); g.translate((i % 2) * W, (i >> 1) * H);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, ad.bg[0]); gr.addColorStop(1, ad.bg[1]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    if (ad.deco === 'speed') for (let k = 0; k < 16; k++) { g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2 + Math.random() * 7; const x = Math.random() * W * 1.3 - 60; g.beginPath(); g.moveTo(x, H); g.lineTo(x + 140, 0); g.stroke(); }
    if (ad.deco === 'sushi') for (const [x, y] of [[380, 170], [455, 120]]) {
      g.fillStyle = '#fffaf0'; g.beginPath(); g.ellipse(x, y + 14, 58, 30, 0, 0, TAU); g.fill();
      g.fillStyle = '#ff7f50'; g.beginPath(); g.ellipse(x, y, 62, 24, -0.1, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 4; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(x + k * 18 - 8, y - 18); g.lineTo(x + k * 18 + 8, y + 18); g.stroke(); }
    }
    if (ad.deco === 'clock') {
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 8; g.beginPath(); g.arc(410, 128, 92, 0, TAU); g.stroke();
      for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; g.lineWidth = 5; g.beginPath(); g.moveTo(410 + Math.cos(a) * 72, 128 + Math.sin(a) * 72); g.lineTo(410 + Math.cos(a) * 84, 128 + Math.sin(a) * 84); g.stroke(); }
      g.lineWidth = 7; g.beginPath(); g.moveTo(410, 128); g.lineTo(410 + 50, 128 - 30); g.moveTo(410, 128); g.lineTo(410 - 10, 128 + 70); g.stroke();
    }
    if (ad.deco === 'grid') {
      g.strokeStyle = 'rgba(38,232,255,0.45)'; g.lineWidth = 2;
      for (let k = -10; k <= 10; k++) { g.beginPath(); g.moveTo(W * 0.62, H * 0.42); g.lineTo(W * 0.62 + k * 70, H); g.stroke(); }
      for (let k = 0; k < 7; k++) { const y = H * 0.42 + Math.pow(k / 6, 2) * H * 0.58; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    }
    if (ad.deco === 'stripes') for (let k = -2; k < 20; k++) { g.fillStyle = k % 2 ? '#111' : '#ffd23f'; g.beginPath(); g.moveTo(k * 30, H); g.lineTo(k * 30 + 30, H); g.lineTo(k * 30 + 60, H - 40); g.lineTo(k * 30 + 30, H - 40); g.fill(); }
    if (ad.deco === 'stars') for (let k = 0; k < 22; k++) {
      const x = 260 + Math.random() * 240, y = 20 + Math.random() * 200, r = 4 + Math.random() * 14;
      g.fillStyle = k % 3 ? '#fff' : '#fff2a8'; g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.25, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.25, y); g.fill();
      g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y + r * 0.25); g.lineTo(x + r, y); g.lineTo(x, y - r * 0.25); g.fill();
    }
    const jp = /[^\x00-\x7f]/.test(ad.title);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = ad.ink || '#fff'; g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 10;
    fitFont(g, ad.title, s => `900 ${s}px ${jp ? JP : EN}`, 58, W - 60);
    g.fillText(ad.title, 28, 128);
    g.font = `700 30px ${JP}`; g.fillText(ad.sub, 30, 186);
    g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);
    g.restore();
  });
}

// ground-floor shop atlas 1024x512: 8 shop fronts of 512x128 (fascia on top, lit glass below); spill = light on the pavement
const SHOPS = [
  { name: 'コンビニ', fascia: '#f4f4ee', ink: '#15803d', light: '#e8f3ff', spill: '#cfe6ff', stripes: ['#15803d', '#2563eb', '#f28c28'], goods: true },
  { name: 'ラーメン', fascia: '#c8161d', ink: '#fff4dc', light: '#ffc46e', spill: '#ffb45c', noren: '#1b2140' },
  { name: 'CAFE', fascia: '#3a2616', ink: '#f3e2c4', light: '#ffae62', spill: '#ff9d4d', plants: true },
  { name: '貸店舗', fascia: '#202228', ink: '#6f7580', shutter: true },   // closed for the night
  { name: 'ドラッグ', fascia: '#ffd400', ink: '#1446a0', light: '#f2faff', spill: '#e0f0ff', goods: true },
  { name: 'BAR', fascia: '#12091a', ink: '#ff3cac', light: '#3a1238', spill: '#ff3cac', bar: true },
  { name: 'GAME', fascia: '#0b0b12', ink: '#3dff9e', light: '#1c1240', spill: '#8a5bff', arcade: true },
  { name: '本屋', fascia: '#16305a', ink: '#ffffff', light: '#ffe0a0', spill: '#ffd08a', books: true },
];
const SHOP_CELLS = SHOPS.map((s, i) => ({ ...cellUV((i % 2) * 512, (i >> 1) * 128, 512, 128, s.spill, 512), spill: s.spill }));
function paintShops(g) {
  const any = a => a[Math.floor(Math.random() * a.length)], F = 30, W = 512, H = 128;
  SHOPS.forEach((s, i) => {
    g.save(); g.translate((i % 2) * W, (i >> 1) * H);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    if (s.shutter) {
      g.fillStyle = '#3d4149'; g.fillRect(0, F, W, H - F);
      for (let y = F; y < H; y += 5) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, y, W, 1); g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, y + 1, W, 1); }
      g.lineCap = 'round';
      for (let k = 0; k < 5; k++) {   // graffiti
        g.strokeStyle = any(['#ff4fd8', '#39e6ff', '#ffe14d', '#7dff6a']); g.globalAlpha = 0.55; g.lineWidth = 3 + Math.random() * 5;
        const x = 40 + Math.random() * 420, y = F + 25 + Math.random() * 55;
        g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + 30, y - 30, x + 50, y + 30, x + 90, y - 5); g.stroke();
      }
      g.globalAlpha = 1;
    } else {
      const gr = g.createLinearGradient(0, F, 0, H);
      gr.addColorStop(0, s.light); gr.addColorStop(1, shade(s.light, 0.6));
      g.fillStyle = gr; g.fillRect(0, F, W, H - F);
      if (s.goods || s.books) for (const y of [F + 30, F + 56, F + 82]) {   // shelves
        for (let x = 6; x < W - 6; x += s.books ? 3 : 7) { g.fillStyle = any(['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#ffb703', '#8338ec', '#fb5607', '#06d6a0']); g.globalAlpha = 0.85; g.fillRect(x, y - (s.books ? 17 : 10), s.books ? 2 : 5, s.books ? 17 : 10); }
        g.globalAlpha = 1; g.fillStyle = 'rgba(40,40,50,0.7)'; g.fillRect(0, y, W, 3);
      }
      if (s.noren) for (let x = 190; x < 322; x += 33) { g.fillStyle = s.noren; g.fillRect(x, F + 8, 31, 38); g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 15, F + 26, 7, 0, TAU); g.fill(); }
      if (s.noren || s.plants) for (let x = 30; x < W; x += 64) { g.fillStyle = s.plants ? '#ffe7b0' : '#ff5a3c'; g.beginPath(); g.arc(x, F + 18, 6, 0, TAU); g.fill(); }   // pendant lamps / lanterns
      if (s.plants) for (let x = 20; x < W; x += 46 + Math.random() * 30) { g.fillStyle = any(['#2f6b3a', '#3f8a4a', '#24552e']); g.beginPath(); g.arc(x, H - 22, 12 + Math.random() * 8, 0, TAU); g.fill(); }
      if (s.bar) {
        g.strokeStyle = s.ink; g.lineWidth = 3; g.shadowColor = s.ink; g.shadowBlur = 10;
        for (const x of [110, 400]) { g.beginPath(); g.moveTo(x - 22, F + 26); g.lineTo(x + 22, F + 26); g.lineTo(x, F + 52); g.closePath(); g.moveTo(x, F + 52); g.lineTo(x, F + 76); g.moveTo(x - 12, F + 76); g.lineTo(x + 12, F + 76); g.stroke(); }
        g.shadowBlur = 0;
      }
      if (s.arcade) for (let x = 10; x < W - 20; x += 26) { g.fillStyle = any(['#ff2bd6', '#26e8ff', '#ffd23f', '#3dff9e', '#ff8a2b']); g.fillRect(x, F + 22 + Math.random() * 8, 18, 22); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, F + 50, 18, 40); }
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, F + 2, W, 4);            // ceiling lights
      g.fillStyle = '#17181d';
      for (let x = 0; x <= W; x += 128) g.fillRect(x - 3, F, 6, H - F);            // mullions
      g.fillRect(0, F + 10, W, 3); g.fillRect(228, F, 4, H - F); g.fillRect(280, F, 4, H - F);   // transom + door frame
    }
    g.fillStyle = '#121318'; g.fillRect(0, H - 8, W, 8);                              // kick plate
    g.fillStyle = s.fascia; g.fillRect(0, 0, W, F);
    if (s.stripes) s.stripes.forEach((c, k) => { g.fillStyle = c; g.fillRect(0, F - 9 + k * 3, W, 3); });
    g.font = `900 ${s.stripes ? 19 : 22}px ${/[^\x00-\x7f]/.test(s.name) ? JP : EN}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = s.ink;
    if (s.bar || s.arcade) { g.shadowColor = s.ink; g.shadowBlur = 8; }
    g.fillText(s.name, W / 2, s.stripes ? 11 : F / 2 + 1);
    g.shadowBlur = 0;
    g.restore();
  });
}

// distant skyline wrapped around the horizon: warm light-pollution haze, a hazy far layer and a dark near layer
function paintSkyline(g, w, h) {
  g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, h, 0, 0);
  gr.addColorStop(0, 'rgba(255,150,110,0.6)'); gr.addColorStop(0.22, 'rgba(230,100,170,0.35)'); gr.addColorStop(0.6, 'rgba(110,60,200,0.08)'); gr.addColorStop(1, 'rgba(60,40,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const win = ['#ffd58a', '#fff0c8', '#a8d8ff', '#ff9ed2'];
  const layer = (fill, lo, hi, lit) => {
    for (let x = -10; x < w - 12;) {
      const bw = 8 + Math.random() * 34, bh = h * (lo + Math.pow(Math.random(), 2.3) * (hi - lo));
      g.fillStyle = fill; g.fillRect(x, h - bh, bw, bh);
      if (lit) for (let y = h - bh + 3; y < h - 2; y += 4) for (let k = x + 2; k < x + bw - 1; k += 3) if (Math.random() < lit) { g.fillStyle = win[Math.floor(Math.random() * 4)]; g.fillRect(k, y, 1, 1); }
      if (bh > h * 0.5 && Math.random() < 0.5) { g.fillStyle = fill; g.fillRect(x + bw / 2 - 0.5, h - bh - 12, 1.5, 12); g.fillStyle = '#ff3030'; g.fillRect(x + bw / 2 - 1, h - bh - 13, 2.5, 2.5); }
      x += bw + (Math.random() < 0.25 ? Math.random() * 12 : 0);
    }
  };
  layer('rgba(58,40,88,0.92)', 0.28, 0.85, 0);
  layer('#0a0913', 0.16, 0.66, 0.12);
}

// ======================================================================================
// Environment
// ======================================================================================
const env = {
  sky: { top: '#03040d', horizon: '#2e1f48', bottom: '#0d0b18' },
  fog: FOG,
  sun: { dir: [-0.24, 0.26, 0.94], color: '#a9bcff', intensity: 0.55 },   // moonlight; the moon is drawn here
  hemi: { sky: '#5563a8', ground: '#241a2c', intensity: 0.65 },
  exposure: 1.15,
  envIntensity: 0.06,   // hint for world.js: the bright room reflection greys the wet road at the night default 0.18
  night: true,
  terrain: { base: '#2a2c33', paint: paintGround, hills: 0, rim: 0, rimColor: '#15151d', height: () => GROUND },
  road: { base: '#26282f', line: '#f2c230', edge: '#e6e6e0', roughness: 0.35 },   // wet asphalt
  shoulder: '#303239',
  barrier: 'neon',
  curb: ['#ff3cac', '#2de2ff'],
};

// ======================================================================================
// Scenery
// ======================================================================================
function build(api) {
  const { world, track, rnd } = api;
  const S = track.samples, N = S.length, W2 = track.width / 2, sp = track.length / N;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const { pos: p } of S) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const range = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];
  const R = S.map(s => new THREE.Vector3(-s.tan.z, 0, s.tan.x).normalize());   // right of travel
  const head = S.map(s => Math.atan2(s.tan.x, s.tan.z));
  const turn = (i, k) => wrapAngle(head[(i + k) % N] - head[(i - k + N) % N]);   // + = turning left
  const side = (i, lat, y = 0) => [S[i].pos.x + R[i].x * lat, S[i].pos.y + y, S[i].pos.z + R[i].z * lat];
  const time = { value: 0 }, vp = new THREE.Vector4(), tmp = new THREE.Vector3(), col = new THREE.Color();
  const fogU = () => ({ fogNear: { value: FOG.near }, fogFar: { value: FOG.far } });

  // merged buckets: one draw call each
  const B = { conc: [], neon: [], sign: [], flick: [], ad: [], shop: [], spire: [], tower: WINDOWS.map(() => []) };
  const halos = [];   // x, y, z, r, g, b, size, blink
  const glints = [];  // wet-asphalt reflections of the lights next to the road: x, y, z, r, g, b, size
  const glint = (x, y, z, c, size, k) => { col.set(c).multiplyScalar(k); glints.push(x, y, z, col.r, col.g, col.b, size); };
  const poolP = [], poolC = [];   // additive light pools on the road and pavement
  const tint = (g, c) => {
    col.set(c);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); return g.translate(x, y, z); };
  const beam = (a, b, t) => {   // box from point a to point b
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    return new THREE.BoxGeometry(t, len, t).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()))
      .translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  };
  const halo = (x, y, z, c, size, k = 1, blink = 0) => { col.set(c).multiplyScalar(k); halos.push(x, y, z, col.r, col.g, col.b, size, blink); };
  const quad = (bucket, c, w, h, x, y, z, ang) => {   // atlas-mapped plane facing (sin ang, 0, cos ang)
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < 4; i++) uv.setXY(i, c.u0 + uv.getX(i) * c.uw, c.v0 + uv.getY(i) * c.vh);
    bucket.push(g.rotateY(ang).translate(x, y, z));
  };
  const add = (geos, mat, shadow = false) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = shadow; m.receiveShadow = shadow;
    world.add(m);
    return m;
  };
  // tall things stay >= 20 m behind the barrier on the inside of corners (chase camera sightlines)
  const clearOf = (x, z, r, tall = true) => {
    if (!api.isFree(x, z, r)) return false;
    if (!tall || api.near(x, z)[0] > W2 + 29.4 + r) return true;
    const q = track.nearest(tmp.set(x, 0, z)), t = turn(q.index, 40);
    return !(Math.abs(t) > 0.5 && Math.sign(q.lateral) === -Math.sign(t));
  };
  // sky pieces are drawn at infinity (direction only) so they follow every camera
  const skyPos = 'vec4 skyPos(vec3 d){ vec4 p = projectionMatrix * vec4((viewMatrix * vec4(d, 0.0)).xyz, 1.0); p.z = p.w * 0.99999; return p; }';
  const skyMesh = (obj, order) => { obj.frustumCulled = false; obj.renderOrder = order; world.add(obj); return obj; };

  // ---------------------------------------------------------------- sky: bright twinkling stars, moon, horizon skyline
  {
    const n = 380, pos = new Float32Array(n * 3), st = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const y = 0.06 + 0.94 * Math.pow(rnd(), 0.8), r = Math.sqrt(1 - y * y), a = rnd() * TAU;
      pos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      st.set([1.2 + Math.pow(rnd(), 5) * 2.6, rnd()], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('star', new THREE.BufferAttribute(st, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { time, px: { value: 1 } },
      vertexShader: `attribute vec2 star; uniform float time; uniform float px; varying float vA; varying float vT; ${skyPos}
        void main(){ gl_Position = skyPos(position);
          vA = (0.6 + 0.4 * sin(time * (1.2 + star.y * 2.5) + star.y * 40.0)) * smoothstep(0.05, 0.3, position.y);
          vT = star.y; gl_PointSize = star.x * px; }`,
      fragmentShader: `varying float vA; varying float vT;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 1.6) * vA;
          gl_FragColor = vec4(mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.88, 0.75), vT) * a, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const stars = skyMesh(new THREE.Points(geo, mat), -9);
    stars.onBeforeRender = (r) => { r.getCurrentViewport(vp); mat.uniforms.px.value = vp.w / 900; };

    skyMesh(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { dir: { value: new THREE.Vector3(...env.sun.dir).normalize() } },
      vertexShader: `uniform vec3 dir; varying vec2 vQ;
        void main(){ vQ = position.xy; vec4 p = projectionMatrix * vec4((viewMatrix * vec4(dir, 0.0)).xyz + vec3(position.xy * 0.3, 0.0), 1.0); p.z = p.w * 0.99999; gl_Position = p; }`,
      fragmentShader: `varying vec2 vQ;
        void main(){ float R = 0.15, r = length(vQ); vec2 q = vQ / R;
          float disc = smoothstep(R, R - 0.006, r);
          float maria = 0.5 + 0.5 * sin(q.x * 5.1 + 1.3) * sin(q.y * 4.3 - 0.7) + 0.25 * sin(q.x * 11.0 + q.y * 7.0);
          vec3 surf = vec3(0.93, 0.95, 1.0) * (0.72 + 0.28 * clamp(maria, 0.0, 1.0)) * (0.78 + 0.22 * sqrt(max(0.0, 1.0 - dot(q, q))));
          float e = max(r - R, 0.0), glow = (exp(-e * 12.0) * 0.28 + exp(-e * 45.0) * 0.45) * smoothstep(1.0, 0.55, r);
          gl_FragColor = vec4(surf * disc * 1.5 + vec3(0.55, 0.65, 1.0) * glow * (1.0 - disc), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })), -7);

    const ringTex = api.canvasTex(2048, 256, paintSkyline);
    skyMesh(new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.19, 128, 1, true).translate(0, 0.065, 0), new THREE.ShaderMaterial({
      uniforms: { map: { value: ringTex } },
      vertexShader: `varying vec2 vUv; ${skyPos} void main(){ vUv = uv; gl_Position = skyPos(position); }`,
      fragmentShader: `uniform sampler2D map; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(map, vec2(vUv.x * 3.0, vUv.y));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })), -8);
  }

  // ---------------------------------------------------------------- the raised part of the course: a concrete viaduct
  // deck slab under road + run-off, fascia walls (solid ramps below 4.5 m, open with bents above), an LED fascia strip
  {
    const L = W2 + 10.7, HIGH = 4.5, pos = [], cl = [], strip = [];
    const tri = (a, b, c, n, cc) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const f = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
      pos.push(...a, ...(f ? c : b), ...(f ? b : c));
      col.set(cc); for (let k = 0; k < 3; k++) cl.push(col.r, col.g, col.b);
    };
    const quad4 = (a, b, c, d, n, cc) => { tri(a, b, c, n, cc); tri(a, c, d, n, cc); };
    const low = i => S[i].pos.y < HIGH, bottom = i => (low(i) ? GROUND - 0.1 : S[i].pos.y - 1.8);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      if (S[i].pos.y < 0.1 && S[j].pos.y < 0.1) continue;
      const top = k => S[k].pos.y - 0.12;
      quad4(side(i, -L, -0.12), side(i, L, -0.12), side(j, L, -0.12), side(j, -L, -0.12), [0, 1, 0], '#2b2d34');
      for (const sg of [1, -1]) {
        const n = [R[i].x * sg, 0, R[i].z * sg], P = (k, y) => { const p = side(k, sg * L); p[1] = y; return p; };
        quad4(P(i, top(i)), P(i, bottom(i)), P(j, bottom(j)), P(j, top(j)), n, '#7a7d86');
        const Q = (k, lat, y) => { const p = side(k, sg * lat); p[1] = top(k) + y; return p; };
        strip.push(...Q(i, L + 0.04, -0.95), ...Q(j, L + 0.04, -0.95), ...Q(j, L + 0.04, -0.7), ...Q(i, L + 0.04, -0.95), ...Q(j, L + 0.04, -0.7), ...Q(i, L + 0.04, -0.7));
      }
      if (!low(i) || !low(j)) quad4(side(i, -L, -1.8), side(i, L, -1.8), side(j, L, -1.8), side(j, -L, -1.8), [0, -1, 0], '#44474f');
      if (low(i) !== low(j)) {   // abutment closing the ramp where the open viaduct starts
        const k = low(i) ? j : i, yb = S[k].pos.y - 1.8, P = (lat, y) => { const p = side(k, lat); p[1] = y; return p; };
        for (const s of [1, -1]) quad4(P(-L, GROUND), P(L, GROUND), P(L, yb), P(-L, yb), [S[k].tan.x * s, 0, S[k].tan.z * s], '#666972');
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.computeVertexNormals();
      const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
      deck.castShadow = deck.receiveShadow = true;
      world.add(deck);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
      world.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: '#2de2ff', toneMapped: false, side: THREE.DoubleSide })));
    }
    for (let i = 0; i < N; i += Math.round(22 / sp)) {
      if (low(i)) continue;
      const top = S[i].pos.y - 1.8, ang = head[i];
      for (const lat of [-8.5, 8.5]) { const [x, , z] = side(i, lat); B.conc.push(tint(box(2.3, top - 1.3 - GROUND + 0.3, 2.3, x, (top - 1.3 + GROUND - 0.3) / 2, z, ang), '#6f727b')); }
      B.conc.push(tint(box(2 * L - 1, 1.3, 2.6, S[i].pos.x, top - 0.65, S[i].pos.z, ang), '#6a6d76'));
    }
  }

  // ---------------------------------------------------------------- streetlights right behind both barriers
  const lamps = [];   // { x, z, y0, y1, ang, reach, c }
  {
    const step = Math.round(30 / sp);
    for (const sg of [1, -1]) for (let i = sg > 0 ? 0 : step >> 1; i < N; i += step) {
      const [x, y, z] = side(i, sg * (W2 + 10.4));
      lamps.push({ x, z, y0: y - 0.25, y1: y + 9.5, ang: Math.atan2(-R[i].x * sg, -R[i].z * sg), reach: 5.4, c: '#ffe6bf', floor: y, road: true });
    }
  }

  // ---------------------------------------------------------------- elevated expressways around the course, with traffic
  const traffic = [];
  {
    const northZ = maxZ + 68, lines = [
      [minX - 58, cz - 700, minX - 58, cz + 700, 12], [maxX + 88, cz - 700, maxX + 88, cz + 700, 12],
      [cx - 700, northZ, cx + 700, northZ, 19.5],
    ];
    for (const [ax, az, bx, bz, deck] of lines) {
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, ang = Math.atan2(ux, uz), px = uz, pz = -ux;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, ns = Math.abs(uz) > 0.5;
      B.conc.push(tint(box(14, 1.6, L, mx, deck - 0.8, mz, ang), '#6d707a'));
      for (const s of [1, -1]) {
        B.conc.push(tint(box(0.5, 0.5, L, mx + px * s * 6.75, deck + 0.25, mz + pz * s * 6.75, ang), '#80838c'));
        B.neon.push(tint(box(0.12, 0.22, L, mx + px * s * 7.04, deck - 0.5, mz + pz * s * 7.04, ang), '#2fb8ff'));
      }
      for (let s = 16; s < L - 8; s += 34) {
        const x = ax + ux * s, z = az + uz * s, top = deck - 1.6 - 1.3;
        if (!api.isFree(x, z, 3)) continue;
        B.conc.push(tint(box(2.4, top - GROUND + 0.3, 2.4, x, (top + GROUND - 0.3) / 2, z, ang), '#62656e'));
        B.conc.push(tint(box(11.5, 1.3, 2.6, x, top + 0.65, z, ang), '#686b74'));
      }
      for (let s = 20, k = 0; s < L; s += 40, k++) {
        const x = ax + ux * s, z = az + uz * s, sg = k % 2 ? 1 : -1;
        if (ns && Math.abs(z - northZ) < 16) continue;   // would poke through the higher deck
        lamps.push({ x: x + px * sg * 6.75, z: z + pz * sg * 6.75, y0: deck, y1: deck + 7.5, ang: Math.atan2(-px * sg, -pz * sg), reach: 2.4, c: '#ffa94d', floor: deck });
      }
      for (let s = 0; s <= L; s += 14) api.block(ax + ux * s, az + uz * s, 9);
      for (const dir of [1, -1]) for (let k = 0; k < 13; k++) {
        traffic.push({ ax: ax + px * dir * 3.4, az: az + pz * dir * 3.4, ux, uz, L, dir, ang: dir > 0 ? ang : ang + Math.PI, s: rnd() * L, v: range(19, 31), y: deck + 0.8 });
      }
    }
  }

  // ---------------------------------------------------------------- landmarks: Ferris wheel and TV spire
  let wheel = null, spokeMat = null;
  {
    const x = minX - 140, z = maxZ - 14, Rw = 30, hubY = GROUND + Rw + 6;
    if (api.isFree(x, z, 36)) {
      api.block(x, z, 36);
      const outer = new THREE.Group();
      outer.position.set(x, 0, z); outer.rotation.y = Math.atan2(cx - x, cz - z);   // axis toward the course
      outer.updateMatrix();
      const V = (a, b, c) => new THREE.Vector3(a, b, c);
      const frame = [];
      for (const zs of [1, -1]) for (const xs of [1, -1]) frame.push(tint(beam(V(xs * 17, GROUND, zs * 6.5), V(0, hubY, zs * 2.6), 0.9), '#c3c8d4'));
      frame.push(tint(new THREE.CylinderGeometry(1.3, 1.3, 7, 12).rotateX(Math.PI / 2).translate(0, hubY, 0), '#9aa0ad'));
      frame.push(tint(box(16, 3.2, 9, 0, GROUND + 1.6, 9), '#2a2c33'));
      for (const g of frame) B.conc.push(g.applyMatrix4(outer.matrix));
      B.neon.push(tint(box(16.2, 0.3, 9.2, 0, GROUND + 3.3, 9), '#ff2bd6').applyMatrix4(outer.matrix));
      const spin = new THREE.Group();
      spin.position.y = hubY;
      const rims = [];
      for (const zs of [1, -1]) {
        rims.push(new THREE.TorusGeometry(Rw, 0.3, 6, 180).translate(0, 0, zs * 2.6), new THREE.TorusGeometry(Rw * 0.3, 0.22, 5, 60).translate(0, 0, zs * 2.6));
      }
      const rim = mergeGeometries(rims), rp = rim.attributes.position, rc = new Float32Array(rp.count * 3);
      for (let i = 0; i < rp.count; i++) {
        col.setHSL(((Math.atan2(rp.getY(i), rp.getX(i)) / TAU) + 1) % 1, 1, 0.58, THREE.SRGBColorSpace);
        rc.set([col.r, col.g, col.b], i * 3);
      }
      rim.setAttribute('color', new THREE.BufferAttribute(rc, 3));
      spin.add(new THREE.Mesh(rim, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
      const spokes = [];
      for (let k = 0; k < 24; k++) {
        const a = k / 24 * TAU, c = Math.cos(a), s = Math.sin(a);
        for (const zs of [1, -1]) spokes.push(beam(V(c * Rw * 0.3, s * Rw * 0.3, zs * 2.6), V(c * Rw, s * Rw, zs * 2.6), 0.22));
      }
      spokeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
      spin.add(new THREE.Mesh(mergeGeometries(spokes), spokeMat));
      const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 2.5, 2.2), new THREE.MeshBasicMaterial({ toneMapped: false }), 24);
      for (let k = 0; k < 24; k++) cabins.setColorAt(k, col.setHSL(k / 24, 0.55, 0.42, THREE.SRGBColorSpace));
      cabins.frustumCulled = false;
      outer.add(spin, cabins);
      world.add(outer);
      wheel = { spin, cabins, Rw, hubY, d: new THREE.Object3D() };
    }
  }
  let spireMat = null;
  {
    const x = minX - 10, z = minZ - 210, H = 175;
    if (api.isFree(x, z, 22)) {
      api.block(x, z, 22);
      B.conc.push(tint(new THREE.CylinderGeometry(2.4, 9.5, H, 16).translate(x, GROUND + H / 2, z), '#b8bdc9'));
      B.conc.push(tint(new THREE.CylinderGeometry(12.5, 8.5, 9, 28).translate(x, GROUND + 138, z), '#9aa0ad'));
      B.conc.push(tint(new THREE.CylinderGeometry(7.8, 7.8, 5, 24).translate(x, GROUND + 168, z), '#9aa0ad'));
      B.conc.push(tint(new THREE.CylinderGeometry(0.45, 1.5, 58, 8).translate(x, GROUND + H + 29, z), '#c9ced8'));
      B.neon.push(tint(new THREE.CylinderGeometry(12.56, 11.2, 3, 28, 1, true).translate(x, GROUND + 138.5, z), '#ffd9a0'));
      const rAt = y => lerp(9.5, 2.4, y / H) + 0.3;
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, c = Math.cos(a), s = Math.sin(a);
        B.spire.push(beam(new THREE.Vector3(x + c * rAt(0), GROUND, z + s * rAt(0)), new THREE.Vector3(x + c * rAt(133), GROUND + 133, z + s * rAt(133)), 0.5));
      }
      for (const y of [30, 60, 90, 120]) B.spire.push(new THREE.TorusGeometry(rAt(y) + 0.1, 0.3, 6, 48).rotateX(Math.PI / 2).translate(x, GROUND + y, z));
      for (const [r, y] of [[12.7, 142.6], [12.7, 133.6], [8, 170.6]]) B.spire.push(new THREE.TorusGeometry(r, 0.35, 6, 64).rotateX(Math.PI / 2).translate(x, GROUND + y, z));
      halo(x, GROUND + H + 58.5, z, '#ff2020', 9, 1.4, 1);
      for (let k = 0; k < 4; k++) halo(x + Math.cos(k * TAU / 4) * 12.8, GROUND + 143, z + Math.sin(k * TAU / 4) * 12.8, '#ff2020', 5, 1.2, 1);
      spireMat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', toneMapped: false });
    }
  }

  // ---------------------------------------------------------------- billboards on the outside of the big corners, facing the approach
  {
    const corners = [];
    for (let i = 0; i < N; i++) {
      const a = Math.abs(turn(i, 18));
      if (a < 0.9 || a < Math.abs(turn((i + 1) % N, 18)) || a < Math.abs(turn((i + N - 1) % N, 18))) continue;
      if (corners.some(c => Math.min(Math.abs(c - i), N - Math.abs(c - i)) < 100)) continue;
      corners.push(i);
    }
    let ad = 0;
    for (const i of corners) {
      const out = turn(i, 18) > 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const [x, , z] = side(i, out * (W2 + 22 + k * 7));
        if (!api.isFree(x, z, 10)) continue;
        api.block(x, z, 10);
        const t = S[(i - 85 + N) % N].pos, m = new THREE.Matrix4().makeRotationY(Math.atan2(t.x - x, t.z - z)).setPosition(x, 0, z);
        for (const px of [-5, 5]) B.conc.push(tint(box(0.7, 8.6, 0.7, px, GROUND + 4.3, -0.6), '#2a2d35').applyMatrix4(m));
        B.conc.push(tint(box(18.8, 9.8, 0.5, 0, GROUND + 12.9, -0.3), '#23252c').applyMatrix4(m));
        B.neon.push(tint(box(18.8, 0.18, 0.6, 0, GROUND + 7.95, 0.1), '#fff1d0').applyMatrix4(m));
        const g = new THREE.PlaneGeometry(18, 9), uv = g.attributes.uv, a = ad++ % ADS.length, c = AD_CELLS[a];
        for (let v = 0; v < 4; v++) uv.setXY(v, c.u0 + uv.getX(v) * c.uw, c.v0 + uv.getY(v) * c.vh);
        B.ad.push(g.translate(0, GROUND + 12.9, 0.02).applyMatrix4(m));
        const gp = new THREE.Vector3(0, GROUND + 12.9, 1).applyMatrix4(m);
        glint(gp.x, gp.y, gp.z, new THREE.Color(ADS[a].bg[0]).lerp(new THREE.Color(ADS[a].bg[1]), 0.5), 16, 0.22);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- city blocks: towers, neon, shop fronts, street signs
  const WCELL = 3.2 * 32, FLOOR = 3.6 * 32, ROOF = [0.5 / 512, 1 - 0.5 / 512];
  const part = (st, x, z, w, d, y0, y1, ou, ov) => {   // one box of a building, windows aligned to floors from street level
    const g = new THREE.BoxGeometry(w, y1 - y0, d).translate(x, (y0 + y1) / 2, z), uv = g.attributes.uv;
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) uv.setXY(i, ROOF[0], ROOF[1]);
      else uv.setXY(i, ou + uv.getX(i) * (f < 2 ? d : w) / WCELL, ov + (y0 - GROUND + uv.getY(i) * (y1 - y0)) / FLOOR);
    }
    B.tower[st].push(g);
  };
  const streetFront = (x, z, w, d, h) => {   // shop front, blade sign, facade sign / rooftop sign on the face toward the road
    const q = track.nearest(tmp.set(x, 0, z)), dx = q.point.x - x, dz = q.point.z - z, ax = Math.abs(dx) > Math.abs(dz);
    const n = ax ? [Math.sign(dx), 0] : [0, Math.sign(dz)], t = ax ? [0, 1] : [1, 0];
    const half = ax ? d / 2 : w / 2, depth = ax ? w / 2 : d / 2, fx = x + n[0] * depth, fz = z + n[1] * depth;
    const fAng = Math.atan2(n[0], n[1]), bAng = Math.atan2(t[0], t[1]), top = GROUND + h;
    if (rnd() < 0.85) {   // one or two shops on the ground floor, spilling their light onto the pavement
      const sw = half * 1.7, k = sw > 13 ? 2 : 1;
      for (let j = 0; j < k; j++) {
        const c = pick(SHOP_CELLS), o = (j - (k - 1) / 2) * sw / k, w1 = sw / k - 0.4;
        const sx = fx + n[0] * 0.06 + t[0] * o, sz = fz + n[1] * 0.06 + t[1] * o;
        quad(B.shop, c, w1, 3.1, sx, GROUND + 1.6, sz, fAng);
        if (!c.spill) continue;
        col.set(c.spill).multiplyScalar(0.16);
        const P = (a, b) => [sx + t[0] * a + n[0] * b, GROUND + 0.05, sz + t[1] * a + n[1] * b], cs = [0, 1, 1, 0], ls = [-w1 / 2 - 1.5, -w1 / 2 + 1, w1 / 2 - 1, w1 / 2 + 1.5], rs = [0.15, 3, 7.5], rk = [1, 0.45, 0];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 2; b++) {
          const v = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b], [a + 1, b + 1], [a, b + 1]];
          for (const [p, q] of v) { poolP.push(...P(ls[p], rs[q])); const f = cs[p] * rk[q]; poolC.push(col.r * f, col.g * f, col.b * f); }
        }
      }
    }
    const sd = rnd() < 0.5 ? 1 : -1, blades = h > 26 && rnd() < 0.35 ? 2 : 1;
    for (let k = 0; k < blades; k++) {
      if (h < 12 || rnd() > 0.8) break;
      const c = pick(VCELLS), sh = Math.min(9, h - 5), sw = sh / 4, off = (k ? -sd : sd) * (half - 1.4);
      const sx = fx + t[0] * off + n[0] * (0.25 + sw / 2), sz = fz + t[1] * off + n[1] * (0.25 + sw / 2);
      const sy = GROUND + 4.2 + sh / 2 + rnd() * Math.max(0, h - sh - 9) * 0.5, bucket = rnd() < 0.13 ? B.flick : B.sign;
      quad(bucket, c, sw, sh, sx, sy, sz, bAng); quad(bucket, c, sw, sh, sx, sy, sz, bAng + Math.PI);
      halo(sx + n[0] * 0.6, sy, sz + n[1] * 0.6, c.color, sh * 1.25, 0.5);
      glint(sx + n[0] * 0.6, sy, sz + n[1] * 0.6, c.color, sh * 1.3, 0.22);
    }
    if (half > 4.5 && rnd() < 0.65) {
      const c = pick(HCELLS), sw = Math.min(half * 2 - 5, 13), sh = sw / 4;
      const sy = GROUND + 5.6 + sh / 2 + rnd() * Math.max(0, Math.min(h, 34) - 9 - sh);
      if (sw > 5 && sy + sh / 2 < top - 0.6) {
        const off = -sd * 1.2, sx = fx + n[0] * 0.14 + t[0] * off, sz = fz + n[1] * 0.14 + t[1] * off;
        quad(rnd() < 0.1 ? B.flick : B.sign, c, sw, sh, sx, sy, sz, fAng);
        halo(sx + n[0] * 1.2, sy, sz + n[1] * 1.2, c.color, sw * 0.9, 0.35);
        glint(sx + n[0] * 1.2, sy, sz + n[1] * 1.2, c.color, sw, 0.18);
      }
    }
    if (h < 24 && half > 4 && rnd() < 0.35) {
      const c = pick(HCELLS), sw = Math.min(half * 2 - 1, 16), sh = sw / 4, sx = fx - n[0] * 0.6, sz = fz - n[1] * 0.6;
      quad(B.sign, c, sw, sh, sx, top + 0.5 + sh / 2, sz, fAng);
      for (const o of [-0.35, 0.35]) B.conc.push(tint(box(0.25, 0.6, 0.25, sx + t[0] * o * sw - n[0] * 0.3, top + 0.3, sz + t[1] * o * sw - n[1] * 0.3), '#2a2d35'));
      halo(sx + n[0] * 1.5, top + 0.5 + sh / 2, sz + n[1] * 1.5, c.color, sw, 0.35);
      glint(sx + n[0] * 1.5, top + 0.5 + sh / 2, sz + n[1] * 1.5, c.color, sw, 0.15);
    }
  };
  const towns = [[cx + 40, maxZ + 250], [maxX + 230, cz - 40], [minX - 210, minZ - 60]];
  const hot = (x, z) => Math.max(...towns.map(([a, b]) => Math.exp(-((x - a) ** 2 + (z - b) ** 2) / (170 * 170))));
  const CELL = 27, EXT = 430;
  for (let gx = minX - EXT; gx < maxX + EXT; gx += CELL) for (let gz = minZ - EXT; gz < maxZ + EXT; gz += CELL) {
    const x = gx + range(-5, 5), z = gz + range(-5, 5);
    if (Math.hypot(x - cx, z - cz) > 840) continue;
    const dist = api.near(x, z)[0], far = smooth(50, 280, dist);
    if (rnd() < 0.1 + far * 0.15) continue;   // plazas / parking
    const w = range(11, 19 + far * 12), d = range(11, 19 + far * 12), r = Math.hypot(w, d) / 2;
    let h = lerp(8 + Math.pow(rnd(), 1.3) * 34, 28 + Math.pow(rnd(), 1.6) * 110, far) * (1 + hot(x, z) * 1.1);
    if (rnd() < 0.04 * far) h *= 1.6;
    if (!clearOf(x, z, r, h > 9)) continue;
    api.block(x, z, r);
    const st = dist < 90 ? (rnd() < 0.6 ? 0 : 2) : h > 70 ? (rnd() < 0.55 ? 1 : 3) : Math.floor(rnd() * 4);
    const ou = Math.floor(rnd() * 32) / 32, ov = Math.floor(rnd() * 32) / 32;
    let top = GROUND + h, tw = w, td = d, base = GROUND - 0.5;
    if (h > 55 && rnd() < 0.55) {   // podium + slimmer tower
      base = GROUND + range(10, 22);
      part(st, x, z, w, d, GROUND - 0.5, base, ou, ov);
      tw = w * range(0.6, 0.8); td = d * range(0.6, 0.8);
    }
    part(st, x, z, tw, td, base, top, ou, ov);
    if (h > 70 && rnd() < 0.35) {   // stepped crown
      const ch = range(6, 14);
      tw *= 0.62; td *= 0.62;
      part(st, x, z, tw, td, top, top + ch, ou, ov);
      top += ch;
    }
    if (h > 45 && rnd() < 0.4) {
      const c = pick(NEON);
      B.neon.push(tint(box(tw + 0.35, 0.9, td + 0.35, x, top - 1.6, z), c));
      if (rnd() < 0.5) B.neon.push(tint(box(tw + 0.35, 0.45, td + 0.35, x, top - 4.2, z), c));
    }
    if (h > 80 && rnd() < 0.22) {
      const c = pick(NEON), y0 = Math.max(base, GROUND), hh = top - 2.5 - y0;
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.neon.push(tint(box(0.35, hh, 0.35, x + sx * (tw / 2 + 0.05), y0 + hh / 2, z + sz * (td / 2 + 0.05)), c));
    }
    if (h < 45) {
      if (rnd() < 0.7) { const bh = range(1.5, 3.5); B.conc.push(tint(box(range(2, 5), bh, range(2, 5), x + range(-tw, tw) / 4, top + bh / 2, z + range(-td, td) / 4), '#3a3d45')); }
    } else if (rnd() < 0.45) {
      const mh = range(8, 22);
      B.conc.push(tint(box(0.5, mh, 0.5, x, top + mh / 2, z), '#50535c'));
      top += mh;
    }
    if (top > 85) halo(x, top + 0.6, z, '#ff2020', 5, 1.2, 1);
    if (dist < 75 && h > 8) streetFront(x, z, w, d, h);
  }

  // ---------------------------------------------------------------- meshes
  WINDOWS.forEach((st, i) => {
    const tex = api.canvasTex(512, 512, paintWindows(st));
    const m = add(B.tower[i], new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: st.glow, roughness: 0.7, metalness: 0.1 }), true);
    if (m) m.receiveShadow = false;
  });
  add(B.conc, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), true);
  add(B.neon, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const signTex = api.canvasTex(1024, 1024, paintSigns, false), adTex = api.canvasTex(1024, 1024, paintAds, false);
  add(B.sign, new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
  const flickMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  add(B.flick, flickMat);
  add(B.ad, new THREE.MeshBasicMaterial({ map: adTex, color: '#dddddd', toneMapped: false }));
  add(B.shop, new THREE.MeshBasicMaterial({ map: api.canvasTex(1024, 512, paintShops, false), color: '#e6e6e6', toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  if (spireMat) add(B.spire, spireMat);

  // streetlights: poles, arms, heads, faint light cones (instanced), glow halos
  {
    const n = lamps.length, d = new THREE.Object3D();
    const metal = new THREE.MeshStandardMaterial({ color: '#3a3e47', metalness: 0.6, roughness: 0.45 });
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.17, 1, 7).translate(0, 0.5, 0), metal, n);
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 1).translate(0, 0, 0.5), metal, n);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.18, 1.3).translate(0, -0.1, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({
      uniforms: fogU(),
      vertexShader: `uniform float fogNear; uniform float fogFar; varying float vA; varying vec3 vC;
        void main(){ vec4 p = vec4(position, 1.0); vC = vec3(1.0, 0.9, 0.75);
          #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          #endif
          #ifdef USE_INSTANCING_COLOR
          vC = instanceColor;
          #endif
          vec3 n = normal;
          #ifdef USE_INSTANCING
          n = mat3(instanceMatrix) * n;
          #endif
          vec4 mv = modelViewMatrix * p; float facing = abs(dot(normalize(normalMatrix * n), normalize(-mv.xyz)));
          vA = pow(uv.y, 1.5) * smoothstep(0.0, 0.3, uv.y) * facing * facing * (1.0 - smoothstep(fogNear * 0.3, fogFar * 0.5, -mv.z));
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ gl_FragColor = vec4(vC * vA * 0.075, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }), n);
    lamps.forEach((l, i) => {
      const fx = Math.sin(l.ang), fz = Math.cos(l.ang), hx = l.x + fx * (l.reach - 0.4), hz = l.z + fz * (l.reach - 0.4);
      d.rotation.set(0, l.ang, 0);
      d.position.set(l.x, l.y0, l.z); d.scale.set(1, l.y1 - l.y0, 1); d.updateMatrix(); poles.setMatrixAt(i, d.matrix);
      d.position.set(l.x, l.y1 - 0.1, l.z); d.scale.set(1, 1, l.reach); d.updateMatrix(); arms.setMatrixAt(i, d.matrix);
      d.position.set(hx, l.y1, hz); d.scale.set(1, 1, 1); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
      const ch = l.y1 - 0.2 - l.floor, rr = ch * 0.36;
      d.position.set(hx, l.y1 - 0.2, hz); d.scale.set(rr, ch, rr); d.updateMatrix(); cones.setMatrixAt(i, d.matrix);
      col.set(l.c); heads.setColorAt(i, col); cones.setColorAt(i, col);
      halo(hx, l.y1 - 0.3, hz, l.c, 3.6, 0.6);
      if (l.road) { glint(hx, l.y1 - 0.3, hz, l.c, 5, 0.3); l.hx = hx; l.hz = hz; }
    });
    poles.castShadow = arms.castShadow = true;
    world.add(poles, arms, heads, cones);
  }

  // expressway traffic: white head lamps in front, red tail lamps behind
  const cars = new THREE.InstancedMesh(mergeGeometries([
    tint(box(0.45, 0.24, 0.2, 0.72, 0, 2.05), '#fff6e0'), tint(box(0.45, 0.24, 0.2, -0.72, 0, 2.05), '#fff6e0'),
    tint(box(0.45, 0.2, 0.2, 0.72, 0, -2.05), '#ff1a1a'), tint(box(0.45, 0.2, 0.2, -0.72, 0, -2.05), '#ff1a1a'),
  ]), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), traffic.length);
  cars.frustumCulled = false;
  world.add(cars);
  const carD = new THREE.Object3D();
  const moveTraffic = dt => {
    traffic.forEach((c, i) => {
      c.s = ((c.s + c.dir * c.v * dt) % c.L + c.L) % c.L;
      carD.position.set(c.ax + c.ux * c.s, c.y, c.az + c.uz * c.s);
      carD.rotation.set(0, c.ang, 0);
      carD.updateMatrix();
      cars.setMatrixAt(i, carD.matrix);
    });
    cars.instanceMatrix.needsUpdate = true;
  };

  // glow halos (signs, lamps, aviation lights) as one additive point cloud
  const hn = halos.length / 8, hp = new Float32Array(hn * 3), hc = new Float32Array(hn * 3), hs = new Float32Array(hn), hb = new Float32Array(hn);
  for (let i = 0; i < hn; i++) { const o = i * 8; hp.set(halos.slice(o, o + 3), i * 3); hc.set(halos.slice(o + 3, o + 6), i * 3); hs[i] = halos[o + 6]; hb[i] = halos[o + 7]; }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  hg.setAttribute('hcol', new THREE.BufferAttribute(hc, 3));
  hg.setAttribute('hsize', new THREE.BufferAttribute(hs, 1));
  hg.setAttribute('hblink', new THREE.BufferAttribute(hb, 1));
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 500 }, blink: { value: 1 }, ...fogU() },
    vertexShader: `attribute vec3 hcol; attribute float hsize; attribute float hblink; uniform float scale; uniform float blink; uniform float fogNear; uniform float fogFar; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
        vC = hcol * mix(1.0, blink, hblink) * (1.0 - smoothstep(fogNear, fogFar * 1.1, d));
        gl_PointSize = clamp(hsize * scale / max(d, 1.0), 1.5, 600.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC;
      void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.4);
        gl_FragColor = vec4(vC * a, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const haloPts = new THREE.Points(hg, haloMat);
  haloPts.renderOrder = 2;
  haloPts.onBeforeRender = (r, s, cam) => { r.getCurrentViewport(vp); haloMat.uniforms.scale.value = vp.w * cam.projectionMatrix.elements[5] * 0.5; };
  world.add(haloPts);

  // light pools under the streetlights, draped over road, curbs and run-off (+ the shop spills built above), one additive mesh
  {
    const RR = 11, lit = lamps.filter(l => l.road), warm = new THREE.Color();
    const lats = [0, 3.5, W2 - 0.4, W2 + 0.3, W2 + 1.6, W2 + 2.5, W2 + 3.1, W2 + 6, W2 + 9.8];
    const cols = [...lats.slice(1).reverse().map(a => -a), ...lats];
    const lift = (i, a) => (a < W2 - 0.3 ? 0.06 : a < W2 + 1.7 ? 0.14 : a < W2 + 2.6 ? 0.04 : S[i].pos.y >= 0.1 ? -0.08 : GROUND + 0.05 - S[i].pos.y);
    const rows = [];
    for (let i = 0; i < N; i += 2) rows.push(cols.map(lat => {
      const [x, y, z] = side(i, lat, lift(i, Math.abs(lat)));
      let e = 0;
      for (const l of lit) {
        const dx = x - l.hx, dz = z - l.hz;
        if (Math.abs(dx) < RR && Math.abs(dz) < RR) { const q = 1 - (dx * dx + dz * dz) / (RR * RR); if (q > 0) e += q * q; }
      }
      warm.set('#ffd9a8').multiplyScalar(Math.min(e, 1.3) * 0.14);
      return [x, y, z, warm.r, warm.g, warm.b];
    }));
    for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length - 1; c++) {
      const A = rows[r], Bn = rows[(r + 1) % rows.length], q = [A[c], A[c + 1], Bn[c + 1], Bn[c]];
      if (q.every(v => v[3] + v[4] + v[5] < 0.002)) continue;
      for (const k of [0, 1, 2, 0, 2, 3]) { poolP.push(q[k][0], q[k][1], q[k][2]); poolC.push(q[k][3], q[k][4], q[k][5]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(poolP, 3));
    g.setAttribute('pcol', new THREE.Float32BufferAttribute(poolC, 3));
    const pools = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: fogU(),
      vertexShader: `attribute vec3 pcol; uniform float fogNear; uniform float fogFar; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vC = pcol * (1.0 - smoothstep(fogNear, fogFar * 0.8, -mv.z)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC;
        void main(){ gl_FragColor = vec4(vC, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    }));
    pools.renderOrder = 1;
    world.add(pools);
  }

  // wet asphalt: each light next to the road leaves a streak on the road where it mirrors toward the camera. The streak is a
  // ground quad (6 verts) spread along the camera->light line through the mirror point, so it depth-tests like the road.
  {
    const n = glints.length / 7, V = 6, p = new Float32Array(n * V * 3), c = new Float32Array(n * V * 3), s = new Float32Array(n * V * 2), k = new Float32Array(n * V * 2), idx = [];
    const corners = [-1, -1, 1, -1, -1, 0, 1, 0, -1, 1, 1, 1];
    for (let i = 0; i < n; i++) {
      const o = i * 7, lat = api.near(glints[o], glints[o + 2])[0];
      for (let v = 0; v < V; v++) {
        const j = i * V + v;
        p.set(glints.slice(o, o + 3), j * 3); c.set(glints.slice(o + 3, o + 6), j * 3);
        s.set([glints[o + 6], lat], j * 2); k.set([corners[v * 2], corners[v * 2 + 1]], j * 2);
      }
      const b = i * V;
      idx.push(b, b + 1, b + 3, b, b + 3, b + 2, b + 2, b + 3, b + 5, b + 2, b + 5, b + 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('hcol', new THREE.BufferAttribute(c, 3));
    g.setAttribute('hsl', new THREE.BufferAttribute(s, 2));
    g.setAttribute('corner', new THREE.BufferAttribute(k, 2));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { floorY: { value: 0 }, edge: { value: 999 } },
      vertexShader: `attribute vec3 hcol; attribute vec2 hsl; attribute vec2 corner; uniform float floorY; uniform float edge; varying vec3 vC; varying vec2 vQ;
        void main(){ float hc = cameraPosition.y - floorY, hl = position.y - floorY;
          vec2 dv = position.xz - cameraPosition.xz; float D = max(length(dv), 0.01); vec2 dir = dv / D, rt = vec2(-dir.y, dir.x);
          float dp = D * hc / max(hc + hl, 0.01);   // plan distance to the mirror point
          float ok = step(0.3, hc) * step(1.0, hl) * step(hsl.y * dp / D, edge);
          float along = corner.y < 0.0 ? corner.y * dp * 0.35 : corner.y * (D - dp) * 0.75;
          vec2 xz = cameraPosition.xz + dir * (dp + along) + rt * corner.x * dp * (0.012 + hsl.x * 0.002);
          vQ = corner;
          vC = hcol * ok * (1.0 - smoothstep(60.0, 170.0, D)) * smoothstep(6.0, 14.0, dp);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(xz.x, floorY + 0.04, xz.y, 1.0); }`,
      fragmentShader: `varying vec3 vC; varying vec2 vQ;
        void main(){ float t = 1.0 - abs(vQ.y), a = (exp(-vQ.x * vQ.x * 5.0) - 0.0067) * t * t * (vQ.y > 0.0 ? 1.0 : t);
          gl_FragColor = vec4(vC * max(a, 0.0), 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6,
    });
    const streaks = new THREE.Mesh(g, mat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 1;
    streaks.onBeforeRender = (r, sc, cam) => {   // the mirror plane is the road under this view's camera
      const q = track.nearest(cam.position, cam.userData.glintHint);
      cam.userData.glintHint = q.index;
      mat.uniforms.floorY.value = q.point.y + 0.03;
      mat.uniforms.edge.value = q.point.y > 1 ? W2 + 9.5 : 999;   // up on the viaduct nothing may hang past the deck edge
    };
    world.add(streaks);
  }

  // a few coloured neon spill lights on the road (the theme's whole real-light budget: 3 of the allowed 4)
  for (const [f, c] of [[0.07, '#ff3cac'], [0.47, '#2de2ff'], [0.8, '#ffae42']]) {
    const i = Math.floor(f * N), [x, y, z] = side(i, (turn(i, 30) > 0 ? 1 : -1) * (W2 + 9));
    const L = new THREE.PointLight(c, 420, 75, 2);
    L.position.set(x, y + 6.5, z);
    world.add(L);
  }

  // ---------------------------------------------------------------- animation
  let t = 0;
  const animate = dt => {
    t += dt; time.value = t;
    haloMat.uniforms.blink.value = t % 1.5 < 0.2 ? 1 : 0.05;
    const r = Math.sin(Math.floor(t * 15) * 91.7) * 43758.5453 % 1;
    flickMat.color.setScalar(t % 5.3 < 0.8 && Math.abs(r) < 0.55 ? 0.12 : 1);
    if (wheel) {
      wheel.spin.rotation.z = t * 0.05;
      for (let k = 0; k < 24; k++) {
        const a = wheel.spin.rotation.z + k / 24 * TAU;
        wheel.d.position.set(Math.cos(a) * wheel.Rw, wheel.hubY + Math.sin(a) * wheel.Rw - 1.8, 0);
        wheel.d.updateMatrix();
        wheel.cabins.setMatrixAt(k, wheel.d.matrix);
      }
      wheel.cabins.instanceMatrix.needsUpdate = true;
      spokeMat.color.setHSL(t * 0.04 % 1, 0.9, 0.6, THREE.SRGBColorSpace);
    }
    if (spireMat) spireMat.color.setHSL(0.5 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.25)), 0.85, 0.6, THREE.SRGBColorSpace);
    moveTraffic(dt);
  };
  animate(0);
  api.onUpdate(animate);
}

export default { env, build };
