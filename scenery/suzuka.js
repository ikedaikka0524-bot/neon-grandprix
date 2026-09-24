// Suzuka on a clear summer afternoon: the amusement park beside the main straight (Ferris wheel, roller coaster, drop
// tower, tents) behind the main grandstand, the pit building opposite, the figure-8 crossover as a proper concrete bridge
// (deck, parapets, piers, abutments; the lower road runs through a cutting), wooded hills with cedar and broadleaf
// trees, rice paddies with farmhouses south-east of the S-curves, a temple with a five-storey pagoda on a knoll between
// them, and the Suzuka mountains on the western horizon.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, course, pad, applyPads, paintGrass, fbm, smooth, lerp, TAU } = await import(`./nring.js${new URL(import.meta.url).search}`);

const C = course('suzuka'), W2 = 7;
const CROSS = { x: -885.5, z: -73, lo: [440, 520] };       // figure-8 crossover: lower road samples around it
const TEMPLE = { x: 262, z: 712 };
const PADDIES = [   // rice fields: centre, size (x, z), terraced a little below the road
  { x: 595, z: 490, w: 380, d: 390 },
  { x: -95, z: 712, w: 450, d: 200 },
];
const PADS = [
  pad(C.at(1130), C.at(92), W2 + 58),                        // main straight: pits + grandstands
  pad(C.at(20, -170), C.at(75, -190), 105, -0.2, 60),         // amusement park
];
const lowRoad = [];
for (let i = CROSS.lo[0]; i <= CROSS.lo[1]; i++) lowRoad.push(C.X[i], C.Z[i]);
// the raised back straight: exact road height along it (the base terrain samples every 3rd point and pokes through the ramps)
const ramp = [];
for (let i = 912; i <= 1024; i++) ramp.push(i);
function rampY(x, z) {   // [horizontal distance, road height] to the ramp polyline
  let bd = Infinity, by = 0;
  for (let k = 0; k + 1 < ramp.length; k++) {
    const a = ramp[k], b = ramp[k + 1], ex = C.X[b] - C.X[a], ez = C.Z[b] - C.Z[a];
    const t = Math.max(0, Math.min(1, ((x - C.X[a]) * ex + (z - C.Z[a]) * ez) / (ex * ex + ez * ez)));
    const d = (x - C.X[a] - ex * t) ** 2 + (z - C.Z[a] - ez * t) ** 2;
    if (d < bd) { bd = d; by = C.Y[a] + (C.Y[b] - C.Y[a]) * t; }
  }
  return [Math.sqrt(bd), by];
}
const distLow = (x, z) => { let b = Infinity; for (let k = 0; k < lowRoad.length; k += 2) b = Math.min(b, (lowRoad[k] - x) ** 2 + (lowRoad[k + 1] - z) ** 2); return Math.sqrt(b); };

function height(x, z, y, dist) {
  const west = smooth(0, -700, x);
  y += (fbm(x / 260 - 2, z / 260 + 5) - 0.35) * (14 + 26 * west) * smooth(W2 + 30, W2 + 220, dist);          // wooded hills, flatter plain to the east
  y += smooth(-1820, -2350, x) * (170 + 150 * fbm(z / 380 + 1, x / 380));   // the Suzuka range (Spoon, the westmost corner, is at x -1677)
  const dt = Math.hypot(x - TEMPLE.x, z - TEMPLE.z);
  if (dt < 140) y = Math.max(y, 11 * (1 - smooth(42, 130, dt)));                                                // temple knoll
  y = applyPads(PADS, x, z, y);
  for (const p of PADDIES) {   // rounded-rectangle terraces for the paddies
    const dd = Math.hypot(Math.max(0, Math.abs(x - p.x) - p.w / 2), Math.max(0, Math.abs(z - p.z) - p.d / 2));
    if (dd < 55) y = lerp(y, -1.2, 1 - smooth(8, 55, dd));
  }
  if (x > -1160 && x < -620 && z > -340 && z < 20) {
    const [dr, yr] = rampY(x, z);
    if (dr < W2 + 12) y = Math.min(y, yr - 0.25);
  }
  if (Math.abs(x - CROSS.x) < 170 && Math.abs(z - CROSS.z) < 170) y = lerp(-0.2, y, smooth(W2 + 11, W2 + 30, distLow(x, z)));   // underpass cutting
  return y;
}

