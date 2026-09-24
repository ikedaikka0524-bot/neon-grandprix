// Circuit Gilles-Villeneuve, Île Notre-Dame, Montreal (summer day). The circuit fills an island in the St. Lawrence:
// river on both sides, the Olympic rowing basin inside the loop, the Biosphère lattice dome on Île Sainte-Hélène
// north of the hairpin, downtown + Mount Royal across the river to the north-west, a steel truss bridge to the north,
// stacked-cube housing on the Cité du Havre pier to the west, and the white welcome wall at the final chicane.
// Also exports the small kit that hungaroring.js / interlagos.js reuse (same owner).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const seeded = s => () => ((s = (s * 16807) % 2147483647) / 2147483647);   // fixed layouts (skylines) for every race and every client
export const bump = (x, z, bx, bz, r, h) => h * Math.exp(-((x - bx) ** 2 + (z - bz) ** 2) / (r * r));
const UP = new THREE.Vector3(0, 1, 0);

// Even-odd "inside the course loop" test, rasterised once (4 m cells) from a course's control points.
export function loopMask(points, cell = 4) {
  let mask = null, x0 = Infinity, z0 = Infinity;
  return (x, z) => {
    if (!mask) {
      let x1 = -Infinity, z1 = -Infinity;
      for (const [px, , pz] of points) { x0 = Math.min(x0, px); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); z1 = Math.max(z1, pz); }
      const w = Math.ceil((x1 - x0) / cell) + 2, h = Math.ceil((z1 - z0) / cell) + 2, c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.beginPath();
      points.forEach(([px, , pz], k) => g[k ? 'lineTo' : 'moveTo']((px - x0) / cell + 1, (pz - z0) / cell + 1));
      g.fill();
      const d = g.getImageData(0, 0, w, h).data;
      mask = { w, h, a: new Uint8Array(w * h).map((_, k) => d[k * 4 + 3] > 127) };
    }
    const i = Math.floor((x - x0) / cell + 1), j = Math.floor((z - z0) / cell + 1);
    return i >= 0 && j >= 0 && i < mask.w && j < mask.h && mask.a[j * mask.w + i] === 1;
  };
}
// signed distance to a rounded strip from a to b, half width hw (negative inside)
export function sdStrip(x, z, ax, az, bx, bz, hw) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, px = x - ax, pz = z - az;
  const qa = Math.abs(px * ux + pz * uz - L / 2) - L / 2, qb = Math.abs(-px * uz + pz * ux) - hw;
  return Math.hypot(Math.max(qa, 0), Math.max(qb, 0)) + Math.min(Math.max(qa, qb), 0);
}

// ======================================================================================
// Kit: placement checks, merged vertex-coloured buckets, instancing, stands + crowd, trees, water, sky panorama
// ======================================================================================
const SHIRTS = ['#e63946', '#f1faee', '#1d3557', '#457b9d', '#ffb703', '#2a9d8f', '#3a3a3a', '#d9d4c7', '#ff7b00', '#8d99ae', '#ffffff', '#c1121f'];

function treeGeo(kind) {
  const parts = [];
  const add = (g, c, x = 0, y = 0, z = 0, s = [1, 1, 1]) => {
    g = g.index ? g.toNonIndexed() : g;
    g.deleteAttribute('uv');
    g.scale(...s).translate(x, y, z);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(c), 3));
    parts.push(g);
  };
  const trunk = (h, r) => add(new THREE.CylinderGeometry(r * 0.65, r, h, 5, 1, true), 0.42, 0, h / 2);
  const ball = (r, x, y, z, s) => add(new THREE.IcosahedronGeometry(r, 0), 1, x, y, z, s);
  if (kind === 'broad') { trunk(3.4, 0.32); ball(2.6, 0, 4.9, 0); ball(1.9, 1.3, 4.0, 0.6); }
  else if (kind === 'round') { trunk(2.6, 0.26); ball(2.3, 0, 3.9, 0, [1, 0.9, 1]); }
  else if (kind === 'poplar') { trunk(2.2, 0.24); ball(1.5, 0, 5.9, 0, [1, 3, 1]); }
  else if (kind === 'pine') { trunk(2, 0.24); add(new THREE.ConeGeometry(2.4, 5, 6), 1, 0, 4, 0); add(new THREE.ConeGeometry(1.6, 3.6, 6), 1, 0, 6.6, 0); }
  else if (kind === 'canopy') { trunk(4.4, 0.3); ball(3.5, 0, 5.5, 0, [1.25, 0.42, 1.25]); ball(2.3, 1.9, 5.0, -0.8, [1.2, 0.5, 1.2]); }
  else if (kind === 'bush') ball(1.1, 0, 0.55, 0, [1.4, 0.75, 1.4]);
  else if (kind === 'palm') {
    trunk(8.5, 0.24);
    const p = [];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU + 0.3, cx = Math.cos(a), cz = Math.sin(a), px = -cz * 0.5, pz = cx * 0.5;
      const A = [0, 8.5, 0], B = [cx * 1.9, 9.1, cz * 1.9], C = [cx * 3.8, 7.9, cz * 3.8];
      p.push(...A, B[0] + px, B[1], B[2] + pz, B[0] - px, B[1], B[2] - pz, B[0] + px, B[1], B[2] + pz, ...C, B[0] - px, B[1], B[2] - pz);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    add(g, 1);
  }
  return mergeGeometries(parts);
}

