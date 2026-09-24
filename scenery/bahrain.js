// Bahrain (Sakhir) night race: a floodlit circuit in a dark desert. Light towers along the whole lap, the paddock's
// wide-topped VIP tower behind the pits, the tent-roofed main grandstand, date palms, low rocks and scrub, and the
// neighbouring oil field (nodding pumpjacks, gas flares, distant town lights on the horizon).
// Also exports `kit(api)`: placement + geometry helpers shared with albertpark.js and sepang.js.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ======================================================================================
// Shared kit
// ======================================================================================
export function kit(api) {
  const { track, def, world } = api;
  const S = track.samples, N = S.length, W2 = track.width / 2, WALL = W2 + (def.wallGap ?? 9.4);
  const wrap = i => ((Math.round(i) % N) + N) % N;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of S) { minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z); }
  // corner[i]: sharpest curvature within ±30 samples (+ = left turn), 0 on straights
  const corner = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -30; k <= 30; k += 2) { const c = S[(i + k + N) % N].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
    corner[i] = Math.abs(m) > 1 / 350 ? m : 0;
  }
  const probe = (x, z) => {
    let bd = Infinity, bi = 0;
    for (let i = 0; i < N; i += 2) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const s = S[bi];
    return { d: Math.sqrt(bd), i: bi, lat: (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z };
  };
  // tall things: clear of blockers, and >= 22 m behind the wall on the inside of corners (chase-camera sightlines)
  const tallOk = (x, z, r, out = 3) => {
    if (!api.isFree(x, z, r)) return false;
    const p = probe(x, z), inside = p.lat * corner[p.i] < 0;
    return p.d - r >= WALL + (inside ? 22 : out);
  };
  const side = (i, lat) => { const s = S[wrap(i)]; return [s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat]; };
  const faceYaw = (i, lat) => { const s = S[wrap(i)], g = Math.sign(lat); return Math.atan2(s.right.x * g, s.right.z * g); };   // local -Z toward the road
  const outside = i => (corner[wrap(i)] > 0 ? 1 : -1);
  // reserve a long strip beside the road as a chain of circles
  const blockRun = (i0, i1, lat, r) => { for (let i = i0; i <= i1; i += Math.max(1, Math.round(r / track.spacing))) { const [x, z] = side(i, lat); api.block(x, z, r); } };

  const M = new THREE.Matrix4(), E = new THREE.Euler(), dm = new THREE.Object3D(), C = new THREE.Color();
  // primitive -> non-indexed, placed, vertex-coloured geometry (merge many into one draw call)
  function part(geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g.attributes.uv) g.deleteAttribute('uv');
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.toArray(a, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g.applyMatrix4(M.makeRotationFromEuler(E.set(rx, ry, rz)).setPosition(x, y, z));
  }
  const bake = (parts, x = 0, y = 0, z = 0, ry = 0) => mergeGeometries(parts).applyMatrix4(M.makeRotationY(ry).setPosition(x, y, z));
  function mesh(geo, mat, shadow = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  }
  // list entries: [x, y, z, ry, scale (number | [sx, sy, sz]), colour?]
  function inst(geo, mat, list, shadow = true) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach(([x, y, z, ry, s = 1, col], k) => {
      dm.position.set(x, y, z); dm.rotation.set(0, ry, 0);
      if (Array.isArray(s)) dm.scale.set(s[0], s[1], s[2]); else dm.scale.setScalar(s);
      dm.updateMatrix(); m.setMatrixAt(k, dm.matrix);
      if (col != null) m.setColorAt(k, C.set(col));
    });
    m.count = list.length;
    m.castShadow = shadow; m.receiveShadow = true;
    world.add(m);
    return m;
  }
  const vc = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...o });

  // approximate distance to the centerline from a 20 m grid (bilinear), for bulk work like terrain tinting
  let DG = null;
  const GX0 = minX - 1700, GZ0 = minZ - 1700, GC = 20, GW = Math.ceil((maxX - minX + 3400) / GC), GH = Math.ceil((maxZ - minZ + 3400) / GC);
  function dist(x, z) {
    if (!DG) {
      DG = new Float32Array(GW * GH);
      const P = S.filter((_, i) => i % 3 === 0).map(s => [s.pos.x, s.pos.z]);
      for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
        const x0 = GX0 + i * GC, z0 = GZ0 + j * GC;
        let b = Infinity;
        for (const [px, pz] of P) { const d = (px - x0) ** 2 + (pz - z0) ** 2; if (d < b) b = d; }
        DG[j * GW + i] = Math.sqrt(b);
      }
    }
    const u = clamp((x - GX0) / GC, 0, GW - 1.001), v = clamp((z - GZ0) / GC, 0, GH - 1.001), i = u | 0, j = v | 0, fu = u - i, fv = v - j, k = j * GW + i;
    return (DG[k] * (1 - fu) + DG[k + 1] * fu) * (1 - fv) + (DG[k + GW] * (1 - fu) + DG[k + GW + 1] * fu) * fv;
  }

  // recolour world.js's terrain sheet: fn(x, z, y, distToCenterline, color) sets the vertex colour (multiplies the ground texture)
  function tintGround(fn) {
    const v = new THREE.Vector3();
    world.traverse(o => {
      const g = o.geometry, col = g?.attributes?.color;
      if (!o.isMesh || o.isInstancedMesh || !col || !o.material?.map) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox.max.x - g.boundingBox.min.x < 900) return;   // only the big terrain sheet
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        fn(v.x, v.z, v.y, dist(v.x, v.z), C);
        col.setXYZ(i, C.r, C.g, C.b);
      }
      col.needsUpdate = true;
    });
  }

  // lit / unlit window grid; returns [colour map, emissive map] painted from the same layout
  function windowTex(cols, rows, { frame = '#d9d4c8', glass = '#34495e', lit = '#ffd89a', litP = 0.5, seed = 7 } = {}) {
    const paint = em => api.canvasTex(cols * 16, rows * 16, (g, w, h) => {
      let s = seed;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      g.fillStyle = em ? '#000' : frame; g.fillRect(0, 0, w, h);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const on = r() < litP, k = 0.7 + r() * 0.3;
        g.fillStyle = on ? lit : em ? '#000' : glass;
        if (!em && !on) g.globalAlpha = k;
        g.fillRect(x * 16 + 2, y * 16 + 3, 12, 10);
        g.globalAlpha = 1;
      }
    });
    return [paint(false), paint(true)];
  }

  // grandstand: length along X, local -Z faces the road, rows climb toward +Z; roof: 'flat' | 'tent' | null
  let crowdTex = null;
  function stand(len, { rows = 12, roof = 'flat', concrete = '#c9c5bc', fascia = '#d7263d', canopy = '#f2efe8', glow = 0 } = {}) {
    const g = new THREE.Group(), P = [], R = [], h0 = 1.4, top = h0 + rows * 0.55;
    for (let r = 0; r < rows; r++) P.push(part(new THREE.BoxGeometry(len, h0 + (r + 1) * 0.55, 1.1), concrete, 0, (h0 + (r + 1) * 0.55) / 2, r * 1.1 + 0.55));
    P.push(part(new THREE.BoxGeometry(len, top + 2.2, 0.5), '#8d8a84', 0, (top + 2.2) / 2, rows * 1.1 + 0.25));   // back wall
    for (let x = -len / 2 + 4; x < len / 2 - 2; x += 8) P.push(part(new THREE.BoxGeometry(0.8, top + 2.2, 0.5), '#6f6c67', x, (top + 2.2) / 2, rows * 1.1 + 0.6));   // ribs
    P.push(part(new THREE.BoxGeometry(len + 0.2, 0.8, 0.7), fascia, 0, top + 1.8, rows * 1.1 + 0.35));
    for (const sx of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.5, top + 1, rows * 1.1 + 0.5), '#9a968f', sx * (len / 2 + 0.25), (top + 1) / 2, rows * 1.1 / 2));
    P.push(part(new THREE.BoxGeometry(len, 0.9, 0.3), fascia, 0, h0 - 0.2, -0.1));
    const roofY = top + 6, depth = rows * 1.1 + 3;
    if (roof === 'flat') {
      R.push(part(new THREE.BoxGeometry(len + 2, 0.4, depth), canopy, 0, roofY, depth / 2 - 2.5, 0, -0.07));
      R.push(part(new THREE.BoxGeometry(len + 2, 1, 0.3), fascia, 0, roofY - 0.2 + (depth / 2) * 0.07, -2.4));
      for (let x = -len / 2; x <= len / 2 + 0.1; x += len / Math.max(2, Math.round(len / 18))) P.push(part(new THREE.BoxGeometry(0.4, roofY, 0.4), '#7d7a75', x, roofY / 2, rows * 1.1 + 0.6));
    } else if (roof === 'tent') {   // row of white fabric peaks on masts (tensile roof)
      const bays = Math.max(1, Math.round(len / 14)), bw = len / bays;
      for (let b = 0; b < bays; b++) {
        const x = -len / 2 + bw * (b + 0.5);
        R.push(part(new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).scale(bw * 0.72, 5.5, depth * 0.72), canopy, x, roofY + 2.75, depth / 2 - 2));
        P.push(part(new THREE.CylinderGeometry(0.18, 0.22, roofY + 8, 6), '#dcd8d0', x, (roofY + 8) / 2, depth / 2 - 2));
      }
      for (let x = -len / 2; x <= len / 2 + 0.1; x += bw) P.push(part(new THREE.BoxGeometry(0.35, roofY, 0.35), '#bdb8ae', x, roofY / 2, rows * 1.1 + 0.6));
      R.push(part(new THREE.BoxGeometry(len, 0.35, 0.35), '#bdb8ae', 0, roofY, -2), part(new THREE.BoxGeometry(len, 0.35, 0.35), '#bdb8ae', 0, roofY, depth - 2));
    }
    const body = new THREE.Mesh(mergeGeometries(P), vc({ roughness: 0.85 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    if (R.length) {
      const rm = new THREE.Mesh(mergeGeometries(R), vc({ roughness: 0.6, side: THREE.DoubleSide, ...(glow ? { emissive: 0xffc98a, emissiveIntensity: glow * 0.12 } : {}) }));
      rm.castShadow = true; g.add(rm);
    }
    // seated crowd: one alpha-tested sheet over the steps
    crowdTex ??= api.canvasTex(256, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      const shirts = ['#e63946', '#f1faee', '#1d3557', '#ffb703', '#2a9d8f', '#d9d4c7', '#ff7b00', '#457b9d', '#222', '#8338ec'];
      for (let r = 0; r < 8; r++) for (let k = 0; k < 32; k++) {
        if (Math.random() < 0.14) continue;
        const x = k * 8 + 1 + Math.random() * 2, y = r * 16 + 3;
        c.fillStyle = shirts[(Math.random() * shirts.length) | 0]; c.fillRect(x, y + 5, 6, 9);
        c.fillStyle = ['#f1c7a3', '#c68c5d', '#8d5a3b', '#3b2a20'][(Math.random() * 4) | 0]; c.fillRect(x + 1, y, 4, 5);
      }
    });
    const tex = crowdTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 12, rows / 8);
    const slope = Math.hypot(rows * 1.1, rows * 0.55);
    const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.6, slope), new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.5, roughness: 0.9, side: THREE.DoubleSide, ...(glow ? { emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow * 0.35 } : {}),
    }));
    crowd.rotation.x = Math.PI / 2 - Math.atan2(0.55, 1.1);   // +Y up the slope (heads up)
    crowd.position.set(0, h0 + rows * 0.275 + 0.75, rows * 0.55);
    g.add(crowd);
    return g;
  }

  // pit building: garages facing the road (local -Z), glazed hospitality floor, roof deck, sign board
  function pits(len, { wall = '#f1f1ee', stripe = '#1f6feb', sign = 'PIT BUILDING  ピット', night = false } = {}) {
    const g = new THREE.Group(), P = [];
    P.push(part(new THREE.BoxGeometry(len, 5, 16), wall, 0, 2.5, 8));
    P.push(part(new THREE.BoxGeometry(len + 1, 0.7, 17), stripe, 0, 5.2, 8));
    P.push(part(new THREE.BoxGeometry(len + 3, 0.4, 20), '#d8dadf', 0, 10.4, 7.5));
    const body = new THREE.Mesh(mergeGeometries(P), vc({ roughness: 0.6 }));
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const doors = api.canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = night ? '#d8d2c2' : '#2a3140'; c.fillRect(0, 0, w, h);
      if (!night) for (let y = 0; y < h; y += 4) { c.fillStyle = '#1a1f2a'; c.fillRect(0, y, w, 1); }
      else { c.fillStyle = '#9aa0a8'; c.fillRect(0, h * 0.7, w, h * 0.3); c.fillStyle = '#e63946'; c.fillRect(w * 0.1, h * 0.35, w * 0.8, h * 0.12); }
      c.fillStyle = '#1a1d22'; c.fillRect(0, 0, 3, h); c.fillRect(w - 3, 0, 3, h);
    });
    doors.repeat.set(Math.floor(len / 7), 1);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(len - 2, 3.8), new THREE.MeshStandardMaterial({ map: doors, roughness: 0.5, ...(night ? { emissive: 0xffffff, emissiveMap: doors, emissiveIntensity: 0.55 } : {}) }));
    door.position.set(0, 2.1, -0.02); door.rotation.y = Math.PI;
    g.add(door);
    const [wm, we] = windowTex(Math.floor(len / 3), 2, { litP: night ? 0.85 : 0.15, glass: '#2d4660', frame: '#e8e8e8' });
    const glass = new THREE.Mesh(new THREE.BoxGeometry(len, 4.4, 14), new THREE.MeshStandardMaterial({ map: wm, roughness: 0.25, metalness: 0.3, emissive: 0xffffff, emissiveMap: we, emissiveIntensity: night ? 1.1 : 0.05 }));
    glass.position.set(0, 7.9, 8);
    g.add(glass);
    const st = api.canvasTex(1024, 128, (c, w, h) => {
      c.fillStyle = '#10131a'; c.fillRect(0, 0, w, h);
      c.fillStyle = stripe; c.fillRect(0, h - 12, w, 12);
      c.fillStyle = '#fff'; c.font = 'bold 72px "Hiragino Sans","Yu Gothic",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(sign, w / 2, h / 2 - 4, w - 60);
    }, false);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(40, len * 0.5), 5), new THREE.MeshStandardMaterial({ map: st, emissive: 0xffffff, emissiveMap: st, emissiveIntensity: night ? 0.8 : 0.1 }));
    sg.position.set(0, 13.2, 1); sg.rotation.y = Math.PI;
    g.add(sg);
    return g;
  }

  // palms: frond strips with an alpha leaflet texture; returns { trunk, crown } geometries (crown origin at trunk top)
  function frondGeo(len, width, a0, a1, fold, segs) {
    const pos = [], uv = [], idx = [];
    let x = 0, y = 0;
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      if (k) { const a = a0 + (a1 - a0) * Math.pow((k - 0.5) / segs, 1.3); x += Math.cos(a) * len / segs; y += Math.sin(a) * len / segs; }
      const w = width * Math.pow(Math.sin(Math.PI * Math.max(s, 0.08)), 0.6), f = fold * w;
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
  function frondMat(rgb0, rgb1, rib = '#a4a45a') {
    const tex = api.canvasTex(128, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.lineCap = 'round';
      for (let y = h - 3; y > 6; y -= 3.4) {
        const t = 1 - y / h, len = (w / 2 - 4) * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t)), 0.6));
        for (const sd of [-1, 1]) {
          const l = len * (0.8 + Math.random() * 0.2), k = Math.random();
          g.strokeStyle = `rgb(${rgb0.map((v, j) => (v + (rgb1[j] - v) * (t * 0.6 + k * 0.4)) | 0).join(',')})`;
          g.lineWidth = 3.4;
          g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + sd * l * 0.5, y - 5, w / 2 + sd * l, y - 16); g.stroke();
        }
      }
      g.strokeStyle = rib; g.lineWidth = 3.5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
    }, false);
    return new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
  }
  function palm(rnd, { H = 9, bend = 1, r = 0.3, fronds = 10, up = 3, len = 4.6, width = 0.95, droop = [-1.0, -1.5], segs = 5, bark = ['#6e5a44', '#4c3d2e'] } = {}) {
    const SEG = 8, RAD = 6, pos = [], col = [], idx = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG, px = bend * t * t, py = H * t, rr = r * (1 - 0.25 * t) + r * 0.8 * (1 - t) ** 8, c = new THREE.Color(bark[k % 2]);
      for (let j = 0; j < RAD; j++) { const a = j / RAD * TAU; pos.push(px + rr * Math.cos(a), py, rr * Math.sin(a)); col.push(c.r, c.g, c.b); }
    }
    for (let k = 0; k < SEG; k++) for (let j = 0; j < RAD; j++) { const a = k * RAD + j, b = k * RAD + (j + 1) % RAD; idx.push(a, a + RAD, b, b, a + RAD, b + RAD); }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tg.setIndex(idx);
    tg.computeVertexNormals();
    const F = [], R = (a, b) => a + (b - a) * rnd();
    for (let i = 0; i < fronds; i++) F.push(frondGeo(len * R(0.85, 1.1), width, R(0.35, 0.75), R(droop[0], droop[1]), 0.3, segs).rotateY(i / fronds * TAU + R(-0.2, 0.2)));
    for (let i = 0; i < up; i++) F.push(frondGeo(len * 0.62, width * 0.75, R(1.1, 1.3), R(0.3, 0.6), 0.3, Math.max(2, segs - 2)).rotateY(i / up * TAU + 0.5));
    return { trunk: tg, crown: mergeGeometries(F).translate(bend, H - 0.1, 0) };
  }
  // palm variants -> instanced trunks + crowns; list entries [x, y, z, ry, scale, variant]
  function palms(variants, list, fMat, tint) {
    const tMat = vc({ roughness: 0.95 });
    variants.forEach((v, k) => {
      const L = list.filter(e => e[5] === k);
      if (!L.length) return;
      inst(v.trunk, tMat, L.map(e => e.slice(0, 5)));
      inst(v.crown, fMat, L.map(e => [...e.slice(0, 5), tint()])).receiveShadow = false;
    });
  }

  // radial glow sprite texture (for Points)
  const glowTex = (inner = 'rgba(255,245,220,1)', mid = 'rgba(255,200,120,0.35)') => api.canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, inner); gr.addColorStop(0.18, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
  function points(list /* [x,y,z] */, { size = 10, tex, color = 0xffffff, atten = true, fog = true, opacity = 1 } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, ...(tex ? { map: tex } : {}), color, sizeAttenuation: atten, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog, toneMapped: false }));
    p.frustumCulled = false;
    world.add(p);
    return p;
  }

  return {
    S, N, W2, WALL, wrap, corner, probe, dist, tallOk, side, faceYaw, outside, blockRun,
    part, bake, mesh, inst, vc, tintGround, windowTex, stand, pits, palm, palms, frondMat, glowTex, points,
    bounds: { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 },
  };
}

