// Car meshes: models/<carId>.glb when present, otherwise a stylised procedural body per CAR.body.
// Extra (non-contract) userData on procedural cars: steer = front wheel pivots (rotation.y),
// anim(time, speed) = optional idle/fun animation (shark tail, dragon wings). wheels[i].userData.r = radius.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARS, CAR_BY_ID } from './data.js';

const CAR_LEN = 4.2;
const CAR_MAX_W = 2.4;   // Meshy cars are chubby: at 4.2 m long the kei would be 2.9 m wide / 2.5 m tall (collision is ~2 m)
const glbCache = new Map();

// fetch + parse ourselves: a timeout and retries survive flaky local servers (a stalled request must not hang a race start).
// The timeout is on silence, not on the whole download: a 3 MB model on a slow phone link must still finish.
// Returns undefined when the network gave up (retried on the next load), null when there is no usable model.
async function fetchGLB(url) {
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    let stall = 0;
    const poke = () => { clearTimeout(stall); stall = setTimeout(() => ac.abort(), 8000); };
    let buf;
    try {
      poke();
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return null;                 // 404: no model -> procedural
      buf = await new Response(res.body.pipeThrough(new TransformStream({ transform(c, out) { poke(); out.enqueue(c); } }))).arrayBuffer();
    } catch { continue; }                       // network hiccup / stall -> retry
    finally { clearTimeout(stall); }
    try { return (await new GLTFLoader().parseAsync(buf, 'models/')).scene || null; } catch { return null; }
  }
  return undefined;
}

function loadGLB(carId) {
  if (!glbCache.has(carId)) {
    glbCache.set(carId, fetchGLB(`models/${carId}.glb`).then(m => {
      if (m === undefined) glbCache.delete(carId);   // network trouble: try again next race instead of a procedural car all session
      return m ?? null;
    }));
  }
  return glbCache.get(carId);
}

export async function preloadCarModels(carIds) {
  try { for (const id of carIds || []) await loadGLB(id); } catch { /* never throws */ }   // one at a time: python http.server resets bursts
}

export async function buildCarMesh(carId, look, opts = {}) {
  const def = CAR_BY_ID[carId] || CARS[0];
  look = { body: def.color, wheel: '#222222', wing: false, ...(look || {}) };
  let group = null;
  const src = await loadGLB(def.id);
  if (src) { try { group = fromGLB(src, def, look); } catch { group = null; } }
  if (!group) group = procedural(def, look);
  group.traverse(o => { if (o.isMesh) { o.castShadow = !opts.ghost; o.receiveShadow = false; } });
  if (opts.ghost) {
    group.traverse(o => {
      if (!o.isMesh) return;
      for (const mat of [].concat(o.material)) { mat.transparent = true; mat.opacity = 0.35; mat.depthWrite = false; }
    });
  }
  group.name = 'car:' + def.id;
  return group;
}

// ---------- GLB ----------
function fromGLB(src, def, look) {
  const model = src.clone(true);
  model.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => x.clone()) : o.material.clone(); });
  const inner = new THREE.Group();
  inner.add(model);
  inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  inner.scale.setScalar(Math.min(CAR_LEN / Math.max(size.x, size.z, 1e-6), CAR_MAX_W / Math.max(Math.min(size.x, size.z), 1e-6)));
  inner.updateMatrixWorld(true);
  box.setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  const pivot = new THREE.Group();
  pivot.rotation.y = def.modelRot || 0;
  pivot.add(inner);
  const g = new THREE.Group();
  g.add(pivot);
  g.userData.wheels = [];
  g.userData.steer = [];

  const best = largestMaterial(model);
  if (best?.map?.image) repaint(best, def, look.body, model);
  else if (best?.color) best.color.set(look.body);

  if (look.wing) {
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    const s = new THREE.Group(), z = b.min.z + 0.45, w = Math.min(1.7, b.max.x - b.min.x);
    if (!deckCache.has(def.id)) deckCache.set(def.id, deckY(g, z, w * 0.3));   // ~100 ms of raycasts on 60k tris
    addWing(s, makeMats(def, look), z, deckCache.get(def.id) - 0.05, w);
    g.add(mergeStatic(s));
  }
  return g;
}

// Height of the body under the wing: median of downward ray hits across the tail, so a lone antenna,
// roll bar or roof rack can't lift the wing into the air (the old "highest vertex" did).
const deckCache = new Map();
function deckY(root, z, halfW) {
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3(), ys = [];
  for (const x of [-halfW, -halfW / 2, 0, halfW / 2, halfW]) for (const dz of [0, 0.15]) {
    rc.set(o.set(x, 20, z + dz), down);
    const hit = rc.intersectObject(root, true)[0];
    if (hit) ys.push(hit.point.y);
  }
  ys.sort((a, b) => a - b);
  return ys.length ? ys[ys.length >> 1] : new THREE.Box3().setFromObject(root).max.y;
}

function largestMaterial(root) {
  const areas = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const mats = [].concat(o.material);
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const total = idx ? idx.count : pos.count;
    const groups = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: total, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex] || mats[0];
      let area = 0;
      const end = Math.min(gr.start + gr.count, total);
      for (let i = gr.start; i + 2 < end; i += 3) {
        const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, i1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, i2).applyMatrix4(o.matrixWorld);
        area += b.sub(a).cross(c.sub(a)).length() * 0.5;
      }
      areas.set(mat, (areas.get(mat) || 0) + area);
    }
  });
  let best = null, max = -1;
  for (const [m, v] of areas) if (v > max) { max = v; best = m; }
  return best;
}

// A textured GLB is one atlas (paint, tyres, glass), so tinting .color would tint everything.
// Instead re-colour only the texels that match the car's stock paint, keeping their baked shading.
const paintCache = new Map();   // small LRU: the garage colour picker produces many colours
function repaint(mat, def, hex, root) {
  if (new THREE.Color(hex).getHex() === new THREE.Color(def.color).getHex()) return;   // stock colour: original texture
  const key = def.id + '|' + hex;
  let tex = paintCache.get(key);
  if (tex) paintCache.delete(key);
  else if (!(tex = bakePaint(mat.map, def.color, hex, root, mat))) return;
  paintCache.set(key, tex);
  if (paintCache.size > 16) { const [k, old] = paintCache.entries().next().value; paintCache.delete(k); old.dispose(); }
  mat.map = tex;
}

const rgb255 = hex => { const n = new THREE.Color(hex).getHex(); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
let H = 0, S = 0, V = 0;   // hsv() output (no per-texel allocation)
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), dd = mx - Math.min(r, g, b);
  H = !dd ? 0 : 60 * (mx === r ? ((g - b) / dd + 6) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4);
  S = mx ? dd / mx : 0; V = mx / 255;
}

