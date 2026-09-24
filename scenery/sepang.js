// Sepang (Malaysia): humid, hazy tropical day. The main grandstand between the two parallel straights under a row of
// big leaf-shaped canopies, the tall race-control tower behind the pits, oil-palm plantations in rows all around with
// red-earth estate roads and cleared patches, rain trees and flowering hibiscus around the paddock, towering cumulus
// on the horizon and an airliner on approach to the nearby airport.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit } = await import(`./bahrain.js${new URL(import.meta.url).search}`);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// neutral grass detail; hue comes from the terrain vertex colours (grass / red earth)
function paintGround(g, w, h) {
  g.fillStyle = '#b3b5a4'; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 34; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) {
    const k = Math.random();
    g.fillStyle = k < 0.5 ? 'rgba(90,96,70,0.5)' : 'rgba(215,220,195,0.45)';
    g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3);
  }
}

const env = {
  sky: { top: '#6d9fd4', horizon: '#e2e8e4', bottom: '#90a88a' },
  fog: { color: '#dce3de', near: 200, far: 1450 },
  sun: { dir: [0.35, 0.78, 0.3], color: '#fff5e4', intensity: 2.3 },   // high tropical sun through the haze
  hemi: { sky: '#e4eef5', ground: '#55703a', intensity: 1.0 },
  exposure: 1.02,
  envIntensity: 0.45,
  night: false,
  terrain: { base: '#b3b5a4', paint: paintGround, hills: 7, rim: 45, rimColor: '#2f5a2a', height: (x, z, y) => y },   // replaces the beach's sea hook
  road: { base: '#4a4c52', line: '#f4f4ee', edge: '#f4f4ee' },
  shoulder: '#8a8d7a',
  barrier: 'guardrail',
  curb: ['#d62828', '#f4f4f4'],
};

