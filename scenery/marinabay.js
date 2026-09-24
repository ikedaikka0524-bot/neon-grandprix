// Marina Bay (マリーナベイ): the Singapore night race over the city base, with its own build (the generic neon-city
// scenery is skipped). Real layout, north up (x = east, z = −north); the course runs the real lap in reverse. Floodlight
// gantries along the whole lap, the bay with lights mirrored in the water, the three-tower hotel with the sky-park
// ship across the bay, the observation wheel by the pit straight, the floating stadium, the Esplanade and Anderson
// bridges, the double-helix footbridge, glowing garden "supertrees", the Padang and a dense lit skyline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const DEF = TRACK_BY_ID.marinabay, W2 = DEF.width / 2, WALL = W2 + (DEF.wallGap ?? 9.4);
const PTS = DEF.points.map(p => [p[0], p[2]]);
const WATER = -3.2, GROUND = -0.2;

// Water: the Singapore River from the west through Anderson and Esplanade bridges into Marina Bay; the bay's north
// shore runs below the Raffles Avenue stretch, the east shore past the wheel, the south shore under the hotel towers.
const BAY = [
  [-1850, 440], [-1400, 447], [-1300, 452], [-1200, 456], [-1150, 458], [-1085, 432], [-1000, 418], [-900, 400],
  [-830, 345], [-720, 300], [-600, 292], [-470, 298], [-380, 318], [-300, 372], [-200, 382], [-90, 388], [20, 392],
  [52, 460], [58, 600], [40, 740], [-40, 800], [-150, 790], [-330, 778], [-470, 772], [-620, 740], [-800, 690],
  [-950, 630], [-1050, 590], [-1110, 552], [-1250, 543], [-1400, 538], [-1850, 530],
];
const PARKS = [[-1235, 250, 95, 70], [-960, 210, 60, 40], [40, 1010, 160, 90], [-700, -420, 60, 40]];   // x, z, rx, rz (Padang, Esplanade park, gardens, fountain square)

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
// flat city; the bay drops away just outside the barriers (the bridges carry the road over it)
function height(x, z, y, dist) {
  const d = polySD(BAY, x, z);
  const land = d > 0 ? WATER - 3 - Math.min(d * 0.04, 6) : lerp(WATER + 0.1, GROUND, smooth(-12, -14, d));
  return lerp(y, land, smooth(WALL + 1.2, WALL + 5, dist));
}

const env = {
  sky: { top: '#050918', horizon: '#2c3150', bottom: '#0b0e1c' },
  fog: { color: '#151b31', near: 260, far: 2100 },
  sun: { dir: [0.35, 0.42, -0.84], color: '#9fb2ff', intensity: 0.45 },   // moonlight
  hemi: { sky: '#6d80bc', ground: '#35303f', intensity: 0.95 },
  exposure: 1.12,
  envIntensity: 0.14,
  night: true,
  terrain: { base: '#2c2e35', hills: 0, rim: 0, rimColor: '#1d1f26', height },
  road: { base: '#2f3136', line: '#f2f2ee', edge: '#f4f4f0', roughness: 0.55 },
  shoulder: '#3a3c42',
  barrier: 'ads',
  curb: ['#e0202e', '#f2f2f2'],
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
function beam(a, b, t, color) {   // box from point a to point b
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.BoxGeometry(t, len, t).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return part(g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), color);
}

