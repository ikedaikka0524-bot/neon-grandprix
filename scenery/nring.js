// Nürburgring GP: rolling Eifel spruce hills under an overcast sky, the Nürburg castle ruin (round keep + broken
// curtain walls) on its hill beyond turn 1 with a half-timbered, red-roofed village below it, a modern main grandstand
// facing the pits, a turn-1 stand and wind turbines on the far ridges.
// Also exports the small kit shared by the other real-circuit sceneries (suzuka.js, spa.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRACK_BY_ID } from '../tracks.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
export function noise(x, z) {   // value noise 0..1
  const xi = Math.floor(x), zi = Math.floor(z), u = smooth(0, 1, x - xi), v = smooth(0, 1, z - zi);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
export const fbm = (x, z) => noise(x, z) * 0.55 + noise(x * 2.03 + 17, z * 2.03 - 9) * 0.3 + noise(x * 4.1 - 31, z * 4.1 + 5) * 0.15;

// The centreline resampled like game.js does (1200 samples by arc length, polyline approximation), available before
// build(): env.terrain.height() uses it to flatten pads where build() later puts buildings.
export function course(id) {
  const P = TRACK_BY_ID[id].points, n = P.length, L = [0];
  for (let i = 1; i <= n; i++) L.push(L[i - 1] + Math.hypot(P[i % n][0] - P[i - 1][0], P[i % n][2] - P[i - 1][2]));
  const N = 1200, X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N);
  for (let i = 0, k = 0; i < N; i++) {
    const d = i / N * L[n];
    while (L[k + 1] < d) k++;
    const a = P[k], b = P[(k + 1) % n], t = (d - L[k]) / (L[k + 1] - L[k] || 1);
    X[i] = lerp(a[0], b[0], t); Y[i] = lerp(a[1], b[1], t); Z[i] = lerp(a[2], b[2], t);
  }
  const at = (i, lat = 0) => {   // point `lat` m right of sample i
    i = ((Math.round(i) % N) + N) % N;
    const a = (i + N - 2) % N, b = (i + 2) % N, dx = X[b] - X[a], dz = Z[b] - Z[a], l = Math.hypot(dx, dz) || 1;
    return { x: X[i] - dz / l * lat, y: Y[i], z: Z[i] + dx / l * lat, tx: dx / l, tz: dz / l };
  };
  // turning per sample (+ = left, like game.js), then the sharpest turn within ±25 samples
  const head = i => { const p = at(i); return Math.atan2(p.tx, p.tz); }, turn = new Float32Array(N), sharp = new Float32Array(N);
  for (let i = 0; i < N; i++) { const d = head(i + 4) - head(i - 4); turn[i] = Math.atan2(Math.sin(d), Math.cos(d)); }
  for (let i = 0; i < N; i++) { let m = 0; for (let k = -25; k <= 25; k += 5) { const c = turn[(i + k + N) % N]; if (Math.abs(c) > Math.abs(m)) m = c; } sharp[i] = m; }
  // nearest sample via a lazily built 25 m grid (terrain height functions run per ground vertex)
  let grid = null, gx0 = 0, gz0 = 0, gw = 0, gh = 0;
  const G = 25, brute = (x, z) => { let b = Infinity, bi = 0; for (let i = 0; i < N; i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < b) { b = d; bi = i; } } return bi; };
  const nearest = (x, z) => {
    if (!grid) {
      gx0 = Math.min(...X) - 1000; gz0 = Math.min(...Z) - 1000; gw = Math.ceil((Math.max(...X) + 1000 - gx0) / G); gh = Math.ceil((Math.max(...Z) + 1000 - gz0) / G);
      grid = new Uint16Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) grid[j * gw + i] = brute(gx0 + (i + 0.5) * G, gz0 + (j + 0.5) * G);
    }
    const i = Math.floor((x - gx0) / G), j = Math.floor((z - gz0) / G);
    return i < 0 || j < 0 || i >= gw || j >= gh ? brute(x, z) : grid[j * gw + i];
  };
  // 0..1: how much (x, z) lies on the inside of a corner (keeps hills off the chase camera's sightline)
  const inside = (x, z) => {
    const i = nearest(x, z), p = at(i), lat = (x - p.x) * -p.tz + (z - p.z) * p.tx, m = sharp[i];
    return Math.sign(lat) === -Math.sign(m) ? smooth(0.08, 0.3, Math.abs(m)) : 0;
  };
  return { N, X, Y, Z, at, nearest, inside };
}
// flat pads for env.terrain.height: capsule a-b of radius r at height y (-0.2 = the road shelf), blending back over `blend` m
export const pad = (a, b, r, y = -0.2, blend = 50) => ({ ax: a.x, az: a.z, bx: b.x, bz: b.z, r, y, blend });
export function applyPads(pads, x, z, y) {
  for (const p of pads) {
    const ex = p.bx - p.ax, ez = p.bz - p.az, t = clamp(((x - p.ax) * ex + (z - p.az) * ez) / (ex * ex + ez * ez || 1), 0, 1);
    const d = Math.hypot(x - p.ax - ex * t, z - p.az - ez * t);
    if (d < p.r + p.blend) y = lerp(y, p.y, 1 - smooth(p.r, p.r + p.blend, d));
  }
  return y;
}

