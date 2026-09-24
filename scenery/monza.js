// Monza: the royal park. Tall plane trees and oaks line most of the lap; the old concrete high-speed banking
// (Curva Sud) curves through the woods behind the Parabolica; the historic main grandstand faces the pits;
// the podium juts out over the pit lane; tifosi wave red flags in the stands.
// Also exports kit(api): the shared builders used by silverstone.js and hockenheim.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ======================================================================================
// kit: track-following sweeps (stands, buildings, run-offs), merged buckets, chunked instancing, trees, flags
// ======================================================================================
export function kit(api) {
  const { track, world, rnd } = api, S = track.samples, N = track.N, W2 = track.width / 2;
  const WALL = W2 + (api.def.wallGap ?? 9.4);
  const R = (a, b) => a + rnd() * (b - a);
  const wrapI = i => ((Math.round(i) % N) + N) % N;
  const M4 = new THREE.Matrix4(), EU = new THREE.Euler(), dummy = new THREE.Object3D();

  // coarse nearest-sample field (8 m cells, 320 m reach) -> fast exact distance to the centreline
  const C = 8, RC = 40, b = track.bounds, gx = b.minX - RC * C, gz = b.minZ - RC * C;
  const GW = Math.ceil((b.maxX - b.minX) / C) + 2 * RC + 1, GH = Math.ceil((b.maxZ - b.minZ) / C) + 2 * RC + 1;
  const fd = new Float32Array(GW * GH).fill(1e12), fi = new Uint16Array(GW * GH);
  for (let i = 0; i < N; i++) {
    const p = S[i].pos, ci = Math.floor((p.x - gx) / C), cj = Math.floor((p.z - gz) / C);
    for (let j = cj - RC; j <= cj + RC; j++) for (let k = ci - RC; k <= ci + RC; k++) {
      const dx = gx + (k + 0.5) * C - p.x, dz = gz + (j + 0.5) * C - p.z, d = dx * dx + dz * dz, q = j * GW + k;
      if (d < fd[q]) { fd[q] = d; fi[q] = i; }
    }
  }
  // { d: distance to the centreline (exact within ~300 m, else 1e6), i: nearest sample, lat: signed lateral (+ = right) }
  function nearest(x, z) {
    const k = Math.floor((x - gx) / C), j = Math.floor((z - gz) / C);
    let bd = Infinity, bi = -1;
    for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const kk = k + dk, jj = j + dj;
      if (kk < 0 || jj < 0 || kk >= GW || jj >= GH || fd[jj * GW + kk] > 1e11) continue;
      const i0 = fi[jj * GW + kk];
      for (let o = -4; o <= 4; o++) { const i = wrapI(i0 + o), p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    }
    if (bi < 0) return { d: 1e6, i: 0, lat: 1e6 };
    const s = S[bi];
    return { d: Math.sqrt(bd), i: bi, lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z };
  }
  // corner side per sample (sign of the sharpest curvature within ±30 samples, + = left turn; 0 = straight):
  // tall things stay >= 20 m behind the barrier on the inside of corners, where the chase camera looks across
  const corner = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -30; k <= 30; k += 3) { const c = S[wrapI(i + k)].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
    corner[i] = Math.abs(m) > 1 / 160 ? Math.sign(m) : 0;
  }
  const tallOk = n => n.d >= WALL + 22 || corner[n.i] === 0 || Math.sign(n.lat) === corner[n.i];
  // outside side of the bend between samples i0..i1 (+1 = right), and infield test (even-odd over the centreline)
  const outside = (i0, i1) => { let c = 0; for (let i = i0; i <= i1; i++) c += S[wrapI(i)].curv; return c > 0 ? 1 : -1; };
  const infield = (x, z) => {
    let inside = false;
    for (let i = 0; i < N; i += 4) {
      const a = S[i].pos, c = S[(i + 4) % N].pos;
      if ((a.z > z) !== (c.z > z) && x < a.x + (z - a.z) * (c.x - a.x) / (c.z - a.z)) inside = !inside;
    }
    return inside;
  };
  const blockers = [];
  const blocked = (x, z, r) => blockers.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < (q.r + r) ** 2);
  const block = (x, z, r) => { blockers.push({ x, z, r }); api.block(x, z, r); };
  // free: clear of the barrier by `gap` (+ r) and of everything blocked so far
  const free = (x, z, r = 0, gap = 1.5) => api.near(x, z)[0] >= WALL + gap + r && nearest(x, z).d >= WALL + gap + r && !blocked(x, z, r);

  // ---- merged buckets: every static part is baked into one mesh per material
  const buckets = new Map();
  const bucket = (name, mat, uv = false, shadow = true) => { buckets.set(name, { mat, uv, shadow, geos: [] }); return name; };
  bucket('solid', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }));
  bucket('metal', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }));
  bucket('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.75, side: THREE.DoubleSide }));
  const texBucket = (name, tex, o = {}) => bucket(name, new THREE.MeshStandardMaterial({
    map: tex, vertexColors: true, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, side: THREE.DoubleSide,
    ...(o.offset ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
  }), true, o.shadow ?? true);
  const tint = (geo, color) => {
    const c = new THREE.Color(color), n = geo.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  };
  // primitive -> placed, coloured, non-indexed, into bucket bk
  function add(bk, geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const B = buckets.get(bk), g = geo.index ? geo.toNonIndexed() : geo;
    if (!B.uv) g.deleteAttribute('uv');
    tint(g, color).applyMatrix4(M4.makeRotationFromEuler(EU.set(rx, ry, rz, 'YXZ')).setPosition(x, y, z));
    B.geos.push(g);
    return g;
  }
  // frame at sample i on side sg: local +Z = outward (away from the road), origin on the centreline
  const frame = (i, sg) => { const s = S[wrapI(i)]; return { s, x: s.pos.x, y: s.pos.y, z: s.pos.z, nx: s.right.x * sg, nz: s.right.z * sg, ry: Math.atan2(s.right.x * sg, s.right.z * sg) }; };
  function addAt(bk, geo, color, i, sg, lat, y, along = 0, ry = 0) {
    const f = frame(i, sg), tx = f.s.tan.x, tz = f.s.tan.z;
    return add(bk, geo, color, f.x + f.nx * lat + tx * along, f.y + y, f.z + f.nz * lat + tz * along, f.ry + ry);
  }

  // ---- sweeps: a 2D profile (lateral l, height y) swept along a path of { x, y, z, nx, nz } (n = outward unit)
  // edge = { a: [l, y] | p => [l, y], b, c: colour, bk: bucket, uw: metres per texture repeat along, off, v: [v at a, v at b] }
  function sweep(path, edges) {
    for (const e of edges) {
      const B = buckets.get(e.bk || 'solid'), pos = [], uv = [];
      const P = (p, q) => { const [l, y] = typeof q === 'function' ? q(p) : q; return [p.x + p.nx * l, p.y + y, p.z + p.nz * l]; };
      let u = e.off ?? rnd();
      for (let k = 0; k < path.length - 1; k++) {
        const a0 = P(path[k], e.a), b0 = P(path[k], e.b), a1 = P(path[k + 1], e.a), b1 = P(path[k + 1], e.b);
        pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
        const u1 = u + Math.hypot(a1[0] - a0[0], a1[2] - a0[2]) / (e.uw || 10);
        const [v0, v1] = e.v || [0, 1];
        uv.push(u, v0, u, v1, u1, v0, u, v1, u1, v1, u1, v0);
        u = u1;
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      if (B.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      B.geos.push(tint(g, e.c || '#ffffff'));
    }
  }
  // flat end walls: rects [l0, l1, y0, y1] in the profile plane at path point p
  function cap(p, rects, color, bk = 'solid') {
    for (const [l0, l1, y0, y1] of rects) {
      const q = (l, y) => [p.x + p.nx * l, p.y + y, p.z + p.nz * l], A = q(l0, y0), B = q(l1, y0), C2 = q(l1, y1), D = q(l0, y1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...A, ...B, ...C2, ...A, ...C2, ...D], 3));
      if (buckets.get(bk).uv) g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      g.computeVertexNormals();
      buckets.get(bk).geos.push(tint(g, color));
    }
  }
  // path along the track from sample i0 to i1 (i1 may pass N: wraps) on side sg
  function trackPath(i0, i1, sg, step = 2, dy = -0.2) {
    const out = [];
    for (let i = i0; ; i = Math.min(i + step, i1)) {
      const s = S[wrapI(i)];
      out.push({ x: s.pos.x, y: s.pos.y + dy, z: s.pos.z, nx: s.right.x * sg, nz: s.right.z * sg, i: wrapI(i), sg });
      if (i >= i1) break;
    }
    return out;
  }
  // on the inside of a real bend here (±12 samples, radius < 90 m)? tall things there would block the chase camera
  const insideBend = (i, sg) => { let m = 0; for (let k = -12; k <= 12; k += 2) { const c = S[wrapI(i + k)].curv; if (Math.abs(c) > Math.abs(m)) m = c; } return Math.abs(m) > 1 / 90 && Math.sign(m) === -sg; };
  // split a path into runs whose footprint (lateral l0..l1) is free (and, for tall things on track paths, not on the
  // inside of a bend when closer than 20 m behind the barrier); blocks what it keeps
  function clip(path, l0, l1, gap = 1.5, minLen = 3, tall = true) {
    const ok = path.map(p => !(tall && p.sg && l0 < WALL + 20 && insideBend(p.i, p.sg)) && [l0, (l0 + l1) / 2, l1].every(l => free(p.x + p.nx * l, p.z + p.nz * l, 0, gap)));
    const runs = [];
    let cur = [];
    path.forEach((p, k) => { if (ok[k]) cur.push(p); else { if (cur.length >= minLen) runs.push(cur); cur = []; } });
    if (cur.length >= minLen) runs.push(cur);
    const r = (l1 - l0) / 2 + 1, lm = (l0 + l1) / 2;
    for (const run of runs) for (const p of run) block(p.x + p.nx * lm, p.z + p.nz * lm, r);
    return runs;
  }

  // ---- grandstands: stepped rows (a painted crowd on each riser), back wall, optional cantilever roof on masts
  function crowdBucket(palette, key = 'crowd', empty = 0.12) {
    const tex = api.canvasTex(1024, 64, (g, w, h) => {
      g.fillStyle = '#3a3d44'; g.fillRect(0, 0, w, h);
      for (let x = 2; x < w; x += 12 + Math.random() * 3) {
        if (Math.random() < empty) { g.fillStyle = '#5a5f69'; g.fillRect(x, h * 0.45, 9, h * 0.55); continue; }
        g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        g.fillRect(x, h * 0.42 + Math.random() * 4, 10, h);
        g.fillStyle = ['#f0c8a0', '#d9a577', '#8d5a3a', '#f5d6b8'][Math.floor(Math.random() * 4)];
        g.beginPath(); g.arc(x + 5, h * 0.3 + Math.random() * 4, 4.2, 0, TAU); g.fill();
        if (Math.random() < 0.3) { g.fillStyle = Math.random() < 0.5 ? '#2a2018' : '#e8d7a8'; g.fillRect(x + 1, h * 0.14, 8, 5); }
      }
    });
    return texBucket(key, tex, { rough: 0.9 });
  }
  // o: { front (lat of the front wall), rows, rise, depth, base (front wall height), roof, roofH, over, conc, seat,
  //      roofC, fascia, crowd (bucket), gap, onRun(run, geometry) }
  function stand(path, o = {}) {
    const rows = o.rows ?? 12, rise = o.rise ?? 0.6, dep = o.depth ?? 0.95, base = o.base ?? 1.3, F = o.front ?? WALL + 3.5;
    const back = F + rows * dep, top = base + rows * rise, conc = o.conc ?? '#b8bcc4', ck = o.crowd ?? 'crowd';
    const runs = clip(path, F - 0.5, back + (o.roof ? 1 : 0.5), o.gap ?? 1.5);
    for (const run of runs) {
      const E = [{ a: [F, -1.5], b: [F, base], c: o.wall ?? conc }, { a: [back, -1.5], b: [back, top + 2.2], c: conc }];
      const rects = [[F, back, -1.5, base], [back - 0.3, back, top, top + 2.2]];
      for (let r = 0; r < rows; r++) {
        const l0 = F + r * dep, y0 = base + r * rise;
        E.push({ a: [l0, y0], b: [l0, y0 + rise], bk: ck, uw: 11 + rnd() * 2 });
        E.push({ a: [l0, y0 + rise], b: [l0 + dep, y0 + rise], c: o.seat ?? conc });
        rects.push([l0, back, y0, y0 + rise]);
      }
      if (o.roof) {
        const rh = top + (o.roofH ?? 4.2), lf = F + (o.over ?? 0.35) * (back - F);
        E.push({ a: [back + 0.6, rh + 0.4], b: [lf, rh], c: o.roofC ?? '#e9ecf0' });
        E.push({ a: [lf, rh - 0.9], b: [lf, rh + 0.05], c: o.fascia ?? '#d7263d' });
        const d = Math.hypot(back - lf, 1.6), ang = Math.atan2(back - lf, 1.6);   // tie from the mast top to the roof edge
        for (let k = 0; k < run.length; k += 2) {
          const p = run[k], ry = Math.atan2(p.nx, p.nz);
          add('metal', new THREE.BoxGeometry(0.35, rh + 1.8 - top, 0.35), '#8d939c', p.x + p.nx * (back + 0.3), p.y + (top + rh + 1.8) / 2, p.z + p.nz * (back + 0.3), ry);
          add('metal', new THREE.BoxGeometry(0.16, d, 0.16), '#8d939c', p.x + p.nx * (back + lf) / 2, p.y + rh + 0.8, p.z + p.nz * (back + lf) / 2, ry, ang);
        }
      }
      sweep(run, E);
      cap(run[0], rects, conc); cap(run[run.length - 1], rects, conc);
      if (o.onRun) o.onRun(run, { F, back, top, rows, rise, dep, base });
    }
    return runs;
  }

  // ---- chunked instancing (500 m cells, so distant groups are frustum-culled); items: { x, y, z, ry, rx, rz, sx, sy, sz, c }
  function inst(geo, mat, items, { cell = 500, shadow = true } = {}) {
    const groups = new Map(), col = new THREE.Color();
    for (const it of items) { const k = `${Math.floor(it.x / cell)},${Math.floor(it.z / cell)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const list of groups.values()) {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, n) => {
        dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
        dummy.scale.set(it.sx ?? 1, it.sy ?? it.sx ?? 1, it.sz ?? it.sx ?? 1); dummy.updateMatrix();
        m.setMatrixAt(n, dummy.matrix);
        if (it.c) m.setColorAt(n, col.set(it.c));
      });
      m.castShadow = shadow; m.receiveShadow = true;
      world.add(m);
    }
  }

  // ---- trees. Crowns are centred at y = 0 with radius ~1; trunks are unit-height cylinders.
  const lobes = k => mergeGeometries((k === 2 ? [[0.38, 0.02, 0.1, 0.92], [-0.42, -0.08, -0.15, 0.86]] : [[0, 0, 0, 1], [0.62, -0.18, 0.2, 0.72], [-0.58, -0.12, -0.3, 0.7], [0.1, 0.45, -0.1, 0.62], [-0.2, -0.3, 0.6, 0.6]].slice(0, k))
    .map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z)));
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.88, flatShading: true });
  const barkMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const trunkGeo = new THREE.CylinderGeometry(0.62, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  const vc = (geo, color) => { const g = tint(geo.index ? geo.toNonIndexed() : geo, color); g.deleteAttribute('uv'); return g; };
  const farGeo = mergeGeometries([vc(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.9, 1).translate(0, 1.55, 0), '#ffffff'), vc(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 4, 1, true).translate(0, 0.6, 0), '#5a4a3c')]);
  const farMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true, vertexColors: true });
  // sets: [{ list: [{ x, z, h (total height), r (crown radius), c, bark, tw (trunk radius), sy }], crown: geometry, crownY }]
  // (one trunk mesh for all sets); far: [{ x, z, h, c, sy }] crown + stub in one mesh, no shadow. 800 m chunks.
  function forest(sets, far = []) {
    const trunks = [], o = { cell: 800 };
    for (const { list, crown = lobes(3), crownY = 0.85 } of sets) {
      const crowns = [], p = crown.attributes.position;
      let reach = 0;   // sideways reach of the unit crown (lobes stick out ~1.4 r)
      for (let k = 0; k < p.count; k++) reach = Math.max(reach, Math.hypot(p.getX(k), p.getZ(k)));
      for (const t of list) {
        // the whole crown stays behind the barrier: shrink it to fit, drop the tree if that leaves only a stick
        const r = Math.min(t.r, (nearest(t.x, t.z).d - WALL - 1.5) / (reach * 1.1));
        if (r < t.r * 0.45) continue;
        const y = api.groundAt(t.x, t.z), th = t.h - r * 1.45;
        crowns.push({ x: t.x, y: y + th + r * crownY, z: t.z, ry: rnd() * TAU, sx: r, sy: r * (t.sy ?? (0.85 + rnd() * 0.3)), sz: r * (0.9 + rnd() * 0.2), c: t.c });
        trunks.push({ x: t.x, y: y - 0.3, z: t.z, sx: t.tw ?? 0.45, sy: th + r * 0.6, c: t.bark ?? '#6b5a48' });
      }
      inst(crown, leafMat, crowns, o);
    }
    inst(trunkGeo, barkMat, trunks, o);
    if (far.length) inst(farGeo, farMat, far.map(t => ({ x: t.x, y: api.groundAt(t.x, t.z) - 0.4, z: t.z, ry: rnd() * TAU, sx: t.h / 2.6, sy: t.h / 2.6 * (t.sy ?? 1), c: t.c })), { ...o, shadow: false });
  }

  // ---- paddock: rows of team trucks parked along the track between laterals l0..l1 on side sg
  const truckGeo = mergeGeometries([vc(new THREE.BoxGeometry(2.5, 3.5, 12.5).translate(0, 2.2, 0), '#ffffff'), vc(new THREE.BoxGeometry(2.45, 2.9, 2.4).translate(0, 1.85, 7.7), '#c3c7cc'),
    vc(new THREE.BoxGeometry(2.3, 0.9, 2.3).translate(0, 0.5, -4.5), '#222222'), vc(new THREE.BoxGeometry(2.46, 0.9, 1.4).translate(0, 2.6, 8.3), '#1d2733')]);
  function paddock(i0, i1, sg, l0, l1, colors) {
    const items = [];
    for (let l = l0; l <= l1; l += 9) for (let i = i0; i <= i1; i += Math.max(1, Math.round(16 / track.spacing))) {
      const s = S[wrapI(i)], x = s.pos.x + s.right.x * sg * l, z = s.pos.z + s.right.z * sg * l;
      if (rnd() < 0.25 || !free(x, z, 7, 2)) continue;
      items.push({ x, y: api.groundAt(x, z) - 0.1, z, ry: Math.atan2(s.tan.x, s.tan.z) + (rnd() < 0.5 ? Math.PI : 0), c: colors[Math.floor(rnd() * colors.length)] });
    }
    for (const it of items) block(it.x, it.z, 7);
    inst(truckGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }), items, { cell: 800 });
  }

  // ---- waving flags: poles in the metal bucket, instanced cloth bent in the vertex shader
  const flagT = { value: 0 };
  function flags(list /* [{ x, y, z, c, h }] */) {
    if (!list.length) return;
    const cloth = new THREE.PlaneGeometry(1.5, 0.95, 6, 1).translate(0.75, -0.48, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uT = flagT;
      sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
        transformed.z += sin(uT * 7.0 - position.x * 2.4 + ph) * 0.2 * position.x;
        transformed.y += sin(uT * 4.3 - position.x * 1.9 + ph) * 0.05 * position.x;`);
    };
    for (const f of list) add('metal', new THREE.CylinderGeometry(0.03, 0.03, f.h ?? 2.2, 4), '#cfd3d8', f.x, f.y + (f.h ?? 2.2) / 2, f.z);
    inst(cloth, mat, list.map(f => ({ x: f.x, y: f.y + (f.h ?? 2.2), z: f.z, ry: rnd() * TAU, c: f.c })), { shadow: false });
    api.onUpdate(dt => { flagT.value += dt; });
  }

  // ---- recolour world.js's terrain sheet (no hook in the api); fn(x, z, nearest) -> colour | null (keep)
  function paintGround(fn) {
    const g = world.children.find(o => o.isMesh && !o.isInstancedMesh && o.geometry?.attributes?.color && o.geometry.type === 'PlaneGeometry');
    if (!g) return;
    const pos = g.geometry.attributes.position, col = g.geometry.attributes.color, base = new THREE.Color(api.env.terrain.base), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), t = fn(x, z, nearest(x, z));
      if (!t) continue;
      c.set(t);
      const v = (col.getX(i) + col.getY(i) + col.getZ(i)) / 2.7;   // keep world.js's brightness variation
      col.setXYZ(i, c.r / base.r * v, c.g / base.g * v, c.b / base.b * v);
    }
    col.needsUpdate = true;
  }

  // ---- run-off strips between the shoulder and the barrier (gravel by default)
  const gravelTex = api.canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9b48c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) { const v = 120 + Math.random() * 110; g.fillStyle = `rgba(${v},${v * 0.9},${v * 0.72},0.7)`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  });
  texBucket('gravel', gravelTex, { rough: 1, offset: true, shadow: false });
  // (skips the inside of tight turns, where the strip would fold over itself)
  function runoff(i0, i1, sg, bk = 'gravel', color = '#ffffff', l1 = WALL - 0.2) {
    let run = [];
    const out = () => { if (run.length > 1) sweep(run, [{ a: [W2 + 2.5, 0.0], b: [l1, -0.12], bk, uw: 8, c: color }]); run = []; };
    for (const p of trackPath(i0, i1, sg, 2, 0)) { const c = S[p.i].curv; if (Math.sign(c) === -sg && Math.abs(c) > 1 / (l1 + 25)) out(); else run.push(p); }
    out();
  }

  // ---- a drifting cloud deck (one fogged plane)
  function clouds(color = 0xf6f8fb, opacity = 1, count = 22, y = 240, alpha = 0.5) {
    const tex = api.canvasTex(512, 512, (g, w, h) => {
      for (let c = 0; c < count; c++) {
        const ox = rnd() * w, oy = rnd() * h, n = 5 + Math.floor(rnd() * 9), sp = 18 + rnd() * 46;
        for (let k = 0; k < n; k++) {
          const x = ox + (rnd() - 0.5) * sp * 2, y2 = oy + (rnd() - 0.5) * sp * 0.7, r = 12 + rnd() * 30;
          for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
            const gr = g.createRadialGradient(x + dx, y2 + dy, 0, x + dx, y2 + dy, r);
            gr.addColorStop(0, `rgba(255,255,255,${alpha})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(x + dx - r, y2 + dy - r, 2 * r, 2 * r);
          }
        }
      }
    });
    tex.repeat.set(4, 4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false }));
    m.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
    m.renderOrder = -5;
    world.add(m);
    api.onUpdate(dt => { tex.offset.x += dt * 0.0012; tex.offset.y += dt * 0.0005; });
    return m;
  }

  function flush() {
    for (const B of buckets.values()) {
      if (!B.geos.length) continue;
      const m = new THREE.Mesh(mergeGeometries(B.geos), B.mat);
      m.castShadow = B.shadow; m.receiveShadow = true;
      world.add(m);
      B.geos = [];
    }
  }

  return {
    S, N, W2, WALL, R, wrapI, nearest, corner, tallOk, outside, infield, free, block, blocked, add, addAt, frame, sweep, cap,
    trackPath, clip, stand, crowdBucket, texBucket, bucket, inst, forest, lobes, flags, paddock, paintGround, runoff, clouds, flush, tint,
  };
}

// ======================================================================================
// Monza
// ======================================================================================
const TEAMS = ['#c1121f', '#1d3557', '#f4f4f4', '#ff8700', '#0b6e4f', '#151515', '#2b6cb0', '#7a7f87', '#e0b000'];
const BANK = [110, 700, 165];   // Curva Sud: centre x, z and radius (the Parabolica curves round (100, 690), r ≈ 98)
const TIFOSI = ['#d40000', '#d40000', '#e10600', '#b80000', '#ffd400', '#f4f4f4', '#1d1d1d', '#d40000', '#2b5fb4', '#e10600', '#0f8a3c'];

export default {
  base: 'forest',
  baseBuild: false,
  env: {
    sky: { top: '#2a6cd4', horizon: '#d5e4ef', bottom: '#8fa98f' },
    fog: { color: '#d1dfea', near: 260, far: 1550 },
    sun: { dir: [-0.5, 0.62, 0.52], color: '#fff0d4', intensity: 2.9 },   // mid-afternoon, from the south-west
    hemi: { sky: '#d2e6ff', ground: '#4b6936', intensity: 0.85 },
    envIntensity: 0.4,
    terrain: { base: '#4f8a34', hills: 2.5, rim: 26, rimColor: '#34532f' },
  },
  build(api) {
    const K = kit(api), T = THREE, { S, WALL, R } = K, rnd = api.rnd;
    const flagList = [];
    K.crowdBucket(TIFOSI);

    // ---- main straight: pit building + podium on the right (east, the infield), historic main grandstand opposite
    const PF = 30;   // pit building front (lat); the pit lane runs between the wall and it
    const shutter = api.canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#c9ccd1'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d333d'; g.fillRect(10, 22, w - 20, h - 22);
      for (let y = 24; y < h; y += 5) { g.fillStyle = '#1f242c'; g.fillRect(10, y, w - 20, 1); }
      g.fillStyle = '#d7263d'; g.fillRect(0, 6, w, 8);
    });
    const glassTex = api.canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#23384d'; g.fillRect(4, 6, w - 8, h - 12);
      g.fillStyle = 'rgba(160,200,230,0.35)'; g.fillRect(4, 6, w - 8, 10);
      g.fillStyle = '#e9ecef'; g.fillRect(w / 2 - 2, 6, 4, h - 12);
    });
    K.texBucket('garage', shutter, { rough: 0.55, metal: 0.3 });
    K.texBucket('win', glassTex, { rough: 0.2, metal: 0.5 });
    K.clip(K.trackPath(1160, 1234, 1), WALL + 0.6, PF - 3, 0.2);   // keep the pit lane clear
    for (const run of K.clip(K.trackPath(1166, 1228, 1), PF, PF + 16, 1)) {
      K.sweep(run, [
        { a: [PF, -0.5], b: [PF, 4.6], bk: 'garage', uw: 6 },
        { a: [PF - 1.6, 4.6], b: [PF + 0.8, 4.6], c: '#f1f1f1' }, { a: [PF - 1.6, 4.2], b: [PF - 1.6, 4.9], c: '#f1f1f1' },
        { a: [PF + 0.8, 4.6], b: [PF + 0.8, 8.4], bk: 'win', uw: 4 },
        { a: [PF - 0.6, 8.4], b: [PF - 0.6, 9.3], c: '#eeeeee' }, { a: [PF - 0.6, 9.3], b: [PF + 16, 9.3], c: '#9aa0a6' },
        { a: [PF - 0.6, 8.4], b: [PF + 0.8, 8.4], c: '#dddddd' },
        { a: [PF + 16, -0.5], b: [PF + 16, 9.3], c: '#d9d9d9' },
        { a: [PF + 1.5, 9.3], b: [PF + 1.5, 10.4], bk: 'metal', c: '#b9c0c8' },   // roof-terrace railing
      ]);
      for (const p of [run[0], run[run.length - 1]]) K.cap(p, [[PF, PF + 16, -0.5, 9.3]], '#d9d9d9');
    }
    K.paddock(1168, 1226, 1, PF + 22, PF + 58, TEAMS);
    // pit lane asphalt between the wall and the garages, with its white line
    K.sweep(K.trackPath(1160, 1234, 1, 2, 0), [{ a: [WALL + 0.9, 0.03], b: [PF, 0.03], c: '#55585e' }, { a: [WALL + 4.2, 0.05], b: [WALL + 4.45, 0.05], c: '#eeeeee' }]);
    // podium: cantilevered out over the pit lane from the first floor, steps 2-1-3, tricolour band, backdrop
    {
      const P = (geo, c, lat, y, along = 0) => K.addAt('solid', geo, c, 6, 1, lat, y, along);
      P(new T.BoxGeometry(14, 0.8, 11.6), '#f4f4f4', 24.6, 10.3);
      for (const a of [-5.5, 5.5]) P(new T.BoxGeometry(0.7, 1.4, 11.6), '#c9cdd3', 24.6, 9.3, a);
      P(new T.BoxGeometry(14.2, 1.1, 0.25), '#f4f4f4', 18.9, 11.25);
      ['#169b45', '#f4f4f4', '#d7263d'].forEach((c, k) => P(new T.BoxGeometry(4.73, 0.8, 0.3), c, 18.7, 10.3, (k - 1) * 4.73));
      P(new T.BoxGeometry(2.4, 1.2, 2.2), '#f4f4f4', 23.5, 11.3);
      P(new T.BoxGeometry(2.4, 0.8, 2.2), '#f4f4f4', 23.5, 11.1, 2.5);
      P(new T.BoxGeometry(2.4, 0.5, 2.2), '#f4f4f4', 23.5, 10.95, -2.5);
      P(new T.BoxGeometry(15, 6.5, 0.5), '#f4f4f4', 29.4, 13.6);
      P(new T.BoxGeometry(15, 0.6, 0.6), '#d7263d', 29.2, 16.9);
      for (const a of [-7, 7]) P(new T.BoxGeometry(0.4, 7.5, 0.4), '#c9cdd3', 29.1, 13.4, a);
    }
    // stands, each with tifosi flags (n per path point)
    const standFlags = n => (run, g) => {
      for (const p of run) for (let k = Math.floor(n + rnd()); k > 0; k--) {
        const r = Math.floor(rnd() * g.rows), l = g.F + (r + 0.5) * g.dep, y = g.base + (r + 1) * g.rise, q = rnd();
        flagList.push({ x: p.x + p.nx * l, y: p.y + y, z: p.z + p.nz * l, c: q < 0.72 ? '#d80000' : q < 0.86 ? '#ffd400' : q < 0.93 ? '#169b45' : '#f4f4f4', h: 1.8 + rnd() * 0.8 });
      }
    };
    // Tribuna Centrale: deep, roofed, packed with tifosi
    K.stand(K.trackPath(1172, 1224, -1), { front: WALL + 3.5, rows: 18, rise: 0.62, roof: true, roofH: 4.5, over: 0.55, seat: '#9aa2ad', fascia: '#1b5e3a', roofC: '#dfe3e6', onRun: standFlags(2.2) });
    K.stand(K.trackPath(1228, 1262, -1), { rows: 10, onRun: standFlags(0.8) });
    K.stand(K.trackPath(1100, 1150, 1), { rows: 8, seat: '#c43a3a', onRun: standFlags(0.6) });
    // corners: Rettifilo, Roggia, both Lesmos, Ascari, Parabolica exit, back straight
    K.stand(K.trackPath(112, 136, -1), { rows: 12, roof: true, onRun: standFlags(1) });
    K.stand(K.trackPath(356, 382, -1), { rows: 10, onRun: standFlags(0.8) });
    K.stand(K.trackPath(440, 468, -1), { rows: 10, roof: true, fascia: '#1b5e3a', onRun: standFlags(0.8) });
    K.stand(K.trackPath(516, 540, -1), { rows: 9, onRun: standFlags(0.8) });
    K.stand(K.trackPath(752, 798, 1), { rows: 12, roof: true, onRun: standFlags(1) });
    K.stand(K.trackPath(1018, 1062, -1), { front: WALL + 5, rows: 14, rise: 0.62, roof: true, roofH: 4.4, onRun: standFlags(1.5) });
    K.stand(K.trackPath(900, 960, -1), { rows: 7, onRun: standFlags(0.4) });

    // gravel traps on the outside of the slow corners
    for (const [i0, i1, sg] of [[128, 152, 1], [132, 150, -1], [368, 396, 1], [436, 470, -1], [488, 540, -1], [744, 806, 1], [744, 806, -1], [986, 1066, -1]]) K.runoff(i0, i1, sg);

    // ---- the old high-speed banking (Curva Sud) round the outside of the Parabolica: ramps up out of the flat
    // at both ends to 11 m at the retaining wall, guardrail on top, buttresses behind
    {
      const cx = BANK[0], cz = BANK[1], RB = BANK[2], a0 = Math.PI * 1.02, a1 = -0.55, n = Math.ceil(Math.abs(a0 - a1) * RB / 7);
      const bankTex = api.canvasTex(256, 256, (g, w, h) => {
        g.fillStyle = '#b3b0a6'; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 3000; i++) { const v = 140 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v * 0.95},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(70,75,60,${0.08 + Math.random() * 0.15})`; g.fillRect(Math.random() * w, 0, 6 + Math.random() * 30, h); }   // rain streaks
        for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(80,110,50,0.25)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 6 + Math.random() * 14, 0, TAU); g.fill(); }   // moss
        g.fillStyle = 'rgba(40,40,40,0.55)'; for (let x = 0; x < w; x += 64) g.fillRect(x, 0, 2, h);   // slab joints
      });
      K.texBucket('bank', bankTex, { rough: 0.95 });
      const path = [];
      for (let k = 0; k <= n; k++) {
        const a = a0 + (a1 - a0) * k / n, x = cx + Math.cos(a) * RB, z = cz + Math.sin(a) * RB;
        path.push({ x, y: api.groundAt(x, z) - 0.25, z, nx: Math.cos(a), nz: Math.sin(a), h: 11 * smooth(0, 90, Math.min(k, n - k) * 7) + 0.3 });
      }
      const L = 7, prof = [0, 0.2, 0.4, 0.55, 0.7, 0.82, 0.92, 1].map(u => [-L + 2 * L * u, u]);
      for (const run of K.clip(path, -L - 1, L + 2, 3)) {
        const E = [{ a: [-L - 2.5, 0.08], b: [-L, 0.08], c: '#8c8a80', bk: 'bank', uw: 16 }];
        for (let k = 0; k < prof.length - 1; k++) {
          const [la, ua] = prof[k], [lb, ub] = prof[k + 1];
          E.push({ a: p => [la, p.h * ua ** 2.3 + 0.08], b: p => [lb, p.h * ub ** 2.3 + 0.08], bk: 'bank', uw: 18, off: 0 });
        }
        E.push({ a: [L, -0.5], b: p => [L, p.h + 0.08], bk: 'bank', uw: 12, c: '#d9d6cc' });              // outer retaining wall
        E.push({ a: p => [L - 0.05, p.h + 0.08], b: p => [L - 0.05, p.h + 1.2], bk: 'metal', c: '#aab0b8' });   // guardrail
        K.sweep(run, E);
        for (let k = 0; k < run.length; k += 3) {
          const p = run[k];
          if (p.h > 2) K.add('solid', new T.BoxGeometry(0.8, p.h, 2.6), '#bdb9ae', p.x + p.nx * (L + 1.2), p.y + p.h / 2, p.z + p.nz * (L + 1.2), Math.atan2(p.nx, p.nz));
        }
        for (const p of [run[0], run[run.length - 1]]) K.cap(p, [[L - 0.1, L + 0.1, -0.5, p.h]], '#d9d6cc');
      }
    }

    // ---- the park: tall plane trees and oaks right behind the fences, woods beyond, open lawns here and there
    const lawn = (x, z) => Math.sin(x * 0.0085 + 1.2 + Math.sin(z * 0.004)) * Math.cos(z * 0.0102 - 0.4 + Math.sin(x * 0.005)) + 0.45 * Math.sin((x - z) * 0.017);
    const leafC = () => { const r = rnd(); return r < 0.04 ? `hsl(${50 + rnd() * 12},42%,${30 + rnd() * 8}%)` : `hsl(${88 + rnd() * 26},${36 + rnd() * 18}%,${19 + rnd() * 10}%)`; };
    const near = [], near2 = [], far = [], bushes = [];
    const tree = (x, z, r = R(5.5, 8.5), h = R(15, 21), list = near2) => {
      const n = K.nearest(x, z), rb = Math.hypot(x - BANK[0], z - BANK[1]);
      if ((rb > 112 && rb < BANK[2] - 6 && z > 600) || n.d < WALL + 2.5 + r * 0.4 || !K.tallOk(n) || K.blocked(x, z, r * 0.45)) return;
      list.push({ x, z, h, r, c: leafC(), bark: rnd() < 0.5 ? '#9a8e78' : '#6d5d4b', tw: R(0.4, 0.65) });
    };
    const at = (i, lat, jit = 3) => { const s = S[K.wrapI(i)]; return [s.pos.x + s.right.x * lat + s.tan.x * R(-jit, jit), s.pos.z + s.right.z * lat + s.tan.z * R(-jit, jit)]; };
    // two rows right behind the fences on both sides (a gap now and then), a looser fill behind them
    for (let i = 0; i < K.N; i += 2) for (const sg of [1, -1]) {
      if (Math.sin(i * 0.045 + sg * 2) + Math.sin(i * 0.013 + sg) > 1.45) continue;
      if (rnd() < 0.85) tree(...at(i, sg * (WALL + R(5, 10))), undefined, undefined, near);
      if (rnd() < 0.7) tree(...at(i + 1, sg * (WALL + R(15, 25))));
      if (rnd() < 0.55) { const [x, z] = at(i, sg * (WALL + R(1.8, 4.5)), 2), n = K.nearest(x, z), r = R(0.9, 1.9); if (n.d >= WALL + 1.2 + r && !K.blocked(x, z, r)) bushes.push({ x, y: api.groundAt(x, z) + r * 0.2, z, rx: rnd(), ry: rnd() * TAU, sx: r * R(1.1, 1.6), sy: r * R(0.6, 0.85), sz: r * R(1, 1.4), c: `hsl(${95 + rnd() * 25},${40 + rnd() * 15}%,${15 + rnd() * 8}%)` }); }
    }
    for (let t = 0; t < 12000 && near.length + near2.length < 2300; t++) {
      const [x, z] = at(Math.floor(rnd() * K.N), (rnd() < 0.5 ? 1 : -1) * (WALL + 28 + rnd() * 90), 5);
      if (lawn(x, z) < 0.8) tree(x, z);
    }
    K.inst(new T.IcosahedronGeometry(1, 0), new T.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), bushes, { cell: 800 });
    const b = api.track.bounds;
    for (let t = 0; t < 40000 && far.length < 2500; t++) {
      const x = R(b.minX - 350, b.maxX + 350), z = R(b.minZ - 350, b.maxZ + 350), n = K.nearest(x, z);
      if (n.d < 125 || n.d > 1e5 || lawn(x, z) > 0.7 || K.blocked(x, z, 5)) continue;
      far.push({ x, z, h: R(16, 25), c: leafC() });
    }
    K.forest([{ list: near, crown: K.lobes(3) }, { list: near2, crown: K.lobes(2) }], far);   // the row seen up close gets the richer crown
    const lawnC = new T.Color('#5c9a3a'), woodC = new T.Color('#3b6a2a'), tmp = new T.Color();
    K.paintGround((x, z, n) => tmp.copy(lawnC).lerp(woodC, smooth(WALL + 8, WALL + 45, n.d) * (1 - smooth(0.5, 0.8, lawn(x, z)))));

    K.flags(flagList);
    K.clouds(0xf8fafc, 0.8, 16);
    K.flush();
  },
};
