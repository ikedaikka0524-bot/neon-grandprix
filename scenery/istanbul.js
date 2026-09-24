// Istanbul Park: rolling dry-grass hills around a flat circuit basin, the huge main grandstand opposite the pits,
// a tall modern tower behind the paddock, big stands at the multi-apex turn 8, red-roofed villages and white apartment
// blocks on the hills, and a mosque (domes + minarets, generic) on a hilltop to the WNW, towards the city.
import * as THREE from 'three';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, seeded, smooth, TAU, paintPits, paintGlass } = await import(`./shanghai.js${new URL(import.meta.url).search}`);

const CX = 216, CZ = -557;                 // course centre (bounds midpoint)
const MOSQUE = [-860, -820];               // hilltop, bearing ~290 deg from the centre
const hillsAt = (x, z) => {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz), ang = Math.atan2(dx, -dz);
  const n = 0.5 + 0.5 * Math.sin(x * 0.0075 + 0.3) * Math.cos(z * 0.0068 + 1.2), n2 = 0.5 + 0.5 * Math.sin(x * 0.019 + z * 0.015 + 0.7);
  const ridge = smooth(950, 1450, r) * (75 + 30 * Math.sin(ang * 2 + 0.5));
  const hill = 80 * Math.exp(-((x - MOSQUE[0]) ** 2 + (z - MOSQUE[1]) ** 2) / 260 ** 2);
  return n * 40 + n2 * 11 + ridge + hill;
};

function paintGrass(g, w, h) {
  const img = g.createImageData(w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 24; d[i] = 196 + n; d[i + 1] = 172 + n; d[i + 2] = 112 + n * 0.7; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 16 + Math.random() * 32;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, Math.random() < 0.5 ? 'rgba(150,150,80,0.28)' : 'rgba(222,196,130,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${150 + Math.random() * 70},${130 + Math.random() * 50},${70 + Math.random() * 30},0.55)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 4); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(95,100,55,0.7)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.5, 0, TAU); g.fill(); }
}
function paintFlats(g, w, h) {
  g.fillStyle = '#efece4'; g.fillRect(0, 0, w, h);
  for (let y = 5; y < h; y += 16) {
    g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y + 11, w, 2);
    for (let x = 3; x < w; x += 16) { g.fillStyle = Math.random() < 0.75 ? '#6b7c8f' : '#a9bccc'; g.fillRect(x, y, 10, 8); }
  }
}

const env = {
  sky: { top: '#3674d6', horizon: '#c7dbee', bottom: '#b9a77e' },
  fog: { color: '#cbdcec', near: 600, far: 3200 },
  sun: { dir: [-0.32, 0.74, 0.6], color: '#fff2da', intensity: 3.0 },
  hemi: { sky: '#d4e4f7', ground: '#9a8456', intensity: 0.8 },
  envIntensity: 0.45,
  exposure: 1.0,
  terrain: { base: '#c4ad74', paint: paintGrass, hills: 0, rim: 0, rimColor: '#8f8a58', height: (x, z, y, dist) => y + hillsAt(x, z) * smooth(70, 300, dist) },
  road: { base: '#3b3e44', line: '#f1f1ec', edge: '#f1f1ec' },
  shoulder: '#a39a82',
  barrier: 'ads',
  curb: ['#d7263d', '#f4f4f4'],
};

