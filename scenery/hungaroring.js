// Hungaroring, Mogyoród (hot summer day). The course lies in a natural bowl: grass hills rise all round with fans on
// the banks (umbrellas, flags), a patchwork of sunflower / wheat fields on the slopes, small oak and acacia woods,
// the village with its church tower on the western hill, the modern pit building and the main grandstand.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, loopMask, smooth, bump, TAU } = await import(`./montreal.js${new URL(import.meta.url).search}`);

const inLoop = loopMask(TRACK_BY_ID.hungaroring.points);
// natural spectator banks (grass hills right behind the barrier) and the village hill
const BANKS = [[-315, -262, 85, 14], [252, -98, 70, 11], [92, -268, 60, 9], [408, -668, 80, 12], [862, -148, 90, 14], [505, 292, 80, 12], [292, -958, 80, 10]];
const VILLAGE = [-730, -250];
const WOODS = [[-430, -560, 130], [30, -640, 110], [640, -1080, 150], [1080, -430, 140], [1000, 260, 120], [160, 540, 150], [-420, 170, 120], [520, -330, 70], [300, -330, 60], [-120, -420, 80], [760, -600, 70]];
const SUN1 = [175, -470, 0.5, 100, 58], SUN2 = [300, 335, -0.64, 90, 46];   // sunflower fields: x, z, angle, length, width

function height(x, z, y, dist) {
  const k = smooth(19, 67, dist);
  if (k <= 0) return y;
  let h = inLoop(x, z) ? 6 * smooth(20, 160, dist) : 46 * Math.pow(smooth(20, 620, dist), 0.8);
  h += (Math.sin(x * 0.0071 + 1.3) * Math.cos(z * 0.0063 - 0.4) * 0.5 + 0.5) * 16 * smooth(40, 380, dist) + 2.5 * Math.sin(x * 0.021 + z * 0.017);
  for (const [bx, bz, r, e] of BANKS) h += bump(x, z, bx, bz, r, e);
  return y + (h + bump(x, z, VILLAGE[0], VILLAGE[1], 280, 16)) * k;
}
// neutral grass texture: the terrain's vertex colours carry the hue (fields, woods, trampled banks)
function paintGrass(g, w, h) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) { const v = 110 + Math.random() * 90; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3); }
}
const inRect = (x, z, [cx, cz, a, L, W], pad = 0) => {
  const c = Math.cos(a), s = Math.sin(a), u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
  return Math.abs(u) < L / 2 + pad && Math.abs(v) < W / 2 + pad;
};
function parcel(x, z) {
  const a = 0.42, u = x * Math.cos(a) + z * Math.sin(a), v = -x * Math.sin(a) + z * Math.cos(a);
  return Math.abs(Math.sin(Math.floor(u / 160) * 127.1 + Math.floor(v / 100) * 311.7) * 43758.5453) % 1;
}
const FIELDS = [[0.22, '#d9b41c'], [0.42, '#caa652'], [0.55, '#bca271'], [0.72, '#6f9a36'], [0.82, '#7d5f41'], [1.01, '#86a54e']];

const ENV = {
  sky: { top: '#3a7cd4', horizon: '#dde7ee', bottom: '#a9b79c' },
  fog: { color: '#dde6ec', near: 380, far: 2300 },
  sun: { dir: [-0.38, 0.7, 0.52], color: '#fff0d4', intensity: 3.0 },
  hemi: { sky: '#d9ebff', ground: '#6a7a42', intensity: 0.85 },
  exposure: 1.0,
  envIntensity: 0.4,
  night: false,
  terrain: { base: '#9a9a9a', paint: paintGrass, hills: 0, rim: 0, rimColor: '#8a9a6a', height },
  shoulder: '#a89f86',
};

function paintHills(g, w, h, X, Y) {
  for (const [e0, e1, c, f] of [[0.012, 0.03, '#8fa5a0', 0.013], [0.006, 0.02, '#7f977f', 0.021]]) {
    g.fillStyle = c; g.beginPath(); g.moveTo(0, Y(-0.01));
    for (let b = 0; b <= 360; b += 1) g.lineTo(X(b) || (b ? w : 0), Y(e0 + (e1 - e0) * (0.5 + 0.5 * Math.sin(b * f * 7 + 1) * Math.sin(b * f * 3.1))));
    g.lineTo(w, Y(-0.01)); g.fill();
  }
}