function paintPaddy(g, w, h) {   // 160 m tile of rice fields separated by grassy dikes (seamless: dikes on the tile edges)
  g.fillStyle = '#8a9a58'; g.fillRect(0, 0, w, h);
  const fields = ['#5f9a35', '#548f2e', '#6aa43c', '#5c9432', '#78ad45', '#6f8f94', '#7f9ea3'];
  for (let y = 0; y < h;) {
    const rh = Math.min(h - y, 44 + Math.random() * 36);
    for (let x = 0; x < w;) {
      const fw = Math.min(w - x, 50 + Math.random() * 70), c = fields[Math.floor(Math.random() * fields.length)];
      g.fillStyle = c; g.fillRect(x + 3, y + 3, fw - 6, rh - 6);
      if (c.startsWith('#6f8') || c.startsWith('#7f9')) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 3, y + 3, fw - 6, (rh - 6) * 0.4); }   // flooded: sky glint
      else { g.fillStyle = 'rgba(30,70,20,0.25)'; for (let k = x + 5; k < x + fw - 4; k += 3) g.fillRect(k, y + 4, 1, rh - 8); }   // seedling rows
      x += fw;
    }
    y += rh;
  }
}
function paintTent(g, w, h) {   // vertical stripes for circus tents
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e63946'; g.fillRect(i * w / 16, 0, w / 16 + 1, h); }
}