function build(api) {
  const K = kit(api), { N, WALL, wrap, at, yawAt, part, tpart, statics, addT, ok, cx, cz } = K;
  const rnd = seeded(5290);
  const R = (a, b) => a + rnd() * (b - a);
  const gy = (x, z) => api.groundAt(x, z);
  const cyp = [];
  const glassMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(256, 256, paintGlass), roughness: 0.18, metalness: 0.55 });
  const pitMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(256, 256, paintPits), color: '#e4e8ee', roughness: 0.3, metalness: 0.3, side: THREE.DoubleSide });

  // ---- main straight: huge grandstand on the right (south), pits + paddock on the left (inside of the lap)
  K.stand(1118, 34, 1, { depth: 38, height: 17, roof: true, roofH: 7, fascia: '#c8102e', seat: '#b3202a' });
  const P0 = 1120, pr = K.pits(P0, 36, -1, pitMat, { height: 12, depth: 20, apron: 40, trim: '#c8102e', sign: 'ISTANBUL  イスタンブール' });
  // the tower behind the paddock: tapered shaft, glass pod, mast
  {
    const [x, , z] = at(8, -(WALL + 78)), y = gy(x, z);
    statics.push(part(new THREE.CylinderGeometry(3, 4.6, 72, 12), '#e8eaee', x, y + 34, z));
    addT(glassMat, tpart(new THREE.CylinderGeometry(9.5, 6.5, 9, 16), x, y + 66, z));
    statics.push(part(new THREE.CylinderGeometry(10.2, 10.2, 0.8, 16), '#f4f5f7', x, y + 71, z), part(new THREE.CylinderGeometry(0.35, 0.35, 16, 6), '#c8102e', x, y + 79, z));
    api.block(x, z, 14);
  }
  // paddock buildings
  for (let k = 0; k < 6; k++) {
    const i = P0 + 12 + k * 26, [x, , z] = at(i, -(WALL + 56)), ry = yawAt(i);
    if (!K.inRuns(pr, wrap(i))) continue;
    addT(glassMat, tpart(new THREE.BoxGeometry(14, 8, 24), x, 3, z, ry));
    statics.push(part(new THREE.BoxGeometry(15, 0.6, 25), '#f2f3f5', x, 7.3, z, ry));
  }

  // ---- other grandstands (outside of the big corners)
  K.stand(46, 90, 1, { depth: 24, height: 12, roof: true, fascia: '#c8102e' });   // T1
  K.stand(522, 612, 1, { depth: 28, height: 13, roof: true, fascia: '#1d4fa0' }); // turn 8
  K.stand(408, 442, -1, { depth: 18, height: 9 });                               // hairpin
  K.stand(1038, 1066, 1, { depth: 20, height: 10 });                             // final chicane
  K.stand(900, 960, 1, { depth: 14, height: 7 });                                // back straight

  // ---- mosque on the WNW hilltop: prayer hall, big central dome, semi-domes, small domes, four minarets
  {
    const [mx, mz] = MOSQUE, y = gy(mx, mz) - 1, stone = '#dcd6c9', lead = '#8f969f', S = 2.4;   // exaggerated so it reads from the track
    const P = (geo, c, x, yy, z) => statics.push(part(geo.scale(S, S, S), c, mx + x * S, y + yy * S, mz + z * S));
    P(new THREE.BoxGeometry(36, 16, 36), stone, 0, 8, 0);
    P(new THREE.CylinderGeometry(12, 12.5, 5, 20), stone, 0, 18.5, 0);
    P(new THREE.SphereGeometry(12, 20, 10, 0, TAU, 0, Math.PI / 2), lead, 0, 21, 0);
    P(new THREE.ConeGeometry(0.5, 4, 6), '#c9b26a', 0, 34.5, 0);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) P(new THREE.SphereGeometry(8, 14, 6, 0, TAU, 0, Math.PI / 2), lead, a * 13, 15.5, b * 13);
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) P(new THREE.SphereGeometry(4.5, 10, 5, 0, TAU, 0, Math.PI / 2), lead, a * 13, 16, b * 13);
    P(new THREE.BoxGeometry(40, 7, 22), stone, 0, 3.5, 29);   // courtyard arcade
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const x = a * 23, z = b * 23;
      P(new THREE.CylinderGeometry(1.5, 1.7, 44, 10), stone, x, 22, z);
      P(new THREE.CylinderGeometry(2.4, 2.4, 1, 10), stone, x, 30, z);
      P(new THREE.CylinderGeometry(2.2, 2.2, 1, 10), stone, x, 38, z);
      P(new THREE.ConeGeometry(1.6, 9, 10), lead, x, 48.5, z);
    }
    api.block(mx, mz, 80);
    for (let k = 0; k < 24; k++) {   // cypresses around it
      const a = rnd() * TAU, r = R(85, 140), x = mx + Math.cos(a) * r, z = mz + Math.sin(a) * r;
      if (ok(x, z, 2)) cyp.push([x, gy(x, z) - 0.3, z, R(0.9, 1.3), R(1, 1.4), 0, '#e6ece0']);
    }
  }

  // ---- red-roofed villages and white apartment blocks on the hills
  const homes = [];
  for (const [vx, vz, n, rx, rz] of [[-820, -560, 50, 140, 160], [620, 150, 45, 180, 110], [1250, -980, 30, 110, 150], [-150, -1350, 30, 170, 90]]) {
    for (let k = 0, t = 0; k < n && t < 300; t++) {
      const x = vx + R(-rx, rx), z = vz + R(-rz, rz);
      if (!ok(x, z, 8, true)) continue;
      homes.push([x, gy(x, z) - 0.3, z, R(0.8, 1.2), R(0.9, 1.5), R(-0.3, 0.3) + (rnd() < 0.5 ? 0 : Math.PI / 2), rnd() < 0.7 ? '#f1ede3' : '#e6d6b8', rnd() < 0.8 ? '#b8452f' : '#9c3b2a']);
      api.block(x, z, 8);
      k++;
    }
  }
  K.houses(homes);
  const flats = [];
  for (const [bx, bz, n] of [[900, 300, 14], [-600, -1250, 12], [1350, -400, 10], [-1000, 150, 10]]) {
    for (let k = 0, t = 0; k < n && t < 200; t++) {
      const x = bx + R(-160, 160), z = bz + R(-120, 120);
      if (!ok(x, z, 20, true)) continue;
      flats.push([x, gy(x, z) - 2, z, 1, R(1, 2.2), rnd() * Math.PI, rnd() < 0.6 ? '#f4f1ea' : '#e9dcc6']);
      api.block(x, z, 20);
      k++;
    }
  }
  K.inst(new THREE.BoxGeometry(22, 24, 16).translate(0, 12, 0), new THREE.MeshStandardMaterial({ map: api.canvasTex(128, 128, paintFlats), roughness: 0.8 }), flats);
  const roofs = flats.map(q => [q[0], q[1] + 24 * q[4], q[2], 1, 1, q[5], '#8a8f96']);
  K.inst(new THREE.BoxGeometry(23, 1, 17), new THREE.MeshStandardMaterial({ roughness: 0.9 }), roofs, false);

  // ---- vegetation: oak scrub, pine plantations on the hills, poplars and cypresses, dry shrubs
  const oaks = [], pines = [], shrubs = [];
  const grove = (x, z) => Math.sin(x * 0.0105 - 0.7) * Math.cos(z * 0.0125 + 0.4) + 0.5 * Math.sin(x * 0.023 + z * 0.019 + 1.3);
  const tint = (h0, s0, l0) => new THREE.Color().setHSL(h0 + rnd() * 0.05, s0 + rnd() * 0.15, l0 + rnd() * 0.12);
  for (let t = 0; t < 30000 && pines.length < 700; t++) {   // pine plantations on the far slopes
    const x = cx + R(-1500, 1500), z = cz + R(-1500, 1500);
    if (grove(x, z) < 0.55 || api.near(x, z)[0] < 180 || !ok(x, z, 3, true)) continue;
    pines.push([x, gy(x, z) - 0.3, z, R(0.7, 1.05), R(0.7, 1), rnd() * TAU, tint(0.3, 0.2, 0.36)]);
  }
  for (let t = 0; t < 30000 && oaks.length < 700; t++) {
    const x = cx + R(-1500, 1500), z = cz + R(-1500, 1500), d = api.near(x, z)[0];
    if ((grove(x, z) < 0.1 && rnd() > 0.1) || (d > 400 && rnd() < 0.5) || !ok(x, z, 3, true)) continue;
    oaks.push([x, gy(x, z) - 0.3, z, R(0.7, 1.2), R(0.8, 1.2), rnd() * TAU, tint(0.2, 0.15, 0.5)]);
  }
  for (let t = 0; t < 20000 && shrubs.length < 1800; t++) {
    const [x, , z] = rnd() < 0.5 ? at(rnd() * N, (rnd() < 0.5 ? 1 : -1) * (WALL + R(5, 80))) : [cx + R(-1500, 1500), 0, cz + R(-1500, 1500)];
    if (!ok(x, z, 1.4)) continue;
    const s = R(0.8, 2.6);
    shrubs.push([x, gy(x, z) - 0.2, z, s, s * R(0.5, 0.9), rnd() * TAU, tint(0.14, 0.2, 0.42)]);
  }
  for (let t = 0; t < 2000 && cyp.length < 300; t++) {   // poplar / cypress lines near the paddock and along the lap
    const [x, , z] = at(rnd() * N, (rnd() < 0.5 ? 1 : -1) * (WALL + R(14, 70)));
    if (!ok(x, z, 2, true)) continue;
    cyp.push([x, gy(x, z) - 0.2, z, R(0.9, 1.3), R(1, 1.5), 0, rnd() < 0.5 ? '#e6ece0' : '#f4ffd8']);
  }
  K.trees('redwood', pines);
  K.trees('oak', oaks);
  K.trees('bush', shrubs);
  K.trees('cypress', cyp);

  K.cloudDeck(rnd, { alpha: 0.45, count: 14, y: 300 });
  K.flush();
}

export default { base: 'desert', env, baseBuild: false, build };