function build(api) {
  const K = kit(api), { S, W2, R, pick } = K, { track, rnd } = api;
  const near = K.dist, G = (x, z) => api.groundAt(x, z);
  const inWood = (x, z, pad = 0) => WOODS.some(([wx, wz, r]) => {   // lobed outlines, not circles
    const d = Math.hypot(x - wx, z - wz);
    if (d > 1.42 * r + pad) return false;
    const a = Math.atan2(z - wz, x - wx);
    return d < r * (1 + 0.28 * Math.sin(3 * a + wx) + 0.14 * Math.sin(7 * a + wz)) + pad;
  });
  const nearVillage = (x, z) => Math.hypot(x - VILLAGE[0], z - VILLAGE[1]) < 250;

  // ---- ground colours: mown verges, summer grass, trampled banks, woods, and the field patchwork on the slopes
  {
    const tex = 0.323, pal = {}, set = (col, hex, k = 1) => { if (k > 0) col.lerp(pal[hex] ||= new THREE.Color(hex).multiplyScalar(1 / tex), k); };
    K.recolor((x, y, z, ny, col) => {
      const d = near(x, z), n = Math.sin(x * 0.05) * Math.cos(z * 0.043) * 0.5 + 0.5;
      col.copy(pal.base ||= new THREE.Color('#6f9a45')).multiplyScalar((0.88 + 0.2 * n) / tex);
      set(col, '#8fa24e', smooth(60, 160, d) * (0.4 + 0.4 * n));                     // drier summer grass further out
      set(col, '#5b923a', 1 - smooth(W2 + 14, W2 + 22, d));                         // mown verge
      for (const [bx, bz, r] of BANKS) set(col, '#a39f62', 0.6 * smooth(r * 1.1, r * 0.4, Math.hypot(x - bx, z - bz)));
      if (!inLoop(x, z) && d > 170 + 40 * n && !nearVillage(x, z)) {
        const p = parcel(x, z), f = FIELDS.find(([t]) => p < t)[1];
        set(col, f, smooth(170, 215, d - 40 * n) * 0.92);
      }
      if (inRect(x, z, SUN1, 3) || inRect(x, z, SUN2, 3)) set(col, '#a88f1c');
      if (inWood(x, z)) set(col, '#3d5f2a', 0.85);
      if (nearVillage(x, z)) set(col, '#8d9a64', 0.5);
    });
  }
  K.clouds(300, 16);
  K.panorama(paintHills, { haze: 0.45, y1: 0.06 });

  // ---- pits on the right of the start straight (pit lane, garages, canopy), paddock, race control; main grandstand
  const pitIdx = K.span(K.idx(170, 136), K.idx(-110, -87));
  const back = K.pits(pitIdx, { lane: [K.WALL + 1.6, K.WALL + 14], trim: '#2f7d32', glass: '#3a5a70' });
  {
    const f = K.frame(K.idx(-128, -100), back - 8);
    K.box('solid', 14, 17, 14, f.x, f.y + 8.5, f.z, f.ry, '#e4e7ea');
    K.box('glass', 15, 4.5, 15, f.x, f.y + 19, f.z, f.ry, '#2f4d63');
    K.box('solid', 17, 0.6, 17, f.x, f.y + 21.5, f.z, f.ry, '#f4f6f8');
    api.block(f.x, f.z, 12);
    for (let k = 3; k < pitIdx.length - 3; k += 5) {
      const f2 = K.frame(pitIdx[k], back + R(12, 16)), c = pick(['#f4f4f4', '#1d1d1f', '#c8102e', '#1f4e9c', '#ff8200', '#bfc5cc', '#0b6e4f']);
      K.box('solid', 13, 6.5, 9, f2.x, f2.y + 3.1, f2.z, f2.ry, c);
      K.box('glass', 13.2, 2, 9.2, f2.x, f2.y + 4.6, f2.z, f2.ry, '#1b2833');
      api.block(f2.x, f2.z, 9);
    }
  }
  K.stand(K.idx(30, 25), -(W2 + 15), 190, 16, { seat: '#2d5da8', trim: '#2f7d32' });
  K.stand(K.idx(-170, -135), -(W2 + 15), 100, 14, { seat: '#c8102e', trim: '#2f7d32' });
  K.stand(K.idx(400, 297), -(W2 + 15), 60, 12, { seat: '#2d5da8', roof: false });

  // ---- fans on the natural banks: turn 1, 2, 3, 4, 5, 11, 14 (outside of each corner)
  const arc = (x0, z0, x1, z1) => K.span(K.idx(x0, z0), K.idx(x1, z1));
  const FLAGS = ['#ce2939', '#ffffff', '#477050', '#e63946', '#ffb703', '#1d3557', '#2a9d8f', '#ce2939', '#477050'];
  K.bank(arc(-205, -162, -253, -247), -1, { rows: 12, fill: 0.45, shirts: FLAGS });
  K.bank(arc(150, -64, 193, -121), 1, { rows: 10 });
  K.bank(arc(145, -209, 140, -266), -1, { rows: 9 });
  K.bank(arc(324, -621, 352, -689), 1, { rows: 12, fill: 0.45 });
  K.bank(arc(312, -844, 372, -908), -1, { rows: 9 });
  K.bank(arc(791, -179, 783, -89), -1, { rows: 12, fill: 0.45, shirts: FLAGS });
  K.bank(arc(450, 197, 419, 294), -1, { rows: 10 });
  // flags on poles over the busiest banks (national tricolour, instanced)
  {
    const flag = mergeGeometries([
      new THREE.CylinderGeometry(0.04, 0.04, 4, 3, 1, true).translate(0, 2, 0),
      ...['#ce2939', '#ffffff', '#477050'].map((c, k) => {
        const p = new THREE.PlaneGeometry(1.5, 0.33).translate(0.78, 3.75 - k * 0.33, 0).toNonIndexed();
        p.setAttribute('color', new THREE.BufferAttribute(new Float32Array(18).map((_, j) => new THREE.Color(c).toArray()[j % 3]), 3));
        return p;
      }),
    ].map(g => { g = g.index ? g.toNonIndexed() : g; if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.6), 3)); g.deleteAttribute('uv'); return g; }));
    const rows = [];
    for (const [x0, z0, x1, z1, side] of [[-205, -162, -253, -247, -1], [324, -621, 352, -689, 1], [791, -179, 783, -89, -1]]) {
      for (const i of arc(x0, z0, x1, z1)) {
        if (rnd() > 0.25) continue;
        const s = S[i], lat = side * (K.WALL + 8 + R(0, 16)), x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat;
        if (api.isFree(x, z, 0.3)) rows.push([x, G(x, z), z, rnd() * TAU, 1, 1, 1]);
      }
    }
    K.inst(flag, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }), rows, false);
  }
  K.flushCrowd();

  // ---- sunflower fields (heads all turned east) beside the back straight and the final corner
  {
    const head = new THREE.CircleGeometry(0.46, 8).rotateY(Math.PI / 2).rotateZ(-0.25).translate(0.05, 1.75, 0);
    const hc = new Float32Array(head.attributes.position.count * 3);
    for (let i = 0; i < hc.length / 3; i++) new THREE.Color(i ? '#f2c318' : '#4a2e12').toArray(hc, i * 3);
    head.setAttribute('color', new THREE.BufferAttribute(hc, 3));
    const stem = new THREE.CylinderGeometry(0.025, 0.04, 1.75, 3, 1, true).translate(0, 0.87, 0);
    stem.setAttribute('color', new THREE.BufferAttribute(new Float32Array(stem.attributes.position.count * 3).map((_, j) => [0.18, 0.32, 0.07][j % 3]), 3));
    const geo = mergeGeometries([head, stem].map(g => { g = g.toNonIndexed(); g.deleteAttribute('uv'); return g; }));
    const rows = [];
    for (const [cx, cz, a, L, Wd] of [SUN1, SUN2]) {
      const c = Math.cos(a), s = Math.sin(a);
      const d0 = near(cx, cz) - Wd / 2;   // only the rows nearest the road get 3D heads; the rest is painted ground
      for (let u = -L / 2; u < L / 2; u += 1.1) for (let v = -Wd / 2; v < Wd / 2; v += 1.0) {
        const x = cx + c * (u + R(-0.3, 0.3)) - s * (v + R(-0.2, 0.2)), z = cz + s * (u + R(-0.3, 0.3)) + c * (v + R(-0.2, 0.2));
        if (near(x, z) > d0 + 24 || !api.isFree(x, z, 0.5)) continue;
        const k = R(0.85, 1.12);
        rows.push([x, G(x, z) - 0.1, z, R(-0.25, 0.25), k, k * R(0.9, 1.1), k, K.col.setHSL(0.12, 0.2, R(0.75, 0.95)).getHex()]);
      }
      api.block(cx, cz, Math.min(L, Wd) / 2);
    }
    K.inst(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }), rows, false);
  }

  // ---- the village on the western hill: whitewashed houses with hip roofs, church with a tall spire
  {
    const [vx, vz] = VILLAGE, gy = G(vx, vz);
    K.box('solid', 11, 9, 24, vx, gy + 4.5, vz, 0.3, '#f1ede4');
    K.put('solid', new THREE.ConeGeometry(0.78, 1, 4, 1, true).rotateY(Math.PI / 4).scale(15, 6, 32), '#8e3b2a', vx, gy + 12, vz, 0.3);
    const tx = vx + Math.sin(0.3) * -14, tz = vz + Math.cos(0.3) * -14;
    K.box('solid', 6, 26, 6, tx, gy + 13, tz, 0.3, '#f4f0e6');
    K.put('solid', new THREE.ConeGeometry(4.2, 14, 8), '#3f5b4a', tx, gy + 33, tz);
    api.block(vx, vz, 20);
    const house = mergeGeometries([
      new THREE.BoxGeometry(1, 0.6, 1).translate(0, 0.3, 0),
      new THREE.ConeGeometry(0.78, 0.42, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.81, 0),
    ].map((g, k) => { g = g.toNonIndexed(); g.deleteAttribute('uv'); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).map((_, j) => (k ? [0.55, 0.16, 0.08] : [1, 1, 1])[j % 3]), 3)); return g; }));
    const rows = [];
    for (let tries = 0; rows.length < 170 && tries < 3000; tries++) {
      const a = rnd() * TAU, r = 30 + Math.sqrt(rnd()) * 230, x = vx + Math.cos(a) * r, z = vz + Math.sin(a) * r;
      if (!K.ok(x, z, 9, true) || near(x, z) < 120) continue;
      const along = Math.round(Math.atan2(z - vz, x - vx) / (Math.PI / 2)) * Math.PI / 2 + R(-0.15, 0.15);
      rows.push([x, G(x, z) - 0.3, z, along, R(9, 14), R(5.5, 7), R(8, 11), pick(['#f6f3ea', '#efe6cf', '#f3e7b3', '#e8e2d6', '#f7efe0'])]);
      api.block(x, z, 8);
    }
    K.inst(house, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), rows);
  }

  // ---- trees: small oak / acacia woods on the hills, scattered trees in the infield, poplar lines along field edges
  {
    const list = [], leaf = (l = 0) => K.col.setHSL(R(0.2, 0.3), R(0.35, 0.55), R(0.15, 0.25) + l).getHex();
    for (const [wx, wz, r] of WOODS) {
      const n = Math.round(r * r / 70);
      for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
        const a = rnd() * TAU, rr = 1.4 * r * Math.sqrt(rnd()), x = wx + Math.cos(a) * rr, z = wz + Math.sin(a) * rr;
        if (!inWood(x, z) || !K.ok(x, z, 3, true)) continue;
        list.push([x, z, rnd() < 0.6 ? 'broad' : rnd() < 0.7 ? 'round' : 'pine', R(0.9, 1.5), leaf()]); k++;
      }
    }
    const b = track.bounds;
    for (let tries = 0, n = 0; n < 260 && tries < 8000; tries++) {
      const x = R(b.minX, b.maxX), z = R(b.minZ, b.maxZ);
      if (!inLoop(x, z) || inWood(x, z, 10) || !K.ok(x, z, 3.5, true)) continue;
      list.push([x, z, rnd() < 0.5 ? 'round' : 'broad', R(0.8, 1.3), leaf(0.02)]); n++;
    }
    for (let tries = 0, n = 0; n < 520 && tries < 12000; tries++) {   // lone trees + bushes on the slopes
      const x = R(b.minX - 500, b.maxX + 500), z = R(b.minZ - 500, b.maxZ + 500), d = near(x, z);
      if (d < 40 || d > 700 || inLoop(x, z) || !K.ok(x, z, 3, true) || nearVillage(x, z)) continue;
      list.push([x, z, rnd() < 0.6 ? 'bush' : 'round', R(0.9, 1.8), leaf()]); n++;
    }
    for (let line = 0; line < 7; line++) {   // poplar rows
      const x0 = R(b.minX - 300, b.maxX + 300), z0 = R(b.minZ - 300, b.maxZ + 300), a = 0.42 + (rnd() < 0.5 ? 0 : Math.PI / 2);
      for (let k = 0; k < 26; k++) {
        const x = x0 + Math.cos(a) * k * 9, z = z0 + Math.sin(a) * k * 9;
        if (near(x, z) > 60 && !inLoop(x, z) && K.ok(x, z, 2, true)) list.push([x, z, 'poplar', R(1, 1.25), leaf()]);
      }
    }
    K.trees(list);
  }

  K.flush('flat', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), false).receiveShadow = true;
  K.flush('solid', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  K.flush('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.7 }));
}

export default { base: 'forest', env: ENV, baseBuild: false, build };