// ---------------------------------------------------------------- canvas painters shared by the circuits
// grass ground tile: base colour + noise, soft patches and blade strokes picked from `tints` ([r, g, b])
export const paintGrass = (base, tints, flowers = []) => (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = () => tints[Math.floor(Math.random() * tints.length)];
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${t()},0.25)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 1200; i++) { g.fillStyle = `rgba(${t()},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3); }
  for (let i = 0; i < flowers.length * 12; i++) { g.fillStyle = flowers[i % flowers.length]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
};
export function paintStone(g, w, h, base = [150, 144, 132], rows = 8) {
  g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, w, h);
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let x = -((r * 37) % 40);
    while (x < w) {
      const bw = 26 + ((x * 7 + r * 13) % 23), k = 0.8 + ((x * 13 + r * 29) % 17) / 55;
      g.fillStyle = `rgb(${base.map(c => c * k | 0)})`; g.fillRect(x + 1, r * rh + 1, bw - 2, rh - 2);
      x += bw;
    }
  }
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
export function paintCrowd(g, w, h) {   // 16 x 8 spectators
  g.fillStyle = '#3a4150'; g.fillRect(0, 0, w, h);
  const shirts = ['#e63946', '#f1faee', '#1d3557', '#ffb703', '#2a9d8f', '#e76f51', '#8ecae6', '#ffffff', '#222222', '#d62828', '#fcbf49', '#6a4c93'];
  const cw = w / 16, rh = h / 8;
  for (let r = 0; r < 8; r++) for (let k = 0; k < 16; k++) {
    const x = k * cw, y = r * rh;
    g.fillStyle = '#596274'; g.fillRect(x + 1, y + rh * 0.62, cw - 2, rh * 0.3);   // seat
    if (Math.random() < 0.14) continue;
    g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)]; g.fillRect(x + cw * 0.18, y + rh * 0.38, cw * 0.64, rh * 0.52);
    g.fillStyle = ['#f1c9a5', '#d8a47f', '#8d5b3f', '#f6dcc2'][Math.floor(Math.random() * 4)];
    g.beginPath(); g.arc(x + cw / 2, y + rh * 0.26, cw * 0.2, 0, TAU); g.fill();
    if (Math.random() < 0.3) { g.fillStyle = shirts[Math.floor(Math.random() * shirts.length)]; g.fillRect(x + cw * 0.28, y + rh * 0.02, cw * 0.44, rh * 0.14); }   // caps
  }
}
export function paintGarages(g, w, h) {   // 4 bays of 8 m x 5 m: open or shuttered pit garages
  g.fillStyle = '#d9dde3'; g.fillRect(0, 0, w, h);
  const bw = w / 4, team = ['#c1121f', '#1d4ed8', '#f59e0b', '#10b981'];
  for (let b = 0; b < 4; b++) {
    const x = b * bw + bw * 0.08, dw = bw * 0.84, top = h * 0.16;
    if (b % 2) {
      g.fillStyle = '#1b1f27'; g.fillRect(x, top, dw, h - top);
      g.fillStyle = '#e9edf2'; g.fillRect(x + 4, top + 3, dw - 8, 4);   // ceiling light
      g.fillStyle = team[b]; g.fillRect(x + dw * 0.2, h * 0.78, dw * 0.6, h * 0.14);   // car in the box
      g.fillStyle = '#50596a'; g.fillRect(x + dw * 0.08, h * 0.45, dw * 0.1, h * 0.55); g.fillRect(x + dw * 0.82, h * 0.45, dw * 0.1, h * 0.55);
    } else {
      g.fillStyle = '#8b939f'; g.fillRect(x, top, dw, h - top);
      g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = top; y < h; y += 5) g.fillRect(x, y, dw, 1);
    }
    g.fillStyle = team[b]; g.fillRect(x, h * 0.04, dw, h * 0.08);   // team colour band
  }
}
export function paintWindows(g, w, h, frame = '#aeb6c0', glass = ['#27405a', '#35506b', '#1f3347', '#4a6a86']) {   // 4 x 2 panes
  g.fillStyle = frame; g.fillRect(0, 0, w, h);
  const cw = w / 4, rh = h / 2;
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
    const gr = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh), c = glass[Math.floor(Math.random() * glass.length)];
    gr.addColorStop(0, '#8fb0c8'); gr.addColorStop(0.35, c); gr.addColorStop(1, c);
    g.fillStyle = gr; g.fillRect(k * cw + 3, r * rh + 4, cw - 6, rh - 10);
  }
}

// ======================================================================================
// Kit: merged vertex-coloured material buckets (one draw call per material per 600 m cell, so far parts are culled),
// chunked instancing, trees, grandstands, pit buildings, a sign atlas, a cloud deck.
// ======================================================================================
export function kit(api, CELL = 600) {
  const { world, track, rnd } = api, S = track.samples, N = track.N, W2 = track.width / 2;
  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const mats = {   // hand-made triangles have mixed winding: flat-shaded solids render both sides
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, side: THREE.DoubleSide }),
    shiny: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.2, metalness: 0.65 }),
  };
  const planar = {}, buckets = new Map(), noShadow = new Set(), KEEP = ['position', 'normal', 'uv', 'color'];

  function planarUV(g, tile) {   // world-space UVs per triangle along its dominant axis (stone, concrete)
    const p = g.attributes.position, uv = new Float32Array(p.count * 2), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      const n = b.sub(a).cross(c.sub(a)), ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z), top = ay > ax && ay > az;
      for (let k = 0; k < 3; k++) {
        const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
        uv[(i + k) * 2] = (top ? x : ax > az ? z : x) / tile;
        uv[(i + k) * 2 + 1] = (top ? z : y) / tile;
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  // nearest sample: a lazily filled 20 m grid gives a candidate, refined over its neighbours (scatter loops call this a lot)
  const cellIdx = new Map();
  const nearI = (x, z) => {
    const key = Math.floor(x / 20) * 100003 + Math.floor(z / 20);
    let c = cellIdx.get(key);
    if (c === undefined) {
      const cx = (Math.floor(x / 20) + 0.5) * 20, cz = (Math.floor(z / 20) + 0.5) * 20;
      let bd = Infinity;
      for (let i = 0; i < N; i += 3) { const p = S[i].pos, d = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (d < bd) { bd = d; c = i; } }
      cellIdx.set(key, c);
    }
    let bd = Infinity, bi = c;
    for (let k = -12; k <= 12; k++) { const i = (c + k + N) % N, p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    return [Math.sqrt(bd), bi];
  };
  // corner side per sample (sign of the sharpest nearby curvature, 0 = straight): tall things stay off corner insides
  const corner = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -30; k <= 30; k += 3) { const c = S[(i + k + N) % N].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
    corner[i] = Math.abs(m) > 1 / 160 ? Math.sign(m) : 0;
  }
  const tallOk = (x, z, d, i, gap = 30) => {
    if (d >= W2 + gap || !corner[i]) return true;
    const s = S[i];
    return Math.sign((x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z) === corner[i];
  };
  function bake(parts, cols) {   // merge parts with per-part vertex colours (instance colour multiplies them)
    return mergeGeometries(parts.map((g, k) => {
      g = g.index ? g.toNonIndexed() : g;
      g.deleteAttribute('uv');
      const n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set(cols[k], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    }));
  }

  const K = {
    mats, rnd, S, N, W2, nearI, tallOk, bake,
    pick: a => a[Math.floor(rnd() * a.length)],
    range: (a, b) => a + (b - a) * rnd(),
    mat(key, m, tile) { mats[key] = m; if (tile) planar[key] = tile; return m; },
    tex: (w, h, draw, repeat = true) => api.canvasTex(w, h, draw, repeat),
    noShadow: key => noShadow.add(key),
    M: (x = 0, y = 0, z = 0, ry = 0, s = 1) => new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromAxisAngle(UP, ry), SC.set(s, s, s)),
    // add a world-space geometry to material bucket `key`, tinted `color`
    add(key, g, color = '#ffffff') {
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      if (planar[key]) planarUV(g, planar[key]);
      else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      col.set(color);
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      g.clearGroups();
      g.computeBoundingBox();
      const c = g.boundingBox.getCenter(V), id = `${key}|${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`;
      if (!buckets.has(id)) buckets.set(id, { key, geos: [] });
      buckets.get(id).geos.push(g);
      return g;
    },
    // frame(x, y, z, ry) -> put(key, localGeometry, color)
    frame(x, y, z, ry = 0, s = 1) { const m = K.M(x, y, z, ry, s); return (key, g, color) => K.add(key, g.applyMatrix4(m), color); },
    flush() {
      for (const { key, geos } of buckets.values()) {
        const m = new THREE.Mesh(mergeGeometries(geos), mats[key]);
        m.castShadow = !noShadow.has(key); m.receiveShadow = true;
        world.add(m);
      }
      buckets.clear();
    },
    // one InstancedMesh per cell from [matrix, color?] items
    instanced(geo, mat, items, { shadow = true, cell = CELL } = {}) {
      const cells = new Map(), p = new THREE.Vector3(), out = [];
      for (const it of items) {
        p.setFromMatrixPosition(it[0]);
        const id = `${Math.floor(p.x / cell)},${Math.floor(p.z / cell)}`;
        if (!cells.has(id)) cells.set(id, []);
        cells.get(id).push(it);
      }
      for (const list of cells.values()) {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([m, c], i) => { im.setMatrixAt(i, m); if (c) im.setColorAt(i, c); });
        im.castShadow = shadow; im.receiveShadow = true;
        im.computeBoundingSphere();
        world.add(im);
        out.push(im);
      }
      return out;
    },

    // ---------------------------------------------------------------- geometry helpers (base-anchored)
    box: (w, h, d, x = 0, y = 0, z = 0, ry = 0) => new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(ry).translate(x, y, z),
    cyl: (rt, rb, h, seg, x = 0, y = 0, z = 0, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open).translate(x, y + h / 2, z),
    cone: (r, h, seg, x = 0, y = 0, z = 0, ry = 0) => new THREE.ConeGeometry(r, h, seg).rotateY(ry).translate(x, y + h / 2, z),
    tris(pts) {   // flat list of [x,y,z] triangle corners
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.computeVertexNormals();
      return g;
    },
    // gable roof: eaves at x = ±w/2 (y 0), ridge along z at height h, length d
    gable(w, h, d) {
      const a = [-w / 2, 0, -d / 2], b = [w / 2, 0, -d / 2], c = [0, h, -d / 2], a2 = [-w / 2, 0, d / 2], b2 = [w / 2, 0, d / 2], c2 = [0, h, d / 2];
      return K.tris([a, c, c2, a, c2, a2, b, b2, c2, b, c2, c, a, b, c, a2, c2, b2]);
    },
    // Japanese hip roof (irimoya-ish silhouette): concave slopes, eave corners swept up; ridge along x
    jroof(w, d, h, lift = 0.8, rows = 4, cols = 6) {
      const rl = Math.max(0.5, w - d * 0.9) / 2, pts = [], eaveY = u => lift * (2 * u - 1) ** 4;
      const face = (e0, e1, r0, r1) => {   // eave edge e0->e1, ridge edge r0->r1 ([x, z])
        const P = (u, t) => {
          const ey = eaveY(u);
          return [lerp(lerp(e0[0], e1[0], u), lerp(r0[0], r1[0], u), t), ey + (h - ey) * t ** 1.7, lerp(lerp(e0[1], e1[1], u), lerp(r0[1], r1[1], u), t)];
        };
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
          const u0 = i / cols, u1 = (i + 1) / cols, t0 = j / rows, t1 = (j + 1) / rows;
          pts.push(P(u0, t0), P(u1, t0), P(u1, t1), P(u0, t0), P(u1, t1), P(u0, t1));
        }
      };
      const x = w / 2, z = d / 2;
      face([-x, z], [x, z], [-rl, 0], [rl, 0]);
      face([x, -z], [-x, -z], [rl, 0], [-rl, 0]);
      face([x, z], [x, -z], [rl, 0], [rl, 0]);
      face([-x, -z], [-x, z], [-rl, 0], [-rl, 0]);
      return K.tris(pts);
    },
    // box whose side UVs tile a facade texture (tw x th m per tile, whole tiles across)
    facade(w, h, d, tw, th) {
      const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
      [d, d, 0, 0, w, w].forEach((fw, f) => {
        const u = fw ? Math.max(1, Math.round(fw / tw)) : 0;
        for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * u, fw ? uv.getY(i) * h / th : 0); }
      });
      return g.translate(0, h / 2, 0);
    },
    // plane (facing +Z) with its texture repeated u x v times
    plane(w, h, u = 1, v = 1) {
      const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
      return g;
    },

    // ---------------------------------------------------------------- placement
    // frame at sample i, `lat` m right of the centreline (negative = left), local -Z facing the track
    beside(i, lat, y) {
      const s = S[((Math.round(i) % N) + N) % N], sg = Math.sign(lat) || 1;
      const x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat;
      return { x, z, ry: Math.atan2(s.right.x * sg, s.right.z * sg), y: y ?? api.groundAt(x, z) };
    },
    // is the rectangle (local x in ±w/2, z in [0, d]) of frame p free? then reserve it
    claim(p, w, d, pad = 2) {
      const ax = Math.cos(p.ry), az = -Math.sin(p.ry), bx = Math.sin(p.ry), bz = Math.cos(p.ry), r = Math.min(w, d) / 2 + pad;
      const nx = Math.max(1, Math.ceil(w / (r * 1.4))), pts = [];
      for (let k = 0; k <= nx; k++) { const lx = (w / 2 - r + pad) * (2 * k / nx - 1); pts.push([p.x + ax * lx + bx * d / 2, p.z + az * lx + bz * d / 2]); }
      if (!pts.every(([x, z]) => api.isFree(x, z, r - pad - 1.5))) return false;   // slack for slightly curved straights
      for (const [x, z] of pts) api.block(x, z, r);
      return true;
    },

    // ---------------------------------------------------------------- trees
    // stacked-cone spruce (trunk baked brown, foliage white so the instance colour tints it)
    spruce(tiers = 3, seg = 5, slim = 1, trunk = true) {
      const parts = trunk ? [K.cyl(0.18, 0.3, 2.4, 3, 0, 0, 0, true)] : [], cols = trunk ? [[0.55, 0.42, 0.33]] : [];
      for (let t = 0; t < tiers; t++) {
        const r = (2.5 - t * 0.62) * slim, h = 4.2 - t * 0.5;
        parts.push(new THREE.ConeGeometry(r, h, seg, 1, true).translate(0, (trunk ? 1.3 : 0.3) + t * 2.2 + h / 2, 0)); cols.push([1, 1, 1]);
      }
      return bake(parts, cols);
    },
    leafy(detail = 2) {
      const parts = [K.cyl(0.2, 0.32, 2.6, 4, 0, 0, 0, true), new THREE.IcosahedronGeometry(2.4, 0).scale(1, 0.85, 1).translate(0, 4.1, 0)], cols = [[0.55, 0.42, 0.33], [1, 1, 1]];
      if (detail > 1) { parts.push(new THREE.IcosahedronGeometry(1.6, 0).translate(1.1, 5.2, -0.4)); cols.push([0.92, 0.95, 0.9]); }
      return bake(parts, cols);
    },
    treeMat: () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }),
    // scatter trees around the course: density(x, z, dist, nearestSample) 0..1, kind(x, z, d) -> index into geos, color(x, z, kind) -> Color
    trees({ n, pad = 500, geos, mat = K.treeMat(), density, kind = () => 0, color, size = () => 0.8 + rnd() * 0.6, shadowNear = 70, tries = 14 }) {
      const b = track.bounds, lists = geos.map(() => ({ near: [], far: [] })), dm = new THREE.Object3D();
      let placed = 0;
      for (let t = 0; t < n * tries && placed < n; t++) {
        const x = b.minX - pad + rnd() * (b.maxX - b.minX + 2 * pad), z = b.minZ - pad + rnd() * (b.maxZ - b.minZ + 2 * pad);
        const [d, i] = nearI(x, z);
        if (d > pad || d < W2 + 14 || rnd() > density(x, z, d, i)) continue;
        if (!tallOk(x, z, d, i) || !api.isFree(x, z, 2.2)) continue;
        const k = kind(x, z, d), s = size(x, z, d, k);
        dm.position.set(x, api.groundAt(x, z) - 0.3, z);
        dm.rotation.set((rnd() - 0.5) * 0.06, rnd() * TAU, (rnd() - 0.5) * 0.06);
        dm.scale.set(s, s * (0.85 + rnd() * 0.35), s);
        dm.updateMatrix();
        lists[k][d < W2 + shadowNear ? 'near' : 'far'].push([dm.matrix.clone(), color(x, z, k).clone()]);
        placed++;
      }
      geos.forEach((g, k) => {
        K.instanced(g, mat, lists[k].near, { shadow: true, cell: 400 });
        K.instanced(g, mat, lists[k].far, { shadow: false, cell: 800 });
      });
      return placed;
    },

    // ---------------------------------------------------------------- common buildings (local frames: front at z = 0 facing -Z)
    grandstand(put, len, { rows = 10, roof = true, fascia = '#d7263d', conc = '#b9bcc4', lift = 1.4 } = {}) {
      if (!mats.crowd) K.mat('crowd', new THREE.MeshStandardMaterial({ map: K.tex(256, 128, paintCrowd), vertexColors: true, roughness: 0.9 }));
      const D = rows * 0.85, H = lift + rows * 0.48, x = len / 2;
      put('solid', K.box(len, lift, 0.5, 0, 0, 0.25), conc);
      put('solid', K.tris([[-x, lift, 0.5], [x, lift, 0.5], [x, H, D], [-x, lift, 0.5], [x, H, D], [-x, H, D],
        [-x, 0, D], [x, H, D], [x, 0, D], [-x, 0, D], [-x, H, D], [x, H, D],
        [-x, 0, 0.5], [-x, lift, 0.5], [-x, H, D], [-x, 0, 0.5], [-x, H, D], [-x, 0, D],
        [x, 0, 0.5], [x, lift, 0.5], [x, H, D], [x, 0, 0.5], [x, H, D], [x, 0, D]]), conc);
      const slope = Math.hypot(D - 0.5, H - lift);
      put('crowd', K.plane(len, slope, len / 9.6, rows / 8).rotateY(Math.PI).rotateX(Math.atan2(D - 0.5, H - lift))
        .translate(0, (lift + H) / 2 + 0.1, (0.5 + D) / 2 - 0.06));
      put('solid', K.box(len, 2.2, 0.5, 0, H, D + 0.25), conc);   // back wall above the top row
      if (roof) {
        const rh = H + 4.5;
        put('solid', K.box(len + 3, 0.4, D + 4, 0, rh, D / 2 - 1.2), '#e4e8ee');
        put('solid', K.box(len + 3, 1.1, 0.3, 0, rh - 0.5, -3.1), fascia);
        const n = Math.max(1, Math.round(len / 18));
        for (let k = 0; k <= n; k++) put('solid', K.box(0.5, rh, 0.5, -x + len * k / n, 0, D + 0.8), '#9aa1ab');
      }
      return { D, H };
    },
    pits(put, len, { h = 9, depth = 16, accent = '#d7263d', tower = true, sign } = {}) {
      if (!mats.garage) K.mat('garage', new THREE.MeshStandardMaterial({ map: K.tex(512, 80, paintGarages), vertexColors: true, roughness: 0.6 }));
      put('solid', K.box(len, h, depth, 0, 0, depth / 2), '#eef0f3');
      put('garage', K.plane(len, 5, len / 32, 1).rotateY(Math.PI).translate(0, 2.5, -0.03));
      put('shiny', K.box(len - 2, 2.6, 0.4, 0, 5.6, -0.1), '#2a4a66');
      put('solid', K.box(len + 4, 0.5, depth + 3, 0, h, depth / 2 - 1.5), '#c9ced6');
      put('solid', K.box(len + 4, 0.8, 0.3, 0, h - 0.2, -3.1), accent);
      if (tower) {
        put('solid', K.box(26, 1, 14, 0, h + 0.5, 7), '#eef0f3');
        put('shiny', K.box(24, 3.4, 12, 0, h + 1.5, 7), '#1f3a55');
        put('solid', K.box(27, 0.6, 15, 0, h + 4.9, 7), '#dfe3e8');
        if (sign) put('sign', sign(24, 3).translate(0, h + 7, 1.5));
      }
    },
    // one atlas of text boards: signs(list)(k)(w, h) -> plane facing -Z (reads correctly from the track side)
    signs(list) {
      const n = list.length, tex = K.tex(1024, 128 * n, (g, w) => list.forEach(([txt, bg, fg = '#fff'], k) => {
        g.fillStyle = bg; g.fillRect(0, k * 128, w, 128);
        g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, k * 128 + 8, w, 6); g.fillRect(0, k * 128 + 114, w, 6);
        g.fillStyle = fg; g.font = 'bold 76px "Hiragino Sans","Yu Gothic","Meiryo",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, w / 2, k * 128 + 66, w - 60);
      }), false);
      K.mat('sign', new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.6, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: api.night ? 0.8 : 0.12 }));
      return k => (w, h) => {
        const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (k + 1 - uv.getY(i)) / n);
        return g.rotateY(Math.PI);
      };
    },
    // drifting cloud deck (fog fades its edge)
    clouds({ y = 260, color = '#ffffff', alpha = 0.5, blobs = 22, speed = 1 } = {}) {
      const tex = K.tex(512, 512, (g, w, h) => {
        for (let c = 0; c < blobs; c++) {
          const ox = rnd() * w, oy = rnd() * h, n = 5 + Math.floor(rnd() * 9), sp = 18 + rnd() * 46;
          for (let k = 0; k < n; k++) {
            const x = ox + (rnd() - 0.5) * sp * 2, yy = oy + (rnd() - 0.5) * sp * 0.7, r = 12 + rnd() * 30;
            for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
              const gr = g.createRadialGradient(x + dx, yy + dy, 0, x + dx, yy + dy, r);
              gr.addColorStop(0, `rgba(255,255,255,${alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
              g.fillStyle = gr; g.fillRect(x + dx - r, yy + dy - r, 2 * r, 2 * r);
            }
          }
        }
      });
      tex.repeat.set(4, 4);
      const b = track.bounds, m = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false }));
      m.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
      m.renderOrder = -5;
      world.add(m);
      let t = 0;
      api.onUpdate(dt => { t += dt * speed; tex.offset.set(t * 0.0012, t * 0.0005); });
      return m;
    },
  };
  return K;
}

