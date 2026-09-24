// Desert theme (サンセット・キャニオン): sunset canyon with red sandstone mesas, buttes & hoodoos, rock arches,
// saguaros, dry brush, tumbleweeds rolling in the wind, an old ranch fence with signposts, circling vultures,
// a big low sun and sunset-lit cloud streaks.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const SUN = [-0.42, 0.2, 0.885];
function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// 256² tileable sand: wind ripples (long windward slope, steep lee), grain, pebbles
function paintSand(g, w, h) {
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const ph = 6 * v + 0.35 * Math.sin(TAU * (2 * u + 0.2)) + 0.12 * Math.sin(TAU * (5 * u + 2 * v));
    const f = ph - Math.floor(ph), rip = f < 0.78 ? f / 0.78 : (1 - f) / 0.22;
    const k = 0.9 + 0.12 * rip + (Math.random() - 0.5) * 0.09, i = (y * w + x) * 4;
    d[i] = 216 * k; d[i + 1] = 163 * k; d[i + 2] = 108 * k; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let n = 0; n < 150; n++) {
    const x = Math.random() * w, y = Math.random() * h, r = 0.6 + Math.random() * 1.5, s = Math.random();
    g.fillStyle = `rgba(${110 + s * 70 | 0},${60 + s * 40 | 0},${38 + s * 30 | 0},${0.35 + Math.random() * 0.4})`;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill(); }
  }
}

const env = {
  sky: { top: '#4a3d8c', horizon: '#ff9d63', bottom: '#b8704c' },
  fog: { color: '#eea27a', near: 90, far: 1100 },
  // warm key light, cool lavender fill: lit faces glow, shaded faces go violet instead of flat grey
  sun: { dir: SUN, color: '#ffb070', intensity: 3.4 },
  hemi: { sky: '#c7a3d4', ground: '#9a5638', intensity: 0.72 },
  envIntensity: 0.3,
  exposure: 1.0,
  night: false,
  terrain: { base: '#d6a06a', paint: paintSand, hills: 10, rim: 60, rimColor: '#b8704f' },   // rimColor also tints the rock barrier
  road: { base: '#4d4441', line: '#f3e4c4', edge: '#ecd9b2' },
  shoulder: '#c9956a',
  barrier: 'rock',
  curb: ['#b9442c', '#f0e2c6'],
};

// ---- geometry accumulator: many objects → one draw call ----
const acc = () => ({ p: [], c: [], u: [], i: [] });
function accGeo(THREE, a) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(a.p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(a.c, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(a.u, 2));
  g.setIndex(a.i);
  g.computeVertexNormals();
  return g;
}

