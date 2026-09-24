// Beach theme (コーラル・コースト): a palm-lined peninsula with a live ocean wrapping the north, east and south
// of the course — shader waves, sun glints, surf and shore foam — plus beach huts, umbrellas, a lighthouse and boats.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SEA = -0.6;   // still-water level (m); the lowest seaside road is at y≈0
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const chaikin = P => P.flatMap(([ax, az], i) => {   // closed loop
  const [bx, bz] = P[(i + 1) % P.length];
  return [[ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]];
});
const loop = P => { const o = chaikin(chaikin(P)); return [...o, o[0]]; };

// Shorelines as closed loops. The island: 44–60 m outside the centerline along the north, east and south
// (the promontory at (430,-178) carries the lighthouse), then round the jungle hills west of the start straight,
// so open sea wraps every side. The lagoon fills the infield, ≥ 80 m from the centerline.
const COASTS = [
  loop([
    [40, 372], [95, 328], [160, 318], [220, 320], [275, 306], [318, 284], [352, 262], [382, 236], [398, 196],
    [396, 150], [402, 100], [398, 52], [386, 8], [382, -28], [396, -66], [420, -100], [446, -140], [452, -178],
    [436, -212], [400, -228], [358, -250], [310, -276], [255, -284], [200, -272], [150, -250], [108, -222],
    [62, -196], [10, -190], [-60, -212], [-150, -238], [-250, -232], [-340, -196], [-410, -128], [-452, -36],
    [-458, 64], [-432, 168], [-372, 258], [-282, 328], [-180, 368], [-90, 386], [-20, 386],
  ]),
  loop([
    [100, 85], [100, 20], [128, -22], [170, -45], [196, -92], [222, -128], [246, -118], [244, -70], [230, -10],
    [236, 50], [232, 112], [205, 160], [160, 176], [120, 150],
  ]),
];

// Signed distance to the nearest shoreline, + = water (exact; only used to fill the grid below).
// Land = inside an odd number of loops (even-odd), so loop orientation does not matter.
function coastExact(x, z) {
  let best = Infinity, land = false;
  for (const C of COASTS) for (let i = 0; i < C.length - 1; i++) {
    const [ax, az] = C[i], dx = C[i + 1][0] - ax, dz = C[i + 1][1] - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
    if ((az > z) !== (az + dz > z) && x < ax + (z - az) * dx / dz) land = !land;
  }
  return Math.sqrt(best) * (land ? -1 : 1) + 3 * Math.sin(x * 0.037 + z * 0.021) + 2 * Math.sin(z * 0.067 - x * 0.049 + 1.7);
}
// Island relief: a jungle volcano with a craggy summit behind the start straight plus two shoulder peaks
// (faded out near the course).
const bump = (x, z, bx, bz, r, h) => h * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (r * r));
const relief = (x, z) => (bump(x, z, -235, 40, 125, 90) + bump(x, z, -245, 52, 42, 34) + bump(x, z, -330, 200, 90, 50)
  + bump(x, z, -300, -140, 95, 42)) * (1 + 0.16 * Math.sin(x * 0.043 + z * 0.021) * Math.cos(z * 0.052 - x * 0.017));
// Unsigned distance to the lagoon shore: the infield slopes gently down to it so it can be seen from the road.
function lagoonDist(x, z) {
  const C = COASTS[1];
  let best = Infinity;
  for (let i = 0; i < C.length - 1; i++) {
    const [ax, az] = C[i], dx = C[i + 1][0] - ax, dz = C[i + 1][1] - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
  }
  return Math.sqrt(best);
}
// Baked once per session (9 m cells, clamped at the edges): the terrain hook, placement and the ocean shader's
// texture all read this same grid, so the JS shoreline and the rendered one agree.
const GX = -1000, GZ = -1150, GS = 2300, GN = 256, GC = GS / GN;
let grid = null;
function coastGrid() {
  if (!grid) {
    grid = new Float32Array(GN * GN);
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) grid[j * GN + i] = coastExact(GX + (i + 0.5) * GC, GZ + (j + 0.5) * GC);
  }
  return grid;
}
function coastDist(x, z) {
  const g = coastGrid(), u = (x - GX) / GC - 0.5, v = (z - GZ) / GC - 0.5;
  const i = clamp(Math.floor(u), 0, GN - 2), j = clamp(Math.floor(v), 0, GN - 2), fu = clamp(u - i, 0, 1), fv = clamp(v - j, 0, 1), k = j * GN + i;
  return (g[k] * (1 - fu) + g[k + 1] * fu) * (1 - fv) + (g[k + GN] * (1 - fu) + g[k + GN + 1] * fu) * fv;
}
// Beach / seabed height by coast distance (same formula in the ocean shader).
const shoreY = c => c >= 0 ? SEA - 0.06 * c - 0.0006 * c * c : SEA - 0.07 * c + 0.002 * c * c;

function paintSand(g, w, h) {
  g.fillStyle = '#e6cf9c'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 20; d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.8; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(160,125,70,0.09)'; g.lineWidth = 2;
  for (let y = 5; y < h; y += 13) {
    g.beginPath();
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / w * TAU * 2 + y) * 3);
    g.stroke();
  }
  for (let i = 0; i < 1500; i++) {
    const r = Math.random();
    g.fillStyle = r < 0.5 ? 'rgba(125,100,62,0.35)' : r < 0.88 ? 'rgba(255,252,238,0.65)' : 'rgba(245,150,130,0.55)';
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
}

const ENV = {
  sky: { top: '#0b5ec8', horizon: '#b1e1f4', bottom: '#5fb8d0' },
  fog: { color: '#b1e1f4', near: 280, far: 1800 },
  sun: { dir: [0.45, 0.42, -0.62], color: '#fff2da', intensity: 3.0 },
  hemi: { sky: '#cbeeff', ground: '#e6d4a4', intensity: 0.95 },
  exposure: 1.08,
  night: false,
  // height: world.js hook — raise the island's hills, sink the land into the sea, but never within 21 m of the
  // centerline (barrier zone)
  terrain: { base: '#e6cf9c', paint: paintSand, hills: 5, rim: 80, rimColor: '#3e7d3c',
    height: (x, z, y, dist) => {
      y += relief(x, z) * smooth(60, 160, dist);
      const ld = lagoonDist(x, z), bed = Math.min(shoreY(coastDist(x, z)), SEA + 0.3 + 0.03 * ld + 999 * smooth(95, 135, ld));
      return Math.min(y, Math.max(bed, y - 0.35 * Math.max(0, dist - 21)));
    } },
  road: { base: '#55585e', line: '#ffd23f', edge: '#ffffff' },
  shoulder: '#dcc89c',
  barrier: 'guardrail',
  curb: ['#ff6b57', '#ffffff'],
};

