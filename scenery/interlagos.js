// Autódromo de Interlagos, São Paulo (hazy spring day, sun in the north). The course sits in a bowl ringed by the
// city: brick-and-paint houses with blue water tanks climbing the slopes, white apartment towers on the ridges,
// a lake in the infield and a larger one beyond the back straight, tropical trees with flowering ipês, the long
// main grandstand opposite the pits, and the skyline haze on the northern horizon.
import * as THREE from 'three';
import { TRACK_BY_ID } from '../tracks.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, loopMask, smooth, lerp, paintWindows, seeded } = await import(`./montreal.js${new URL(import.meta.url).search}`);

const WATER = -1.2;
const inLoop = loopMask(TRACK_BY_ID.interlagos.points);
const LAKES = [[430, -240, 62], [700, -150, 105]];   // infield lake, and one ~50 m off the back straight
function lakeD(x, z) {   // distance outside the nearest (lobed) lake shore, negative in the water
  let m = Infinity;
  for (const [lx, lz, r] of LAKES) {
    const d = Math.hypot(x - lx, z - lz);
    if (d - 1.28 * r > 95) { m = Math.min(m, d - 1.28 * r); continue; }   // far: the lobes don't matter
    const a = Math.atan2(z - lz, x - lx);
    m = Math.min(m, d - r * (1 + 0.18 * Math.sin(3 * a + lx) + 0.1 * Math.sin(5 * a + lz)));
  }
  return m;
}
// neighbourhood type: > 0.62 dense self-built houses, < 0.2 green gaps, between: streets of houses + towers
const zone = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.0061 + 1.1) * Math.cos(z * 0.0055 - 0.3) + 0.35 * Math.sin(x * 0.017 + z * 0.013);

