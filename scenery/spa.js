// Spa-Francorchamps: the Ardennes on a damp, misty day. The flat course data runs through a valley of steep spruce
// hills (steepest around Eau Rouge / Raidillon), with the pit building and main grandstand on the start straight, a stand
// at La Source and one on the Raidillon hillside, the grey-stone village of Francorchamps north of La Source, an old
// stone farm at Stavelot, green meadows with cows and low mist in the forest.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit, course, pad, applyPads, paintGrass, paintStone, fbm, smooth, TAU } = await import(`./nring.js${new URL(import.meta.url).search}`);

const C = course('spa'), W2 = 7;
const ER = { x: 470, z: 290 };   // Eau Rouge / Raidillon
const VILLAGE = { x: 250, z: -210 };
const PADS = [
  pad(C.at(1170), C.at(34), W2 + 58),              // paddock: pits + main grandstand
  pad(C.at(41, -(W2 + 26)), C.at(41, -(W2 + 26)), 32),   // La Source stand
  pad(C.at(186, -(W2 + 25)), C.at(186, -(W2 + 25)), 38), // Raidillon stand
];
// meadows: [first sample, last sample, side (+1 right / -1 left)] -> open pasture from 28 to 150 m beside the track
const MEADOWS = [[250, 310, 1], [690, 740, -1], [1030, 1080, 1]];

const meadow = (x, z) => {   // 0..1 inside a meadow zone (gentler slopes there)
  const i = C.nearest(x, z);
  return MEADOWS.some(([i0, i1, sg]) => { const p = C.at(i); return i >= i0 - 6 && i <= i1 + 6 && Math.sign((x - p.x) * -p.tz + (z - p.z) * p.tx) === sg; }) ? 1 : 0;
};
function height(x, z, y, dist) {
  const er = 1 - smooth(120, 420, Math.hypot(x - ER.x, z - ER.z));
  const amp = (42 + 55 * fbm(x / 330 + 4, z / 330 - 2) + 38 * er) * (1 - 0.6 * meadow(x, z));   // Ardennes ridges, steepest around Eau Rouge
  const start = W2 + 20 + 34 * C.inside(x, z) - 6 * er;                      // corner insides stay low for the chase camera
  y += amp * smooth(start, start + 150 - 40 * er, dist);
  return applyPads(PADS, x, z, y);
}

const paintStoneHouse = (g, w, h) => {   // 4 m x 3 m: grey Ardennes stone with one white-framed window
  paintStone(g, w, h, [128, 126, 120], 7);
  const wx = w * 0.32, wy = h * 0.2, ww = w * 0.36, wh = h * 0.46;
  g.fillStyle = '#e9e6de'; g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  g.fillStyle = '#2f3a42'; g.fillRect(wx, wy, ww, wh);
  g.fillStyle = '#e9e6de'; g.fillRect(wx + ww / 2 - 2, wy, 4, wh); g.fillRect(wx, wy + wh * 0.4, ww, 4);
  g.fillStyle = '#5b6770'; g.fillRect(wx - 8, wy + wh + 6, ww + 16, 6);   // sill
};
const paintCow = (g, w, h) => {   // white hide with dark patches
  g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#1d1b1a';
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    g.beginPath();
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU, r = 5 + Math.random() * 9; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.fill();
  }
};

