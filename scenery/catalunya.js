// Circuit de Barcelona-Catalunya: dry Mediterranean hills with umbrella pines, scrub and cypresses, terracotta-roofed
// farmhouses and a hillside village, long grandstands down the main straight and around the stadium section,
// white pit building with a control tower, and the jagged Montserrat massif on the western horizon (its real bearing).
import * as THREE from 'three';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, seeded, smooth, TAU } = await import(`./shanghai.js${new URL(import.meta.url).search}`);

const CX = -276, CZ = 62;   // course centre (bounds midpoint)
// rolling hills beyond a flat circuit platform; higher towards the north, open plain to the west (towards Montserrat)
const hillsAt = (x, z) => {
  const dx = x - CX, dz = z - CZ, r = Math.hypot(dx, dz), ang = Math.atan2(dx, -dz);
  const n = 0.5 + 0.5 * Math.sin(x * 0.0065 + 1.1) * Math.cos(z * 0.0072 - 0.6), n2 = 0.5 + 0.5 * Math.sin(x * 0.017 - z * 0.013 + 2.3);
  const north = smooth(-150, -900, dz), west = smooth(-300, -950, dx);
  const ridge = smooth(820, 1220, r) * (75 + 95 * north + 25 * Math.sin(ang * 3 + 0.8));
  return (n * 26 + n2 * 9 + north * 25) * (1 - 0.5 * west) + ridge * (1 - 0.6 * west);
};

function paintDry(g, w, h) {
  const img = g.createImageData(w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26; d[i] = 176 + n; d[i + 1] = 160 + n; d[i + 2] = 106 + n * 0.8; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 14 + Math.random() * 30;
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, Math.random() < 0.55 ? 'rgba(120,130,70,0.3)' : 'rgba(205,180,120,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    }
  }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${120 + Math.random() * 50},${125 + Math.random() * 40},${60 + Math.random() * 30},0.6)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3); }
  for (let i = 0; i < 70; i++) { g.fillStyle = Math.random() < 0.6 ? 'rgba(80,95,50,0.8)' : 'rgba(160,95,60,0.6)'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 0, TAU); g.fill(); }
}

// white concrete pit front: tinted ribbon window between fins, red band, garage doors
function paintPitFront(g, w, h) {
  g.fillStyle = '#ecebe6'; g.fillRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, h * 0.1, 0, h * 0.4);
  gr.addColorStop(0, '#4d5a6b'); gr.addColorStop(1, '#27303b');
  g.fillStyle = gr; g.fillRect(0, h * 0.1, w, h * 0.3);
  g.fillStyle = 'rgba(190,210,230,0.18)'; for (let i = 0; i < 6; i++) g.fillRect(Math.random() * w, h * 0.1, 10 + Math.random() * 30, h * 0.3);
  g.fillStyle = '#dcdad3'; for (let x = 0; x < w; x += 32) g.fillRect(x, h * 0.08, 6, h * 0.34);
  g.fillStyle = '#c8102e'; g.fillRect(0, h * 0.5, w, 6);
  for (let k = 0; k < 2; k++) {
    const x = k * w / 2 + 14;
    g.fillStyle = '#48505c'; g.fillRect(x, h * 0.62, w / 2 - 28, h * 0.38);
    g.fillStyle = 'rgba(0,0,0,0.3)'; for (let y = h * 0.62; y < h; y += 5) g.fillRect(x, y, w / 2 - 28, 1);
  }
}

const env = {
  sky: { top: '#2a68d2', horizon: '#bdd6ee', bottom: '#b3a78a' },
  fog: { color: '#c3d7ea', near: 380, far: 2400 },
  sun: { dir: [-0.5, 0.7, 0.5], color: '#fff3dc', intensity: 3.0 },
  hemi: { sky: '#cfe2ff', ground: '#8a7a55', intensity: 0.78 },
  envIntensity: 0.45,
  exposure: 1.0,
  terrain: { base: '#b0a06a', paint: paintDry, hills: 0, rim: 0, rimColor: '#6c7446', height: (x, z, y, dist) => y + hillsAt(x, z) * smooth(75, 280, dist) },
  road: { base: '#3b3e44', line: '#f1f1ec', edge: '#f1f1ec' },
  shoulder: '#9b917c',
  barrier: 'ads',
  curb: ['#d7263d', '#f4f4f4'],
};

