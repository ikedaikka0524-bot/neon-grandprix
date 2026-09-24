// Yas Marina (ヤス・マリーナ): Abu Dhabi at sunset over the desert base, with its own build (the canyon scenery is
// skipped). Real layout, north up (x = east, z = −north). The hotel straddling the final sector under a glowing
// grid-shell canopy that cycles colour, the marina of superyachts inside the lap, the channel to the east and south,
// modern white grandstands with sail roofs, tall floodlight masts, date palms, desert dunes to the west and north, and
// the theme park's huge red roof in the distance.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const DEF = TRACK_BY_ID.yasmarina, W2 = DEF.width / 2, WALL = W2 + (DEF.wallGap ?? 9.4);
const PTS = DEF.points.map(p => [p[0], p[2]]);
const WATER = -1.6;

// the channel wrapping the east and south of the circuit, and the marina basin inside the lap
const SEA = [
  [150, 80], [300, 60], [520, 30], [1800, -100], [1800, 2000], [-900, 2000], [-900, 700], [-560, 560], [-380, 440],
  [-270, 420], [-120, 560], [0, 640], [100, 692], [220, 740], [310, 790], [400, 800], [465, 760], [470, 620],
  [440, 562], [300, 548], [150, 540],
];
const MARINA = [[-215, 275], [-45, 270], [-40, 470], [-90, 440], [-160, 395], [-230, 330]];
const PARK = [650, -600];   // theme park with the red roof

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
const dunes = (x, z) => (0.5 + 0.5 * Math.sin(x * 0.017 + 2.2 * Math.sin(z * 0.009))) ** 2 * 16 + (0.5 + 0.5 * Math.sin(x * 0.006 - z * 0.011 + 1)) * 26
  + 4 * Math.sin(x * 0.05 + z * 0.031);
// flat, landscaped circuit; beaches down to the channel; quays round the marina; dunes rolling up away from the track
function height(x, z, y, dist) {
  const ds = polySD(SEA, x, z), dm = polySD(MARINA, x, z);
  let h;
  if (ds > 0 || dm > 0) h = WATER - 2 - Math.min(Math.max(ds, dm) * 0.03, 8);
  else {
    h = -0.15 + dunes(x, z) * smooth(260, 650, dist) * smooth(40, 200, -ds);
    h = lerp(WATER - 0.4, h, smooth(0, 40, -ds));          // sandy shore
    h = lerp(WATER + 0.1, h, smooth(-12, -14, dm));         // marina quay (a paved lip covers the step)
  }
  return lerp(y, h, smooth(WALL + 2, WALL + 10, dist));
}