function build(api) {
  const K = kit(api), { N, W2, side, faceYaw, outside, tallOk, probe, part, bake, inst, mesh, vc, S } = K;
  const { world, rnd, track } = api, ground = api.groundAt, sp = track.spacing;
  const R = (a, b) => a + (b - a) * rnd();
  const at = m => Math.round(m / sp);
  const { minX, maxX, minZ, maxZ, cx, cz } = K.bounds;
  const roadGrid = (x, z) => Math.min(Math.abs(((x + 2000) % 190) - 95), Math.abs(((z + 2000) % 170) - 85));   // estate roads: 190 x 170 m blocks
  const earth = (x, z) => Math.sin(x * 0.0071 + 2.1 * Math.sin(z * 0.0053)) * Math.cos(z * 0.0083 - x * 0.0021);   // > 0.55: cleared red earth

  // ---- ground: lush grass near the road, darker plantation floor, red-earth roads + clearings, jungle on the far hills
  const GRASS = new THREE.Color(0.36, 0.66, 0.26), FLOOR = new THREE.Color(0.3, 0.48, 0.2), EARTH = new THREE.Color(0.98, 0.45, 0.27), JUNGLE = new THREE.Color(0.2, 0.42, 0.18);
  K.tintGround((x, z, y, d, c) => {
    const n = 0.93 + 0.1 * Math.sin(x * 0.043) * Math.cos(z * 0.037);
    c.copy(GRASS).lerp(FLOOR, smooth(70, 140, d));
    const e = d > 60 ? Math.max(smooth(0.5, 0.62, earth(x, z)), (1 - smooth(3, 5, roadGrid(x, z))) * smooth(90, 110, d)) : 0;
    c.lerp(EARTH, e).lerp(JUNGLE, smooth(15, 45, y)).multiplyScalar(n);
  });
  const plantable = (x, z) => roadGrid(x, z) > 7 && earth(x, z) < 0.5;

  // ---- pits (north of the start straight) + race-control tower behind them
  {
    const pb = K.pits(300, { stripe: '#d62828', sign: 'SEPANG  ピット・パドック' });
    const [x, z] = side(at(-40), W2 + 21);
    pb.position.set(x, ground(x, z) - 0.2, z); pb.rotation.y = faceYaw(at(-40), 1);
    world.add(pb);
    K.blockRun(at(-200), at(120), W2 + 30, 14);
  }
  const towerAt = side(at(60), W2 + 66);
  {
    const [x, z] = towerAt, y = ground(x, z) - 0.3, ry = faceYaw(at(60), 1), P = [];
    P.push(part(new THREE.CylinderGeometry(9, 11, 6, 16), '#d9d6ce', 0, 3, 0));
    P.push(part(new THREE.CylinderGeometry(4.2, 5, 52, 12), '#eeebe4', 0, 29, 0));
    P.push(part(new THREE.BoxGeometry(1.4, 50, 1.4), '#b9c2cc', 4.6, 28, 0));
    P.push(part(new THREE.CylinderGeometry(10.5, 7, 3, 16), '#f3f1ec', 0, 54, 0));
    P.push(part(new THREE.CylinderGeometry(11.8, 11.8, 0.6, 16), '#d62828', 0, 59.6, 0));
    P.push(part(new THREE.CylinderGeometry(13, 11.5, 1.2, 16), '#f3f1ec', 0, 60.5, 0));   // the flared cap
    P.push(part(new THREE.CylinderGeometry(3, 4, 3, 10), '#e2dfd8', 0, 62.6, 0));
    P.push(part(new THREE.CylinderGeometry(0.2, 0.35, 12, 5), '#aaaaaa', 0, 70, 0));
    mesh(bake(P, x, y, z, ry), vc({ roughness: 0.5 }));
    const [wm, we] = K.windowTex(24, 1, { glass: '#35556f', frame: '#dfe6ec', lit: '#a9c8e0', litP: 0.2 });
    wm.repeat.set(2, 1); we.repeat.set(2, 1);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 10.5, 4.8, 16, 1, true), new THREE.MeshStandardMaterial({ map: wm, roughness: 0.15, metalness: 0.5, side: THREE.DoubleSide }));
    cab.position.set(x, y + 57.8, z);
    world.add(cab);
    api.block(x, z, 16);
  }

  // ---- main grandstand between the straights: back-to-back stands under a row of leaf canopies
  {
    const rod = (a, b, r, color) => {
      const d = b.clone().sub(a), g = new THREE.CylinderGeometry(r, r, d.length(), 4).translate(0, d.length() / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z);
      return part(g, color);
    };
    // back straight sample nearest to a point
    const nearOn = (x, z, i0, i1) => { let bi = i0, bd = Infinity; for (let i = i0; i <= i1; i++) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
    const iBack0 = Math.round(N * 0.7), iBack1 = Math.round(N * 0.88);
    const LEN = 250, iMain = at(-60), front = W2 + 18;
    const [fx, fz] = side(iMain, -front), fry = faceYaw(iMain, -front);
    const s1 = K.stand(LEN, { rows: 16, roof: null, fascia: '#d62828', concrete: '#d8d4ca' });
    s1.position.set(fx, ground(fx, fz) - 0.2, fz); s1.rotation.y = fry;
    world.add(s1);
    const iB = nearOn(fx, fz, iBack0, iBack1), [bx, bz] = side(iB, -front), bry = faceYaw(iB, -front);
    const s2 = K.stand(LEN * 0.8, { rows: 12, roof: null, fascia: '#d62828', concrete: '#d8d4ca' });
    s2.position.set(bx, ground(bx, bz) - 0.2, bz); s2.rotation.y = bry;
    world.add(s2);
    // leaves: lens outline, arched along the midrib, edges drooping, tips lifted; one per bay from the main-straight
    // stand front to the back-straight stand front
    const L = [], C = [], n = 12, dirX = Math.cos(fry), dirZ = -Math.sin(fry);   // along the main stand (local +X)
    for (let k = 0; k < n; k++) {
      const off = -LEN / 2 + (k + 0.5) * LEN / n;
      const ax = fx + dirX * off + Math.sin(fry) * 3, az = fz + dirZ * off + Math.cos(fry) * 3;
      const ib = nearOn(ax, az, iBack0, iBack1), [ex, ez] = side(ib, -(front - 3));
      const len = Math.hypot(ex - ax, ez - az), yaw = Math.atan2(ex - ax, ez - az), wid = LEN / n * 0.62;
      const SU = 14, SV = 8, pos = [], col = [], idx = [], y0 = Math.max(ground(ax, az), ground(ex, ez)) + 17;
      for (let a = 0; a <= SU; a++) for (let b = 0; b <= SV; b++) {
        const u = a / SU, v = b / SV * 2 - 1, w = wid * Math.pow(Math.sin(Math.PI * u), 0.75);
        const y = y0 + 9 * Math.sin(Math.PI * u) - 2.2 * v * v * (w / wid) + 3 * Math.max(0, 1 - u * 5) ** 2 + 3 * Math.max(0, u * 5 - 4) ** 2;
        pos.push(v * w, y, (u - 0.5) * len);
        const rib = Math.abs(v) < 0.13 ? 0.82 : 0.97 - 0.05 * ((a % 2) ^ (Math.abs(v) > 0.5 ? 1 : 0));
        col.push(rib, rib * 0.99, rib * 0.95);
      }
      for (let a = 0; a < SU; a++) for (let b = 0; b < SV; b++) { const p = a * (SV + 1) + b, q = p + SV + 1; idx.push(p, q, p + 1, p + 1, q, q + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      L.push(g.toNonIndexed().applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition((ax + ex) / 2, 0, (az + ez) / 2)));
      const mx = (ax + ex) / 2, mz = (az + ez) / 2;
      C.push(part(new THREE.CylinderGeometry(0.5, 0.8, y0 + 13 - ground(mx, mz), 8), '#e9e6de', mx, (y0 + 13 + ground(mx, mz)) / 2, mz));
      const ux = (ex - ax) / len, uz = (ez - az) / len, top = new THREE.Vector3(mx, y0 + 12.5, mz);
      for (const f of [-0.3, 0.3]) C.push(rod(top, new THREE.Vector3(mx + ux * f * len, y0 + 9 * Math.sin(Math.PI * (0.5 + f)) + 0.2, mz + uz * f * len), 0.09, '#cfcac0'));   // tension rods
      C.push(part(new THREE.BoxGeometry(LEN / n + 0.4, 7, 22), '#c9c3b6', mx, ground(mx, mz) + 3.3, mz, yaw));   // concourse between the stands
      for (const [px, pz] of [[ax, az], [ex, ez], [mx, mz]]) api.block(px, pz, 16);
    }
    mesh(mergeGeometries(L), vc({ roughness: 0.55, side: THREE.DoubleSide }));
    mesh(mergeGeometries(C), vc({ roughness: 0.6 }));
    const c1 = Math.cos(fry), sn1 = Math.sin(fry);
    for (let k = 0; k <= 12; k++) { const ox = -LEN / 2 + k * LEN / 12; api.block(fx + ox * c1 + 9 * sn1, fz - ox * sn1 + 9 * c1, 13); }
    const c2 = Math.cos(bry), sn2 = Math.sin(bry);
    for (let k = 0; k <= 10; k++) { const ox = -LEN * 0.4 + k * LEN * 0.08; api.block(bx + ox * c2 + 7 * sn2, bz - ox * sn2 + 7 * c2, 12); }
  }
  // corner stands
  for (const [i, len, rows, sg] of [[62, 80, 10, -1], [300, 70, 10], [612, 70, 10], [780, 60, 9]]) {
    const lat = (sg || outside(i)) * (W2 + 17), [x, z] = side(i, lat), [bx, bz] = side(i, lat + Math.sign(lat) * 12);
    if (!api.isFree(bx, bz, 4)) continue;   // the stand's back half must not reach another part of the track
    const st = K.stand(len, { rows, roof: 'flat', fascia: '#d62828', canopy: '#f1efe9' });
    st.position.set(x, ground(x, z) - 0.2, z); st.rotation.y = faceYaw(i, lat);
    world.add(st);
    const n = Math.ceil(len / 20), c = Math.cos(st.rotation.y), s = Math.sin(st.rotation.y), oz = rows * 0.55;
    for (let k = 0; k <= n; k++) { const ox = -len / 2 + k * len / n; api.block(x + ox * c + oz * s, z - ox * s + oz * c, 13); }
  }

  // ---- oil palms: estate rows (triangular lattice, cut by red-earth roads) as crossed-quad cards; real palms on
  // the rows nearest the road and as feature palms round the paddock
  const fMat = K.frondMat([34, 70, 26], [92, 134, 52], '#8a9a4a');
  const OP = [0, 1].map(k => K.palm(rnd, { H: 4.5 + k * 2.5, bend: 0.15 + k * 0.3, r: 0.5, fronds: 11, up: 2, len: 5.4, width: 0.95, droop: [-0.15, -0.75], segs: 3, bark: ['#5b4a36', '#43372a'] }));
  const rows = [];
  for (let j = 0, z0 = minZ - 700; z0 < maxZ + 700; j++, z0 += 9.5) {
    for (let x0 = minX - 700 + (j % 2) * 5.5; x0 < maxX + 700; x0 += 11) {
      const d = K.dist(x0, z0);
      if (d > 62 && d < 800 && plantable(x0, z0)) rows.push([x0 + R(-1, 1), z0 + R(-1, 1), d]);
    }
  }
  const nNear = rows.filter(r => r[2] < 110).length, nFar = rows.length - nNear;
  const keepN = Math.min(1, 380 / Math.max(1, nNear)), keepF = Math.min(1, 10000 / Math.max(1, nFar));
  const palmList = [], cards = [];
  for (const [x, z, d] of rows) {
    const nearRow = d < 110, real = nearRow && rnd() < keepN;
    if (!real && !(nearRow || rnd() < keepF)) continue;
    if (!api.isFree(x, z, 2)) continue;
    if (real && tallOk(x, z, 2.5)) { palmList.push([x, ground(x, z) - 0.2, z, rnd() * TAU, R(0.85, 1.15), (rnd() * 2) | 0]); continue; }
    const sc = R(0.85, 1.2);
    cards.push([x, ground(x, z) - 0.3, z, rnd() * TAU, [sc, sc * R(0.9, 1.2), sc], new THREE.Color().setHSL(R(0.23, 0.29), R(0.35, 0.5), R(0.3, 0.42))]);
  }
  for (let m = -200; m <= 120; m += 16) for (const lat of [W2 + 46, -(W2 + 50)]) {   // feature palms along the paddock and the grandstand plaza
    const [x, z] = side(at(m), lat);
    if (tallOk(x, z, 2.5)) { palmList.push([x, ground(x, z) - 0.2, z, rnd() * TAU, R(1, 1.2), 1]); api.block(x, z, 2.5); }
  }
  K.palms(OP, palmList, fMat, () => new THREE.Color().setRGB(R(0.75, 1), R(0.85, 1.05), R(0.7, 0.9)));
  {
    const tex = api.canvasTex(128, 128, (g, w, h) => {   // oil palm silhouette: stubby trunk, dense arching fronds
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#4a3b2a'; g.fillRect(w / 2 - 5, h * 0.55, 10, h * 0.45);
      g.lineCap = 'round';
      for (let k = 0; k < 26; k++) {
        const a = -Math.PI / 2 + (k / 25 - 0.5) * 3.3, l = 38 + Math.random() * 20, sx = w / 2, sy = h * 0.58;
        const ex = sx + Math.cos(a) * l, ey = sy + Math.sin(a) * l * 0.8 + Math.abs(Math.cos(a)) * 22;
        g.strokeStyle = `rgb(${40 + Math.random() * 40 | 0},${85 + Math.random() * 50 | 0},${30 + Math.random() * 20 | 0})`;
        g.lineWidth = 5 + Math.random() * 3;
        g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(sx + Math.cos(a) * l * 0.6, sy + Math.sin(a) * l * 0.75 - 8, ex, ey); g.stroke();
      }
    }, false);
    const q = new THREE.PlaneGeometry(10, 10).translate(0, 4.2, 0);
    inst(mergeGeometries([q.clone(), q.clone().rotateY(Math.PI / 2)]), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), cards, false).receiveShadow = false;
  }

  // ---- rain trees (wide umbrella canopies) and hibiscus around the paddock, grandstand plazas and the infield
  const hibTex = api.canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#2f6b2a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${20 + Math.random() * 40 | 0},${80 + Math.random() * 60 | 0},${20 + Math.random() * 30 | 0},0.8)`; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 5, 3, Math.random() * 3, 0, TAU); g.fill(); }
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w, y = Math.random() * h, c = ['#e0112b', '#ff3b5c', '#f06a1d', '#e0112b'][i % 4];
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU; g.fillStyle = c; g.beginPath(); g.ellipse(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 3.6, 2.6, a, 0, TAU); g.fill(); }
      g.fillStyle = '#ffe066'; g.fillRect(x - 1, y - 1, 2, 2);
    }
  });
  const hib = [], rain = [];
  const spots = [[at(-40), 1], [at(-60), -1], [82, 0], [300, 0], [612, 0]];
  for (let t = 0; t < 4000 && hib.length < 260; t++) {
    const [i, sg] = spots[(rnd() * spots.length) | 0], s = sg || outside(i), lat = s * R(W2 + 14, W2 + 70), [x, z] = side(i + R(-50, 50), lat);
    if (!api.isFree(x, z, 1.2)) continue;
    const r = R(0.8, 1.5);
    hib.push([x, ground(x, z) + r * 0.35, z, rnd() * TAU, [r * 1.2, r * 0.85, r * 1.2]]);
    api.block(x, z, 1);
  }
  for (let t = 0; t < 5000 && rain.length < 140; t++) {
    const x = R(minX - 200, maxX + 200), z = R(minZ - 200, maxZ + 200), d = K.dist(x, z);
    if (d < 40 || d > 260 || (d > 55 && plantable(x, z) && rnd() < 0.8) || !tallOk(x, z, 7)) continue;
    const s = R(0.8, 1.3);
    rain.push([x, ground(x, z) - 0.2, z, rnd() * TAU, s, new THREE.Color().setHSL(R(0.24, 0.3), R(0.35, 0.5), R(0.22, 0.3))]);
    api.block(x, z, 7 * s);
  }
  inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ map: hibTex, roughness: 0.8, flatShading: true }), hib);

  // ---- roadside greenery: leaning coconut palms and fern / shrub clumps in clusters between the barrier and the estates
  const CP = [0, 1].map(k => K.palm(rnd, { H: 9 + k * 2.5, bend: 1.4 + k * 1.2, r: 0.28, fronds: 10, up: 3, len: 4.6, width: 0.9, segs: 4 }));
  const cocos = [], ferns = [];
  for (let t = 0; t < 6000 && (cocos.length < 160 || ferns.length < 320); t++) {
    const i = (rnd() * N) | 0, sg = rnd() < 0.5 ? 1 : -1, [x0, z0] = side(i, sg * R(W2 + 20, W2 + 55));
    for (let k = 0, m = 2 + ((rnd() * 4) | 0); k < m; k++) {
      const x = x0 + R(-9, 9), z = z0 + R(-9, 9);
      if (cocos.length < 160 && rnd() < 0.45) {
        if (!tallOk(x, z, 2)) continue;
        cocos.push([x, ground(x, z) - 0.2, z, rnd() * TAU, R(0.85, 1.1), (rnd() * 2) | 0]);
        api.block(x, z, 2);
      } else if (ferns.length < 320 && api.isFree(x, z, 1.5)) {
        const r = R(1, 2.2);
        ferns.push([x, ground(x, z) + r * 0.2, z, rnd() * TAU, [r * 1.3, r * 0.7, r * 1.3], new THREE.Color().setHSL(R(0.25, 0.32), R(0.4, 0.55), R(0.16, 0.26))]);
      }
    }
  }
  K.palms(CP, cocos, K.frondMat([48, 104, 32], [120, 160, 70]), () => new THREE.Color().setRGB(R(0.85, 1), R(0.9, 1.05), R(0.8, 0.95)));
  inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), ferns);
  const rtTrunk = mergeGeometries([part(new THREE.CylinderGeometry(0.35, 0.6, 5, 6, 1, true), '#6d5a45', 0, 2.5, 0),
    part(new THREE.CylinderGeometry(0.15, 0.3, 5, 5, 1, true), '#6d5a45', 1.4, 5.2, 0, 0, 0, -0.7), part(new THREE.CylinderGeometry(0.15, 0.3, 5, 5, 1, true), '#6d5a45', -1.3, 5.2, 0.4, 0, 0, 0.7)]);
  inst(rtTrunk, vc({ roughness: 0.9 }), rain.map(e => e.slice(0, 5)));
  const rtCrown = mergeGeometries([new THREE.IcosahedronGeometry(1, 1).scale(8, 2.6, 8).translate(0, 8.4, 0), new THREE.IcosahedronGeometry(1, 0).scale(4.5, 2, 4.5).translate(3.5, 7.6, 1.5), new THREE.IcosahedronGeometry(1, 0).scale(4, 1.8, 4).translate(-3.8, 7.8, -1.2)]);
  inst(rtCrown, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), rain);

  // ---- towering cumulus around the horizon (pre-hazed, fog off so they read through the haze)
  {
    const G = [], hz = new THREE.Color(env.fog.color);
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU + R(-0.25, 0.25), r = R(1500, 1900), x0 = cx + Math.cos(a) * r, z0 = cz + Math.sin(a) * r, H = R(160, 330);
      for (let b = 0; b < 16; b++) {
        const t = b / 15, rr = R(45, 85) * (1 - t * 0.5), y = 140 + t * H, bx = x0 + R(-70, 70) * (1 - t * 0.6), bz = z0 + R(-70, 70) * (1 - t * 0.6);
        const shade = 0.78 + 0.22 * t, c = new THREE.Color(shade, shade, shade * 1.02).lerp(hz, 0.35);
        G.push(part(new THREE.IcosahedronGeometry(rr, 1).scale(1, 0.8, 1), c, bx, y, bz));
      }
    }
    const m = new THREE.Mesh(mergeGeometries(G), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    m.renderOrder = -4;
    world.add(m);
  }

  // ---- airliner crossing on approach to the airport next door
  {
    const P = [
      part(new THREE.CylinderGeometry(2, 2, 36, 10).rotateX(Math.PI / 2), '#f4f6f8'),
      part(new THREE.ConeGeometry(2, 5, 10).rotateX(Math.PI / 2), '#f4f6f8', 0, 0, 20.5),
      part(new THREE.ConeGeometry(2, 8, 10).rotateX(-Math.PI / 2), '#f4f6f8', 0, 0.6, -22),
      part(new THREE.BoxGeometry(38, 0.5, 5.5), '#e4e7ea', 0, -0.6, 1),
      part(new THREE.BoxGeometry(13, 0.4, 3.2), '#e4e7ea', 0, 1, -22),
      part(new THREE.BoxGeometry(0.5, 7, 4.6), '#d62828', 0, 4, -22),
      part(new THREE.BoxGeometry(4.1, 0.6, 30), '#1f4fa0', 0, 0.2, -1),
      part(new THREE.CylinderGeometry(1, 1, 4, 8).rotateX(Math.PI / 2), '#9aa3ad', 8, -1.6, 2.5),
      part(new THREE.CylinderGeometry(1, 1, 4, 8).rotateX(Math.PI / 2), '#9aa3ad', -8, -1.6, 2.5),
    ];
    const plane = mesh(mergeGeometries(P), vc({ roughness: 0.4, fog: false }), false);
    let t = R(0, 70);
    const fly = dt => {
      t = (t + dt) % 75;
      const u = t / 75, x = cx - 2600 + u * 5200, z = cz - 900 + u * 1300, y = 520 - u * 260;
      plane.position.set(x, y, z);
      plane.rotation.set(0.04, Math.atan2(5200, 1300), 0);
    };
    fly(0);
    api.onUpdate(fly);
  }
}

export default { base: 'beach', env, baseBuild: false, build };