function build(api) {
  const K = kit(api), { rnd, range, pick, S, N } = K;
  K.mat('stonehouse', new THREE.MeshStandardMaterial({ map: K.tex(256, 192, paintStoneHouse), vertexColors: true, roughness: 0.95 }));
  K.mat('stone', new THREE.MeshStandardMaterial({ map: K.tex(256, 256, (g, w, h) => paintStone(g, w, h, [132, 130, 124])), vertexColors: true, roughness: 0.95 }), 4);
  const sign = K.signs([['ARDENNES GP  アルデンヌ', '#12325e'], ['LA SOURCE  ラ・ソース', '#b3121f'], ['RAIDILLON  ライディヨン', '#1a1a1a', '#ffd23f'], ['PITS  ピット', '#12325e']]);

  // ---------------------------------------------------------------- paddock + the corner stands
  {
    const p = K.beside(4, W2 + 15, -0.2);
    if (K.claim(p, 200, 22)) K.pits(K.frame(p.x, p.y, p.z, p.ry), 200, { accent: '#f2c200', sign: sign(3) });
    const q = K.beside(10, -(W2 + 14), -0.2);
    if (K.claim(q, 120, 14)) {
      const put = K.frame(q.x, q.y, q.z, q.ry);
      K.grandstand(put, 120, { rows: 14, fascia: '#12325e' });
      put('sign', sign(0)(34, 3.2).translate(0, 13.6, -3.3));
    }
    for (const [i, lat, len, rows, k] of [[41, -(W2 + 17), 50, 10, 1], [186, -(W2 + 17), 64, 12, 2], [1164, W2 + 16, 50, 8, -1]]) {
      const s = K.beside(i, lat, -0.2);
      if (!K.claim(s, len, rows * 0.85 + 2)) continue;
      const put = K.frame(s.x, s.y, s.z, s.ry);
      K.grandstand(put, len, { rows, fascia: k === 2 ? '#ffd23f' : '#b3121f' });
      if (k >= 0) put('sign', sign(k)(30, 2.8).translate(0, rows * 0.48 + 7, -3.3));
    }
  }

  // ---------------------------------------------------------------- old stone buildings: Francorchamps village + Stavelot farm
  const house = (x, z, ry, w, d, storeys, roof = '#3b4048', wall = '#ffffff') => {
    const put = K.frame(x, api.groundAt(x, z), z, ry), h = storeys * 3;
    put('stone', K.box(w + 0.3, 4, d + 0.3, 0, -3.8, 0), '#9d9a92');                       // plinth for the slope
    put('stonehouse', K.facade(w, h, d, 4, 3).translate(0, 0.2, 0), wall);
    const rh = w * 0.62;
    put('solid', K.gable(w + 1, rh, d + 0.8).translate(0, h + 0.2, 0), roof);              // slate
    put('solid', K.box(0.8, 1.8, 0.8, -w * 0.25, h + rh * 0.45, d * 0.3), '#6f6a64');
  };
  {
    let n = 0;
    for (let t = 0; t < 900 && n < 24; t++) {
      const a = rnd() * TAU, r = 20 + rnd() * 190, x = VILLAGE.x + Math.sin(a) * r, z = VILLAGE.z + Math.cos(a) * r;
      const w = range(7, 10), d = range(8, 12), rad = Math.max(w, d) * 0.75 + 2;
      const [dd, i] = K.nearI(x, z);
      if (dd < W2 + 35 || !K.tallOk(x, z, dd, i, 45) || !api.isFree(x, z, rad + 1)) continue;
      const slope = Math.abs(api.groundAt(x + 5, z) - api.groundAt(x - 5, z)) + Math.abs(api.groundAt(x, z + 5) - api.groundAt(x, z - 5));
      if (slope > 7) continue;
      api.block(x, z, rad);
      house(x, z, Math.atan2(x - VILLAGE.x, z - VILLAGE.z) + (rnd() - 0.5) * 0.4, w, d, rnd() < 0.6 ? 2 : 3, pick(['#3b4048', '#454a52', '#35393f']), pick(['#ffffff', '#ffffff', '#f3efe6', '#e8e4dc']));
      n++;
    }
    // village church: stone nave, square tower with a tall slate spire
    for (let t = 0; t < 40; t++) {
      const x = VILLAGE.x + (rnd() - 0.5) * 120, z = VILLAGE.z + (rnd() - 0.5) * 120;
      if (!api.isFree(x, z, 18) || K.nearI(x, z)[0] < W2 + 60) continue;
      api.block(x, z, 18);
      const ry = rnd() * TAU, put = K.frame(x, api.groundAt(x, z), z, ry);
      put('stone', K.box(11, 13, 24, 0, -4, 0), '#b9b5ac');
      put('solid', K.gable(12, 6, 25).translate(0, 9, 0), '#3b4048');
      put('stone', K.box(6.5, 24, 6.5, 0, -4, -14), '#b9b5ac');
      put('solid', K.cone(4.6, 16, 8, 0, 20, -14), '#353a41');
      put('solid', K.box(0.3, 3, 0.3, 0, 36, -14), '#c9a227');
      break;
    }
    // Stavelot: an old stone farm (house, barn, shed) outside the corner
    for (const [i, lat] of [[836, -75], [836, 75], [870, -80]]) {
      const b = K.beside(i, lat);
      if (!api.isFree(b.x, b.z, 30)) continue;
      api.block(b.x, b.z, 30);
      house(b.x, b.z, b.ry, 9, 12, 2, '#3b4048');
      const put = K.frame(b.x, b.y, b.z, b.ry);
      put('stone', K.box(14, 6, 22, 18, -3, 4), '#a7a298');
      put('solid', K.gable(15, 6, 23).translate(18, 3, 4), '#4d4f54');
      put('solid', K.box(6, 4.5, 8, -14, -1, 10), '#6b4f3a');
      put('solid', K.gable(6.8, 2.4, 8.8).translate(-14, 3.5, 10), '#3b4048');
      break;
    }
  }

  // ---------------------------------------------------------------- meadows: fences along the road side, cows grazing
  const inMeadow = [];
  {
    const posts = [], cows = [], dm = new THREE.Object3D(), tint = new THREE.Color();
    for (const [i0, i1, sg] of MEADOWS) {
      for (let i = i0; i <= i1; i += 2) {   // fence line at 26 m
        const p = K.beside(i, sg * (W2 + 26));
        if (!api.isFree(p.x, p.z, 0)) continue;
        dm.position.set(p.x, p.y - 0.2, p.z); dm.rotation.set(0, p.ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix();
        posts.push([dm.matrix.clone()]);
      }
      let n = 0;
      for (let t = 0; t < 200 && n < 13; t++) {
        const i = Math.round(i0 + rnd() * (i1 - i0)), p = K.beside(i, sg * (W2 + 32 + rnd() * rnd() * 110));
        if (!api.isFree(p.x, p.z, 2)) continue;
        dm.position.set(p.x, p.y, p.z); dm.rotation.set(0, rnd() * TAU, 0); const s = 0.9 + rnd() * 0.2; dm.scale.set(s, s, s); dm.updateMatrix();
        cows.push([dm.matrix.clone(), tint.set(rnd() < 0.6 ? '#ffffff' : rnd() < 0.5 ? '#c98a5a' : '#8e8a86').clone()]);
        n++;
      }
      inMeadow.push([i0, i1, sg]);
    }
    const rail = mergeGeometries([new THREE.BoxGeometry(0.14, 1.3, 0.14).translate(0, 0.65, 0), new THREE.BoxGeometry(11.5, 0.1, 0.06).translate(0, 1.05, 0), new THREE.BoxGeometry(11.5, 0.1, 0.06).translate(0, 0.6, 0)]);
    for (const m of K.instanced(rail, new THREE.MeshStandardMaterial({ color: 0x7a5c40, roughness: 0.9 }), posts, { shadow: false })) m.userData.keepCount = true;   // a thinned fence shows gaps
    const cowGeo = mergeGeometries([
      new THREE.BoxGeometry(0.9, 0.85, 2).translate(0, 1.15, 0), new THREE.BoxGeometry(0.5, 0.5, 0.6).translate(0, 1.35, 1.25),
      ...[[-0.3, -0.7], [0.3, -0.7], [-0.3, 0.7], [0.3, 0.7]].map(([x, z]) => new THREE.BoxGeometry(0.18, 0.75, 0.18).translate(x, 0.37, z)),
    ]);
    K.instanced(cowGeo, new THREE.MeshStandardMaterial({ map: K.tex(64, 64, paintCow), roughness: 0.85 }), cows, { shadow: true });
  }
  const meadowAt = (x, z, i) => {
    return inMeadow.some(([i0, i1, sg]) => {
      if (i < i0 - 4 || i > i1 + 4) return false;
      const s = S[i], lat = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
      return Math.sign(lat) === sg && Math.abs(lat) < W2 + 175;
    });
  };

  K.flush();

  // ---------------------------------------------------------------- the Ardennes forest: dense tall spruce, a few beech
  const tc = new THREE.Color();
  K.trees({
    n: 17000, pad: 560, geos: [K.spruce(3, 5, 0.75), K.spruce(1, 5, 0.8, false), K.leafy(2), K.spruce(2, 5, 0.75, false)],
    density: (x, z, d, i) => (meadowAt(x, z, i) || Math.hypot(x - VILLAGE.x, z - VILLAGE.z) < 150 ? 0.02
      : (0.45 + 0.55 * smooth(0.25, 0.48, fbm(x / 170, z / 170))) * (d > 240 ? 0.35 : 1)),
    kind: (x, z, d) => (d > 190 ? 1 : fbm(x / 110 - 3, z / 110 + 8) > 0.72 ? 2 : d > W2 + 70 ? 3 : 0),   // detail drops with distance
    size: (x, z, d, k) => (k === 1 ? 2.1 + rnd() * 0.9 : k === 2 ? 1.2 + rnd() * 0.5 : 1.4 + rnd() * 0.9),
    color: (x, z, k) => (k === 2 ? tc.setHSL(0.26 + rnd() * 0.05, 0.35, 0.13 + rnd() * 0.05) : tc.setHSL(0.35 + rnd() * 0.05, 0.28 + rnd() * 0.14, 0.065 + rnd() * 0.04)),
  });

  // ---------------------------------------------------------------- mist banks hanging in the forest on the valley sides
  {
    const tex = K.tex(256, 64, (g, w, h) => {
      g.save(); g.scale(1, h / w);
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w); g.restore();
    }, false);
    const dm = new THREE.Object3D(), items = [];
    for (let t = 0; t < 400 && items.length < 60; t++) {
      const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? 1 : -1, w = 120 + rnd() * 160, b = K.beside(i, sg * (W2 + 70 + rnd() * 220));
      const ex = Math.cos(b.ry) * w / 2, ez = -Math.sin(b.ry) * w / 2;   // both ends of the bank stay clear of the road too
      if (K.nearI(b.x, b.z)[0] < W2 + 60 || K.nearI(b.x + ex, b.z + ez)[0] < W2 + 30 || K.nearI(b.x - ex, b.z - ez)[0] < W2 + 30) continue;
      dm.position.set(b.x, b.y + 4 + rnd() * 18, b.z); dm.rotation.set(0, b.ry, 0); dm.scale.set(w, w * (0.16 + rnd() * 0.1), 1); dm.updateMatrix();
      items.push([dm.matrix.clone()]);
    }
    const mist = K.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: 0xe6ebee, transparent: true, depthWrite: false, side: THREE.DoubleSide }), items, { shadow: false, cell: 900 });
    for (const m of mist) m.renderOrder = 2;
  }

  K.clouds({ y: 210, color: '#d9dee2', alpha: 0.9, blobs: 70, speed: 1.8 });
}

export default {
  base: 'forest',
  env: {
    sky: { top: '#7b8a96', horizon: '#cdd4d7', bottom: '#8a9688' },
    fog: { color: '#c4cbce', near: 70, far: 880 },
    sun: { dir: [0.35, 0.72, -0.45], color: '#e7e6df', intensity: 1.2 },
    hemi: { sky: '#d3dae0', ground: '#3a4a34', intensity: 1.05 },
    exposure: 1.0,
    envIntensity: 0.42,
    road: { base: '#34373b', roughness: 0.5 },   // damp asphalt
    shoulder: '#7d7a70',
    barrier: 'guardrail',
    terrain: { base: '#34522a', hills: 16, rim: 170, rimColor: '#a3b59a', height, paint: paintGrass('#34522a', ['36,60,28', '58,80,40', '46,72,34', '74,86,50'], ['#f3efe0']) },
  },
  baseBuild: false,
  build,
};
