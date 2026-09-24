// Silverstone: a flat former airfield under an overcast sky. The modern pit/paddock building with its swooping
// wing roof on the start straight, grandstands at every corner, the old national pits, wartime hangars and the
// control tower beside the old runways in the infield, and hedged fields of English countryside all round.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit } = await import(`./monza.js${new URL(import.meta.url).search}`);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const CROWD = ['#1d3557', '#f1faee', '#e63946', '#ff8700', '#2a9d8f', '#222222', '#6c757d', '#0b6e4f', '#ffd166', '#457b9d', '#f4f4f4', '#9b2226'];

export default {
  base: 'forest',
  baseBuild: false,
  env: {
    sky: { top: '#7f8c9a', horizon: '#c9cdd1', bottom: '#8b9683' },
    fog: { color: '#c2c7cc', near: 200, far: 1400 },
    sun: { dir: [0.25, 0.85, 0.3], color: '#e8ebef', intensity: 1.35 },   // high, weak: light through cloud
    hemi: { sky: '#dde3ea', ground: '#56663f', intensity: 1.35 },
    exposure: 1.0,
    envIntensity: 0.5,
    terrain: { base: '#4f8c37', hills: 1.2, rim: 12, rimColor: '#4d6b3d' },
  },
  build(api) {
    const K = kit(api), T = THREE, { S, N, WALL, R } = K, rnd = api.rnd;
    K.crowdBucket(CROWD);
    const at = (i, lat) => { const s = S[K.wrapI(i)]; return [s.pos.x + s.right.x * lat, s.pos.z + s.right.z * lat]; };

    // ---- the wing: pit/paddock building on the right (infield) of the start straight, glass front leaning out,
    // the roof's leading edge sweeping up towards the middle and overhanging the pit lane
    const PF = 31;
    K.texBucket('garage', api.canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#e9ecef'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#39414d'; g.fillRect(8, 26, w - 16, h - 26);
      for (let y = 28; y < h; y += 5) { g.fillStyle = '#2b323c'; g.fillRect(8, y, w - 16, 1); }
      g.fillStyle = '#1c7ed6'; g.fillRect(0, 8, w, 7);
    }), { rough: 0.5, metal: 0.3 });
    K.texBucket('win', api.canvasTex(128, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#7f97ad'); gr.addColorStop(1, '#2d3f52');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(230,236,242,0.9)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
      for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    }), { rough: 0.15, metal: 0.6 });
    K.clip(K.trackPath(1152, 1242, 1), WALL + 0.6, PF - 3, 0.2);   // keep the pit lane clear
    K.sweep(K.trackPath(1152, 1242, 1, 2, 0), [{ a: [WALL + 0.9, 0.03], b: [PF, 0.03], c: '#5a5d63' }, { a: [WALL + 4.2, 0.05], b: [WALL + 4.45, 0.05], c: '#eeeeee' }]);
    for (const run of K.clip(K.trackPath(1160, 1234, 1), PF, PF + 24, 1)) {
      run.forEach((p, k) => { p.t = k / (run.length - 1); });
      const sw = p => Math.sin(Math.PI * p.t), yF = p => 18.4 + 2.6 * sw(p) ** 0.7, ov = p => 4 + 5 * sw(p) ** 0.8;
      K.sweep(run, [
        { a: [PF, -0.5], b: [PF, 5.2], bk: 'garage', uw: 7 },
        { a: [PF - 0.8, 5.2], b: [PF + 2, 5.2], c: '#e8eaec' }, { a: [PF - 0.8, 4.7], b: [PF - 0.8, 5.6], c: '#e8eaec' },
        { a: [PF + 2, 5.2], b: [PF - 0.5, 17.2], bk: 'win', uw: 5 },
        { a: [PF - 0.5, 17.2], b: [PF + 24, 16.6], c: '#dfe3e8' },
        { a: p => [PF - ov(p), yF(p)], b: p => [PF + 24.5, 17.6 + 0.8 * sw(p)], bk: 'metal', c: '#e3e7ec' },     // wing roof
        { a: p => [PF - ov(p), yF(p) - 0.7], b: p => [PF - ov(p), yF(p) + 0.05], bk: 'metal', c: '#7d8792' },   // leading edge
        { a: [PF + 24, -0.5], b: [PF + 24, 17.4], c: '#cfd3d8' },
      ]);
      for (const p of [run[0], run[run.length - 1]]) K.cap(p, [[PF, PF + 24, -0.5, 17.2]], '#cfd3d8');
      // slim columns under the overhang, in front of the garages
      for (let k = 2; k < run.length - 2; k += 4) { const p = run[k]; K.add('metal', new T.CylinderGeometry(0.3, 0.3, 18, 6), '#b8c0c8', p.x + p.nx * (PF - 0.9), p.y + 8.8, p.z + p.nz * (PF - 0.9)); }
    }

    // ---- grandstands (outside of each corner), the old national pits, the straight opposite the wing
    const sideOf = (i0, i1) => K.outside(i0, i1);
    for (const [i0, i1, rows, roof, sg] of [
      [1166, 1232, 12, true, -1], [40, 72, 12, true], [165, 205, 10, false], [222, 250, 8, false], [408, 446, 12, true],
      [470, 525, 14, true], [528, 590, 12, true], [594, 626, 10, false], [690, 726, 14, true], [758, 790, 10, false],
      [800, 852, 12, true], [858, 882, 9, false], [905, 960, 9, false, -1], [996, 1034, 14, true], [1038, 1066, 10, false], [1070, 1136, 14, true],
    ]) K.stand(K.trackPath(i0, i1, sg ?? sideOf(i0, i1)), { rows, roof, rise: 0.58, fascia: rnd() < 0.5 ? '#1d3557' : '#e63946', roofC: '#eef0f2' });
    // old national pits: a long low two-storey block with a balcony, on the right of the national straight
    for (const run of K.clip(K.trackPath(634, 692, 1), WALL + 10, WALL + 24, 1)) {
      const F = WALL + 10;
      K.sweep(run, [
        { a: [F, -0.5], b: [F, 3.6], bk: 'garage', uw: 5 }, { a: [F - 1.8, 3.6], b: [F + 12, 3.6], c: '#f1f1f1' },
        { a: [F - 1.8, 3.6], b: [F - 1.8, 4.6], bk: 'metal', c: '#c8ced6' },
        { a: [F + 1, 3.6], b: [F + 1, 6.8], bk: 'win', uw: 4 }, { a: [F + 0.6, 6.8], b: [F + 14, 6.8], c: '#8c939b' },
        { a: [F + 14, -0.5], b: [F + 14, 6.8], c: '#e6e6e6' },
      ]);
      for (const p of [run[0], run[run.length - 1]]) K.cap(p, [[F, F + 14, -0.5, 6.8]], '#e6e6e6');
    }

    // ---- the airfield in the infield: old runways, three wartime hangars, the control tower
    const runwayTex = api.canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#a3a39c'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) { const v = 130 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v * 0.96},0.4)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = 'rgba(60,60,55,0.5)'; for (let x = 0; x < w; x += 42) g.fillRect(x, 0, 2, h); for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 2);
      for (let i = 0; i < 10; i++) { g.fillStyle = `rgba(70,90,40,${0.15 + Math.random() * 0.2})`; g.fillRect(Math.random() * w, 0, 3 + Math.random() * 5, h); }   // weeds in the joints
      g.fillStyle = 'rgba(245,245,240,0.55)'; g.fillRect(20, h / 2 - 3, 90, 6); g.fillRect(150, h / 2 - 3, 90, 6);   // faded centre dashes
    });
    K.texBucket('runway', runwayTex, { rough: 0.95, offset: true, shadow: false });
    const paved = [];
    const runway = (ax, az, bx, bz, wid = 46) => {
      const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz, nz = dx;
      let run = [];
      // six strips across, every vertex on the ground (the terrain is not planar over 46 m)
      const gy = (p, l) => api.groundAt(p.x + p.nx * l, p.z + p.nz * l) + 0.12;
      const out = () => {
        if (run.length > 1) {
          paved.push(...run.filter((p, k) => k % 3 === 0).map(p => [p.x, p.z, wid / 2 + 2]));
          K.sweep(run, [0, 1, 2, 3, 4, 5].map(k => {
            const la = -wid / 2 + wid * k / 6, lb = la + wid / 6;
            return { a: p => [la, gy(p, la)], b: p => [lb, gy(p, lb)], bk: 'runway', uw: 60, off: 0, v: [k / 6, (k + 1) / 6] };
          }));
        }
        run = [];
      };
      for (let s = 0; s <= L; s += 8) {
        const x = ax + dx * s, z = az + dz * s;
        const ok = [-1, 0, 1].every(k => { const px = x + nx * k * (wid / 2 + 2), pz = z + nz * k * (wid / 2 + 2); return K.nearest(px, pz).d > WALL + 8 && !K.blocked(px, pz, 0); });
        if (!ok) { out(); continue; }
        run.push({ x, y: 0, z, nx, nz });
      }
      out();
    };
    // hangars + tower first (they block), then the runways skirt them
    const [hx, hz] = at(935, 152), hs = S[935], hry = Math.atan2(hs.tan.x, hs.tan.z);
    K.texBucket('corr', api.canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#7b8279'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 4) { g.fillStyle = y % 8 ? '#6a7168' : '#8d948b'; g.fillRect(0, y, w, 2); }   // corrugations follow the arch
      g.fillStyle = 'rgba(120,70,40,0.3)'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h);   // rust along the ground
    }), { rough: 0.7, metal: 0.4 });
    for (const along of [-72, 0, 72]) {
      const x = hx + hs.tan.x * along, z = hz + hs.tan.z * along, y = api.groundAt(x, z) - 0.3;
      if (!K.free(x, z, 34)) continue;
      K.block(x, z, 36);
      // half-cylinder shell (axis along the straight), end walls with big sliding doors
      const shell = new T.CylinderGeometry(17, 17, 58, 20, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
      shell.attributes.uv.array.forEach((v, k, a) => { if (k % 2) a[k] = v * 14; });
      K.add('corr', shell, '#ffffff', x, y, z, hry);
      for (const e of [-29, 29]) {
        K.add('solid', new T.CircleGeometry(17, 20, 0, Math.PI), '#7f877d', x + Math.sin(hry) * e, y, z + Math.cos(hry) * e, hry);
        K.add('solid', new T.BoxGeometry(22, 9, 0.4), '#4a4f4a', x + Math.sin(hry) * e * 1.005, y + 4.5, z + Math.cos(hry) * e * 1.005, hry);
      }
      K.add('solid', new T.BoxGeometry(40, 0.3, 64), '#8f8f88', x, y + 0.1, z, hry);   // apron
    }
    {
      const [x, z] = at(972, 205), y = api.groundAt(x, z) - 0.2, ry = hry;
      if (K.free(x, z, 14)) {
        K.block(x, z, 16);
        const P = (geo, c, lx, ly, lz, bk = 'solid') => K.add(bk, geo, c, x + Math.cos(ry) * lx + Math.sin(ry) * lz, y + ly, z - Math.sin(ry) * lx + Math.cos(ry) * lz, ry);
        P(new T.BoxGeometry(14, 4, 10), '#efefe9', 0, 2, 0); P(new T.BoxGeometry(12, 3.6, 8.5), '#efefe9', 0, 5.8, -0.6);
        P(new T.BoxGeometry(14.4, 0.25, 10.4), '#d9d9d2', 0, 4.05, 0); P(new T.BoxGeometry(12.4, 0.25, 8.9), '#d9d9d2', 0, 7.7, -0.6);
        for (let k = -5; k <= 5; k += 2.5) { P(new T.BoxGeometry(1.4, 1.3, 0.1), '#2e3b48', k, 2.4, 5.05); P(new T.BoxGeometry(1.4, 1.3, 0.1), '#2e3b48', k, 6.1, 3.7); }
        P(new T.BoxGeometry(4.2, 2.6, 4.2), '#5d7890', 0, 9.2, -1, 'glass');   // glazed cab
        P(new T.BoxGeometry(4.6, 0.3, 4.6), '#efefe9', 0, 10.6, -1);
        P(new T.BoxGeometry(12.4, 0.9, 0.08), '#c9ced3', 0, 8.3, 3.6, 'metal'); P(new T.BoxGeometry(0.08, 0.9, 8.9), '#c9ced3', 6.2, 8.3, -0.6, 'metal');
        P(new T.CylinderGeometry(0.06, 0.06, 6, 4), '#c9ced3', 3.5, 13.5, -1, 'metal');   // mast
      }
    }
    runway(...at(885, 72), ...at(995, 72));   // parallel to the hangar straight
    runway(-150, 198, 335, 100);   // with the first, the old triangle of runways
    runway(292, 600, 276, 55);
    for (const [x, z, r] of paved) K.block(x, z, r);   // no trees on the concrete

    // ---- British GP life outside the fences: grass car parks, campsites, hospitality marquees behind the wing
    const inf = (x, z, n = K.nearest(x, z)) => n.d < 1e5 && K.infield(x, z);   // the infield is all within ~300 m of the track
    const cars = [], tents = [];
    const lot = (i, sg, lat, len, dep, dx, dz, gap, put) => {
      const s = S[K.wrapI(i)], [cx, cz] = at(i, sg * lat), tx = s.tan.x, tz = s.tan.z, nx = s.right.x * sg, nz = s.right.z * sg;
      const P = (a, d) => [cx + tx * a + nx * d, cz + tz * a + nz * d];
      const ok = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [0, -1], [0, 1]].every(([a, d]) => {
        const [x, z] = P(a * len / 2, d * dep / 2), n = K.nearest(x, z);
        return n.d > WALL + 45 && !K.blocked(x, z, 2) && !inf(x, z, n);
      });
      if (!ok) return false;
      K.block(cx, cz, Math.hypot(len, dep) / 2);
      for (let a = -len / 2 + 3; a < len / 2 - 3; a += dx) for (let d = -dep / 2 + 3; d < dep / 2 - 3; d += dz) if (rnd() > gap) put(...P(a + R(-0.3, 0.3), d), Math.atan2(nx, nz));
      return true;
    };
    const CARS = ['#c0c4c8', '#1d1d1f', '#f4f4f4', '#8b0000', '#1f3a93', '#5a6268', '#2e7d32', '#b0b7bf', '#d4a017', '#7b1e2b', '#e8e8e8', '#30343a'];
    const TENTS = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#264653', '#8ecae6', '#ffb703', '#6a4c93', '#90be6d', '#f1faee'];
    let parks = 0, camps = 0;
    for (let k = 0; k < 90 && (parks < 6 || camps < 3); k++) {
      const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? 1 : -1, camp = camps < 3 && rnd() < 0.4;
      if (camp) { if (lot(i, sg, R(120, 170), 130, 80, 5.5, 6, 0.3, (x, z, ry) => tents.push({ x, y: api.groundAt(x, z) - 0.05, z, ry: ry + R(-0.3, 0.3), sx: R(0.8, 1.5), sy: R(0.8, 1.3), c: TENTS[Math.floor(rnd() * TENTS.length)] }))) camps++; }
      else if (parks < 6 && lot(i, sg, R(110, 150), 170, 64, 2.9, 7.5, 0.18, (x, z, ry) => cars.push({ x, y: api.groundAt(x, z), z, ry: ry + R(-0.06, 0.06), c: CARS[Math.floor(rnd() * CARS.length)] }))) parks++;
    }
    const carGeo = mergeGeometries([new T.BoxGeometry(1.8, 0.8, 4.3).translate(0, 0.55, 0), new T.BoxGeometry(1.6, 0.6, 2.3).translate(0, 1.25, -0.2)]);
    K.inst(carGeo, new T.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), cars, { cell: 800 });
    K.inst(new T.ConeGeometry(1.7, 1.8, 4).translate(0, 0.9, 0), new T.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), tents, { cell: 800 });
    const roofGeo = () => new T.CylinderGeometry(6.9, 6.9, 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.45, 1);
    for (let k = 0; k < 7; k++) {
      const i = 1172 + k * 9, [x, z] = at(i, PF + 44 + (k % 2) * 16), s = S[K.wrapI(i)], ry = Math.atan2(s.tan.x, s.tan.z) + Math.PI / 2;
      if (!K.free(x, z, 10)) continue;
      K.block(x, z, 11);
      const y = api.groundAt(x, z) - 0.2, len = 20 + (k % 3) * 4;
      K.add('solid', new T.BoxGeometry(len, 3.2, 12), '#f4f5f6', x, y + 1.6, z, ry + Math.PI / 2);
      K.add('solid', roofGeo().scale(len + 0.4, 1, 1), '#ffffff', x, y + 3.2 + 6.9 * 0.45 * 0.5, z, ry + Math.PI / 2);
    }

    K.paddock(1164, 1232, 1, PF + 32, PF + 70, ['#c1121f', '#1d3557', '#f4f4f4', '#ff8700', '#0b6e4f', '#151515', '#2b6cb0', '#7a7f87']);

    // run-off: tarmac with the painted stripes by the kerb (outside of the fast corners)
    K.texBucket('tarmac', api.canvasTex(64, 64, (g, w, h) => {
      g.fillStyle = '#6b6e73'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) { const v = 80 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
      for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#1d6fb8' : '#2e9e4f'; g.fillRect(x, h * 0.72, 16, h * 0.28); }
    }), { rough: 0.9, offset: true, shadow: false });
    for (const [i0, i1] of [[44, 72], [168, 206], [408, 446], [470, 592], [690, 728], [790, 862], [994, 1036], [1068, 1140]]) K.runoff(i0, i1, K.outside(i0, i1), 'tarmac');

    // ---- countryside: patchwork fields with hedgerows and hedge oaks outside the circuit, mown grass inside
    const th = 0.33, cu = Math.cos(th), su = Math.sin(th), FU = 230, FV = 165;
    const cellOf = (x, z) => [Math.floor((x * cu + z * su) / FU), Math.floor((-x * su + z * cu) / FV)];
    const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    const FIELDS = ['#6f9a3e', '#5f9036', '#8fa845', '#c7b25a', '#b89c50', '#7d6546', '#97ae5c', '#6a9440', '#a8b765'].map(c => new T.Color(c));
    const mown = new T.Color('#5a9a3c'), rough = new T.Color('#4e8434'), tmp = new T.Color();
    K.paintGround((x, z, n) => {
      const nearTrack = 1 - smooth(85, 150, n.d);
      if (inf(x, z, n)) return tmp.copy(mown).lerp(rough, 0.5 + 0.5 * Math.sin(x * 0.02) * Math.cos(z * 0.025));
      const [a, b] = cellOf(x, z);
      return tmp.copy(FIELDS[Math.floor(hash(a, b) * FIELDS.length)]).lerp(mown, nearTrack);
    });
    const hedges = [], hedgeTrees = [], b = api.track.bounds, X0 = b.minX - 1100, X1 = b.maxX + 1100, Z0 = b.minZ - 1100, Z1 = b.maxZ + 1100;
    const hedgeOk = (x, z, n = K.nearest(x, z)) => x > X0 && x < X1 && z > Z0 && z < Z1 && n.d > 100 && !inf(x, z, n) && !K.blocked(x, z, 3);
    // walk every grid line of the rotated field grid in 22 m segments
    const lines = (span, step, other0, other1, toXZ) => {
      for (let k = Math.floor(span[0] / step); k <= Math.ceil(span[1] / step); k++) {
        for (let t = other0; t < other1; t += 22) {
          if (hash(k * 7.3, Math.floor(t / 150)) < 0.12) continue;   // a missing stretch now and then
          const [x, z] = toXZ(k * step, t + 11), [x2, z2] = toXZ(k * step, t + 33);
          if (!hedgeOk(x, z)) continue;
          const hgt = R(2, 3.1);
          hedges.push({ x, y: api.groundAt(x, z) - 0.2, z, ry: Math.atan2(x2 - x, z2 - z), sx: R(2, 2.8), sy: hgt, sz: 23, c: `hsl(${95 + rnd() * 20},${35 + rnd() * 15}%,${16 + rnd() * 7}%)` });
          if (rnd() < 0.26) hedgeTrees.push({ x: x + R(-3, 3), z: z + R(-3, 3), h: R(12, 19), r: R(4.5, 7), c: `hsl(${85 + rnd() * 30},${35 + rnd() * 15}%,${18 + rnd() * 8}%)`, bark: '#5d4e40', tw: 0.5 });
        }
      }
    };
    const corners = [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]], U = corners.map(([x, z]) => x * cu + z * su), V = corners.map(([x, z]) => -x * su + z * cu);
    const [u0, u1, v0, v1] = [Math.min(...U), Math.max(...U), Math.min(...V), Math.max(...V)];
    lines([u0, u1], FU, v0, v1, (u, v) => [u * cu - v * su, u * su + v * cu]);
    lines([v0, v1], FV, u0, u1, (v, u) => [u * cu - v * su, u * su + v * cu]);
    K.inst(new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new T.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), hedges, { cell: 800 });
    // copses dotted round the outside, a few trees along the perimeter
    const copse = [];
    for (let c = 0, tries = 0; c < 18 && tries < 400; tries++) {
      const x = R(X0 + 300, X1 - 300), z = R(Z0 + 300, Z1 - 300);
      if (K.nearest(x, z).d < 170 || inf(x, z)) continue;
      c++;
      for (let k = 0, n = 12 + Math.floor(rnd() * 22); k < n; k++) {
        const a = rnd() * TAU, r = Math.sqrt(rnd()) * R(30, 60), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r * 0.7;
        if (K.nearest(px, pz).d > 140 && !K.blocked(px, pz, 3)) copse.push({ x: px, z: pz, h: R(12, 19), c: `hsl(${88 + rnd() * 30},${34 + rnd() * 14}%,${17 + rnd() * 8}%)` });
      }
    }
    const edge = [];
    for (let t = 0; t < 6000 && edge.length < 260; t++) {
      const i = Math.floor(rnd() * N), sg = rnd() < 0.5 ? 1 : -1, [x, z] = at(i, sg * (WALL + R(14, 70))), n = K.nearest(x, z);
      if (hash(Math.floor(i / 40), sg) < 0.55 || n.d < WALL + 10 || !K.tallOk(n) || K.blocked(x, z, 4) || inf(x, z) && rnd() < 0.7) continue;
      edge.push({ x, z, h: R(10, 16), r: R(3.5, 5.5), c: `hsl(${88 + rnd() * 30},${34 + rnd() * 14}%,${19 + rnd() * 8}%)`, bark: '#5d4e40', tw: 0.4 });
    }
    K.forest([{ list: edge, crown: K.lobes(3) }, { list: hedgeTrees, crown: K.lobes(2) }], copse);

    K.clouds(0xb9bec4, 0.95, 40, 200, 0.75);
    K.flush();
  },
};
