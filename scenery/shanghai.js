// Shanghai International Circuit: main grandstand with two wing bridges high over the start/finish straight,
// blue-glass pit building, team pavilions standing in the paddock lake, flat delta farmland cut by canals lined with
// dawn redwoods, village houses, and a hazy futuristic skyline on the ESE horizon (the real direction of the city).
// Also exports `kit` (shared helpers for the catalunya / istanbul modules).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
export function segDist(x, z, ax, az, bx, bz) {   // distance from (x,z) to segment a-b
  const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

// ======================================================================================
// kit: helpers bound to one race's api
// ======================================================================================
export function kit(api) {
  const { track, world } = api;
  const S = track.samples, N = track.N, W2 = track.width / 2, WALL = W2 + (track.def?.wallGap ?? 9.4);
  const M = new THREE.Matrix4(), E = new THREE.Euler(), C = new THREE.Color(), D = new THREE.Object3D();
  const wrap = i => ((Math.round(i) % N) + N) % N;
  const at = (i, lat, y = 0) => { const s = S[wrap(i)]; return [s.pos.x + s.right.x * lat, s.pos.y + y, s.pos.z + s.right.z * lat]; };
  const yawAt = i => { const t = S[wrap(i)].tan; return Math.atan2(t.x, t.z); };
  const b = track.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  // same radius maths as world.js: where the ground mesh ends
  const R0 = Math.max(...S.map(s => Math.hypot(s.pos.x - cx, s.pos.z - cz))), groundHalf = Math.max(900, Math.max(380, R0 + 150) + 520);
  // sign of the sharpest nearby curvature (+ = left turn), 0 on straights
  const corner = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -30; k <= 30; k += 3) { const c = S[(i + k + N) % N].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
    corner[i] = Math.abs(m) > 1 / 160 ? Math.sign(m) : 0;
  }
  const probe = (x, z) => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), i: bi, lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z };
  };
  // free spot; tall things also keep >= 24 m off the barrier on the inside of corners (chase camera looks across)
  const ok = (x, z, r, tall = false) => {
    if (!api.isFree(x, z, r)) return false;
    if (!tall) return true;
    const p = probe(x, z);
    return p.d - r >= WALL + (corner[p.i] && Math.sign(p.lat) !== corner[p.i] ? 24 : 3);
  };
  const loop = []; for (let i = 0; i < N; i += 4) loop.push([S[i].pos.x, S[i].pos.z]);
  const inside = (x, z) => {   // inside the lap outline
    let c = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, zi] = loop[i], [xj, zj] = loop[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const keep = (g, names) => { for (const k of Object.keys(g.attributes)) if (!names.includes(k)) g.deleteAttribute(k); return g; };
  // vertex-coloured, non-indexed part (for merging into one static mesh)
  function part(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const g = keep(geo.index ? geo.toNonIndexed() : geo, ['position', 'normal']);
    if (!g.attributes.normal) g.computeVertexNormals();
    C.set(color);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) C.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.applyMatrix4(M.makeRotationFromEuler(E.set(rx, ry, rz)).setPosition(x, y, z));
  }
  // textured part (position, normal, uv)
  function tpart(geo, x = 0, y = 0, z = 0, ry = 0) {
    const g = keep(geo.index ? geo.toNonIndexed() : geo, ['position', 'normal', 'uv']);
    return g.applyMatrix4(M.makeRotationFromEuler(E.set(0, ry, 0)).setPosition(x, y, z));
  }
  // ribbon beside the track from sample i0 to i1 (wraps) on side sg, through profile points [lateral, height];
  // u = metres along / uLen, v = metres along the profile / vLen
  function strip(i0, i1, sg, prof, step = 2, uLen = 10, vLen = 10) {
    const n = (((i1 - i0) % N) + N) % N, idx = [];
    for (let k = 0; k < n; k += step) idx.push(i0 + k);
    idx.push(i0 + n);
    const cum = [0];
    for (let k = 1; k < prof.length; k++) cum.push(cum[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
    const pos = [], uv = [];
    for (let j = 0; j < idx.length - 1; j++) {
      const ia = idx[j], ib = idx[j + 1], ua = (ia - i0) * track.spacing / uLen, ub = (ib - i0) * track.spacing / uLen;
      for (let k = 0; k < prof.length - 1; k++) {
        const [la, ya] = prof[k], [lb, yb] = prof[k + 1], va = cum[k] / vLen, vb = cum[k + 1] / vLen;
        pos.push(...at(ia, sg * la, ya), ...at(ia, sg * lb, yb), ...at(ib, sg * la, ya), ...at(ia, sg * lb, yb), ...at(ib, sg * lb, yb), ...at(ib, sg * la, ya));
        uv.push(ua, va, ua, vb, ub, va, ua, vb, ub, vb, ub, va);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }
  const blockStrip = (i0, i1, sg, la, lb) => {
    const n = (((i1 - i0) % N) + N) % N, r = (lb - la) / 2 + 2, st = Math.max(1, Math.round(r / track.spacing));
    for (let k = 0; k <= n; k += st) { const [x, , z] = at(i0 + k, sg * (la + lb) / 2); api.block(x, z, r); }
  };
  // contiguous sample runs in [i0, i1] where test(i) holds
  const runs = (i0, i1, test, minLen = 6) => {
    const n = (((i1 - i0) % N) + N) % N, out = [];
    let s = -1;
    for (let k = 0; k <= n + 1; k++) {
      const good = k <= n && test(wrap(i0 + k));
      if (good && s < 0) s = k;
      if (!good && s >= 0) { if (k - 1 - s >= minLen) out.push([wrap(i0 + s), wrap(i0 + k - 1)]); s = -1; }
    }
    return out;
  };
  // distance from (x,z) to the centreline, ignoring the stretch within ±skip samples of i
  const otherDist = (x, z, i, skip = 70) => {
    let bd = Infinity;
    for (let j = 0; j < N; j += 3) {
      const dj = Math.abs(j - i), p = S[j].pos;
      if (Math.min(dj, N - dj) > skip) bd = Math.min(bd, (p.x - x) ** 2 + (p.z - z) ** 2);
    }
    return Math.sqrt(bd);
  };
  // the band [la, lb] beside sample i: its own stretch is the nearest track and other parts stay >= 22 m off their barrier
  const clearBand = (i, sg, la, lb) => [la, (la + lb) / 2, lb].every(l => {
    const [x, , z] = at(i, sg * l);
    return api.near(x, z)[0] >= l - 4 && otherDist(x, z, i) >= Math.max(l - 4, WALL + 22);
  });

  const statics = [], textured = new Map();   // merged at flush()
  const addT = (mat, g) => { if (!textured.has(mat)) textured.set(mat, []); textured.get(mat).push(g); };
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });

  const crowdTex = (seat = '#3b4a63') => api.canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = seat; g.fillRect(0, 0, w, h);
    const rows = 16, cols = 30, rh = h / rows, cw = w / cols;
    const shirts = ['#e63946', '#f1faee', '#1d3557', '#ffb703', '#2a9d8f', '#fb8500', '#8d99ae', '#ef476f', '#ffffff', '#222222', '#e63946', '#f4f1de'];
    for (let r = 0; r < rows; r++) {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * rh + rh * 0.84, w, rh * 0.16);
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.14) continue;
        const x = c * cw + (Math.random() - 0.5) * cw * 0.25;
        g.fillStyle = shirts[Math.random() * shirts.length | 0]; g.fillRect(x + cw * 0.14, r * rh + rh * 0.34, cw * 0.72, rh * 0.5);
        g.fillStyle = ['#f1c7a3', '#d9a17a', '#8d5a3b', '#2b1d14', '#e0b48a'][Math.random() * 5 | 0]; g.fillRect(x + cw * 0.3, r * rh + rh * 0.1, cw * 0.4, rh * 0.28);
      }
    }
  });
  // flat polygon (fan) across the track direction at sample i, through profile points [lateral, height]
  const cap = (i, sg, prof) => {
    const pos = [];
    for (let k = 1; k < prof.length - 1; k++) pos.push(...at(i, sg * prof[0][0], prof[0][1]), ...at(i, sg * prof[k][0], prof[k][1]), ...at(i, sg * prof[k + 1][0], prof[k + 1][1]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return g;
  };
  // pit building (facade material `mat` facing the track) + paddock apron behind it, trimmed where other parts of the lap come close
  function pits(i0, i1, sg, mat, o = {}) {
    const h = o.height ?? 12, d = o.depth ?? 18, ap = o.apron ?? 44, f = WALL + 6, body = o.body ?? '#e9ebee';
    const made = runs(i0, i1, i => clearBand(i, sg, WALL + 3, f + d + 2));
    for (const [a, b] of made) {
      addT(mat, strip(a, b, sg, [[f, -0.5], [f, h]], 2, 24, h + 0.5));
      statics.push(part(strip(a, b, sg, [[f + 0.3, h], [f + d, h], [f + d, -1]], 2), body));
      statics.push(part(strip(a, b, sg, [[f - 2.5, h + 0.9], [f + d + 1, h + 0.9], [f + d + 1, h + 0.2], [f - 2.5, h + 0.2]], 2), o.roof ?? '#f3f5f7'));
      statics.push(part(strip(a, b, sg, [[f - 2.55, h + 1.3], [f - 2.55, h - 0.2]], 2), o.trim ?? '#f3f5f7'));   // fascia
      for (const i of [a, b]) statics.push(part(cap(i, sg, [[f, -1], [f, h], [f + d, h], [f + d, -1]]), body));
      blockStrip(a, b, sg, WALL + 3, f + d + 2);
    }
    const main = made.reduce((m, r) => ((((r[1] - r[0]) % N) + N) % N > (((m[1] - m[0]) % N) + N) % N ? r : m), made[0] ?? [0, 0]);
    if (o.sign && made.length) {   // name board on the roof, midway along the longest run, readable from the track
      const i = wrap(main[0] + ((((main[1] - main[0]) % N) + N) % N) / 2), [x, y, z] = at(i, sg * (f + 3), h + 3.6), s0 = S[i];
      const tex = api.canvasTex(1024, 128, (g, w, hh) => {
        g.fillStyle = '#10131a'; g.fillRect(0, 0, w, hh);
        g.fillStyle = o.trim ?? '#e5383b'; g.fillRect(0, hh - 14, w, 14);
        g.fillStyle = '#ffffff'; g.font = 'bold 72px "Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(o.sign, w / 2, hh / 2 - 6, w - 60);
      }, false);
      addT(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), tpart(new THREE.PlaneGeometry(32, 4), x, y, z, Math.atan2(-s0.right.x * sg, -s0.right.z * sg)));
      for (const k of [-12, 12]) { const [px, , pz] = at(i + k / track.spacing, sg * (f + 3.3), 0); statics.push(part(new THREE.BoxGeometry(0.4, 2.2, 0.4), '#3a3f48', px, h + 1.5, pz)); }
    }
    for (const [a, b] of runs(i0, i1, i => clearBand(i, sg, f + d, f + d + ap))) {   // paddock apron
      statics.push(part(strip(a, b, sg, [[f + d, 0.12], [f + d + ap, 0.12]], 3), '#72757a'));
      blockStrip(a, b, sg, f + d, f + d + ap + 2);
    }
    return made;
  }
  const inRuns = (rs, i) => rs.some(([a, b]) => (((i - a) % N) + N) % N <= (((b - a) % N) + N) % N);
  let crowdMat = null;
  // grandstand hugging the outside of the track: concrete rake + crowd + optional roof on columns
  function stand(i0, i1, sg, o = {}) {
    const f = o.front ?? WALL + 3, d = o.depth ?? 20, h = o.height ?? 11, bk = f + d, top = 2.2 + h;
    crowdMat ??= new THREE.MeshStandardMaterial({ map: crowdTex(o.seat), roughness: 0.9, side: THREE.DoubleSide });
    const made = [];
    for (const [a, z] of runs(i0, i1, i => clearBand(i, sg, f - 2, bk + 2))) {
      const prof = [[f, -2.5], [f, 2.2], [f + 0.4, 2.4], [bk, top], [bk + 0.8, top + 0.6], [bk + 0.8, -2.5]];
      statics.push(part(strip(a, z, sg, prof.slice(0, 5), 2), o.color ?? '#b9bcc4'), part(strip(a, z, sg, prof.slice(4), 2), o.back ?? '#8f99a6'));
      statics.push(part(strip(a, z, sg, [[bk + 0.85, top - 1.2], [bk + 0.85, top - 2.6]], 2), o.fascia ?? '#d7263d'));
      for (const i of [a, z]) statics.push(part(cap(i, sg, prof), o.color ?? '#b9bcc4'));   // end walls
      addT(crowdMat, strip(a, z, sg, [[f + 0.5, 2.55], [bk - 0.2, top + 0.1]], 2, 16, 19));
      if (o.roof) {
        const ry = top + (o.roofH ?? 6.5);
        statics.push(part(strip(a, z, sg, [[f - 1.5, ry + 1.2], [bk + 1.2, ry - 1.2]], 2), o.roofColor ?? '#e9edf2'));
        statics.push(part(strip(a, z, sg, [[f - 1.5, ry + 1.2], [f - 1.5, ry]], 2), o.fascia ?? '#d7263d'));
        const n = (((z - a) % N) + N) % N, st = Math.max(2, Math.round(22 / track.spacing));
        for (let k = 0; k <= n; k += st) { const [x, , zz] = at(a + k, sg * (bk + 0.9)); statics.push(part(new THREE.BoxGeometry(0.7, ry + 2, 0.7), '#8e939c', x, (ry + 2) / 2 - 2, zz, yawAt(a + k))); }
      }
      blockStrip(a, z, sg, f - 2, bk + 2);
      made.push([a, z]);
    }
    return made;
  }

  // instanced scatter: items [x, y, z, scale, scaleY?, rotY?, color?]
  function inst(geo, mat, items, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
    items.forEach((q, k) => {
      D.position.set(q[0], q[1], q[2]); D.rotation.set(0, q[5] ?? 0, 0); D.scale.set(q[3], q[4] ?? q[3], q[3]); D.updateMatrix();
      m.setMatrixAt(k, D.matrix);
      if (q[6] != null) m.setColorAt(k, C.set(q[6]));
    });
    m.count = items.length;
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  }
  // tree shapes (vertex coloured; instance colour = a mild tint on top)
  const TREE = {
    redwood: () => mergeGeometries([part(new THREE.CylinderGeometry(0.22, 0.35, 3, 6), '#5b4232', 0, 1.5, 0), part(new THREE.ConeGeometry(1.8, 11, 7), '#3f6b35', 0, 8, 0)]),
    round: () => mergeGeometries([part(new THREE.CylinderGeometry(0.25, 0.38, 3.4, 6), '#5d4634', 0, 1.7, 0),
      part(new THREE.IcosahedronGeometry(2.4, 0), '#4d7a3b', 0, 4.6, 0), part(new THREE.IcosahedronGeometry(1.8, 0), '#4d7a3b', 1.4, 3.9, 0.6), part(new THREE.IcosahedronGeometry(1.7, 0), '#4d7a3b', -1.2, 4.1, -0.7)]),
    umbrella: () => mergeGeometries([part(new THREE.CylinderGeometry(0.28, 0.42, 8.5, 5), '#6b4c38', 0.5, 4.2, 0, 0, 0, -0.12),
      part(new THREE.DodecahedronGeometry(1, 0).scale(4.6, 1.2, 4.6), '#3f5a2c', 1.1, 9.2, 0), part(new THREE.IcosahedronGeometry(1, 0).scale(2.6, 0.9, 2.6), '#46632f', -0.8, 8.7, 1.2)]),
    olive: () => mergeGeometries([part(new THREE.CylinderGeometry(0.22, 0.34, 1.8, 5), '#6a5a48', 0, 0.9, 0), part(new THREE.IcosahedronGeometry(1, 0).scale(2, 1.4, 2), '#7d8a5c', 0, 2.6, 0), part(new THREE.IcosahedronGeometry(1.1, 0), '#7d8a5c', 0.9, 2.2, 0.5)]),
    cypress: () => mergeGeometries([part(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 5), '#5b4232', 0, 0.6, 0),
      part(new THREE.LatheGeometry([[0.01, 0], [0.9, 0.8], [1.25, 3], [1.1, 6.5], [0.55, 9.8], [0.01, 11]].map(([r, y]) => new THREE.Vector2(r, y)), 7), '#2f4a2a', 0, 0.9, 0)]),
    oak: () => mergeGeometries([part(new THREE.CylinderGeometry(0.3, 0.45, 2.6, 6), '#5d4634', 0, 1.3, 0),
      part(new THREE.IcosahedronGeometry(1, 1).scale(3.2, 2.4, 3.2), '#4f6b34', 0, 4.4, 0), part(new THREE.IcosahedronGeometry(1.9, 0), '#4f6b34', 1.7, 3.6, 0.8)]),
    bush: () => part(new THREE.IcosahedronGeometry(1, 0).scale(1, 0.62, 1), '#687a42', 0, 0.25, 0),
  };
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
  // small houses: walls (buried 2 m for slopes) + hip roof; list items [x, y, z, scale, scaleY, rotY, wall, roof]
  const houseMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  function houses(list) {
    inst(new THREE.BoxGeometry(12, 8, 8).translate(0, 2, 0), houseMat, list.map(q => [...q.slice(0, 6), q[6]]));
    inst(new THREE.CylinderGeometry(0.01, 5.2, 3, 4, 1).rotateY(Math.PI / 4).scale(1.75, 1, 1.15).translate(0, 7.5, 0), houseMat, list.map(q => [...q.slice(0, 6), q[7]]));
  }
  const trees = (kind, items, shadow = true) => inst(TREE[kind](), treeMat, items, shadow);

  // far scenery painted on an open cylinder around the course centre, drawn without fog.
  // bearing = degrees clockwise from north (+x = east, -z = north); paint(g, w, h) in canvas pixels
  function band(paint, bearing, arc, radius, height, o = {}) {
    const tex = api.canvasTex(o.w ?? 2048, o.h ?? 512, paint, false);
    tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; tex.offset.x = 1;   // seen from inside: un-mirror
    const b0 = THREE.MathUtils.degToRad(bearing), a = THREE.MathUtils.degToRad(arc);
    const geo = new THREE.CylinderGeometry(radius, radius, height, Math.max(8, Math.round(arc / 2)), 1, true, Math.PI - b0 - a / 2, a).translate(0, height / 2 + (o.y ?? -8), 0);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.position.set(cx, 0, cz);
    m.renderOrder = o.order ?? -3;
    m.frustumCulled = false;
    world.add(m);
    return m;
  }
  // flat ring under the ground mesh's edge so flat land reaches the fogged horizon
  function farGround(color, y = -0.4) {
    const m = new THREE.Mesh(new THREE.RingGeometry(groundHalf * 0.85, 4200, 48, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.position.set(cx, y, cz);
    world.add(m);
    return m;
  }
  // drifting cloud deck (fog hides its edge)
  function cloudDeck(rnd, o = {}) {
    const tex = api.canvasTex(512, 512, (g, w, h) => {
      for (let c = 0; c < (o.count ?? 18); c++) {
        const ox = rnd() * w, oy = rnd() * h, n = 5 + Math.floor(rnd() * 9), sp = 18 + rnd() * 46;
        for (let k = 0; k < n; k++) {
          const x = ox + (rnd() - 0.5) * sp * 2, y = oy + (rnd() - 0.5) * sp * 0.7, r = 12 + rnd() * 30;
          for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
            const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            gr.addColorStop(0, `rgba(255,255,255,${o.alpha ?? 0.5})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
          }
        }
      }
    });
    tex.repeat.set(9, 9);   // big enough that its edge stays in the fog (camera far = 3000)
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: o.color ?? 0xf6f8fb, transparent: true, depthWrite: false }));
    m.position.set(cx, o.y ?? 250, cz);
    m.renderOrder = -5;
    world.add(m);
    let t = 0;
    api.onUpdate(dt => { t += dt; tex.offset.x = t * 0.0012; tex.offset.y = t * 0.0005; });
    return m;
  }
  function flush() {
    if (statics.length) { const m = new THREE.Mesh(mergeGeometries(statics), vcMat); m.castShadow = m.receiveShadow = true; world.add(m); }
    for (const [mat, list] of textured) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; world.add(m); }
    statics.length = 0; textured.clear();
  }
  return { S, N, W2, WALL, cx, cz, groundHalf, wrap, at, yawAt, corner, probe, otherDist, ok, inside, part, tpart, strip, blockStrip, runs, clearBand, statics, addT, vcMat, cap, pits, inRuns, stand, inst, trees, houses, band, farGround, cloudDeck, flush };
}

// ======================================================================================
// Shanghai
// ======================================================================================
const E_ = [0.976, -0.219], N_ = [-0.219, -0.976];   // main straight direction (eastward) and its north normal
const onStraight = (s, l) => [E_[0] * s + N_[0] * l, E_[1] * s + N_[1] * l];
const GRID_YAW = Math.atan2(E_[0], E_[1]);           // rotation.y that points local +Z along the straight
// water (canals + lakes) as capsules [ax, az, bx, bz, r]; the terrain is carved under them
const WATER = [
  [...onStraight(80, 122), ...onStraight(500, 122), 24],   // paddock lake with the team pavilions
  [-10, -560, 90, -640, 70],                               // infield lake
  [399, -989, 1048, -9, 11],                               // canal outside the back straight
  [-333, 342, 691, 112, 11],                               // canal south of the grandstands
  [-440, -760, -420, -60, 10], [-420, -60, -333, 342, 10], // west canals
];
const wetness = (x, z) => {
  let w = 0;
  const wob = 5 * Math.sin(x * 0.031 + 1.7) * Math.cos(z * 0.027 - 0.4);
  for (const [ax, az, bx, bz, r] of WATER) w = Math.max(w, smooth(r + 9, r - 5, segDist(x, z, ax, az, bx, bz) + (r > 30 ? wob : 0)));
  return w;
};
const WATER_Y = -0.9;

const env = {
  sky: { top: '#5a8cd0', horizon: '#d6e0e6', bottom: '#a4b3a8' },
  fog: { color: '#d3dde3', near: 170, far: 1350 },
  sun: { dir: [-0.36, 0.72, 0.6], color: '#fff1db', intensity: 2.6 },
  hemi: { sky: '#d5e3f3', ground: '#5d7048', intensity: 0.85 },
  envIntensity: 0.42,
  exposure: 0.98,
  terrain: { hills: 0, rim: 0, rimColor: '#6f8f5a', height: (x, z, y) => y - 2.4 * wetness(x, z) },
  barrier: 'ads',
};

// painted skyline: silhouettes in metres (1460 m wide x 330 m tall band), haze at the foot
function paintSkyline(g, w, h) {
  const G = 330, k = 1.45, rnd = seeded(777);   // k: heights exaggerated so the cluster reads from the circuit
  g.save(); g.scale(w / 1460, h / G);
  const box = (x, bw, bh, c) => { g.fillStyle = c; g.fillRect(x, G - bh * k, bw, bh * k); };
  const poly = (pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach(([x, y], n) => (n ? g.lineTo(x, G - y * k) : g.moveTo(x, G - y * k))); g.closePath(); g.fill(); };
  // far layer: plain slabs, densest around the centre cluster
  for (let x = 0; x < 1460;) {
    const c = Math.exp(-(((x - 760) / 330) ** 2)), bw = 10 + rnd() * 26, bh = 12 + rnd() * (22 + 80 * c);
    box(x, bw, bh, `rgb(${166 + rnd() * 14 | 0},${180 + rnd() * 12 | 0},${196 + rnd() * 10 | 0})`);
    x += bw + rnd() * 10 * (1 - c);
  }
  // mid layer
  for (let x = 300; x < 1250;) {
    const c = Math.exp(-(((x - 760) / 240) ** 2)), bw = 12 + rnd() * 20, bh = 20 + rnd() * (26 + 76 * c);
    box(x, bw, bh, `rgb(${142 + rnd() * 14 | 0},${158 + rnd() * 12 | 0},${178 + rnd() * 10 | 0})`);
    if (rnd() < 0.3) box(x + bw / 2 - 1, 2, bh + 10, 'rgb(142,158,178)');
    x += bw + 3 + rnd() * 12;
  }
  const T = '#788ca4', T2 = '#6f849e';
  // TV tower: three legs, spheres on a spire
  poly([[560, 0], [566, 0], [575, 70], [569, 70]], T2); poly([[590, 0], [584, 0], [575, 70], [581, 70]], T2);
  box(572, 6, 150, T2); box(574, 2, 176, T2);
  g.fillStyle = T2;
  for (const [y, r] of [[78, 14], [124, 8.5], [146, 4]]) { g.beginPath(); g.ellipse(575, G - y * k, r, r * 1.15, 0, 0, TAU); g.fill(); }
  // stepped pagoda-like tower with a spire
  for (let n = 0; n < 7; n++) { const bw = 30 - n * 3.4; box(690 - bw / 2, bw, 30 + n * 16, T); }
  box(689, 2, 162, T);
  // bottle-opener tower: tapering slab with a trapezoid hole at the top
  poly([[712, 0], [746, 0], [740, 178], [718, 178]], T2);
  g.save(); g.globalCompositeOperation = 'destination-out'; poly([[721, 161], [737, 161], [735, 172], [723, 172]], '#000'); g.restore();
  // twisting tallest tower: tapers, curved notch, slanted crown
  poly([[764, 0], [806, 0], [800, 90], [794, 170], [789, 215], [776, 206], [771, 170], [768, 90]], T);
  g.strokeStyle = 'rgba(200,214,230,0.6)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(804, G - 20 * k); g.quadraticCurveTo(772, G - 110 * k, 789, G - 212 * k); g.stroke();
  g.fillStyle = 'rgba(235,242,250,0.35)';   // faint window glints
  for (let i = 0; i < 900; i++) g.fillRect(300 + rnd() * 900, G - rnd() * 150, 1.2, 0.6);
  g.restore();
  // haze at the foot, fading into the fog colour
  const gr = g.createLinearGradient(0, h, 0, h * 0.55);
  gr.addColorStop(0, 'rgba(211,221,227,1)'); gr.addColorStop(0.2, 'rgba(211,221,227,0.8)'); gr.addColorStop(1, 'rgba(211,221,227,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

// glass curtain wall: blue panes, light mullions, floor bands
export function paintGlass(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#6fa6d6'); gr.addColorStop(0.5, '#2e6aa6'); gr.addColorStop(1, '#1d4f86');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, 0, 8 + Math.random() * 30, h); }
  g.fillStyle = '#d9e2ea';
  for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 3, h);
  for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 6);
}
// pit building front: garage doors below, glass band above
export function paintPits(g, w, h) {
  paintGlass(g, w, h);
  g.fillStyle = '#e8ecef'; g.fillRect(0, h * 0.58, w, h * 0.42);
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2 + 12;
    g.fillStyle = '#39414d'; g.fillRect(x, h * 0.66, w / 2 - 24, h * 0.34);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = h * 0.66; y < h; y += 5) g.fillRect(x, y, w / 2 - 24, 1);
  }
  g.fillStyle = '#1f5fa8'; g.fillRect(0, h * 0.58, w, 6);
}
// farmland: crop rows (instance colour tints it)
function paintField(g, w, h) {
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 4) { g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.08})`; g.fillRect(x, 0, 2, h); }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}

function build(api) {
  const K = kit(api), { S, N, WALL, at, yawAt, part, tpart, statics, addT, ok, cx, cz } = K;
  const rnd = seeded(31415);
  const R = (a, b) => a + rnd() * (b - a);

  const glassMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(256, 256, paintGlass), roughness: 0.18, metalness: 0.55 });
  const pitMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(256, 256, paintPits), roughness: 0.3, metalness: 0.35, side: THREE.DoubleSide });

  // ---- water: one plane below the ground, showing through where the terrain is carved
  const water = new THREE.Mesh(new THREE.PlaneGeometry(3200, 3200, 26, 26).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#557d8c', roughness: 0.12, metalness: 0.2 }));
  water.position.set(cx, WATER_Y, cz);
  water.receiveShadow = true;
  api.world.add(water);
  K.farGround('#7d9a66', -0.35);
  for (const [ax, az, bx, bz, r] of WATER) {   // keep everything off the water
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / r);
    for (let k = 0; k <= n; k++) api.block(lerp(ax, bx, k / n), lerp(az, bz, k / n), r + 4);
  }

  // ---- start/finish complex: main grandstand (left/south), pit building (right/north), wing bridges
  K.stand(1062, 18, -1, { depth: 34, height: 13, roof: true, roofH: 6, fascia: '#1f5fa8', seat: '#2f5f9a' });
  K.pits(1058, 22, 1, pitMat, { height: 12, depth: 18, apron: 46, body: '#d7dde3', trim: '#1f5fa8', sign: 'SHANGHAI  上海' });   // garages + blue glass, paddock apron

  // wing bridges: glass towers each side, a broad up-swept wing spanning high over the straight
  const sheet = (nu, nv, f) => {
    const pos = [];
    for (let a = 0; a < nu; a++) for (let c = 0; c < nv; c++) {
      const p00 = f(a / nu, c / nv), p10 = f((a + 1) / nu, c / nv), p01 = f(a / nu, (c + 1) / nv), p11 = f((a + 1) / nu, (c + 1) / nv);
      pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  };
  const SPAN = 132, DEPTH = 40, LIFT = 11, TH = 4.5, LAT0 = -72, LAT1 = 60;
  const wp = (u, v, lower) => {   // u across, v along, both in [-1, 1]
    const hd = DEPTH / 2 * (1 - 0.62 * u * u);
    return [u * SPAN / 2, LIFT * u * u + 1.6 * (1 - v * v) - (lower ? TH * (1 - 0.45 * u * u) * (1 - 0.3 * v * v) : 0), v * hd];
  };
  const wingTop = sheet(28, 8, (a, c) => wp(a * 2 - 1, c * 2 - 1, false));
  const wingBot = sheet(28, 8, (a, c) => wp(a * 2 - 1, c * 2 - 1, true));
  const wingRim = mergeGeometries([-1, 1].map(v => sheet(28, 1, (a, c) => wp(a * 2 - 1, v, c > 0))));
  const wingEnds = mergeGeometries([-1, 1].map(u => sheet(1, 8, (a, c) => wp(u, c * 2 - 1, a > 0))));
  const B = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  for (const i of [1100, 1178]) {
    const s = S[i], [mx, , mz] = at(i, (LAT0 + LAT1) / 2);
    B.makeBasis(s.right, up, s.tan.clone().negate()).setPosition(mx, 31, mz);
    statics.push(part(wingTop.clone(), '#f2f4f6').applyMatrix4(B), part(wingBot.clone(), '#9fb0c2').applyMatrix4(B));
    statics.push(part(wingRim.clone(), '#dfe5ea').applyMatrix4(B), part(wingEnds.clone(), '#dfe5ea').applyMatrix4(B));
    for (const lat of [LAT0 - 2, LAT1 + 2]) {   // towers under the wing tips
      const [x, , z] = at(i, lat), hgt = 31 + LIFT - 2;
      addT(glassMat, tpart(new THREE.BoxGeometry(14, hgt + 2, 16), x, hgt / 2 - 1, z, yawAt(i)));
      statics.push(part(new THREE.BoxGeometry(15, 1.2, 17), '#eef1f4', x, hgt + 1, z, yawAt(i)));
      api.block(x, z, 12);
    }
  }

  // team pavilions standing in the paddock lake, footbridges to the paddock
  for (let s = 110; s <= 470; s += 40) {
    const [x, z] = onStraight(s, 122), [fx, fz] = onStraight(s, 106), ry = GRID_YAW + Math.PI / 2;
    addT(glassMat, tpart(new THREE.BoxGeometry(26, 11, 15), x, 5.5 + WATER_Y, z, ry));
    statics.push(part(new THREE.BoxGeometry(28, 0.8, 17), '#f4f5f7', x, 11.2 + WATER_Y, z, ry));
    statics.push(part(new THREE.BoxGeometry(3, 0.5, 18), '#c8cdd3', fx, 0.3, fz, ry));
  }

  // ---- other grandstands (outside of the big corners)
  K.stand(24, 78, -1, { depth: 26, height: 12, roof: true, fascia: '#1f5fa8' });   // T1 snail
  K.stand(246, 286, -1, { depth: 18, height: 9 });                                // T6 hairpin
  K.stand(636, 694, -1, { depth: 20, height: 10, roof: true, fascia: '#e5383b' }); // T11-13
  K.stand(952, 1004, -1, { depth: 24, height: 12, roof: true, fascia: '#1f5fa8' }); // T14 hairpin
  K.stand(860, 930, -1, { depth: 16, height: 8 });                                 // back straight
  K.stand(1040, 1056, -1, { depth: 16, height: 8 });                               // T16

  // ---- farmland outside the lap in a grid aligned with the main straight, off the water
  const fields = [], fcol = ['#7fa54c', '#93b457', '#6c9444', '#aab860', '#c2b772', '#86a651', '#a4a35c'];
  for (let a = -1500; a < 1500; a += 74) for (let c = -1500; c < 1500; c += 50) {
    const x = cx + E_[0] * a + N_[0] * c, z = cz + E_[1] * a + N_[1] * c;
    if (Math.abs(x - cx) > K.groundHalf - 40 || Math.abs(z - cz) > K.groundHalf - 40 || rnd() < 0.12) continue;
    if (K.inside(x, z) || !api.isFree(x, z, 30)) continue;
    if ([[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([p, q]) => wetness(x + (E_[0] * 34 * p + N_[0] * 22 * q), z + (E_[1] * 34 * p + N_[1] * 22 * q)) > 0)) continue;
    fields.push([x, 0.14, z, 1, 1, GRID_YAW, fcol[rnd() * fcol.length | 0]]);
  }
  const fieldMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(64, 64, paintField), roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  K.inst(new THREE.PlaneGeometry(44, 68).rotateX(-Math.PI / 2), fieldMat, fields, false);

  // ---- village houses (white walls, dark roofs) in clusters; slab apartment blocks towards the city
  const walls = [];
  for (const [vx, vz, n] of [[-520, 180, 26], [1060, -420, 24], [-150, 420, 22], [640, -1180, 20], [-560, -980, 18], [1150, 260, 16]]) {
    for (let k = 0, t = 0; k < n && t < 200; t++) {
      const x = vx + R(-110, 110), z = vz + R(-80, 80);
      if (wetness(x, z) > 0 || !ok(x, z, 9)) continue;
      const ry = GRID_YAW + (rnd() < 0.5 ? 0 : Math.PI / 2), sc = R(0.85, 1.25), sy = R(0.9, 1.5);
      walls.push([x, 0, z, sc, sy, ry, rnd() < 0.8 ? '#eceae4' : '#d9d2c3', rnd() < 0.6 ? '#4b5563' : '#6d7a8c']);
      api.block(x, z, 9);
      k++;
    }
  }
  K.houses(walls);
  const blocks = [];
  for (let t = 0; t < 400 && blocks.length < 40; t++) {
    const a = THREE.MathUtils.degToRad(R(85, 150)), r = R(900, 1300), x = cx + Math.sin(a) * r, z = cz - Math.cos(a) * r;
    if (wetness(x, z) > 0 || !ok(x, z, 22, true)) continue;
    blocks.push([x, 0, z, 1, R(0.8, 1.8), GRID_YAW + (rnd() < 0.5 ? 0 : Math.PI / 2), rnd() < 0.5 ? '#e4e0d8' : '#cfd6dd']);
    api.block(x, z, 22);
  }
  const winTex = api.canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#f2f0ea'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 16) for (let x = 4; x < w; x += 16) { g.fillStyle = Math.random() < 0.7 ? '#6d7f94' : '#9fb3c6'; g.fillRect(x, y, 9, 9); }
  });
  K.inst(new THREE.BoxGeometry(36, 30, 12).translate(0, 15, 0), new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.8 }), blocks);

  // ---- trees: dawn-redwood rows along the canals, round trees in groves; low hedges behind the barrier
  const redwood = [], round = [], tint = () => new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.25 + rnd() * 0.2, 0.42 + rnd() * 0.14);
  for (const [ax, az, bx, bz, r] of WATER) {
    if (r > 30) continue;
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    for (const sg of [1, -1]) for (let d = 0; d < L; d += R(7, 11)) {
      const off = sg * (r + R(6, 9)), x = ax + ux * d - uz * off, z = az + uz * d + ux * off;
      if (ok(x, z, 2, true)) redwood.push([x, api.groundAt(x, z) - 0.2, z, R(0.8, 1.2), R(0.85, 1.35), rnd() * TAU, tint()]);
    }
  }
  for (let t = 0; t < 9000 && round.length < 650; t++) {
    const x = cx + R(-1300, 1300), z = cz + R(-1300, 1300), grove = Math.sin(x * 0.009) * Math.cos(z * 0.011 + 1) + 0.5 * Math.sin(x * 0.021 - z * 0.017);
    if (grove < 0.45 && rnd() > 0.08) continue;
    if (api.near(x, z)[0] > 700 && rnd() < 0.6) continue;
    if (wetness(x, z) > 0 || !ok(x, z, 3, true)) continue;
    (rnd() < 0.3 ? redwood : round).push([x, -0.1, z, R(0.8, 1.35), R(0.85, 1.3), rnd() * TAU, tint()]);
  }
  for (let t = 0; t < 8000 && round.length < 1100; t++) {   // clumps the player actually drives past
    const [x, , z] = at(rnd() * N, (rnd() < 0.5 ? 1 : -1) * (WALL + R(8, 130)));
    if (Math.sin(x * 0.02 + 0.5) * Math.cos(z * 0.018 - 1) < 0.3 || wetness(x, z) > 0 || !ok(x, z, 3, true)) continue;
    (rnd() < 0.25 ? redwood : round).push([x, -0.1, z, R(0.8, 1.35), R(0.85, 1.3), rnd() * TAU, tint()]);
  }
  K.trees('redwood', redwood);
  K.trees('round', round);
  const bushes = [];
  for (let t = 0; t < 2500 && bushes.length < 500; t++) {
    const i = rnd() * N | 0, sg = rnd() < 0.5 ? 1 : -1, [x, , z] = at(i, sg * (WALL + R(3, 9)));
    if (!ok(x, z, 1.2)) continue;
    const s = R(0.9, 1.8);
    bushes.push([x, 0, z, s, s * R(0.8, 1.1), rnd() * TAU, new THREE.Color().setHSL(0.25 + rnd() * 0.06, 0.4, 0.55 + rnd() * 0.2)]);
  }
  K.trees('bush', bushes);

  // ---- far away: hazy futuristic skyline to the ESE (bearing ~115 deg from the circuit), thin clouds
  K.band(paintSkyline, 116, 44, 1900, 330, { y: -14 });
  K.cloudDeck(rnd, { alpha: 0.38, count: 14 });

  K.flush();
}

export default { base: 'forest', env, baseBuild: false, build };