function bakePaint(src, stockHex, hex, root, mat) {
  try {
    const img = src.image, c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height), d = data.data, samples = d.length / 16;
    // 1) find the paint: white/grey cars by low saturation, others by the dominant hue near the stock hue
    hsv(...rgb255(stockHex));
    const neutral = S < 0.25, stockH = H;
    let hue = 0;
    if (!neutral) {
      const bins = new Float32Array(36);
      for (let i = 0; i < d.length; i += 16) {
        hsv(d[i], d[i + 1], d[i + 2]);
        if (S > 0.35 && V > 0.15 && hueDist(H, stockH) < 45) bins[Math.min(35, (H / 10) | 0)]++;
      }
      let bi = 0;
      for (let k = 1; k < 36; k++) if (bins[k] > bins[bi]) bi = k;
      if (bins[bi] < samples * 0.02) return null;
      hue = bi * 10 + 5;
    }
    let n = 0, vSum = 0;
    for (let i = 0; i < d.length; i += 16) {
      hsv(d[i], d[i + 1], d[i + 2]);
      if (neutral ? S < 0.15 && V > 0.3 : S > 0.3 && V > 0.12 && hueDist(H, hue) < 20) { n++; vSum += V; }
    }
    if (n < samples * 0.02) return null;
    const vRef = vSum / n;
    // silver rims / grey hubs pass the neutral test too: keep the wheels out of the paint
    const wheels = neutral ? wheelMask(root, mat, d, c.width, c.height) : null;
    // 2) move those texels to the new colour, scaled by their brightness relative to the mean paint
    const [tr, tg, tb] = rgb255(hex);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      hsv(r, gg, b);
      const w = neutral
        ? (1 - sstep(0.12, 0.22, S)) * sstep(vRef * 0.45, vRef * 0.6, V) * (wheels ? 1 - wheels[i >> 2] : 1)
        : (1 - sstep(22, 38, hueDist(H, hue))) * sstep(0.18, 0.32, S) * sstep(0.05, 0.1, V);
      if (w <= 0) continue;
      const k = V / vRef;
      d[i] = r + (Math.min(255, tr * k) - r) * w;
      d[i + 1] = gg + (Math.min(255, tg * k) - gg) * w;
      d[i + 2] = b + (Math.min(255, tb * k) - b) * w;
    }
    g.putImageData(data, 0, 0);
    const t = src.clone();
    t.source = new THREE.Source(c);   // clone() shares the Source; never write into the original
    t.needsUpdate = true;
    return t;
  } catch { return null; }
}

// UV-space mask (1 byte per texel, 1 = wheel) of the texels on the wheels of a textured GLB, or null.
// Side view: the tyres are what touches the ground (front/rear axle = median of the lowest vertices); the radius is
// the circle whose hub is brightest against the darkest tyre ring.
function wheelMask(root, mat, d, tw, th) {
  if (!root) return null;
  const pos = [], tri = [], uv = [], v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    const g = o.geometry, p = g?.attributes?.position, t = g?.attributes?.uv;
    if (!o.isMesh || !p || !t || ![].concat(o.material).includes(mat)) return;
    const base = pos.length / 3, n = g.index ? g.index.count : p.count;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); uv.push(t.getX(i), t.getY(i)); }
    for (let i = 0; i < n; i++) tri.push(base + (g.index ? g.index.getX(i) : i));
  });
  const nv = pos.length / 3;
  if (!nv) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
  const A = hi[0] - lo[0] > hi[2] - lo[2] ? 0 : 2, B = 2 - A, L = hi[A] - lo[A], H = hi[1] - lo[1], halfB = (hi[B] - lo[B]) / 2 || 1;
  const ls = new Float32Array(nv), ys = new Float32Array(nv), side = new Uint8Array(nv), val = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    ls[i] = pos[i * 3 + A] - (lo[A] + hi[A]) / 2;
    ys[i] = pos[i * 3 + 1] - lo[1];
    side[i] = Math.abs(pos[i * 3 + B] - (lo[B] + hi[B]) / 2) / halfB > 0.5;
    const x = Math.min(tw - 1, Math.max(0, (uv[i * 2] * tw) | 0)), y = Math.min(th - 1, Math.max(0, (uv[i * 2 + 1] * th) | 0)), k = (y * tw + x) * 4;
    val[i] = Math.max(d[k], d[k + 1], d[k + 2]) / 255;
  }
  const discs = [];
  for (const sg of [-1, 1]) {
    const contact = [];
    for (let i = 0; i < nv; i++) if (ys[i] < 0.02 * H && Math.sign(ls[i]) === sg) contact.push(ls[i]);
    if (contact.length < 5) continue;
    contact.sort((a, b) => a - b);
    const cx = contact[contact.length >> 1], near = [];
    for (let i = 0; i < nv; i++) if (side[i] && Math.abs(ls[i] - cx) < 0.3 * L && ys[i] < 0.6 * L) near.push(i);
    let best = null;
    for (let r = 0.05 * L; r <= 0.3 * L; r += 0.004 * L) {
      let si = 0, ni = 0, sr = 0, nr = 0;
      for (const i of near) {
        const dx = ls[i] - cx, dy = ys[i] - r, dd = (dx * dx + dy * dy) / (r * r);
        if (dd < 0.3025) { si += val[i]; ni++; } else if (dd > 0.6084 && dd < 0.9409) { sr += val[i]; nr++; }   // < .55r | .78r .. .97r
      }
      if (ni < 20 || nr < 20) continue;
      const score = si / ni - sr / nr;
      if (!best || score > best.score) best = { score, r };
    }
    if (best && best.score > 0.1 && best.r < 0.29 * L) discs.push({ cx, r: best.r });
  }
  if (!discs.length) return null;
  const mask = new Uint8Array(tw * th);
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], e = tri[t + 2];
    const ml = (ls[a] + ls[b] + ls[e]) / 3, my = (ys[a] + ys[b] + ys[e]) / 3;
    if (discs.some(w => Math.hypot(ml - w.cx, my - w.r) < 0.85 * w.r)) {
      fillTri(mask, tw, th, uv[a * 2] * tw, uv[a * 2 + 1] * th, uv[b * 2] * tw, uv[b * 2 + 1] * th, uv[e * 2] * tw, uv[e * 2 + 1] * th);
    }
  }
  return mask;
}
// Sets the texels within 1.5 px of a triangle (the margin covers mip filtering at UV island edges).
// (Hot loop: plain arithmetic. A 2D-canvas path of the same triangles took ~0.7 s to build.)
const triN = new Float64Array(9);
function fillTri(m, w, h, x0, y0, x1, y1, x2, y2) {
  const sg = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) < 0 ? -1 : 1, P = [x0, y0, x1, y1, x2, y2, x0, y0], N = triN;
  for (let k = 0; k < 3; k++) {   // inward unit normal of each edge, offset 1.5 px outward
    const ax = P[k * 2], ay = P[k * 2 + 1], dx = P[k * 2 + 2] - ax, dy = P[k * 2 + 3] - ay, len = Math.hypot(dx, dy) || 1;
    N[k * 3] = -sg * dy / len; N[k * 3 + 1] = sg * dx / len; N[k * 3 + 2] = 1.5 - N[k * 3] * ax - N[k * 3 + 1] * ay;
  }
  const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2) - 2)), xb = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2) + 2));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1, y2) - 2)), yb = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2) + 2));
  for (let y = ya; y <= yb; y++) {
    const py = y + 0.5;
    for (let x = xa; x <= xb; x++) {
      const px = x + 0.5;
      if (N[0] * px + N[1] * py + N[2] > 0 && N[3] * px + N[4] * py + N[5] > 0 && N[6] * px + N[7] * py + N[8] > 0) m[y * w + x] = 1;
    }
  }
}