function height(x, z, y, dist) {
  const k = smooth(19, 70, dist);
  let h = inLoop(x, z) ? 7 * smooth(20, 170, dist) : 62 * Math.pow(smooth(25, 650, dist), 0.7);
  h += (Math.sin(x * 0.0083 + 0.7) * Math.cos(z * 0.0071 + 1.9) * 0.5 + 0.5) * 22 * smooth(60, 420, dist) + 4 * Math.sin(x * 0.017 - z * 0.023) * smooth(40, 200, dist);
  const land = y + h * k, ld = lakeD(x, z);
  if (ld > 90) return land;
  if (ld >= 0) return lerp(WATER + 0.8, land, smooth(0, 90, ld));
  return lerp(WATER + 0.8, WATER - 1.5 - Math.min(4, -ld * 0.08), smooth(0, 10, -ld));
}
function paintGround(g, w, h) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 30; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 1200; i++) { const v = 110 + Math.random() * 90; g.fillStyle = `rgba(${v},${v},${v},0.45)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3); }
}

const ENV = {
  sky: { top: '#4a86cf', horizon: '#d9dedd', bottom: '#b0b4a8' },
  fog: { color: '#d7dcdb', near: 320, far: 2100 },
  sun: { dir: [0.28, 0.72, -0.62], color: '#fff3dc', intensity: 2.9 },
  hemi: { sky: '#dbe8f5', ground: '#6d6a4a', intensity: 0.9 },
  exposure: 1.02,
  envIntensity: 0.4,
  night: false,
  terrain: { base: '#9a9a9a', paint: paintGround, hills: 0, rim: 0, rimColor: '#7a7f5a', height },
  shoulder: '#a39a86',
  curb: ['#1f9e4a', '#f4f4f4'],
};

function paintCity(g, w, h, X, Y) {
  const rand = seeded(1940);
  const rect = (b0, b1, e0, e1, c) => { g.fillStyle = c; g.fillRect(X(b0), Y(e1), Math.max(1, X(b1) - X(b0)), Y(e0) - Y(e1)); };
  g.fillStyle = '#8fa39a'; g.beginPath(); g.moveTo(X(120), Y(0));   // coastal range far to the south
  for (let b = 120; b <= 240; b++) g.lineTo(X(b), Y(0.012 + 0.01 * Math.sin(b * 0.21) * Math.sin(b * 0.07 + 1)));
  g.lineTo(X(240), Y(0)); g.fill();
  for (let b = 0; b < 360; b += 0.3) {   // the endless city: low roofs everywhere, taller in the north
    const north = Math.max(0, Math.cos((b - 5) * Math.PI / 180));
    rect(b, b + 0.34, -0.01, 0.004 + rand() * (0.006 + 0.012 * north), rand() < 0.5 ? '#9a9c98' : '#a8a79f');
    if (rand() < 0.05 + 0.3 * north * north) rect(b, b + 0.2 + rand() * 0.5, -0.01, 0.01 + rand() * (0.012 + 0.03 * north * north), ['#b8bab6', '#c9c8c0', '#8f9699'][Math.floor(rand() * 3)]);
  }
}

function build(api) {
  const K = kit(api), { W2, R, pick } = K, { track, rnd } = api;
  const near = K.dist, G = (x, z) => api.groundAt(x, z), b = track.bounds;

  // ---- ground colours: mown grass inside the circuit, dusty red earth + packed ground under the neighbourhoods
  {
    const tex = 0.323, pal = {}, set = (col, hex, k = 1) => { if (k > 0) col.lerp(pal[hex] ||= new THREE.Color(hex).multiplyScalar(1 / tex), k); };
    K.recolor((x, y, z, ny, col) => {
      const d = near(x, z), n = Math.sin(x * 0.047) * Math.cos(z * 0.041) * 0.5 + 0.5;
      col.copy(pal.base ||= new THREE.Color('#5f9444')).multiplyScalar((0.9 + 0.2 * n) / tex);
      if (!inLoop(x, z)) {
        const zn = zone(x, z), city = smooth(55, 95, d);
        set(col, zn > 0.62 ? '#8c6a4f' : zn > 0.2 ? '#8d8676' : '#58853d', city * 0.85);
        set(col, '#94603f', city * smooth(0.7, 0.98, Math.sin(x * 0.023 + 2) * Math.cos(z * 0.019) * 0.5 + 0.5) * 0.6);   // red earth cuts
      }
      set(col, '#8a7d5a', smooth(14, 0, Math.abs(lakeD(x, z))) * 0.8);
      set(col, '#4f8a3a', 1 - smooth(W2 + 14, W2 + 22, d));
    });
  }
  K.water({ y: WATER, deep: '#2a4a3e', shallow: '#4a6e5a', size: 2600, hor: '#9fb7c2', fres: 0.6 });
  K.clouds(320, 14, 0xeef0f0);
  K.panorama(paintCity, { haze: 0.5, y1: 0.07 });

  // ---- pits on the inside (left) of the main straight, the long main grandstand opposite, the Senna S stand
  const pitIdx = K.span(K.idx(-45, -180), K.idx(42, 165));
  const back = K.pits(pitIdx, { side: -1, lane: [K.WALL + 1.4, K.WALL + 13.5], trim: '#1f9e4a', glass: '#34566b' });
  {
    const f = K.frame(K.idx(-52, -205), -(back - 7));
    K.box('solid', 13, 16, 13, f.x, f.y + 8, f.z, f.ry, '#e8e6df');
    K.box('glass', 14, 4, 14, f.x, f.y + 18, f.z, f.ry, '#2f4d63');
    K.box('solid', 16, 0.6, 16, f.x, f.y + 20.3, f.z, f.ry, '#f4f4f0');
    api.block(f.x, f.z, 11);
  }
  const BR = ['#ffdf00', '#ffdf00', '#009c3b', '#009c3b', '#002776', '#ffffff', '#e63946', '#f4f4f4', '#3a3a3a', '#ffb703'];
  K.stand(K.idx(-22, -105), W2 + 15, 170, 20, { roof: false, conc: '#b9b6ae', seat: '#9c9990', shirts: BR, fill: 0.85 });
  K.stand(K.idx(22, 72), W2 + 15, 160, 20, { conc: '#b9b6ae', seat: '#9c9990', shirts: BR, fill: 0.85, trim: '#1f9e4a' });
  K.stand(K.idx(105, 294), W2 + 15, 80, 12, { seat: '#1f9e4a', shirts: BR, trim: '#ffdf00' });
  const arc = (x0, z0, x1, z1) => K.span(K.idx(x0, z0), K.idx(x1, z1));
  K.bank(arc(591, -397, 557, -473), 1, { rows: 10, fill: 0.4, shirts: BR });
  K.bank(arc(360, -632, 347, -721), 1, { rows: 10, fill: 0.4, shirts: BR });
  K.bank(arc(186, 244, 259, 275), -1, { rows: 8, fill: 0.35, shirts: BR });
  K.flushCrowd();

  // ---- apartment towers on the ridges (window-textured, merged), a few with rooftop tanks
  for (let n = 0, tries = 0; n < 210 && tries < 6000; tries++) {
    const x = R(b.minX - 900, b.maxX + 900), z = R(b.minZ - 900, b.maxZ + 900), d = near(x, z), zn = zone(x, z);
    if (d < 190 || d > 1100 || inLoop(x, z) || lakeD(x, z) < 40 || zn > 0.66 || zn < 0.15 || rnd() < 0.35) continue;
    const w = R(14, 24), dd = R(12, 20), h = R(22, 48) + (rnd() < 0.35 ? R(15, 45) : 0), r = Math.hypot(w, dd) / 2;
    if (!K.ok(x, z, r, true)) continue;
    const y = G(x, z) - 2, ry = R(-0.4, 0.4);
    K.tower('win', w, h + 2, dd, x, y, z, ry, pick(['#f2f0ea', '#e9e5da', '#dcdad4', '#efe3d3', '#e3e8ea', '#f0e6e0']), 24, 25.6);
    K.box('solid', w * 0.35, 3, dd * 0.35, x, y + h + 3.5, z, ry, '#cfcbc2');
    api.block(x, z, r + 2);
    n++;
  }
  const wt = api.canvasTex(256, 256, (g, w, h) => paintWindows(g, w, h, { wall: '#ecebe6', glass: ['#3b4550', '#4d5a66', '#6f7f8c', '#2c343c'], ww: 0.55, wh: 0.5 }));
  K.flush('win', new THREE.MeshStandardMaterial({ map: wt, vertexColors: true, roughness: 0.8 }));

  // ---- houses: a jittered street grid on every slope outside the circuit; dense colourful blocks with blue tanks,
  //      calmer streets with terracotta roofs elsewhere
  {
    const spots = [], houses = [], tanks = [], roofs = [], cell = 9.5;
    for (let gx = b.minX - 520; gx < b.maxX + 520; gx += cell) for (let gz = b.minZ - 520; gz < b.maxZ + 520; gz += cell) {
      const x = gx + R(-1.6, 1.6), z = gz + R(-1.6, 1.6), zn = zone(x, z), fav = zn > 0.62;
      if (zn < 0.2 || (!fav && (Math.round(gx / cell) % 6 === 0 || Math.round(gz / cell) % 5 === 0))) continue;
      if (inLoop(x, z) || lakeD(x, z) < 45) continue;   // open lakeside park
      const d = near(x, z);
      if (d < 72 || rnd() > (fav ? 0.9 : 0.6) * smooth(540, 400, d) || !api.isFree(x, z, 4)) continue;
      spots.push([x, z, gx, gz, fav]);
    }
    for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
    for (const [x, z, gx, gz, fav] of spots.slice(0, 4300)) {   // random subset under the budget: an even spread, dense zones stay dense
      const w = fav ? R(4.5, 7) : R(6.5, 9), dd = fav ? R(4.5, 7) : R(6.5, 9), h = fav ? 3 + Math.floor(rnd() * 3) * 2.6 : R(3.4, 6.2);
      const y = G(x, z) - 1.5, ry = 0.35 * Math.sin(gx * 0.004 + 1) + 0.3 * Math.cos(gz * 0.0037) + R(-0.08, 0.08);
      const col = fav ? (rnd() < 0.55 ? pick(['#b5653e', '#c47a4a', '#a0522d', '#b86f45']) : pick(['#e9c46a', '#6fb3d2', '#e76f51', '#f4a6c1', '#8ab17d', '#f1faee', '#9fd3c7'])) : pick(['#f1ede4', '#f4e3b5', '#e8d6c0', '#dfe8e6', '#f2d7c4', '#ffffff']);
      houses.push([x, y, z, ry, w, h + 1.5, dd, col]);
      if (fav && rnd() < 0.45) tanks.push([x + R(-1, 1), y + h + 1.5, z + R(-1, 1), 0, 1, 1, 1, '#2f6db5']);
      if (!fav) roofs.push([x, y + h + 1.5, z, ry, w + 0.8, 1, dd + 0.8, pick(['#b4553a', '#a8462f', '#c0674a'])]);
    }
    const hg = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), uv = hg.attributes.uv;
    for (let i = 8; i < 12; i++) uv.setXY(i, 0.03, 0.03);   // roof face → plain corner of the texture
    const ht = api.canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 2; y < h; y += 4) g.fillRect(0, y, w, 1);
      g.fillStyle = '#262b31'; g.fillRect(9, 12, 15, 11); g.fillRect(40, 12, 15, 11); g.fillRect(9, 40, 15, 11); g.fillRect(40, 40, 13, 24);
      g.fillStyle = '#bdb8ae'; g.fillRect(0, h - 5, 5, 5);
    }, false);
    K.inst(hg, new THREE.MeshStandardMaterial({ map: ht, roughness: 0.9 }), houses);
    K.inst(new THREE.CylinderGeometry(0.65, 0.6, 1.1, 5).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), tanks, false);
    K.inst(new THREE.ConeGeometry(0.72, 0.9, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), roofs);
  }

  // ---- tropical trees: the infield park, a green belt round the fences, big trees in the gaps between neighbourhoods
  {
    const list = [], leaf = () => K.col.setHSL(R(0.23, 0.33), R(0.4, 0.6), R(0.14, 0.24)).getHex();
    const kind = () => { const r = rnd(); return r < 0.4 ? 'canopy' : r < 0.7 ? 'broad' : r < 0.85 ? 'round' : 'palm'; };
    const colour = k => (k !== 'palm' && rnd() < 0.07) ? pick(['#d6609f', '#e9c42b', '#c77dce']) : leaf();   // flowering ipês
    for (let tries = 0, n = 0; n < 1350 && tries < 30000; tries++) {
      const x = R(b.minX - 520, b.maxX + 520), z = R(b.minZ - 520, b.maxZ + 520), d = near(x, z), inside = inLoop(x, z);
      if (lakeD(x, z) < 6 || (!inside && d > 70 && zone(x, z) > 0.2 && d < 560)) continue;   // not among the houses
      if (!inside && d > 70 && rnd() < 0.6) continue;
      if (!K.ok(x, z, 3.2, true)) continue;
      const k = kind();
      list.push([x, z, k, R(0.85, 1.35) * (d > 300 ? 1.3 : 1), colour(k)]); n++;
    }
    K.trees(list);
  }

  K.flush('flat', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), false).receiveShadow = true;
  K.flush('solid', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  K.flush('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.7 }));
}

export default { base: 'forest', env: ENV, baseBuild: false, build };