const WATER_VS = `varying vec3 vW;
#include <fog_pars_vertex>
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const WATER_FS = `uniform float uTime, uFres; uniform vec3 uDeep, uShal, uSky, uHor, uSun, uSunCol; uniform vec2 uFlow;
varying vec3 vW;
#include <fog_pars_fragment>
vec2 wv(vec2 p, vec2 d, float k, float a, float w) { d = normalize(d); return d * (a * k * cos(dot(d, p) * k + w)); }
void main() {
  vec2 p = vW.xz - uFlow * uTime; float t = uTime;
  float fine = 1.0 - smoothstep(50.0, 420.0, length(cameraPosition - vW));
  vec2 g = wv(p, vec2(0.8, 0.6), 0.19, 0.11, t * 1.2) + wv(p, vec2(-0.5, 0.9), 0.33, 0.07, t * 1.6)
    + wv(p, vec2(0.95, -0.3), 0.61, 0.04, t * 2.2) * (0.35 + 0.65 * fine)
    + (wv(p, vec2(-0.7, -0.7), 1.3, 0.022, t * 3.0) + wv(p, vec2(0.2, 1.0), 2.2, 0.013, t * 3.9) + wv(p, vec2(-1.0, 0.3), 3.7, 0.008, t * 5.1)) * fine;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y)), V = normalize(cameraPosition - vW), R = reflect(-V, n);
  float F = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 sky = mix(uHor, uSky, pow(clamp(R.y, 0.0, 1.0), 0.6));
  float sd = max(dot(R, uSun), 0.0);
  vec3 body = mix(uDeep, uShal, clamp(0.5 + (g.x + g.y) * 2.0, 0.0, 1.0));
  vec3 col = mix(body, sky, min(F, uFres)) + uSunCol * (pow(sd, 700.0) * 14.0 + pow(sd, 60.0) * 0.45);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const SKY_POS = 'vec4 skyPos(vec3 d){ vec4 p = projectionMatrix * vec4((viewMatrix * vec4(d, 0.0)).xyz, 1.0); p.z = p.w * 0.99999; return p; }';