// ---------- procedural helpers ----------
const V2 = p => new THREE.Vector2(p[0], p[1]);

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
// Adds at +x and a mirrored copy at -x.
function pair(parent, geo, mat, x, y, z) {
  const a = add(parent, geo, mat, x, y, z);
  const b = add(parent, geo, mat, -x, y, z);
  b.scale.x = -1;
  return [a, b];
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Side profile [[z, y], ...] (or a Shape) extruded across the car's width, centered on x = 0.
function extrude(src, width, bevel = 0.06) {
  const shape = src instanceof THREE.Shape ? src : new THREE.Shape(src.map(V2));
  const b = Math.min(bevel, width * 0.3);
  const depth = Math.max(width - 2 * b, 0.001);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

// Body side outline: top line front-bottom -> rear-bottom, then a flat floor with wheel arches cut out.
function sideShape(top, clear, arches) {
  const s = new THREE.Shape();
  s.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) s.lineTo(top[i][0], top[i][1]);
  const rear = top[top.length - 1];
  if (rear[1] > clear) s.lineTo(rear[0], clear);
  for (const a of [...arches].sort((p, q) => p.z - q.z)) {
    s.lineTo(a.z - a.R, clear);
    s.absarc(a.z, a.cy, a.R, Math.PI, 0, true);
    s.lineTo(a.z + a.R, clear);
  }
  if (top[0][1] > clear) s.lineTo(top[0][0], clear);
  return s;
}

// Box stretched between two (z, y) points at a given x.
function strut(parent, mat, x, p, q, t = 0.07) {
  const dz = q[0] - p[0], dy = q[1] - p[1];
  const m = add(parent, box(t, t, Math.hypot(dz, dy)), mat, x, (p[1] + q[1]) / 2, (p[0] + q[0]) / 2);
  m.rotation.x = Math.atan2(-dy, dz);
  return m;
}

function roundLight(parent, mat, x, y, z, r, back = false) {
  const g = new THREE.CylinderGeometry(r, r, 0.08, 18).rotateX(Math.PI / 2);
  return pair(parent, g, mat, x, y, z + (back ? -0.02 : 0.02));
}

function accentFor(hex) {
  const c = new THREE.Color(hex);
  const l = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return l < 0.45 ? '#f4f4f4' : '#15171c';
}

function makeMats(def, look) {
  const std = p => new THREE.MeshStandardMaterial(p);
  const organic = ['shark', 'dragon', 'sushi'].includes(def.body);
  return {
    body: new THREE.MeshPhysicalMaterial({
      color: look.body, metalness: organic ? 0.08 : 0.45, roughness: organic ? 0.38 : 0.3,
      clearcoat: organic ? 0.6 : 1, clearcoatRoughness: 0.1,
    }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1522, metalness: 0.5, roughness: 0.06, clearcoat: 1 }),
    trim: std({ color: 0x17191e, roughness: 0.55, metalness: 0.35 }),
    black: std({ color: 0x08080a, roughness: 0.85 }),
    chrome: std({ color: 0xeeeeee, metalness: 1, roughness: 0.12 }),
    head: std({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 2.2, roughness: 0.2 }),
    tail: std({ color: 0x400000, emissive: 0xff1a2a, emissiveIntensity: 1.8, roughness: 0.3 }),
    tire: std({ color: 0x151515, roughness: 0.95 }),
    rim: std({ color: look.wheel, metalness: 0.85, roughness: 0.28 }),
    caliper: std({ color: 0xd8262e, roughness: 0.4, metalness: 0.2 }),
    accent: std({ color: accentFor(look.body), roughness: 0.4, metalness: 0.2 }),
    white: std({ color: 0xf4f4f0, roughness: 0.5 }),
    glow: std({ color: 0x9ff0ff, emissive: 0x33d6ff, emissiveIntensity: 2.5 }),
  };
}

// ---------- wheels ----------
const wheelCache = new Map();
function wheelGeos(r, w) {
  const key = r.toFixed(3) + ':' + w.toFixed(3);
  let G = wheelCache.get(key);
  if (G) return G;
  const hw = w / 2, ri = r * 0.66;
  const prof = [[ri + 0.02, -hw + 0.01], [r - 0.06, -hw], [r - 0.015, -hw + 0.025], [r, -hw + 0.07],
    [r, hw - 0.07], [r - 0.015, hw - 0.025], [r - 0.06, hw], [ri + 0.02, hw - 0.01]];
  const spokes = [];
  for (let k = 0; k < 5; k++) spokes.push(box(0.03, ri * 0.92, Math.max(0.05, ri * 0.3)).translate(0, ri * 0.5, 0).rotateX(k * Math.PI * 2 / 5));
  const capX = w * 0.1, spokeX = hw - 0.055;
  const calW = Math.max(0.01, (spokeX - 0.015 - capX) * 0.8);
  G = {
    tire: new THREE.LatheGeometry(prof.map(V2), 32).rotateZ(Math.PI / 2),
    barrel: new THREE.CylinderGeometry(ri + 0.02, ri + 0.02, w * 0.5, 24).rotateZ(Math.PI / 2).translate(-w * 0.15, 0, 0),
    spokes: mergeGeometries(spokes).translate(spokeX, 0, 0),
    lip: new THREE.TorusGeometry(ri, 0.022, 6, 32).rotateY(Math.PI / 2).translate(hw - 0.04, 0, 0),
    hub: new THREE.CylinderGeometry(ri * 0.25, ri * 0.25, 0.05, 12).rotateZ(Math.PI / 2).translate(hw - 0.045, 0, 0),
    caliper: box(calW, ri * 0.55, ri * 0.42).translate(capX + calW / 2 + 0.004, ri * 0.48, -ri * 0.42),
  };
  wheelCache.set(key, G);
  return G;
}

function addWheel(g, m, x, z, r, w, steer) {
  const G = wheelGeos(r, w);
  const pivot = new THREE.Group();
  pivot.position.set(x, r, z);
  const side = new THREE.Group();
  side.scale.x = x < 0 ? -1 : 1;
  pivot.add(side);
  const spin = new THREE.Group();
  spin.userData.r = r;
  side.add(spin);
  spin.add(new THREE.Mesh(G.tire, m.tire), new THREE.Mesh(G.barrel, m.trim), new THREE.Mesh(G.spokes, m.rim),
    new THREE.Mesh(G.lip, m.rim), new THREE.Mesh(G.hub, m.chrome));
  side.add(new THREE.Mesh(G.caliper, m.caliper));
  g.add(pivot);
  g.userData.wheels.push(spin);
  if (steer) g.userData.steer.push(pivot);
}

function wheels4(g, m, { fz, rz, r, rr = r, w, rw = w, track, rtrack = track }) {
  for (const s of [1, -1]) {
    addWheel(g, m, s * track, fz, r, w, true);
    addWheel(g, m, s * rtrack, rz, rr, rw, false);
  }
}

function addWing(s, m, z, y, width = 1.6) {
  pair(s, box(0.06, 0.34, 0.12), m.trim, width * 0.3, y + 0.15, z);
  const foil = [[0.22, 0], [0.12, 0.055], [-0.18, 0.05], [-0.24, 0.02], [0.0, -0.02]];
  add(s, extrude(foil, width, 0.015), m.trim, 0, y + 0.33, z);
  pair(s, box(0.03, 0.22, 0.5), m.body, width / 2 + 0.01, y + 0.36, z - 0.02);
}

// ---------- generic car bodies ----------
function generic(sp) {
  return (g, s, m) => {
    const arches = sp.axles.map(a => ({ z: a.z, cy: a.r, R: a.r + 0.12 }));
    add(s, extrude(sideShape(sp.top, sp.clear, arches), sp.W, 0.07), m.body);
    const c = sp.cabin, cw = sp.cabinW;
    add(s, extrude(c, cw, 0.05), m.glass);
    const [c0, c1, c2, c3] = c;
    add(s, extrude([[c1[0] + 0.03, c1[1] + 0.06], [c2[0] - 0.03, c2[1] + 0.06], [c2[0] - 0.12, c2[1] - 0.03], [c1[0] + 0.12, c1[1] - 0.03]], cw + 0.06, 0.03), m.body);
    const px = cw / 2 + 0.01;
    for (const x of [px, -px]) {
      strut(s, m.body, x, c0, c1, 0.08);
      strut(s, m.body, x, c2, c3, 0.1);
      const zb = c1[0] + (c2[0] - c1[0]) * 0.5;
      strut(s, m.body, x, [zb, c0[1]], [zb, c1[1] + 0.02], 0.08);
    }
    const front = sp.top[0][0] + 0.07, rear = sp.top[sp.top.length - 1][0] - 0.07;
    const h = sp.head, t = sp.tail;
    if (h.round) roundLight(s, m.head, h.x, h.y, front - 0.02, h.h / 2);
    else pair(s, box(h.w, h.h, 0.1), m.head, h.x, h.y, front - 0.03);
    if (t.round) roundLight(s, m.tail, t.x, t.y, rear + 0.02, t.h / 2, true);
    else pair(s, box(t.w, t.h, 0.1), m.tail, t.x, t.y, rear + 0.03);
    if (sp.grille) add(s, box(sp.grille.w, sp.grille.h, 0.1), m.black, 0, sp.grille.y, front - 0.03);
    add(s, box(sp.W - 0.12, 0.14, 0.12), m.trim, 0, sp.clear + 0.02, front - 0.04);          // front lip
    add(s, box(sp.W - 0.12, 0.14, 0.12), m.trim, 0, sp.clear + 0.02, rear + 0.04);           // rear bumper
    add(s, box(0.5, 0.12, 0.03), m.white, 0, sp.plateY ?? sp.clear + 0.25, rear - 0.005);    // plate
    add(s, new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10).rotateX(Math.PI / 2), m.chrome, sp.W * 0.28, sp.clear + 0.06, rear - 0.02);
    pair(s, box(0.16, 0.1, 0.18), m.body, cw / 2 + 0.16, c0[1] + 0.08, c0[0] - 0.12);         // mirrors
    for (const a of sp.axles) for (const k of [1, -1]) addWheel(g, m, k * a.track, a.z, a.r, a.w, a.steer);
    sp.extras?.(g, s, m, sp, front, rear);
    return { wing: sp.wing };
  };
}

