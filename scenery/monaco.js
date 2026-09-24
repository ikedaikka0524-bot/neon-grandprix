// Monaco (モナコ): Monte-Carlo over the beach base, with its own build (the coral-coast island is skipped).
// Real layout, north up (x = east, z = −north); the course starts on Casino Square. Port Hercule packed with yachts
// beside the Tabac / swimming-pool section, harbour grandstands, the Rock with the palace across the harbour, the
// domed casino and its gardens, the covered tunnel under the hotel after the hairpin, red-roofed apartment blocks
// climbing the hillside to the mountains, and the Mediterranean with boats offshore.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const DEF = TRACK_BY_ID.monaco, W2 = DEF.width / 2, WALL = W2 + (DEF.wallGap ?? 9.4);
const PTS = DEF.points.map(p => [p[0], p[2]]);
const WATER = -0.75;

// Mainland (with the Rock) as one closed outline; everything outside is sea. Goes down the coast past Portier and the
// tunnel, round Port Hercule (north quay, swimming-pool complex, Rascasse, the south mole), the Rock's cliffs, west.
const MAIN = [
  [2600, -2600], [1500, -1500], [760, -820], [540, -540], [440, -340], [408, -240], [398, -120], [384, 0], [356, 88],
  [302, 168], [232, 240], [140, 290], [40, 322], [-50, 345], [-110, 385],
  [-180, 402], [-300, 408], [-440, 415], [-512, 428], [-535, 458], [-546, 505], [-548, 560], [-525, 600],
  [-440, 612], [-435, 800], [-468, 838], [-478, 880], [-462, 915], [-438, 940], [-402, 962], [-366, 976],
  [-250, 986], [-120, 988], [-40, 978], [10, 940], [48, 872], [66, 882], [44, 962], [74, 1010],
  [118, 1070], [92, 1150], [10, 1228], [-140, 1290], [-310, 1305], [-460, 1285], [-620, 1330], [-820, 1420],
  [-1300, 1650], [-2600, 1900], [-2600, -2600],
];
const ROCK = [[-430, 1068], [-300, 1052], [-140, 1040], [0, 1030], [70, 1060], [90, 1110], [60, 1170], [-40, 1220],
  [-200, 1262], [-380, 1255], [-470, 1200], [-480, 1120]];
const FLAT = [[-15, 135, 70]];   // the gardens inside Massenet stay level (sightline)
const MOLE = [[-110, 392], [-92, 450], [-70, 520], [-52, 600], [-44, 640]];   // north breakwater (a mesh, not terrain)

function polySD(P, x, z) {   // signed distance to a closed outline, + inside
  let best = Infinity, inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, az] = P[j], [bx, bz] = P[i], dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
    if ((az > z) !== (bz > z) && x < ax + (z - az) * dx / dz) inside = !inside;
  }
  return inside ? Math.sqrt(best) : -Math.sqrt(best);
}
function inPoly(P, x, z) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ax, az] = P[j], [bx, bz] = P[i];
    if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
  }
  return inside;
}
// Terrain: level town inside the lap, the hillside climbing away from the course on the landward side (steep, like
// Monte-Carlo up to the corniche), the Rock's plateau, and the sea / harbour floor.
function height(x, z, y, dist) {
  const dc = polySD(MAIN, x, z);
  if (dc < 0) return Math.min(y, WATER - 1.8 + Math.max(dc * 0.07, -26));
  let h = -0.1;
  const rk = polySD(ROCK, x, z);
  if (!inPoly(PTS, x, z) && rk < -8) {
    const n = 1 + 0.2 * Math.sin(x * 0.011 + 1.7) * Math.cos(z * 0.013 - 0.4) + 0.1 * Math.sin(x * 0.037 - z * 0.029);
    let ramp = Math.max(0, dist - 36) * 0.44 * n * smooth(10, 110, dc);
    for (const [fx, fz, fr] of FLAT) ramp *= smooth(fr * 0.7, fr * 1.3, Math.hypot(x - fx, z - fz));
    ramp *= smooth(-8, -120, rk) * smooth(1300, 1050, z);   // the Rock stands alone; Fontvieille is low
    h += Math.min(ramp, 260 + 40 * Math.sin(x * 0.004 + 1));
  }
  if (rk > -2) h = Math.max(h, 56 * smooth(0, 34, rk) + 1.5 * Math.sin(x * 0.05 + z * 0.03) * smooth(20, 40, rk));
  h = lerp(WATER + 0.12, h, smooth(10, 13, dc));
  return lerp(y, h, smooth(W2 + 5, W2 + 16, dist));
}

function paintGround(g, w, h) {   // pale limestone paving; vertex colours tint it per area
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.fillStyle = 'rgba(80,70,60,0.12)';
  for (let k = 0; k < w; k += 32) { g.fillRect(k, 0, 1, h); g.fillRect(0, k, w, 1); }
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,55,45' : '255,250,240'},0.18)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}

const SUN = [-0.42, 0.62, 0.66];
const env = {
  sky: { top: '#1d5fc4', horizon: '#c2def0', bottom: '#7fb1cf' },
  fog: { color: '#c2def0', near: 380, far: 2700 },
  sun: { dir: SUN, color: '#fff1da', intensity: 2.9 },
  hemi: { sky: '#d2e8ff', ground: '#b9ad92', intensity: 0.9 },
  exposure: 1.02,
  night: false,
  terrain: { base: '#d6d0c4', paint: paintGround, hills: 0, rim: 0, rimColor: '#8e8a78', height },
  road: { base: '#4a4d53', line: '#f1f1ec', edge: '#f4f4f4' },
  shoulder: '#b3ab9c',
  barrier: 'guardrail',
  curb: ['#d7263d', '#f2f2f2'],
};

// ---------------------------------------------------------------------------------------------------- geometry kit
const M4 = new THREE.Matrix4(), EU = new THREE.Euler(), C3 = new THREE.Color();
function part(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {   // → non-indexed, vertex-coloured, placed
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  C3.set(color);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) C3.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.applyMatrix4(M4.makeRotationFromEuler(EU.set(rx, ry, rz)).setPosition(x, y, z));
}
const bake = (parts, x, y, z, ry) => mergeGeometries(parts).applyMatrix4(M4.makeRotationY(ry).setPosition(x, y, z));
function triGeo(pos, cols) {   // flat triangles from arrays
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

// Box facades with a world-space window grid: one shared texture reads right on any building size. Texture alpha 0 =
// plaster (instance colour shows), alpha 1 = window / shutter; each instance offsets the grid so no two match.
function facadeMat(tex, cellW, cellH, cols, rows, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uCell = { value: new THREE.Vector4(cellW, cellH, cols, rows) };
    sh.vertexShader = 'varying vec3 vFW; varying vec3 vFN; varying float vSeed;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fw = vec4(transformed, 1.0); vec3 fn = objectNormal; vSeed = 0.0;
      #ifdef USE_INSTANCING
        fw = instanceMatrix * fw; fn = mat3(instanceMatrix) * fn;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #endif
      vFW = (modelMatrix * fw).xyz; vFN = normalize(mat3(modelMatrix) * fn);`);
    sh.fragmentShader = 'uniform vec4 uCell; varying vec3 vFW; varying vec3 vFN; varying float vSeed;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fN = normalize(vFN); float wall = 1.0 - step(0.6, abs(fN.y));
        vec2 cell = vec2((vFW.z * fN.x - vFW.x * fN.z) / uCell.x + floor(vSeed * 97.0), vFW.y / uCell.y + floor(fract(vSeed * 13.7) * 41.0));
        vec4 wt = texture2D(map, cell / uCell.zw);
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.8, 1.0, wall), wt.rgb, wt.a * wall);`);
  };
  return m;
}
function paintShutters(g, w, h) {   // 8 x 8 cells of 32 px: glass, sills, open / closed shutters, some balconies
  g.clearRect(0, 0, w, h);
  const C = 32, SH = ['#4f7a4a', '#5f8858', '#6e5a3e', '#f0ede4', '#3f6a6e', '#8a5a40', '#56704f'];
  for (let cy = 0; cy < h / C; cy++) {
    const balcony = Math.random() < 0.35, sc = SH[Math.floor(Math.random() * SH.length)];
    for (let cx = 0; cx < w / C; cx++) {
      const x = cx * C, y = cy * C, ww = 11, wh = 17, wx = x + (C - ww) / 2, wy = y + 7;
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x, y + C - 2, C, 2);
      g.fillStyle = '#26303b'; g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(170,200,225,0.45)'; g.fillRect(wx + 1, wy + 1, ww - 2, 5);
      g.fillStyle = '#ece6d8'; g.fillRect(wx - 2, wy - 2, ww + 4, 2); g.fillRect(wx - 2, wy + wh, ww + 4, 2);
      const r = Math.random();
      g.fillStyle = sc;
      if (r < 0.3) { g.fillRect(wx, wy, ww, wh); g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = wy + 2; k < wy + wh; k += 3) g.fillRect(wx, k, ww, 1); }
      else if (r < 0.8) { g.fillRect(wx - 6, wy, 5, wh); g.fillRect(wx + ww + 1, wy, 5, wh); }
      if (balcony) { g.fillStyle = '#24272c'; g.fillRect(x + 3, wy + wh - 6, C - 6, 1); g.fillRect(x + 3, wy + wh + 1, C - 6, 1); for (let k = x + 3; k < x + C - 3; k += 3) g.fillRect(k, wy + wh - 6, 1, 7); }
    }
  }
}
function paintModern(g, w, h) {   // 8 x 8 cells: glazing bands with white balcony slabs
  g.clearRect(0, 0, w, h);
  const C = 32;
  for (let cy = 0; cy < h / C; cy++) for (let cx = 0; cx < w / C; cx++) {
    const x = cx * C, y = cy * C, v = 30 + Math.random() * 30;
    g.fillStyle = `rgb(${v | 0},${v + 18 | 0},${v + 34 | 0})`; g.fillRect(x, y + 4, C, C - 12);
    g.fillStyle = 'rgba(190,215,235,0.35)'; g.fillRect(x, y + 4, C, 4);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + C - 2, y + 4, 2, C - 12);
    if (Math.random() < 0.25) { g.fillStyle = 'rgba(240,238,230,0.9)'; g.fillRect(x + 2, y + 6, C / 2 - 2, C - 16); }   // drawn blinds
    g.fillStyle = '#f2f2ee'; g.fillRect(x, y + C - 8, C, 3);
  }
}

