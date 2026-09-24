// Melbourne, Albert Park: the lap wraps the long park lake (water in the infield where the real lake lies), with
// sailing dinghies, a lakeside path and islands; lawns, sports ovals and a golf course among gum trees; the pits
// and paddock on the lake side of the start straight; low-rise houses to the south-west, office towers along the
// park's east edge and the city skyline to the north; a few hot-air balloons drifting over.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
// the kit is loaded with this module's own query: after a failed fetch world.js retries with ?retry=N, and a static
// import would keep resolving to the kit URL the module map already holds as failed
const { kit } = await import(`./bahrain.js${new URL(import.meta.url).search}`);

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- the lake (x = east, z = -north), smoothed; signed distance + = water
const WATER = -0.9;
const chaikin = P => P.flatMap(([ax, az], i) => {
  const [bx, bz] = P[(i + 1) % P.length];
  return [[ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]];
});
const LAKE = chaikin(chaikin([
  [-240, -1150], [-120, -1205], [40, -1190], [130, -1130], [160, -1000], [140, -880], [120, -760], [105, -620], [110, -480],
  [135, -380], [140, -290], [110, -210], [50, -160], [-10, -175], [-60, -235], [-120, -330], [-170, -450], [-200, -580],
  [-230, -720], [-265, -850], [-295, -980], [-290, -1080],
]));
const ISLANDS = [[-120, -900, 26], [40, -560, 18]];   // [x, z, r]
const LB = LAKE.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [Infinity, -Infinity, Infinity, -Infinity]);
function lakeSD(x, z) {
  if (x < LB[0] - 80 || x > LB[1] + 80 || z < LB[2] - 80 || z > LB[3] + 80) return -80;
  let best = Infinity, inside = false;
  for (let i = 0, n = LAKE.length; i < n; i++) {
    const [ax, az] = LAKE[i], [bx, bz] = LAKE[(i + 1) % n], dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2);
    if ((az > z) !== (bz > z) && x < ax + (z - az) * dx / dz) inside = !inside;
  }
  let d = Math.sqrt(best) * (inside ? 1 : -1);
  for (const [ix, iz, r] of ISLANDS) d = Math.min(d, Math.hypot(x - ix, z - iz) - r);
  return d;
}

const env = {
  sky: { top: '#2f6fc4', horizon: '#cfe2ee', bottom: '#8fb08a' },
  fog: { color: '#cfe0ea', near: 320, far: 1900 },
  sun: { dir: [-0.6, 0.5, -0.55], color: '#fff3dc', intensity: 2.8 },   // autumn afternoon, sun in the north-west
  hemi: { sky: '#d4e8ff', ground: '#5b7a3c', intensity: 0.85 },
  exposure: 1.0,
  envIntensity: 0.4,
  night: false,
  terrain: {
    base: '#4f8a34', hills: 1, rim: 10, rimColor: '#5d7d4a',
    height: (x, z, y) => Math.min(y, WATER + 0.45 - 0.1 * lakeSD(x, z)),   // lake bowl, banks rise 1:10
  },
  road: { base: '#3e4046', line: '#f4f4ee', edge: '#f4f4ee' },
  shoulder: '#8e9180',
  barrier: 'ads',
  curb: ['#d7263d', '#f4f4f4'],
};