const ax = (z, r, w, track, steer) => ({ z, r, w, track, steer });

const BUILDERS = {
  kei: generic({
    W: 1.54, clear: 0.26, plateY: 0.5,
    top: [[1.72, 0.3], [1.76, 0.58], [1.66, 0.8], [1.25, 0.9], [-1.66, 0.94], [-1.74, 0.66], [-1.72, 0.3]],
    cabin: [[1.2, 0.88], [0.72, 1.56], [-1.52, 1.58], [-1.65, 0.93]], cabinW: 1.38,
    axles: [ax(1.12, 0.29, 0.2, 0.66, true), ax(-1.12, 0.29, 0.2, 0.66, false)],
    head: { round: true, x: 0.5, y: 0.66, h: 0.2 }, tail: { x: 0.62, y: 0.78, w: 0.14, h: 0.3 },
    grille: { y: 0.5, w: 0.6, h: 0.1 }, wing: [-1.45, 1.63],
    extras(g, s, m) { add(s, box(1.2, 0.05, 0.9), m.trim, 0, 1.66, -0.4); }, // roof rack
  }),
  sedan: generic({
    W: 1.8, clear: 0.3, plateY: 0.55,
    top: [[2.12, 0.32], [2.16, 0.62], [2.02, 0.78], [1.0, 0.9], [0.62, 0.93], [-1.3, 0.96], [-2.0, 0.95], [-2.14, 0.82], [-2.15, 0.5], [-2.1, 0.32]],
    cabin: [[0.72, 0.92], [0.05, 1.36], [-0.95, 1.37], [-1.62, 0.95]], cabinW: 1.52,
    axles: [ax(1.33, 0.34, 0.24, 0.8, true), ax(-1.33, 0.34, 0.24, 0.8, false)],
    head: { x: 0.6, y: 0.66, w: 0.44, h: 0.13 }, tail: { x: 0.6, y: 0.8, w: 0.46, h: 0.14 },
    grille: { y: 0.52, w: 0.8, h: 0.16 }, wing: [-1.85, 0.98],
  }),
  hatch: generic({
    W: 1.74, clear: 0.3, plateY: 0.5,
    top: [[1.95, 0.3], [1.99, 0.6], [1.86, 0.78], [0.92, 0.9], [-1.75, 0.97], [-1.96, 0.9], [-1.97, 0.34]],
    cabin: [[0.78, 0.88], [0.08, 1.38], [-1.3, 1.36], [-1.86, 0.95]], cabinW: 1.46,
    axles: [ax(1.22, 0.32, 0.23, 0.77, true), ax(-1.22, 0.32, 0.23, 0.77, false)],
    head: { x: 0.58, y: 0.64, w: 0.42, h: 0.13 }, tail: { x: 0.68, y: 0.82, w: 0.2, h: 0.2 },
    grille: { y: 0.5, w: 0.9, h: 0.14 }, wing: [-1.45, 1.42],
    extras(g, s, m) {
      const sp = add(s, box(1.36, 0.05, 0.34), m.body, 0, 1.43, -1.36); sp.rotation.x = 0.12;         // roof spoiler
      pair(s, new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10).rotateX(Math.PI / 2), m.chrome, 0.4, 0.36, -2.04);
    },
  }),
  van: generic({
    W: 1.84, clear: 0.32, plateY: 0.56,
    top: [[2.18, 0.34], [2.22, 0.74], [2.08, 0.98], [1.6, 1.02], [-2.18, 1.02], [-2.2, 0.34]],
    cabin: [[1.95, 1.0], [1.25, 1.9], [0.55, 1.92], [0.55, 1.0]], cabinW: 1.72,
    axles: [ax(1.42, 0.36, 0.25, 0.8, true), ax(-1.45, 0.36, 0.25, 0.8, false)],
    head: { x: 0.64, y: 0.78, w: 0.4, h: 0.16 }, tail: { x: 0.8, y: 0.8, w: 0.12, h: 0.42 },
    grille: { y: 0.6, w: 0.9, h: 0.22 }, wing: [-1.9, 2.0],
    extras(g, s, m) {
      add(s, extrude([[0.62, 0.98], [0.62, 1.97], [-2.1, 1.97], [-2.2, 1.9], [-2.2, 0.98]], 1.8, 0.06), m.body);
      pair(s, box(0.02, 0.18, 2.6), m.accent, 0.915, 0.82, -0.8);                    // side stripe
      pair(s, box(0.02, 0.9, 0.03), m.trim, 0.915, 1.25, -0.2);                      // sliding door gap
      add(s, box(0.02, 0.95, 0.02), m.trim, 0, 1.3, -2.265);                        // rear door split
      add(s, box(1.5, 0.06, 1.8), m.trim, 0, 2.06, -0.8);                           // roof rack
    },
  }),
  sports: generic({
    W: 1.96, clear: 0.24, plateY: 0.46,
    top: [[2.2, 0.28], [2.24, 0.48], [2.05, 0.64], [1.0, 0.8], [0.45, 0.84], [-1.2, 0.9], [-2.02, 0.94], [-2.2, 0.82], [-2.2, 0.3]],
    cabin: [[0.5, 0.82], [-0.2, 1.18], [-0.8, 1.18], [-1.95, 0.92]], cabinW: 1.42,
    axles: [ax(1.4, 0.35, 0.28, 0.84, true), ax(-1.35, 0.35, 0.3, 0.84, false)],
    head: { x: 0.66, y: 0.56, w: 0.44, h: 0.08 }, tail: { x: 0.52, y: 0.84, w: 0.62, h: 0.07 },
    grille: { y: 0.4, w: 1.2, h: 0.14 }, wing: [-1.9, 0.96],
    extras(g, s, m) {
      pair(s, box(0.04, 0.2, 0.5), m.black, 0.99, 0.56, -0.5);                       // side intakes
      add(s, box(1.5, 0.1, 0.3), m.black, 0, 0.3, -2.12);                            // diffuser
      for (const x of [0.36, 0.5, -0.36, -0.5]) add(s, new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10).rotateX(Math.PI / 2), m.chrome, x, 0.34, -2.24);
      add(s, box(1.9, 0.03, 0.2), m.black, 0, 0.2, 2.2);                             // splitter
    },
  }),
  suv: generic({
    W: 1.96, clear: 0.44, plateY: 0.72,
    top: [[2.24, 0.46], [2.26, 0.86], [2.1, 1.08], [1.25, 1.18], [-2.18, 1.24], [-2.26, 1.0], [-2.25, 0.46]],
    cabin: [[1.12, 1.16], [0.45, 1.78], [-2.0, 1.78], [-2.16, 1.22]], cabinW: 1.74,
    axles: [ax(1.45, 0.42, 0.3, 0.84, true), ax(-1.45, 0.42, 0.3, 0.84, false)],
    head: { x: 0.68, y: 0.94, w: 0.4, h: 0.16 }, tail: { x: 0.8, y: 1.02, w: 0.18, h: 0.34 },
    grille: { y: 0.78, w: 0.9, h: 0.26 }, wing: [-1.9, 1.84],
    extras(g, s, m) {
      pair(s, box(0.05, 0.05, 2.2), m.chrome, 0.7, 1.9, -0.8);                       // roof rails
      add(s, box(1.5, 0.08, 0.5), m.trim, 0, 0.44, 2.1);                             // skid plate
      const G = wheelGeos(0.36, 0.24);
      const spare = new THREE.Group(); spare.position.set(0, 0.95, -2.42); spare.rotation.y = Math.PI / 2;
      spare.add(new THREE.Mesh(G.tire, m.tire), new THREE.Mesh(G.spokes, m.rim), new THREE.Mesh(G.lip, m.rim), new THREE.Mesh(G.barrel, m.trim));
      s.add(spare);
      for (const y of [0.62, 0.9]) add(s, new THREE.CylinderGeometry(0.035, 0.035, 1.3, 10).rotateZ(Math.PI / 2), m.chrome, 0, y, 2.42); // bull bar
      pair(s, new THREE.CylinderGeometry(0.035, 0.035, 0.34, 10), m.chrome, 0.55, 0.76, 2.42);
    },
  }),
  muscle: generic({
    W: 1.96, clear: 0.32, plateY: 0.55,
    top: [[2.28, 0.34], [2.3, 0.72], [2.2, 0.86], [0.62, 0.94], [-1.55, 0.97], [-2.22, 1.0], [-2.3, 0.82], [-2.28, 0.34]],
    cabin: [[0.38, 0.93], [-0.3, 1.3], [-1.05, 1.3], [-1.72, 0.96]], cabinW: 1.5,
    axles: [ax(1.5, 0.37, 0.28, 0.84, true), ax(-1.4, 0.4, 0.36, 0.82, false)],
    head: { round: true, x: 0.6, y: 0.66, h: 0.2 }, tail: { x: 0.55, y: 0.8, w: 0.6, h: 0.12 },
    grille: { y: 0.62, w: 1.5, h: 0.16 }, wing: [-1.95, 1.02],
    extras(g, s, m) {
      add(s, extrude([[1.7, 0.86], [1.5, 1.06], [0.9, 1.08], [0.8, 0.9]], 0.6, 0.04), m.body);
      add(s, box(0.46, 0.12, 0.04), m.black, 0, 1.0, 1.58);
      for (const x of [0.2, -0.2]) {
        const hood = add(s, box(0.18, 0.02, 1.62), m.accent, x, 0.95, 1.42); hood.rotation.x = 0.05;
        add(s, box(0.18, 0.02, 0.8), m.accent, x, 1.405, -0.68);
        add(s, box(0.18, 0.02, 0.6), m.accent, x, 1.08, -1.95);
      }
      add(s, box(1.9, 0.08, 0.1), m.chrome, 0, 0.38, 2.38);
      add(s, box(1.9, 0.08, 0.1), m.chrome, 0, 0.38, -2.38);
      pair(s, new THREE.CylinderGeometry(0.06, 0.06, 1.2, 10).rotateX(Math.PI / 2), m.chrome, 0.98, 0.28, -0.1); // side pipes
      pair(s, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 16).rotateX(Math.PI / 2), m.head, 0.38, 0.66, 2.36);  // quad lights
    },
  }),
  rally: generic({
    W: 1.84, clear: 0.38, plateY: 0.6,
    top: [[2.02, 0.38], [2.06, 0.68], [1.9, 0.86], [0.95, 0.97], [-1.86, 1.02], [-2.04, 0.94], [-2.04, 0.38]],
    cabin: [[0.8, 0.95], [0.1, 1.44], [-1.3, 1.43], [-1.9, 1.0]], cabinW: 1.5,
    axles: [ax(1.28, 0.35, 0.26, 0.8, true), ax(-1.28, 0.35, 0.26, 0.8, false)],
    head: { x: 0.62, y: 0.72, w: 0.36, h: 0.14 }, tail: { x: 0.66, y: 0.86, w: 0.3, h: 0.16 },
    grille: { y: 0.58, w: 0.8, h: 0.14 }, wing: null,
    extras(g, s, m) {
      addWing(s, m, -1.85, 1.04, 1.7);
      add(s, extrude([[0.0, 1.46], [-0.1, 1.62], [-0.6, 1.62], [-0.6, 1.46]], 0.4, 0.03), m.body);       // roof scoop
      add(s, box(0.3, 0.1, 0.04), m.black, 0, 1.54, 0.0);
      add(s, box(1.2, 0.05, 0.06), m.trim, 0, 0.95, 2.1);                                                 // light bar
      for (const x of [-0.45, -0.15, 0.15, 0.45]) {
        add(s, new THREE.CylinderGeometry(0.11, 0.11, 0.1, 16).rotateX(Math.PI / 2), m.black, x, 1.06, 2.1);
        add(s, new THREE.CylinderGeometry(0.085, 0.085, 0.04, 16).rotateX(Math.PI / 2), m.head, x, 1.06, 2.16);
      }
      for (const z of [0.75, -1.75]) pair(s, box(0.34, 0.3, 0.03), m.black, 0.8, 0.26, z);               // mud flaps
      const stripe = pair(s, box(0.02, 0.22, 3.2), m.accent, 0.935, 0.7, 0);
      stripe.forEach(o => { o.rotation.x = 0.08; });
      pair(s, new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24).rotateZ(Math.PI / 2), m.white, 0.935, 0.72, 0.15); // number roundel
    },
  }),
  wedge: generic({
    W: 2.02, clear: 0.24, plateY: 0.48,
    top: [[2.24, 0.28], [2.26, 0.42], [0.9, 0.78], [-1.8, 0.92], [-2.2, 0.9], [-2.22, 0.3]],
    cabin: [[0.95, 0.76], [-0.15, 1.1], [-1.05, 1.08], [-1.7, 0.91]], cabinW: 1.3,
    axles: [ax(1.42, 0.35, 0.3, 0.86, true), ax(-1.38, 0.35, 0.34, 0.86, false)],
    head: { x: 0.7, y: 0.36, w: 0.3, h: 0.06 }, tail: { x: 0.52, y: 0.74, w: 0.7, h: 0.1 },
    grille: null, wing: [-1.95, 0.94],
    extras(g, s, m) {
      for (const k of [1, -1]) {
        const pop = add(s, box(0.42, 0.14, 0.34), m.body, k * 0.6, 0.76, 1.45); pop.rotation.x = -0.25;
        const lamp = add(s, box(0.36, 0.08, 0.02), m.head, k * 0.6, 0.77, 1.63); lamp.rotation.x = -0.25;
      }
      pair(s, box(0.04, 0.16, 0.6), m.black, 1.02, 0.66, -0.55);                                         // NACA vents
      for (let i = 0; i < 6; i++) add(s, box(1.2, 0.03, 0.08), m.black, 0, 0.99, -1.25 - i * 0.12);       // louvers
      pair(s, box(0.02, 0.05, 3.6), m.accent, 1.02, 0.46, 0);
      add(s, box(1.4, 0.14, 0.04), m.black, 0, 0.5, -2.3);
    },
  }),
  tank: generic({
    W: 2.1, clear: 0.4, plateY: 0.7,
    top: [[2.3, 0.46], [2.34, 0.72], [1.7, 1.08], [-1.8, 1.14], [-2.3, 0.9], [-2.3, 0.46]],
    cabin: [[1.62, 1.06], [1.32, 1.3], [0.4, 1.32], [0.4, 1.1]], cabinW: 1.5,
    axles: [ax(1.55, 0.42, 0.32, 0.9, true), ax(0, 0.42, 0.32, 0.9, false), ax(-1.55, 0.42, 0.32, 0.9, false)],
    head: { x: 0.7, y: 0.66, w: 0.3, h: 0.14 }, tail: { x: 0.85, y: 0.8, w: 0.2, h: 0.18 },
    grille: { y: 0.56, w: 1.0, h: 0.12 }, wing: [-1.95, 1.14],
    extras(g, s, m) {
      const dome = add(s, new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.body, 0, 1.14, -0.6);
      dome.scale.set(1, 0.7, 1.1);
      add(s, new THREE.CylinderGeometry(0.66, 0.7, 0.1, 24), m.trim, 0, 1.17, -0.6);
      add(s, new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), m.trim, 0.25, 1.75, -0.8);                // antenna
      add(s, new THREE.SphereGeometry(0.09, 16, 10), m.glow, 0.25, 2.12, -0.8);
      add(s, new THREE.TorusGeometry(0.3, 0.035, 8, 24).rotateX(Math.PI / 2), m.glow, 0, 1.6, -0.6);    // shield ring
      for (const z of [1.0, -0.2, -1.4]) pair(s, box(0.06, 0.4, 1.0), m.trim, 1.08, 0.95, z).forEach((o, i) => { o.rotation.z = i ? -0.25 : 0.25; }); // armor
      const ram = add(s, box(2.0, 0.26, 0.2), m.trim, 0, 0.56, 2.42); ram.rotation.x = 0.35;
      for (let i = -3; i <= 3; i++) add(s, box(0.04, 0.3, 0.04), m.chrome, i * 0.12, 0.66, 2.37);        // grille bars
      add(s, new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), m.trim, -0.7, 1.35, -1.9);                 // exhaust stack
    },
  }),

  formula(g, s, m) {
    const mono = extrude([[2.3, 0.16], [2.34, 0.3], [1.9, 0.36], [1.2, 0.52], [0.55, 0.66], [0.3, 0.72], [-0.25, 0.74],
      [-1.0, 0.72], [-1.9, 0.6], [-2.1, 0.45], [-2.1, 0.2], [-0.8, 0.12], [1.0, 0.12]], 0.72, 0.06);
    const p = mono.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      p.setX(i, p.getX(i) * (z > 0.5 ? 1 - 0.55 * Math.min(1, (z - 0.5) / 1.8) : 1));
    }
    mono.computeVertexNormals();
    add(s, mono, m.body);
    const pod = extrude([[0.35, 0.16], [0.35, 0.58], [0.1, 0.64], [-1.2, 0.54], [-1.75, 0.3], [-1.75, 0.16]], 0.5, 0.06);
    pair(s, pod, m.body, 0.58, 0, 0);
    pair(s, box(0.4, 0.3, 0.04), m.black, 0.58, 0.4, 0.4);
    add(s, extrude([[-0.3, 0.7], [-0.3, 1.12], [-0.55, 1.15], [-1.5, 0.8], [-1.5, 0.7]], 0.34, 0.04), m.body);  // airbox
    add(s, box(0.26, 0.16, 0.04), m.black, 0, 1.02, -0.27);
    add(s, box(0.48, 0.05, 0.9), m.black, 0, 0.75, 0.05);                                                      // cockpit
    add(s, new THREE.SphereGeometry(0.17, 18, 12), m.white, 0, 0.9, -0.05);                                   // helmet
    add(s, box(0.26, 0.07, 0.08), m.glass, 0, 0.93, 0.1);
    add(s, new THREE.TorusGeometry(0.34, 0.035, 8, 20, Math.PI).rotateX(Math.PI / 2), m.trim, 0, 0.98, -0.1); // halo
    strut(s, m.trim, 0, [0.3, 0.74], [0.24, 0.98], 0.05);
    add(s, box(1.9, 0.04, 0.42), m.accent, 0, 0.14, 2.22);                                                     // front wing
    const flap = add(s, box(1.8, 0.03, 0.2), m.body, 0, 0.22, 2.02); flap.rotation.x = 0.35;
    pair(s, box(0.03, 0.24, 0.55), m.body, 0.95, 0.2, 2.16);
    add(s, box(1.2, 0.05, 0.38), m.accent, 0, 1.02, -2.05);                                                    // rear wing
    const rflap = add(s, box(1.2, 0.04, 0.2), m.body, 0, 1.12, -2.2); rflap.rotation.x = -0.35;
    pair(s, box(0.04, 0.5, 0.62), m.body, 0.61, 0.92, -2.08);
    add(s, box(0.06, 0.5, 0.1), m.trim, 0, 0.78, -2.0);
    add(s, box(0.14, 0.1, 0.04), m.tail, 0, 0.36, -2.18);                                                      // rain light
    for (const [z, x] of [[1.55, 0.82], [-1.45, 0.78]]) for (const y of [0.28, 0.44]) {
      pair(s, new THREE.CylinderGeometry(0.018, 0.018, x - 0.3, 6).rotateZ(Math.PI / 2), m.trim, (x + 0.3) / 2, y, z);
    }
    wheels4(g, m, { fz: 1.55, rz: -1.45, r: 0.33, rr: 0.36, w: 0.3, rw: 0.4, track: 0.82, rtrack: 0.8 });
    return { wing: null };
  },

  shark(g, s, m) {
    const prof = [[0, 2.15], [0.18, 2.1], [0.38, 1.95], [0.58, 1.7], [0.78, 1.3], [0.9, 0.7], [0.92, 0], [0.82, -0.7], [0.6, -1.3], [0.36, -1.8], [0.2, -2.1], [0.001, -2.2]];
    // lathe profile must go bottom->top on its axis for outward faces: reverse to increasing y
    const hull = new THREE.LatheGeometry(prof.slice().reverse().map(p => new THREE.Vector2(p[0], p[1])), 28).rotateX(Math.PI / 2);
    hull.scale(1.04, 0.68, 1);
    add(s, hull, m.body, 0, 0.92, 0);
    const belly = add(s, new THREE.SphereGeometry(1, 28, 16), m.white, 0, 0.68, -0.05);
    belly.scale.set(0.82, 0.42, 1.95);
    const mouth = add(s, new THREE.SphereGeometry(1, 20, 10), new THREE.MeshStandardMaterial({ color: 0x3a0610, roughness: 0.6 }), 0, 0.74, 1.84);
    mouth.scale.set(0.36, 0.08, 0.28);
    const tooth = new THREE.ConeGeometry(0.03, 0.1, 6);
    for (let i = 0; i <= 8; i++) {
      const f = -1.25 + i * 2.5 / 8, x = 0.37 * Math.sin(f), z = 1.84 + 0.29 * Math.cos(f);
      add(s, tooth, m.white, x, 0.785, z).rotation.x = Math.PI;
      add(s, tooth, m.white, x * 0.95, 0.695, z - 0.01);
    }
    pair(s, new THREE.SphereGeometry(0.075, 14, 10), m.black, 0.63, 1.0, 1.55);
    pair(s, new THREE.SphereGeometry(0.025, 8, 6), m.white, 0.69, 1.03, 1.58);
    for (const z of [0.75, 0.6, 0.45]) pair(s, box(0.02, 0.32, 0.04), m.black, 0.935, 0.95, z);              // gills
    const fin = new THREE.Shape();
    fin.moveTo(0.35, 0); fin.quadraticCurveTo(0.0, 0.35, -0.6, 0.85); fin.quadraticCurveTo(-0.45, 0.35, -0.55, 0); fin.lineTo(0.35, 0);
    add(s, extrude(fin, 0.12, 0.03), m.body, 0, 1.45, -0.05);
    const pect = new THREE.Shape();
    pect.moveTo(0, 0.35); pect.lineTo(0.62, -0.5); pect.quadraticCurveTo(0.35, -0.3, 0, -0.25); pect.lineTo(0, 0.35);
    const pg = new THREE.ExtrudeGeometry(pect, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }).rotateX(Math.PI / 2);
    pair(s, pg, m.body, 0.78, 0.55, 0.5).forEach((o, i) => { o.rotation.z = i ? 0.35 : -0.35; });
    add(s, new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.glass, 0, 1.4, 0.75).scale.set(0.9, 0.7, 1.4);
    pair(s, new THREE.SphereGeometry(0.06, 10, 8), m.head, 0.28, 0.86, 1.98);
    pair(s, new THREE.SphereGeometry(0.05, 10, 8), m.tail, 0.2, 0.95, -1.9);
    const tail = new THREE.Group();
    tail.position.set(0, 0.92, -1.85);
    const tf = new THREE.Shape();
    tf.moveTo(0.1, 0.13); tf.lineTo(-0.9, 0.88); tf.quadraticCurveTo(-0.6, 0.25, -0.5, 0.03);
    tf.quadraticCurveTo(-0.6, -0.2, -0.7, -0.55); tf.lineTo(0.1, -0.12); tf.lineTo(0.1, 0.13);
    add(tail, extrude(tf, 0.1, 0.03), m.body);
    g.add(tail);
    wheels4(g, m, { fz: 1.25, rz: -1.25, r: 0.36, w: 0.26, track: 0.88 });
    g.userData.anim = (t, speed) => { tail.rotation.y = Math.sin(t * (4 + Math.min(Math.abs(speed), 60) * 0.12)) * 0.28; };
    return { wing: [-1.3, 1.3], wingW: 1.4 };
  },

  dragon(g, s, m, def) {
    const volt = def.id === 'ur_thunder';   // electric-blue horns, wings and flank bolts
    const hull = generic({
      W: 1.9, clear: 0.32, plateY: 0.55,
      top: [[2.0, 0.36], [2.05, 0.66], [1.8, 0.86], [0.9, 0.98], [-1.6, 1.0], [-2.05, 0.86], [-2.08, 0.36]],
      cabin: [[0.6, 0.96], [0.05, 1.3], [-0.75, 1.3], [-1.3, 0.98]], cabinW: 1.3,
      axles: [ax(1.3, 0.36, 0.28, 0.82, true), ax(-1.3, 0.36, 0.3, 0.82, false)],
      head: { x: 0.62, y: 0.6, w: 0.3, h: 0.1 }, tail: { x: 0.6, y: 0.82, w: 0.3, h: 0.12 },
      grille: null, wing: [-1.75, 1.02],
    });
    const res = hull(g, s, m);
    const bone = volt ? new THREE.MeshStandardMaterial({ color: 0x3aa8ff, emissive: 0x0a6cff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.4 })
      : new THREE.MeshStandardMaterial({ color: 0xf0cf7a, roughness: 0.45, metalness: 0.3 });
    const eye = volt ? m.glow : new THREE.MeshStandardMaterial({ color: 0xffee55, emissive: 0xffc400, emissiveIntensity: 2.5 });
    const memb = volt ? new THREE.MeshStandardMaterial({ color: 0x1d4fd8, emissive: 0x0b3cff, emissiveIntensity: 0.5, roughness: 0.5, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(m.body.color).multiplyScalar(0.55), roughness: 0.6, side: THREE.DoubleSide });
    // feather-icon zap (svg x,y) laid along each flank: nose-high, tail-low
    if (volt) pair(s, extrude([[13, 2], [3, 14], [12, 14], [11, 22], [21, 10], [12, 10]].map(([x, y]) => [0.75 - (y - 2) * 0.075, 0.5 + (21 - x) * 0.02]), 0.02, 0), m.glow, 0.96, 0, 0);
    add(s, extrude([[2.38, 0.62], [2.42, 0.8], [2.1, 0.95], [1.6, 1.12], [1.2, 1.2], [0.9, 1.1], [0.9, 0.84], [1.5, 0.78], [2.0, 0.6]], 0.8, 0.06), m.body);
    pair(s, new THREE.SphereGeometry(0.085, 14, 10), eye, 0.37, 1.04, 1.55);
    pair(s, new THREE.SphereGeometry(0.04, 8, 6), m.black, 0.14, 0.74, 2.45);
    const brow = pair(s, box(0.12, 0.05, 0.35), m.body, 0.34, 1.13, 1.52); brow.forEach((o, i) => { o.rotation.z = i ? 0.35 : -0.35; });
    const fang = new THREE.ConeGeometry(0.03, 0.12, 6);
    for (const z of [2.3, 2.15, 2.0]) pair(s, fang, m.white, 0.3, 0.56, z).forEach(o => { o.rotation.x = Math.PI; });
    const horn = new THREE.ConeGeometry(0.075, 0.62, 10).translate(0, 0.31, 0);
    pair(s, horn, bone, 0.26, 1.12, 1.15).forEach((o, i) => { o.rotation.set(-1.05, 0, i ? 0.3 : -0.3); });
    const spike = new THREE.ConeGeometry(0.07, 0.24, 6);
    for (const [z, y] of [[0.3, 1.36], [-0.2, 1.36], [-0.7, 1.36], [-1.45, 1.05], [-1.85, 1.0]]) add(s, spike, bone, 0, y, z).rotation.x = -0.4;
    // wings: membrane in (a = along car, b = span) mapped to world (z, x), thickness in y
    const ws = new THREE.Shape();
    ws.moveTo(0.4, 0); ws.lineTo(0.5, 0.8); ws.lineTo(-0.05, 1.5);
    ws.quadraticCurveTo(-0.2, 1.05, -0.45, 1.0); ws.quadraticCurveTo(-0.55, 0.6, -0.85, 0.5);
    ws.quadraticCurveTo(-0.9, 0.2, -1.05, 0); ws.lineTo(0.4, 0);
    const wg = new THREE.ExtrudeGeometry(ws, { depth: 0.035, bevelEnabled: false });
    wg.applyMatrix4(new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1)).scale(0.8, 1, 1);
    const armG = new THREE.CylinderGeometry(0.035, 0.05, 0.95, 8).rotateZ(-Math.PI / 2).translate(0.47, 0.02, 0.45).applyMatrix4(new THREE.Matrix4().makeRotationY(-0.12)).scale(0.8, 1, 1);
    const wings = [];
    for (const k of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(k * 0.82, 1.0, -0.2);
      w.scale.x = k;
      w.add(new THREE.Mesh(wg, memb), new THREE.Mesh(armG, bone));
      g.add(w);
      wings.push(w);
    }
    const tail = new THREE.Group();
    tail.position.set(0, 0.82, -1.95);
    const path = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0.1), new THREE.Vector3(0, 0.05, -0.5), new THREE.Vector3(0.12, 0.3, -1.0), new THREE.Vector3(0.05, 0.62, -1.3)]);
    const tube = new THREE.TubeGeometry(path, 20, 0.2, 8, false);
    const tp = tube.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= 20; i++) {
      path.getPointAt(i / 20, c);
      for (let j = 0; j <= 8; j++) {
        const k = i * 9 + j;
        v.fromBufferAttribute(tp, k).sub(c).multiplyScalar(1 - 0.8 * i / 20).add(c);
        tp.setXYZ(k, v.x, v.y, v.z);
      }
    }
    tube.computeVertexNormals();
    tail.add(new THREE.Mesh(tube, m.body));
    const spade = add(tail, extrude([[0.1, 0], [-0.2, 0.2], [-0.5, 0], [-0.2, -0.2]], 0.05, 0.02), bone, 0.05, 0.62, -1.3);
    spade.rotation.x = -0.9;
    g.add(tail);
    g.userData.anim = (t, speed) => {
      const f = Math.min(Math.abs(speed), 70) / 70;
      const a = 0.55 + Math.sin(t * (2.5 + f * 6)) * (0.12 + f * 0.18);
      wings[0].rotation.z = a; wings[1].rotation.z = -a;
      tail.rotation.y = Math.sin(t * 3.1) * 0.22;
    };
    g.userData.anim(0, 0);
    return res;
  },

  sushi(g, s, m) {
    const rice = new THREE.MeshStandardMaterial({ color: 0xf7f4ea, roughness: 0.85 });
    const nori = new THREE.MeshPhysicalMaterial({ color: 0x14241a, roughness: 0.5, sheen: 0.6, sheenColor: 0x335533 });
    add(s, new RoundedBoxGeometry(1.9, 0.85, 4.0, 4, 0.3), rice, 0, 0.725, 0);
    const grains = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), rice, 170);
    const d = new THREE.Object3D();
    let n = 0, seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (n < 170) {
      const face = rnd();
      if (face < 0.8) d.position.set(rnd() < 0.5 ? 0.955 : -0.955, 0.42 + rnd() * 0.6, -1.7 + rnd() * 3.4);
      else d.position.set(-0.65 + rnd() * 1.3, 0.42 + rnd() * 0.6, rnd() < 0.5 ? 2.005 : -2.005);
      if (Math.abs(d.position.z) < 0.36) continue;
      d.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      d.scale.set(0.05, 0.045, 0.1);
      d.updateMatrix();
      grains.setMatrixAt(n++, d.matrix);
    }
    s.add(grains);
    // salmon slab draped over the rice
    const topY = z => 1.43 - 0.28 * (z / 2.15) ** 2;
    const slab = [];
    for (let i = 0; i <= 24; i++) { const z = 2.15 - i * 4.3 / 24; slab.push([z, topY(z)]); }
    for (let i = 24; i >= 0; i--) { const z = 2.15 - i * 4.3 / 24; slab.push([z, topY(z) - 0.26]); }
    add(s, extrude(slab, 2.0, 0.06), m.body);
    const fat = new THREE.MeshStandardMaterial({ color: 0xfff0e6, roughness: 0.35 });
    for (const z0 of [-1.7, -1.2, -0.7, 0.55, 1.05, 1.55]) {
      const strip = [];
      for (let i = 0; i <= 3; i++) { const z = z0 + i * 0.03; strip.push([z - z0, topY(z) + 0.075]); }
      for (let i = 3; i >= 0; i--) { const z = z0 + i * 0.03; strip.push([z - z0, topY(z) + 0.04]); }
      add(s, extrude(strip, 1.84, 0.01), fat, 0, 0, z0).rotation.y = 0.2;
    }
    // nori band around rice + fish
    const rr = (w, y0, y1, r) => {
      const p = new THREE.Shape(), x0 = -w / 2, x1 = w / 2;
      p.moveTo(x0 + r, y0); p.lineTo(x1 - r, y0); p.quadraticCurveTo(x1, y0, x1, y0 + r); p.lineTo(x1, y1 - r);
      p.quadraticCurveTo(x1, y1, x1 - r, y1); p.lineTo(x0 + r, y1); p.quadraticCurveTo(x0, y1, x0, y1 - r);
      p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0);
      return p;
    };
    const band = rr(2.14, 0.25, 1.53, 0.26);
    band.holes.push(rr(2.04, 0.29, 1.49, 0.22));
    add(s, new THREE.ExtrudeGeometry(band, { depth: 0.62, bevelEnabled: false, curveSegments: 8 }).translate(0, 0, -0.31), nori);
    add(s, new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: 0x86b83a, roughness: 0.8 }), 0.45, 1.37, 1.25).scale.set(1, 0.55, 1.2);
    add(s, new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.glass, 0, 1.36, 0.95).scale.set(0.95, 0.62, 0.95);
    // toothpick flag
    add(s, new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xd9b27c, roughness: 0.7 }), -0.45, 1.72, -1.5);
    add(s, box(0.02, 0.28, 0.42), m.white, -0.45, 2.0, -1.72);
    add(s, new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16).rotateZ(Math.PI / 2), m.caliper, -0.45, 2.0, -1.72);
    roundLight(s, m.head, 0.55, 0.72, 2.01, 0.24);
    roundLight(s, m.tail, 0.6, 0.78, -2.01, 0.2, true);
    wheels4(g, m, { fz: 1.35, rz: -1.35, r: 0.34, w: 0.26, track: 1.0 });
    return { wing: [-1.6, 1.3], wingW: 1.7 };
  },
};