// ======================================================================================
// Bahrain
// ======================================================================================
const env = {
  sky: { top: '#03050f', horizon: '#3b2b2c', bottom: '#120d0b' },
  fog: { color: '#1d1717', near: 260, far: 1700 },
  sun: { dir: [0.28, 0.9, 0.34], color: '#fff1dc', intensity: 1.55 },   // the floodlights, as one high key light
  hemi: { sky: '#8c8aa6', ground: '#6b5238', intensity: 0.95 },
  exposure: 1.12,
  envIntensity: 0.12,
  night: true,
  terrain: { base: '#c79d6b', hills: 6, rim: 26, rimColor: '#8d7152' },
  road: { base: '#3d3c3f', line: '#f3eee2', edge: '#f3eee2' },
  shoulder: '#a58d68',
  barrier: 'ads',
  curb: ['#d62828', '#f4f4f4'],
};

function build(api) {
  const K = kit(api), { N, W2, side, faceYaw, outside, tallOk, probe, part, bake, inst, mesh, vc, corner } = K;
  const { world, rnd, track } = api, ground = api.groundAt, sp = track.spacing;
  const R = (a, b) => a + (b - a) * rnd();
  const { cx, cz } = K.bounds;
  const at = m => Math.round(m / sp);   // metres along the lap from the start line -> sample offset

  // floodlit circuit, dark desert: fade the sand out with distance from the road
  K.tintGround((x, z, y, d, c) => {
    const lit = 0.2 + 0.8 * (1 - smooth(35, 330, d)), n = 0.92 + 0.1 * Math.sin(x * 0.05) * Math.cos(z * 0.043);
    const patch = Math.sin(x * 0.013 + 1.7 * Math.sin(z * 0.009)) * Math.cos(z * 0.017 - x * 0.006);   // gravel flats / pale drifts
    const k = lit * n * (1 + 0.16 * patch);
    c.setRGB(0.9 * k, 0.97 * k, (1.18 + 0.1 * smooth(60, 400, d) - 0.08 * patch) * k);   // paler sand; far sand a little cooler (moonlight)
  });
  const dim = (x, z) => 0.3 + 0.7 * (1 - smooth(60, 380, K.dist(x, z)));

  // ---- pit building (infield, right of the start straight)
  {
    const pb = K.pits(300, { stripe: '#c8102e', sign: 'サクヒール  GRAND PRIX', night: true });
    const [x, z] = side(at(-30), W2 + 21);
    pb.position.set(x, ground(x, z) - 0.2, z); pb.rotation.y = faceYaw(at(-30), 1);
    world.add(pb);
    K.blockRun(at(-190), at(130), W2 + 30, 14);
    // paddock hospitality units behind the garages: white boxes with a lit glass band
    const P = [], L = [];
    for (let m = -175; m <= -15; m += 23) {
      const i = at(m), [hx, hz] = side(i, W2 + 63), y = ground(hx, hz) - 0.2, ry = faceYaw(i, 1);
      P.push(bake([part(new THREE.BoxGeometry(18, 7, 10), m % 2 ? '#eeeeea' : '#d9dde3', 0, 3.5, 0), part(new THREE.BoxGeometry(19, 0.4, 11), '#44474d', 0, 7.2, 0)], hx, y, hz, ry));
      L.push(bake([part(new THREE.BoxGeometry(18.2, 1.3, 10.2), '#ffd9a0', 0, 4.9, 0), part(new THREE.BoxGeometry(18.2, 0.5, 10.2), '#ffd9a0', 0, 1.6, 0)], hx, y, hz, ry));
      api.block(hx, hz, 10);
    }
    mesh(mergeGeometries(P), vc({ roughness: 0.6 }));
    mesh(mergeGeometries(L), new THREE.MeshBasicMaterial({ vertexColors: true }), false);
  }
  // ---- VIP tower behind the paddock: octagonal shaft, stacked glazed floors flaring outward, a wide overhanging roof
  const tower = { i: at(40), lat: W2 + 84 };
  {
    const [x, z] = side(tower.i, tower.lat), y = ground(x, z) - 0.3, ry = faceYaw(tower.i, 1), P = [], G = [];
    P.push(part(new THREE.CylinderGeometry(20, 22, 3, 8), '#c9b89a', 0, 1.5, 0));
    P.push(part(new THREE.CylinderGeometry(6.5, 8, 36, 8), '#d8c8a8', 0, 19, 0));
    for (const a of [0, 1, 2, 3]) P.push(part(new THREE.BoxGeometry(1.2, 34, 3), '#bca98a', Math.cos(a * Math.PI / 2 + 0.4) * 7.6, 18, Math.sin(a * Math.PI / 2 + 0.4) * 7.6, -(a * Math.PI / 2 + 0.4)));
    for (const [r0, r1, fy] of [[11, 12, 37], [13.5, 14.5, 41], [16, 17, 45], [18.5, 19.5, 49]]) {
      P.push(part(new THREE.CylinderGeometry(r1 + 0.6, r0 + 0.4, 0.6, 8), '#efe8da', 0, fy - 1.9, 0));
      G.push(new THREE.CylinderGeometry(r1, r0, 3.2, 8, 1, true).translate(0, fy, 0));
    }
    P.push(part(new THREE.CylinderGeometry(25, 21, 1.4, 8), '#f4efe4', 0, 51.6, 0));   // the wide roof
    P.push(part(new THREE.CylinderGeometry(24.6, 24.6, 0.5, 8), '#c8102e', 0, 50.8, 0));
    P.push(part(new THREE.CylinderGeometry(4, 5, 4, 8), '#e2dccd', 0, 54, 0));
    P.push(part(new THREE.CylinderGeometry(0.25, 0.4, 14, 5), '#aaaaaa', 0, 62, 0));
    mesh(bake(P, x, y, z, ry), vc({ roughness: 0.55 }));
    const [wm, we] = K.windowTex(16, 1, { glass: '#23384d', frame: '#e8e2d4', lit: '#ffe2b0', litP: 0.9 });
    wm.repeat.set(3, 1); we.repeat.set(3, 1);
    mesh(bake(G.map(g => g.toNonIndexed()), x, y, z, ry), new THREE.MeshStandardMaterial({ map: wm, emissive: 0xffffff, emissiveMap: we, emissiveIntensity: 1.3, roughness: 0.2, metalness: 0.4, side: THREE.DoubleSide }), false);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }));
    beacon.position.set(x, y + 69.2, z);
    world.add(beacon);
    let t = 0;
    api.onUpdate(dt => { t += dt; beacon.visible = t % 1.6 < 0.8; });
    api.block(x, z, 28);
    tower.x = x; tower.z = z;
  }

  // ---- grandstands: tent-roofed main stand opposite the pits and at T1; stands outside T4, T10 and T14
  const stands = [
    [at(-40), -1, 230, 16, 'tent'],
    [at(505), -1, 90, 12, 'tent'],
    [311, 0, 80, 10, 'flat'],
    [585, 0, 60, 10, 'flat'],
    [1060, 0, 70, 10, 'flat'],
  ];
  for (const [i, sg0, len, rows, roof] of stands) {
    const sg = sg0 || outside(i), lat = sg * (W2 + 17 + (roof === 'tent' ? 3 : 0));
    const [x, z] = side(i, lat);
    const st = K.stand(len, { rows, roof, glow: 1, fascia: '#c8102e', canopy: roof === 'tent' ? '#f6f2ea' : '#e9e6df' });
    st.position.set(x, ground(x, z) - 0.2, z); st.rotation.y = faceYaw(i, lat);
    world.add(st);
    const n = Math.ceil(len / 20), c = Math.cos(st.rotation.y), s = Math.sin(st.rotation.y), oz = rows * 0.55;
    for (let k = 0; k <= n; k++) { const ox = -len / 2 + k * len / n; api.block(x + ox * c + oz * s, z - ox * s + oz * c, 13); }
  }

  // ---- floodlight towers along the whole lap: outside of corners, alternating sides on straights
  {
    const poles = [], heads = [], glows = [], step = Math.round(52 / sp);
    for (let j = 0, n = Math.floor(N / step); j < n; j++) {
      const i = j * step, c = corner[i];
      for (const sg of c ? [c > 0 ? 1 : -1] : [j % 2 ? 1 : -1, j % 2 ? -1 : 1]) {
        const lat = sg * (W2 + 16), [x, z] = side(i, lat);
        if (!api.isFree(x, z, 1)) continue;
        const y = ground(x, z), ry = faceYaw(i, lat);
        poles.push([x, y, z, ry, 1]);
        heads.push([x, y + 30, z, ry, 1]);
        glows.push([x - Math.sin(ry) * 1.2, y + 29.6, z - Math.cos(ry) * 1.2]);
        api.block(x, z, 1.5);
        break;
      }
    }
    inst(new THREE.CylinderGeometry(0.28, 0.45, 30, 6).translate(0, 15, 0), new THREE.MeshStandardMaterial({ color: 0x8a8d93, metalness: 0.6, roughness: 0.4 }), poles);
    inst(new THREE.BoxGeometry(5.2, 2.6, 0.8).translate(0, 0, 0.3).rotateX(0.45), new THREE.MeshStandardMaterial({ color: 0x50545b, roughness: 0.5 }), heads, false);
    inst(new THREE.PlaneGeometry(4.8, 2.2).rotateY(Math.PI).rotateX(0.45).translate(0, 0.05, -0.18), new THREE.MeshBasicMaterial({ color: 0xfff7e8, toneMapped: false }), heads, false);
    K.points(glows, { size: 26, tex: K.glowTex(), opacity: 0.85 });
  }
  // a few real lights: the grid, the T1 braking zone, the tower plaza
  for (const [i, lat, h, I] of [[at(-20), 0, 22, 2600], [at(420), -6, 22, 2200], [tower.i, W2 + 50, 26, 1800]]) {
    const [x, z] = side(i, lat), l = new THREE.PointLight(0xffe6c4, I, 120, 1.7);
    l.position.set(x, ground(x, z) + h, z);
    world.add(l);
  }

  // ---- date palms: paddock rows behind the pits, around the tower, behind the main stand, clusters near the stands
  const fMat = K.frondMat([60, 78, 40], [128, 138, 78], '#8d8a58');
  const PV = [0, 1, 2].map(k => K.palm(rnd, { H: 7 + k * 1.6, bend: [0.2, 0.7, 1.4][k], r: 0.38, fronds: 13, up: 4, len: 3.8, width: 0.75, droop: [-0.5, -1.1], segs: 4, bark: ['#7a6448', '#5a4834'] }));
  const palmList = [];
  const addPalm = (x, z, s = R(0.85, 1.15)) => {
    if (!tallOk(x, z, 2)) return false;
    palmList.push([x, ground(x, z) - 0.2, z, rnd() * TAU, s, (rnd() * 3) | 0]);
    api.block(x, z, 2.5);
    return true;
  };
  for (let m = -180; m <= 150; m += 14) { const [x, z] = side(at(m), W2 + 48); addPalm(x, z); }
  for (let m = -170; m <= 140; m += 16) { const [x, z] = side(at(m), -(W2 + 44)); addPalm(x, z); }
  for (let k = 0; k < 14; k++) { const a = k / 14 * TAU; addPalm(tower.x + Math.cos(a) * 34, tower.z + Math.sin(a) * 34); }
  for (let n = 0, t = 0; n < 70 && t < 3000; t++) {
    const [si] = stands[(rnd() * stands.length) | 0], sg = rnd() < 0.5 ? 1 : -1, [x, z] = side(si + R(-30, 30), sg * R(W2 + 30, W2 + 110));
    if (addPalm(x, z)) n++;
  }
  K.palms(PV, palmList, fMat, () => new THREE.Color().setRGB(R(0.8, 1), R(0.85, 1), R(0.8, 0.95)));

  // ---- low desert rocks and dry scrub (darker the further they are from the floodlights)
  const rocks = [], scrub = [];
  for (let n = 0, t = 0; n < 420 && t < 8000; t++) {
    const x = cx + R(-900, 900), z = cz + R(-900, 900), d = K.dist(x, z);
    if (d > 700 || (d > 250 && rnd() < 0.5) || !api.isFree(x, z, 2)) continue;
    const s = R(0.5, 1.2) + (rnd() < 0.15 ? R(1, 2.2) : 0);
    rocks.push([x, ground(x, z) - s * 0.25, z, rnd() * TAU, [s * R(1, 1.8), s * R(0.35, 0.6), s * R(0.9, 1.4)], new THREE.Color().setHSL(0.08, 0.25, R(0.34, 0.46) * dim(x, z))]);
    n++;
  }
  for (let n = 0, t = 0; n < 14 && t < 600; t++) {   // limestone outcrops: low clusters of big slabs
    const x = cx + R(-1000, 1000), z = cz + R(-1000, 1000), d = K.dist(x, z);
    if (d < 70 || d > 650 || !api.isFree(x, z, 16)) continue;
    for (let k = 0, m = 4 + ((rnd() * 7) | 0); k < m; k++) {
      const px = x + R(-14, 14), pz = z + R(-14, 14), s = R(2.5, 6);
      rocks.push([px, ground(px, pz) - s * 0.2, pz, rnd() * TAU, [s * R(1.2, 2), s * R(0.3, 0.55), s * R(0.9, 1.5)], new THREE.Color().setHSL(0.09, 0.22, R(0.36, 0.5) * dim(px, pz))]);
    }
    api.block(x, z, 16);
    n++;
  }
  inst(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), rocks);
  for (let n = 0, t = 0; n < 900 && t < 12000; t++) {   // denser along the road where it is seen
    const x = cx + R(-800, 800), z = cz + R(-800, 800), d = K.dist(x, z);
    if (d > 500 || (d > 90 && rnd() < 0.6) || !api.isFree(x, z, 1)) continue;
    const s = R(0.4, 1.0);
    scrub.push([x, ground(x, z) + s * 0.1, z, rnd() * TAU, [s * 1.3, s * 0.6, s * 1.3], new THREE.Color().setHSL(R(0.12, 0.2), 0.3, R(0.22, 0.32) * dim(x, z))]);
    n++;
  }
  inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), scrub);

  // ---- oil field to the north-east: nodding pumpjacks + gas flares; distant town lights on the horizon
  const jacks = [], F = [];
  for (let n = 0, t = 0; n < 16 && t < 2000; t++) {
    const x = cx + R(200, 900), z = cz + R(-950, -150), d = probe(x, z).d;
    if (d < 90 || d > 600 || !api.isFree(x, z, 8) || jacks.some(j => (j[0] - x) ** 2 + (j[2] - z) ** 2 < 900)) continue;
    const y = ground(x, z), ry = rnd() * TAU;
    jacks.push([x, y, z, ry, R(0, TAU)]);
    api.block(x, z, 8);
    const P = [part(new THREE.BoxGeometry(9, 0.6, 2.4), '#4a4d52', 0, 0.3, 0)];
    for (const s of [-1, 1]) P.push(part(new THREE.BoxGeometry(0.3, 5.2, 0.3), '#3c3f45', 0.4, 2.6, s * 0.9, 0, s * 0.18, 0.12), part(new THREE.BoxGeometry(0.3, 5.2, 0.3), '#3c3f45', -0.8, 2.6, s * 0.9, 0, s * 0.18, -0.12));
    P.push(part(new THREE.BoxGeometry(2, 1.6, 1.8), '#5f6269', -3.2, 1.1, 0), part(new THREE.CylinderGeometry(0.12, 0.12, 3, 5), '#777777', 3.9, 1.5, 0));
    F.push(bake(P, x, y, z, ry));
  }
  const stacks = [], flares = [];
  for (const [ox, oz] of [[1050, -700], [1250, -300], [760, -1150]]) {
    const x = cx + ox, z = cz + oz, y = ground(x, z);
    stacks.push(part(new THREE.CylinderGeometry(0.5, 0.8, 34, 6), '#3a3b3f', x, y + 17, z));
    flares.push([x, y + 36, z]);
  }
  mesh(mergeGeometries([...F, ...stacks]), vc({ roughness: 0.6, metalness: 0.3 }));
  const beams = new THREE.InstancedMesh(mergeGeometries([
    part(new THREE.BoxGeometry(8, 0.45, 0.45), '#c9a227', 0.2, 0, 0),
    part(new THREE.BoxGeometry(0.5, 2.2, 0.8), '#c9a227', 4.1, -0.7, 0, 0, 0, 0.1),
    part(new THREE.BoxGeometry(1.4, 1.2, 1.2), '#3c3f45', -3.6, -0.4, 0),
  ]), vc({ roughness: 0.5, metalness: 0.3 }), Math.max(1, jacks.length));
  beams.count = jacks.length;
  beams.castShadow = true;
  world.add(beams);
  const fl = K.points(flares, { size: 30, tex: K.glowTex('rgba(255,240,190,1)', 'rgba(255,120,30,0.6)') });
  const dmy = new THREE.Object3D();
  dmy.rotation.order = 'YXZ';
  let t = 0;
  const animate = dt => {
    t += dt;
    jacks.forEach(([x, y, z, ry, ph], k) => {
      dmy.position.set(x, y + 5.3, z); dmy.rotation.set(0, ry, 0.32 * Math.sin(t * 1.3 + ph));
      dmy.updateMatrix(); beams.setMatrixAt(k, dmy.matrix);
    });
    beams.instanceMatrix.needsUpdate = true;
    fl.material.size = 26 + 8 * Math.sin(t * 9.1) * Math.sin(t * 3.7);
  };
  animate(0);
  api.onUpdate(animate);
  const town = [];
  for (let k = 0; k < 900; k++) {   // denser toward the north (Manama) and east
    const a = -Math.PI / 2 + (rnd() - 0.5) * (rnd() < 0.6 ? 1.6 : 5.5), r = R(1700, 2600);
    town.push([cx + Math.cos(a) * r, r * 0.021 + R(0, 9), cz + Math.sin(a) * r]);   // just above the rim line
  }
  K.points(town, { size: 2.2, color: 0xffcf8a, atten: false, fog: false, opacity: 0.9 });
}

export default { base: 'desert', env, baseBuild: false, build };