export function kit(api) {
  const { world, track, def, rnd } = api, S = track.samples, N = S.length, W2 = track.width / 2, WALL = W2 + (def.wallGap ?? 9.4);
  const R = (a, b) => a + (b - a) * rnd(), pick = a => a[Math.floor(rnd() * a.length)];
  const col = new THREE.Color(), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3();

  // nearest sample (every 2nd), signed lateral (+ = right of travel)
  function at(x, z) {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z, i: bi };
  }
  const idx = (x, z) => at(x, z).i;
  // fast distance to the centreline for bulk loops (colours, candidate filters; isFree stays the real guard):
  // scan every 12th sample, then refine around the best one (can overshoot a little where two stretches run close)
  const FX = Float32Array.from(S, s => s.pos.x), FZ = Float32Array.from(S, s => s.pos.z), NC = Math.floor(N / 12);
  function dist(x, z) {
    let bd = Infinity, bk = 0;
    for (let k = 0; k < NC; k++) { const dx = FX[k * 12] - x, dz = FZ[k * 12] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bk = k; } }
    if (bd < 14400) for (let j = bk * 12 - 11; j < bk * 12 + 12; j++) { const i = (j + N) % N, dx = FX[i] - x, dz = FZ[i] - z, d = dx * dx + dz * dz; if (d < bd) bd = d; }
    return Math.sqrt(bd);
  }
  const span = (a, b) => { const o = []; for (let i = a; i !== b; i = (i + 1) % N) o.push(i); return o; };   // forward, wraps
  // corner side per sample (+1 left turn nearby, -1 right, 0 straight)
  const bend = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -30; k <= 30; k += 3) { const c = S[(i + k + N) % N].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
    bend[i] = Math.abs(m) > 1 / 160 ? Math.sign(m) : 0;
  }
  // free spot; tall things stay >= 20 m behind the barrier on the inside of corners (the chase camera looks across)
  function ok(x, z, r, tall = false) {
    if (!api.isFree(x, z, r)) return false;
    if (!tall) return true;
    const q = at(x, z);
    return q.d >= WALL + 20 + r || bend[q.i] === 0 || Math.sign(q.lat) === bend[q.i];
  }

  // merged vertex-coloured buckets: one draw call each. color null keeps the geometry's own colour attribute.
  const buckets = {};
  function put(name, geo, color = '#ffffff', x = 0, y = 0, z = 0, ry = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo, n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (color !== null || !g.attributes.color) {
      col.set(color ?? '#ffffff');
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.toArray(a, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    g.applyMatrix4(M.makeRotationY(ry).setPosition(x, y, z));
    (buckets[name] ||= []).push(g);
    return g;
  }
  const box = (name, w, h, d, x, y, z, ry = 0, color) => put(name, new THREE.BoxGeometry(w, h, d), color, x, y, z, ry);
  // box with world-scaled uvs on its walls (window textures: cw × ch metres per tile, roof = texel 0,0)
  function tower(name, w, h, d, x, y0, z, ry = 0, color = '#ffffff', cw = 24, ch = 25.6) {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(), uv = g.attributes.uv, fw = [d, d, 0, 0, w, w];
    const ou = Math.floor(rnd() * 8) / 8, ov = Math.floor(rnd() * 4) / 8;
    for (let i = 0; i < 36; i++) { const f = fw[Math.floor(i / 6)]; uv.setXY(i, f ? ou + uv.getX(i) * f / cw : 0.004, f ? ov + uv.getY(i) * h / ch : 0.004); }
    return put(name, g, color, x, y0 + h / 2, z, ry);
  }
  function flush(name, mat, shadow = true) {
    const geos = buckets[name];
    delete buckets[name];
    if (!geos?.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.castShadow = m.receiveShadow = shadow;
    world.add(m);
    return m;
  }
  // rows: [x, y, z, ry, sx, sy, sz, color]
  function inst(geo, mat, rows, shadow = true) {
    if (!rows.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, rows.length);
    rows.forEach(([x, y, z, ry, sx, sy = sx, sz = sx, c = '#ffffff'], i) => {
      m.setMatrixAt(i, M.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, ry), SC.set(sx, sy, sz)));
      m.setColorAt(i, col.set(c));
    });
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  }
  // square struts between two points: [[ax, ay, az], [bx, by, bz], thickness]
  const strut = new THREE.CylinderGeometry(0.5, 0.5, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  function beams(list, mat, shadow = false) {
    const m = new THREE.InstancedMesh(strut, mat, list.length), a = new THREE.Vector3();
    list.forEach(([pa, pb, t], i) => {
      a.set(...pa); V.set(...pb).sub(a);
      const len = V.length();
      m.setMatrixAt(i, M.compose(a, Q.setFromUnitVectors(UP, V.normalize()), SC.set(t, len, t)));
    });
    m.castShadow = shadow;
    world.add(m);
    return m;
  }
  // local frame beside sample i at lateral lat: u along the road, v away from it; ry turns local +Z away from the road
  function frame(i, lat) {
    const s = S[((i % N) + N) % N], sg = Math.sign(lat) || 1;
    const x0 = s.pos.x + s.right.x * lat, z0 = s.pos.z + s.right.z * lat, ry = Math.atan2(s.right.x * sg, s.right.z * sg);
    const c = Math.cos(ry), sn = Math.sin(ry);
    return { x: x0, y: s.pos.y, z: z0, ry, to: (u, v) => [x0 + c * u + sn * v, z0 - sn * u + c * v] };
  }
  // tiered grandstand (front row at |lat|), crowd as instanced cut-outs
  const crowd = [];
  function stand(i, lat, len, rows, o = {}) {
    const f = frame(i, lat), step = 0.9, rise = 0.55, y0 = f.y - 0.2, conc = o.conc || '#c3c7cd', shirts = o.shirts || SHIRTS;
    for (let r = 0; r < rows; r++) {
      const top = rise * (r + 1);
      let [x, z] = f.to(0, r * step + step / 2);
      box('solid', len, top, step, x, y0 + top / 2, z, f.ry, conc);
      [x, z] = f.to(0, r * step + 0.2);
      box('solid', len, 0.28, 0.3, x, y0 + top + 0.14, z, f.ry, o.seat || '#2d5da8');
      for (let u = -len / 2 + 0.4; u < len / 2 - 0.3; u += 0.62) {
        if (rnd() > (o.fill ?? 0.8)) continue;
        [x, z] = f.to(u + R(-0.1, 0.1), r * step + 0.5);
        crowd.push([x, y0 + top, z, f.ry + Math.PI, 1, R(0.85, 1.1), 1, pick(shirts)]);
      }
    }
    const D = rows * step, H = rows * rise;
    for (const u of [-len / 2 - 0.2, len / 2 + 0.2]) { const [x, z] = f.to(u, D / 2); box('solid', 0.4, H + 1.2, D, x, y0 + (H + 1.2) / 2, z, f.ry, conc); }
    let [x, z] = f.to(0, D + 0.2);
    box('solid', len + 0.8, H + 2.4, 0.4, x, y0 + (H + 2.4) / 2, z, f.ry, conc);
    if (o.roof !== false) {
      [x, z] = f.to(0, D / 2 - 0.5);
      box('solid', len + 3, 0.35, D + 4, x, y0 + H + 4.6, z, f.ry, o.roofc || '#eef1f4');
      [x, z] = f.to(0, -2.4);
      box('solid', len + 3, 0.9, 0.25, x, y0 + H + 4.4, z, f.ry, o.trim || '#d7263d');
      const k = Math.max(2, Math.round(len / 24));
      for (let j = 0; j <= k; j++) { [x, z] = f.to(-len / 2 + len * j / k, D + 0.6); box('solid', 0.5, H + 4.6, 0.5, x, y0 + (H + 4.6) / 2, z, f.ry, '#8a9099'); }
    }
    for (let u = -len / 2; u <= len / 2 + 0.1; u += 10) { [x, z] = f.to(u, D / 2); api.block(x, z, D / 2 + 3); }
    return f;
  }
  // pit lane (lateral l0..l1 on `side`, +1 right) + garage block with glass upper floor and canopy, along samples ids
  function pits(ids, { side = 1, lane = [WALL + 1.2, WALL + 15], depth = 14, wall = '#e9ecef', glass = '#40607a', trim = '#c8102e' } = {}) {
    const [l0, l1] = lane, front = l1 + 1.5, mid = front + depth / 2, sg = side, pos = [], cl = [], c0 = new THREE.Color('#4a4d52'), c1 = new THREE.Color('#f1f1ec');
    for (let k = 0; k < ids.length - 1; k++) {
      const a = S[ids[k]], b = S[ids[k + 1]];
      for (const [p0, p1, c, dy] of [[l0, l1, c0, 0.05], [l0 + 0.6, l0 + 0.9, c1, 0.07], [l1 - 0.4, l1 - 0.1, c1, 0.07]]) {
        const P = (s, l) => [s.pos.x + s.right.x * l * sg, s.pos.y + dy, s.pos.z + s.right.z * l * sg];
        pos.push(...P(a, p0), ...P(a, p1), ...P(b, p0), ...P(a, p1), ...P(b, p1), ...P(b, p0));
        for (let v = 0; v < 6; v++) cl.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    put('flat', g, null);
    for (let k = 0; k + 9 < ids.length; k += 9) {
      const a = S[ids[k]], b = S[ids[k + 9]], y = a.pos.y - 0.2;
      const ax = a.pos.x + a.right.x * mid * sg, az = a.pos.z + a.right.z * mid * sg, bx = b.pos.x + b.right.x * mid * sg, bz = b.pos.z + b.right.z * mid * sg;
      const len = Math.hypot(bx - ax, bz - az) + 0.6, ry = Math.atan2(-(bz - az), bx - ax), rx = sg * (a.right.x + b.right.x) / 2, rz = sg * (a.right.z + b.right.z) / 2;
      const off = l => [(ax + bx) / 2 + rx * (l - mid), (az + bz) / 2 + rz * (l - mid)];
      let [x, z] = off(mid);
      box('solid', len, 5, depth, x, y + 2.5, z, ry, wall);
      [x, z] = off(front - 0.1); box('solid', len - 1.5, 3.8, 0.3, x, y + 1.9, z, ry, '#2b3038');
      [x, z] = off(mid + 0.5); box('glass', len, 3.6, depth - 1, x, y + 6.8, z, ry, glass);
      [x, z] = off(mid - 0.5); box('solid', len + 0.4, 0.45, depth + 4, x, y + 8.9, z, ry, '#f4f6f8');
      [x, z] = off(front - 2); box('solid', len + 0.4, 0.7, 0.3, x, y + 9.3, z, ry, trim);
      for (let l = front + 1; l <= front + depth; l += 5) { [x, z] = off(l); api.block(x, z, 4 + len / 2); }
    }
    return mid + depth / 2;
  }
  // fans on a natural slope beside samples ids (side +1 right / -1 left), rows from lateral `from`; some under umbrellas
  const brolly = [];
  function bank(ids, side, { from = WALL + 7, rows = 10, gap = 1.6, fill = 0.4, umbrellas = 0.03, shirts = SHIRTS } = {}) {
    for (const i of ids) {
      const s = S[i], ry = Math.atan2(-s.right.x * side, -s.right.z * side);
      for (let r = 0; r < rows; r++) for (let k = 0; k < 5; k++) {
        if (rnd() > fill) continue;
        const lat = side * (from + r * gap + R(-0.4, 0.4)), along = R(0, track.spacing);
        const x = s.pos.x + s.right.x * lat + s.tan.x * along, z = s.pos.z + s.right.z * lat + s.tan.z * along;
        if (!api.isFree(x, z, 0.3)) continue;
        const y = api.groundAt(x, z);
        crowd.push([x, y, z, ry, 1, R(0.85, 1.1), 1, pick(shirts)]);
        if (rnd() < umbrellas) brolly.push([x + R(-0.5, 0.5), y, z + R(-0.5, 0.5), rnd() * TAU, 1, 1, 1, pick(['#e63946', '#ffffff', '#ffb703', '#1d3557', '#2a9d8f', '#f4a261'])]);
      }
    }
  }
  const personTex = api.canvasTex(32, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(4, 20, 24, 44, 8); g.fill();
    g.fillStyle = '#4a3a30'; g.beginPath(); g.arc(16, 12, 9, 0, TAU); g.fill();
  }, false);
  function flushCrowd() {
    inst(new THREE.PlaneGeometry(0.5, 0.8).translate(0, 0.4, 0),
      new THREE.MeshStandardMaterial({ map: personTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), crowd.splice(0), false);
    inst(mergeGeometries([new THREE.ConeGeometry(1.1, 0.45, 8, 1, true).translate(0, 2.05, 0), new THREE.CylinderGeometry(0.03, 0.03, 2, 3, 1, true).translate(0, 1, 0)]),
      new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), brolly.splice(0));
  }

  // trees: rows [x, z, kind, scale, color]; one instanced mesh per kind (trunk baked in, darker by vertex colour)
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, side: THREE.DoubleSide });
  function trees(list) {
    const by = {};
    for (const t of list) (by[t[2]] ||= []).push(t);
    for (const k in by) inst(treeGeo(k), k === 'palm' ? palmMat : treeMat,
      by[k].map(([x, z, , s, c]) => [x, api.groundAt(x, z) - 0.25, z, rnd() * TAU, s, s * R(0.85, 1.15), s, c]));
  }

  function water({ y, deep, shallow, flow = [0, 0], size = 8000, hor = api.env.sky.horizon, fres = 0.85, x = (track.bounds.minX + track.bounds.maxX) / 2, z = (track.bounds.minZ + track.bounds.maxZ) / 2 }) {
    const e = api.env, uni = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color(deep) }, uShal: { value: new THREE.Color(shallow) },
      uSky: { value: new THREE.Color(e.sky.top) }, uHor: { value: new THREE.Color(hor) }, uFres: { value: fres },
      uSun: { value: new THREE.Vector3(...e.sun.dir).normalize() }, uSunCol: { value: new THREE.Color(e.sun.color) }, uFlow: { value: new THREE.Vector2(...flow) },
    }]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size, Math.ceil(size / 125), Math.ceil(size / 125)).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: uni, vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true }));
    m.position.set(x, y, z);
    world.add(m);
    api.onUpdate(dt => { uni.uTime.value += dt; });
    return m;
  }
  // far horizon drawn at infinity: paint(g, w, h, X(bearing°), Y(elevation)) on a ring from elevation y0 to y1
  function panorama(paint, { y0 = -0.012, y1 = 0.14, haze = 0.35, w = 4096, h = 256 } = {}) {
    const X = b => ((b % 360) + 360) % 360 / 360 * w, Y = e => h * (1 - (e - y0) / (y1 - y0));
    const tex = api.canvasTex(w, h, g => { g.clearRect(0, 0, w, h); paint(g, w, h, X, Y); });
    const pos = [], uv = [], ix = [], n = 180;
    for (let k = 0; k <= n; k++) { const b = k / n * TAU; pos.push(Math.sin(b), y0, -Math.cos(b), Math.sin(b), y1, -Math.cos(b)); uv.push(k / n, 0, k / n, 1); }
    for (let k = 0; k < n; k++) { const a = k * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(ix);
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, fogc: { value: new THREE.Color(api.env.fog.color) }, haze: { value: haze } },
      vertexShader: `varying vec2 vUv; ${SKY_POS} void main(){ vUv = uv; gl_Position = skyPos(position); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogc; uniform float haze; varying vec2 vUv;
        void main(){ vec4 c = texture2D(map, vUv); gl_FragColor = vec4(mix(c.rgb, fogc, haze + (1.0 - haze) * 0.5 * (1.0 - smoothstep(0.0, 0.25, vUv.y))), c.a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.renderOrder = -8;
    world.add(m);
    return m;
  }
  // drifting cumulus deck (one fogged plane)
  function clouds(y = 260, amount = 22, tint = 0xf6f8fb) {
    const tex = api.canvasTex(512, 512, (g, w, h) => {
      for (let c = 0; c < amount; c++) {
        const ox = rnd() * w, oy = rnd() * h, n = 5 + Math.floor(rnd() * 9), sp = 18 + rnd() * 46;
        for (let k = 0; k < n; k++) {
          const x = ox + (rnd() - 0.5) * sp * 2, yy = oy + (rnd() - 0.5) * sp * 0.7, r = 12 + rnd() * 30;
          for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
            const gr = g.createRadialGradient(x + dx, yy + dy, 0, x + dx, yy + dy, r);
            gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(x + dx - r, yy + dy - r, 2 * r, 2 * r);
          }
        }
      }
    });
    tex.repeat.set(4, 4);
    const b = track.bounds, m = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, color: tint, transparent: true, depthWrite: false }));
    m.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
    m.renderOrder = -5;
    world.add(m);
    let t = 0;
    api.onUpdate(dt => { t += dt; tex.offset.set(t * 0.0012, t * 0.0005); });
  }
  // repaint world.js's terrain vertex colours: fn(x, y, z, normalY, color) edits color (it multiplies the ground texture)
  function recolor(fn) {
    const t = world.children.find(o => o.isMesh && o.geometry.parameters?.widthSegments > 60 && o.geometry.attributes.color);
    if (!t) return;
    const p = t.geometry.attributes.position, c = t.geometry.attributes.color, n = t.geometry.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      col.setRGB(c.getX(i), c.getY(i), c.getZ(i));
      fn(p.getX(i), p.getY(i), p.getZ(i), n.getY(i), col);
      c.setXYZ(i, col.r, col.g, col.b);
    }
    c.needsUpdate = true;
  }
  return { S, N, W2, WALL, R, pick, col, at, idx, dist, span, bend, ok, put, box, tower, flush, inst, beams, frame, stand, pits, bank, flushCrowd, trees, water, panorama, clouds, recolor };
}

// window tiles: 8 × 8 cells (3 m × 3.2 m with the default tower() scale) on a wall colour; bottom-left texel = wall
export function paintWindows(g, w, h, { wall = '#d9d9d6', glass = ['#2c3e50', '#34495e', '#5d7389', '#a9c1d6'], ww = 0.62, wh = 0.55, band = false } = {}) {
  g.fillStyle = wall; g.fillRect(0, 0, w, h);
  const cw = w / 8, chh = h / 8;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    g.fillStyle = glass[Math.floor(Math.random() * glass.length)];
    if (band) g.fillRect(i * cw, j * chh + chh * 0.2, cw, chh * wh);
    else g.fillRect(i * cw + cw * (1 - ww) / 2, j * chh + chh * 0.2, cw * ww, chh * wh);
  }
  g.fillStyle = 'rgba(0,0,0,0.08)';
  for (let j = 0; j < 8; j++) g.fillRect(0, j * chh + chh - 2, w, 2);
  g.fillStyle = wall; g.fillRect(0, h - 6, 6, 6);
}

// ======================================================================================
// Montreal
// ======================================================================================
const WATER = -1.3;
const inLoop = loopMask(TRACK_BY_ID.montreal.points);
const BASIN = [-55, 380, -265, -860, 45];         // rowing basin inside the loop (A → B, half width)
const POND = [-340, -400, 70];
const HELENE = [-430, -1790, 360, 230];           // Île Sainte-Hélène (ellipse)
const HAVRE = [-1350, -800, -780, -1250, 75];     // Cité du Havre pier
const BIO = [-560, -1690];                        // Biosphère
const CASINO = [-485, -1075];
// spots where the island is wider than the usual ~50 m band outside the course
const WIDE = [[125, 505, 120, 45], [CASINO[0], CASINO[1] - 20, 150, 130], [-330, -1445, 110, 42], [60, 330, 90, 22], [40, -40, 140, 18], [-20, -280, 70, 16]];
const westShore = (x, z) => x - (-1300 - 0.25 * (z + 800)) + 25 * Math.sin(z * 0.004);
const eastShore = (x, z) => 1060 + 30 * Math.sin(z * 0.005 + 1) - x;

function landSd(x, z, dist) {
  const wob = 7 * Math.sin(x * 0.011 + z * 0.006) + 5 * Math.sin(z * 0.019 - x * 0.014 + 1);
  let s = inLoop(x, z) ? -dist - 50 : dist - 38 - WIDE.reduce((m, [bx, bz, r, e]) => m + bump(x, z, bx, bz, r, e), 0) + wob;
  s = Math.max(s, -sdStrip(x, z, ...BASIN), POND[2] - Math.hypot(x - POND[0], z - POND[1]) + wob * 0.4);
  const [hx, hz, rx, rz] = HELENE;
  return Math.min(s, (Math.hypot((x - hx) / rx, (z - hz) / rz) - 1) * rz + wob, sdStrip(x, z, ...HAVRE), westShore(x, z) + wob, eastShore(x, z) + wob);
}

const ENV = {
  sky: { top: '#2f6cc9', horizon: '#cfe0ee', bottom: '#9bb8c8' },
  fog: { color: '#cfe0ee', near: 420, far: 3000 },
  sun: { dir: [-0.42, 0.63, 0.52], color: '#fff2dc', intensity: 2.8 },
  hemi: { sky: '#d6e9ff', ground: '#4f6a40', intensity: 0.85 },
  exposure: 1.0,
  envIntensity: 0.42,
  night: false,
  terrain: {
    hills: 0.6, rim: 0, rimColor: '#4f7a3a',
    height: (x, z, y, dist) => {
      const s = landSd(x, z, dist);
      if (s < -5) return y;
      return lerp(y, WATER - 1.1 - Math.min(6, Math.max(0, s) * 0.2), smooth(-5, 3, s));
    },
  },
};

function paintMontreal(g, w, h, X, Y) {
  const rand = seeded(1978);
  const rect = (b0, b1, e0, e1, c) => { g.fillStyle = c; g.fillRect(X(b0), Y(e1), Math.max(1, X(b1) - X(b0)), Y(e0) - Y(e1)); };
  // Mount Royal behind downtown
  g.fillStyle = '#56705f'; g.beginPath(); g.moveTo(X(282), Y(0));
  for (let b = 282; b <= 342; b += 1) { const k = (b - 282) / 60; g.lineTo(X(b), Y(0.008 + 0.05 * Math.pow(Math.sin(Math.PI * k), 0.8) * (1 + 0.08 * Math.sin(b * 0.9)))); }
  g.lineTo(X(342), Y(0)); g.fill();
  // low shores all round: roofs + treeline
  for (let b = 0; b < 360; b += 0.35) {
    const e = 0.004 + rand() * 0.006 + (b > 250 ? 0.004 : 0);
    rect(b, b + 0.4, -0.01, e, rand() < 0.5 ? '#5d6f64' : '#6d7a78');
  }
  // downtown towers (NW), a few mid-rises east and on the south shore
  const towers = (b0, b1, n, e0, e1) => {
    for (let k = 0; k < n; k++) {
      const b = b0 + rand() * (b1 - b0), wd = 0.4 + rand() * 1.1, e = e0 + Math.pow(rand(), 1.6) * (e1 - e0);
      const c = ['#8795a3', '#9aa7b3', '#6f7f8f', '#b3bcc4', '#5f6f80'][Math.floor(rand() * 5)];
      rect(b, b + wd, -0.01, e, c);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = Y(e) + 3; y < Y(0); y += 4) g.fillRect(X(b) + 1, y, Math.max(1, X(b + wd) - X(b) - 2), 1);
      if (e > 0.045 && rand() < 0.5) rect(b + wd / 2 - 0.05, b + wd / 2 + 0.05, e, e + 0.008, c);
    }
  };
  towers(296, 332, 28, 0.016, 0.095);
  towers(304, 326, 12, 0.04, 0.08);
  towers(0, 25, 8, 0.008, 0.02);
  towers(70, 110, 9, 0.006, 0.02);
  // leaning stadium tower far to the north-east
  g.fillStyle = '#9aa3aa'; g.beginPath(); g.moveTo(X(21), Y(0)); g.lineTo(X(21.6), Y(0)); g.lineTo(X(20.6), Y(0.03)); g.lineTo(X(20.2), Y(0.029)); g.fill();
  g.fillStyle = '#aab2b8'; g.beginPath(); g.ellipse(X(21.8), Y(0.004), X(1.4) - X(0), Y(0) - Y(0.005), 0, Math.PI, TAU); g.fill();
}

function build(api) {
  const K = kit(api), { S, N, W2, R, pick } = K, { world, track, rnd } = api;
  const near = K.dist;
  const dry = (x, z, m = 4) => landSd(x, z, near(x, z)) < -m;
  const G = (x, z) => api.groundAt(x, z);

  K.water({ y: WATER, deep: '#1c4656', shallow: '#3d6f78', flow: [0.35, -0.3] });
  K.clouds(270, 20);
  K.panorama(paintMontreal, { haze: 0.38 });

  // ---- pits on the right of the start straight: pit lane, garages + glass upper floor + canopy, paddock units
  const pitIdx = K.span(K.idx(-40, -150), K.idx(24, 115));
  {
    K.pits(pitIdx, { lane: [13.6, 27.5] });
    // race control tower past the pit exit
    const f = K.frame(K.idx(28, 140), 34);
    K.box('solid', 12, 15, 12, f.x, f.y + 7.5, f.z, f.ry, '#dfe3e7');
    K.box('glass', 13, 4, 13, f.x, f.y + 17, f.z, f.ry, '#2f4d63');
    K.box('solid', 14, 0.5, 14, f.x, f.y + 19.2, f.z, f.ry, '#f4f6f8');
    api.block(f.x, f.z, 10);
    // paddock: hospitality units between the garages and the basin
    for (let k = 3; k < pitIdx.length - 3; k += 5) {
      const f2 = K.frame(pitIdx[k], R(53, 58)), c = pick(['#f4f4f4', '#1d1d1f', '#c8102e', '#1f4e9c', '#ff8200', '#bfc5cc', '#0b6e4f']);
      if (!dry(f2.x, f2.z, 8)) continue;
      K.box('solid', 13, 6.5, 9, f2.x, f2.y + 3.1, f2.z, f2.ry, c);
      K.box('glass', 13.2, 2, 9.2, f2.x, f2.y + 4.6, f2.z, f2.ry, '#1b2833');
      api.block(f2.x, f2.z, 9);
    }
  }

  // ---- grandstands: opposite the pits, the run to turn 1, outside the turn-2 hairpin, the hairpin, the final chicane
  K.stand(K.idx(4, 20), -(W2 + 14), 150, 14, { seat: '#c8102e' });
  K.stand(K.idx(-22, -115), -(W2 + 14), 90, 12, { seat: '#c8102e' });
  K.stand(K.idx(47, 320), -(W2 + 14), 110, 12, { roof: false, seat: '#2d5da8' });
  K.stand(K.idx(99, 495), -(W2 + 16), 70, 12, { seat: '#2d5da8', trim: '#1f4e9c' });
  K.stand(K.idx(-330, -1379), -(W2 + 16), 80, 12, { seat: '#e8e8e8', trim: '#1f4e9c' });
  K.stand(K.idx(-19, -270), -(W2 + 14), 70, 10, { roof: false, seat: '#c8102e' });
  K.flushCrowd();

  // ---- the welcome wall: outside of the final chicane exit, just in front of the ad boards
  {
    const i0 = K.idx(-43, -214), n = Math.round(78 / track.spacing), L = K.WALL + 0.45, pos = [], uv = [];
    for (let k = 0; k < n; k++) {
      const a = S[(i0 + k) % N], b = S[(i0 + k + 1) % N], P = (s, y) => [s.pos.x + s.right.x * L, s.pos.y + y, s.pos.z + s.right.z * L];
      const u0 = 1 - k / n, u1 = 1 - (k + 1) / n;
      pos.push(...P(a, -0.3), ...P(b, -0.3), ...P(b, 1.5), ...P(a, -0.3), ...P(b, 1.5), ...P(a, 1.5));
      uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const tex = api.canvasTex(4096, 96, (g, w, h) => {
      g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(20,20,20,${0.08 + Math.random() * 0.25})`; g.fillRect(Math.random() * w, h * 0.72 + Math.random() * h * 0.2, 30 + Math.random() * 260, 2 + Math.random() * 6); }
      g.fillStyle = '#16325c'; g.font = 'bold 64px "Arial Black", "Helvetica Neue", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('BIENVENUE  ・  WELCOME  ・  ようこそ', w / 2, h * 0.44, w - 200);
      g.fillStyle = '#c8102e'; g.fillRect(0, 4, w, 5);
    }, false);
    const wall = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
    wall.receiveShadow = true;
    world.add(wall);
  }

  // ---- rowing basin: lane buoys, finish tower, boathouse, a few shells gliding along
  const [bax, baz, bbx, bbz, bhw] = BASIN, bL = Math.hypot(bbx - bax, bbz - baz), bux = (bbx - bax) / bL, buz = (bbz - baz) / bL, bry = Math.atan2(-buz, bux);
  const basinAt = (t, off) => [bax + bux * t * bL - buz * off, baz + buz * t * bL + bux * off];
  {
    const buoys = [];
    for (let l = 0; l <= 6; l++) for (let t = 0.04; t < 0.96; t += 9 / bL) {
      const [x, z] = basinAt(t, -40.5 + l * 13.5);
      buoys.push([x, WATER + 0.1, z, 0, 0.35, 0.35, 0.35, (Math.round(t * bL / 9) % 10) ? '#f4f4f0' : '#ff6a13']);
    }
    K.inst(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), buoys, false);
    let [x, z] = basinAt(-0.035, 0);
    K.box('solid', 9, 14, 9, x, G(x, z) + 7, z, bry, '#e7e9ec');
    K.box('glass', 10, 3.2, 10, x, G(x, z) + 15.6, z, bry, '#2f4d63');
    K.box('solid', 11, 0.4, 11, x, G(x, z) + 17.4, z, bry, '#c8102e');
    api.block(x, z, 10);
    [x, z] = basinAt(0.88, -(bhw + 14));
    const by = G(x, z);
    K.box('solid', 60, 7, 14, x, by + 3.5, z, bry, '#9b3d2e');
    K.put('solid', new THREE.CylinderGeometry(0.01, 10.5, 4, 4, 1).rotateY(Math.PI / 4).scale(4.1, 1, 0.95), '#4a4f57', x, by + 9, z, bry);
    api.block(x, z, 32);
    // shells: hull + rowers baked into one small instanced mesh, moved every frame
    const parts = [new THREE.BoxGeometry(0.5, 0.25, 15)];
    for (let k = 0; k < 8; k++) parts.push(new THREE.BoxGeometry(0.4, 0.7, 0.3).translate(0, 0.45, -5.6 + k * 1.6));
    const shells = new THREE.InstancedMesh(mergeGeometries(parts.map(p => p.toNonIndexed())), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 5);
    shells.frustumCulled = false;   // they row the whole basin: the bounding sphere cached at the first frame would cull them
    const boats = [0, 1, 2, 3, 4].map(k => ({ t: rnd(), off: -33.75 + k * 13.5, v: R(4.5, 6) / bL * (k % 2 ? 1 : -1) }));
    boats.forEach((b, k) => shells.setColorAt(k, K.col.set(['#f7f3e8', '#e2c044', '#d3d8de', '#c8102e', '#f7f3e8'][k])));
    const dm = new THREE.Object3D();
    const move = dt => {
      boats.forEach((b, k) => {
        b.t = ((b.t + b.v * dt) % 1 + 1) % 1;
        const [x2, z2] = basinAt(0.06 + b.t * 0.88, b.off);
        dm.position.set(x2, WATER + 0.12, z2); dm.rotation.set(0, bry + Math.PI / 2 + (b.v > 0 ? 0 : Math.PI), 0); dm.updateMatrix();
        shells.setMatrixAt(k, dm.matrix);
      });
      shells.instanceMatrix.needsUpdate = true;
    };
    move(0);
    world.add(shells);
    api.onUpdate(move);
  }

  // ---- Biosphère: geodesic lattice (3/4 sphere) over a faint acrylic skin, on Île Sainte-Hélène
  {
    const [x, z] = BIO, gy = G(x, z), Rr = 38, cy = gy + 24, list = [];
    const e = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(Rr, 5), 0.5).attributes.position;
    for (let i = 0; i < e.count; i += 2) {
      const ay = e.getY(i), by2 = e.getY(i + 1);
      if (Math.min(ay, by2) < -23.5) continue;
      list.push([[x + e.getX(i), cy + ay, z + e.getZ(i)], [x + e.getX(i + 1), cy + by2, z + e.getZ(i + 1)], 0.42]);
    }
    const rr = Math.sqrt(Rr * Rr - 23.5 * 23.5);
    for (let k = 0; k < 64; k++) {   // bottom ring
      const a0 = k / 64 * TAU, a1 = (k + 1) / 64 * TAU;
      list.push([[x + Math.cos(a0) * rr, cy - 23.5, z + Math.sin(a0) * rr], [x + Math.cos(a1) * rr, cy - 23.5, z + Math.sin(a1) * rr], 0.9]);
    }
    K.beams(list, new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.6, roughness: 0.35 }), true);
    const skin = new THREE.Mesh(new THREE.SphereGeometry(Rr - 0.6, 40, 20, 0, TAU, 0, Math.acos(-23.5 / Rr)),
      new THREE.MeshStandardMaterial({ color: 0xbfd3de, transparent: true, opacity: 0.2, roughness: 0.15, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    skin.position.set(x, cy, z);
    world.add(skin);
    K.put('solid', new THREE.CylinderGeometry(32, 33, 2.4, 32, 1), '#b9bdc0', x, gy, z);
    api.block(x, z, 45);
  }

  // ---- casino (stepped former pavilion with white fins) + gold glass cube next door
  {
    const [x, z] = CASINO, gy = G(x, z), ry = 0.35, c = Math.cos(ry), sn = Math.sin(ry);
    for (let f = 0; f < 5; f++) {
      const w = 30 + f * 7, y = gy + 2.2 + f * 4.7;
      K.box('solid', w, 4.4, w, x, y, z, ry, f % 2 ? '#e9ecef' : '#cfd6dc');
      if (f > 1) for (let k = -w / 2 + 1.5; k < w / 2; k += 3) for (const s of [-1, 1]) {
        const o = s * (w / 2 + 0.6);
        K.box('solid', 0.35, 4.2, 1.4, x + c * k + sn * o, y, z - sn * k + c * o, ry, '#f7f8f9');
        K.box('solid', 1.4, 4.2, 0.35, x + c * o + sn * k, y, z - sn * o + c * k, ry, '#f7f8f9');
      }
    }
    api.block(x, z, 48);
    const qx = x + 30, qz = z - 85;
    K.box('glass', 30, 28, 30, qx, G(qx, qz) + 14, qz, ry, '#e0b75a');
    api.block(qx, qz, 24);
  }

  // ---- stacked-cube housing on the Cité du Havre pier (west, across the channel)
  {
    const [ax, az, bx, bz] = HAVRE, ry = Math.atan2(-(bz - az), bx - ax), c = Math.cos(ry), sn = Math.sin(ry);
    const ox = ax + (bx - ax) * 0.55, oz = az + (bz - az) * 0.55, gy = G(ox, oz);
    for (let k = 0; k < 170; k++) {
      const u = R(-140, 140), peak = Math.max(...[-95, 5, 100].map(p => 1 - Math.abs(u - p) / 55)), lv = Math.floor(rnd() * (1 + Math.max(0, peak) * 11));
      const v = R(-14, 14) * (1 - lv / 13), turn = rnd() < 0.5 ? 0 : Math.PI / 2;
      K.box('solid', 11.7, 3, 5.3, ox + c * u + sn * v, gy + 1.5 + lv * 3, oz - sn * u + c * v, ry + turn, pick(['#cfc7b9', '#bfb6a8', '#d8d1c4', '#a9a296']));
    }
    for (let u = -140; u <= 140; u += 35) api.block(ox + c * u, oz - sn * u, 24);
  }

  // ---- steel truss bridge to the north: main hump over the channel off Montreal, through-truss across the river
  {
    const A = [-350, -2250], B = [1300, -1350], deck = 44, dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L;
    const P = (t, sd, y) => [A[0] + dx * t + nx * sd, y, A[1] + dz * t + nz * sd];
    const top = t => 9 + 42 * Math.pow(Math.sin(Math.PI * clamp((t - 0.05) / 0.13, 0, 1)), 0.7);
    const list = [], n = Math.round(L / 18);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, h0 = deck + top(t0), h1 = deck + top(t1);
      for (const sd of [-9, 9]) {
        list.push([P(t0, sd, h0), P(t1, sd, h1), 0.9], [P(t0, sd, deck - 3), P(t1, sd, deck - 3), 1], [P(t0, sd, deck - 3), P(t0, sd, h0), 0.55]);
        list.push(k % 2 ? [P(t0, sd, deck - 3), P(t1, sd, h1), 0.5] : [P(t0, sd, h0), P(t1, sd, deck - 3), 0.5]);
      }
      list.push([P(t0, -9, h0), P(t0, 9, h0), 0.45]);
    }
    K.beams(list, new THREE.MeshStandardMaterial({ color: 0x5f7f71, metalness: 0.4, roughness: 0.55 }));
    const ry = Math.atan2(-dz, dx);
    K.box('solid', L, 1.4, 19, A[0] + dx / 2, deck - 0.2, A[1] + dz / 2, ry, '#7d8388');
    for (let t = 0.02; t < 1; t += 85 / L) {
      if (t > 0.07 && t < 0.16) continue;   // main span: no piers in the channel
      const [x, , z] = P(t, 0, 0), gy = Math.min(G(x, z), WATER) - 1, h = deck - 3 - gy;
      K.box('solid', 7, h, 22, x, gy + h / 2, z, ry, '#a39c90');
    }
    for (const t of [0.05, 0.18]) { const [x, , z] = P(t, 0, 0), gy = Math.min(G(x, z), WATER) - 1, h = deck + 4 - gy; K.box('solid', 12, h, 26, x, gy + h / 2, z, ry, '#9a9388'); }
  }

  // ---- far shores: low city blocks on the Montreal side (west) and the south shore (east)
  {
    for (let k = 0, tries = 0; k < 110 && tries < 3000; tries++) {
      const z = R(-2050, 700), x = -1300 - 0.25 * (z + 800) - R(60, 520);
      if (x < -1860 || westShore(x, z) > -40) continue;
      const w = R(16, 40), d = R(16, 40);
      K.tower('win', w, R(9, 38) * (z < -1300 ? 1.6 : 1), d, x, G(x, z) - 1, z, R(-0.3, 0.3), pick(['#e6e1d8', '#d5d7da', '#c9b8a6', '#b9c3cc']));
      api.block(x, z, Math.hypot(w, d) / 2); k++;
    }
    for (let k = 0, tries = 0; k < 80 && tries < 3000; tries++) {
      const z = R(-1700, 900), x = R(1120, 1430);
      if (eastShore(x, z) > -40) continue;
      const w = R(14, 30), d = R(14, 30);
      K.tower('win', w, R(7, 24), d, x, G(x, z) - 1, z, R(-0.2, 0.2), pick(['#e6e1d8', '#d5d7da', '#c9b8a6']));
      api.block(x, z, Math.hypot(w, d) / 2); k++;
    }
    const wt = api.canvasTex(256, 256, (g, w, h) => paintWindows(g, w, h, { wall: '#d8d6d0' }));
    K.flush('win', new THREE.MeshStandardMaterial({ map: wt, vertexColors: true, roughness: 0.75 }));
  }

  // ---- trees: parkland all over the islands (denser near the course), poplar rows along the basin, far shores
  {
    const list = [], leaf = () => K.col.setHSL(R(0.22, 0.31), R(0.4, 0.6), R(0.17, 0.27)).getHex(), b = track.bounds;
    for (let tries = 0, n = 0; n < 1500 && tries < 40000; tries++) {
      const x = R(b.minX - 120, b.maxX + 120), z = R(b.minZ - 120, b.maxZ + 120), d = near(x, z);
      if (d > 110 && rnd() < 0.55) continue;
      const clump = Math.sin(x * 0.02 + 1) * Math.cos(z * 0.017) + 0.5 * Math.sin(x * 0.051 - z * 0.043);
      if (rnd() > 0.25 + 0.75 * smooth(-0.3, 0.6, clump)) continue;
      const ls = landSd(x, z, d);   // keep the shores fairly open so the water reads from the road
      if (ls > -5 || (ls > -16 && rnd() < 0.75) || !K.ok(x, z, 3.2, true)) continue;
      if (sdStrip(x, z, ...BASIN) < 60 && (x - bax) * -buz + (z - baz) * bux > 0) continue;   // open lawn: basin in view from the back straight
      list.push([x, z, rnd() < 0.7 ? 'broad' : 'round', R(0.8, 1.3), leaf()]); n++;
    }
    for (let t = 0.03; t < 0.97; t += 11 / bL) {   // poplars lining the far (west) side of the basin
      const [x, z] = basinAt(t, -(bhw + 9 + R(-1, 1)));
      if (dry(x, z, 2) && K.ok(x, z, 2)) list.push([x, z, 'poplar', R(0.9, 1.15), K.col.setHSL(R(0.24, 0.3), 0.45, R(0.2, 0.26)).getHex()]);
    }
    const [hx, hz, rx, rz] = HELENE;
    for (let tries = 0, n = 0; n < 380 && tries < 5000; tries++) {
      const x = hx + R(-rx, rx), z = hz + R(-rz, rz);
      if (!dry(x, z, 6) || !K.ok(x, z, 3)) continue;
      list.push([x, z, rnd() < 0.25 ? 'pine' : 'broad', R(1, 1.5), leaf()]); n++;
    }
    for (let tries = 0, n = 0; n < 420 && tries < 6000; tries++) {
      const x = rnd() < 0.55 ? R(-1860, -1000) : R(1080, 1440), z = R(-2050, 1100);
      if (!dry(x, z, 10) || !K.ok(x, z, 4)) continue;
      list.push([x, z, 'broad', R(1.4, 2), leaf()]); n++;
    }
    K.trees(list);
  }

  K.flush('flat', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }), false).receiveShadow = true;
  K.flush('solid', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  K.flush('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.7 }));
}

export default { base: 'forest', env: ENV, baseBuild: false, build };