// Montserrat: a massif crowned by rounded rock fingers, hazy blue-grey, in metres (1320 x 330)
function paintMontserrat(g, w, h) {
  const G = 330, rnd = seeded(4242);
  g.save(); g.scale(w / 1320, h / G);
  // far ranges behind
  g.fillStyle = '#a9b8c9'; g.beginPath(); g.moveTo(0, G);
  for (let x = 0; x <= 1320; x += 10) g.lineTo(x, G - 40 - 26 * Math.sin(x * 0.009 + 1) - 14 * Math.sin(x * 0.031));
  g.lineTo(1320, G); g.fill();
  const env = x => Math.exp(-(((x - 560) / 170) ** 2)) + 0.8 * Math.exp(-(((x - 810) / 130) ** 2)) + 0.45 * Math.exp(-(((x - 360) / 100) ** 2));
  const body = x => 36 + 175 * Math.min(1, env(x) * 1.1) + 6 * Math.sin(x * 0.05);
  // massif body with vertical creases
  g.fillStyle = '#7d8a9e'; g.beginPath(); g.moveTo(170, G);
  for (let x = 170; x <= 1090; x += 6) g.lineTo(x, G - body(x) + 6);
  g.lineTo(1090, G); g.fill();
  // crest of bulbous rock pinnacles sitting on the body
  for (let x = 220; x < 1040;) {
    const e = env(x), fw = 16 + rnd() * 30, cxm = x + fw / 2;
    if (e > 0.1) {
      const top = body(cxm) + (4 + rnd() * rnd() * 46) * Math.min(1, e * 1.6), base = body(cxm) - 45, r = fw / 2, ry = r * 1.35;
      const c = 116 + rnd() * 28 | 0;
      g.fillStyle = `rgb(${c},${c + 10},${c + 25})`;   // bulbous pinnacle, flanks flaring out towards the massif
      g.beginPath(); g.moveTo(x - fw * 0.2, G - base); g.lineTo(x + fw * 0.04, G - top + ry); g.ellipse(cxm, G - top + ry, r * 0.96, ry, 0, Math.PI, 0); g.lineTo(x + fw * 1.2, G - base); g.fill();
      g.fillStyle = 'rgba(232,238,246,0.2)'; g.beginPath(); g.ellipse(cxm - r * 0.3, G - top + ry * 0.95, r * 0.5, ry * 0.8, 0, Math.PI, 0); g.fill();   // sunlit cap
    }
    x += fw * (0.5 + rnd() * 0.35);
  }
  g.strokeStyle = 'rgba(60,70,90,0.16)'; g.lineWidth = 2;   // gullies down the face
  for (let k = 0; k < 50; k++) {
    const x = 200 + rnd() * 860, t = G - body(x) + 14 + rnd() * 20;
    g.beginPath(); g.moveTo(x, t); g.quadraticCurveTo(x + (rnd() - 0.5) * 20, t + 40, x + (rnd() - 0.5) * 30, t + 60 + rnd() * 60); g.stroke();
  }
  g.restore();
  const gr = g.createLinearGradient(0, h, 0, h * 0.6);   // haze at the foot
  gr.addColorStop(0, 'rgba(195,215,234,1)'); gr.addColorStop(0.3, 'rgba(195,215,234,0.5)'); gr.addColorStop(1, 'rgba(195,215,234,0)');
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}

