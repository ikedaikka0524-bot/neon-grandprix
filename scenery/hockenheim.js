// Hockenheim: the stadium. A huge horseshoe of steep grandstands wraps the final sector (the motodrom) from the
// Sachs hairpin round the south curve and all along the start straight, with a tall tower behind the main stand
// and the pits opposite; everywhere else the lap runs through dense, flat pine forest.
import * as THREE from 'three';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit } = await import(`./monza.js${new URL(import.meta.url).search}`);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const CROWD = ['#1a1a1a', '#d00000', '#ffce00', '#c0c4c8', '#f4f4f4', '#d00000', '#1f4e9c', '#ff7a00', '#2b2b2b', '#e8e8e8', '#8a8f96'];
const STADIUM = [110, 60, 250];   // the motodrom: no forest inside this circle (x, z, r)

export default {
  base: 'forest',
  baseBuild: false,
  env: {
    sky: { top: '#2e69cb', horizon: '#cbdbe8', bottom: '#8fa98f' },
    fog: { color: '#cad9e5', near: 240, far: 1450 },
    sun: { dir: [-0.45, 0.66, 0.5], color: '#fff2da', intensity: 2.8 },   // summer afternoon, from the south-west
    hemi: { sky: '#d0e4ff', ground: '#3f5a33', intensity: 0.85 },
    envIntensity: 0.4,
    terrain: { base: '#4c8034', hills: 1.5, rim: 22, rimColor: '#2f4a2c' },
  },
  build(api) {
    const K = kit(api), T = THREE, { S, N, WALL, R } = K, rnd = api.rnd;
    K.crowdBucket(CROWD);
    const at = (i, lat) => { const s = S[K.wrapI(i)]; return [s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat]; };

    // ---- pits on the right of the start straight (the stadium infield)
    const PF = WALL + 12;
    K.texBucket('garage', api.canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#dfe2e6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#343b46'; g.fillRect(9, 24, w - 18, h - 24);
      for (let y = 26; y < h; y += 5) { g.fillStyle = '#262c35'; g.fillRect(9, y, w - 18, 1); }
      g.fillStyle = '#c1121f'; g.fillRect(0, 7, w, 7);
    }), { rough: 0.5, metal: 0.3 });
    K.texBucket('win', api.canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#e4e6e9'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#26394c'; g.fillRect(3, 8, w - 6, h - 16);
      g.fillStyle = 'rgba(170,205,235,0.35)'; g.fillRect(3, 8, w - 6, 10);
    }), { rough: 0.2, metal: 0.5 });
    K.clip(K.trackPath(1146, 1236, 1), WALL + 0.6, PF - 3, 0.2);   // keep the pit lane clear
    K.sweep(K.trackPath(1146, 1236, 1, 2, 0), [{ a: [WALL + 0.9, 0.03], b: [PF, 0.03], c: '#56595f' }, { a: [WALL + 4, 0.05], b: [WALL + 4.25, 0.05], c: '#eeeeee' }]);
    for (const run of K.clip(K.trackPath(1152, 1230, 1), PF, PF + 15, 1)) {
      K.sweep(run, [
        { a: [PF, -0.5], b: [PF, 4.8], bk: 'garage', uw: 6 },
        { a: [PF - 1.4, 4.8], b: [PF + 0.8, 4.8], c: '#eeeeee' }, { a: [PF - 1.4, 4.4], b: [PF - 1.4, 5.1], c: '#eeeeee' },
        { a: [PF + 0.8, 4.8], b: [PF + 0.8, 8.6], bk: 'win', uw: 4 },
        { a: [PF - 0.5, 8.6], b: [PF - 0.5, 9.4], c: '#e6e6e6' }, { a: [PF - 0.5, 9.4], b: [PF + 15, 9.4], c: '#8f969e' },
        { a: [PF - 0.5, 8.6], b: [PF + 0.8, 8.6], c: '#dddddd' },
        { a: [PF + 15, -0.5], b: [PF + 15, 9.4], c: '#d5d5d5' },
      ]);
      for (const p of [run[0], run[run.length - 1]]) K.cap(p, [[PF, PF + 15, -0.5, 9.4]], '#d5d5d5');
    }

    // ---- the motodrom: one continuous steep horseshoe on the outside from the south curve along the whole
    // start straight, the Sachs hairpin stand, the entry stand; tower behind the main grandstand
    const big = { rows: 28, rise: 0.74, depth: 0.88, roof: true, roofH: 4.6, over: 0.42, seat: '#a7aeb8', roofC: '#f0f2f4', fascia: '#1c1c1c' };
    K.stand(K.trackPath(1040, 1242, -1), big);
    // the tower, rising behind the main grandstand at the finish line
    {
      const [x, z] = at(1192, -(WALL + 3 + 28 * 0.88 + 9)), y = api.groundAt(x, z) - 0.3, s = S[1192], ry = Math.atan2(s.tan.x, s.tan.z);
      K.block(x, z, 9);
      K.add('solid', new T.BoxGeometry(11, 44, 11), '#e8eaed', x, y + 22, z, ry);
      for (let k = 0; k < 9; k++) K.add('glass', new T.BoxGeometry(11.3, 2.2, 11.3), '#3d5a78', x, y + 8 + k * 4.2, z, ry);
      K.add('glass', new T.BoxGeometry(13.5, 5, 13.5), '#35516e', x, y + 46.5, z, ry);   // glazed top floor
      K.add('solid', new T.BoxGeometry(14.5, 0.8, 14.5), '#d9dde1', x, y + 49.4, z, ry);
      K.add('solid', new T.BoxGeometry(11.4, 2.6, 11.4), '#c1121f', x, y + 41.5, z, ry);   // red band under the top floor
      K.add('metal', new T.CylinderGeometry(0.15, 0.15, 12, 5), '#c9ced3', x, y + 55.8, z);
    }
    K.stand(K.trackPath(972, 1014, 1), { ...big, rows: 22 });
    K.stand(K.trackPath(904, 952, -1), { ...big, rows: 18, roof: false });
    K.stand(K.trackPath(1232, 1262, -1), { rows: 14, rise: 0.7, roof: true });
    // stands out in the forest: north curve, hairpin, the arena
    for (const [i0, i1, rows, roof] of [[52, 92, 12, true], [206, 236, 10, false], [528, 566, 14, true], [742, 790, 14, true], [660, 700, 9, false]]) {
      K.stand(K.trackPath(i0, i1, K.outside(i0, i1)), { rows, roof, rise: 0.66, fascia: '#c1121f' });
    }
    for (const [i0, i1] of [[56, 92], [212, 240], [530, 568], [744, 790], [980, 1016], [1088, 1140]]) K.runoff(i0, i1, K.outside(i0, i1));

    // team trucks in the paddock behind the pits
    K.paddock(1156, 1226, 1, PF + 21, PF + 48, ['#c1121f', '#1d3557', '#f4f4f4', '#ff8700', '#0b6e4f', '#151515', '#2b6cb0', '#7a7f87']);

    // ---- the forest: tall Scots pines (bare trunks, flat dark crowns) with some beech and oak, dense to the fences
    const inStadium = (x, z) => Math.hypot(x - STADIUM[0], z - STADIUM[1]) < STADIUM[2];
    const pines = [], leafy = [], far = [];
    const tree = (x, z, rowTree) => {
      const n = K.nearest(x, z), pine = rnd() < 0.72, r = pine ? R(3.2, 4.8) : R(4.5, 7);
      if (inStadium(x, z) || n.d < WALL + 2 + r * 0.5 || !K.tallOk(n) || K.blocked(x, z, r * 0.5)) return;
      if (pine) pines.push({ x, z, h: R(20, 28), r, sy: R(0.55, 0.8), c: `hsl(${118 + rnd() * 30},${22 + rnd() * 16}%,${14 + rnd() * 7}%)`, bark: rowTree && rnd() < 0.5 ? '#9a6446' : '#7a5238', tw: R(0.28, 0.42) });
      else leafy.push({ x, z, h: R(15, 22), r, c: `hsl(${85 + rnd() * 30},${38 + rnd() * 16}%,${18 + rnd() * 9}%)`, bark: '#6b5d50', tw: R(0.4, 0.6) });
    };
    for (let i = 0; i < N; i += 2) for (const sg of [1, -1]) {
      if (rnd() < 0.9) tree(...at(i + R(-0.5, 0.5), sg * (WALL + R(4, 9))), true);
      if (rnd() < 0.8) tree(...at(i + 1, sg * (WALL + R(12, 20))), true);
    }
    for (let t = 0; t < 14000 && pines.length + leafy.length < 2500; t++) tree(...at(Math.floor(rnd() * N), (rnd() < 0.5 ? 1 : -1) * (WALL + 22 + rnd() * 90)));
    const b = api.track.bounds;
    for (let t = 0; t < 40000 && far.length < 2600; t++) {
      const x = R(b.minX - 350, b.maxX + 350), z = R(b.minZ - 350, b.maxZ + 350), n = K.nearest(x, z);
      if (n.d < 115 || n.d > 1e5 || inStadium(x, z) || K.blocked(x, z, 5)) continue;
      const pine = rnd() < 0.7;
      far.push({ x, z, h: pine ? R(20, 27) : R(15, 21), sy: pine ? 0.75 : 1, c: pine ? `hsl(${120 + rnd() * 25},${22 + rnd() * 14}%,${14 + rnd() * 6}%)` : `hsl(${85 + rnd() * 30},${36 + rnd() * 14}%,${19 + rnd() * 8}%)` });
    }
    K.forest([{ list: pines, crown: K.lobes(2), crownY: 1.0 }, { list: leafy, crown: K.lobes(3) }], far);
    const lawn = new T.Color('#5a9338'), floor = new T.Color('#3e5f2b'), tmp = new T.Color();
    K.paintGround((x, z, n) => inStadium(x, z) ? lawn : tmp.copy(lawn).lerp(floor, smooth(WALL + 6, WALL + 30, n.d)));

    K.clouds(0xf8fafc, 0.75, 14);
    K.flush();
  },
};