// accents for cars that share a body style with another car
const ACCENTS = {
  sr_magnet(s, m) {   // horseshoe magnet standing on the roof: red / blue poles
    const red = new THREE.MeshStandardMaterial({ color: 0xe0282e, emissive: 0x800008, roughness: 0.35, metalness: 0.3 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2a5bff, emissive: 0x001a90, roughness: 0.35, metalness: 0.3 });
    const arc = new THREE.TorusGeometry(0.3, 0.09, 8, 12, Math.PI / 2);
    add(s, arc, red, 0, 1.32, -1.35);
    add(s, arc, blue, 0, 1.32, -1.35).rotation.z = Math.PI / 2;
    add(s, box(0.18, 0.26, 0.18), red, 0.3, 1.19, -1.35);
    add(s, box(0.18, 0.26, 0.18), blue, -0.3, 1.19, -1.35);
    pair(s, box(0.19, 0.08, 0.19), m.chrome, 0.3, 1.04, -1.35);
    add(s, box(0.02, 0.05, 3.6), red, 1.025, 0.52, 0);
    add(s, box(0.02, 0.05, 3.6), blue, -1.025, 0.52, 0);
  },
  ur_domain(s, m) {   // violet glow parts, a floating halo over the dome and rune strips on the flanks
    m.glow.color.set(0xd9a6ff); m.glow.emissive.set(0x8a2cff);
    add(s, new THREE.TorusGeometry(0.85, 0.03, 8, 40).rotateX(Math.PI / 2), m.glow, 0, 1.95, -0.6);
    pair(s, box(0.02, 0.06, 2.8), m.glow, 1.06, 0.62, 0);
  },
};