// ======================================================================================
// Nürburgring
// ======================================================================================
const C = course('nring'), W2 = 7;
const CASTLE = { x: -250, z: -760, top: 72, s: 1.5 };   // castle drawn at 1.5x so it reads from the track
const PADS = [pad(C.at(1150), C.at(75), W2 + 62)];   // paddock: pits + grandstands along the start straight
function height(x, z, y, dist) {
  y += (fbm(x / 240 + 3, z / 240 - 7) - 0.42) * 46 * smooth(W2 + 30, W2 + 200, dist);   // rolling Eifel ridges
  y = applyPads(PADS, x, z, y);
  // the castle hill: a flat-topped cone, faded out at its rim (no step) and near the road (it must not bank over the barriers)
  const dc = Math.hypot(x - CASTLE.x, z - CASTLE.z), k = (1 - smooth(225, 270, dc)) * smooth(W2 + 14, W2 + 40, dist);
  if (k > 0) y = lerp(y, Math.max(y, CASTLE.top * (1 - smooth(58, 265, dc)) + (dc > 62 ? (noise(x / 30, z / 30) - 0.5) * 6 : 0)), k);
  return y;
}

function paintTimber(g, w, h) {   // 4 m x 3 m half-timbered panel: plaster, dark oak frame + braces, one window
  g.fillStyle = '#f2ead8'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = 9, oak = '#4a2f1f';
  g.fillStyle = oak;
  g.fillRect(0, 0, w, t); g.fillRect(0, h - t, w, t); g.fillRect(0, 0, t, h); g.fillRect(w / 2 - t / 2, 0, t, h);
  g.fillRect(0, h * 0.55, w, t * 0.8);
  g.strokeStyle = oak; g.lineWidth = t;
  g.beginPath(); g.moveTo(w / 2, h - t); g.lineTo(w - t, h * 0.55); g.moveTo(w / 2, t); g.lineTo(w - t, h * 0.55); g.stroke();
  const wx = w * 0.12, wy = h * 0.18, ww = w * 0.28, wh = h * 0.3;   // window in the left bay
  g.fillStyle = '#3d4a55'; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#f7f3ea'; g.fillRect(wx - 3, wy - 3, ww + 6, 4); g.fillRect(wx - 3, wy + wh - 1, ww + 6, 4); g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  g.fillStyle = '#a33b2a'; g.fillRect(wx - 12, wy, 9, wh); g.fillRect(wx + ww + 3, wy, 9, wh);   // shutters
  g.fillStyle = '#4e7d32'; g.fillRect(wx, wy + wh + 3, ww, 5);
  g.fillStyle = '#c0392b'; for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(wx + 6 + k * (ww - 12) / 4, wy + wh + 6, 4, 0, TAU); g.fill(); }   // flower box
}