const SUN = [-0.86, 0.16, 0.48];
const env = {
  sky: { top: '#344a8f', horizon: '#ffb07a', bottom: '#c98e6c' },
  fog: { color: '#e9ab86', near: 320, far: 2900 },
  sun: { dir: SUN, color: '#ffab66', intensity: 3.1 },
  hemi: { sky: '#c9aede', ground: '#b98a62', intensity: 0.78 },
  exposure: 1.0,
  night: false,
  terrain: { base: '#e2c49a', hills: 0, rim: 0, rimColor: '#d8b184', height },
  road: { base: '#4a484c', line: '#f2efe6', edge: '#f2efe6' },
  shoulder: '#cfae84',
  barrier: 'ads',
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
function triGeo(pos, cols) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}
// box facades with a world-space window grid (see scenery/monaco.js)
function facadeMat(tex, cellW, cellH, cols, rows, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: opts.rough ?? 0.5, metalness: opts.metal ?? 0.15 });
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
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.85, 1.0, wall), wt.rgb, wt.a * wall);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += wt.rgb * wt.a * wall * smoothstep(0.55, 0.8, max(wt.r, max(wt.g, wt.b))) * 0.5;`);
  };
  return m;
}
function paintBands(g, w, h) {   // 8 x 8 cells of 32 px: glazing bands, white slabs, a few warm-lit rooms
  g.clearRect(0, 0, w, h);
  const C = 32;
  for (let cy = 0; cy < h / C; cy++) for (let cx = 0; cx < w / C; cx++) {
    const x = cx * C, y = cy * C, lit = Math.random() < 0.18, v = 40 + Math.random() * 25;
    g.fillStyle = lit ? `rgb(255,${200 + Math.random() * 40 | 0},${130 + Math.random() * 50 | 0})` : `rgb(${v | 0},${v + 22 | 0},${v + 40 | 0})`;
    g.fillRect(x, y + 5, C, C - 13);
    if (!lit) { g.fillStyle = 'rgba(255,190,140,0.28)'; g.fillRect(x, y + 5, C, 5); }
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + C - 2, y + 5, 2, C - 13);
    g.fillStyle = '#f4f2ec'; g.fillRect(x, y + C - 8, C, 4);
  }
}

// palms (after theme-beach.js): date palms are straighter with denser crowns
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
      g.strokeStyle = `rgb(${60 + t * 50 + sh * 0.3 | 0},${100 + t * 40 + sh | 0},${40 + t * 18 | 0})`;
      g.lineWidth = 3.4;
      g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + sd * l * 0.5, y - 5, w / 2 + sd * l, y - 16); g.stroke();
    }
  }
  g.strokeStyle = '#a4a45a'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
}
function palmParts(rnd, H, B, fronds) {
  const R = (a, b) => a + (b - a) * rnd(), SEG = 6, RAD = 5, pos = [], col = [], idx = [];
  for (let k = 0; k <= SEG; k++) {
    const t = k / SEG, px = B * (1 - (1 - t) ** 2), py = H * t, tx = 2 * B * (1 - t), tl = Math.hypot(tx, H);
    const nx = H / tl, ny = -tx / tl, r = 0.3 * (1 - 0.2 * t) + 0.2 * (1 - t) ** 8, c = k % 2 ? [0.36, 0.28, 0.19] : [0.5, 0.41, 0.3];
    for (let j = 0; j < RAD; j++) { const a = j / RAD * TAU; pos.push(px + nx * r * Math.cos(a), py + ny * r * Math.cos(a), r * Math.sin(a)); col.push(...c); }
  }
  for (let k = 0; k < SEG; k++) for (let j = 0; j < RAD; j++) { const a = k * RAD + j, b = k * RAD + (j + 1) % RAD; idx.push(a, a + RAD, b, b, a + RAD, b + RAD); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  const F = [];
  for (let i = 0; i < fronds; i++) F.push(frondGeo(R(3.6, 4.6), 0.8, R(0.5, 0.9), R(-0.7, -1.3), 0.35, 3).rotateY(i / fronds * TAU + R(-0.2, 0.2)));
  for (let i = 0; i < 3; i++) F.push(frondGeo(2.8, 0.6, R(1.1, 1.3), R(0.3, 0.6), 0.3, 3).rotateY(i / 3 * TAU + 0.5));
  return { trunk: mergeGeometries([tg.toNonIndexed(), part(new THREE.IcosahedronGeometry(0.42, 0), '#6a5a2c', B, H, 0)]), crown: mergeGeometries(F).translate(B, H - 0.05, 0) };
}
function yachtGeo(hull, L = 30) {   // motor yacht, bow +z, waterline y = 0, 30 m long
  const B = L * 0.2, sh = new THREE.Shape();
  sh.moveTo(-B / 2, -L / 2); sh.lineTo(B / 2, -L / 2); sh.lineTo(B / 2, L * 0.12);
  sh.quadraticCurveTo(B / 2, L * 0.36, 0, L / 2); sh.quadraticCurveTo(-B / 2, L * 0.36, -B / 2, L * 0.12); sh.closePath();
  const hullG = new THREE.ExtrudeGeometry(sh, { depth: 3.1, bevelEnabled: false, curveSegments: 3 }).rotateX(Math.PI / 2).translate(0, 1.9, 0);
  const W = '#f6f6f3', G = '#1c2531';
  return mergeGeometries([
    part(hullG, hull), part(new THREE.BoxGeometry(B * 1.01, 0.35, L * 0.9), '#e9e6de', 0, 1.2, 0), part(new THREE.BoxGeometry(B * 0.92, 0.12, L * 0.24), '#b58c5c', 0, 1.95, -L * 0.36),
    part(new THREE.BoxGeometry(B * 0.82, 2.3, L * 0.5), W, 0, 3.05, -L * 0.04), part(new THREE.BoxGeometry(B * 0.84, 0.8, L * 0.46), G, 0, 3.2, -L * 0.04),
    part(new THREE.BoxGeometry(B * 0.7, 2.0, L * 0.34), W, 0, 5.15, -L * 0.06), part(new THREE.BoxGeometry(B * 0.72, 0.7, L * 0.3), G, 0, 5.3, -L * 0.06),
    part(new THREE.BoxGeometry(B * 0.56, 1.1, L * 0.18), W, 0, 6.7, -L * 0.1), part(new THREE.BoxGeometry(B * 0.1, 1.6, B * 0.1), '#d8d8d8', 0, 8.0, -L * 0.1),
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
  vec2 s = wv(p, vec2(0.6, 0.8), 31.0, 0.06, t) + wv(p, vec2(-0.7, 0.45), 17.0, 0.05, t) + wv(p, vec2(0.15, -1.0), 9.0, 0.045, t)
    + (wv(p, vec2(0.9, 0.3), 4.7, 0.04, t) + wv(p, vec2(-0.35, -0.8), 2.6, 0.035, t)) * fine;
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyH, uSkyT, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sd = max(dot(R, uSun), 0.0);
  float spec = pow(sd, 700.0) * 22.0 + pow(sd, 60.0) * 1.0;
  gl_FragColor = vec4(mix(uDeep, sky, min(F, 0.75)) + uSunCol * spec, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
// grid-shell canopy: a diamond lattice of LEDs that cycles colour across the roof, tinted glass between the members
const SHELL_VS = `varying vec2 vUv;
#include <fog_pars_vertex>
void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SHELL_FS = `uniform float uTime;
varying vec2 vUv;
#include <fog_pars_fragment>
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float e = dot(q, q);
  if (e > 1.0) discard;
  vec2 g = vec2(vUv.x * 44.0 + vUv.y * 30.0, vUv.x * 44.0 - vUv.y * 30.0);
  vec2 f = min(fract(g), 1.0 - fract(g));
  float d = min(f.x, f.y), line = 1.0 - smoothstep(0.035, 0.09, d), node = 1.0 - smoothstep(0.05, 0.12, max(f.x, f.y));
  float hue = uTime * 0.035 + vUv.x * 0.55 + 0.12 * sin(uTime * 0.45 + vUv.y * 9.0);
  vec3 led = hsv(hue, 0.8, 1.0) * (1.2 + 0.8 * node);
  vec3 glass = vec3(0.55, 0.6, 0.66);
  float edge = smoothstep(1.0, 0.9, e);
  gl_FragColor = vec4(mix(glass, led, line), mix(0.14, 0.95, max(line, 1.0 - edge)));
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
  const bend = curv.map((_, i) => { let s = 0; for (let k = -24; k <= 24; k += 4) s += curv[(i + k + N) % N]; return s / 13; });
  const sAt = k => { let bd = Infinity, bi = 0; const [x, z] = PTS[k]; S.forEach((s, i) => { const d = (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  const side = (i, lat) => { const s = S[((i % N) + N) % N]; return [s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat]; };
  function trackAt(x, z) {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z, i: bi };
  }
  const inside = (i, lat) => (bend[i] > 1 / 260 && lat < 0) || (bend[i] < -1 / 260 && lat > 0);
  const tallOk = (x, z, r) => { const q = trackAt(x, z); return q.d - r >= (inside(q.i, q.lat) ? W2 + 30 : WALL + 4); };
  const wet = (x, z, m = 0) => Math.max(polySD(SEA, x, z), polySD(MARINA, x, z)) > -m;
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

  const vc = [], glow = [], blocks = [], crowd = [], palms = [[], []], shrubs = [], yachts = [[], []];
  const addB = (x, y, z, ry, sx, sy, sz, c) => blocks.push([x, y, z, ry, sx, sy, sz, c]);

  // ------------------------------------------------------------------------------------------------ ground colours
  {
    const base = new THREE.Color('#d8a36c'), tgt = h => { const k = new THREE.Color(h); return k.setRGB(k.r / base.r, k.g / base.g, k.b / base.b); };
    const sand = tgt('#e6cba0'), dune = tgt('#e3b67f'), lawn = tgt('#6d8a3c'), pave = tgt('#b9b1a4'), wetS = tgt('#b99a74'), c = new THREE.Color(), v = new THREE.Vector3(), n = new THREE.Vector3();
    world.traverse(o => {
      const g = o.geometry;
      if (!o.isMesh || !g?.attributes?.color || !(g.parameters?.width >= 1800)) return;
      const pos = g.attributes.position, col = g.attributes.color, nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = api.near(v.x, v.z)[0], ds = polySD(SEA, v.x, v.z), shade = 0.9 + 0.2 * n.fromBufferAttribute(nrm, i).x;
        c.copy(sand).lerp(dune, smooth(3, 25, v.y)).multiplyScalar(shade);
        c.lerp(pave, smooth(60, 30, d) * 0.55);
        c.lerp(lawn, smooth(95, 45, d) * smooth(-50, -80, ds) * (0.5 + 0.5 * Math.sin(v.x * 0.02) * Math.cos(v.z * 0.017) > 0.35 ? 0.85 : 0.2));
        c.lerp(wetS, smooth(-25, -2, ds));
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------------------------------------------ water
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#1c4e63') }, uSkyT: { value: new THREE.Color('#6a74b8') }, uSkyH: { value: new THREE.Color('#ffba8a') },
      uSun: { value: new THREE.Vector3(...SUN).normalize() }, uSunCol: { value: new THREE.Color('#ffc58a') },
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000, 56, 56).rotateX(-Math.PI / 2), waterMat);
  water.position.set(0, WATER, 300);
  water.frustumCulled = false;
  world.add(water);
  // marina quays: stone face + paved lip; a promenade rail
  {
    const pos = [], cols = [], stone = new THREE.Color('#cfc3ad'), lip = new THREE.Color('#e3dccd'), rail = new THREE.Color('#f2f2f2');
    const quad = (a, b, c, d, col) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    for (let i = 0, j = MARINA.length - 1; i < MARINA.length; j = i++) {
      const [ax, az] = MARINA[j], [bx, bz] = MARINA[i], L = Math.hypot(bx - ax, bz - az);
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      if (polySD(MARINA, (ax + bx) / 2 + nx * 6, (az + bz) / 2 + nz * 6) > 0) { nx = -nx; nz = -nz; }
      quad([ax, -0.1, az], [bx, -0.1, bz], [bx + nx * 14, -0.1, bz + nz * 14], [ax + nx * 14, -0.1, az + nz * 14], lip);
      quad([ax, WATER - 2, az], [bx, WATER - 2, bz], [bx, -0.1, bz], [ax, -0.1, az], stone);
      quad([ax + nx * 0.5, 0.9, az + nz * 0.5], [bx + nx * 0.5, 0.9, bz + nz * 0.5], [bx + nx * 0.5, 1.0, bz + nz * 0.5], [ax + nx * 0.5, 1.0, az + nz * 0.5], rail);
    }
    const m = new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    world.add(m);
    block(-130, 360, 70);
  }

  // ------------------------------------------------------------------------------------------------ the hotel
  // two crescent wings either side of the final-sector straight, a glass bridge over the track, and the grid-shell
  const shell = {};
  {
    const iH = sAt(227), s = S[iH], ry = head(iH);
    const at = (lat, al) => [s.pos.x + s.right.x * lat + s.tan.x * al, s.pos.z + s.right.z * lat + s.tan.z * al];
    for (const sg of [1, -1]) for (let k = 0; k < 7; k++) {
      const al = -78 + k * 26;
      if (sg < 0 && (al < -40 || al > 60)) continue;   // the south wing stops short of the box section and the marina
      const bulge = 14 * (1 - (al / 95) ** 2), lat = sg * (WALL + 24 + bulge), [x, z] = at(lat, al);
      const yaw = ry + sg * 28 * al / 9025;   // follow the crescent
      addB(x, -0.3, z, yaw, 26, 42 - Math.abs(al) * 0.08, 27.5, '#f3f1ea');
      vc.push(part(new THREE.BoxGeometry(22, 1.2, 24), '#d9d4c8', x, 42.4 - Math.abs(al) * 0.08, z, yaw));
      block(x, z, 20);
    }
    const [bx, bz] = at(0, 20);
    vc.push(part(new THREE.BoxGeometry(2 * (WALL + 24), 1.4, 16), '#e9e7e2', bx, 16.7, bz, ry), part(new THREE.BoxGeometry(2 * (WALL + 24), 4.4, 15), '#263847', bx, 19.6, bz, ry),
      part(new THREE.BoxGeometry(2 * (WALL + 24), 0.8, 16), '#e9e7e2', bx, 22.2, bz, ry));
    for (const sg of [1, -1]) { const [px, pz] = at(sg * (WALL + 3), 20); vc.push(part(new THREE.BoxGeometry(2.2, 16, 12), '#e9e7e2', px, 8, pz, ry)); }
    // canopy: plane over both wings, two humps, clipped to an ellipse in the shader
    const g = new THREE.PlaneGeometry(220, 190, 56, 48).rotateX(-Math.PI / 2), p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const al = p.getX(k), lat = p.getZ(k), e = (al / 110) ** 2 + (lat / 95) ** 2, rim = Math.sqrt(Math.max(0, 1 - e));
      p.setY(k, 34 + 16 * rim + 9 * rim * (Math.exp(-(((lat - 50) / 26) ** 2)) + Math.exp(-(((lat + 50) / 26) ** 2))));
    }
    g.computeVertexNormals();
    g.applyMatrix4(M4.makeRotationY(ry - Math.PI / 2).setPosition(s.pos.x + s.tan.x * 12, 0, s.pos.z + s.tan.z * 12));
    const mat = new THREE.ShaderMaterial({ uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 } }, vertexShader: SHELL_VS, fragmentShader: SHELL_FS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 3;
    world.add(m);
    shell.mat = mat;
  }

  // ------------------------------------------------------------------------------------------------ marina
  {
    const vIdx = () => (rnd() < 0.75 ? 0 : 1);
    const moor = (x, z, ang, L, v) => { if (polySD(MARINA, x, z) > 4 && polySD(MARINA, x + Math.sin(ang) * L * 0.45, z + Math.cos(ang) * L * 0.45) > 2) yachts[v].push([x, WATER, z, ang, L / 30]); };
    for (let x = -200; x < -60; x += R(11, 14)) { const L = R(28, 44); moor(x, 272 + L / 2 + 2, 0, L, vIdx()); }
    for (let z = 300; z < 440; z += R(11, 14)) { const L = R(28, 42); moor(-43 - L / 2 - 2, z, -Math.PI / 2, L, vIdx()); }
    vc.push(part(new THREE.BoxGeometry(3, 0.6, 120), '#c9b08a', -150, WATER + 0.7, 345, -0.75));
    for (const [off, al, L] of [[12, -28, 78], [-12, 22, 64], [12, 46, 50], [-12, -30, 56]]) moor(-150 + 0.73 * off - 0.68 * al, 345 + 0.68 * off + 0.73 * al, -0.75 + (off > 0 ? 0 : Math.PI), L, 0);
    // boats in the channel
    for (const [x, z, a, L] of [[250, 300, 0.3, 62], [330, 420, -0.4, 48], [-300, 620, 1.2, 70], [150, 920, 2.0, 90], [600, 520, 0.8, 40]]) yachts[1].push([x, WATER, z, a, L / 30]);
  }

  // ------------------------------------------------------------------------------------------------ track side
  // pit building on the south side of the start straight (glass upper floor), paddock units behind
  {
    const a = sAt(252), n = (sAt(9) - a + N) % N;
    for (let k = 0; k < n; k += 10) {
      const i = a + k, [x, z] = side(i + 5, WALL + 16), ry = head(i + 5), len = 10 * sp + 0.2;
      vc.push(part(new THREE.BoxGeometry(22, 8, len), '#eceae4', x, 4, z, ry), part(new THREE.BoxGeometry(24, 0.8, len + 0.6), '#ffffff', x, 12.8, z, ry));
      addB(x, 8, z, ry, 18, 4.4, len, '#dcd8d0');
      block(x, z, 16);
      const [hx, hz] = side(i + 5, WALL + 50);
      if (k % 20 === 0 && !taken(hx, hz, 12)) { vc.push(part(new THREE.BoxGeometry(18, 6.5, 26), pick(['#f4f4f2', '#e6e8ea', '#d9dde2']), hx, 3.2, hz, ry)); block(hx, hz, 14); }
    }
  }
  // white grandstands with cantilevered sail roofs: main straight (north side), the north hairpin, the south loop
  const standAt = (i0, i1, sg, depth, rows) => {
    const n = (i1 - i0 + N) % N;
    for (let k = 0; k < n; k += 8) {
      const i = (i0 + k) % N, lat = sg * (WALL + 2 + depth / 2), [x, z] = side(i + 4, lat), ry = Math.atan2(-S[(i + 4) % N].right.x * sg, -S[(i + 4) % N].right.z * sg);
      if (taken(x, z, depth / 2) || wet(x, z, depth / 2 + 2)) continue;
      const len = 8 * sp + 0.3, y = ground(x, z), P = [], rs = ry + Math.PI, c = Math.cos(rs), sn = Math.sin(rs);
      if ([[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([u, v]) => api.near(x + (u * len / 2) * c + (v * depth / 2) * sn, z - (u * len / 2) * sn + (v * depth / 2) * c)[0] < WALL + 1)) continue;
      for (let r = 0; r < rows; r++) {
        P.push(part(new THREE.BoxGeometry(len, 0.5, 1.1), r % 4 === 3 ? '#9aa3ad' : '#f2f3f5', 0, 0.9 + r * 0.62, -depth / 2 + 1 + r * 1.1));
        for (let q = 0; q < len / 0.62; q++) if (rnd() < 0.72) {
          const lx = -len / 2 + 0.3 + q * 0.62 + R(-0.08, 0.08), lz = -depth / 2 + 1.1 + r * 1.1;
          crowd.push([x + lx * c + lz * sn, y + 1.5 + r * 0.62, z - lx * sn + lz * c, rs, rnd() < 0.3 ? pick(['#d7263d', '#ffffff', '#1f8a4c', '#111111']) : pick(['#f1efe6', '#2f3440', '#46638f', '#c9b28a', '#8f9296', '#e9e6dc'])]);
        }
      }
      const top = 0.9 + rows * 0.62, back = -depth / 2 + rows * 1.1 + 0.8;
      P.push(part(new THREE.BoxGeometry(len, top, 0.5), '#e6e8ec', 0, top / 2, back));
      P.push(part(new THREE.BoxGeometry(len + 0.4, 0.35, depth + 3), '#ffffff', 0, top + 5.5, 0.5, 0, -0.16));   // sail roof, ends at the barrier line
      P.push(part(new THREE.BoxGeometry(0.6, top + 8, 0.6), '#dfe3e8', -len / 2 + 1, (top + 8) / 2, back), part(new THREE.BoxGeometry(0.6, top + 8, 0.6), '#dfe3e8', len / 2 - 1, (top + 8) / 2, back));
      vc.push(bake(P, x, y, z, rs));
      block(x, z, Math.max(depth, len) / 2);
    }
  };
  standAt(sAt(0), sAt(11), -1, 16, 16);
  standAt(sAt(254), sAt(263), -1, 16, 16);
  standAt(sAt(61), sAt(69), 1, 14, 12);
  standAt(sAt(190), sAt(199), -1, 14, 12);
  standAt(sAt(128), sAt(134), 1, 14, 12);
  // floodlight masts (the race runs from sunset into the night): tall poles, alternating sides every ~55 m
  {
    const step = Math.round(55 / sp);
    for (let i = 0, k = 0; i < N; i += step, k++) {
      const sg = k % 2 ? 1 : -1, [x, z] = side(i, sg * (WALL + 4)), ry = head(i);
      if (taken(x, z, 1) || wet(x, z, 1) || api.near(x, z)[0] < WALL + 2) continue;
      vc.push(part(new THREE.CylinderGeometry(0.28, 0.45, 26, 6), '#b9bdc4', x, 13, z), part(new THREE.BoxGeometry(1.4, 1.6, 4.2), '#5b6068', x, 26.2, z, ry));
      const [fx, fz] = side(i, sg * (WALL + 3.25));
      glow.push(part(new THREE.BoxGeometry(0.2, 1.2, 3.8), '#fff3dc', fx, 26.2, fz, ry));
    }
  }

  // ------------------------------------------------------------------------------------------------ theme park
  // the vast red roof in the distance (three-lobed low dome with a central funnel), glass band round the base
  {
    const [px, pz] = PARK, Rr = 120, pos = [], cols = [], red = new THREE.Color('#d32218'), red2 = new THREE.Color('#b01810'), cc = new THREE.Color();
    const RING = 12, SEC = 72, P = (j, k) => {
      const a = k / SEC * TAU, r = Rr * (1 - j / RING) * (1 + 0.14 * Math.cos(3 * a)), h = 34 + 20 * Math.sin(Math.PI / 2 * (j / RING)) ** 0.7 - (j === RING ? 12 : 0);
      return [px + Math.cos(a) * r, h, pz + Math.sin(a) * r];
    };
    for (let j = 0; j < RING; j++) for (let k = 0; k < SEC; k++) {
      const q = [P(j, k), P(j, k + 1), P(j + 1, k + 1), P(j + 1, k)];
      cc.copy(k % 6 < 3 ? red : red2);
      for (const v of [q[0], q[2], q[1], q[0], q[3], q[2]]) { pos.push(...v); cols.push(cc.r, cc.g, cc.b); }
    }
    for (let k = 0; k < SEC; k++) {   // glass band under the eaves
      const a0 = k / SEC * TAU, a1 = (k + 1) / SEC * TAU, r0 = Rr * (1 + 0.14 * Math.cos(3 * a0)) * 0.97, r1 = Rr * (1 + 0.14 * Math.cos(3 * a1)) * 0.97;
      const A = [px + Math.cos(a0) * r0, 0, pz + Math.sin(a0) * r0], B = [px + Math.cos(a1) * r1, 0, pz + Math.sin(a1) * r1];
      cc.set('#42505e');
      for (const v of [A, B, [B[0], 34, B[2]], A, [B[0], 34, B[2]], [A[0], 34, A[2]]]) { pos.push(...v); cols.push(cc.r, cc.g, cc.b); }
    }
    world.add(new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2, side: THREE.DoubleSide })));
    vc.push(part(new THREE.CylinderGeometry(9, 18, 22, 20, 1, true), '#c8ccd2', px, 44, pz));
    block(px, pz, 150);
  }

  // ------------------------------------------------------------------------------------------------ buildings
  // low modern white blocks round the paddock and hotel side; a distant city skyline across the water to the south-west
  for (let t = 0, n = 0; t < 2000 && n < 70; t++) {
    const x = R(-600, 700), z = R(-1100, 700), d = api.near(x, z)[0];
    if (d < WALL + 20 || d > 360 || wet(x, z, 20) || taken(x, z, 16)) continue;
    const sx = R(18, 40), sz = R(16, 34), r = Math.hypot(sx, sz) / 2;
    if (taken(x, z, r) || !tallOk(x, z, r)) continue;
    addB(x, ground(x, z) - 0.5, z, R(0, TAU), sx, R(8, 22), sz, pick(['#f4f2ec', '#ece6da', '#e2e4e8', '#f0e6d2']));
    block(x, z, r); n++;
  }
  for (let k = 0; k < 90; k++) {
    const a = R(2.0, 2.9), r = R(1700, 2000), x = Math.cos(a) * r - 200, z = Math.sin(a) * r + 400, h = R(40, 200) * (rnd() < 0.2 ? 1.5 : 1);
    addB(x, WATER - 1, z, R(0, 1), R(20, 45), h, R(20, 45), pick(['#c9b8a8', '#b8b0a8', '#d8cabc', '#a9a6a6']));
  }
  vc.push(part(new THREE.CylinderGeometry(560, 580, 3, 40).scale(1, 1, 0.4), '#c9a57a', Math.cos(2.45) * 1850 - 200, WATER - 0.6, Math.sin(2.45) * 1850 + 400, -2.45 + Math.PI / 2));

  // ------------------------------------------------------------------------------------------------ greenery
  for (let i = 0; i < N; i += 4) for (const sg of [1, -1]) {   // date palms lining the circuit roads
    const [x, z] = side(i, sg * (WALL + R(5, 9)));
    if (taken(x, z, 2) || wet(x, z, 2) || !tallOk(x, z, 2) || rnd() < 0.35) continue;
    palms[rnd() < 0.7 ? 0 : 1].push([x, ground(x, z), z, R(0, TAU), R(0.9, 1.2)]);
  }
  for (let t = 0, n = 0; t < 4000 && n < 150; t++) {   // groves round the marina, the hotel and the paddock
    const x = R(-420, 480), z = R(-300, 720), d = api.near(x, z)[0];
    if (d < WALL + 6 || wet(x, z, 3) || taken(x, z, 2) || !tallOk(x, z, 2)) continue;
    palms[rnd() < 0.6 ? 0 : 1].push([x, ground(x, z), z, R(0, TAU), R(0.85, 1.25)]); n++;
  }
  for (let t = 0, n = 0; t < 4000 && n < 420; t++) {   // desert scrub on the dunes
    const x = R(-1500, 1200), z = R(-1650, 600), d = api.near(x, z)[0];
    if (d < WALL + 12 || wet(x, z, 10) || taken(x, z, 1)) continue;
    shrubs.push([x, ground(x, z) - 0.2, z, R(0, TAU), R(0.6, 1.6)]); n++;
  }

  // ------------------------------------------------------------------------------------------------ assemble
  const dm = new THREE.Object3D(), tc = new THREE.Color();
  const inst = (geo, mat, list, set, color, shadow = true) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, i) => { set(e); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); if (color) m.setColorAt(i, tc.set(color(e, i))); });
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  };
  const boxSet = ([x, y, z, ry, sx, sy, sz]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(sx, sy, sz); };
  const ptSet = ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(s); };
  inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), facadeMat(api.canvasTex(256, 256, paintBands), 3.0, 3.4, 8, 8), blocks, boxSet, e => e[7]);
  inst(new THREE.PlaneGeometry(0.5, 0.78).rotateY(Math.PI), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), crowd,
    ([x, y, z, ry]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(R(0.9, 1.1), R(0.85, 1.15), 1); }, e => e[4], false);
  const yMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05 });
  [yachtGeo('#f7f7f4'), yachtGeo('#23324d')].forEach((g, v) => inst(g, yMat, yachts[v], ptSet));
  const frondMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(128, 256, paintFrond, false), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  [palmParts(rnd, 7.5, 0.25, 14), palmParts(rnd, 9.5, 1.2, 11)].forEach((v, k) => { inst(v.trunk, trunkMat, palms[k], ptSet); inst(v.crown, frondMat, palms[k], ptSet, () => tc.setRGB(R(0.85, 1.05), R(0.85, 1.0), R(0.7, 0.9))); });
  inst(new THREE.IcosahedronGeometry(1, 0).scale(1.2, 0.6, 1.2).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), shrubs, ptSet, () => pick(['#8a8a52', '#9c8d5a', '#7d7f4a', '#a39266']), false);

  const statics = new THREE.Mesh(mergeGeometries(vc), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  statics.castShadow = statics.receiveShadow = true;
  world.add(statics);
  if (glow.length) world.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));

  // ------------------------------------------------------------------------------------------------ animation
  let clock = 0;
  api.onUpdate(dt => {
    clock += dt;
    waterMat.uniforms.uTime.value = clock;
    shell.mat.uniforms.uTime.value = clock;
  });
}

export default { base: 'desert', env, baseBuild: false, build };