function procedural(def, look) {
  const m = makeMats(def, look);
  const g = new THREE.Group();
  g.userData.wheels = [];
  g.userData.steer = [];
  const s = new THREE.Group();
  const info = (BUILDERS[def.body] || BUILDERS.sedan)(g, s, m, def) || {};
  ACCENTS[def.id]?.(s, m);
  if (look.wing && info.wing) addWing(s, m, info.wing[0], info.wing[1], info.wingW || 1.6);
  g.add(mergeStatic(s));
  return g;
}

// Merge all static meshes by material (a car becomes ~15 draw calls instead of ~80).
function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const out = new THREE.Group(), byMat = new Map();
  for (const o of meshes) {
    if (o.isInstancedMesh) {
      o.matrixWorld.decompose(o.position, o.quaternion, o.scale);
      out.add(o);
      continue;
    }
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.morphAttributes = {};
    geo.clearGroups();
    geo.applyMatrix4(o.matrixWorld);
    if (o.matrixWorld.determinant() < 0) flipWinding(geo);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(geo);
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  return out;
}

function flipWinding(geo) {
  for (const attr of Object.values(geo.attributes)) {
    const a = attr.array, n = attr.itemSize;
    for (let i = 0; i + 2 < attr.count; i += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (i + 1) * n + k, i2 = (i + 2) * n + k, t = a[i1];
        a[i1] = a[i2]; a[i2] = t;
      }
    }
  }
}