// Palm (after theme-beach.js): curved trunk + drooping alpha-tested fronds
function frondGeo(len, width, a0, a1, fold, segs) {
  const pos = [], uv = [], idx = [];
  let x = 0, y = 0;
  for (let k = 0; k <= segs; k++) {
    const s = k / segs;
    if (k) { const a = a0 + (a1 - a0) * Math.pow((k - 0.5) / segs, 1.3); x += Math.cos(a) * len / segs; y += Math.sin(a) * len / segs; }
    const w = width * Math.pow(Math.sin(Math.PI * s), 0.6), f = fold * w;
    pos.push(x, y - f, -w, x, y, 0, x, y - f, w);
    uv.push(0, s, 0.5, s, 1, s);
  }
  for (let k = 0; k < segs; k++) { const a = k * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function paintFrond(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.lineCap = 'round';
  for (let y = h - 3; y > 6; y -= 3.4) {
    const t = 1 - y / h, len = (w / 2 - 4) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t)), 0.6));
    for (const sd of [-1, 1]) {
      const l = len * (0.8 + Math.random() * 0.2), sh = Math.random() * 40;
      g.strokeStyle = `rgb(${38 + t * 50 + sh * 0.3 | 0},${96 + t * 50 + sh | 0},${28 + t * 18 | 0})`;
      g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + sd * l * 0.5, y - 5, w / 2 + sd * l, y - 16); g.stroke();
    }
  }
  g.strokeStyle = '#a4a45a'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
}
function palmParts(rnd, H, B) {
  const R = (a, b) => a + (b - a) * rnd(), SEG = 10, RAD = 6, pos = [], col = [], idx = [];
  for (let k = 0; k <= SEG; k++) {
    const t = k / SEG, px = B * (1 - (1 - t) ** 2), py = H * t, tx = 2 * B * (1 - t), tl = Math.hypot(tx, H);
    const nx = H / tl, ny = -tx / tl, r = 0.26 * (1 - 0.3 * t) + 0.22 * (1 - t) ** 8, c = k % 2 ? [0.32, 0.25, 0.17] : [0.48, 0.4, 0.3];
    for (let j = 0; j < RAD; j++) { const a = j / RAD * TAU; pos.push(px + nx * r * Math.cos(a), py + ny * r * Math.cos(a), r * Math.sin(a)); col.push(...c); }
  }
  for (let k = 0; k < SEG; k++) for (let j = 0; j < RAD; j++) { const a = k * RAD + j, b = k * RAD + (j + 1) % RAD; idx.push(a, a + RAD, b, b, a + RAD, b + RAD); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const F = [];
  for (let i = 0; i < 9; i++) F.push(frondGeo(R(4.2, 5), 0.95, R(0.4, 0.75), R(-1.0, -1.5), 0.35, 5).rotateY(i / 9 * TAU + R(-0.2, 0.2)));
  for (let i = 0; i < 3; i++) F.push(frondGeo(3, 0.7, R(1.1, 1.3), R(0.2, 0.5), 0.3, 4).rotateY(i / 3 * TAU + 0.5));
  return { trunk: mergeGeometries([tg.toNonIndexed(), part(new THREE.IcosahedronGeometry(0.36, 0), '#5f6a2c', B, H, 0)]), crown: mergeGeometries(F).translate(B, H - 0.05, 0) };
}

// Motor yacht, bow +z, waterline y = 0, 30 m long (instances scale it)
function yachtGeo(hull, L = 30) {
  const B = L * 0.21, sh = new THREE.Shape();
  sh.moveTo(-B / 2, -L / 2); sh.lineTo(B / 2, -L / 2); sh.lineTo(B / 2, L * 0.12);
  sh.quadraticCurveTo(B / 2, L * 0.36, 0, L / 2); sh.quadraticCurveTo(-B / 2, L * 0.36, -B / 2, L * 0.12); sh.closePath();
  const hullG = new THREE.ExtrudeGeometry(sh, { depth: 3.1, bevelEnabled: false, curveSegments: 3 }).rotateX(Math.PI / 2).translate(0, 1.9, 0);
  const W = '#f6f6f3', G = '#1c2531';
  return mergeGeometries([
    part(hullG, hull),
    part(new THREE.BoxGeometry(B * 1.01, 0.35, L * 0.9), '#e9e6de', 0, 1.2, 0),            // boot stripe / rub rail
    part(new THREE.BoxGeometry(B * 0.92, 0.12, L * 0.24), '#b58c5c', 0, 1.95, -L * 0.36),  // teak aft deck
    part(new THREE.BoxGeometry(B * 0.82, 2.3, L * 0.5), W, 0, 3.05, -L * 0.04),
    part(new THREE.BoxGeometry(B * 0.84, 0.8, L * 0.46), G, 0, 3.2, -L * 0.04),
    part(new THREE.BoxGeometry(B * 0.7, 2.0, L * 0.34), W, 0, 5.15, -L * 0.06),
    part(new THREE.BoxGeometry(B * 0.72, 0.7, L * 0.3), G, 0, 5.3, -L * 0.06),
    part(new THREE.BoxGeometry(B * 0.56, 1.1, L * 0.18), W, 0, 6.7, -L * 0.1),
    part(new THREE.BoxGeometry(B * 0.1, 1.6, B * 0.1), '#d8d8d8', 0, 8.0, -L * 0.1),
    part(new THREE.BoxGeometry(B * 0.5, 0.18, 0.5), '#d8d8d8', 0, 8.3, -L * 0.1),
  ]);
}

const WATER_VS = `varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = `uniform float uTime;
uniform vec3 uDeep, uSkyT, uSkyH, uSun, uSunCol;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 d, float l, float a, float t) { float k = 6.2831853 / l; d = normalize(d); return d * a * cos(k * dot(d, p) - sqrt(9.8 * k) * t); }
void main() {
  vec2 p = vW.xz; float t = uTime;
  float fine = 1.0 - smoothstep(80.0, 900.0, length(cameraPosition.xz - p));
  vec2 s = wv(p, vec2(0.6, 0.8), 41.0, 0.07, t) + wv(p, vec2(-0.7, 0.45), 23.0, 0.06, t) + wv(p, vec2(0.15, -1.0), 12.0, 0.055, t)
    + (wv(p, vec2(0.9, 0.3), 5.7, 0.05, t) + wv(p, vec2(-0.35, -0.8), 3.1, 0.045, t) + wv(p, vec2(-0.9, 0.1), 1.9, 0.04, t)) * fine;
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyH, uSkyT, pow(clamp(R.y, 0.0, 1.0), 0.6));
  float sd = max(dot(R, uSun), 0.0);
  float spec = pow(sd, 900.0) * 26.0 + pow(sd, 80.0) * 0.9;
  vec3 body = uDeep * (0.85 + 0.35 * (n.x * uSun.x + n.z * uSun.z) * 5.0);
  gl_FragColor = vec4(mix(body, sky, min(F, 0.72)) + uSunCol * spec, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// ======================================================================================================== build
function build(api) {
  const { world, track, rnd } = api;
  const S = track.samples, N = S.length, sp = track.length / N;
  const R = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];
  const ground = api.groundAt;
  const head = i => { const t = S[((i % N) + N) % N].tan; return Math.atan2(t.x, t.z); };
  const curv = S.map((_, i) => { const d = head(i + 3) - head(i - 3); return Math.atan2(Math.sin(d), Math.cos(d)) / (6 * sp); });
  const bend = curv.map((_, i) => { let s = 0; for (let k = -24; k <= 24; k += 4) s += curv[(i + k + N) % N]; return s / 13; });   // + = left
  const sAt = k => { let bd = Infinity, bi = 0; const [x, z] = PTS[k]; S.forEach((s, i) => { const d = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  const side = (i, lat) => { const s = S[((i % N) + N) % N]; return [s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat]; };
  function trackAt(x, z) {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z, i: bi };
  }
  // tall things: never within 30 m of the centreline on the inside of a corner (the chase camera looks across it)
  const inside = (i, lat) => (bend[i] > 1 / 260 && lat < 0) || (bend[i] < -1 / 260 && lat > 0);
  const tallOk = (x, z, r) => { const q = trackAt(x, z); return q.d - r >= (inside(q.i, q.lat) ? W2 + 30 : WALL + 3); };
  const sea = (x, z, m = 0) => polySD(MAIN, x, z) < m;

  // own blocker grid (api.isFree keeps 17.5 m off the centreline; street frontage sits closer)
  const GC = 40, cells = new Map();
  const block = (x, z, r) => {
    api.block(x, z, r);
    for (let i = Math.floor((x - r) / GC); i <= Math.floor((x + r) / GC); i++) for (let j = Math.floor((z - r) / GC); j <= Math.floor((z + r) / GC); j++) {
      const k = i * 7919 + j; if (!cells.has(k)) cells.set(k, []); cells.get(k).push([x, z, r]);
    }
  };
  const taken = (x, z, r) => {
    for (let i = Math.floor((x - r) / GC); i <= Math.floor((x + r) / GC); i++) for (let j = Math.floor((z - r) / GC); j <= Math.floor((z + r) / GC); j++) {
      for (const [bx, bz, br] of cells.get(i * 7919 + j) || []) if ((bx - x) ** 2 + (bz - z) ** 2 < (br + r) ** 2) return true;
    }
    return false;
  };

  const vc = [];   // merged vertex-coloured statics
  const facadeTex = api.canvasTex(256, 256, paintShutters), modernTex = api.canvasTex(256, 256, paintModern);
  const oldB = [], newB = [], roofs = [];      // [x, y, z, ry, sx, sy, sz, color]
  const crowd = [], palms = [[], []], pines = [], cypress = [], shrubs = [], yachts = [[], [], []];
  const addB = (list, x, y, z, ry, sx, sy, sz, c) => list.push([x, y, z, ry, sx, sy, sz, c]);
  const OLD = ['#f0e2c0', '#e6bb7c', '#eab49c', '#f3dea6', '#f1ece2', '#ecc6bc', '#dca27e', '#e9d3a8', '#f2e8d2'];
  const NEW = ['#eef0f2', '#dfe3e8', '#e8dfce', '#f4f1ea'];
  const ROOF = ['#b4553c', '#a84a33', '#c0643f', '#9d4a36', '#b86447'];
  const footprintClear = (x, z, ry, sx, sz, minD) => {   // corners + centre clear of the barrier and not in the sea
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
      const px = x + (u * sx) * c + (v * sz) * s, pz = z - (u * sx) * s + (v * sz) * c;
      if (api.near(px, pz)[0] < minD || sea(px, pz, 4)) return false;
    }
    return true;
  };
  const baseY = (x, z, ry, sx, sz) => {
    const c = Math.cos(ry), s = Math.sin(ry);
    let m = Infinity;
    for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) m = Math.min(m, ground(x + (u * sx) * c + (v * sz) * s, z - (u * sx) * s + (v * sz) * c));
    return m - 0.6;
  };
  const house = (x, z, ry, sx, sz, h, opt = {}) => {   // old block with a hipped terracotta roof (or flat)
    const y = baseY(x, z, ry, sx, sz), top = ground(x, z) + h;
    addB(opt.modern ? newB : oldB, x, y, z, ry, sx, top - y, sz, opt.color || pick(opt.modern ? NEW : OLD));
    if (!opt.modern && !opt.flat) roofs.push([x, top, z, ry, sx * 1.06, Math.min(sx, sz) * R(0.22, 0.32), sz * 1.06, pick(ROOF)]);
    else vc.push(part(new THREE.BoxGeometry(sx * 0.3, 2.2, sz * 0.3), '#d9d6cf', x, top + 1.1, z, ry));   // roof plant room
    block(x, z, Math.hypot(sx, sz) / 2);
  };

  // ------------------------------------------------------------------------------------------------ recolour terrain
  {
    const base = new THREE.Color(env.terrain.base), tgt = h => { const k = new THREE.Color(h); return k.setRGB(k.r / base.r, k.g / base.g, k.b / base.b); };
    const pave = tgt('#cdc5b5'), garden = tgt('#6f8149'), dry = tgt('#9a9571'), rock = tgt('#8b8374'), deep = tgt('#58705e'), c = new THREE.Color(), n = new THREE.Vector3(), v = new THREE.Vector3();
    world.traverse(o => {
      const g = o.geometry;
      if (!o.isMesh || !g?.attributes?.color || !(g.parameters?.width >= 1800)) return;
      const pos = g.attributes.position, col = g.attributes.color, nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const x = v.x, y = v.y, z = v.z, patch = 0.5 + 0.5 * Math.sin(x * 0.017 + 2 * Math.sin(z * 0.013)) * Math.cos(z * 0.021 - x * 0.007);
        const steep = smooth(0.86, 0.62, n.fromBufferAttribute(nrm, i).y);
        c.copy(pave).multiplyScalar(0.92 + 0.12 * patch);
        c.lerp(c3(garden, dry, patch), smooth(3, 14, y) * 0.85);
        c.lerp(deep, smooth(150, 260, y) * 0.5);
        c.lerp(rock, Math.max(steep * smooth(8, 30, y), smooth(200, 280, y) * 0.6));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    });
    function c3(a, b, t) { return new THREE.Color().copy(a).lerp(b, t); }
  }

  // ------------------------------------------------------------------------------------------------ water
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#0b4a7e') }, uSkyT: { value: new THREE.Color('#3b7fd6') }, uSkyH: { value: new THREE.Color(env.sky.horizon) },
      uSun: { value: new THREE.Vector3(...SUN).normalize() }, uSunCol: { value: new THREE.Color('#fff4e0') },
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 8, 8).rotateX(-Math.PI / 2), waterMat);
  water.position.set(-150, WATER, 400);
  water.frustumCulled = false;
  world.add(water);

  // quay walls + a paved lip along the coast near the course (hides the 10 m terrain grid at the waterline)
  {
    const pos = [], cols = [], stone = new THREE.Color('#bcb19b'), lip = new THREE.Color('#d8d1c2'), algae = new THREE.Color('#4d5a4c');
    const quad = (a, b, c, d, col) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    for (let i = 0, j = MAIN.length - 1; i < MAIN.length; j = i++) {
      const [ax, az] = MAIN[j], [bx, bz] = MAIN[i], L = Math.hypot(bx - ax, bz - az);
      if (L > 1500 || Math.min(api.near(ax, az)[0], api.near(bx, bz)[0], api.near((ax + bx) / 2, (az + bz) / 2)[0]) > 900) continue;
      let nx = -(bz - az) / L, nz = (bx - ax) / L;   // unit normal; flip toward land
      if (polySD(MAIN, (ax + bx) / 2 + nx * 6, (az + bz) / 2 + nz * 6) < 0) { nx = -nx; nz = -nz; }
      const w = 14, top = 0.02;
      quad([ax, top, az], [bx, top, bz], [bx + nx * w, top, bz + nz * w], [ax + nx * w, top, az + nz * w], lip);
      quad([ax, -3.5, az], [bx, -3.5, bz], [bx, top, bz], [ax, top, az], stone);
      quad([ax - nx * 0.05, WATER - 0.3, az - nz * 0.05], [bx - nx * 0.05, WATER - 0.3, bz - nz * 0.05], [bx - nx * 0.05, WATER + 0.25, bz - nz * 0.05], [ax - nx * 0.05, WATER + 0.25, az - nz * 0.05], algae);
    }
    const g = triGeo(pos, cols);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    world.add(m);
    // north breakwater with the harbour light at its tip
    for (let k = 0; k < MOLE.length - 1; k++) {
      const [ax, az] = MOLE[k], [bx, bz] = MOLE[k + 1], L = Math.hypot(bx - ax, bz - az);
      vc.push(part(new THREE.BoxGeometry(12, 2.2, L + 12), '#c9c0ad', (ax + bx) / 2, WATER + 0.9, (az + bz) / 2, Math.atan2(bx - ax, bz - az)));
      for (let s = 0; s < L; s += 7) vc.push(part(new THREE.DodecahedronGeometry(R(1.6, 2.6), 0), '#9c9585', ax + (bx - ax) * s / L + (az - bz) / L * 7, WATER - 0.2, az + (bz - az) * s / L - (ax - bx) / L * 7, R(0, 3), R(0, 3)));
    }
    const [tx, tz] = MOLE[MOLE.length - 1];
    vc.push(part(new THREE.CylinderGeometry(1.6, 2, 9, 12), '#f2f2f0', tx, WATER + 6, tz), part(new THREE.CylinderGeometry(1.7, 1.7, 1.4, 12), '#2e7d32', tx, WATER + 11, tz));
    vc.push(part(new THREE.CylinderGeometry(1.4, 1.8, 8, 12), '#f2f2f0', 44, WATER + 5, 872), part(new THREE.CylinderGeometry(1.5, 1.5, 1.4, 12), '#c62828', 44, WATER + 9.6, 872));
  }

  // ------------------------------------------------------------------------------------------------ the tunnel
  // after the hairpin and Portier: a covered right-hander under the hotel, lit by two strips of ceiling lamps
  const iT0 = (() => { let bd = Infinity, bi = 0; S.forEach((s, i) => { const d = (s.pos.x - 342) ** 2 + (s.pos.z + 150) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; })();
  const iT1 = sAt(49);
  {
    const LI = W2 + 1.5 + 1.2, LO = LI + 1.4, H = 7.2, T = 8.7, pos = [], cols = [], lamps = [], shade = [], shadeA = [];
    const cWall = new THREE.Color('#8f877a'), cDark = new THREE.Color('#2a2b2e'), cTop = new THREE.Color('#8c9a6a'), cOut = new THREE.Color('#cfc6b4'), cBand = new THREE.Color('#e3b23c');
    const P = (i, lat, y) => { const [x, z] = side(i, lat); return [x, S[i].pos.y + y, z]; };
    const quad = (a, b, c, d, col) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    const n = (iT1 - iT0 + N) % N;
    for (let k = 0; k < n; k++) {
      const i = (iT0 + k) % N, j = (i + 1) % N;
      quad(P(i, -LI, H), P(j, -LI, H), P(j, LI, H), P(i, LI, H), cDark);                  // ceiling
      quad(P(i, -LO, T), P(i, LO, T), P(j, LO, T), P(j, -LO, T), cTop);                   // planted roof
      for (const sg of [1, -1]) {
        quad(P(i, sg * LI, -0.3), P(j, sg * LI, -0.3), P(j, sg * LI, H), P(i, sg * LI, H), cWall);   // inner wall
        quad(P(i, sg * LI, 1.0), P(j, sg * LI, 1.0), P(j, sg * LI, 1.25), P(i, sg * LI, 1.25), cBand);
        quad(P(i, sg * LO, -0.4), P(j, sg * LO, -0.4), P(j, sg * LO, T), P(i, sg * LO, T), cOut);    // outer wall
        quad(P(i, sg * LI, H), P(j, sg * LI, H), P(j, sg * LO, T), P(i, sg * LO, T), cOut);
        const l = sg * 3.1;
        if (k % 3 < 2) lamps.push(...P(i, l - 0.35, H - 0.05), ...P(j, l - 0.35, H - 0.05), ...P(j, l + 0.35, H - 0.05), ...P(i, l - 0.35, H - 0.05), ...P(j, l + 0.35, H - 0.05), ...P(i, l + 0.35, H - 0.05));
      }
      // darker road inside (no sun gets in; fades in over the first / last 20 m)
      const a0 = smooth(0, 6, k) * smooth(0, 6, n - k) * 0.75, a1 = smooth(0, 6, k + 1) * smooth(0, 6, n - k - 1) * 0.75;
      shade.push(...P(i, -LI, 0.05), ...P(j, -LI, 0.05), ...P(j, LI, 0.05), ...P(i, -LI, 0.05), ...P(j, LI, 0.05), ...P(i, LI, 0.05));
      shadeA.push(0, 0, 0, a0, 0, 0, 0, a1, 0, 0, 0, a1, 0, 0, 0, a0, 0, 0, 0, a1, 0, 0, 0, a0);
    }
    for (const k of [0, n]) {   // portal faces (above and beside the opening)
      const i = (iT0 + k) % N;
      quad(P(i, -LO - 3, T + 0.6), P(i, LO + 3, T + 0.6), P(i, LO + 3, H), P(i, -LO - 3, H), cOut);
      quad(P(i, -LO - 3, T + 0.9), P(i, LO + 3, T + 0.9), P(i, LO + 3, T + 0.6), P(i, -LO - 3, T + 0.6), cBand);
      for (const sg of [1, -1]) quad(P(i, sg * LI, -0.4), P(i, sg * (LO + 3), -0.4), P(i, sg * (LO + 3), T + 0.6), P(i, sg * LI, T + 0.6), cOut);
    }
    const tun = new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    tun.castShadow = tun.receiveShadow = true;
    world.add(tun);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lamps, 3));
    world.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: '#ffd89a', side: THREE.DoubleSide })));
    const sg2 = new THREE.BufferGeometry();
    sg2.setAttribute('position', new THREE.Float32BufferAttribute(shade, 3));
    sg2.setAttribute('color', new THREE.Float32BufferAttribute(shadeA, 4));
    const sm = new THREE.Mesh(sg2, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    sm.renderOrder = 1;
    world.add(sm);
    for (let k = 0; k <= n; k += 3) { const [x, z] = side(iT0 + k, 0); block(x, z, LO + 4); }
  }

  // debris fence right behind the guardrails (alpha-tested mesh with posts drawn in; not inside the tunnel)
  {
    const tex = api.canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(150,156,164,0.95)'; g.lineWidth = 1.3;
      for (let k = -h; k < w + h; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
      g.fillStyle = '#4a4f57'; g.fillRect(0, 0, 5, h); g.fillRect(0, 0, w, 3);
    });
    const pos = [], uv = [], L = WALL + 0.35, n = (iT1 - iT0 + N) % N;
    for (let i = 0; i < N; i++) {
      if ((i - iT0 + N) % N <= n) continue;
      const j = (i + 1) % N, u0 = i * sp / 4, u1 = (i + 1) * sp / 4;
      for (const sg of [1, -1]) {
        const [ax, az] = side(i, sg * L), [bx, bz] = side(j, sg * L);
        pos.push(ax, 0.9, az, bx, 0.9, bz, bx, 3.9, bz, ax, 0.9, az, bx, 3.9, bz, ax, 3.9, az);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    world.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 })));
  }

  // the hotel over the tunnel mouth (podiums beside the tube, the tower block spanning it) with a roof garden
  {
    const i = iT0, ry = head(i), s = S[i], c = Math.cos(ry), sn = Math.sin(ry);
    const at = (lx, lz) => [s.pos.x + lx * c + lz * sn, s.pos.z - lx * sn + lz * c];   // local x = −right, z = along the track
    const along = 100, zc = along / 2 - 2, seg = 5;
    const [x, z] = at(3, zc);
    addB(newB, x, 8.7, z, ry, 98, 22.3, along, '#efece4');   // tower block over the tube
    for (let k = 0; k * sp < along - 1; k += seg) {             // podiums beside the tube follow the curve
      const i = iT0 + k + Math.floor(seg / 2), h = head(i);
      for (const [l0, l1] of [[10.5, 46], [-52, -10.5]]) { const [px, pz] = side(i, (l0 + l1) / 2); addB(newB, px, -0.5, pz, h, l1 - l0, 9.2, seg * sp + 0.3, '#efece4'); }
    }
    const [gx, gz] = at(3, zc);
    const [fx, fz] = at(3, zc - along / 2 - 0.4);
    vc.push(part(new THREE.BoxGeometry(92, 1.2, 92), '#6f8a4e', gx, 31.4, gz, ry), part(new THREE.BoxGeometry(100, 1.4, 1.2), '#caa35a', fx, 9.4, fz, ry));
    for (let k = 0; k < 10; k++) { const [x, z] = at(R(-40, 46), zc + R(-40, 40)); pines.push([x, 31.8, z, R(0, TAU), R(0.6, 0.9)]); }
    const [bx, bz] = at(3, zc);
    block(bx, bz, 75);
  }

  // ------------------------------------------------------------------------------------------------ Casino Square
  const facadeTex2 = api.canvasTex(512, 256, (g, w, h) => {   // belle-époque front: arched windows, pilasters, balustrade
    g.fillStyle = '#efe4c8'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 8; k++) {
      const x = k * 64;
      g.fillStyle = '#e2d3ae'; g.fillRect(x, 0, 10, h);
      g.fillStyle = '#34414c'; g.fillRect(x + 20, 70, 28, 80); g.beginPath(); g.arc(x + 34, 70, 14, Math.PI, 0); g.fill();
      g.fillStyle = 'rgba(190,210,225,0.4)'; g.fillRect(x + 22, 72, 24, 16);
      g.fillStyle = '#34414c'; g.fillRect(x + 22, 190, 24, 46);
      g.fillStyle = '#d7c49a'; g.fillRect(x + 16, 150, 36, 5); g.fillRect(x + 16, 184, 36, 4);
    }
    g.fillStyle = '#d9c9a0'; g.fillRect(0, 0, w, 16); g.fillRect(0, 166, w, 10);
    g.fillStyle = '#c9b584'; for (let x = 4; x < w; x += 12) g.fillRect(x, 20, 6, 22);
  }, true);
  const ornate = [], plane = (w, h) => { const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 64, uv.getY(k) * h / 16); return g; };
  {
    const iC = sAt(2), s = S[iC];
    // casino: east of the square, front facing the course (local +x toward the road)
    const place = (lat, fn) => { const x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat; fn(x, ground(x, z), z); };
    place(W2 + 44, (x, y, z) => {
      const face = Math.atan2(-s.right.x, -s.right.z) - Math.PI / 2;   // local +x → toward the road
      const P = [];
      P.push(part(new THREE.BoxGeometry(30, 17, 66), '#efe3c6', 0, 8.5, 0));
      P.push(part(new THREE.BoxGeometry(31, 1.2, 67), '#d6c49b', 0, 17.4, 0));
      P.push(part(new THREE.BoxGeometry(26, 4, 60), '#56707a', -1, 19.5, 0));                  // slate mansard
      P.push(part(new THREE.BoxGeometry(20, 26, 22), '#f2e8cf', 3, 13, 0));                     // central pavilion
      P.push(part(new THREE.SphereGeometry(8.5, 20, 10, 0, TAU, 0, Math.PI / 2), '#6fa89a', 3, 26, 0));
      P.push(part(new THREE.CylinderGeometry(1.4, 1.8, 4.5, 10), '#6fa89a', 3, 36.5, 0), part(new THREE.SphereGeometry(1.1, 8, 6), '#d4b35a', 3, 39.6, 0));
      for (const zz of [-28, 28]) {                                                             // twin towers
        P.push(part(new THREE.BoxGeometry(10, 30, 10), '#f2e8cf', 9, 15, zz));
        P.push(part(new THREE.CylinderGeometry(0.1, 5.6, 7, 4, 1).rotateY(Math.PI / 4), '#6fa89a', 9, 33.5, zz));
        P.push(part(new THREE.SphereGeometry(0.8, 8, 6), '#d4b35a', 9, 37.4, zz));
      }
      P.push(part(new THREE.BoxGeometry(6, 5, 24), '#e6d7b3', 16.5, 2.5, 0), part(new THREE.BoxGeometry(7.5, 0.8, 26), '#caa35a', 17, 5.3, 0));   // entrance canopy
      vc.push(bake(P, x, y, z, face));
      // front facade planes (local +x face)
      const fp = (w, h, lx, ly, lz) => ornate.push(plane(w, h).rotateY(Math.PI / 2).translate(lx, ly, lz).applyMatrix4(M4.makeRotationY(face).setPosition(x, y, z)));
      fp(66, 16, 15.05, 8.5, 0); fp(22, 24, 13.05, 13, 0);
      for (const zz of [-28, 28]) fp(10, 28, 14.05, 15, zz);
      block(x, z, 40);
      // square gardens in front: lawns, flower beds, round fountain, palms
      const gx = s.pos.x + s.right.x * (W2 + 19), gz = s.pos.z + s.right.z * (W2 + 19);
      const G = [part(new THREE.CylinderGeometry(9, 9, 0.3, 28), '#5c8f3e', 0, 0.15, 0), part(new THREE.CylinderGeometry(3.4, 3.6, 0.9, 20), '#e6dcc6', 0, 0.45, 0),
        part(new THREE.CylinderGeometry(2.9, 2.9, 0.2, 20), '#63b3d8', 0, 0.85, 0), part(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 8), '#e6dcc6', 0, 1.6, 0)];
      for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; G.push(part(new THREE.BoxGeometry(2.2, 0.5, 1.2), k % 2 ? '#d62f4b' : '#f1c232', Math.cos(a) * 6.8, 0.4, Math.sin(a) * 6.8, -a)); }
      for (const o of [-20, 20]) G.push(part(new THREE.BoxGeometry(8, 0.3, 14), '#5c8f3e', 2, 0.15, o));
      vc.push(bake(G, gx, ground(gx, gz), gz, face));
      for (const o of [-26, -12, 12, 26]) { const px = gx + s.tan.x * o, pz = gz + s.tan.z * o; palms[0].push([px, ground(px, pz) - 0.1, pz, R(0, TAU), R(0.95, 1.15)]); }
      block(gx, gz, 11);
    });
    // grand hotel on the west side of the square (mansard roof, ornate front)
    place(-(W2 + 36), (x, y, z) => {
      const face = Math.atan2(s.right.x, s.right.z) - Math.PI / 2;
      vc.push(bake([part(new THREE.BoxGeometry(26, 22, 70), '#f1e6cc', 0, 11, 0), part(new THREE.BoxGeometry(27, 1, 71), '#d6c49b', 0, 22.3, 0),
        part(new THREE.BoxGeometry(22, 5, 64), '#4e5c63', -1, 25, 0), part(new THREE.BoxGeometry(8, 7, 14), '#f1e6cc', 11, 25, 0), part(new THREE.SphereGeometry(4, 12, 6, 0, TAU, 0, Math.PI / 2), '#4e5c63', 11, 28.5, 0)], x, y, z, face));
      ornate.push(plane(70, 20).rotateY(Math.PI / 2).translate(13.05, 10.5, 0).applyMatrix4(M4.makeRotationY(face).setPosition(x, y, z)));
      block(x, z, 38);
    });
  }
  // gardens inside Massenet: lawns, paths, flower beds, fountain, palms and a few pines (all low: sightline)
  {
    const [fx, fz] = FLAT[0], P = [];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU + 0.3, r = R(14, 34), x = fx + Math.cos(a) * r, z = fz + Math.sin(a) * r;
      P.push(part(new THREE.CylinderGeometry(R(8, 13), R(8, 13), 0.3, 20).scale(1, 1, R(0.6, 1)), pick(['#5a8c3c', '#679b45', '#4f8237']), x, ground(x, z) + 0.12, z, R(0, TAU)));
      if (k % 2) P.push(part(new THREE.CylinderGeometry(3, 3, 0.45, 14), pick(['#d62f4b', '#f1c232', '#e86fa8']), x, ground(x, z) + 0.3, z));
    }
    P.push(part(new THREE.CylinderGeometry(5, 5.3, 0.8, 24), '#e6dcc6', fx, ground(fx, fz) + 0.4, fz), part(new THREE.CylinderGeometry(4.4, 4.4, 0.2, 24), '#63b3d8', fx, ground(fx, fz) + 0.75, fz));
    vc.push(...P);
    for (let k = 0; k < 14; k++) {
      const a = R(0, TAU), r = R(12, 55), x = fx + Math.cos(a) * r, z = fz + Math.sin(a) * r;
      if (api.near(x, z)[0] < W2 + 16) continue;
      (k % 3 ? palms[k % 2] : pines).push([x, ground(x, z) - 0.1, z, R(0, TAU), R(0.85, 1.1)]);
    }
    block(fx, fz, 60);
  }

  // ------------------------------------------------------------------------------------------------ harbour side
  // swimming-pool complex on the quay beside the pool chicanes
  {
    const x = -482, z = 705, y = ground(x, z);
    vc.push(part(new THREE.BoxGeometry(56, 0.5, 108), '#e9e4d8', x, y + 0.1, z), part(new THREE.BoxGeometry(30, 0.3, 62), '#2fb4d6', x, y + 0.42, z),
      part(new THREE.BoxGeometry(31, 0.35, 0.8), '#f5f5f5', x, y + 0.45, z - 31.2), part(new THREE.BoxGeometry(31, 0.35, 0.8), '#f5f5f5', x, y + 0.45, z + 31.2));
    for (let k = 1; k < 8; k++) vc.push(part(new THREE.BoxGeometry(0.15, 0.1, 60), '#1b6f8f', x - 15 + k * 3.75, y + 0.58, z));
    vc.push(part(new THREE.BoxGeometry(16, 6, 22), '#f3f1ea', x + 12, y + 3, z + 44), part(new THREE.BoxGeometry(17, 0.6, 23), '#2f6fa8', x + 12, y + 6.2, z + 44));
    for (let k = 0; k < 6; k++) vc.push(part(new THREE.BoxGeometry(2.2, 0.25, 1.2), '#f5f5f5', x - 20, y + 0.5, z - 20 + k * 6), part(new THREE.CylinderGeometry(1.5, 0.05, 0.6, 8), '#e53935', x - 22, y + 2.4, z - 18 + k * 6));
    block(x, z, 45);
  }
  // pit garages between the start straight and the pool section; team hospitality units behind
  {
    const a = sAt(111), b = sAt(126);
    for (let i = a; i < b; i += 9) {
      const [x, z] = side(i + 4, WALL + 13 + 6);
      if (sea(x, z, 8) || taken(x, z, 10)) continue;
      addB(newB, x, ground(x, z) - 0.3, z, head(i + 4), 12, 6.5, 9 * sp + 0.4, '#f1f1ef');
      vc.push(part(new THREE.BoxGeometry(12.4, 0.8, 9 * sp + 0.4), '#c8102e', x, ground(x, z) + 5.6, z, head(i + 4)));
      block(x, z, 10);
    }
  }
  // grandstands: harbour quay (Tabac), harbour side of the pool, and the main stand on the start straight
  const standAt = (i0, i1, sg, depth, rows, seat) => {
    for (let i = i0; i < i1; i += 8) {
      const lat = sg * (WALL + 3 + depth / 2), [x, z] = side(i + 4, lat), ry = Math.atan2(-S[i + 4].right.x * sg, -S[i + 4].right.z * sg);
      if (taken(x, z, depth / 2) || sea(x, z, depth / 2 + 3)) continue;
      const len = 8 * sp + 0.3, y = ground(x, z), P = [], rs = ry + Math.PI, c = Math.cos(rs), sn = Math.sin(rs);
      if ([[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([u, v]) => api.near(x + (u * len / 2) * c + (v * depth / 2) * sn, z - (u * len / 2) * sn + (v * depth / 2) * c)[0] < WALL + 1)) continue;
      for (let r = 0; r < rows; r++) {
        P.push(part(new THREE.BoxGeometry(len, 0.5, 1.1), seat, 0, 0.9 + r * 0.62, -depth / 2 + 1 + r * 1.1));
        for (let k = 0; k < len / 0.62; k++) if (rnd() < 0.8) {
          const lx = -len / 2 + 0.3 + k * 0.62 + R(-0.08, 0.08), lz = -depth / 2 + 1.1 + r * 1.1, ly = 1.5 + r * 0.62;
          crowd.push([x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c, rs, rnd() < 0.35 ? pick(['#c8102e', '#f4f4f4', '#c8102e']) : pick(['#2f3440', '#e9e6dc', '#46638f', '#b89a5e', '#56704a', '#8f9296', '#6b3b3b', '#d8c7a0'])]);
        }
      }
      const top = 0.9 + rows * 0.62;
      P.push(part(new THREE.BoxGeometry(len, top, 0.5), '#9aa1ab', 0, top / 2, -depth / 2 + rows * 1.1 + 0.8));
      for (let k = -1; k <= 1; k += 2) P.push(part(new THREE.BoxGeometry(0.3, top + 1, 0.3), '#6d737c', k * len / 2, (top + 1) / 2, -depth / 2 + rows * 1.1 + 0.8));
      P.push(part(new THREE.BoxGeometry(len, 1.1, 0.15), '#c8102e', 0, 0.55, -depth / 2 + 0.35));
      vc.push(bake(P, x, y, z, rs));
      block(x, z, Math.max(depth, len) / 2);
    }
  };
  standAt(sAt(64), sAt(72), -1, 14, 11, '#2d5fa8');
  standAt(sAt(92), sAt(97), -1, 13, 10, '#e8e8e8');
  standAt(sAt(112), sAt(124), -1, 16, 14, '#2d5fa8');

  // yachts: stern-to on the north and south quays, both sides of three pontoons, superyachts along the breakwater
  {
    const moor = (x, z, ang, L, v) => { if (sea(x, z, -4) && sea(x + Math.sin(ang) * L * 0.5, z + Math.cos(ang) * L * 0.5, -3)) yachts[v].push([x, WATER, z, ang, L / 30]); };
    const vIdx = () => (rnd() < 0.62 ? 0 : rnd() < 0.6 ? 1 : 2);
    for (let x = -190; x > -500; x -= R(8, 11)) { const L = R(18, 36); if ([-230, -318, -400].every(px => Math.abs(px - x) > 12)) moor(x, polyZ(x, 405, 428) + L / 2 + 2, 0, L, vIdx()); }
    for (let x = -372; x < -60; x += R(8, 11)) { const L = R(18, 40); moor(x, 982 - L / 2 - 2, Math.PI, L, vIdx()); }
    for (const px of [-230, -318, -400]) {
      vc.push(part(new THREE.BoxGeometry(3, 0.5, 190), '#b89b72', px, WATER + 0.55, 520));
      for (let z = 440; z < 610; z += R(8, 10.5)) for (const sgn of [1, -1]) { const L = R(16, 30); moor(px + sgn * (L / 2 + 2), z, sgn * Math.PI / 2, L, vIdx()); }
    }
    for (let z = 632; z < 795; z += R(8, 10.5)) { const L = R(18, 30); moor(-436 + L / 2 + 2, z, Math.PI / 2, L, vIdx()); }
    for (const [x, z, L] of [[-118, 470, 72], [-98, 560, 64], [-150, 690, 88], [-260, 760, 58], [-190, 880, 70]]) moor(x, z, R(-0.2, 0.2) + 0.15, L, rnd() < 0.5 ? 1 : 2);
    function polyZ(x, z0, z1) { return lerp(z0, z1, clamp((-x - 180) / 330, 0, 1)); }
  }

  // ------------------------------------------------------------------------------------------------ the Rock
  {
    // palace at the harbour end of the plateau, cathedral, the museum on the seaward cliff
    const px = -350, pz = 1150, py = ground(px, pz) - 0.5, P = [];
    P.push(part(new THREE.BoxGeometry(95, 16, 42), '#ecd9b0', 0, 8, 0), part(new THREE.BoxGeometry(96, 1.2, 43), '#d4bf93', 0, 16.4, 0));
    for (let x = -46; x <= 46; x += 4) P.push(part(new THREE.BoxGeometry(2, 1.6, 43.5), '#e3cfa3', x, 17.6, 0));
    P.push(part(new THREE.BoxGeometry(12, 30, 12), '#ecd9b0', -40, 15, -14), part(new THREE.CylinderGeometry(0.1, 7.5, 6, 4).rotateY(Math.PI / 4), '#8f6f5a', -40, 33, -14));
    P.push(part(new THREE.BoxGeometry(10, 22, 10), '#ecd9b0', 38, 11, -16));
    P.push(part(new THREE.BoxGeometry(60, 1.8, 36), '#6b8d4f', 0, 17.2, 0));
    vc.push(bake(P, px, py, pz, 0));
    block(px, pz, 55);
    const cx = -170, cz = 1195, cy = ground(cx, cz) - 0.5;
    vc.push(bake([part(new THREE.BoxGeometry(18, 16, 44), '#f4f0e6', 0, 8, 0), part(new THREE.CylinderGeometry(6, 6, 6, 16), '#f4f0e6', 0, 19, -8), part(new THREE.SphereGeometry(6, 14, 7, 0, TAU, 0, Math.PI / 2), '#e9e2d0', 0, 22, -8),
      part(new THREE.BoxGeometry(8, 26, 8), '#f4f0e6', 0, 13, 20)], cx, cy, cz, 0.2));
    block(cx, cz, 26);
    const mx = 40, mz = 1150, my = ground(mx, mz) - 18;
    vc.push(bake([part(new THREE.BoxGeometry(24, 48, 70), '#e8dcc4', 0, 24, 0), part(new THREE.BoxGeometry(25, 1.4, 71), '#cdbb95', 0, 48.4, 0), part(new THREE.SphereGeometry(7, 14, 7, 0, TAU, 0, Math.PI / 2), '#9fb1a8', 0, 49, 0)], mx, my, mz, -0.45));
    block(mx, mz, 36);
    // old town: small blocks + roofs on the plateau, pines round the cliff edge
    for (let k = 0, t = 0; k < 90 && t < 900; t++) {
      const x = R(-470, 80), z = R(1050, 1260);
      if (polySD(ROCK, x, z) < 22 || taken(x, z, 9)) continue;
      const ry = R(-0.3, 0.3), sx = R(9, 16), sz = R(9, 18);
      house(x, z, ry, sx, sz, R(7, 13)); k++;
    }
    for (let k = 0, t = 0; k < 70 && t < 900; t++) {
      const x = R(-480, 100), z = R(1040, 1270), d = polySD(ROCK, x, z);
      if (d < 4 || d > 22 || taken(x, z, 3)) continue;
      pines.push([x, ground(x, z) - 0.3, z, R(0, TAU), R(0.8, 1.2)]); k++;
    }
  }

  // lamp posts and palms in planters along the harbour quays
  const lamps = [];
  for (let i = 15, j = 14; i <= 31; j = i++) {
    const [ax, az] = MAIN[j], [bx, bz] = MAIN[i], L = Math.hypot(bx - ax, bz - az);
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if (polySD(MAIN, (ax + bx) / 2 + nx * 6, (az + bz) / 2 + nz * 6) < 0) { nx = -nx; nz = -nz; }
    for (let t = 9; t < L - 4; t += 18) { const x = ax + (bx - ax) * t / L + nx * 3, z = az + (bz - az) * t / L + nz * 3; if (!taken(x, z, 0.6) && api.near(x, z)[0] > WALL + 3) lamps.push([x, 0, z, 0, 1]); }
    for (let t = 18; t < L - 6; t += 27) {
      const x = ax + (bx - ax) * t / L + nx * 9, z = az + (bz - az) * t / L + nz * 9;
      if (taken(x, z, 2) || api.near(x, z)[0] < WALL + 5) continue;
      palms[rnd() < 0.5 ? 0 : 1].push([x, ground(x, z) - 0.1, z, R(0, TAU), R(0.9, 1.15)]);
      vc.push(part(new THREE.CylinderGeometry(1.5, 1.6, 0.5, 10), '#d9d0bd', x, ground(x, z) + 0.2, z));
    }
  }

  // ------------------------------------------------------------------------------------------------ town
  // keep open: the harbour-side quays (Tabac → Rascasse) and the paddock strip between the pool section and the pits
  const keepOpen = (k0, k1, sg, l0, l1) => { const a = sAt(k0), n = (sAt(k1) - a + N) % N; for (let k = 0; k <= n; k += 3) for (let l = l0; l <= l1; l += 9) { const [x, z] = side(a + k, sg * l); block(x, z, 7); } };
  keepOpen(58, 101, -1, WALL + 2, 60);
  keepOpen(75, 101, 1, WALL + 2, 34);
  keepOpen(107, 131, 1, WALL + 2, 34);
  // street frontage: blocks right behind the pavement, fronts parallel to the road (low on the inside of corners)
  for (const sg of [1, -1]) for (let i = 0, step = 1; i < N; i += step) {
    const w = R(13, 22), d = R(12, 20), lat = sg * (WALL + 5 + d / 2), [x, z] = side(i, lat), ry = head(i);
    step = Math.max(2, Math.round((w + R(1, 5)) / sp));
    const [ox, oz] = side(i, sg * (WALL + d + 30));
    if (sea(ox, oz, 15) || taken(x, z, Math.min(w, d) / 2)) continue;
    if (!footprintClear(x, z, ry, d, w, WALL + 4)) continue;
    const inCorner = inside(i, lat), q = trackAt(x, z);
    if (q.d < WALL + 4) continue;
    const h = inCorner ? R(4, 7) : R(12, 27);
    house(x, z, ry, d, w, h, { flat: inCorner || rnd() < 0.18 });
  }
  // hillside and districts: jittered grid, denser near the course, modern towers mixed in further up
  {
    const b = track.bounds;
    for (let gx = b.minX - 900; gx < b.maxX + 800; gx += 23) for (let gz = b.minZ - 820; gz < b.maxZ + 300; gz += 23) {
      const x = gx + R(-7, 7), z = gz + R(-7, 7), dT = api.near(x, z)[0];
      if (dT > 1100 || rnd() > (dT < 250 ? 0.9 : dT < 600 ? 0.62 : 0.4)) continue;
      if (sea(x, z, dT < 90 ? 45 : 12) || polySD(ROCK, x, z) > -6) continue;
      const y = ground(x, z);
      if (y > 215) continue;
      const tower = dT > 140 && !inPoly(PTS, x, z) && polySD(ROCK, x, z) < -220 && rnd() < 0.09;
      const sx = tower ? R(18, 28) : R(12, 22), sz = tower ? R(18, 28) : R(11, 20), r = Math.hypot(sx, sz) / 2;
      if (taken(x, z, r * 0.8) || dT < WALL + 6 + r) continue;
      const h = tower ? R(55, 115) : y > 20 ? R(14, 34) : R(12, 28);
      if (!tallOk(x, z, r)) continue;
      const toSea = Math.atan2(0.3, 1) + R(-0.5, 0.5) + (Math.abs(x) > 700 ? R(-0.4, 0.4) : 0);
      house(x, z, tower ? R(0, TAU) : toSea, sx, sz, h, { modern: tower || (dT > 300 && rnd() < 0.15), flat: rnd() < 0.2 });
    }
  }

  // ------------------------------------------------------------------------------------------------ greenery
  // palms along the harbour promenades and the seafront; stone pines and cypresses dotted up the hillside
  for (let i = 0; i < N; i += 5) for (const sg of [1, -1]) {
    const [x, z] = side(i, sg * (WALL + 3 + R(0, 3)));
    if (taken(x, z, 1.5) || !tallOk(x, z, 1.5)) continue;
    const [ox, oz] = side(i, sg * (WALL + 45));
    if (sea(ox, oz, 10) && rnd() < 0.8) palms[rnd() < 0.5 ? 0 : 1].push([x, ground(x, z) - 0.1, z, R(0, TAU), R(0.9, 1.2)]);
    else if (rnd() < 0.12) shrubs.push([x, ground(x, z), z, R(0, TAU), R(0.8, 1.3)]);
  }
  for (let k = 0, t = 0; k < 520 && t < 9000; t++) {
    const x = R(-1500, 1100), z = R(-1080, 1250), dT = api.near(x, z)[0];
    if (dT < WALL + 10 || dT > 950 || sea(x, z, 6) || taken(x, z, 3)) continue;
    const y = ground(x, z);
    if (y < 6 && rnd() < 0.7) continue;
    if (!tallOk(x, z, 3)) continue;
    (rnd() < 0.62 ? pines : cypress).push([x, y - 0.3, z, R(0, TAU), R(0.75, 1.3)]);
    k++;
  }

  // scrub on the Rock's cliffs; lamp posts along the harbour quays
  for (let k = 0, t = 0; k < 160 && t < 3000; t++) {
    const x = R(-480, 110), z = R(1010, 1300), d = polySD(ROCK, x, z);
    if (d < -3 || d > 30 || sea(x, z, 3)) continue;
    shrubs.push([x, ground(x, z) - 0.4, z, R(0, TAU), R(1.2, 2.6)]); k++;
  }
  // ------------------------------------------------------------------------------------------------ mountains behind
  {
    const ctr = [-150, 420], pos = [], cols = [], A = 72, RN = 7;
    const hAt = (a, r) => 170 + (r - 1400) / 1000 * (380 + 170 * Math.sin(a * 5.3 + 1) + 110 * Math.sin(a * 11.7) + 60 * Math.sin(a * 23.1 + 2));
    const vtx = [];
    for (let j = 0; j < RN; j++) for (let k = 0; k <= A; k++) {
      const a = Math.PI + 0.1 + (k / A) * (Math.PI - 1.3), r = 1400 + j * 170, x = ctr[0] + Math.cos(a) * r * 1.15, z = ctr[1] + Math.sin(a) * r;
      vtx.push([x, hAt(a, r) - (j ? 0 : 60), z]);
    }
    const lo = new THREE.Color('#62704a'), hi = new THREE.Color('#aaa596'), cc = new THREE.Color();
    for (let j = 0; j < RN - 1; j++) for (let k = 0; k < A; k++) {
      const q = [vtx[j * (A + 1) + k], vtx[j * (A + 1) + k + 1], vtx[(j + 1) * (A + 1) + k + 1], vtx[(j + 1) * (A + 1) + k]];
      for (const v of [q[0], q[2], q[1], q[0], q[3], q[2]]) { pos.push(...v); cc.copy(lo).lerp(hi, smooth(150, 520, v[1])); cols.push(cc.r, cc.g, cc.b); }
    }
    const m = new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    world.add(m);
  }

  // ------------------------------------------------------------------------------------------------ instancing
  const dm = new THREE.Object3D(), tc = new THREE.Color(), tk = new THREE.Color();
  const inst = (geo, mat, list, set, color, shadow = true) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, i) => { set(e); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); if (color) m.setColorAt(i, tc.set(color(e, i))); });   // color() → hex or Color
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  };
  const boxSet = ([x, y, z, ry, sx, sy, sz]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(sx, sy, sz); };
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // keepCount: world.js thins instanced scenery at lower quality; buildings carry merged parts (roof rooms, terraces,
  // the tunnel block), and rows of lamps / seated crowds would show gaps
  const keep = (m, k = true) => { if (m) m.userData.keepCount = k; };   // crowds: 'medium' (thinned only at low)
  keep(inst(unitBox, facadeMat(facadeTex, 3.4, 3.2, 8, 8), oldB, boxSet, e => e[7]));
  keep(inst(unitBox, facadeMat(modernTex, 3.0, 3.1, 8, 8, { rough: 0.5, metal: 0.1 }), newB, boxSet, e => e[7]));
  keep(inst(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), roofs, boxSet, e => e[7]));
  const ptSet = ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(s); };
  keep(inst(new THREE.PlaneGeometry(0.5, 0.78).rotateY(Math.PI), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), crowd, ([x, y, z, ry]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(R(0.9, 1.1), R(0.85, 1.15), 1); }, e => e[4], false), 'medium');
  const yMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  const yGeos = [yachtGeo('#f7f7f4'), yachtGeo('#1b2a44'), yachtGeo('#5d6772')];
  yachts.forEach((list, v) => inst(yGeos[v], yMat, list, ptSet));
  const frondTex = api.canvasTex(128, 256, paintFrond, false);
  const frondMat = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  [palmParts(rnd, 8.5, 0.7), palmParts(rnd, 9.5, 2.2)].forEach((v, k) => {
    inst(v.trunk, trunkMat, palms[k], ptSet);
    inst(v.crown, frondMat, palms[k], ptSet, () => tk.setRGB(R(0.85, 1.05), R(0.9, 1.08), R(0.8, 0.95)));
  });
  const pineGeo = mergeGeometries([part(new THREE.CylinderGeometry(0.22, 0.35, 7.5, 6).translate(0, 3.75, 0), '#6b5140', 0, 0, 0, 0, 0.06),
    part(new THREE.IcosahedronGeometry(1, 0).scale(4.6, 1.5, 4.6), '#3f5e2e', 0.4, 8, 0), part(new THREE.IcosahedronGeometry(1, 0).scale(2.8, 1.1, 2.8), '#4d6d36', 1.8, 8.8, 1.2)]);
  inst(pineGeo, trunkMat, pines, ptSet, () => tk.setScalar(R(0.8, 1.05)));
  const cypGeo = mergeGeometries([part(new THREE.CylinderGeometry(0.2, 0.25, 1.4, 5).translate(0, 0.7, 0), '#5b4636'), part(new THREE.IcosahedronGeometry(1, 0).scale(1.3, 5.2, 1.3), '#2f4a2a', 0, 5.8, 0)]);
  inst(cypGeo, trunkMat, cypress, ptSet, () => tk.setScalar(R(0.8, 1.1)));
  keep(inst(mergeGeometries([part(new THREE.CylinderGeometry(0.07, 0.11, 4.4, 6).translate(0, 2.2, 0), '#26332b'), part(new THREE.BoxGeometry(0.46, 0.62, 0.46), '#f3ecd0', 0, 4.5, 0),
    part(new THREE.ConeGeometry(0.42, 0.4, 4).rotateY(Math.PI / 4), '#26332b', 0, 5.0, 0), part(new THREE.BoxGeometry(0.9, 0.08, 0.08), '#26332b', 0, 3.9, 0)]), trunkMat, lamps, ptSet));
  inst(new THREE.IcosahedronGeometry(1.2, 0).scale(1, 0.7, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), shrubs, ptSet, () => pick(['#4f7d3a', '#5d8a40', '#b0406a', '#447030']));

  // merged statics
  const statics = new THREE.Mesh(mergeGeometries(vc), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  statics.castShadow = statics.receiveShadow = true;
  world.add(statics);
  if (ornate.length) world.add(new THREE.Mesh(mergeGeometries(ornate), new THREE.MeshStandardMaterial({ map: facadeTex2, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 })));

  // boats cruising offshore
  const cruisers = [];
  for (let t = 0; t < 400 && cruisers.length < 7; t++) {
    const ax = R(-600, 900), az = R(500, 1500), r = R(60, 180);
    if (!sea(ax, az, -120) || api.near(ax, az)[0] < 250) continue;
    cruisers.push({ ax, az, r, w: (rnd() < 0.5 ? -1 : 1) * R(3, 6) / r, a0: R(0, TAU), s: R(0.6, 1.4) });
  }
  const cm = new THREE.InstancedMesh(yGeos[0], yMat, cruisers.length);
  cm.frustumCulled = false;
  world.add(cm);
  let clock = 0;
  const update = dt => {
    const t = clock += dt;
    waterMat.uniforms.uTime.value = t;
    cruisers.forEach((b, i) => {
      const a = b.a0 + t * b.w;
      dm.position.set(b.ax + Math.cos(a) * b.r, WATER + 0.05 * Math.sin(t * 1.3 + i), b.az + Math.sin(a) * b.r);
      dm.rotation.set(0.02 * Math.sin(t * 1.1 + i), Math.atan2(-Math.sin(a) * b.w, Math.cos(a) * b.w), 0.03 * Math.sin(t * 0.8 + i * 2));
      dm.scale.setScalar(b.s);
      dm.updateMatrix();
      cm.setMatrixAt(i, dm.matrix);
    });
    cm.instanceMatrix.needsUpdate = true;
  };
  update(0);   // place the moving instances before the first frame
  api.onUpdate(update);
}

export default { base: 'beach', env, baseBuild: false, build };