const LAKE_VS = `varying vec3 vW;
#include <fog_pars_vertex>
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const LAKE_FS = `uniform float uTime; uniform vec3 uSun, uSunCol, uDeep, uSky, uHor;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec2 p = vW.xz; float t = uTime;
  vec2 s = vec2(sin(p.x * 0.31 + t * 1.3 + sin(p.y * 0.19)), cos(p.y * 0.27 - t * 1.1 + sin(p.x * 0.15))) * 0.045
         + vec2(sin(p.x * 1.3 - p.y * 0.9 + t * 2.3), cos(p.y * 1.1 + p.x * 0.7 - t * 2.0)) * 0.022
         + vec2(sin(p.x * 3.1 + p.y * 2.3 - t * 3.7), cos(p.y * 2.9 - p.x * 1.9 + t * 3.3)) * 0.012;
  vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
  vec3 V = normalize(cameraPosition - vW);
  float F = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  vec3 sky = mix(uHor, uSky, pow(clamp(R.y, 0.0, 1.0), 0.5));
  float sd = max(dot(R, uSun), 0.0);
  vec3 col = mix(uDeep, sky, min(F, 0.42)) + uSunCol * (pow(sd, 700.0) * 16.0 + pow(sd, 60.0) * 0.5);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function build(api) {
  const K = kit(api), { N, W2, side, faceYaw, outside, tallOk, part, bake, inst, mesh, vc } = K;
  const { world, rnd, track } = api, ground = api.groundAt, sp = track.spacing;
  const R = (a, b) => a + (b - a) * rnd();
  const at = m => Math.round(m / sp);
  const inRect = (x, z, [x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1;
  const OVALS = [[-360, -940, 55, 42, 0.2, 'athletics'], [-335, -700, 48, 62, 0.15, 'cricket']];   // [x, z, rx, rz, yaw, kind] in the west infield
  const GOLF = [290, -120, 780, 290];
  const inOval = (x, z, m = 0) => OVALS.some(([ox, oz, rx, rz, a]) => {
    const dx = x - ox, dz = z - oz, u = dx * Math.cos(a) - dz * Math.sin(a), v = dx * Math.sin(a) + dz * Math.cos(a);
    return (u / (rx + m)) ** 2 + (v / (rz + m)) ** 2 < 1;
  });

  const BANK = new THREE.Color(0.9, 0.78, 0.62);
  // ---- lawns: mown stripes, darker grass under the groves, sports ovals, golf fairways, sandy lake banks
  K.tintGround((x, z, y, d, c) => {
    const sd = lakeSD(x, z), grove = Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.013 - 1.1);
    let g = 0.92 + 0.08 * Math.sin((x + z) * 0.22) * (1 - smooth(60, 160, d)) - 0.1 * smooth(0.2, 0.9, grove);
    c.setRGB(g * 0.95, g, g * 0.9);
    if (inOval(x, z)) c.setRGB(1.12, 1.15, 0.95);
    if (inRect(x, z, GOLF)) c.multiplyScalar(1.08 + 0.1 * Math.sin(x * 0.05 + z * 0.02));
    c.lerp(BANK, smooth(-9, -1, sd) * 0.8);   // sandy bank at the waterline
  });

  // ---- lake water
  const u = {
    uTime: { value: 0 }, uSun: { value: new THREE.Vector3(...env.sun.dir).normalize() }, uSunCol: { value: new THREE.Color('#fff4e0') },
    uDeep: { value: new THREE.Color('#1f5f78') }, uSky: { value: new THREE.Color('#3f7fd0') }, uHor: { value: new THREE.Color('#9cc3e0') },
  };
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(LB[1] - LB[0] + 60, LB[3] - LB[2] + 60, Math.ceil((LB[1] - LB[0]) / 100), Math.ceil((LB[3] - LB[2]) / 100)).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...u }, vertexShader: LAKE_VS, fragmentShader: LAKE_FS, fog: true,
  }));
  lake.position.set((LB[0] + LB[1]) / 2, WATER, (LB[2] + LB[3]) / 2);
  lake.receiveShadow = false;
  world.add(lake);
  api.onUpdate((dt, time) => { u.uTime.value = time ?? (u.uTime.value + dt); });

  // lakeside path: gravel ribbon ~9 m from the shore (shore resampled every ~6 m so it hugs the bank)
  {
    const P = LAKE.flatMap(([ax, az], i) => {
      const [bx, bz] = LAKE[(i + 1) % LAKE.length], k = Math.ceil(Math.hypot(bx - ax, bz - az) / 6);
      return Array.from({ length: k }, (_, j) => [ax + (bx - ax) * j / k, az + (bz - az) * j / k]);
    });
    const pos = [], n = P.length, off = -9;
    for (let i = 0; i <= n; i++) {
      const [ax, az] = P[(i - 1 + n) % n], [bx, bz] = P[(i + 1) % n], [x, z] = P[i % n];
      let nx = bz - az, nz = -(bx - ax); const l = Math.hypot(nx, nz); nx /= l; nz /= l;   // outward normal for a clockwise-in-screen loop
      if (lakeSD(x + nx * 5, z + nz * 5) > 0) { nx = -nx; nz = -nz; }
      for (const w of [-1.6, 1.6]) { const px = x + nx * (-off + w), pz = z + nz * (-off + w); pos.push(px, ground(px, pz) + 0.06, pz); }
    }
    const idx = [];
    for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xcdbb98, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true;
    world.add(m);
  }

  const LOOP = K.S.filter((_, i) => i % 4 === 0).map(s => [s.pos.x, s.pos.z]);
  const insideLoop = (x, z) => {
    let inside = false;
    for (let i = 0, n = LOOP.length; i < n; i++) {
      const [ax, az] = LOOP[i], [bx, bz] = LOOP[(i + 1) % n];
      if ((az > z) !== (bz > z) && x < ax + (z - az) * (bx - ax) / (bz - az)) inside = !inside;
    }
    return inside;
  };
  const lawnOk = (x, z, r) => lakeSD(x, z) < -6 - r && !inOval(x, z, 6);

  // ---- pits + paddock (lake side of the start straight), main grandstand opposite, stands at the key corners
  {
    const pb = K.pits(280, { stripe: '#1f4fa0', sign: 'ALBERT PARK  ピット' });
    const [x, z] = side(at(-110), W2 + 21);
    pb.position.set(x, ground(x, z) - 0.2, z); pb.rotation.y = faceYaw(at(-110), 1);
    world.add(pb);
    K.blockRun(at(-250), at(30), W2 + 30, 14);
    const P = [];   // paddock team buildings behind the garages
    for (let m = -240; m <= 20; m += 26) {
      const i = at(m), [hx, hz] = side(i, W2 + 63);
      P.push(bake([part(new THREE.BoxGeometry(20, 6.5, 11), m % 3 ? '#f2f2ef' : '#d7dde6', 0, 3.25, 0), part(new THREE.BoxGeometry(20.4, 1.2, 11.4), '#2f3a4a', 0, 4.8, 0), part(new THREE.BoxGeometry(21, 0.3, 12), '#9aa3ad', 0, 6.6, 0)], hx, ground(hx, hz) - 0.2, hz, faceYaw(i, 1)));
      api.block(hx, hz, 11);
    }
    mesh(mergeGeometries(P), vc({ roughness: 0.6 }));
  }
  const stands = [[at(-120), -1, 200, 14], [80, 0, 80, 10], [236, 0, 90, 12], [530, 0, 70, 10], [772, 0, 80, 10], [1008, 0, 70, 10]];
  for (const [i, sg0, len, rows] of stands) {
    const sg = sg0 || outside(i), lat = sg * (W2 + 19), [x, z] = side(i, lat);
    const st = K.stand(len, { rows, roof: 'flat', fascia: '#1f4fa0', canopy: '#eef1f4' });
    st.position.set(x, ground(x, z) - 0.2, z); st.rotation.y = faceYaw(i, lat);
    world.add(st);
    const n = Math.ceil(len / 20), c = Math.cos(st.rotation.y), s = Math.sin(st.rotation.y), oz = rows * 0.55;
    for (let k = 0; k <= n; k++) { const ox = -len / 2 + k * len / n; api.block(x + ox * c + oz * s, z - ox * s + oz * c, 13); }
  }

  // ---- sports centre outside T3: long low hall with a barrel-vault roof
  {
    const i = 232, lat = outside(i) * (W2 + 95), [x, z] = side(i, lat), ry = faceYaw(i, lat), y = ground(x, z) - 0.2;
    const vault = new THREE.CylinderGeometry(24, 24, 110, 20, 1, false, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 1);
    mesh(bake([part(new THREE.BoxGeometry(110, 9, 48), '#e4e0d6', 0, 4.5, 0), part(vault, '#9fb4c8', 0, 9, 0), part(new THREE.BoxGeometry(111, 2.4, 49), '#3a6d8c', 0, 7.2, 0)], x, y, z, ry), vc({ roughness: 0.5 }));
    api.block(x, z, 58);
  }

  // ---- sports ovals in the west infield: athletics track (red lanes + small stand) and a cricket oval with a pavilion
  {
    const P = [];
    for (const [ox, oz, rx, rz, a, kind] of OVALS) {
      const y = ground(ox, oz) + 0.08;
      if (kind === 'athletics') {
        const ring = new THREE.RingGeometry(0.86, 1, 48, 1).rotateX(-Math.PI / 2).scale(rx, 1, rz);
        P.push(part(ring, '#b5533c', 0, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(-a).setPosition(ox, y, oz)));
        const st = K.stand(70, { rows: 8, roof: 'flat', fascia: '#1f4fa0' });
        const sx = ox + Math.cos(a) * (rx + 12), sz = oz - Math.sin(a) * (rx + 12);
        st.position.set(sx, ground(sx, sz) - 0.2, sz); st.rotation.y = -a - Math.PI / 2;
        world.add(st);
      } else {
        P.push(part(new THREE.RingGeometry(0.985, 1, 48, 1).rotateX(-Math.PI / 2).scale(rx, 1, rz), '#ffffff', 0, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(-a).setPosition(ox, y, oz)));
        P.push(part(new THREE.BoxGeometry(3, 0.05, 20), '#c9b27a', ox, y, oz, -a));
        const px = ox - Math.cos(a) * (rx + 14), pz = oz + Math.sin(a) * (rx + 14);
        P.push(bake([part(new THREE.BoxGeometry(22, 5, 9), '#f0ebdf', 0, 2.5, 0), part(new THREE.ConeGeometry(15, 4, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.5), '#9a3b2e', 0, 7, 0)], px, ground(px, pz) - 0.2, pz, -a + Math.PI / 2));
      }
      api.block(ox, oz, Math.max(rx, rz) + 14);
    }
    mesh(mergeGeometries(P), vc({ roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
  }

  // ---- golf course (south-east infield): bunkers, greens with flags
  {
    const P = [];
    for (let k = 0; k < 7; k++) {
      const x = R(GOLF[0] + 40, GOLF[2] - 40), z = R(GOLF[1] + 40, GOLF[3] - 40);
      if (!api.isFree(x, z, 16)) continue;
      const y = ground(x, z) + 0.07;
      P.push(part(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2).scale(R(9, 14), 1, R(7, 11)), '#6fb24a', x, y, z, rnd() * TAU));
      for (let b = 0; b < 2; b++) P.push(part(new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2).scale(R(4, 7), 1, R(2.5, 4)), '#e8dcb5', x + R(-18, 18), y + 0.01, z + R(-18, 18), rnd() * TAU));
      P.push(part(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), '#eeeeee', x, y + 1.1, z), part(new THREE.PlaneGeometry(0.7, 0.45), '#e63946', x + 0.36, y + 1.95, z));
    }
    if (P.length) mesh(mergeGeometries(P), vc({ roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), false);
  }

  // ---- gum trees: pale trunks, forked limbs, open grey-green crowns; the park is full of them
  const leaf = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  const bark = vc({ roughness: 0.9 });
  const gums = [0, 1, 2].map(v => {
    const H = [11, 14, 9][v], T = [], C = [];
    T.push(part(new THREE.CylinderGeometry(0.28, 0.45, H * 0.62, 6, 1, true), v === 1 ? '#d8d2c4' : '#bfb3a0', 0, H * 0.31, 0));
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * TAU + v, tilt = 0.45 + 0.15 * k, len = H * 0.45;
      T.push(part(new THREE.CylinderGeometry(0.12, 0.2, len, 5, 1, true).translate(0, len / 2, 0), '#cfc6b4', 0, H * 0.55, 0, a, 0, tilt));
      const cx = -Math.cos(a) * Math.sin(tilt) * len * 0.9, cz = Math.sin(a) * Math.sin(tilt) * len * 0.9;   // limb tip (Rz(tilt) then Ry(a))
      C.push(new THREE.IcosahedronGeometry(1, 0).scale(2.6, 1.5, 2.6).translate(cx * 0.9 + Math.sin(k) * 0.4, H * 0.55 + Math.cos(tilt) * len * 0.95, cz * 0.9));
    }
    C.push(new THREE.IcosahedronGeometry(1, 0).scale(2.9, 1.8, 2.9).translate(0.3, H * 1.0, -0.2));
    return { trunk: mergeGeometries(T), crown: mergeGeometries(C) };
  });
  const gumList = [[], [], []];
  const addGum = (x, z, s = R(0.8, 1.25)) => {
    if (!lawnOk(x, z, 3) || !tallOk(x, z, 3.5)) return false;
    const y = ground(x, z) - 0.2, ry = rnd() * TAU, v = (rnd() * 3) | 0;
    gumList[v].push([x, y, z, ry, s, new THREE.Color().setHSL(R(0.2, 0.27), R(0.18, 0.32), R(0.26, 0.36))]);
    api.block(x, z, 3);
    return true;
  };
  // shore rows, park groves (clumped), and the far margins of the park
  for (let i = 0; i < LAKE.length; i++) {
    const [x, z] = LAKE[i];
    for (let k = 0; k < 3; k++) {
      const a = rnd() * TAU, r = R(3, 14);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, sd = lakeSD(px, pz);
      if (sd < -14 && sd > -34) addGum(px, pz);
    }
  }
  const grove = (x, z) => Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.013 - 1.1) + 0.6 * Math.sin(x * 0.027 - z * 0.019 + 2);
  const { minX, maxX, minZ, maxZ } = K.bounds;
  for (let n = 0, t = 0; n < 1000 && t < 30000; t++) {   // clumped groves, most of them where the road sees them
    const x = R(minX - 200, maxX + 150), z = R(minZ - 150, maxZ + 150);
    if (rnd() > 0.2 + 0.8 * smooth(-0.2, 0.7, grove(x, z))) continue;
    const d = K.dist(x, z);
    if (d > 330 || (d > 120 && rnd() < 0.55) || (inRect(x, z, GOLF) && rnd() < 0.7)) continue;
    if (addGum(x, z)) n++;
  }
  for (const [ix, iz, r] of ISLANDS) for (let k = 0; k < 5; k++) {   // trees on the lake islands
    const a = rnd() * TAU, rr = R(0, r * 0.55), x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr;
    gumList[k % 3].push([x, ground(x, z), z, rnd() * TAU, R(0.7, 1), new THREE.Color().setHSL(R(0.2, 0.27), 0.28, R(0.26, 0.34))]);
  }
  gums.forEach((g, v) => {
    inst(g.trunk, bark, gumList[v].map(e => e.slice(0, 5)));
    inst(g.crown, leaf, gumList[v]);
  });

  // ---- sailing dinghies drifting on slow loops, bobbing on the chop
  const boats = [];
  for (let t = 0; t < 800; t++) {   // all 800 tries draw from rnd (keeps the rest of the layout), 14 boats kept
    const x = R(LB[0], LB[1]), z = R(LB[2], LB[3]), sd = lakeSD(x, z);
    if (sd < 30) continue;
    const b = { x, z, r: R(6, Math.min(40, sd - 14)), w: R(0.02, 0.05) * (rnd() < 0.5 ? -1 : 1), ph: rnd() * TAU };
    if (boats.length < 14) boats.push(b);
  }
  const sails = ['#ffffff', '#ffffff', '#f4d35e', '#e63946', '#3a86ff', '#ffffff'];
  const tri = (pts, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.computeVertexNormals();
    return part(g, color);
  };
  const boatGeo = mergeGeometries([
    part(new THREE.BoxGeometry(1.5, 0.5, 4.3), '#f7f7f5', 0, 0.15, 0),
    part(new THREE.ConeGeometry(0.75, 1.3, 4, 1).rotateY(Math.PI / 4).rotateX(Math.PI / 2).scale(1, 0.35, 1), '#f7f7f5', 0, 0.15, 2.8),
    part(new THREE.BoxGeometry(1.55, 0.12, 4.35), '#1f4fa0', 0, -0.02, 0),
    part(new THREE.CylinderGeometry(0.05, 0.06, 6, 4), '#dddddd', 0, 3.3, 0.7),
    tri([[0, 0.7, 0.75], [0, 6.1, 0.72], [0, 0.8, -1.9]], '#ffffff'),
    tri([[0, 0.7, 0.75], [0, 0.8, -1.9], [0, 6.1, 0.72]], '#ffffff'),
    tri([[0, 1.0, 0.85], [0, 5.3, 0.8], [0, 0.6, 2.6]], '#ffffff'),
    tri([[0, 1.0, 0.85], [0, 0.6, 2.6], [0, 5.3, 0.8]], '#ffffff'),
  ]);
  const boatMesh = new THREE.InstancedMesh(boatGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), Math.max(1, boats.length));
  boats.forEach((b, k) => boatMesh.setColorAt(k, new THREE.Color(sails[k % sails.length])));
  boatMesh.count = boats.length;
  boatMesh.castShadow = true;
  boatMesh.frustumCulled = false;   // they sail loops: the bounding sphere cached at the first frame would cull them
  world.add(boatMesh);
  const dmy = new THREE.Object3D();
  dmy.rotation.order = 'YXZ';
  let t = 0;
  const sailAll = dt => {
    t += dt;
    boats.forEach((b, k) => {
      const a = b.ph + t * b.w;
      dmy.position.set(b.x + Math.cos(a) * b.r, WATER - 0.12 + 0.08 * Math.sin(t * 1.7 + b.ph), b.z + Math.sin(a) * b.r);
      const g = Math.sign(b.w);   // bow (+Z) along the loop tangent, heeling a little
      dmy.rotation.set(0.04 * Math.sin(t * 1.3 + k), Math.atan2(-Math.sin(a) * g, Math.cos(a) * g), g * (0.18 + 0.05 * Math.sin(t * 0.9 + k)));
      dmy.updateMatrix(); boatMesh.setMatrixAt(k, dmy.matrix);
    });
    boatMesh.instanceMatrix.needsUpdate = true;
  };
  sailAll(0);
  api.onUpdate(sailAll);

  // ---- houses south-west of the start straight and south of the park (low-rise terraces), instanced
  {
    const body = [], roof = [];
    const walls = ['#e9dcc6', '#d8c3a5', '#c98f6b', '#efe9df', '#b8a58c', '#dcd6cc'], roofs = ['#8e3b2e', '#5b5f66', '#9c4a36', '#6d6f73'];
    for (let n = 0, t2 = 0; n < 520 && t2 < 12000; t2++) {
      const x = R(minX - 420, maxX + 300), z = R(minZ + 200, maxZ + 420), p = { d: K.dist(x, z) };
      if (p.d < 130 || p.d > 520 || insideLoop(x, z) || x > 600 || (x > 0 && z < 300)) continue;   // suburbs west and south of the park
      if (!api.isFree(x, z, 7)) continue;
      const y = ground(x, z) - 0.1, ry = Math.round(rnd() * 4) * Math.PI / 2 + Math.PI / 4, w = R(7, 10), h = R(4.5, 8), dp = R(9, 14);
      body.push([x, y, z, ry, [w, h, dp], walls[(rnd() * walls.length) | 0]]);
      roof.push([x, y + h, z, ry, [w * 1.08, R(2, 3.2), dp * 1.05], roofs[(rnd() * roofs.length) | 0]]);
      api.block(x, z, 7);
      n++;
    }
    inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.85 }), body);
    const pr = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1).rotateZ(Math.PI / 2).scale(1, 1.4, 1);   // triangular prism roof
    pr.translate(0, 0.3, 0);
    inst(pr, new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true }), roof);
  }

  // ---- office towers along the park's east edge and the city skyline to the north
  const [wm] = K.windowTex(8, 16, { frame: '#c9ced6', glass: '#5c7896', lit: '#8fb3d6', litP: 0.3, seed: 11 });
  function towers(list, hazeK, fog) {
    const G = [], hz = new THREE.Color(env.fog.color);
    for (const [x, z, w, d, h, col, crown] of list) {
      const g = new THREE.BoxGeometry(w, h, d).translate(x, h / 2 + ground(x, z) - 1, z);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.round(w / 6), uv.getY(k) * Math.round(h / 4));
      const c = new THREE.Color(col).lerp(hz, hazeK), a = new Float32Array(g.attributes.position.count * 3);
      for (let k = 0; k < a.length; k += 3) c.toArray(a, k);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      G.push(g.toNonIndexed());
      if (crown) {   // tall gold-crowned landmark tower
        const cg = new THREE.BoxGeometry(w * 0.8, h * 0.08, d * 0.8).translate(x, h + h * 0.04 + ground(x, z) - 1, z);
        const cu = cg.attributes.uv; for (let k = 0; k < cu.count; k++) cu.setXY(k, 0, 0);
        const cc = new THREE.Color('#d4a940').lerp(hz, hazeK * 0.8), ca = new Float32Array(cg.attributes.position.count * 3);
        for (let k = 0; k < ca.length; k += 3) cc.toArray(ca, k);
        cg.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        G.push(cg.toNonIndexed());
      }
    }
    const m = new THREE.Mesh(mergeGeometries(G), new THREE.MeshStandardMaterial({ map: wm, vertexColors: true, roughness: 0.4, metalness: 0.2, fog }));
    m.castShadow = fog; m.receiveShadow = fog;
    world.add(m);
    return m;
  }
  const east = [];
  for (let k = 0; k < 26; k++) {
    const x = R(640, 820), z = -1500 + k * 44 + R(-8, 8);
    east.push([x, z, R(20, 32), R(18, 28), R(28, 85), ['#d8d4cc', '#b9c4cf', '#e2ddd2', '#8fa3b5', '#c7b9a6'][k % 5]]);
  }
  towers(east, 0, true);
  const cbd = [];
  for (let k = 0; k < 70; k++) {   // Southbank + CBD cluster, tallest in the middle
    const x = R(-900, 700), z = R(-2750, -2250), c = 1 - Math.min(1, Math.abs(x + 100) / 800);
    cbd.push([x, z, R(28, 50), R(28, 50), 40 + c * R(60, 210) + R(0, 40), ['#b8c2cc', '#8f9fb0', '#d7d9dc', '#7d8b99', '#c9c1b3'][k % 5], false]);
  }
  cbd.push([-120, -2380, 36, 36, 290, '#5f6d7d', true]);
  towers(cbd, 0.55, false);

  // ---- hot-air balloons drifting over the park
  const balloons = [];
  const prof = [[1.3, 0], [2.2, 2], [4.6, 4.6], [7.6, 8.4], [9.2, 12], [9.1, 15.2], [7.4, 18.3], [4.2, 20.4], [0.01, 21.2]].map(([r, y]) => new THREE.Vector2(r, y));
  [['#e63946', '#ffd166'], ['#1f6feb', '#f1faee'], ['#2a9d8f', '#f4a261']].forEach(([a, b], k) => {
    const g = new THREE.LatheGeometry(prof, 16).toNonIndexed(), p = g.attributes.position, col = new Float32Array(p.count * 3), ca = new THREE.Color(a), cb = new THREE.Color(b);
    for (let v = 0; v < p.count; v += 3) {
      const mx = (p.getX(v) + p.getX(v + 1) + p.getX(v + 2)) / 3, mz = (p.getZ(v) + p.getZ(v + 1) + p.getZ(v + 2)) / 3;
      const c = Math.floor((Math.atan2(mz, mx) / TAU + 1) * 8) % 2 ? ca : cb;
      for (let j = 0; j < 3; j++) c.toArray(col, (v + j) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    const bl = new THREE.Mesh(mergeGeometries([g, part(new THREE.BoxGeometry(1.8, 1.3, 1.8), '#6b4a2b', 0, -3.4, 0)]), vc({ roughness: 0.7, side: THREE.DoubleSide }));
    bl.scale.setScalar(1.3);
    world.add(bl);
    balloons.push({ bl, x: R(-500, 400), z: R(-1500, -200), y: 110 + k * 30, vx: R(1.5, 2.5), vz: R(-0.8, 0.8), ph: k * 2 });
  });
  const drift = dt => {
    for (const q of balloons) {
      q.x += q.vx * dt; q.z += q.vz * dt;
      if (q.x > 900) q.x = -900;
      q.bl.position.set(q.x, q.y + Math.sin(t * 0.3 + q.ph) * 3, q.z);
      q.bl.rotation.y = t * 0.03 + q.ph;
    }
  };
  drift(0);   // in place from the first frame (otherwise they sit on the start line until the first update)
  api.onUpdate(drift);
}

export default { base: 'forest', env, baseBuild: false, build };