const M = new THREE.Matrix4(), E = new THREE.Euler();
// Primitive → non-indexed position/normal/color geometry, placed, ready for mergeGeometries into one vertex-coloured mesh.
function part(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(a, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g.applyMatrix4(M.makeRotationFromEuler(E.set(rx, ry, rz)).setPosition(x, y, z));
}
function tri(pts, color) {   // flat polygon fan (sails)
  const p = [];
  for (let i = 1; i < pts.length - 1; i++) p.push(...pts[0], ...pts[i], ...pts[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return part(g, color);
}
const bake = (parts, x, y, z, ry) => mergeGeometries(parts).applyMatrix4(M.makeRotationY(ry).setPosition(x, y, z));

// Palm frond strip along +X: rises at angle a0, droops to a1; edges folded down below the rib.
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

const OCEAN_VS = `varying vec3 vW;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const OCEAN_FS = `uniform float uTime, uSea;
uniform sampler2D uCoast;
uniform vec4 uRect;
uniform vec3 uSun, uSunCol, uDeep, uMid, uShallow, uSkyTop, uSkyHor;
uniform vec3 uRocks[24];
varying vec3 vW;
#include <fog_pars_fragment>
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 wave(vec2 p, vec2 dir, float len, float steep, float t) {
  float k = 6.2831853 / len, c = sqrt(9.8 / k) * 0.75;
  return normalize(dir) * steep * cos(k * (dot(normalize(dir), p) - c * t));
}
float seabed(float c) { return c >= 0.0 ? uSea - 0.06 * c - 0.0006 * c * c : uSea - 0.07 * c + 0.002 * c * c; }
void main() {
  vec2 p = vW.xz;
  float cd = texture2D(uCoast, (p - uRect.xy) * uRect.zw).r;
  if (cd < -12.0) discard;
  float depth = vW.y - seabed(cd), dd = max(depth, 0.0), t = uTime;
  float fine = 1.0 - smoothstep(90.0, 700.0, length(cameraPosition - vW));
  vec2 s = wave(p, vec2(-0.8, 0.6), 43.0, 0.09, t) + wave(p, vec2(-0.45, -0.9), 24.0, 0.08, t) + wave(p, vec2(-1.0, 0.15), 13.5, 0.07, t)
    + (wave(p, vec2(0.3, 0.95), 7.3, 0.065, t) + wave(p, vec2(-0.6, -0.4), 4.1, 0.055, t) + wave(p, vec2(0.9, -0.3), 2.3, 0.05, t)) * fine;
  s += (vec2(noise(p * 0.8 + t * 0.7), noise(p.yx * 0.8 - t * 0.6)) - 0.5) * 0.16 * fine;
  s *= mix(0.4, 1.0, smoothstep(0.0, 3.0, dd));
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uSkyHor, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sd = max(dot(R, uSun), 0.0);
  float spec = pow(sd, 1200.0) * 40.0 + pow(sd, 120.0) * 1.5 + pow(sd, 12.0) * 0.08;
  vec3 body = mix(uShallow, uMid, smoothstep(0.5, 4.5, dd));
  body = mix(body, uDeep, smoothstep(4.5, 24.0, dd));
  body *= 0.9 + 0.3 * (n.x * uSun.x + n.z * uSun.z) * 4.0;
  vec3 col = mix(body, sky, min(F, 0.7)) + uSunCol * spec;
  float lace = noise(p * 0.45 + vec2(t * 0.15, -t * 0.1)) * 0.6 + noise(p * 1.7 - t * 0.25) * 0.4;
  float foam = 1.0 - smoothstep(0.05, 0.22 + 0.3 * lace, dd);
  float ph = fract(cd * 0.07 + t * 0.16);
  float crest = smoothstep(0.0, 0.025, ph) * (1.0 - smoothstep(0.025, 0.16, ph));
  foam = max(foam, crest * (1.0 - smoothstep(10.0, 34.0, cd)) * smoothstep(0.25, 0.6, lace));
  for (int i = 0; i < 24; i++) {
    vec3 r = uRocks[i];
    if (r.z <= 0.0) continue;
    float e = length(p - r.xy) - r.z, pulse = 0.5 + 0.5 * sin(t * 1.6 + r.x * 0.37 + r.y * 0.21);
    foam = max(foam, (1.0 - smoothstep(0.0, 0.8 + 2.6 * pulse, e)) * smoothstep(0.25, 0.7, lace + 0.15));
  }
  col = mix(col, vec3(0.96, 0.99, 1.0), foam);
  float a = max(max(mix(0.32, 0.97, smoothstep(0.0, 3.5, dd)), foam), clamp(spec, 0.0, 1.0));
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function build(api) {
  const { world, track, rnd } = api;
  const S = track.samples, N = S.length, W2 = track.width / 2, spacing = track.length / N;
  const R = (a, b) => a + (b - a) * rnd();

  // ---- track helpers: nearest sample + lateral (+ = right of travel); corner bend for sightline checks
  const head = i => { const t = S[(i + N) % N].tan; return Math.atan2(t.x, t.z); };
  const curv = S.map((_, i) => { const d = head(i + 3) - head(i - 3); return Math.atan2(Math.sin(d), Math.cos(d)) / (6 * spacing); });
  const bend = curv.map((_, i) => { let s = 0; for (let k = -24; k <= 24; k += 4) s += curv[(i + k + N) % N]; return s / 13; });
  function trackAt(x, z) {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), lat: (x - s.pos.x) * -s.tan.z + (z - s.pos.z) * s.tan.x, i: bi };
  }
  // tall props stay clear of the barrier, and ≥ 20 m behind it on the inside of corners (chase-camera sightlines)
  function tallOk(x, z, r) {
    const { d, lat, i } = trackAt(x, z), c = bend[i];
    const inside = (c > 1 / 400 && lat < 0) || (c < -1 / 400 && lat > 0);
    return d >= (inside ? W2 + 30 : W2 + 13) + r && api.isFree(x, z, r);
  }
  const ground = api.groundAt;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of S) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  // ---- recolour world.js's terrain (no colour hook in the api): sand → wet sand at the waterline, patchy jungle
  // greens inland that darken uphill, bare basalt on the volcano's steep upper slopes. Vertex colours multiply the
  // sand texture, so targets are divided by its base colour.
  {
    const v = new THREE.Vector3(), n = new THREE.Vector3(), sand = new THREE.Color(ENV.terrain.base), c = new THREE.Color(), m = new THREE.Color();
    const tgt = h => { const k = new THREE.Color(h); return k.setRGB(k.r / sand.r, k.g / sand.g, k.b / sand.b); };
    const meadow = tgt('#519644'), jungle = tgt('#2a6a2e'), basalt = tgt('#5e5a52');
    world.traverse(o => {
      const g = o.geometry, pos = g?.attributes?.position, col = g?.attributes?.color, nrm = g?.attributes?.normal;
      if (!o.isMesh || o.isInstancedMesh || !col || !nrm || o.material?.side === THREE.BackSide) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      if (b.max.x - b.min.x < 900 || b.max.z - b.min.z < 900) return;   // only the big terrain sheet
      o.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const x = v.x, y = v.y, z = v.z, cd = coastDist(x, z);
        const green = cd > -30 ? 0 : smooth(-30, -65, cd) * smooth(W2 + 11, W2 + 26, api.near(x, z)[0]);
        const patch = 0.5 + 0.5 * Math.sin(x * 0.021 + 2 * Math.sin(z * 0.017)) * Math.cos(z * 0.024 - x * 0.008);
        const rock = smooth(0.9, 0.74, n.fromBufferAttribute(nrm, i).y) * smooth(72, 98, y);   // summit crags only
        c.setScalar((0.9 + 0.14 * (Math.sin(x * 0.045) * Math.cos(z * 0.039) * 0.5 + 0.5)) * (1 - 0.32 * smooth(-8, -1, cd)));
        c.lerp(m.copy(meadow).lerp(jungle, clamp(patch * 0.7 + y / 35, 0, 1)), green).lerp(basalt, rock);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    });
  }

  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const staticGeos = [], thatchGeos = [];

  // ---- rocks (surf foam rings are fed to the ocean shader)
  const rockGeo = new THREE.IcosahedronGeometry(1, 1), rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i), k = 1 + 0.2 * Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 - y * 2.1);
    rp.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  rockGeo.computeVertexNormals();
  const rockList = [], foamRocks = [];
  function addRock(x, z, s, sy = 1) {
    let y = ground(x, z) + s * sy * 0.15;
    const inWater = coastDist(x, z) > -2;
    if (inWater) y = Math.max(y, SEA + 0.5 - s * sy * 0.55);
    rockList.push([x, y, z, s, sy]);
    if (inWater) foamRocks.push([x, z, s * 0.95, y + s * sy * 0.8 - SEA]);
  }
  const LH = [430, -178];   // lighthouse promontory
  for (let n = 0, tries = 0; n < 26 && tries < 800; tries++) {
    const a = rnd() * TAU, r = R(8, 44), x = LH[0] + Math.cos(a) * r, z = LH[1] + Math.sin(a) * r, cd = coastDist(x, z);
    if (cd < -7 || cd > 16 || !api.isFree(x, z, 3)) continue;
    addRock(x, z, R(1.4, 3.6), R(0.8, 1.3)); n++;
  }
  for (const [x, z, s] of [[478, -170, 5], [470, -205, 3.8], [462, -138, 3.2], [416, 268, 3.6], [428, 250, 2.4]]) addRock(x, z, s, 1.7);

  // ---- shoreline walk: points every 3 m with the seaward normal, near the course only
  const shore = [];
  for (const C of COASTS) for (let i = 0; i < C.length - 1; i++) {
    const [ax, az] = C[i], [bx, bz] = C[i + 1], L = Math.hypot(bx - ax, bz - az), fl = coastDist((ax + bx) / 2 - (bz - az) / L * 8, (az + bz) / 2 + (bx - ax) / L * 8) > 0 ? 1 : -1;
    const nx = -(bz - az) / L * fl, nz = (bx - ax) / L * fl;
    for (let s = 0; s < L; s += 3) {
      const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L;
      if (trackAt(x, z).d < 200) shore.push([x, z, nx, nz]);
    }
  }
  for (let i = 0; i < shore.length; i += 16) {
    if (rnd() < 0.45) continue;
    const [x, z, nx, nz] = shore[i];
    for (let k = 0; k < 3; k++) {
      const o = R(-3, 5), tx = R(-4, 4), px = x + nx * o + nz * tx, pz = z + nz * o - nx * tx;
      if (api.isFree(px, pz, 2)) addRock(px, pz, R(0.7, 1.8), R(0.6, 1.1));
    }
  }
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), rockList.length);
  const dm = new THREE.Object3D(), tc = new THREE.Color(), tint = new THREE.Color();
  rockList.forEach(([x, y, z, s, sy], i) => {
    dm.position.set(x, y, z); dm.rotation.set(R(-0.3, 0.3), rnd() * TAU, R(-0.3, 0.3)); dm.scale.set(s * R(0.8, 1.25), s * sy, s * R(0.8, 1.2));
    dm.updateMatrix(); rocks.setMatrixAt(i, dm.matrix);
    rocks.setColorAt(i, tc.setHSL(0.07 + rnd() * 0.04, 0.12 + rnd() * 0.1, 0.24 + rnd() * 0.12));
  });
  rocks.castShadow = rocks.receiveShadow = true;
  world.add(rocks);

  // ---- ocean: coast-distance field baked into a half-float texture, flat plane shaded with analytic waves
  const cdata = Uint16Array.from(coastGrid(), v => THREE.DataUtils.toHalfFloat(clamp(v, -300, 900)));
  const coastTex = new THREE.DataTexture(cdata, GN, GN, THREE.RedFormat, THREE.HalfFloatType);
  coastTex.minFilter = coastTex.magFilter = THREE.LinearFilter;
  coastTex.needsUpdate = true;
  foamRocks.sort((a, b) => b[2] - a[2]);
  const oceanMat = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 }, uSea: { value: SEA }, uCoast: { value: coastTex },
      uRect: { value: new THREE.Vector4(GX, GZ, 1 / GS, 1 / GS) },
      uSun: { value: new THREE.Vector3(...ENV.sun.dir).normalize() }, uSunCol: { value: new THREE.Color('#fff4e0') },
      uDeep: { value: new THREE.Color('#0a4f96') }, uMid: { value: new THREE.Color('#10a3c2') }, uShallow: { value: new THREE.Color('#3ee8d4') },
      uSkyTop: { value: new THREE.Color('#3f8fe0') }, uSkyHor: { value: new THREE.Color(ENV.sky.horizon) },
      uRocks: { value: Array.from({ length: 24 }, (_, i) => foamRocks[i] && foamRocks[i][3] > 0.2 ? new THREE.Vector3(foamRocks[i][0], foamRocks[i][1], foamRocks[i][2]) : new THREE.Vector3()) },
    },
    vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, transparent: true, fog: true,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), oceanMat);
  ocean.position.set(cx, SEA, cz);
  ocean.renderOrder = -1;
  ocean.frustumCulled = false;
  world.add(ocean);

  // ---- lighthouse + keeper's cottage on the promontory
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffd86b, emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1 });
  {
    const [x, z] = LH, y = Math.min(ground(x, z), ground(x + 3, z), ground(x - 3, z), ground(x, z + 3), ground(x, z - 3)) - 0.3, P = [];
    P.push(part(new THREE.CylinderGeometry(3.3, 3.8, 1.6, 20), '#8f8a80', 0, 0.8, 0));
    for (let k = 0; k < 5; k++) {
      const r0 = 2.7 - k * 0.2, r1 = r0 - 0.2;
      P.push(part(new THREE.CylinderGeometry(r1, r0, 4, 20, 1, true), k % 2 ? '#f6f4ee' : '#d62f2f', 0, 3.6 + k * 4, 0));
    }
    P.push(part(new THREE.CylinderGeometry(2.5, 2.5, 0.35, 20), '#2c3038', 0, 21.8, 0));
    P.push(part(new THREE.TorusGeometry(2.4, 0.06, 4, 24), '#2c3038', 0, 22.9, 0, 0, Math.PI / 2));
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; P.push(part(new THREE.BoxGeometry(0.07, 0.95, 0.07), '#2c3038', Math.cos(a) * 2.4, 22.45, Math.sin(a) * 2.4)); }
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; P.push(part(new THREE.BoxGeometry(0.12, 2.1, 0.12), '#2c3038', Math.cos(a) * 1.38, 23.05, Math.sin(a) * 1.38)); }
    P.push(part(new THREE.ConeGeometry(1.8, 1.6, 20), '#c42828', 0, 24.9, 0));
    P.push(part(new THREE.SphereGeometry(0.28, 10, 6), '#2c3038', 0, 25.85, 0));
    P.push(part(new THREE.BoxGeometry(1.1, 2.1, 0.2), '#3a2c22', 0, 2.65, -2.72));   // door
    for (let k = 0; k < 3; k++) P.push(part(new THREE.BoxGeometry(0.6, 0.9, 0.2), '#223344', 0, 7.5 + k * 5, 2.05 - k * 0.2 + 0.4));
    staticGeos.push(bake(P, x, y, z, 0.4));
    const H = [], hx = x - 9.5, hz = z + 5;   // keeper's cottage, landward
    H.push(part(new THREE.BoxGeometry(7, 4.2, 5), '#f7f3ea', 0, 1.1, 0));
    const roof = new THREE.Shape([new THREE.Vector2(-3, 0), new THREE.Vector2(3, 0), new THREE.Vector2(0, 2.2)]);
    H.push(part(new THREE.ExtrudeGeometry(roof, { depth: 7.6, bevelEnabled: false }).translate(0, 0, -3.8), '#c9463d', 0, 3.2, 0, Math.PI / 2));
    H.push(part(new THREE.BoxGeometry(1, 2, 0.1), '#2d6a8a', 0, 1.2, -2.54));
    for (const sx of [-2.2, 2.2]) H.push(part(new THREE.BoxGeometry(1, 1, 0.1), '#223344', sx, 1.9, -2.54));
    staticGeos.push(bake(H, hx, ground(hx, hz) - 0.2, hz, 0.4 + Math.PI));
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 16), lampMat);
    lamp.position.set(x, y + 23.05, z);
    world.add(lamp);
    api.block(x, z, 12);
  }

  // ---- pier into the east bay, one boat moored at its end
  const PZ = 58;
  let PX = 360;
  while (PX < 520 && coastDist(PX, PZ) < -4) PX++;
  {
    const deck = SEA + 1.6, P = [], len = 64;
    for (let k = 0; k < len / 2; k++) P.push(part(new THREE.BoxGeometry(1.9, 0.18, 3.2), k % 2 ? '#b08457' : '#9a7049', PX + 1 + k * 2, deck, PZ));
    P.push(part(new THREE.BoxGeometry(7, 0.2, 8), '#a67b50', PX + len + 3, deck, PZ));
    for (let k = 0; k <= len; k += 6) for (const sz of [-1.5, 1.5]) {
      const x = PX + 1 + k, gy = ground(x, PZ + sz), h = deck + 1 - gy;
      P.push(part(new THREE.CylinderGeometry(0.13, 0.16, h, 6), '#6d5238', x, gy + h / 2, PZ + sz));
    }
    for (const sz of [-1.5, 1.5]) P.push(part(new THREE.BoxGeometry(len, 0.1, 0.1), '#7a5b3e', PX + 1 + len / 2, deck + 0.9, PZ + sz));
    staticGeos.push(mergeGeometries(P));
    api.block(PX, PZ, 4);
  }

  // ---- beach bar facing the road on the east straight
  function hutParts(wall, P) {
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.push(part(new THREE.BoxGeometry(0.28, 1.2, 0.28), '#7d5f3f', sx * 2.3, 0.6, sz * 2.3));
    P.push(part(new THREE.BoxGeometry(5.4, 0.22, 6), '#a07a50', 0, 1.25, -0.3));
    P.push(part(new THREE.BoxGeometry(4.2, 2.5, 4.2), wall, 0, 2.6, 0.4));
    P.push(part(new THREE.BoxGeometry(4.35, 0.22, 4.35), '#ffffff', 0, 3.85, 0.4));
    P.push(part(new THREE.BoxGeometry(4.35, 0.18, 4.35), '#ffffff', 0, 1.45, 0.4));
    P.push(part(new THREE.BoxGeometry(1, 1.9, 0.1), '#5a3b24', 0, 2.3, -1.72));
    for (const sx of [-1.35, 1.35]) { P.push(part(new THREE.BoxGeometry(0.8, 0.8, 0.1), '#24485a', sx, 2.9, -1.72)); P.push(part(new THREE.BoxGeometry(0.8, 0.8, 0.1), '#24485a', sx, 2.9, 2.52)); }
    P.push(part(new THREE.BoxGeometry(5.4, 0.08, 0.08), '#ffffff', 0, 2.2, -3.25));
    for (const sx of [-2.6, -1.3, 1.3, 2.6]) P.push(part(new THREE.BoxGeometry(0.08, 0.9, 0.08), '#ffffff', sx, 1.8, -3.25));
    return new THREE.ConeGeometry(4.1, 2.5, 4, 1).rotateY(Math.PI / 4).translate(0, 5.0, 0.4);
  }
  const thatchTex = api.canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9a45c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * w, y = Math.random() * h, l = 6 + Math.random() * 16;
      g.strokeStyle = `rgba(${90 + Math.random() * 120 | 0},${70 + Math.random() * 80 | 0},${30 + Math.random() * 30 | 0},0.55)`;
      g.lineWidth = 1 + Math.random(); g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 2, y + l); g.stroke();
    }
    g.fillStyle = 'rgba(80,55,20,0.35)';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 3);
  });
  const signTex = api.canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#1b9aaa'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23f'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 8, w, 8);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffffff'; g.font = 'bold 58px "Hiragino Sans","Yu Gothic",sans-serif';
    g.fillText('ココナッツ・バー', w / 2, h * 0.42, w - 40);
    g.fillStyle = '#ffe9a8'; g.font = 'bold 22px sans-serif'; g.fillText('COCONUT BAR  ·  TROPICAL DRINKS', w / 2, h * 0.8, w - 40);
  }, false);
  {
    const s = S[620], lat = W2 + 23, x = s.pos.x - s.tan.z * lat, z = s.pos.z + s.tan.x * lat;
    const ry = Math.atan2(-s.tan.z, s.tan.x), y = ground(x, z) - 0.1, P = [];
    P.push(part(new THREE.BoxGeometry(9, 0.3, 7), '#a8814f', 0, 0.15, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.push(part(new THREE.CylinderGeometry(0.13, 0.15, 3.3, 7), '#c8a86a', sx * 4.1, 1.95, sz * 3.1));
    P.push(part(new THREE.BoxGeometry(6, 1.05, 0.8), '#2ec4b6', 0, 0.82, -1.6));
    P.push(part(new THREE.BoxGeometry(6.3, 0.1, 1.05), '#8a5a33', 0, 1.4, -1.6));
    for (let k = 0; k < 4; k++) P.push(part(new THREE.CylinderGeometry(0.26, 0.2, 0.75, 8), '#ff6b57', -2.25 + k * 1.5, 0.67, -2.6));
    P.push(part(new THREE.BoxGeometry(5, 1.6, 0.4), '#7a5536', 0, 1.1, 2.6));
    for (let k = 0; k < 9; k++) P.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6), ['#e63946', '#ffd23f', '#38b000', '#4cc9f0'][k % 4], -2 + k * 0.5, 2.07, 2.55));
    for (const [sx, c] of [[-3.8, '#ff5d8f'], [-3.1, '#ffd23f'], [3.4, '#4cc9f0']]) P.push(part(new THREE.CapsuleGeometry(0.3, 1.8, 3, 8).scale(1, 1, 0.22), c, sx, 1.3, -3.9, 0, -0.18));
    staticGeos.push(bake(P, x, y, z, ry));
    thatchGeos.push(new THREE.ConeGeometry(6.8, 2.7, 4, 1).rotateY(Math.PI / 4).translate(0, 4.95, 0).applyMatrix4(M.makeRotationY(ry).setPosition(x, y, z)));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3).rotateY(Math.PI), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.25, roughness: 0.6 }));
    sign.position.set(x, y + 3.05, z).addScaledVector(new THREE.Vector3(-Math.sin(ry), 0, -Math.cos(ry)), 3.62);
    sign.rotation.y = ry;
    world.add(sign);
    api.block(x, z, 6);
  }

  // ---- beach huts (pastel, thatched) facing the sea
  const walls = ['#ff9eb5', '#7fd6c2', '#ffd166', '#8ecae6', '#f4a261', '#b9a8ff'];
  let lastHut = [-1e9, -1e9], huts = 0;
  for (const [x0, z0, nx, nz] of shore) {
    if (huts >= 7 || rnd() < 0.8 || Math.hypot(x0 - lastHut[0], z0 - lastHut[1]) < 55) continue;
    const L = R(15, 26), x = x0 - nx * L, z = z0 - nz * L;
    if (coastDist(x, z) > -13 || !tallOk(x, z, 5)) continue;
    const P = [], ry = Math.atan2(-nx, -nz);
    const T = hutParts(walls[huts % walls.length], P);
    const y = ground(x, z) - 0.15;
    staticGeos.push(bake(P, x, y, z, ry));
    thatchGeos.push(T.applyMatrix4(M.makeRotationY(ry).setPosition(x, y, z)));
    api.block(x, z, 5.5);
    lastHut = [x0, z0]; huts++;
  }

  // ---- umbrellas + loungers / towels on the sand between the guardrail and the water
  const cone = new THREE.ConeGeometry(1.55, 0.5, 8, 1, true), ci = cone.index.array, even = [], odd = [];
  for (let k = 0; k < 8; k++) (k % 2 ? odd : even).push(...ci.slice(k * 3, k * 3 + 3));   // open cone: one triangle per segment
  const canopy = idx => { const g = cone.clone(); g.setIndex(idx); return g.translate(0, 2.5, 0); };
  const umbA = [], umbB = [], chairs = [], towels = [];
  for (let i = 0; i < shore.length; i += 3) {
    if (rnd() < 0.35) continue;
    const [x0, z0, nx, nz] = shore[i], L = R(8, 17), x = x0 - nx * L, z = z0 - nz * L, cd = coastDist(x, z);
    if (cd > -6 || cd < -22 || !api.isFree(x, z, 2.4)) continue;
    const y = ground(x, z), face = Math.atan2(nx, nz);
    umbA.push([x, y - 0.05, z, rnd() * TAU, R(-0.12, 0.12), R(-0.12, 0.12)]);
    const towel = rnd() < 0.3;
    for (const k of [-1, 1]) {
      if (rnd() < 0.2) continue;
      const px = x + nz * 0.85 * k + nx * 0.7, pz = z - nx * 0.85 * k + nz * 0.7;
      (towel ? towels : chairs).push([px, ground(px, pz), pz, face + R(-0.15, 0.15)]);
    }
    api.block(x, z, 2.2);
  }
  const umbCols = ['#ff5d5d', '#ffb703', '#2ec4b6', '#3a86ff', '#ff70a6', '#8338ec', '#fb8500'];
  function instanced(geo, mat, list, set, color) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((e, i) => { set(e); dm.updateMatrix(); m.setMatrixAt(i, dm.matrix); if (color) m.setColorAt(i, tc.set(color(i))); });
    m.count = list.length;
    world.add(m);
    return m;
  }
  const umbSet = ([x, y, z, ry, rx, rz]) => { dm.position.set(x, y, z); dm.rotation.set(rx, ry, rz); dm.scale.setScalar(1); };
  const chairSet = ([x, y, z, ry]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(1); };
  const clothMat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
  const pole = instanced(new THREE.CylinderGeometry(0.035, 0.035, 2.5, 5).translate(0, 1.25, 0), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }), umbA, umbSet);
  const cA = instanced(canopy(even), clothMat, umbA, umbSet, i => umbCols[i % umbCols.length]);
  const cB = instanced(canopy(odd), clothMat, umbA, umbSet, () => '#ffffff');
  const loungerGeo = mergeGeometries([
    new THREE.BoxGeometry(0.62, 0.1, 1.25).translate(0, 0.34, 0.25),
    new THREE.BoxGeometry(0.62, 0.08, 0.72).rotateX(1.0).translate(0, 0.62, -0.62),
    ...[[-0.27, -0.3], [0.27, -0.3], [-0.27, 0.8], [0.27, 0.8]].map(([lx, lz]) => new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(lx, 0.15, lz)),
  ]);
  const chairCols = ['#ffffff', '#2ec4b6', '#ffd23f', '#ff6b57', '#8ecae6'];
  const lounge = instanced(loungerGeo, new THREE.MeshStandardMaterial({ roughness: 0.55 }), chairs, chairSet, i => chairCols[(i >> 1) % chairCols.length]);
  const stripeTex = api.canvasTex(32, 64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#9a9a9a'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 7); }, false);
  const towel = instanced(new THREE.BoxGeometry(0.9, 0.02, 1.8).translate(0, 0.02, 0.1), new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.9 }), towels, chairSet, i => umbCols[(i * 3 + 1) % umbCols.length]);
  for (const m of [pole, cA, cB, lounge]) m.castShadow = true;
  lounge.receiveShadow = towel.receiveShadow = true;

  // ---- palms: 3 trunk curvatures, instanced trunks (+coconuts) and alpha-tested frond crowns
  const frondTex = api.canvasTex(128, 256, (g, w, h) => {
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
  }, false);
  const frondMat = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  function crown(n, up, scale) {
    const F = [];
    for (let i = 0; i < n; i++) F.push(frondGeo(R(4.2, 5) * scale, 0.95 * scale, R(0.4, 0.75), R(-1.0, -1.5), 0.35, 6).rotateY(i / n * TAU + R(-0.2, 0.2)));
    for (let i = 0; i < up; i++) F.push(frondGeo(3 * scale, 0.7 * scale, R(1.1, 1.3), R(0.2, 0.5), 0.3, 5).rotateY(i / up * TAU + 0.5));
    return mergeGeometries(F);
  }
  const variants = [[8.5, 0.8], [9, 2.4], [8, 4.2]].map(([H, B]) => {
    const SEG = 12, RAD = 6, pos = [], col = [], idx = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG, px = B * (1 - (1 - t) ** 2), py = H * t, tx = 2 * B * (1 - t), tl = Math.hypot(tx, H);
      const nx = H / tl, ny = -tx / tl, r = 0.26 * (1 - 0.3 * t) + 0.22 * (1 - t) ** 8, c = k % 2 ? [0.3, 0.22, 0.15] : [0.46, 0.38, 0.28];
      for (let j = 0; j < RAD; j++) { const a = j / RAD * TAU; pos.push(px + nx * r * Math.cos(a), py + ny * r * Math.cos(a), r * Math.sin(a)); col.push(...c); }
    }
    for (let k = 0; k < SEG; k++) for (let j = 0; j < RAD; j++) { const a = k * RAD + j, b = k * RAD + (j + 1) % RAD; idx.push(a, a + RAD, b, b, a + RAD, b + RAD); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    const parts = [tg.toNonIndexed(), part(new THREE.IcosahedronGeometry(0.36, 0), '#5f6a2c', B, H, 0)];
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + 0.4; parts.push(part(new THREE.IcosahedronGeometry(0.2, 0), k ? '#5b4520' : '#7b8a2a', B + Math.cos(a) * 0.3, H - 0.32, Math.sin(a) * 0.3)); }
    return { trunk: mergeGeometries(parts), crown: crown(9, 3, 1).translate(B, H - 0.05, 0), list: [] };
  });
  const palms = [];
  const addPalm = (x, z, v, lean) => { palms.push([x, z]); variants[v].list.push([x, ground(x, z) - 0.15, z, lean, R(0.8, 1.2)]); };
  const nearPalm = (x, z, r) => palms.some(p => (p[0] - x) ** 2 + (p[1] - z) ** 2 < r * r);
  // beach palms lean out over the sand toward the sea
  for (let i = 0; i < shore.length; i += 2) {
    if (rnd() < 0.72) continue;
    const [x0, z0, nx, nz] = shore[i], L = R(4, 32), x = x0 - nx * L, z = z0 - nz * L, cd = coastDist(x, z);
    if (cd > -3 || cd < -34 || nearPalm(x, z, 7) || !tallOk(x, z, 1.5)) continue;
    const a = Math.atan2(nz, nx) + R(-0.6, 0.6);
    addPalm(x, z, rnd() < 0.6 ? 2 : 1, Math.atan2(-Math.sin(a), Math.cos(a)));
  }
  // palm avenue along the start straight
  for (let k = -60; k <= 100; k += 15) {
    const s = S[(k + N) % N];
    for (const lat of [W2 + 15, -(W2 + 15)]) {
      const x = s.pos.x - s.tan.z * lat, z = s.pos.z + s.tan.x * lat;
      if (tallOk(x, z, 1.5) && !nearPalm(x, z, 5)) addPalm(x, z, 0, rnd() * TAU);
    }
  }
  // inland groves
  for (let n = 0, tries = 0; n < 85 && tries < 3000; tries++) {
    const x = R(minX - 240, maxX + 160), z = R(minZ - 200, maxZ + 200), cd = coastDist(x, z);
    if (cd > -20 || nearPalm(x, z, 9) || trackAt(x, z).d > 260 || !tallOk(x, z, 1.5)) continue;
    addPalm(x, z, (rnd() * 3) | 0, rnd() * TAU); n++;
  }
  for (const v of variants) {
    const set = ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(s); };
    const t = instanced(v.trunk, trunkMat, v.list, set), c = instanced(v.crown, frondMat, v.list, set, () => tint.setRGB(R(0.8, 1.05), R(0.88, 1.08), R(0.75, 0.95)));
    t.castShadow = c.castShadow = true;
    c.receiveShadow = true;
  }

  // ---- undergrowth: palmettos (small frond fans), flowering bushes, dune grass tufts
  const fan = [];
  for (let i = 0; i < 7; i++) fan.push(frondGeo(R(1.4, 1.9), 0.45, R(0.7, 1.1), R(-0.1, 0.3), 0.25, 5).rotateY(i / 7 * TAU + R(-0.2, 0.2)));
  const fanGeo = mergeGeometries(fan), fans = [], bushes = [], tufts = [];
  for (let tries = 0; tries < 5000 && (fans.length < 240 || bushes.length < 90); tries++) {   // in small clumps
    const x = R(minX - 240, maxX + 160), z = R(minZ - 200, maxZ + 200), cd = coastDist(x, z), { d } = trackAt(x, z);
    if (cd > -14 || d < W2 + 13 || d > 240 || !api.isFree(x, z, 1.2)) continue;
    for (let j = 0, k = 1 + ((rnd() * 4) | 0); j < k; j++) {
      const px = x + (j && R(-4, 4)), pz = z + (j && R(-4, 4));
      if (j && !api.isFree(px, pz, 1.2)) continue;
      const e = [px, ground(px, pz), pz, rnd() * TAU, R(0.8, 1.5)];
      if (rnd() < 0.7 && fans.length < 240) fans.push(e); else if (bushes.length < 90) bushes.push(rnd() < 0.25 ? [px, e[1], pz, e[3], R(0.5, 0.9), ['#e0218a', '#ff7b54', '#c77dff'][(rnd() * 3) | 0]] : [...e, '#4a8f3a']);
    }
  }
  // jungle canopy on the island's hills: clumps of overlapping crowns (single scattered blobs read as polka dots)
  const leafCols = ['#2c6a2c', '#3a7a34', '#24582a', '#4d8c3c', '#5c9a40', '#31702f'];
  for (let n = 0, tries = 0; n < 100 && tries < 6000; tries++) {
    const x0 = R(cx - 850, cx + 850), z0 = R(cz - 850, cz + 850);
    if (ground(x0, z0) < 6 || coastDist(x0, z0) > -45 || trackAt(x0, z0).d < 90) continue;
    const k = 5 + ((rnd() * 6) | 0), sp = R(9, 18), c0 = (rnd() * leafCols.length) | 0;
    for (let j = 0; j < k; j++) {
      const x = x0 + R(-sp, sp), z = z0 + R(-sp, sp), y = ground(x, z);
      if (y < 4 || coastDist(x, z) > -38) continue;
      bushes.push([x, y - 1.3, z, rnd() * TAU, R(3.2, 7.5), leafCols[(c0 + (rnd() < 0.7 ? 0 : 1 + j)) % leafCols.length]]);
    }
    n++;
  }
  for (let tries = 0; tries < 3000 && tufts.length < 280; tries++) {
    const [x0, z0, nx, nz] = shore[(rnd() * shore.length) | 0], L = R(4, 45), x = x0 - nx * L + R(-3, 3), z = z0 - nz * L + R(-3, 3);
    if (coastDist(x, z) > -4 || trackAt(x, z).d < W2 + 11 || !api.isFree(x, z, 0.4)) continue;
    tufts.push([x, ground(x, z), z, rnd() * TAU, R(0.7, 1.4)]);
  }
  const pSet = ([x, y, z, ry, s]) => { dm.position.set(x, y, z); dm.rotation.set(0, ry, 0); dm.scale.setScalar(s); };
  const fanMesh = instanced(fanGeo, frondMat, fans, pSet, () => tint.setRGB(R(0.85, 1.15), R(0.95, 1.15), R(0.6, 0.9)));
  const bushGeo = new THREE.IcosahedronGeometry(1.2, 1).scale(1, 0.75, 1).translate(0, 0.6, 0);
  const bushMesh = instanced(bushGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), bushes, pSet, i => bushes[i][5]);
  const grassTex = api.canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = w / 2 + (Math.random() - 0.5) * w * 0.5, lean = (Math.random() - 0.5) * w * 0.8;
      g.strokeStyle = `rgb(${120 + Math.random() * 60 | 0},${140 + Math.random() * 50 | 0},${50 + Math.random() * 30 | 0})`; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.3, h * 0.5, x + lean, h * (0.05 + Math.random() * 0.3)); g.stroke();
    }
  }, false);
  const tuftGeo = mergeGeometries([new THREE.PlaneGeometry(1.3, 0.9).translate(0, 0.42, 0), new THREE.PlaneGeometry(1.3, 0.9).rotateY(Math.PI / 2).translate(0, 0.42, 0)]);
  instanced(tuftGeo, new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }), tufts, pSet);
  fanMesh.castShadow = bushMesh.castShadow = true;

  // ---- sailboats cruising slow circles offshore (+ the one moored at the pier)
  const boatCols = [['#ffffff', '#ffffff', '#ff6b57'], ['#1d3557', '#f1faee', '#e63946'], ['#ffffff', '#ffd23f', '#ff8c42'],
    ['#e9c46a', '#ffffff', '#2a9d8f'], ['#ffffff', '#e63946', '#ffffff'], ['#264653', '#f4f1de', '#f4a261'], ['#ffffff', '#4cc9f0', '#ffffff']];
  const boatMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  function boatGeo([hull, main, jib]) {
    const h = new THREE.BoxGeometry(1.9, 0.9, 6.2, 2, 1, 6), p = h.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), y = p.getY(i), f = z > 0 ? 1 - (z / 3.1) ** 2 * 0.92 : 1 - (-z / 3.1) ** 3 * 0.25;
      p.setXYZ(i, p.getX(i) * f * (y < 0 ? 0.5 : 1), y + (z > 0 && y > 0 ? (z / 3.1) ** 2 * 0.25 : 0), z);
    }
    return mergeGeometries([
      part(h, hull, 0, 0.25, 0),
      part(new THREE.BoxGeometry(1.4, 0.08, 4), '#c89b6a', 0, 0.72, -0.5),
      part(new THREE.BoxGeometry(1, 0.45, 1.5), '#f4f4f4', 0, 0.95, -0.9),
      part(new THREE.CylinderGeometry(0.05, 0.06, 8.2, 5), '#dddddd', 0, 4.8, 0.6),
      part(new THREE.CylinderGeometry(0.04, 0.04, 2.9, 4), '#dddddd', 0, 1.75, -0.85, 0, Math.PI / 2),
      tri([[0, 1.8, 0.5], [0, 8.4, 0.5], [0, 1.8, -2.3]], main),
      tri([[0, 7.4, 0.68], [0, 1.2, 2.9], [0, 1.2, 0.7]], jib),
    ]);
  }
  const boats = [];
  for (let tries = 0; tries < 600 && boats.length < 7; tries++) {
    const ax = R(minX - 420, maxX + 420), az = R(minZ - 260, maxZ + 260), r = R(22, 60);
    if (coastDist(ax, az) < 70 || Math.hypot(ax - cx, az - cz) < 250 || trackAt(ax, az).d > 420 || boats.some(b => Math.hypot(b.ax - ax, b.az - az) < 90)) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) ok = coastDist(ax + Math.cos(k / 8 * TAU) * r, az + Math.sin(k / 8 * TAU) * r) > 35;
    if (!ok) continue;
    const mesh = new THREE.Mesh(boatGeo(boatCols[boats.length]), boatMat);
    mesh.rotation.order = 'YXZ';
    mesh.castShadow = true;
    world.add(mesh);
    boats.push({ mesh, ax, az, r, w: (rnd() < 0.5 ? -1 : 1) * R(1.6, 2.8) / r, a0: rnd() * TAU, ph: rnd() * TAU });
  }
  {
    const mesh = new THREE.Mesh(boatGeo(['#ffffff', '#ffffff', '#2ec4b6']), boatMat);
    mesh.rotation.order = 'YXZ';
    world.add(mesh);
    boats.push({ mesh, ax: PX + 50, az: PZ + 3.8, r: 0, w: 0, a0: 0, ph: 1.3, h: Math.PI / 2 });
  }

  // ---- gulls circling over the beach and the promontory
  const gullGeo = new THREE.BufferGeometry();
  gullGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.95, 0.3, -0.2, 0, 0, 0.32, 0, 0, -0.22, 0.95, 0.3, -0.2, 0, 0, -0.22, 0, 0, 0.32], 3));
  gullGeo.setAttribute('color', new THREE.Float32BufferAttribute([0.25, 0.25, 0.28, 1, 1, 1, 0.9, 0.9, 0.92, 0.25, 0.25, 0.28, 0.9, 0.9, 0.92, 1, 1, 1], 3));
  gullGeo.computeVertexNormals();
  const gullSpots = [[LH[0], LH[1]], [PX + 30, PZ], [S[480].pos.x + 60, S[480].pos.z], [S[300].pos.x, S[300].pos.z + 70], [S[880].pos.x, S[880].pos.z - 70]];
  const gulls = Array.from({ length: 14 }, (_, i) => ({ c: gullSpots[i % gullSpots.length], r: R(14, 34), h: R(16, 30), w: (rnd() < 0.5 ? -1 : 1) * R(0.25, 0.45), a0: rnd() * TAU, ph: rnd() * TAU }));
  const gullMesh = new THREE.InstancedMesh(gullGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }), gulls.length);
  gullMesh.frustumCulled = false;
  world.add(gullMesh);
  const gd = new THREE.Object3D();
  gd.rotation.order = 'YXZ';

  // ---- far scenery: hazy islands on the horizon and cumulus clouds
  for (const [dx, dz, s] of [[1050, 180, 110], [720, -900, 150], [260, 1050, 90], [1200, -380, 70], [-1020, -260, 120], [-700, 850, 80]]) {
    const x = cx + dx, z = cz + dz;
    if (coastDist(x, z) < 300) continue;
    staticGeos.push(part(new THREE.SphereGeometry(1, 18, 8, 0, TAU, 0, Math.PI / 2).scale(s, s * 0.22, s * 0.7), '#2f6a33', x, SEA - 2, z));
    staticGeos.push(part(new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, Math.PI / 2).scale(s * 0.45, s * 0.32, s * 0.4), '#2a6130', x + s * 0.3, SEA - 2, z - s * 0.1));
    staticGeos.push(part(new THREE.CylinderGeometry(s * 1.08, s * 1.14, 2.4, 24).scale(1, 1, 0.72), '#eadcb2', x, SEA - 0.9, z));
  }
  const cloudTex = api.canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 30; i++) {
      const u = 0.15 + Math.random() * 0.7, x = w * u, r = (12 + Math.random() * 26) * (0.5 + Math.sin(u * Math.PI)), y = h * 0.72 - r * 0.55 - Math.random() * h * 0.12;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(250,252,255,0.75)'); gr.addColorStop(1, 'rgba(235,242,252,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, h * 0.66, 0, h * 0.8);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade; g.fillRect(0, 0, w, h);
  }, false);
  const clouds = [];
  for (let i = 0; i < 14; i++) {
    const a = -1.3 + i / 14 * 4.4 + R(-0.15, 0.15), r = R(1000, 1500);
    clouds.push([cx + Math.sin(a) * r, R(150, 330), cz + Math.cos(a) * r, R(260, 520)]);
  }
  const cloudMesh = instanced(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1.25, 1.25, 1.3) }), clouds,
    ([x, y, z, s]) => { dm.position.set(x, y, z); dm.scale.set(s, s, 1); dm.rotation.set(0, 0, 0); dm.lookAt(cx, y, cz); });
  cloudMesh.renderOrder = -2;
  cloudMesh.frustumCulled = false;

  // ---- merged static props
  const props = new THREE.Mesh(mergeGeometries(staticGeos), vcMat);
  props.castShadow = props.receiveShadow = true;
  const roofs = new THREE.Mesh(mergeGeometries(thatchGeos), new THREE.MeshStandardMaterial({ map: thatchTex, roughness: 0.95, flatShading: true }));
  roofs.castShadow = roofs.receiveShadow = true;
  world.add(props, roofs);

  // ---- animation
  let clock = 0;
  api.onUpdate(dt => {
    const t = clock += dt;
    oceanMat.uniforms.uTime.value = t;
    ocean.position.y = SEA + 0.07 * Math.sin(t * 0.95) + 0.03 * Math.sin(t * 2.3 + 1);
    for (const b of boats) {
      const a = b.a0 + t * b.w, x = b.ax + Math.cos(a) * b.r, z = b.az + Math.sin(a) * b.r;
      const h = b.h ?? Math.atan2(-Math.sin(a) * b.w, Math.cos(a) * b.w);
      b.mesh.position.set(x, SEA - 0.05 + 0.12 * Math.sin(t * 1.1 + b.ph), z);
      b.mesh.rotation.set(0.04 * Math.sin(t * 1.4 + b.ph), h, (b.r ? 0.12 : 0) + 0.05 * Math.sin(t * 0.9 + b.ph * 2));
    }
    gulls.forEach((g, i) => {
      const a = g.a0 + t * g.w;
      gd.position.set(g.c[0] + Math.cos(a) * g.r, g.h + Math.sin(t * 0.4 + g.ph) * 2.5, g.c[1] + Math.sin(a) * g.r);
      gd.rotation.set(0, Math.atan2(-Math.sin(a) * g.w, Math.cos(a) * g.w), -0.3 * Math.sign(g.w));
      const flap = Math.sin(t * 2.2 + g.ph) > 0.2 ? Math.sin(t * 9 + g.ph) : 0.35;
      gd.scale.set(1, flap, 1);
      gd.updateMatrix();
      gullMesh.setMatrixAt(i, gd.matrix);
    });
    gullMesh.instanceMatrix.needsUpdate = true;
    lampMat.emissiveIntensity = 1 + 3 * Math.pow(Math.max(0, Math.sin(t * 1.3)), 12);
  });
}

export default { env: ENV, build };