function build(api) {
  const K = kit(api), { N, WALL, wrap, at, yawAt, part, statics, ok, cx, cz } = K;
  const rnd = seeded(8812);
  const R = (a, b) => a + rnd() * (b - a);
  const gy = (x, z) => api.groundAt(x, z);

  // ---- main straight: pit building + paddock (right / NW), grandstands the whole way down the left
  const pitMat = new THREE.MeshStandardMaterial({ map: api.canvasTex(256, 256, paintPitFront), roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide });
  const P0 = 1128, pr = K.pits(P0, 112, 1, pitMat, { height: 11, depth: 16, apron: 40, body: '#eef0f2', trim: '#c8102e', sign: 'BARCELONA  バルセロナ' });
  // race control tower at the start line
  {
    const [x, , z] = at(20, WALL + 30), ry = yawAt(20);
    statics.push(part(new THREE.BoxGeometry(9, 26, 9), '#eceae4', x, 13 - 1, z, ry));
    statics.push(part(new THREE.BoxGeometry(13, 5, 13), '#3a4656', x, 26.5, z, ry));   // tinted glass cab
    statics.push(part(new THREE.BoxGeometry(14, 0.8, 14), '#c8102e', x, 29.4, z, ry));
    api.block(x, z, 10);
  }
  // hospitality units behind the paddock
  for (let i = P0 + 14, k = 0; k < 5; i += 30, k++) {
    if (!K.inRuns(pr, wrap(i))) continue;
    const [x, , z] = at(i, WALL + 54), ry = yawAt(i);
    statics.push(part(new THREE.BoxGeometry(12, 7, 22), k % 2 ? '#f3f3f1' : '#e3e7ec', x, 2.5, z, ry));
    statics.push(part(new THREE.BoxGeometry(12.6, 0.5, 22.6), '#555b66', x, 6.2, z, ry));
  }
  K.stand(1116, 116, -1, { depth: 30, height: 14, roof: true, roofH: 6, fascia: '#1d3a8a', seat: '#2b4c8c' });
  K.stand(126, 204, -1, { depth: 24, height: 12, roof: true, fascia: '#c8102e' });   // run to T1 + T1 outside

  // ---- grandstands at the outside of the other big corners
  K.stand(238, 312, -1, { depth: 22, height: 11 });                                   // T3 (long right)
  K.stand(392, 452, -1, { depth: 18, height: 9 });                                    // T4
  K.stand(512, 542, 1, { depth: 16, height: 8 });                                     // T5 (left)
  K.stand(858, 906, 1, { depth: 22, height: 11, roof: true, fascia: '#f2b705' });     // T10 hairpin (left)
  K.stand(1012, 1108, -1, { depth: 26, height: 13, roof: true, fascia: '#1d3a8a' });  // stadium section

  // ---- terracotta: a hillside village (SSW), a town on the northern hills, scattered farmhouses, bell towers
  const walls = ['#eadfc6', '#e2cfa6', '#f1e9d8', '#d8c19a', '#efe3c9'], roofs = ['#b5532f', '#c0643a', '#a8492a', '#b95d34'];
  const homes = [], cyp = [];
  const church = (x, z) => {   // bell tower + nave
    const y = gy(x, z);
    statics.push(part(new THREE.BoxGeometry(6, 26, 6), '#e2cfa6', x, y + 11, z), part(new THREE.ConeGeometry(4.6, 5, 4).rotateY(Math.PI / 4), '#a8492a', x, y + 26.5, z));
    statics.push(part(new THREE.BoxGeometry(18, 10, 10), '#e8dcc0', x + 11, y + 3, z), part(new THREE.CylinderGeometry(0.01, 8, 4, 4).rotateY(Math.PI / 4).scale(1.6, 1, 0.9), '#b5532f', x + 11, y + 10, z));
    api.block(x + 5, z, 16);
  };
  const cluster = (vx, vz, n, rx, rz, bell) => {
    if (bell && ok(vx + 5, vz, 16, true)) church(vx, vz);
    for (let k = 0, t = 0; k < n && t < 400; t++) {
      const x = vx + R(-rx, rx), z = vz + R(-rz, rz);
      if (!ok(x, z, 8, true)) continue;
      homes.push([x, gy(x, z) - 0.3, z, R(0.8, 1.2), R(0.9, 1.6), R(-0.25, 0.25) + (rnd() < 0.5 ? 0 : Math.PI / 2), walls[rnd() * 5 | 0], roofs[rnd() * 4 | 0]]);
      api.block(x, z, 8);
      k++;
    }
  };
  cluster(-470, 930, 70, 170, 110, true);
  cluster(-120, -830, 60, 220, 90, true);
  cluster(-1050, 150, 30, 90, 140, false);
  for (let t = 0; t < 3000 && homes.length < 200; t++) {   // masias: farmhouse + cypresses
    const x = cx + R(-1150, 1150), z = cz + R(-1150, 1150), d = api.near(x, z)[0];
    if (d < 140 || !ok(x, z, 14, true)) continue;
    const y = gy(x, z), ry = rnd() * TAU;
    homes.push([x, y - 0.3, z, R(1.1, 1.4), R(1, 1.4), ry, walls[rnd() * 5 | 0], roofs[rnd() * 4 | 0]]);
    for (let c = 0; c < 3; c++) { const a = ry + R(-1, 1) + (c % 2) * Math.PI, xx = x + Math.sin(a) * 11, zz = z + Math.cos(a) * 11; cyp.push([xx, gy(xx, zz) - 0.2, zz, R(0.8, 1.2), R(0.9, 1.3), 0, '#e6ece0']); }
    api.block(x, z, 14);
  }
  K.houses(homes);

  // ---- vegetation: umbrella-pine groves, scrub (maquis), olive rows, cypresses
  const pines = [], scrub = [], olives = [];
  const grove = (x, z) => Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.012 - 1.1) + 0.6 * Math.sin(x * 0.025 - z * 0.02 + 2);
  const tint = (h0, s0, l0) => new THREE.Color().setHSL(h0 + rnd() * 0.05, s0 + rnd() * 0.15, l0 + rnd() * 0.12);
  for (let t = 0; t < 40000 && pines.length < 850; t++) {
    const x = cx + R(-1200, 1200), z = cz + R(-1200, 1200), gv = grove(x, z);
    if (rnd() > 0.05 + 0.95 * smooth(0.0, 0.8, gv)) continue;
    const d = api.near(x, z)[0];
    if (d > 350 && rnd() < 0.5) continue;
    if (!ok(x, z, 4, true)) continue;
    pines.push([x, gy(x, z) - 0.3, z, R(0.8, 1.25), R(0.85, 1.25), rnd() * TAU, tint(0.22, 0.2, 0.5)]);
  }
  for (let t = 0; t < 20000 && scrub.length < 1600; t++) {
    const [x, , z] = rnd() < 0.5 ? at(rnd() * N, (rnd() < 0.5 ? 1 : -1) * (WALL + R(5, 70))) : [cx + R(-1200, 1200), 0, cz + R(-1200, 1200)];
    if (!ok(x, z, 1.4)) continue;
    const s = R(0.9, 2.4);
    scrub.push([x, gy(x, z) - 0.2, z, s, s * R(0.6, 1), rnd() * TAU, tint(0.17, 0.2, 0.42)]);
  }
  for (let t = 0; t < 12000 && scrub.length < 2600; t++) {   // maquis patches on the far hillsides
    const x = cx + R(-1300, 1300), z = cz + R(-1300, 1300);
    if (grove(x, z) < -0.2 || api.near(x, z)[0] < 250 || !ok(x, z, 4)) continue;
    const s = R(2.5, 5);
    scrub.push([x, gy(x, z) - 0.5, z, s, s * R(0.4, 0.7), rnd() * TAU, tint(0.2, 0.25, 0.3)]);
  }
  for (let o = 0; o < 10; o++) {   // olive groves: rows on the lower slopes
    const ox = cx + R(-1000, 1000), oz = cz + R(-1000, 1000), a = rnd() * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
    if (api.near(ox, oz)[0] < 110) continue;
    for (let r = 0; r < 7; r++) for (let c = 0; c < 10; c++) {
      const u = (c - 4.5) * 9, v = (r - 3) * 9, x = ox + u * ca - v * sa, z = oz + u * sa + v * ca;
      if (!ok(x, z, 2.5)) continue;
      olives.push([x, gy(x, z) - 0.2, z, R(0.8, 1.1), R(0.8, 1.1), rnd() * TAU, tint(0.2, 0.08, 0.62)]);
    }
  }
  for (let t = 0; t < 1500 && cyp.length < 260; t++) {   // cypress lines along the paddock and roads
    const [x, , z] = at(rnd() * N, (rnd() < 0.5 ? 1 : -1) * (WALL + R(14, 60)));
    if (!ok(x, z, 2, true)) continue;
    cyp.push([x, gy(x, z) - 0.2, z, R(0.8, 1.15), R(0.9, 1.3), 0, '#e6ece0']);
  }
  K.trees('umbrella', pines);
  K.trees('bush', scrub);
  K.trees('olive', olives);
  K.trees('cypress', cyp);

  // ---- sky: Montserrat to the west (bearing ~272 deg), a few fair-weather clouds
  K.band(paintMontserrat, 272, 40, 1750, 360, { y: -10 });
  K.cloudDeck(rnd, { alpha: 0.5, count: 12, y: 300 });

  K.flush();
}

export default { base: 'desert', env, baseBuild: false, build };