function build(api) {
  const K = kit(api), { rnd, range, pick } = K, track = api.track;
  K.mat('stone', new THREE.MeshStandardMaterial({ map: K.tex(256, 256, (g, w, h) => paintStone(g, w, h, [142, 136, 122])), vertexColors: true, roughness: 0.95 }), 4);
  K.mat('timber', new THREE.MeshStandardMaterial({ map: K.tex(256, 192, paintTimber), vertexColors: true, roughness: 0.9 }));
  K.mat('office', new THREE.MeshStandardMaterial({ map: K.tex(256, 128, (g, w, h) => paintWindows(g, w, h)), vertexColors: true, roughness: 0.3, metalness: 0.4 }));
  const sign = K.signs([['GRAND PRIX  グランプリ', '#1d2533'], ['EIFEL RING  アイフェル', '#b3121f'], ['RACE CONTROL', '#10151f', '#ffd23f']]);

  // ---------------------------------------------------------------- paddock: pit building (left) + main grandstands (right)
  {
    const p = K.beside(22, -(W2 + 15), -0.2);
    if (K.claim(p, 230, 64)) {
      const put = K.frame(p.x, p.y, p.z, p.ry);
      K.pits(put, 230, { accent: '#b3121f', sign: sign(2) });
      put('office', K.facade(90, 12, 30, 16, 8).translate(40, 0, 44));   // modern event hall behind the pits
      put('solid', K.box(98, 1, 36, 40, 12, 44), '#dfe3e8');
      put('sign', sign(0)(40, 4).translate(40, 13.3, 25.5));
    }
    for (const [i, len] of [[4, 150], [52, 90]]) {
      const q = K.beside(i, W2 + 14, -0.2);
      if (!K.claim(q, len, 14)) continue;
      const put = K.frame(q.x, q.y, q.z, q.ry);
      K.grandstand(put, len, { rows: 14, fascia: '#1d4ed8' });
      put('sign', sign(1)(34, 3.2).translate(0, 13.6, -3.3));
    }
    const t1 = K.beside(147, W2 + 17, -0.2);   // turn 1 (Mercedes arena) stand on the outside of the hairpin
    if (K.claim(t1, 60, 12)) K.grandstand(K.frame(t1.x, t1.y, t1.z, t1.ry), 60, { rows: 9, fascia: '#e5383b' });
  }

  // ---------------------------------------------------------------- castle ruin on the hilltop: round keep, broken walls, towers
  {
    const put = K.frame(CASTLE.x, api.groundAt(CASTLE.x, CASTLE.z) - 0.5, CASTLE.z, 0.4, CASTLE.s), stone = '#d8d0c0', dark = '#b8ae9c';
    api.block(CASTLE.x, CASTLE.z, 65);
    put('stone', K.cyl(6.2, 6.8, 26, 12), stone);                                    // the round keep
    for (let k = 0; k < 12; k++) {                                                   // crenellation, a few merlons gone
      if (k % 5 === 3) continue;
      const a = k / 12 * TAU;
      put('stone', K.box(2, 1.6, 1.2, Math.cos(a) * 6.3, 26, Math.sin(a) * 6.3, -a), stone);
    }
    put('solid', K.cyl(6.4, 6.4, 0.6, 12, 0, 25.4, 0), '#8f877a');
    put('solid', K.box(1.2, 2, 0.3, 0, 12, -6.5), '#1a1612');                        // doorway high up
    const ring = [[-26, -20], [8, -30], [30, -12], [34, 16], [12, 30], [-18, 28], [-34, 6]];
    ring.forEach(([ax, az], k) => {
      const [bx, bz] = ring[(k + 1) % ring.length], len = Math.hypot(bx - ax, bz - az), ang = Math.atan2(-(bz - az), bx - ax);
      for (let j = 0; j < 5; j++) {
        if ((k * 7 + j * 3) % 11 === 0) continue;                                    // breaches
        const t = (j + 0.5) / 5, hgt = 5 + ((k * 13 + j * 7) % 9) * (k === 1 ? 0.3 : 0.6);
        put('stone', K.box(len / 5 + 0.2, hgt, 2, lerp(ax, bx, t), -2, lerp(az, bz, t), ang), j % 2 ? stone : dark);
      }
      if (k % 2 === 0) {                                                             // round corner towers, one keeps its roof
        const th = 9 + (k % 3) * 3;
        put('stone', K.cyl(3.6, 4.2, th, 10, ax, -2, az), stone);
        if (k === 4) put('solid', K.cone(4.4, 5, 10, ax, th - 2, az), '#5b5f66');
      }
    });
    for (const [x, z, w, d, ry] of [[-14, 12, 22, 1.4, 0.15], [-14, 22, 22, 1.4, 0.15], [-25, 17, 1.4, 10, 0.15]]) {   // roofless palas
      put('stone', K.box(w, 9, d, x, -1, z, ry), dark);
      put('solid', K.box(w * 0.9, 1.3, d + 0.1, x, 5, z, ry), '#4a443c');           // window band
    }
    put('solid', K.cyl(0.1, 0.12, 7, 5, 0, 26.6, 0), '#e8e8e8');                     // flagpole + pennant
    put('solid', K.box(0.06, 1.2, 2.2, 0, 32, 1.1), '#d8b23a');
  }

  // ---------------------------------------------------------------- half-timbered village on the castle hill's lower slopes
  {
    const roofs = ['#a8412f', '#9b3a2a', '#b44a33', '#8f3526', '#7a3a2c'], walls = ['#ffffff', '#fbf3e4', '#f4ecdd', '#fff6ea', '#efe6d6'];
    const toward = Math.atan2(-120 - CASTLE.x, -420 - CASTLE.z);   // the village spills down toward turn 1 / the straight
    let n = 0;
    for (let t = 0; t < 900 && n < 30; t++) {
      const a = toward + (rnd() - 0.5) * 2.4, r = 95 + rnd() * 170, x = CASTLE.x + Math.sin(a) * r, z = CASTLE.z + Math.cos(a) * r;
      const w = range(7, 10), d = range(8, 12), storeys = rnd() < 0.7 ? 2 : 3, rad = Math.max(w, d) * 0.75 + 2;
      const [dd, i] = K.nearI(x, z);
      if (dd < W2 + 40 || !K.tallOk(x, z, dd, i, 45) || !api.isFree(x, z, rad + 1)) continue;
      api.block(x, z, rad);
      const ry = Math.atan2(x - CASTLE.x, z - CASTLE.z) + (rnd() - 0.5) * 0.5, h = storeys * 3;
      const put = K.frame(x, api.groundAt(x, z), z, ry);
      put('stone', K.box(w + 0.4, 3.5, d + 0.4, 0, -3.2, 0), '#cfc6b4');             // plinth on the slope
      put('timber', K.facade(w, h, d, 4, 3).translate(0, 0.3, 0), pick(walls));
      const rh = w * 0.55;
      put('solid', K.gable(w + 1.4, rh, d + 1.2).translate(0, h + 0.3, 0), pick(roofs));
      put('solid', K.box(0.9, 2.2, 0.9, w * 0.2, h + rh * 0.4, d * 0.2), '#7c6f65');   // chimney
      n++;
    }
    const a = toward + 0.45, x = CASTLE.x + Math.sin(a) * 120, z = CASTLE.z + Math.cos(a) * 120;   // church: white nave, slate spire
    if (api.isFree(x, z, 16)) {
      api.block(x, z, 16);
      const put = K.frame(x, api.groundAt(x, z), z, a);
      put('stone', K.box(11, 4, 22, 0, -3.5, 0), '#cfc6b4');
      put('solid', K.box(10, 8, 20), '#f4efe6');
      put('solid', K.gable(11.2, 5.5, 21).translate(0, 8, 0), '#4a4f59');
      put('solid', K.box(5.4, 16, 5.4, 0, 0, -12), '#f4efe6');
      put('solid', K.cone(3.9, 12, 4, 0, 16, -12, Math.PI / 4), '#3f444d');
      put('solid', K.box(0.3, 2.6, 0.3, 0, 28, -12), '#c9a227');
    }
  }

  // ---------------------------------------------------------------- wind turbines on the far ridges (rotors: one InstancedMesh)
  {
    const b = track.bounds, hubs = [];
    const spots = [[b.maxX + 520, b.minZ + 300], [b.maxX + 640, b.minZ + 760], [b.maxX + 450, b.maxZ + 380], [b.minX - 560, b.minZ + 120], [b.minX - 700, b.minZ + 620], [b.minX - 420, b.maxZ + 420]];
    for (const [x, z] of spots) {
      const y = api.groundAt(x, z), put = K.frame(x, y, z, 0), face = Math.atan2(-60 - x, -600 - z) + 0.4;
      put('solid', K.cyl(1.1, 2.1, 78, 8, 0, -2, 0), '#eef1f4');
      put('solid', K.box(3, 3.4, 9, 0, 75, 0, face), '#e3e7ec');
      hubs.push({ x: x - Math.sin(face) * 4.8, y: y + 76.7, z: z - Math.cos(face) * 4.8, face, ph: rnd() * TAU });
    }
    const blade = new THREE.BoxGeometry(1.4, 34, 0.35).translate(0, 17, 0);
    const rot = new THREE.InstancedMesh(mergeGeometries([0, 1, 2].map(k => blade.clone().rotateZ(k * TAU / 3)).concat([new THREE.BoxGeometry(2.4, 2.4, 2.4)])),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.6 }), hubs.length);
    api.world.add(rot);
    const dm = new THREE.Object3D();
    const spin = t => {
      hubs.forEach((h, k) => { dm.position.set(h.x, h.y, h.z); dm.rotation.set(0, h.face, h.ph + t * 1.1, 'YXZ'); dm.updateMatrix(); rot.setMatrixAt(k, dm.matrix); });
      rot.instanceMatrix.needsUpdate = true;
    };
    spin(0);
    rot.computeBoundingSphere();
    let t = 0;
    api.onUpdate(dt => { t += dt; spin(t); });
  }

  K.flush();

  // ---------------------------------------------------------------- Eifel forest: dense spruce, beech clumps, pasture clearings
  const tc = new THREE.Color();
  K.trees({
    n: 15000, pad: 620, geos: [K.spruce(3, 5, 0.8), K.spruce(1, 5, 0.85, false), K.leafy(2)],
    density: (x, z, d) => {
      if (Math.hypot(x - CASTLE.x, z - CASTLE.z) < 80) return 0;                      // bare hilltop around the ruin
      const meadow = smooth(0.52, 0.6, fbm(x / 420 - 5, z / 420 + 2));
      return (0.3 + 0.7 * smooth(0.28, 0.5, fbm(x / 190, z / 190))) * (1 - 0.9 * meadow);
    },
    kind: (x, z, d) => (d > 170 ? 1 : fbm(x / 120 + 9, z / 120) > 0.62 ? 2 : 0),
    size: (x, z, d, k) => (k === 1 ? 2 + rnd() * 0.9 : k === 2 ? 1.2 + rnd() * 0.5 : 1.3 + rnd() * 0.8),
    color: (x, z, k) => (k === 2 ? tc.setHSL(0.25 + rnd() * 0.05, 0.38, 0.16 + rnd() * 0.05) : tc.setHSL(0.34 + rnd() * 0.05, 0.3 + rnd() * 0.15, 0.07 + rnd() * 0.04)),
  });

  K.clouds({ y: 230, color: '#dfe3e8', alpha: 0.85, blobs: 60, speed: 1.4 });
}

export default {
  base: 'forest',
  env: {
    sky: { top: '#6c7c8d', horizon: '#c7cdd2', bottom: '#7c887c' },
    fog: { color: '#bfc6cb', near: 170, far: 1500 },
    sun: { dir: [-0.35, 0.8, -0.3], color: '#e6eaee', intensity: 1.3 },
    hemi: { sky: '#d3dae2', ground: '#3f4d38', intensity: 1.05 },
    exposure: 1.02,
    envIntensity: 0.42,
    terrain: { base: '#3d5f2b', hills: 24, rim: 150, rimColor: '#a9bc9c', height, paint: paintGrass('#3d5f2b', ['40,70,28', '70,92,44', '52,84,36', '88,100,52'], ['#f3efe0', '#e9d85a']) },
  },
  baseBuild: false,
  build,
};