function build(api) {
  const K = kit(api), { rnd, range, pick, S, N } = K, track = api.track;
  const sign = K.signs([['グランプリ  GRAND PRIX', '#c1121f'], ['ピット  PIT', '#1d2533'], ['ようこそ  WELCOME', '#1d4ed8'], ['モータースポーツ', '#1d2533', '#ffd23f']]);

  // ---------------------------------------------------------------- main straight: pit building (right) + grandstands (left)
  {
    const p = K.beside(1192, W2 + 15, -0.2);
    if (K.claim(p, 240, 22)) K.pits(K.frame(p.x, p.y, p.z, p.ry), 240, { accent: '#c1121f', sign: sign(1) });
    for (const [i, len, k] of [[1177, 110, 0], [22, 110, 3]]) {
      const q = K.beside(i, -(W2 + 14), -0.2);
      if (!K.claim(q, len, 16)) continue;
      const put = K.frame(q.x, q.y, q.z, q.ry);
      K.grandstand(put, len, { rows: 16, fascia: '#c1121f' });
      put('sign', sign(k)(34, 3.2).translate(0, 14.6, -3.3));
    }
    // spectator stands on the outside of the S-curves, Degner and the hairpin
    for (const [i, len] of [[228, 60], [262, 50], [440, 50], [548, 60]]) for (const sg of [1, -1]) {
      const q = K.beside(i, sg * (W2 + 16), -0.2), [d, j] = K.nearI(q.x, q.z);
      if (!K.tallOk(q.x + Math.sin(q.ry) * 6, q.z + Math.cos(q.ry) * 6, d + 6, j) || !K.claim(q, len, 12)) continue;
      K.grandstand(K.frame(q.x, api.groundAt(q.x, q.z) - 0.3, q.z, q.ry), len, { rows: 9, fascia: '#1d4ed8' });
      break;
    }
  }

  // ---------------------------------------------------------------- amusement park: Ferris wheel, roller coaster, drop tower, tents
  {
    // Ferris wheel (wheel rotates, gondolas stay upright)
    const f = K.beside(27, -152, -0.2), R = 28, HUB = 33;
    api.block(f.x, f.z, 34);
    const put = K.frame(f.x, f.y, f.z, f.ry);
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {   // A-frame legs
      const a = new THREE.Vector3(sx * 13, 0, sz * 6), b = new THREE.Vector3(0, HUB, sz * 2.2), d = b.clone().sub(a);
      put('solid', new THREE.CylinderGeometry(0.45, 0.6, d.length(), 6).translate(0, d.length() / 2, 0)
        .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())).translate(a.x, a.y, a.z), '#eceff3');
    }
    put('solid', K.box(8, 1.6, 12, 0, 0, 0), '#d7dbe0');   // boarding platform
    const parts = [], cols = [];
    for (const z of [-1.5, 1.5]) { parts.push(new THREE.TorusGeometry(R, 0.4, 5, 64).translate(0, 0, z)); cols.push([0.95, 0.95, 0.97]); parts.push(new THREE.TorusGeometry(R * 0.55, 0.22, 4, 40).translate(0, 0, z)); cols.push([0.85, 0.2, 0.25]); }
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * TAU;
      for (const z of [-1.5, 1.5]) { parts.push(new THREE.BoxGeometry(0.25, R, 0.25).translate(0, R / 2, z).rotateZ(a)); cols.push([0.93, 0.93, 0.95]); }
    }
    parts.push(new THREE.CylinderGeometry(1.6, 1.6, 4.6, 12).rotateX(Math.PI / 2)); cols.push([0.7, 0.72, 0.76]);
    const wheel = new THREE.Mesh(K.bake(parts, cols), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
    wheel.position.set(f.x, f.y + HUB, f.z); wheel.rotation.y = f.ry; wheel.castShadow = true;
    api.world.add(wheel);
    const gond = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2.4, 2).translate(0, -1.7, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 24);
    const gc = ['#e63946', '#ffb703', '#2a9d8f', '#1d4ed8', '#f472b6', '#8ecae6'], tc = new THREE.Color();
    for (let k = 0; k < 24; k++) gond.setColorAt(k, tc.set(gc[k % gc.length]));
    api.world.add(gond);
    const dm = new THREE.Object3D(), ax = Math.cos(f.ry), az = -Math.sin(f.ry);   // wheel plane: local x axis in world
    let spin = 0;
    const turnWheel = dt => {
      spin += dt * 0.05;
      wheel.rotation.z = spin;
      for (let k = 0; k < 24; k++) {
        const a = spin + k / 24 * TAU + Math.PI / 2, lx = Math.cos(a) * R, ly = Math.sin(a) * R;
        dm.position.set(f.x + ax * lx, f.y + HUB + ly, f.z + az * lx); dm.rotation.set(0, f.ry, 0); dm.updateMatrix();
        gond.setMatrixAt(k, dm.matrix);
      }
      gond.instanceMatrix.needsUpdate = true;
    };
    turnWheel(0);
    gond.computeBoundingSphere();
    api.onUpdate(turnWheel);

    // roller coaster: red tube track on white supports, a 4-car train running the circuit
    const c = K.beside(70, -178, -0.2);
    api.block(c.x, c.z, 62);
    const loc = new THREE.Matrix4().makeRotationY(c.ry).setPosition(c.x, c.y, c.z);
    const path = new THREE.CatmullRomCurve3([
      [-48, 4, -2], [-20, 4, -4], [0, 20, -2], [18, 40, 2], [30, 30, 8], [38, 7, 18], [46, 5, 34], [50, 22, 50], [38, 30, 62],
      [16, 12, 66], [-6, 22, 60], [-26, 9, 50], [-46, 16, 40], [-58, 7, 24], [-56, 5, 8],
    ].map(p => new THREE.Vector3(...p)), true, 'centripetal');
    const cput = K.frame(c.x, c.y, c.z, c.ry);
    cput('solid', new THREE.TubeGeometry(path, 360, 0.75, 5, true), '#e63946');
    for (let k = 0; k < 90; k++) {
      const p = path.getPointAt(k / 90);
      if (p.y > 2) cput('solid', K.cyl(0.28, 0.35, p.y - 0.7, 5, p.x, 0, p.z), '#f4f4f4');
    }
    cput('solid', K.box(26, 3, 9, -34, 0, -3), '#ffd166');                                  // station
    cput('solid', K.box(28, 0.6, 11, -34, 5.6, -3), '#264653');
    const train = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 1.3, 2.8).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.4, metalness: 0.3 }), 4);
    api.world.add(train);
    const len = path.getLength(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let u = 0.02;
    const ride = dt => {
      const y = path.getPointAt(u).y;
      u = (u + dt * (5 + Math.sqrt(Math.max(0, 2 * 9.8 * (41 - y)))) / len) % 1;
      for (let k = 0; k < 4; k++) {
        const uk = (u - k * 3.2 / len + 1) % 1;
        dm.position.copy(path.getPointAt(uk)).applyMatrix4(loc);
        v.copy(path.getTangentAt(uk)).transformDirection(loc);
        dm.up.copy(up); dm.lookAt(dm.position.x + v.x, dm.position.y + v.y, dm.position.z + v.z);
        dm.updateMatrix();
        train.setMatrixAt(k, dm.matrix);
      }
      train.instanceMatrix.needsUpdate = true;
    };
    ride(0);
    train.computeBoundingSphere();
    train.boundingSphere.radius += 80;
    api.onUpdate(ride);

    // drop tower with a rising / falling seat ring
    const d = K.beside(46, -240, -0.2);
    if (api.isFree(d.x, d.z, 10)) {
      api.block(d.x, d.z, 10);
      const dput = K.frame(d.x, d.y, d.z, d.ry);
      dput('solid', K.cyl(1.3, 1.6, 60, 10), '#f4f4f4');
      for (let k = 0; k < 6; k++) dput('solid', K.cyl(1.35, 1.35, 1.2, 10, 0, 6 + k * 9, 0), '#e63946');
      dput('solid', K.cyl(2.4, 2, 3, 10, 0, 60, 0), '#1d4ed8');
      dput('solid', K.cyl(4, 4, 1, 12, 0, 0, 0), '#9aa1ab');
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.8, 6, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffb703, roughness: 0.4 }));
      ring.position.set(d.x, d.y + 5, d.z);
      api.world.add(ring);
      let t = 0;
      api.onUpdate(dt => { t = (t + dt) % 12; ring.position.y = d.y + 3 + (t < 7 ? 50 * smooth(0, 6, t) : 50 * (1 - smooth(7, 8.1, t))); });
    }
    // paved plaza + paths across the park
    const pz = K.beside(45, -150, -0.2), pput = K.frame(pz.x, pz.y, pz.z, pz.ry);
    pput('solid', K.box(200, 0.25, 34, -10, 0, 20), '#c7bca3');
    pput('solid', K.box(26, 0.26, 150, -40, 0, 20), '#c7bca3');
    pput('solid', K.box(22, 0.26, 120, 45, 0, 40), '#c7bca3');
    // circus tents + pavilions
    K.mat('tent', new THREE.MeshStandardMaterial({ map: K.tex(256, 32, paintTent), vertexColors: true, roughness: 0.7 }));
    for (const [i, lat, r, tint] of [[36, -118, 9, '#ffffff'], [50, -128, 7, '#ffd9a0'], [58, -110, 6, '#c9e4ff'], [14, -205, 8, '#ffffff'], [88, -150, 7, '#ffe0f0']]) {
      const b = K.beside(i, lat);
      if (!api.isFree(b.x, b.z, r + 2)) continue;
      api.block(b.x, b.z, r + 2);
      const tp = K.frame(b.x, b.y, b.z, b.ry);
      tp('solid', K.cyl(r, r, 3.6, 16, 0, -0.2, 0), '#f7f3ea');
      tp('tent', new THREE.ConeGeometry(r * 1.12, r * 0.85, 16, 1, true).translate(0, 3.4 + r * 0.425, 0), tint);
      tp('solid', K.cyl(0.08, 0.08, 3, 4, 0, 3.2 + r * 0.85, 0), '#555');
      tp('solid', K.box(0.05, 0.9, 1.6, 0, 5.4 + r * 0.85, 0.8), pick(['#ffb703', '#2a9d8f', '#e63946']));
    }
    for (const [i, lat, w, col] of [[8, -120, 26, '#8ecae6'], [62, -250, 30, '#f4a261'], [30, -230, 22, '#b5e48c']]) {
      const b = K.beside(i, lat);
      if (!K.claim(b, w, 16)) continue;
      const bp = K.frame(b.x, b.y, b.z, b.ry);
      bp('solid', K.box(w, 7, 16, 0, -0.2, 8), '#f8f4ec');
      bp('solid', K.box(w + 1.5, 1.4, 17.5, 0, 6.8, 8), col);
      bp('shiny', K.box(w - 4, 2.6, 0.3, 0, 1.2, -0.05), '#2a4a66');
    }
    for (let k = -4; k <= 4; k++) { const b = K.beside(45 + k * 4, -170); api.block(b.x, b.z, 20); }   // keep trees off the plaza
  }

  // ---------------------------------------------------------------- the figure-8 crossover bridge
  {
    let cross = 0, cd = Infinity;   // upper sample right above the lower road
    for (let i = 0; i < N; i++) if (S[i].pos.y > 5) { const d = Math.hypot(S[i].pos.x - CROSS.x, S[i].pos.z - CROSS.z); if (d < cd) { cd = d; cross = i; } }
    const L = W2 + 10.8, deck = [];
    for (let k = -40; k <= 40; k++) { const i = (cross + k + N) % N; if (distLow(S[i].pos.x, S[i].pos.z) < W2 + 40) deck.push(i); }
    const P = (i, lat, dy) => { const s = S[i]; return [s.pos.x + s.right.x * lat, s.pos.y + dy, s.pos.z + s.right.z * lat]; };
    const pts = [], conc = '#bdbab2', dark = '#8d8a84';
    for (let k = 0; k + 1 < deck.length; k++) {
      const a = deck[k], b = deck[k + 1];
      const quad = (p, q, r, s) => pts.push(p, q, r, p, r, s);
      quad(P(a, -L, -0.08), P(b, -L, -0.08), P(b, L, -0.08), P(a, L, -0.08));         // deck top under the road
      quad(P(a, -L, -1.7), P(a, L, -1.7), P(b, L, -1.7), P(b, -L, -1.7));             // soffit
      for (const sg of [-1, 1]) {
        quad(P(a, sg * L, -1.7), P(b, sg * L, -1.7), P(b, sg * L, 1.1), P(a, sg * L, 1.1));                  // fascia + parapet outer face
        quad(P(a, sg * (L - 0.45), -0.08), P(b, sg * (L - 0.45), -0.08), P(b, sg * (L - 0.45), 1.1), P(a, sg * (L - 0.45), 1.1));
        quad(P(a, sg * L, 1.1), P(b, sg * L, 1.1), P(b, sg * (L - 0.45), 1.1), P(a, sg * (L - 0.45), 1.1));   // parapet top
      }
    }
    K.add('solid', K.tris(pts), conc);
    const rail = [];
    for (const i of deck) for (const sg of [-1, 1]) {   // railing posts + top rail on the parapets
      const [x, y, z] = P(i, sg * (L - 0.22), 1.1);
      rail.push(K.box(0.12, 1.1, 0.12, x, y, z));
    }
    for (let k = 0; k + 1 < deck.length; k++) for (const sg of [-1, 1]) {
      const a = new THREE.Vector3(...P(deck[k], sg * (L - 0.22), 2.1)), b = new THREE.Vector3(...P(deck[k + 1], sg * (L - 0.22), 2.1)), d = b.clone().sub(a);
      rail.push(new THREE.BoxGeometry(0.1, 0.1, d.length()).lookAt(d).translate((a.x + b.x) / 2, a.y, (a.z + b.z) / 2));
    }
    K.add('shiny', mergeGeometries(rail.map(g => g.index ? g.toNonIndexed() : g)), '#c9ced6');
    // abutment walls along the lower road (just outside its barriers) under the deck, piers further out
    const lo = [];
    for (let i = 0; i < N; i++) if (S[i].pos.y < 0.5 && Math.hypot(S[i].pos.x - CROSS.x, S[i].pos.z - CROSS.z) < 90) lo.push(i);
    const upLat = (x, z) => { const s = S[cross], dx = x - s.pos.x, dz = z - s.pos.z, along = dx * s.tan.x + dz * s.tan.z; const j = (cross + Math.round(along / track.spacing) + N) % N, t = S[j]; return [(x - t.pos.x) * t.right.x + (z - t.pos.z) * t.right.z, j]; };
    const wall = [];
    for (const sg of [-1, 1]) for (let k = 0; k + 1 < lo.length; k++) {
      const A = P(lo[k], sg * (W2 + 11.4), 0), B = P(lo[k + 1], sg * (W2 + 11.4), 0), [la, ja] = upLat(A[0], A[2]), [lb, jb] = upLat(B[0], B[2]);
      if (Math.abs(la) > L + 3 && Math.abs(lb) > L + 3) continue;
      const ta = S[ja].pos.y - 1.7, tb = S[jb].pos.y - 1.7;
      wall.push([A[0], -0.4, A[2]], [B[0], -0.4, B[2]], [B[0], tb, B[2]], [A[0], -0.4, A[2]], [B[0], tb, B[2]], [A[0], ta, A[2]]);
    }
    if (wall.length) K.add('solid', K.tris(wall), dark);
    for (const i of deck) {
      if (i % 3) continue;
      for (const lat of [-W2 - 4, 0, W2 + 4]) {
        const [x, y, z] = P(i, lat, -1.7), g = api.groundAt(x, z);
        if (distLow(x, z) > W2 + 14 && y - g > 1.2) K.add('solid', K.cyl(0.7, 0.8, y - g + 0.5, 8, x, g - 0.5, z), dark);
      }
    }
    // banner on the fascia facing the cars that dive under the bridge
    const b = K.beside(cross, L + 0.06, S[cross].pos.y - 1.25);
    K.add('sign', sign(0)(22, 1.1).rotateY(Math.PI).applyMatrix4(K.M(b.x, b.y, b.z, b.ry)));
  }

  // ---------------------------------------------------------------- rice paddies + farmhouses
  K.mat('paddy', new THREE.MeshStandardMaterial({ map: K.tex(512, 512, paintPaddy), vertexColors: true, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  K.noShadow('paddy');
  const inPaddy = (x, z, m = 0) => PADDIES.some(p => Math.abs(x - p.x) < p.w / 2 + m && Math.abs(z - p.z) < p.d / 2 + m);
  for (const p of PADDIES) K.add('paddy', K.plane(p.w, p.d, p.w / 160, p.d / 160).rotateX(-Math.PI / 2).translate(p.x, -1.02, p.z));
  const minka = (x, z, ry, big) => {   // Japanese house: plaster/wood walls, dark tiled hip roof
    const w = big ? range(11, 14) : range(7, 9.5), d = big ? range(9, 11) : range(6.5, 8.5), h = big ? 5.5 : range(3, 5.8);
    const put = K.frame(x, api.groundAt(x, z) - 0.2, z, ry);
    put('solid', K.box(w, h, d), pick(['#f3eee2', '#efe7d6', '#d9c7a7', '#e9e4da']));
    put('solid', K.box(w + 0.1, 0.9, d + 0.1, 0, 0, 0), '#6b4f3a');
    put('solid', K.jroof(w + 2.2, d + 2.2, big ? 4.2 : 2.8, big ? 0.5 : 0.3).translate(0, h, 0), pick(['#3f454e', '#4a505a', '#394350', '#5a4a44']));
  };
  {
    let n = 0;
    for (let t = 0; t < 1500 && n < 40; t++) {
      const p = pick(PADDIES), side = Math.floor(rnd() * 4), m = 10 + rnd() * 45;
      const x = p.x + (side < 2 ? (rnd() - 0.5) * p.w : (side === 2 ? -1 : 1) * (p.w / 2 + m)), z = p.z + (side < 2 ? (side ? -1 : 1) * (p.d / 2 + m) : (rnd() - 0.5) * p.d);
      if (inPaddy(x, z, 6) || !api.isFree(x, z, 9)) continue;
      const [d, i] = K.nearI(x, z);
      if (d < W2 + 45) continue;
      api.block(x, z, 8);
      minka(x, z, Math.round(rnd() * 4) * Math.PI / 2, rnd() < 0.3);
      n++;
    }
  }

  // ---------------------------------------------------------------- temple on its knoll: main hall, five-storey pagoda, torii
  {
    const [d, i] = K.nearI(TEMPLE.x, TEMPLE.z), s = S[i], ry = Math.atan2(TEMPLE.x - s.pos.x, TEMPLE.z - s.pos.z);   // local -Z faces the circuit
    api.block(TEMPLE.x, TEMPLE.z, 45);
    const put = K.frame(TEMPLE.x, api.groundAt(TEMPLE.x, TEMPLE.z) - 0.3, TEMPLE.z, ry);
    const verm = '#c0392b', roof = '#3b3f45', wood = '#6b3f2a';
    // main hall
    put('solid', K.box(26, 1.4, 19, -8, 0, 4), '#b8b2a6');
    put('solid', K.box(20, 6, 13, -8, 1.4, 4), '#f1ebe0');
    for (let k = 0; k < 6; k++) for (const z of [-2.8, 10.8]) put('solid', K.cyl(0.35, 0.35, 6, 6, -17.5 + k * 3.8, 1.4, z), verm);
    put('solid', K.box(20.4, 0.8, 13.4, -8, 6.6, 4), wood);
    put('solid', K.jroof(30, 22, 8.5, 1.5, 5, 8).translate(-8, 7.4, 4), roof);
    put('solid', K.box(10, 1, 0.8, -8, 15.6, 4), roof);
    // five-storey pagoda
    put('solid', K.box(10, 1.2, 10, 16, 0, 8), '#b8b2a6');
    let y = 1.2;
    for (let k = 0; k < 5; k++) {
      const b = 6.6 - k * 0.75;
      put('solid', K.box(b, 3, b, 16, y, 8), k % 2 ? '#f1ebe0' : verm);
      put('solid', K.jroof(b * 1.9, b * 1.9, 1.7, 0.75, 3, 6).translate(16, y + 3, 8), roof);
      y += 3 + 1.1;
    }
    put('solid', K.cyl(0.22, 0.3, 9, 6, 16, y - 0.6, 8), '#c9a227');   // sorin spire with rings
    for (let k = 0; k < 7; k++) put('solid', K.cyl(0.75, 0.75, 0.25, 8, 16, y + 1 + k * 0.9, 8), '#b08d2a');
    // torii toward the circuit
    for (const x of [-5, 5]) put('solid', K.cyl(0.45, 0.5, 8.5, 8, x - 2, 0, -30), verm);
    put('solid', K.box(15, 0.9, 1.2, -2, 8.2, -30), '#1f1f1f');
    put('solid', K.box(14, 0.7, 1, -2, 7.5, -30), verm);
    put('solid', K.box(12, 0.5, 0.6, -2, 6.2, -30), verm);
    for (const [x, z] of [[-12, -14], [8, -14], [-12, -2], [8, -2]]) put('solid', K.cyl(0.6, 0.8, 1.8, 6, x, 0, z), '#a8a39a');   // stone lanterns
  }

  K.flush();

  // ---------------------------------------------------------------- forests: cedar + broadleaf on the hills, sparse on the eastern plain
  const tc = new THREE.Color(), park = C.at(45, -190);
  const blob = K.bake([new THREE.IcosahedronGeometry(3, 0).scale(1, 0.75, 1).translate(0, 3.6, 0)], [[1, 1, 1]]);   // far broadleaf canopy
  K.trees({
    n: 13000, pad: 600, geos: [K.spruce(3, 5, 0.58), K.leafy(2), K.spruce(1, 5, 0.6, false), blob, K.leafy(1)],
    density: (x, z, d) => {
      if (inPaddy(x, z, 8) || Math.hypot(x - park.x, z - park.z) < 80 || Math.hypot(x - TEMPLE.x, z - TEMPLE.z) < 55) return 0;
      const west = smooth(100, -600, x);
      return (0.3 + 0.7 * smooth(0.28, 0.5, fbm(x / 170 + 2, z / 170))) * (0.5 + 0.5 * west);
    },
    kind: (x, z, d) => (d > 180 ? (rnd() < 0.5 ? 2 : 3) : rnd() < 0.4 ? 0 : d > W2 + 60 ? 4 : 1),   // cedar / broadleaf, cheaper with distance
    size: (x, z, d, k) => (k === 2 || k === 3 ? 1.7 + rnd() * 0.8 : k === 0 ? 1.3 + rnd() * 0.6 : 1.1 + rnd() * 0.6),
    color: (x, z, k) => (k === 0 || k === 2 ? tc.setHSL(0.33 + rnd() * 0.05, 0.35 + rnd() * 0.1, 0.09 + rnd() * 0.04) : tc.setHSL(0.25 + rnd() * 0.06, 0.4 + rnd() * 0.12, 0.12 + rnd() * 0.06)),
  });

  K.clouds({ y: 320, color: '#ffffff', alpha: 0.45, blobs: 16, speed: 1 });
}

export default {
  base: 'forest',
  env: {
    sky: { top: '#2f6fd1', horizon: '#cfe1ee', bottom: '#93ab8e' },
    fog: { color: '#cfe0ec', near: 260, far: 2300 },
    sun: { dir: [-0.45, 0.62, 0.5], color: '#fff1da', intensity: 2.4 },
    hemi: { sky: '#cfe4ff', ground: '#4a6a36', intensity: 0.8 },
    exposure: 0.98,
    envIntensity: 0.4,
    terrain: { base: '#44792f', hills: 12, rim: 60, rimColor: '#a9c29a', height, paint: paintGrass('#44792f', ['38,86,30', '78,116,48', '58,104,40', '110,132,66'], ['#fff6d8', '#f4a3c0']) },
  },
  baseBuild: false,
  build,
};