function build(api) {
  const { THREE, world, track } = api;
  const rnd = seeded(40523);   // own seed: the layout was tuned by eye for this course
  const S = track.samples, N = S.length, W2 = track.width / 2, WALL = W2 + 9.4, spacing = track.length / N;
  const RT = S.map(s => new THREE.Vector3(-s.tan.z, 0, s.tan.x).normalize());   // + lateral = right of travel
  const yawAt = i => { const t = S[((i % N) + N) % N].tan; return Math.atan2(t.x, t.z); };
  const curv = new Float32Array(N), corner = new Float32Array(N);
  for (let i = 0; i < N; i++) { const d = yawAt(i + 3) - yawAt(i - 3); curv[i] = Math.atan2(Math.sin(d), Math.cos(d)) / (6 * spacing); }
  for (let i = 0; i < N; i++) { let m = 0; for (let k = -30; k <= 30; k++) { const c = curv[(i + k + N) % N]; if (Math.abs(c) > Math.abs(m)) m = c; } corner[i] = m; }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of S) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const ground = (x, z) => api.groundAt(x, z);
  const probe = (x, z) => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const p = S[bi].pos;
    return { d: Math.sqrt(bd), i: bi, lat: (x - p.x) * RT[bi].x + (z - p.z) * RT[bi].z };
  };
  // tall things stay ≥ 24 m off the barrier on the inside of corners so they never hide the road ahead
  const clear = (x, z, r, tall, out = 8) => {
    if (!api.isFree(x, z, r)) return false;
    if (!tall) return true;
    const p = probe(x, z), inside = p.lat * corner[p.i] < 0 && Math.abs(corner[p.i]) > 1 / 350;
    return p.d - r >= WALL + (inside ? 24 : out);
  };
  const beside = (dMin, dMax, bias = 1) => {
    const i = rnd() * N | 0, sg = rnd() < 0.5 ? -1 : 1, d = lerp(dMin, dMax, rnd() ** bias);
    return [S[i].pos.x + RT[i].x * sg * d, S[i].pos.z + RT[i].z * sg * d, i];
  };

  const V = new THREE.Vector3(), Q = new THREE.Quaternion(), M = new THREE.Matrix4(), C = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);
  const rock = acc(), scree = acc(), wood = acc(), signs = acc();

  function addGeo(a, geo, m, col, uv) {
    const P = geo.attributes.position, U = geo.attributes.uv, base = a.p.length / 3;
    for (let k = 0; k < P.count; k++) {
      V.fromBufferAttribute(P, k).applyMatrix4(m);
      a.p.push(V.x, V.y, V.z); a.c.push(col.r, col.g, col.b);
      const u = U ? U.getX(k) : 0, v = U ? U.getY(k) : 0;
      a.u.push(...(uv ? uv(u, v) : [u, v]));
    }
    if (geo.index) for (const k of geo.index.array) a.i.push(base + k);
    else for (let k = 0; k < P.count; k++) a.i.push(base + k);
  }
  // ring stack (bottom → top) closed by an optional cap vertex; at(ring, k, theta, uFrac) → [x,y,z, r,g,b, u,v]
  function stack(a, A, nR, at, cap) {
    const base = a.p.length / 3, RW = A + 1;
    for (let ri = 0; ri < nR; ri++) for (let k = 0; k <= A; k++) {
      const q = at(ri, k % A, (k % A) / A * TAU, k / A);
      a.p.push(q[0], q[1], q[2]); a.c.push(q[3], q[4], q[5]); a.u.push(q[6], q[7]);
    }
    for (let r = 0; r < nR - 1; r++) for (let k = 0; k < A; k++) { const b = base + r * RW + k, t = b + RW; a.i.push(t, b, t + 1, b, b + 1, t + 1); }
    if (cap) {
      const c = a.p.length / 3, top = base + (nR - 1) * RW;
      a.p.push(cap[0], cap[1], cap[2]); a.c.push(cap[3], cap[4], cap[5]); a.u.push(cap[6], cap[7]);
      for (let k = 0; k < A; k++) a.i.push(top + k, top + k + 1, c);
    }
  }

  // ---- sandstone: mesas, buttes, hoodoos, arches ----
  // profile rings: [radius mul, height frac, jitter, shade]
  const PROFILES = {
    mesa: [[1, 0, 0.03, 0.78], [0.99, 0.12, 0.05, 0.84], [0.97, 0.3, 0.05, 0.9], [0.9, 0.33, 0.03, 0.95], [0.89, 0.55, 0.05, 1],
      [0.86, 0.72, 0.05, 1], [0.8, 0.75, 0.03, 1.05], [0.79, 0.94, 0.04, 1.08], [0.81, 1, 0.01, 1.18]],
    butte: [[1, 0, 0.04, 0.78], [0.95, 0.2, 0.06, 0.86], [0.86, 0.4, 0.05, 0.94], [0.8, 0.6, 0.06, 1], [0.72, 0.62, 0.03, 1.02],
      [0.7, 0.9, 0.05, 1.06], [0.73, 1, 0.02, 1.18]],
    hoodoo: [[1, 0, 0.08, 0.82], [0.75, 0.3, 0.1, 0.9], [0.56, 0.6, 0.08, 0.95], [0.5, 0.72, 0.05, 1], [0.68, 0.78, 0.06, 1.08],
      [0.63, 0.9, 0.06, 1.1], [0.34, 1, 0.1, 1.14]],
  };
  const TINTS = [[1, 1, 1], [1.08, 1.02, 0.92], [0.9, 0.84, 0.82], [1.2, 1.13, 1.02]];
  // scree skirt, blends from the terrain sand into the rock colour; shares the terrain painter for continuity
  function pile(A, at, shape, R, y0, h, tint) {
    const J = Array.from({ length: 3 * A }, rnd);
    stack(scree, A, 3, (ri, k, th) => {
      const r = R * [1.62, 1.3, 0.94][ri] * shape(th) * (1 + (J[ri * A + k] - 0.5) * 0.16);
      const [x, z] = at(th, r), g = ground(x, z), t = [0, 0.55, 1][ri];
      const y = ri ? Math.max(g + 0.25, y0 + [0, 0.3, 1][ri] * h) : g - 1;
      C.setRGB(lerp(1, 0.66 * tint[0], t), lerp(1, 0.36 * tint[1], t), lerp(1, 0.32 * tint[2], t));
      return [x, y, z, C.r, C.g, C.b, x / 7, z / 7];
    });
  }
  function formation(kind, x, z, R, H, o = {}) {
    const prof = PROFILES[kind], A = o.A || (R > 18 ? 40 : R > 6 ? 26 : 12), el = o.el || 1;
    const yaw = rnd() * TAU, cy = Math.cos(yaw), sy = Math.sin(yaw), ph = [rnd(), rnd(), rnd(), rnd()].map(v => v * TAU);
    const shape = th => 1 + 0.13 * Math.sin(2 * th + ph[0]) + 0.08 * Math.sin(3 * th + ph[1]) + 0.05 * Math.sin(5 * th + ph[2]) + 0.035 * Math.sin(9 * th + ph[3]);
    const at = (th, r) => { const lx = Math.sin(th) * r * el, lz = Math.cos(th) * r; return [x + lx * cy - lz * sy, z + lx * sy + lz * cy]; };
    let y0 = ground(x, z);
    for (let k = 0; k < 10; k++) { const [px, pz] = at(k / 10 * TAU, R * 0.95); y0 = Math.min(y0, ground(px, pz)); }
    const rings = [];
    prof.forEach((r, k) => {
      if (k) { const q = prof[k - 1]; rings.push([(q[0] + r[0]) / 2, (q[1] + r[1]) / 2, Math.max(q[2], r[2]) * 1.5, (q[3] + r[3]) / 2]); }
      rings.push(r);
    });
    const nR = rings.length, J = Array.from({ length: nR * A }, rnd), G = Array.from({ length: A }, () => (rnd() < 0.22 ? 0.9 : 1));
    const tint = TINTS[o.tint ?? (rnd() * TINTS.length | 0)], reps = Math.max(1, Math.round(Math.PI * R * (1 + el) / 40)), top = rings[nR - 1][3];
    stack(rock, A, nR, (ri, k, th, f) => {
      const [m, fy, jit, sh] = rings[ri];
      const r = R * m * shape(th) * (1 + (J[ri * A + k] - 0.5) * 2 * jit) * (ri && ri < nR - 1 ? G[k] : 1);
      const [px, pz] = at(th, r), py = ri ? y0 + fy * H : Math.min(y0, ground(px, pz)) - 1.5;
      return [px, py, pz, tint[0] * sh, tint[1] * sh, tint[2] * sh, f * reps, py / 48];
    }, [x, y0 + H * (1 + (o.dome || 0.004)), z, tint[0] * top, tint[1] * top, tint[2] * top, 0.5, (y0 + H) / 48]);
    if (o.scree !== 0) pile(A, at, shape, R, y0, (o.scree || 0.18) * H, tint);
  }
  function arch(x, z, yaw, span, height, thick) {
    const pts = [[-0.5, -0.25], [-0.53, 0.3], [-0.45, 0.72], [-0.22, 0.97], [0.1, 1], [0.37, 0.82], [0.5, 0.42], [0.48, -0.25]]
      .map(([u, v]) => new THREE.Vector3(u * span, v * height, 0));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal'), TS = 56, RS = 9;
    const tube = new THREE.TubeGeometry(curve, TS, 1, RS, false), P = tube.attributes.position;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), W = (lx, lz) => [x + lx * cy - lz * sy, z + lx * sy + lz * cy];
    const feet = [W(-0.5 * span, 0), W(0.48 * span, 0)], y0 = Math.min(...feet.map(([fx, fz]) => ground(fx, fz)));
    const J = Array.from({ length: (TS + 1) * RS }, rnd), tint = TINTS[rnd() * 3 | 0], base = rock.p.length / 3, c = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      const seg = Math.floor(i / (RS + 1)), t = seg / TS, e = Math.abs(t - 0.5) * 2;
      curve.getPointAt(t, c);
      const f = thick * (0.8 + 1.4 * e ** 3) * (1 + (J[seg * RS + (i % (RS + 1)) % RS] - 0.5) * 0.35);
      const lx = c.x + (P.getX(i) - c.x) * f, ly = c.y + (P.getY(i) - c.y) * f, lz = (P.getZ(i) - c.z) * f * 1.4;
      const [px, pz] = W(lx, lz), py = y0 + ly, sh = 0.86 + 0.28 * ly / height;
      rock.p.push(px, py, pz); rock.c.push(tint[0] * sh, tint[1] * sh, tint[2] * sh); rock.u.push(t * span / 24, py / 48);
    }
    for (const k of tube.index.array) rock.i.push(base + k);
    tube.dispose();
    for (const [fx, fz] of feet) pile(12, (th, r) => [fx + Math.sin(th) * r, fz + Math.cos(th) * r * 1.3], () => 1, thick * 2.2, y0, thick * 2.4, tint);
  }
  const forms = [];
  const place = (n, tries, fn) => { for (let t = 0; t < tries && n > 0; t++) if (fn()) n--; };

  // horizon mesas on the rim (kept out of the sun's direction so the sunset stays visible)
  const sunAz = Math.atan2(SUN[0], SUN[2]);
  for (let k = 0; k < 13; k++) {
    const az = (k + rnd() * 0.6) / 13 * TAU, dAz = Math.abs(Math.atan2(Math.sin(az - sunAz), Math.cos(az - sunAz)));
    if (dAz < 0.2) continue;
    const dist = 600 + rnd() * 170, x = cx + Math.sin(az) * dist, z = cz + Math.cos(az) * dist;
    formation(rnd() < 0.3 ? 'butte' : 'mesa', x, z, 40 + rnd() * 55, 45 + rnd() * 75, { el: 1 + rnd() * 1.2, A: 28, tint: rnd() * 3 | 0 });
  }
  // mesas & buttes around the course
  place(8, 500, () => {
    const R = 20 + rnd() * 24, el = 1 + rnd() * 0.8, H = 18 + rnd() * 26, fp = R * el * 1.7;
    const [x, z] = beside(WALL + 25 + fp, 330);
    if (!clear(x, z, fp, true)) return false;
    formation('mesa', x, z, R, H, { el }); api.block(x, z, fp); forms.push([x, z, R * el]);
    return true;
  });
  place(10, 500, () => {
    const R = 7 + rnd() * 6, el = 1 + rnd() * 0.4, H = 28 + rnd() * 30, fp = R * el * 1.7;
    const [x, z] = beside(WALL + 20 + fp, 250);
    if (!clear(x, z, fp, true)) return false;
    formation('butte', x, z, R, H, { el, scree: 0.24 }); api.block(x, z, fp); forms.push([x, z, R * el]);
    return true;
  });
  // rock arches: one big showpiece, one smaller close to the road
  for (const [span, h, th, dMin, dMax] of [[38, 26, 3.1, 40, 120], [24, 15, 2.2, 22, 60]]) {
    place(1, 400, () => {
      const [x, z, i] = beside(WALL + dMin, WALL + dMax), fp = span / 2 + th * 3;
      if (!clear(x, z, fp, true)) return false;
      arch(x, z, -yawAt(i) + Math.PI / 2 + (rnd() - 0.5) * 0.7, span, h, th); api.block(x, z, fp); forms.push([x, z, span / 2]);
      return true;
    });
  }
  // hoodoo clusters
  place(8, 300, () => {
    const [x0, z0] = beside(WALL + 20, 150);
    if (!clear(x0, z0, 12, true)) return false;
    const n = 3 + (rnd() * 4 | 0);
    for (let k = 0; k < n; k++) {
      const x = x0 + (rnd() - 0.5) * 22, z = z0 + (rnd() - 0.5) * 22, R = 1.6 + rnd() * 1.8;
      if (!clear(x, z, R * 1.6, true)) continue;
      formation('hoodoo', x, z, R, 6 + rnd() * 10, { scree: 0.14, dome: 0.05, tint: rnd() * 3 | 0 }); api.block(x, z, R * 1.6);
    }
    forms.push([x0, z0, 8]);
    return true;
  });

  const strata = api.canvasTex(128, 512, (g, w, h) => {
    // mostly thick red beds; pale sandstone only as occasional thin ledges (all-random pale bands read as candy stripes)
    const pal = ['#b4492c', '#c65a33', '#a33f27', '#bc5a37', '#c8653b', '#ad4630', '#d27a47'], pale = ['#dc9e70', '#d98c5a'];
    for (let y = 0; y < h;) {
      const ledge = Math.random() < 0.14, t = ledge ? 3 + Math.random() * 7 | 0 : 10 + Math.random() * 34 | 0;
      g.fillStyle = ledge ? pale[Math.random() * 2 | 0] : pal[Math.random() * pal.length | 0]; g.fillRect(0, y, w, t);
      g.fillStyle = 'rgba(60,20,10,0.3)'; g.fillRect(0, y + t - 1, w, 1);
      y += t;
    }
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, 0, 0);
    for (let n = 0; n < 50; n++) {   // desert-varnish streaks running down the cliffs
      const x = Math.random() * w, y = Math.random() * h, l = 20 + Math.random() * 140, sw = 1 + Math.random() * 3;
      g.fillStyle = `rgba(55,20,12,${0.08 + Math.random() * 0.14})`;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) g.fillRect(x + ox, y + oy, sw, l);
    }
  });
  const rockMat = new THREE.MeshStandardMaterial({ map: strata, vertexColors: true, flatShading: true, roughness: 0.92 });
  const rockMesh = new THREE.Mesh(accGeo(THREE, rock), rockMat);
  const sandTex = api.canvasTex(256, 256, paintSand);
  const screeMesh = new THREE.Mesh(accGeo(THREE, scree), new THREE.MeshStandardMaterial({ map: sandTex, vertexColors: true, flatShading: true, roughness: 1 }));
  rockMesh.castShadow = rockMesh.receiveShadow = screeMesh.castShadow = screeMesh.receiveShadow = true;
  world.add(rockMesh, screeMesh);

  // ---- crescent dunes in the open sand: gentle windward slope, sharp crest, steep slip face on the lee side ----
  // the wind blows away from the sun, so heading into the sunset the slip faces are in shade and the crests read
  const dunes = acc(), windAz = Math.atan2(-SUN[0], -SUN[2]);
  function dune(x, z, Lx, Lz, H) {
    const yaw = windAz + (rnd() - 0.5) * 0.6, cy = Math.cos(yaw), sy = Math.sin(yaw), NX = 26, NW = 9, NL = 6, k = 0.92 + rnd() * 0.08;
    const zc = u => 0.1 + 0.55 * u * u;   // crest line bows downwind at the horns
    const patch = (z0, z1, nz, prof) => {
      const base = dunes.p.length / 3;
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= NX; i++) {
        const u = i / NX * 2 - 1, zz = lerp(z0(u), z1(u), j / nz), lz = zz * Lz, lx = u * Lx;
        const px = x + lx * cy + lz * sy, pz = z - lx * sy + lz * cy;   // local +z = downwind
        const py = ground(px, pz) - 0.7 + H * (1 - u * u) ** 0.8 * prof(u, zz);
        dunes.p.push(px, py, pz); dunes.c.push(k, k * 0.97, k * 0.93); dunes.u.push(px / 7, pz / 7);
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i, b = a + NX + 1;
        dunes.i.push(a, b, a + 1, b, b + 1, a + 1);
      }
    };
    patch(() => -1, zc, NW, (u, zz) => ((zz + 1) / (zc(u) + 1)) ** 1.5);                                // windward
    patch(zc, () => 1, NL, (u, zz) => Math.max(0, 1 - 1.7 * (zz - zc(u)) / (1 - zc(u))) ** 1.25);       // slip face (own vertices: crisp crest)
  }
  place(12, 700, () => {
    const Lx = 26 + rnd() * 26, Lz = 15 + rnd() * 12, H = 4 + rnd() * 6;
    const [x, z] = beside(WALL + 36 + Lx, 360);
    if (!clear(x, z, Lx, true, 30)) return false;
    dune(x, z, Lx, Lz, H); api.block(x, z, Lx);
    return true;
  });
  if (dunes.i.length) {
    const duneMesh = new THREE.Mesh(accGeo(THREE, dunes), new THREE.MeshStandardMaterial({ map: sandTex, vertexColors: true, roughness: 1 }));
    duneMesh.castShadow = duneMesh.receiveShadow = true;
    duneMesh.name = 'dunes';
    world.add(duneMesh);
  }

  // ---- old ranch fence along the longest straights, wooden signposts ----
  const runs = [];
  for (let i = 0, st = -1; i <= N; i++) {
    const straight = i < N && Math.abs(curv[i]) < 1 / 500;
    if (straight && st < 0) st = i;
    if (!straight && st >= 0) { if (i - st > 60) runs.push([st, i]); st = -1; }
  }
  const post = new THREE.BoxGeometry(0.17, 1.55, 0.17).translate(0, 0.62, 0), wire = [], E = new THREE.Euler();
  for (const [a, b] of runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 2)) {
    const lat = (rnd() < 0.5 ? -1 : 1) * (W2 + 14.5);
    let prev = null;
    for (let i = a + 4; i < b - 4; i += 3) {
      const x = S[i].pos.x + RT[i].x * lat, z = S[i].pos.z + RT[i].z * lat;
      if (!api.isFree(x, z, 0.4) || rnd() < 0.08) { prev = null; continue; }
      const y = ground(x, z);
      M.compose(V.set(x, y, z), Q.setFromEuler(E.set((rnd() - 0.5) * 0.14, rnd() * TAU, (rnd() - 0.5) * 0.14)), ONE);
      addGeo(wood, post, M, C.setHSL(0.07 + rnd() * 0.03, 0.22, 0.26 + rnd() * 0.14));
      if (prev) for (const hh of [0.6, 1.08]) wire.push(prev[0], prev[1] + hh, prev[2], x, y + hh, z);
      prev = [x, y, z];
    }
  }
  if (wire.length) {
    const wg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    world.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a2a20, transparent: true, opacity: 0.75 })));
  }
  const atlas = api.canvasTex(1024, 512, (g, w, h) => {
    const PW = w / 2, PH = h / 2, font = '"Hiragino Sans","Yu Gothic",sans-serif';
    const planks = (x0, y0) => {
      g.fillStyle = '#8b5a33'; g.fillRect(x0, y0, PW, PH);
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? 'rgba(0,0,0,0.1)' : 'rgba(255,220,180,0.07)'; g.fillRect(x0, y0 + k * PH / 4, PW, PH / 4);
        g.fillStyle = 'rgba(40,20,10,0.6)'; g.fillRect(x0, y0 + k * PH / 4, PW, 3);
      }
      for (let n = 0; n < 180; n++) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '40,20,8' : '210,170,120'},${Math.random() * 0.14})`;
        g.fillRect(x0 + Math.random() * PW, y0 + Math.random() * PH, 20 + Math.random() * 90, 1 + Math.random() * 2);
      }
      g.strokeStyle = 'rgba(40,20,10,0.65)'; g.lineWidth = 8; g.strokeRect(x0 + 4, y0 + 4, PW - 8, PH - 8);
    };
    const text = (s, x, y, size, col) => {
      g.font = `900 ${size}px ${font}`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s, x, y, PW - 56);
    };
    planks(0, 0);
    text('ようこそ', PW / 2, 48, 40, '#f6e2b8');
    text('サンセット・キャニオン', PW / 2, 128, 64, '#2b150a');
    text('SUNSET CANYON ・ 標高 412 m', PW / 2, 204, 28, '#f6e2b8');
    planks(PW, 0);
    text('給油所', PW * 1.5, 82, 76, '#2b150a');
    text('この先 180 km →', PW * 1.5, 176, 50, '#2b150a');
    g.fillStyle = '#f2c230'; g.fillRect(0, PH, PW, PH);
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 14; g.strokeRect(14, PH + 14, PW - 28, PH - 28);
    g.lineWidth = 4;
    for (let n = 0; n < 14; n++) { g.beginPath(); g.ellipse(92, PH + 128, 30 + Math.random() * 22, 26 + Math.random() * 22, Math.random() * 3, 0, 5); g.stroke(); }
    g.font = `900 64px ${font}`; g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('注意', PW / 2 + 60, PH + 86);
    g.font = `900 44px ${font}`; g.fillText('タンブルウィード', PW / 2 + 60, PH + 170, PW - 190);
    planks(PW, PH);
    text('← 金鉱跡', PW * 1.5, PH + 92, 76, '#2b150a');
    text('12 km', PW * 1.5, PH + 182, 52, '#2b150a');
  }, false);
  const SIGNS = [{ at: 0.035, w: 7.5, uv: [0, 0.5] }, { at: 0.33, w: 4.4, uv: [0.5, 0.5] }, { at: 0.55, w: 4.2, uv: [0, 0] }, { at: 0.8, w: 4.4, uv: [0.5, 0] }];
  for (const sg of SIGNS) {
    for (let t = 0; t < 14; t++) {
      const i = (Math.round(sg.at * N) + (t >> 1) * 9) % N, side = t % 2 ? -1 : 1, lat = side * (W2 + 13.2 + sg.w / 2);
      const x = S[i].pos.x + RT[i].x * lat, z = S[i].pos.z + RT[i].z * lat;
      if (!api.isFree(x, z, sg.w / 2 + 0.5)) continue;
      const dx = -RT[i].x * side * 0.8 - S[i].tan.x * 0.6, dz = -RT[i].z * side * 0.8 - S[i].tan.z * 0.6;   // face the road & oncoming cars
      M.compose(V.set(x, ground(x, z), z), Q.setFromAxisAngle(UP, Math.atan2(-dx, -dz)), ONE);
      const bw = sg.w, bh = bw / 2, by = 1.3 + bh / 2, ph = by + bh / 2 + 0.35, woodC = C.setHSL(0.07, 0.3, 0.3).clone();
      addGeo(wood, new THREE.BoxGeometry(bw + 0.2, bh + 0.2, 0.14).translate(0, by, 0.02), M, woodC);
      for (const sx of [-0.33, 0.33]) addGeo(wood, new THREE.BoxGeometry(0.22, ph + 0.4, 0.22).translate(sx * bw, ph / 2 - 0.2, 0.16), M, woodC);
      addGeo(signs, new THREE.PlaneGeometry(bw, bh).rotateY(Math.PI).translate(0, by, -0.056), M, C.setRGB(1, 1, 1), (u, v) => [sg.uv[0] + u * 0.5, sg.uv[1] + v * 0.5]);
      api.block(x, z, bw / 2 + 0.5);
      break;
    }
  }
  const woodMesh = new THREE.Mesh(accGeo(THREE, wood), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  const signMesh = new THREE.Mesh(accGeo(THREE, signs), new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.85, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.25 }));
  woodMesh.castShadow = woodMesh.receiveShadow = signMesh.receiveShadow = true;
  world.add(woodMesh, signMesh);

  // ---- instanced vegetation & rocks ----
  const D = new THREE.Object3D();
  function instanced(geo, mat, list, shadow = true) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((it, k) => {
      D.position.fromArray(it.p); D.rotation.fromArray(it.r); D.scale.fromArray(it.s); D.updateMatrix();
      im.setMatrixAt(k, D.matrix); im.setColorAt(k, it.c);
    });
    im.count = list.length;
    im.castShadow = shadow; im.receiveShadow = true;
    world.add(im);
    return im;
  }
  const scatter = (n, tries, fn) => { const out = []; for (let t = 0; t < tries && out.length < n; t++) { const it = fn(); if (it) out.push(it); } return out; };
  const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  const tilt = () => [(rnd() - 0.5) * 0.08, rnd() * TAU, (rnd() - 0.5) * 0.08];
  function lump(detail, amt) {
    const g = new THREE.IcosahedronGeometry(1, detail), P = g.attributes.position, jit = new Map();
    for (let i = 0; i < P.count; i++) {
      const key = `${P.getX(i).toFixed(3)},${P.getY(i).toFixed(3)},${P.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, 1 + (rnd() - 0.5) * amt);
      const s = jit.get(key);
      P.setXYZ(i, P.getX(i) * s, Math.max(P.getY(i) * s, -0.35), P.getZ(i) * s);
    }
    g.computeVertexNormals();
    return g;
  }

  // saguaros (3 silhouettes) and barrel cacti; the rib texture wraps once around each cylinder
  const ribTex = api.canvasTex(64, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) { const k = 0.72 + 0.28 * Math.cos(x / w * TAU * 12); g.fillStyle = `rgb(${235 * k | 0},${240 * k | 0},${225 * k | 0})`; g.fillRect(x, 0, 1, h); }
    g.fillStyle = 'rgba(245,235,200,0.55)';
    for (let n = 0; n < 90; n++) g.fillRect((Math.random() * 12 | 0) * w / 12 + w / 24, Math.random() * h, 1, 1);
  });
  const cactusMat = new THREE.MeshStandardMaterial({ map: ribTex, roughness: 0.8 });
  function saguaro(arms) {
    const parts = [new THREE.CylinderGeometry(0.42, 0.5, 6, 10, 2).translate(0, 3, 0), new THREE.SphereGeometry(0.42, 10, 3, 0, TAU, 0, Math.PI / 2).translate(0, 6, 0)];
    for (const [sx, y, out, up, rr] of arms) {
      const ex = sx * (0.3 + out);
      parts.push(new THREE.CylinderGeometry(rr, rr, out + 0.3, 8).rotateZ(Math.PI / 2).translate(sx * (0.3 + out) / 2, y, 0));
      parts.push(new THREE.SphereGeometry(rr * 1.02, 8, 4).translate(ex, y, 0));
      parts.push(new THREE.CylinderGeometry(rr, rr * 1.02, up, 8).translate(ex, y + up / 2, 0));
      parts.push(new THREE.SphereGeometry(rr, 8, 2, 0, TAU, 0, Math.PI / 2).translate(ex, y + up, 0));
    }
    return mergeGeometries(parts);
  }
  const sagGeos = [saguaro([[1, 2.5, 0.85, 2.3, 0.3], [-1, 3.3, 0.7, 1.7, 0.27]]), saguaro([[1, 2.9, 0.8, 2.0, 0.3]]), saguaro([])];
  const sag = [[], [], []];
  scatter(190, 3000, () => {
    const [x, z] = beside(W2 + 13, 230, 1.8);
    if (!clear(x, z, 1.4, true, 2)) return null;
    const s = 0.75 + rnd() * 0.6;
    sag[rnd() < 0.5 ? 0 : rnd() < 0.6 ? 1 : 2].push({ p: [x, ground(x, z) - 0.3, z], r: tilt(), s: [s, s * (0.85 + rnd() * 0.35), s], c: hsl(0.22 + rnd() * 0.06, 0.28 + rnd() * 0.14, 0.3 + rnd() * 0.1) });
    return true;
  });
  sagGeos.forEach((g, k) => instanced(g, cactusMat, sag[k]));
  instanced(new THREE.SphereGeometry(0.5, 10, 6).scale(1, 1.25, 1).translate(0, 0.45, 0), cactusMat, scatter(110, 1500, () => {
    const [x, z] = beside(W2 + 12.5, 90, 2);
    if (!clear(x, z, 0.8, false)) return null;
    const s = 0.6 + rnd() * 0.6;
    return { p: [x, ground(x, z) - 0.1, z], r: tilt(), s: [s, s, s], c: hsl(0.16 + rnd() * 0.06, 0.4, 0.36 + rnd() * 0.1) };
  }));

  // boulders: talus around the formations + scattered
  const boulders = [];
  for (const [fx, fz, fr] of forms) for (let k = 0, n = 5 + (rnd() * 9 | 0); k < n; k++) {
    const a = rnd() * TAU, d = fr * (1.35 + rnd() * 0.6), x = fx + Math.sin(a) * d, z = fz + Math.cos(a) * d, s = 0.8 + rnd() * 2.6;
    if (clear(x, z, s * 1.3, false)) boulders.push({ p: [x, ground(x, z) - 0.15 * s, z], r: [rnd(), rnd() * TAU, rnd()], s: [s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.5), s * (0.8 + rnd() * 0.6)], c: hsl(0.035 + rnd() * 0.04, 0.5 + rnd() * 0.15, 0.28 + rnd() * 0.14) });
  }
  boulders.push(...scatter(260, 3000, () => {
    const [x, z] = beside(W2 + 12.5, 260, 1.5), s = 0.35 + rnd() ** 3 * 3.2;
    if (!clear(x, z, s * 1.3, s > 2.5)) return null;
    return { p: [x, ground(x, z) - 0.15 * s, z], r: [rnd(), rnd() * TAU, rnd()], s: [s * (0.8 + rnd() * 0.6), s * (0.5 + rnd() * 0.5), s * (0.8 + rnd() * 0.6)], c: hsl(0.035 + rnd() * 0.045, 0.45 + rnd() * 0.2, 0.28 + rnd() * 0.16) };
  }));
  instanced(lump(1, 0.35), new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }), boulders);

  // dry brush: three crossed cards with a twiggy sagebrush silhouette (solid low-poly lumps read as green rocks)
  const brushTex = api.canvasTex(128, 128, (g, w, h) => {
    g.lineCap = 'round';
    const leaf = [];
    for (let k = 0; k < 30; k++) {
      let x = w / 2 + (Math.random() - 0.5) * 16, y = h - 1, a = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
      const L = h * (0.3 + Math.random() * 0.55), n = 6;
      for (let s = 0; s < n; s++) {
        const nx = x + Math.cos(a) * L / n, ny = y + Math.sin(a) * L / n;
        g.strokeStyle = '#6e604e'; g.lineWidth = 3.2 * (1 - s / n) + 0.8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        x = nx; y = ny; a += (Math.random() - 0.5) * 0.5 + (a < -Math.PI / 2 ? 0.04 : -0.04);
        if (s > 1) leaf.push([x, y]);
      }
    }
    for (const [x, y] of leaf) for (let k = 0; k < 3; k++) {
      const v = 190 + Math.random() * 60 | 0;
      g.fillStyle = `rgb(${v},${v + 8},${v - 30})`;
      g.beginPath(); g.arc(x + (Math.random() - 0.5) * 9, y + (Math.random() - 0.5) * 9, 1.8 + Math.random() * 2.6, 0, TAU); g.fill();
    }
  }, false);
  const brushGeo = mergeGeometries([0, 1, 2].map(k => new THREE.PlaneGeometry(2.3, 1.6).translate(0, 0.74, 0).rotateY(k * Math.PI / 3)));
  brushGeo.attributes.normal.array.fill(0).forEach((_, i, a) => { if (i % 3 === 1) a[i] = 1; });   // lit like the ground, no dark card faces
  instanced(brushGeo, new THREE.MeshStandardMaterial({ map: brushTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }), scatter(450, 4000, () => {
    const [x, z] = beside(W2 + 12.5, 260, 2), s = 0.6 + rnd() * 0.9;
    if (!clear(x, z, s, false)) return null;
    return { p: [x, ground(x, z) - 0.08, z], r: [0, rnd() * TAU, 0], s: [s, s * (0.75 + rnd() * 0.5), s], c: rnd() < 0.6 ? hsl(0.2 + rnd() * 0.06, 0.28 + rnd() * 0.12, 0.42 + rnd() * 0.1) : hsl(0.1 + rnd() * 0.03, 0.45, 0.5 + rnd() * 0.1) };
  }), false);
  const tuft = (() => {
    const p = [];
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * TAU + rnd() * 0.6, lean = 0.2 + rnd() * 0.35, h = 0.45 + rnd() * 0.5, bx = Math.cos(a) * 0.08, bz = Math.sin(a) * 0.08, px = -Math.sin(a) * 0.06, pz = Math.cos(a) * 0.06;
      p.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, Math.cos(a) * lean, h, Math.sin(a) * lean);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));   // lit like the ground
    return g;
  })();
  instanced(tuft, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide }), scatter(1400, 7000, () => {
    const [x, z] = beside(W2 + 12.3, 140, 2.2), s = 0.7 + rnd() * 0.7;
    if (!clear(x, z, 0.4, false)) return null;
    return { p: [x, ground(x, z) - 0.05, z], r: [0, rnd() * TAU, 0], s: [s, s, s], c: hsl(0.1 + rnd() * 0.04, 0.45 + rnd() * 0.2, 0.5 + rnd() * 0.15) };
  }), false);

  // ---- big low sun + sunset-lit cloud streaks, both pinned to whichever camera is rendering ----
  const sd = new THREE.Vector3(...SUN).normalize(), camPos = new THREE.Vector3();
  const sunTex = api.canvasTex(256, 256, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.07, 'rgba(255,238,200,1)'); gr.addColorStop(0.085, 'rgba(255,190,110,0.7)');
    gr.addColorStop(0.25, 'rgba(255,140,70,0.22)'); gr.addColorStop(0.6, 'rgba(255,110,60,0.05)'); gr.addColorStop(1, 'rgba(255,100,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  sunMesh.scale.setScalar(1150);
  sunMesh.frustumCulled = false;
  sunMesh.renderOrder = -9;
  sunMesh.onBeforeRender = (r, s, cam) => {
    sunMesh.position.copy(camPos.setFromMatrixPosition(cam.matrixWorld)).addScaledVector(sd, 2500);
    sunMesh.quaternion.copy(cam.quaternion);
    sunMesh.updateMatrixWorld();
  };
  const cloudTex = api.canvasTex(2048, 256, (g, w, h) => {
    const uS = ((Math.atan2(sd.x, sd.z) / TAU) % 1 + 1) % 1;
    // soft streaks: draw each ellipse far off the canvas and keep only its blurred shadow
    // (ctx.filter would be simpler, but WebKit ignores it and the streaks come out hard-edged)
    const OFF = 4 * w;
    g.fillStyle = '#000';
    g.shadowOffsetX = OFF;
    for (let n = 0; n < 80; n++) {
      const u = rnd(), y = h * (0.3 + rnd() * 0.5);
      let du = Math.abs(u - uS); du = Math.min(du, 1 - du);
      const col = du < 0.07 ? '255,222,160' : du < 0.2 ? '255,170,140' : du < 0.32 ? '232,140,160' : '160,120,170';
      g.shadowBlur = 2 * (2 + rnd() * 5);   // shadowBlur = 2 sigma, blur(px) = 1 sigma
      g.shadowColor = `rgba(${col},${0.25 + rnd() * 0.4})`;
      const len = 60 + rnd() * 380, th = 2 + rnd() * 8 * (1 - y / h * 0.5);
      for (const ox of [-w, 0, w]) { g.beginPath(); g.ellipse(u * w + ox - OFF, y, len, th, 0, 0, TAU); g.fill(); }
    }
    g.shadowColor = 'transparent';
  });
  cloudTex.wrapT = THREE.ClampToEdgeWrapping;
  const clouds = new THREE.Mesh(new THREE.CylinderGeometry(2400, 2400, 520, 48, 1, true).translate(0, 340, 0),
    new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }));
  clouds.frustumCulled = false;
  clouds.renderOrder = -8;
  clouds.onBeforeRender = (r, s, cam) => { clouds.position.setFromMatrixPosition(cam.matrixWorld); clouds.updateMatrixWorld(); };
  // sunset gradient dome drawn over the shared sky: gold horizon under the sun, rose/violet away from it, indigo zenith
  // stops: [elevation°, toward-sun colour, away-from-sun colour]; the horizon stop matches the fog so distant mesas melt in
  const STOPS = [[0, '#ffbf7c', '#efa184'], [5, '#ffa468', '#e3929a'], [14, '#f2816e', '#b97ca6'], [32, '#9f6598', '#82649a'], [60, '#4d4a8e', '#454389'], [90, '#2b2e72', '#2b2e72']]
    .map(([e, a, b]) => [e, new THREE.Color(a), new THREE.Color(b)]);
  const domeGeo = new THREE.SphereGeometry(2000, 64, 32), DP = domeGeo.attributes.position, dcol = [], ca = new THREE.Color(), cb = new THREE.Color();
  const sh = Math.hypot(sd.x, sd.z);
  for (let i = 0; i < DP.count; i++) {
    V.fromBufferAttribute(DP, i).normalize();
    const e = Math.asin(V.y) * 180 / Math.PI, hz = Math.hypot(V.x, V.z) || 1, w = (((V.x * sd.x + V.z * sd.z) / (hz * sh) + 1) / 2) ** 2.2;
    let k = 0;
    while (k < STOPS.length - 2 && e > STOPS[k + 1][0]) k++;
    const [e0, a0, b0] = STOPS[k], [e1, a1, b1] = STOPS[k + 1], t = Math.min(1, Math.max(0, (e - e0) / (e1 - e0)));
    ca.lerpColors(b0, a0, w).lerp(cb.lerpColors(b1, a1, w), t);
    dcol.push(ca.r, ca.g, ca.b);
  }
  domeGeo.setAttribute('color', new THREE.Float32BufferAttribute(dcol, 3));
  const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false }));
  dome.frustumCulled = false;
  dome.renderOrder = -9.5;
  dome.onBeforeRender = (r, s, cam) => { dome.position.setFromMatrixPosition(cam.matrixWorld); dome.updateMatrixWorld(); };
  world.add(dome, sunMesh, clouds);

  // ---- animated: tumbleweeds rolling along the roadside, vultures circling ----
  const weedGeo = (() => {
    const a = acc(), m = new THREE.Matrix4(), ring = new THREE.TorusGeometry(1, 0.05, 3, 14), E2 = new THREE.Euler();
    for (let k = 0; k < 18; k++) {
      m.makeRotationFromEuler(E2.set(rnd() * TAU, rnd() * TAU, 0)).scale(V.setScalar(0.45 + rnd() * 0.55));
      addGeo(a, ring, m, C.setHSL(0.09, 0.35, 0.42 + rnd() * 0.2));
    }
    addGeo(a, lump(1, 0.5), m.makeScale(0.5, 0.5, 0.5), C.setHSL(0.08, 0.32, 0.36));
    return accGeo(THREE, a);
  })();
  const WN = 16, weeds = [], weedMesh = new THREE.InstancedMesh(weedGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), WN);
  weedMesh.frustumCulled = false;
  weedMesh.castShadow = true;
  const ax = new THREE.Vector3(), qa = new THREE.Quaternion(), sc = new THREE.Vector3();
  function respawn(w) {
    w.age = 0; w.life = -1;
    for (let t = 0; t < 20; t++) {
      const i = Math.random() * N | 0, sg = Math.random() < 0.5 ? -1 : 1, d = W2 + 15 + Math.random() * 28;
      const x = S[i].pos.x + RT[i].x * sg * d, z = S[i].pos.z + RT[i].z * sg * d;
      if (!api.isFree(x, z, 3)) continue;
      const dir = Math.random() < 0.5 ? 1 : -1, sp = 3 + Math.random() * 4;
      Object.assign(w, { x, z, vx: (S[i].tan.x * dir + RT[i].x * sg * 0.25) * sp, vz: (S[i].tan.z * dir + RT[i].z * sg * 0.25) * sp, r: 0.55 + Math.random() * 0.45, life: 8 + Math.random() * 9 });
      return;
    }
  }
  for (let k = 0; k < WN; k++) { const w = { x: cx, z: cz, r: 0.6, q: new THREE.Quaternion(), hop: Math.random() * TAU, chk: Math.random() * 0.15 }; respawn(w); w.age = Math.random() * 4; weeds.push(w); }
  const birdGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.9, -3.4, 0.45, -0.25, 0, 0, -0.6, 0, 0, 0.9, 0, 0, -0.6, 3.4, 0.45, -0.25, 0, 0, -0.4, -0.55, 0, -1.4, 0.55, 0, -1.4,
  ], 3));
  birdGeo.computeVertexNormals();
  const birds = Array.from({ length: 4 }, () => {
    const bx = cx + (rnd() - 0.5) * 320, bz = cz + (rnd() - 0.5) * 320;
    return { bx, bz, y: ground(bx, bz) + 60 + rnd() * 40, R: 25 + rnd() * 40, w: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? -1 : 1), a: rnd() * TAU };
  });
  const birdMesh = new THREE.InstancedMesh(birdGeo, new THREE.MeshLambertMaterial({ color: 0x2a1c18, side: THREE.DoubleSide }), birds.length);
  birdMesh.frustumCulled = false;
  world.add(weedMesh, birdMesh);

  api.onUpdate((dt, time) => {
    dt = Math.min(dt, 0.1);
    weeds.forEach((w, k) => {
      w.age += dt;
      if (w.age >= w.life) respawn(w);
      const gust = 0.7 + 0.45 * Math.sin(time * 0.9 + k * 1.7), vx = (w.vx || 0) * gust, vz = (w.vz || 0) * gust, sp = Math.hypot(vx, vz);
      w.x += vx * dt; w.z += vz * dt;
      if ((w.chk -= dt) <= 0) { w.chk = 0.15; if (w.life - w.age > 0.45 && !api.isFree(w.x, w.z, 2.5)) w.life = w.age + 0.45; }
      w.hop += dt * sp / (w.r * 3.2);
      if (sp > 0) w.q.premultiply(qa.setFromAxisAngle(ax.set(vz, 0, -vx).normalize(), sp * dt / w.r));
      const s = w.life > 0 ? w.r * Math.min(1, w.age / 0.5, (w.life - w.age) / 0.45) : 0;
      M.compose(V.set(w.x, ground(w.x, w.z) + w.r * 0.9 + Math.abs(Math.sin(w.hop)) * w.r * 1.1, w.z), w.q, sc.setScalar(Math.max(s, 1e-3)));
      weedMesh.setMatrixAt(k, M);
    });
    weedMesh.instanceMatrix.needsUpdate = true;
    birds.forEach((b, k) => {
      b.a += b.w * dt;
      const vx = -Math.sin(b.a) * Math.sign(b.w), vz = Math.cos(b.a) * Math.sign(b.w);
      D.position.set(b.bx + Math.cos(b.a) * b.R, b.y + Math.sin(time * 0.3 + k) * 3, b.bz + Math.sin(b.a) * b.R);
      D.rotation.set(0, Math.atan2(vx, vz), -Math.sign(b.w) * 0.35, 'YXZ');
      D.scale.setScalar(1.3);
      D.updateMatrix();
      birdMesh.setMatrixAt(k, D.matrix);
    });
    birdMesh.instanceMatrix.needsUpdate = true;
  });
}

export default { env, build };