// Box / prism facades with a world-space window grid (one texture reads right on any size); lit windows glow.
function facadeMat(tex, cellW, cellH, cols, rows, glow, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: opts.rough ?? 0.6, metalness: opts.metal ?? 0.2 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uCell = { value: new THREE.Vector4(cellW, cellH, cols, rows) };
    sh.uniforms.uGlow = { value: glow };
    sh.vertexShader = 'varying vec3 vFW; varying vec3 vFN; varying float vSeed;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fw = vec4(transformed, 1.0); vec3 fn = objectNormal; vSeed = 0.0;
      #ifdef USE_INSTANCING
        fw = instanceMatrix * fw; fn = mat3(instanceMatrix) * fn;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #endif
      vFW = (modelMatrix * fw).xyz; vFN = normalize(mat3(modelMatrix) * fn);`);
    sh.fragmentShader = 'uniform vec4 uCell; uniform float uGlow; varying vec3 vFW; varying vec3 vFN; varying float vSeed;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', '')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fN = normalize(vFN); float wall = 1.0 - step(0.6, abs(fN.y));
        vec2 cell = vec2((vFW.z * fN.x - vFW.x * fN.z) / uCell.x + floor(vSeed * 97.0), vFW.y / uCell.y + floor(fract(vSeed * 13.7) * 41.0));
        vec4 wt = texture2D(map, cell / uCell.zw);
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(0.7, 1.0, wall), wt.rgb, wt.a * wall);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += wt.rgb * wt.a * wall * smoothstep(0.32, 0.62, max(wt.r, max(wt.g, wt.b))) * uGlow;`);
  };
  return m;
}
const windows = (C, lit, dark, pOn, pFloor, mx, my, extra) => (g, w, h) => {   // cells of C px; alpha 0 = facade
  g.clearRect(0, 0, w, h);
  const any = a => a[Math.floor(Math.random() * a.length)];
  for (let fy = 0; fy < h / C; fy++) {
    const p = Math.random() < pFloor ? 0.92 : pOn;
    for (let fx = 0; fx < w / C; fx++) {
      const x = fx * C + mx, y = fy * C + my, ww = C - 2 * mx, hh = C - 2 * my, on = Math.random() < p;
      g.fillStyle = on ? any(lit) : any(dark); g.fillRect(x, y, ww, hh);
      if (on && Math.random() < 0.4) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.5})`; g.fillRect(x, y, ww, hh); }
    }
  }
  extra?.(g, w, h, C);
};
const paintOffice = windows(16, ['#fff6de', '#eef4ff', '#ffe9bd', '#dfeaff'], ['#131a26', '#172031', '#0f1520'], 0.45, 0.25, 1, 3);
const paintHotel = windows(16, ['#ffd48a', '#ffe2a8', '#ffc978', '#fff0cc'], ['#1d1a22', '#221e28'], 0.4, 0.05, 4, 4, (g, w, h, C) => {
  g.fillStyle = 'rgba(210,210,220,0.9)'; for (let y = C - 2; y < h; y += C) g.fillRect(0, y, w, 2);
});
const paintGlass = windows(16, ['#bfe2ff', '#e6f4ff', '#9fd0ff'], ['#0a1426', '#0c1830', '#08101f'], 0.18, 0.08, 0, 1, (g, w, h) => {
  for (let x = 24; x < w; x += 64) { g.fillStyle = 'rgba(120,220,255,0.9)'; g.fillRect(x, 0, 2, h); }
});

// Palm (after theme-beach.js)
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

// Night water: dark swell, sky glow, and the bright lights on the shore mirrored as glitter streaks
const NL = 40;
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
uniform vec3 uDeep, uSkyT, uSkyH;
uniform vec4 uL[${NL}];
uniform vec3 uLC[${NL}];
varying vec3 vW;
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 d, float l, float a, float t) { float k = 6.2831853 / l; d = normalize(d); return d * a * cos(k * dot(d, p) - sqrt(9.8 * k) * t); }
void main() {
  vec2 p = vW.xz; float t = uTime;
  vec2 s = wv(p, vec2(0.6, 0.8), 17.0, 0.05, t) + wv(p, vec2(-0.7, 0.45), 9.0, 0.045, t) + wv(p, vec2(0.15, -1.0), 4.3, 0.04, t) + wv(p, vec2(-0.9, -0.2), 2.1, 0.035, t);
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 col = mix(uDeep, mix(uSkyH, uSkyT, pow(clamp(R.y, 0.0, 1.0), 0.5)), min(F, 0.6)), glint = vec3(0.0);
  for (int i = 0; i < ${NL}; i++) {
    vec4 L = uL[i];
    if (L.w <= 0.0) continue;
    vec3 d = normalize(L.xyz - vW);
    float a = max(dot(R, d), 0.0);
    glint += uLC[i] * L.w * (pow(a, 2500.0) * 5.0 + pow(a, 350.0) * 0.3);
  }
  col += glint * (0.25 + F) / (1.0 + 0.6 * max(glint.r, max(glint.g, glint.b)));
  gl_FragColor = vec4(col, 1.0);
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
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
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
  const tallOk = (x, z, r) => { const q = trackAt(x, z); return q.d - r >= (inside(q.i, q.lat) ? W2 + 34 : WALL + 6); };
  const wet = (x, z, m = 0) => polySD(BAY, x, z) > -m;   // in (or within m of) the water
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

  const vc = [], glow = [], halos = [], refl = [], braces = [];   // statics, self-lit parts, glow sprites, lights mirrored in the bay, gantry lattice
  const towers = [[], [], []], octs = [], crowd = [], palms = [[], []], rainTrees = [];
  const halo = (x, y, z, c, size) => { C3.set(c); halos.push([x, y, z, C3.r, C3.g, C3.b, size]); };
  const mirror = (x, y, z, c, k) => refl.push([x, y, z, c, k]);
  const DARK = ['#1b1f27', '#20242d', '#262a33', '#1a1d22', '#2b2f38', '#303440'];
  // tower: facade kind (0 office, 1 hotel, 2 glass), optional setback tier and lit crown
  const tower = (x, z, ry, sx, sz, h, kind, opt = {}) => {
    const y = ground(x, z) - 0.5;
    towers[kind].push([x, y, z, ry, sx, h, sz, opt.color || pick(DARK), 0]);
    let top = y + h;
    if (opt.tier) { towers[kind].push([x, top, z, ry, sx * 0.72, h * opt.tier, sz * 0.72, opt.color || pick(DARK), 0]); top += h * opt.tier; }
    if (opt.crown) glow.push(part(new THREE.BoxGeometry(sx * 0.5, 3, sz * 0.5), opt.crown, x, top + 1.5, z, ry));
    if (h > 90) { glow.push(part(new THREE.BoxGeometry(1, 1, 1), '#ff2020', x, top + 1, z)); halo(x, top + 1.2, z, '#ff3030', 4); }
    block(x, z, Math.hypot(sx, sz) / 2);
  };

  // ------------------------------------------------------------------------------------------------ ground colours
  {
    const base = new THREE.Color(env.terrain.base), tgt = h => { const k = new THREE.Color(h); return k.setRGB(k.r / base.r, k.g / base.g, k.b / base.b); };
    const pave = tgt('#34363d'), grass = tgt('#1f3a24'), c = new THREE.Color(), v = new THREE.Vector3();
    world.traverse(o => {
      const g = o.geometry;
      if (!o.isMesh || !g?.attributes?.color || !(g.parameters?.width >= 1800)) return;
      const pos = g.attributes.position, col = g.attributes.color;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let park = 0;
        for (const [px, pz, rx, rz] of PARKS) park = Math.max(park, smooth(1.05, 0.9, Math.hypot((v.x - px) / rx, (v.z - pz) / rz)));
        c.copy(pave).multiplyScalar(0.85 + 0.25 * (0.5 + 0.5 * Math.sin(v.x * 0.05) * Math.cos(v.z * 0.043))).lerp(grass, park);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    });
  }

  // ------------------------------------------------------------------------------------------------ water + quays
  const waterMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#03060d') }, uSkyT: { value: new THREE.Color('#0a1022') }, uSkyH: { value: new THREE.Color('#34395a') },
      uL: { value: Array.from({ length: NL }, () => new THREE.Vector4()) }, uLC: { value: Array.from({ length: NL }, () => new THREE.Color()) },
    },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 8, 8).rotateX(-Math.PI / 2), waterMat);
  water.position.set(-600, WATER, 300);
  water.frustumCulled = false;
  world.add(water);
  {
    const pos = [], cols = [], stone = new THREE.Color('#5d5a55'), lip = new THREE.Color('#4a4b50'), rail = new THREE.Color('#9aa0aa');
    const quad = (a, b, c, d, col) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    for (let i = 0, j = BAY.length - 1; i < BAY.length; j = i++) {
      const [ax, az] = BAY[j], [bx, bz] = BAY[i], L = Math.hypot(bx - ax, bz - az);
      if (L > 2000) continue;
      let nx = -(bz - az) / L, nz = (bx - ax) / L;   // unit normal toward land
      if (polySD(BAY, (ax + bx) / 2 + nx * 6, (az + bz) / 2 + nz * 6) > 0) { nx = -nx; nz = -nz; }
      for (let s = 0; s < L; s += 5) {
        const e = Math.min(L, s + 5), x0 = ax + (bx - ax) * s / L, z0 = az + (bz - az) * s / L, x1 = ax + (bx - ax) * e / L, z1 = az + (bz - az) * e / L;
        if (api.near((x0 + x1) / 2, (z0 + z1) / 2)[0] < WALL + 6) continue;   // bridges take over here
        quad([x0, GROUND + 0.05, z0], [x1, GROUND + 0.05, z1], [x1 + nx * 14, GROUND + 0.05, z1 + nz * 14], [x0 + nx * 14, GROUND + 0.05, z0 + nz * 14], lip);
        quad([x0, WATER - 2, z0], [x1, WATER - 2, z1], [x1, GROUND + 0.05, z1], [x0, GROUND + 0.05, z0], stone);
        quad([x0 + nx * 0.6, 0.9, z0 + nz * 0.6], [x1 + nx * 0.6, 0.9, z1 + nz * 0.6], [x1 + nx * 0.6, 1.0, z1 + nz * 0.6], [x0 + nx * 0.6, 1.0, z0 + nz * 0.6], rail);
      }
    }
    const m = new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    world.add(m);
  }

  // ------------------------------------------------------------------------------------------------ bridges
  // wherever the road crosses water: parapet fascia outside the barriers and piers underneath; the river crossing by
  // the hairpin gets three cream steel arches over the deck on each side
  {
    const pos = [], cols = [], fas = new THREE.Color('#8a8680'), dk = new THREE.Color('#55524d');
    const Lf = WALL + 1.3;
    const P = (i, lat, y) => { const [x, z] = side(i, lat); return [x, y, z]; };
    const quad = (a, b, c, d, col) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) cols.push(col.r, col.g, col.b); };
    const over = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const [x1, z1] = side(i, WALL + 8), [x2, z2] = side(i, -WALL - 8); over[i] = wet(x1, z1, -2) || wet(x2, z2, -2) ? 1 : 0; }
    for (let i = 0; i < N; i++) if (over[i] && !over[(i + 1) % N] && over[(i + 3) % N]) over[(i + 1) % N] = over[(i + 2) % N] = 1;   // close 1-2 sample gaps
    const spans = [];
    for (let i = 0; i < N; i++) {
      if (!over[i]) continue;
      const j = (i + 1) % N;
      for (const sg of [1, -1]) {
        quad(P(i, sg * Lf, 1.1), P(j, sg * Lf, 1.1), P(j, sg * Lf, WATER - 0.5), P(i, sg * Lf, WATER - 0.5), fas);
        quad(P(i, sg * (Lf + 0.6), 1.3), P(j, sg * (Lf + 0.6), 1.3), P(j, sg * (Lf - 0.4), 1.3), P(i, sg * (Lf - 0.4), 1.3), dk);
      }
      quad(P(i, -Lf, -0.6), P(j, -Lf, -0.6), P(j, Lf, -0.6), P(i, Lf, -0.6), dk);   // deck soffit
      if (!over[(i - 1 + N) % N] || !spans.length) spans.push([i, i]);
      spans[spans.length - 1][1] = i;
    }
    const pierEvery = Math.round(26 / sp);
    for (const [a, b] of spans) {
      const n = b - a + 1, west = i => S[i % N].pos.x < -1185;   // the river crossing west of the hairpin gets the arches
      for (let k = 0; k <= n; k += pierEvery) {
        const i = a + k, ry = head(i), [x, z] = side(i, 0), anderson = west(i);
        vc.push(part(new THREE.BoxGeometry(2 * Lf + 2, 1.0, 3.2), '#6c6964', x, -1.1, z, ry));
        vc.push(part(new THREE.BoxGeometry(2 * Lf - 4, -0.6 - WATER, 2.4), '#7d7973', x, (WATER - 0.6) / 2, z, ry));
        if (!anderson) for (const sg of [1, -1]) { const [lx, lz] = side(i, sg * (Lf + 0.2)); glow.push(part(new THREE.BoxGeometry(0.5, 0.5, 0.5), '#ffe7b0', lx, 2.2, lz)); vc.push(part(new THREE.CylinderGeometry(0.08, 0.1, 1.1, 5), '#2b2d31', lx, 1.5, lz)); halo(lx, 2.3, lz, '#ffd9a0', 2.5); }
      }
      const wi = []; for (let i = a; i <= b; i++) if (west(i)) wi.push(i);
      if (wi.length > 8) {
        const a2 = wi[0], b2 = wi[wi.length - 1], k3 = Math.max(1, Math.floor((b2 - a2) / 3));
        for (let q = 0; q < 3; q++) for (const sg of [1, -1]) {
          const i0 = a2 + q * k3, i1 = Math.min(b2, a2 + (q + 1) * k3), H = 11;
          let prev = null;
          for (let k = 0; k <= 12; k++) {
            const i = Math.round(lerp(i0, i1, k / 12)), [x, z] = side(i, sg * (Lf + 0.3)), y = 1.2 + H * Math.sin(Math.PI * k / 12), cur = V3(x, y, z);
            if (prev) { vc.push(beam(prev, cur, 0.7, '#e8dfc6')); if (k % 2 === 0) vc.push(beam(V3(x, 1.2, z), cur, 0.25, '#e8dfc6')); }
            if (k % 3 === 0 && k) halo(x, y + 0.6, z, '#fff1d0', 2.5);
            prev = cur;
          }
          const [mx, mz] = side(Math.round((i0 + i1) / 2), sg * (Lf + 0.3));
          mirror(mx, 6, mz, '#fff1d0', 0.5);
        }
      }
      const [mx, mz] = side(Math.round((a + b) / 2), Lf);
      mirror(mx, 2.5, mz, '#ffd9a0', 0.6);
    }
    if (pos.length) { const m = new THREE.Mesh(triGeo(pos, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); m.receiveShadow = true; world.add(m); }
  }

  // ------------------------------------------------------------------------------------------------ floodlights
  // light gantries every ~30 m, alternating sides: truss pole behind the barrier, arm over the run-off, lamp banks
  const lamps = [];
  {
    const step = Math.round(30 / sp);
    for (let i = 0, k = 0; i < N; i += step, k++) {
      let sg = k % 2 ? 1 : -1;
      if (inside(i, sg)) sg = -sg;   // on the inside of a bend the offsets fold back to the apex: pole inside the wall, arm in the view
      const ry = head(i), [px, pz] = side(i, sg * (WALL + 1.8)), [ax, az] = side(i, sg * (W2 + 5.5)), [mx, mz] = side(i, sg * (W2 + 9.5));
      if (api.near(px, pz)[0] < WALL + 1.5) continue;   // another stretch of the lap passes close by
      const H = 12.5;
      vc.push(part(new THREE.BoxGeometry(0.7, H, 0.7), '#5e636d', px, H / 2, pz, ry));
      for (let y = 1.5; y < H - 1; y += 2.2) braces.push(part(new THREE.BoxGeometry(0.1, 2.9, 0.1), '#7a808b', px, y + 1.1, pz, ry, 0, 0.7 * (y % 4.4 < 2.2 ? 1 : -1)));
      vc.push(beam(V3(px, H - 0.3, pz), V3(ax, H - 0.3, az), 0.45, '#5e636d'), beam(V3(px, H - 2.6, pz), V3(mx, H - 0.4, mz), 0.2, '#6d727c'));
      for (const [lx, lz] of [[ax, az], [mx, mz]]) {
        vc.push(part(new THREE.BoxGeometry(2.8, 0.55, 1.1), '#2a2d33', lx, H - 0.85, lz, ry));
        glow.push(part(new THREE.BoxGeometry(2.6, 0.08, 0.9), '#fffaf0', lx, H - 1.15, lz, ry));
        halo(lx, H - 1.3, lz, '#fff4e0', 3.2);
      }
      lamps.push([ax, az]);
      if (k % 4 === 0 && (wet(...side(i, sg * 60), 0) || wet(...side(i, -sg * 60), 0))) mirror(ax, H, az, '#fff4e0', 0.5);
    }
  }
  // light pools on the road and run-off under the gantries (additive)
  {
    const RR = 20, lats = [-WALL + 0.8, -W2 - 3, -W2, -W2 / 2, 0, W2 / 2, W2, W2 + 3, WALL - 0.8], pp = [], pc = [], c = new THREE.Color('#fff2da');
    const rows = [];
    for (let i = 0; i < N; i += 2) rows.push(lats.map(lat => {
      const [x, z] = side(i, lat), y = S[i].pos.y + (Math.abs(lat) < W2 ? 0.06 : 0.1);
      let e = 0;
      for (const [lx, lz] of lamps) { const dx = x - lx, dz = z - lz; if (Math.abs(dx) < RR && Math.abs(dz) < RR) { const q = 1 - (dx * dx + dz * dz) / (RR * RR); if (q > 0) e += q * q; } }
      const k = Math.min(e, 1.4) * 0.2;
      return [x, y, z, c.r * k, c.g * k, c.b * k];
    }));
    for (let r = 0; r < rows.length; r++) for (let q = 0; q < lats.length - 1; q++) {
      const A = rows[r], B = rows[(r + 1) % rows.length], v = [A[q], A[q + 1], B[q + 1], B[q]];
      for (const k of [0, 1, 2, 0, 2, 3]) { pp.push(v[k][0], v[k][1], v[k][2]); pc.push(v[k][3], v[k][4], v[k][5]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    m.renderOrder = 1;
    world.add(m);
  }
  // debris fence above the barrier walls (alpha-tested mesh; posts drawn into the texture)
  {
    const tex = api.canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(170,176,186,0.95)'; g.lineWidth = 1.3;
      for (let k = -h; k < w + h; k += 8) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); }
      g.fillStyle = '#3c4048'; g.fillRect(0, 0, 5, h); g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3);
    });
    const pos = [], uv = [], L = WALL + 0.65, top = 4.3;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, u0 = i * sp / 4, u1 = (i + 1) * sp / 4;
      for (const sg of [1, -1]) {
        const [ax, az] = side(i, sg * L), [bx, bz] = side(j, sg * L), ya = S[i].pos.y, yb = S[j].pos.y;
        pos.push(ax, ya + 1.05, az, bx, yb + 1.05, bz, bx, yb + top, bz, ax, ya + 1.05, az, bx, yb + top, bz, ax, ya + top, az);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    world.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 })));
  }

  // ------------------------------------------------------------------------------------------------ landmarks
  // observation wheel east of the pit straight's south end (capsules stay upright as it turns)
  const wheel = { x: 150, z: 330, R: 75, hub: 90, n: 28 };
  {
    const { x, z, R: Rw, hub } = wheel;
    const outer = new THREE.Group();
    outer.position.set(x, 0, z); outer.rotation.y = Math.PI / 2 + 0.25;   // wheel plane faces roughly west
    const F = [];
    for (const zs of [1, -1]) for (const xs of [1, -1]) F.push(beam(V3(xs * 26, 0, zs * 16), V3(0, hub, zs * 3.2), 2.2, '#c7ccd6'));
    F.push(part(new THREE.CylinderGeometry(2.2, 2.2, 9, 12).rotateX(Math.PI / 2), '#a8aeb9', 0, hub, 0));
    F.push(part(new THREE.BoxGeometry(70, 12, 40), '#3a3f4a', 0, 6, 0), part(new THREE.BoxGeometry(70.5, 1, 40.5), '#8ecbff', 0, 12.2, 0));
    outer.add(new THREE.Mesh(mergeGeometries(F), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 })));
    const spin = new THREE.Group();
    spin.position.y = hub;
    const G = [new THREE.TorusGeometry(Rw, 1.1, 6, 120), new THREE.TorusGeometry(Rw - 6, 0.5, 5, 120), new THREE.TorusGeometry(9, 0.5, 5, 32)];
    for (let k = 0; k < 28; k++) G.push(new THREE.CylinderGeometry(0.18, 0.18, Rw - 9, 4).translate(0, (Rw + 9) / 2, 0).rotateZ(k / 28 * TAU));
    spin.add(new THREE.Mesh(mergeGeometries(G.map(g => part(g, '#b9c0cc'))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 })));
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(Rw + 1.3, 0.35, 4, 160), new THREE.MeshBasicMaterial({ color: '#6fd3ff', toneMapped: false })));
    outer.add(spin);
    const caps = new THREE.InstancedMesh(new THREE.CapsuleGeometry(2.2, 5, 3, 8).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#d9f4ff', toneMapped: false }), wheel.n);
    caps.frustumCulled = false;
    outer.add(caps);
    world.add(outer);
    Object.assign(wheel, { spin, caps });
    mirror(x - 20, hub, z, '#8fdcff', 1.2);
    mirror(x - 20, hub - 55, z + 10, '#8fdcff', 0.8);
    block(x, z, 45);
  }
  // three-tower hotel across the bay with the sky-park "ship" (towers in a row along z, legs leaning together)
  {
    const cx = -250, zs = [830, 900, 970], H = 192;
    for (const tz of zs) {
      const y = ground(cx, tz) - 0.5;
      towers[1].push([cx - 13, y, tz, 0, 15, H, 34, '#2a2d34', 0]);
      towers[1].push([cx + 11, y, tz, 0, 15, H * 1.003, 34, '#2a2d34', 0.05]);
      halo(cx, H + 8, tz, '#9ad0ff', 6);
      mirror(cx, 90, tz, '#ffd9a0', 1.3);
      block(cx, tz, 38);
    }
    const sh = new THREE.Shape();
    sh.moveTo(-19, -110); sh.lineTo(17, -110); sh.quadraticCurveTo(20, 20, 12, 160); sh.quadraticCurveTo(0, 175, -12, 160); sh.quadraticCurveTo(-21, 20, -19, -110);
    const ship = new THREE.ExtrudeGeometry(sh, { depth: 7, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2).rotateY(Math.PI);
    vc.push(part(ship, '#c9ccd2', cx, H + 8.5, 900));
    glow.push(part(new THREE.BoxGeometry(34, 0.5, 250), '#3fb7ff', cx, H + 1.8, 890), part(new THREE.BoxGeometry(8, 0.3, 120), '#4fd6ff', cx - 8, H + 8.7, 870));
    for (let k = 0; k < 16; k++) vc.push(part(new THREE.IcosahedronGeometry(2, 0), '#26452c', cx + R(-12, 12), H + 10, R(780, 1030)));
    vc.push(part(new THREE.BoxGeometry(60, 16, 190), '#2c2f36', cx - 70, 8, 890), part(new THREE.BoxGeometry(61, 0.6, 191), '#ffd27a', cx - 70, 16.2, 890));
    // lotus-shaped museum at the tip of the promenade
    const lx = -470, lz = 760;
    for (let k = 0; k < 10; k++) vc.push(part(new THREE.ConeGeometry(6, 26, 6).translate(0, 13, 0).rotateZ(-0.7).translate(6, 0, 0).rotateY(k / 10 * TAU), '#f1f1ef', lx, GROUND, lz));
    halo(lx, 12, lz, '#ffd7f0', 10);
    block(lx, lz, 26);
    // laser show from the sky park, sweeping over the bay
    const lg = new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 4, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), lp = lg.attributes.position, lc = new Float32Array(lp.count * 3);
    for (let k = 0; k < lp.count; k++) { const f = (1 - lp.getZ(k)) ** 2 * 0.5; lc.set([0.22 * f, f, 0.6 * f], k * 3); }
    lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
    const lasers = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), 6);
    lasers.frustumCulled = false;
    world.add(lasers);
    wheel.lasers = { mesh: lasers, x: cx, y: H + 12, z: 900 };
  }
  // floating stadium platform on the bay below the Raffles Avenue stretch
  {
    const fx = -190, fz = 440;
    vc.push(part(new THREE.BoxGeometry(120, 1.6, 80), '#6f737c', fx, WATER + 0.6, fz));
    for (let x = -60; x <= 60; x += 3) glow.push(part(new THREE.BoxGeometry(2, 0.25, 0.25), x % 6 ? '#5ad1ff' : '#ffffff', fx + x, WATER + 1.5, fz - 40.1), part(new THREE.BoxGeometry(2, 0.25, 0.25), '#5ad1ff', fx + x, WATER + 1.5, fz + 40.1));
    glow.push(part(new THREE.BoxGeometry(28, 12, 0.6), '#1b5cff', fx, WATER + 9, fz + 38));
    for (const [dx, dz] of [[-55, -35], [55, -35], [-55, 35], [55, 35]]) { vc.push(part(new THREE.CylinderGeometry(0.4, 0.4, 24, 6), '#8a8f99', fx + dx, WATER + 12, fz + dz)); halo(fx + dx, WATER + 24, fz + dz, '#fff4e0', 8); }
    mirror(fx, 6, fz, '#9fd8ff', 1.0);
    block(fx, fz, 70);
  }
  // the Esplanade's two spiky domes on the north shore near the river mouth
  {
    const tex = api.canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#6b6252'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 * 8; x < w; x += 16) {
        g.fillStyle = '#9c8f74'; g.beginPath(); g.moveTo(x, y + 8); g.lineTo(x + 8, y); g.lineTo(x + 16, y + 8); g.fill();
        g.fillStyle = 'rgba(255,214,140,0.5)'; g.fillRect(x + 7, y + 3, 2, 2);
      }
    });
    tex.repeat.set(10, 5);
    const D = [];
    for (const [x, z, rx, ry, rz, a] of [[-985, 330, 44, 24, 30, 0.3], [-905, 300, 38, 20, 27, -0.2]]) {
      D.push(new THREE.SphereGeometry(1, 36, 12, 0, TAU, 0, Math.PI / 2).scale(rx, ry, rz).rotateY(a).translate(x, GROUND, z));
      halo(x, ry * 0.8, z, '#ffcf80', 20);
      mirror(x, ry * 0.6, z + rz, '#ffcf80', 0.9);
      block(x, z, Math.max(rx, rz) + 4);
    }
    world.add(new THREE.Mesh(mergeGeometries(D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.3, emissive: '#ffb45a', emissiveMap: tex, emissiveIntensity: 0.35 })));
  }
  // double-helix footbridge across the bay, from the wheel's shore to the hotel's promenade
  {
    const a = V3(58, 0, 520), b = V3(-120, 0, 770), L = a.distanceTo(b), dir = b.clone().sub(a).normalize(), ry = Math.atan2(dir.x, dir.z);
    const deckY = 1.5, mid = a.clone().add(b).multiplyScalar(0.5);
    vc.push(part(new THREE.BoxGeometry(7, 0.8, L), '#5b5f68', mid.x, deckY, mid.z, ry));
    for (let s = 20; s < L - 10; s += 40) { const p = a.clone().addScaledVector(dir, s); vc.push(part(new THREE.CylinderGeometry(0.9, 1.1, deckY - WATER + 1, 8), '#6b6f78', p.x, (deckY + WATER - 1) / 2, p.z)); }
    const perp = V3(dir.z, 0, -dir.x);
    for (const [ph, r, col, rad] of [[0, 6.5, '#e8f4ff', 0.35], [Math.PI, 6.5, '#e8f4ff', 0.35], [Math.PI / 2, 5.2, '#7fd9ff', 0.18], [-Math.PI / 2, 5.2, '#ff8fd0', 0.18]]) {
      const pts = [];
      for (let s = 0; s <= L; s += 2) { const t = s / 12 + ph, p = a.clone().addScaledVector(dir, s); pts.push(V3(p.x + perp.x * Math.cos(t) * r, deckY + 4 + Math.sin(t) * r, p.z + perp.z * Math.cos(t) * r)); }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, rad, 4, false);
      (rad > 0.3 ? vc : glow).push(part(tube, col));
    }
    for (let s = 10; s < L; s += 25) { const p = a.clone().addScaledVector(dir, s); halo(p.x, deckY + 6, p.z, '#bfe8ff', 4); }
    mirror(mid.x, 8, mid.z, '#bfe8ff', 0.9);
  }
  // garden "supertrees" behind the hotel: lattice trunk and a glowing canopy
  const supers = [];
  for (const [x, z, h] of [[-20, 960, 42], [20, 990, 50], [60, 960, 36], [95, 1000, 44], [-5, 1030, 30], [45, 1050, 38], [120, 950, 28], [80, 1080, 32], [-45, 1000, 26], [150, 1030, 30]]) {
    supers.push([x, GROUND, z, R(0, TAU), h / 40]);
    halo(x, h + 2, z, pick(['#ff4fd8', '#9b6bff', '#ff7a3c', '#4fd6ff']), 16);
    block(x, z, 10);
  }

  // ------------------------------------------------------------------------------------------------ track side
  // pit building east of the pit straight (race control glass on top)
  {
    const a = sAt(2), b = sAt(11);
    for (let i = a; i < b; i += 10) {
      const [x, z] = side(i + 5, -(WALL + 18)), ry = head(i + 5), len = 10 * sp + 0.3;
      vc.push(part(new THREE.BoxGeometry(20, 8, len), '#d9dde3', x, 4, z, ry), part(new THREE.BoxGeometry(20.4, 0.8, len), '#e0202e', x, 8.4, z, ry));
      towers[2].push([x, 8.8, z, ry, 14, 4.4, len, '#20252e', 0]);
      block(x, z, 16);
    }
  }
  // roofed grandstands: opposite the pits, at the floating stadium, along the Padang and the Esplanade leg
  const standAt = (i0, i1, sg, depth, rows, seat) => {
    for (let i = i0; i < i1; i += 8) {
      const lat = sg * (WALL + 2 + depth / 2), [x, z] = side(i + 4, lat), ry = Math.atan2(-S[i + 4].right.x * sg, -S[i + 4].right.z * sg);
      if (taken(x, z, depth / 2) || wet(x, z, depth / 2 + 2)) continue;
      const len = 8 * sp + 0.3, y = ground(x, z), P = [], rs = ry + Math.PI, c = Math.cos(rs), sn = Math.sin(rs);
      if ([[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([u, v]) => api.near(x + (u * len / 2) * c + (v * depth / 2) * sn, z - (u * len / 2) * sn + (v * depth / 2) * c)[0] < WALL + 1)) continue;
      for (let r = 0; r < rows; r++) {
        P.push(part(new THREE.BoxGeometry(len, 0.5, 1.1), seat, 0, 0.9 + r * 0.62, -depth / 2 + 1 + r * 1.1));
        for (let k = 0; k < len / 0.62; k++) if (rnd() < 0.75) {
          const lx = -len / 2 + 0.3 + k * 0.62 + R(-0.08, 0.08), lz = -depth / 2 + 1.1 + r * 1.1, ly = 1.5 + r * 0.62;
          crowd.push([x + lx * c + lz * sn, y + ly, z - lx * sn + lz * c, rs, rnd() < 0.3 ? pick(['#e0202e', '#f4f4f4']) : pick(['#2f3440', '#e9e6dc', '#46638f', '#b89a5e', '#56704a', '#8f9296', '#6b3b3b'])]);
        }
      }
      const top = 0.9 + rows * 0.62;
      P.push(part(new THREE.BoxGeometry(len, top, 0.5), '#6b717c', 0, top / 2, -depth / 2 + rows * 1.1 + 0.8));
      P.push(part(new THREE.BoxGeometry(len + 1, 0.3, depth + 2), '#d9dde3', 0, top + 4, 0), part(new THREE.BoxGeometry(0.3, top + 4, 0.3), '#8a909a', -len / 2, (top + 4) / 2, depth / 2), part(new THREE.BoxGeometry(0.3, top + 4, 0.3), '#8a909a', len / 2, (top + 4) / 2, depth / 2));
      vc.push(bake(P, x, y, z, rs));
      for (let k = -1; k <= 1; k += 2) { const hx = x + (k * len / 3) * c, hz = z - (k * len / 3) * sn; glow.push(part(new THREE.BoxGeometry(2, 0.1, 0.6), '#fff4e0', hx, y + top + 3.8, hz, rs)); }
      block(x, z, Math.max(depth, len) / 2);
    }
  };
  standAt(sAt(1), sAt(10), 1, 16, 14, '#b8202c');
  standAt(sAt(21), sAt(29), -1, 13, 10, '#2b5fb0');
  standAt(sAt(125), sAt(138), 1, 14, 12, '#e8e8e8');
  standAt(sAt(84), sAt(90), 1, 14, 11, '#2b5fb0');

  // civic district: colonnaded hall with a dome west of the St Andrew's leg, club pavilion at the Padang's south end
  {
    const x = -1480, z = 170, P = [];
    P.push(part(new THREE.BoxGeometry(34, 22, 130), '#e8e2d2', 0, 11, 0), part(new THREE.BoxGeometry(36, 2, 132), '#d6cdb6', 0, 23, 0));
    for (let k = -60; k <= 60; k += 6) P.push(part(new THREE.CylinderGeometry(1.1, 1.1, 18, 8), '#f4f0e6', 18.5, 10, k));
    P.push(part(new THREE.BoxGeometry(20, 8, 40), '#e8e2d2', 0, 28, -40), part(new THREE.SphereGeometry(10, 18, 9, 0, TAU, 0, Math.PI / 2), '#8a9fa6', 0, 32, -40));
    vc.push(bake(P, x, GROUND, z, 0));
    for (let k = -50; k <= 50; k += 25) halo(x + 22, 8, z + k, '#ffe2b0', 12);
    block(x, z, 70);
    vc.push(part(new THREE.BoxGeometry(40, 9, 16), '#efe9dc', -1240, 4.3, 360), part(new THREE.BoxGeometry(44, 1.5, 20), '#7b3a2f', -1240, 9.6, 360));
    block(-1240, 360, 24);
  }
  // ring of five octagonal towers north of Raffles Boulevard around a lit fountain
  {
    const cx = -560, cz = -300;
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU + 0.3, x = cx + Math.cos(a) * 95, z = cz + Math.sin(a) * 95; octs.push([x, GROUND, z, a, 34, k === 4 ? 150 : 175, 34]); block(x, z, 22); }
    glow.push(part(new THREE.TorusGeometry(14, 1.2, 6, 30).rotateX(Math.PI / 2), '#8fd8ff', cx, 3, cz));
    halo(cx, 6, cz, '#8fd8ff', 25);
    block(cx, cz, 40);
  }

  // ------------------------------------------------------------------------------------------------ skyline
  // districts: [x0, x1, z0, z1, hMin, hMax, spacing, kinds]
  const ZONES = [
    [-1800, -1170, 575, 1200, 110, 285, 44, [0, 2, 0]],     // financial district across the river
    [-1000, -420, 860, 1350, 90, 245, 46, [2, 0, 1]],      // bayfront towers south of the bay
    [-1800, -1440, -380, 430, 18, 60, 34, [1, 0]],         // civic / low colonial blocks
    [-1950, -1560, -700, 450, 60, 170, 50, [0, 1, 2]],     // further west
    [-1420, -760, -900, -150, 45, 170, 44, [0, 1, 2]],     // north: city hall / bugis
    [-760, -60, -800, -60, 40, 150, 46, [1, 0]],           // north-east: convention centre / hotels
    [-860, -260, 65, 185, 50, 135, 42, [1, 2]],            // inside the lap: hotels and malls
    [80, 700, -700, 250, 16, 70, 44, [1, 0]],              // east: promenade, low
    [-1300, -1080, -80, 150, 30, 90, 40, [0, 1]],          // between the legs north of the Padang
  ];
  for (const [x0, x1, z0, z1, h0, h1, spc, kinds] of ZONES) {
    for (let gx = x0; gx < x1; gx += spc) for (let gz = z0; gz < z1; gz += spc) {
      const x = gx + R(-spc * 0.3, spc * 0.3), z = gz + R(-spc * 0.3, spc * 0.3);
      if (rnd() < 0.18 || wet(x, z, 14)) continue;
      const sx = R(20, 36), sz = R(20, 36), r = Math.hypot(sx, sz) / 2;
      if (taken(x, z, r * 0.8) || api.near(x, z)[0] < WALL + 8 + r) continue;
      let h = lerp(h0, h1, rnd() ** 1.6);
      if (!tallOk(x, z, r)) { if (api.near(x, z)[0] < W2 + 40 + r) continue; h = Math.min(h, 25); }
      const kind = pick(kinds);
      tower(x, z, R(-0.25, 0.25) + (rnd() < 0.3 ? Math.PI / 4 : 0), sx, sz, h, kind, { tier: h > 120 && rnd() < 0.5 ? R(0.12, 0.25) : 0, crown: h > 150 && rnd() < 0.5 ? pick(['#9fd8ff', '#ffd27a', '#ff6fb0', '#8cff9f']) : null });
      if (h > 100 && rnd() < 0.3) mirror(x, h * 0.5, z, kind === 1 ? '#ffd9a0' : '#dcecff', 0.5);
    }
  }
  for (let k = 0; k < 220; k++) {   // far skyline ring toward the horizon
    const a = R(0, TAU), r = R(1500, 1950), x = -600 + Math.cos(a) * r, z = 200 + Math.sin(a) * r * 0.8;
    if (!wet(x, z, 20)) towers[pick([0, 2])].push([x, GROUND, z, R(0, 1), R(25, 50), R(40, 180), R(25, 50), pick(DARK), 0]);
  }

  // ------------------------------------------------------------------------------------------------ greenery
  for (let i = 0; i < N; i += 4) for (const sg of [1, -1]) {
    const [x, z] = side(i, sg * (WALL + R(3, 7)));
    if (taken(x, z, 2) || wet(x, z, 3) || !tallOk(x, z, 2)) continue;
    const [ox, oz] = side(i, sg * (WALL + 40));
    if (wet(ox, oz, 10)) palms[rnd() < 0.5 ? 0 : 1].push([x, ground(x, z), z, R(0, TAU), R(0.9, 1.2)]);
    else if (rnd() < 0.55) rainTrees.push([x, ground(x, z), z, R(0, TAU), R(0.8, 1.25)]);
  }
  for (let k = 0, t = 0; k < 260 && t < 5000; t++) {   // parks (the Padang field itself stays open)
    const [px, pz, rx, rz] = pick(PARKS), a = R(0, TAU), r = Math.sqrt(rnd()) * 1.15, x = px + Math.cos(a) * rx * r, z = pz + Math.sin(a) * rz * r;
    if (r < 0.75 && px === -1235) continue;
    if (taken(x, z, 3) || wet(x, z, 4) || api.near(x, z)[0] < WALL + 4 || !tallOk(x, z, 3)) continue;
    (rnd() < 0.3 ? palms[k % 2] : rainTrees).push([x, ground(x, z), z, R(0, TAU), R(0.8, 1.3)]); k++;
  }

  // ------------------------------------------------------------------------------------------------ assemble
  const dm = new THREE.Object3D(), tc = new THREE.Color();
  const inst = (geo, mat, list, set, color) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, i) => { set(e); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); if (color) m.setColorAt(i, tc.set(color(e, i))); });
    m.receiveShadow = true;
    world.add(m);
    return m;
  };
  const boxSet = ([x, y, z, ry, sx, sy, sz, , rz]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, rz || 0, 'YXZ'); dm.scale.set(sx, sy, sz); };
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const TEX = [api.canvasTex(256, 256, paintOffice), api.canvasTex(256, 256, paintHotel), api.canvasTex(256, 256, paintGlass)];
  const mats = [facadeMat(TEX[0], 2.4, 3.9, 16, 16, 1.25), facadeMat(TEX[1], 3.2, 3.3, 16, 16, 1.15, { rough: 0.7, metal: 0.1 }), facadeMat(TEX[2], 2.2, 4.2, 16, 16, 1.3, { rough: 0.25, metal: 0.6 })];
  // keepCount: world.js thins instanced scenery at lower quality; towers carry merged crowns / warning lights / halos,
  // seated crowds would show gaps
  const keep = (m, k = true) => { if (m) m.userData.keepCount = k; };   // crowds: 'medium' (thinned only at low)
  towers.forEach((list, k) => keep(inst(unitBox, mats[k], list, boxSet, e => e[7])));
  keep(inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1).translate(0, 0.5, 0), mats[2], octs, boxSet, () => '#1c2230'));
  keep(inst(new THREE.PlaneGeometry(0.5, 0.78).rotateY(Math.PI), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.08 }), crowd,
    ([x, y, z, ry]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(R(0.9, 1.1), R(0.85, 1.15), 1); }, e => e[4]), 'medium');
  const ptSet = ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(s); };
  const frondMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(128, 256, paintFrond, false), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  [palmParts(rnd, 8.5, 0.7), palmParts(rnd, 9.5, 2.2)].forEach((v, k) => { inst(v.trunk, trunkMat, palms[k], ptSet); inst(v.crown, frondMat, palms[k], ptSet); });
  const rainGeo = mergeGeometries([part(new THREE.CylinderGeometry(0.35, 0.55, 5, 6).translate(0, 2.5, 0), '#4a3b30'),
    part(new THREE.IcosahedronGeometry(1, 0).scale(6.5, 2.4, 6.5), '#2c5a2e', 0, 6.8, 0), part(new THREE.IcosahedronGeometry(1, 0).scale(4, 1.8, 4), '#35683a', 2.5, 7.8, 1)]);
  inst(rainGeo, trunkMat, rainTrees, ptSet, () => tc.setScalar(R(0.75, 1.05)));
  const stGeo = mergeGeometries([part(new THREE.CylinderGeometry(3.2, 1.6, 40, 8, 1, true).translate(0, 20, 0), '#6b4a7a'), part(new THREE.CylinderGeometry(12, 3.4, 5, 12, 1, true).translate(0, 41, 0), '#ff5fd8')]);
  keep(inst(stGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false }), supers, ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.set(1, s, 1); },
    () => tc.setHSL(R(0.75, 0.95), 0.8, 0.6)));

  const statics = new THREE.Mesh(mergeGeometries(vc), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
  statics.receiveShadow = true;
  world.add(statics);
  const lattice = new THREE.Mesh(mergeGeometries(braces), statics.material);   // 10k triangles of 10 cm struts: none at 'low'
  lattice.receiveShadow = true;
  lattice.userData.minQuality = 'medium';
  world.add(lattice);
  world.add(new THREE.Mesh(mergeGeometries(glow), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));

  // glow sprites (fogged additive point cloud)
  {
    const n = halos.length, p = new Float32Array(n * 3), c = new Float32Array(n * 3), s = new Float32Array(n);
    halos.forEach(([x, y, z, r, g, b, size], i) => { p.set([x, y, z], i * 3); c.set([r, g, b], i * 3); s[i] = size; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('hcol', new THREE.BufferAttribute(c, 3));
    g.setAttribute('hsize', new THREE.BufferAttribute(s, 1));
    const vp = new THREE.Vector4();
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 500 }, fogNear: { value: env.fog.near }, fogFar: { value: env.fog.far } },
      vertexShader: `attribute vec3 hcol; attribute float hsize; uniform float scale; uniform float fogNear; uniform float fogFar; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          vC = hcol * 0.55 * (1.0 - smoothstep(fogNear, fogFar * 1.1, d));
          gl_PointSize = clamp(hsize * scale / max(d, 1.0), 1.5, 400.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = pow(max(1.0 - r, 0.0), 2.4);
          gl_FragColor = vec4(vC * a, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(g, mat);
    pts.renderOrder = 2;
    pts.frustumCulled = false;
    pts.onBeforeRender = (r, sc, cam) => { r.getCurrentViewport(vp); mat.uniforms.scale.value = vp.w * cam.projectionMatrix.elements[5] * 0.5; };
    world.add(pts);
  }
  // lights mirrored in the bay: the brightest NL
  refl.sort((a, b) => b[4] - a[4]).slice(0, NL).forEach(([x, y, z, c, k], i) => { waterMat.uniforms.uL.value[i].set(x, y, z, k); waterMat.uniforms.uLC.value[i].set(c); });

  // river-cruise boats circling the bay (self-lit cabins)
  const boatGeo = mergeGeometries([part(new THREE.BoxGeometry(4.2, 1.4, 16), '#12141a', 0, 0.3, 0), part(new THREE.ConeGeometry(2.1, 4, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.33, 1), '#12141a', 0, 0.55, 9.8),
    part(new THREE.BoxGeometry(3.4, 1.6, 10), '#2a2d33', 0, 1.8, -1), part(new THREE.BoxGeometry(3.5, 0.7, 9.6), '#ffd98a', 0, 1.7, -1), part(new THREE.BoxGeometry(3.8, 0.15, 10.4), '#ff5a5a', 0, 2.65, -1)]);
  const boats = [];
  for (let t = 0; t < 300 && boats.length < 9; t++) {
    const x = R(-1000, -50), z = R(420, 720), r = R(40, 110);
    if (polySD(BAY, x, z) < r + 25 || Math.hypot(x + 190, z - 440) < 110 || boats.some(b => Math.hypot(b.x - x, b.z - z) < b.r + r + 20)) continue;
    boats.push({ x, z, r, w: (rnd() < 0.5 ? -1 : 1) * R(2.5, 4) / r, a: R(0, TAU) });
  }
  const boatMesh = new THREE.InstancedMesh(boatGeo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), boats.length);
  boatMesh.frustumCulled = false;
  world.add(boatMesh);

  // ------------------------------------------------------------------------------------------------ animation
  let clock = 0;
  const dir = new THREE.Vector3(), o = new THREE.Vector3();
  const update = dt => {
    const t = clock += dt;
    waterMat.uniforms.uTime.value = t;
    const a0 = t * 0.03;
    wheel.spin.rotation.z = a0;
    for (let k = 0; k < wheel.n; k++) {
      const a = a0 + k / wheel.n * TAU;
      dm.position.set(Math.cos(a) * (wheel.R + 3.2), wheel.hub + Math.sin(a) * (wheel.R + 3.2), 0);
      dm.rotation.set(0, 0, 0); dm.scale.setScalar(1);
      dm.updateMatrix();
      wheel.caps.setMatrixAt(k, dm.matrix);
    }
    wheel.caps.instanceMatrix.needsUpdate = true;
    const L = wheel.lasers, on = (t % 40) < 22;
    for (let k = 0; k < 6; k++) {
      const a = Math.PI + 0.9 * Math.sin(t * 0.35 + k * 1.1), e = -0.08 - 0.06 * Math.sin(t * 0.5 + k);
      dir.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
      o.set(L.x, L.y, L.z + (k - 2.5) * 12);
      dm.position.copy(o); dm.lookAt(o.x + dir.x, o.y + dir.y, o.z + dir.z); dm.scale.set(on ? 1 : 0, on ? 1 : 0, 900);
      dm.updateMatrix();
      L.mesh.setMatrixAt(k, dm.matrix);
    }
    L.mesh.instanceMatrix.needsUpdate = true;
    boats.forEach((b, k) => {
      const a = b.a + t * b.w;
      dm.position.set(b.x + Math.cos(a) * b.r, WATER + 0.1 + 0.08 * Math.sin(t * 1.3 + k), b.z + Math.sin(a) * b.r);
      dm.rotation.set(0, Math.atan2(-Math.sin(a) * b.w, Math.cos(a) * b.w), 0.03 * Math.sin(t + k)); dm.scale.setScalar(1);
      dm.updateMatrix();
      boatMesh.setMatrixAt(k, dm.matrix);
    });
    boatMesh.instanceMatrix.needsUpdate = true;
  };
  update(0);   // place the moving instances before the first frame
  api.onUpdate(update);
}

export default { base: 'city', env, baseBuild: false, build };
