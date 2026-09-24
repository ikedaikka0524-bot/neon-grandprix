// Snow theme (フロスト・ピーク): snow-laden pines, dark rock crags, frozen lake, alpine lodge, ski lift, forested rim
// slopes below a ring of jagged peaks, snow falling around the camera, packed snow / ice along the road edges.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
// cheap smooth 3D pseudo-noise (-1..1), good enough to break up rock / peak silhouettes
const noise3 = (x, y, z) => Math.sin(x * 1.7 + Math.sin(z * 1.3) * 1.1) * Math.cos(y * 1.9 + x * 0.6) * 0.5
  + Math.sin(z * 2.9 + y * 1.4 + Math.cos(x * 2.3)) * 0.3 + Math.sin(x * 5.1 - z * 4.3 + y * 3.7) * 0.2;

const SNOW = '#eef3f9', SNOW_SHADE = '#d8e3ef', ROCK = '#3e4552', ROCK2 = '#555c69', PINE = '#1d3a2a', PINE2 = '#2a4d37', BARK = '#4a3426';

// smooth value noise on a period×period grid, tileable in both axes
function vnoise(period) {
  const t = Float32Array.from({ length: period * period }, Math.random), m = i => ((i % period) + period) % period;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => t[m(j) * period + m(i)];
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), sx), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), sx), sy);
  };
}

// draw fn at the 9 tile offsets so blotches crossing the edge stay seamless
function wrapped(w, h, fn) { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) fn(ox, oy); }

function paintSnow(g, w, h) {
  g.fillStyle = '#edf2f8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 24; i++) {        // soft blue hollows
    const x = Math.random() * w, y = Math.random() * h, r = 14 + Math.random() * 42;
    wrapped(w, h, (ox, oy) => {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, 'rgba(150,176,212,0.13)'); gr.addColorStop(1, 'rgba(150,176,212,0)');
      g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
    });
  }
  g.lineWidth = 1.2;                    // wind ripples
  for (let i = 0; i < 60; i++) {
    const x0 = Math.random() * w, y0 = Math.random() * h, len = 24 + Math.random() * 60, a = 0.05 + Math.random() * 0.08;
    wrapped(w, h, (ox, oy) => {
      g.strokeStyle = `rgba(130,158,198,${a})`;
      g.beginPath();
      for (let k = 0; k <= 10; k++) { const x = x0 + ox + k * len / 10, y = y0 + oy + Math.sin(k * 0.8 + i) * 2.5; k ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    });
  }
  const img = g.getImageData(0, 0, w, h), d = img.data;   // grain + glitter
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    if (Math.random() < 0.004) d[i] = d[i + 1] = d[i + 2] = 255;
  }
  g.putImageData(img, 0, 0);
}

const env = {
  sky: { top: '#1a5bd0', horizon: '#d3e5f6', bottom: '#eef3f9' },
  fog: { color: '#d4e3f2', near: 300, far: 2100 },
  sun: { dir: [0.45, 0.6, -0.66], color: '#fff5e6', intensity: 2.5 },
  hemi: { sky: '#bdd7ff', ground: '#eef3fa', intensity: 0.95 },
  exposure: 0.9,
  night: false,
  terrain: { base: '#e9eff7', paint: paintSnow, hills: 9, rim: 200, rimColor: '#c6d2e1' },
  road: { base: '#4f545d', line: '#eef3f8', edge: '#f3f7fb' },
  shoulder: '#dde6f0',
  barrier: 'snowbank',
  curb: ['#2a6fdb', '#f2f6fa'],
};

// ------------------------------------------------------------------------------------------------
function build(api) {
  const { THREE, world, track, def, rnd, groundAt, isFree, block, placeFacing, onUpdate, canvasTex } = api;
  const S = track.samples, N = S.length, W2 = def.width / 2, sp = track.length / N, BARRIER = W2 + 9.4;
  const RIGHT = S.map(s => new THREE.Vector3(-s.tan.z, 0, s.tan.x).normalize());
  const head = i => { const t = S[((i % N) + N) % N].tan; return Math.atan2(t.x, t.z); };
  const curv = S.map((_, i) => wrapAngle(head(i + 3) - head(i - 3)) / 6);          // heading change per sample, + = left
  const bend = curv.map((_, i) => { let b = 0; for (let k = -30; k <= 30; k += 3) b += curv[((i + k) % N + N) % N] * 3; return b; });
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (const s of S) {
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x); minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
    maxY = Math.max(maxY, s.pos.y);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const trackR = Math.max(...S.map(s => Math.hypot(s.pos.x - cx, s.pos.z - cz)));
  const rimA = Math.max(380, trackR + 150), rimB = rimA + 440;   // same rim as world.js terrain
  let lift = null;                                                // ski-lift line, kept clear of trees and crags
  const offLift = (x, z, r) => {
    if (!lift) return true;
    const t = clamp((x - lift.x0) * lift.ux + (z - lift.z0) * lift.uz, 0, lift.len);
    return Math.hypot(x - lift.x0 - lift.ux * t, z - lift.z0 - lift.uz * t) > r;
  };
  const nearest = (x, z) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < N; i += 3) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
    const p = S[bi].pos;
    return { i: bi, d: Math.sqrt(bd), lat: (x - p.x) * RIGHT[bi].x + (z - p.z) * RIGHT[bi].z };
  };
  // isFree + keep tall things ≥ 20 m beyond the barrier on the inside of corners (chase-camera sightlines)
  const clear = (x, z, r) => {
    if (!isFree(x, z, r)) return false;
    const n = nearest(x, z);
    if (n.d >= BARRIER + 20 + r) return true;
    const b = bend[n.i];
    return !(Math.abs(b) > 0.22 && b * n.lat < 0);
  };
  const beside = (i, lat) => ({ x: S[i].pos.x + RIGHT[i].x * lat, z: S[i].pos.z + RIGHT[i].z * lat });
  const minGround = (x, z, r) => Math.min(groundAt(x, z), ...[0, 1, 2, 3, 4, 5].map(k => groundAt(x + Math.cos(k) * r, z + Math.sin(k) * r)));
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // sky gradient used as an env map so ice and packed snow reflect blue sky instead of the studio room
  const skyEnv = canvasTex(256, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#2d69d6'); gr.addColorStop(0.42, '#9cc2ec'); gr.addColorStop(0.5, '#e4eef8'); gr.addColorStop(0.56, '#f2f6fa'); gr.addColorStop(1, '#dfe8f2');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, false);
  skyEnv.mapping = THREE.EquirectangularReflectionMapping;

  const snowMat = new THREE.MeshStandardMaterial({ color: SNOW, roughness: 0.92 });
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

  // shared point-size scale for the Points shaders (per viewport, so split screen works)
  const vp = new THREE.Vector4();
  const sizeHook = mat => (r, sc, cam) => { r.getCurrentViewport(vp); mat.uniforms.uScale.value = vp.w * cam.projectionMatrix.elements[5] * 0.5; };
  let clock = 0;
  const timed = [];
  onUpdate(dt => { clock += dt; for (const m of timed) m.uniforms.uTime.value = clock; });

  lodge();
  lake();
  skiLift();
  rocks();
  pines();
  peaks();
  roadGlaze();
  snowfall();

  // ---------------------------------------------------------------------------------------------- lodge
  function lodge() {
    const L = 14, D = 9, H = 4.6, RH = 3.8, R = 12;
    let spot = null;
    for (let i = Math.round(N * 0.025); i < N * 0.3 && !spot; i += 5) {
      for (const sg of [-1, 1]) for (let lat = W2 + 22; lat <= W2 + 44 && !spot; lat += 3) {
        const p = beside(i, sg * lat);
        if (clear(p.x, p.z, R)) spot = { i, lat: sg * lat, ...p };
      }
    }
    if (!spot) return;
    const g = new THREE.Group();
    const winX = [0.12, 0.34, 0.66, 0.88];
    const wallTex = canvasTex(512, 192, (c, w, h) => {
      for (let y = 0; y < h; y += 16) {   // logs
        c.fillStyle = (y / 16) % 2 ? '#6e4a2f' : '#7a5436'; c.fillRect(0, y, w, 16);
        c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, y + 14, w, 2);
        c.fillStyle = 'rgba(255,230,190,0.08)'; c.fillRect(0, y + 1, w, 3);
      }
      for (const u of winX) {
        const x = u * w - 26, y = 44;
        c.fillStyle = '#3a2416'; c.fillRect(x - 6, y - 6, 64, 88);
        const gr = c.createLinearGradient(0, y, 0, y + 76);
        gr.addColorStop(0, '#ffd488'); gr.addColorStop(1, '#ff9d3c');
        c.fillStyle = gr; c.fillRect(x, y, 52, 76);
        c.fillStyle = '#3a2416'; c.fillRect(x + 24, y, 4, 76); c.fillRect(x, y + 36, 52, 4);
        c.fillStyle = '#f4f7fb'; c.fillRect(x - 8, y + 80, 68, 7);   // snow on the sill
      }
    });
    const glowTex = canvasTex(512, 192, (c, w) => {
      c.fillStyle = '#000'; c.fillRect(0, 0, w, 192);
      for (const u of winX) { c.fillStyle = '#ffb45a'; c.fillRect(u * w - 26, 44, 52, 76); c.fillStyle = '#000'; c.fillRect(u * w - 2, 44, 4, 76); c.fillRect(u * w - 26, 80, 52, 4); }
    });
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: glowTex, emissiveIntensity: 1.4, roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#4b3020', roughness: 0.8 });
    const stoneMat = new THREE.MeshStandardMaterial({ color: '#7d828c', roughness: 0.95, flatShading: true });
    const walls = new THREE.Mesh(new THREE.BoxGeometry(L, H, D).translate(0, 0.9 + H / 2, D / 2), wallMat);
    const tri = new THREE.Shape([new THREE.Vector2(-D / 2, 0), new THREE.Vector2(D / 2, 0), new THREE.Vector2(0, RH)]);
    const gable = new THREE.ExtrudeGeometry(tri, { depth: L, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-L / 2, 0.9 + H, D / 2);
    const th = Math.atan2(RH, D / 2), slope = Math.hypot(D / 2, RH) + 1.3;
    const wood = [gable], snow = [], stone = [];
    for (const sz of [1, -1]) {
      const down = new THREE.Vector3(0, -Math.sin(th), Math.cos(th) * sz), up = new THREE.Vector3(0, Math.cos(th), Math.sin(th) * sz);
      const mid = new THREE.Vector3(0, 0.9 + H + RH / 2, D / 2 + sz * D / 4).addScaledVector(down, 0.6);
      const pl = (thick, off, len, wid) => new THREE.BoxGeometry(wid, thick, len).rotateX(sz * th)
        .translate(mid.x + up.x * off, mid.y + up.y * off, mid.z + up.z * off);
      wood.push(pl(0.3, 0.15, slope, L + 2.2));
      snow.push(pl(0.45, 0.5, slope - 0.25, L + 1.9));
    }
    // chimney + stone base + front deck, door, lamps
    stone.push(new THREE.BoxGeometry(L + 0.8, 3.6, D + 0.8).translate(0, -0.9, D / 2));
    stone.push(new THREE.BoxGeometry(1.3, 5.2, 1.3).translate(L * 0.3, 0.9 + H + RH * 0.55, D * 0.7));
    snow.push(new THREE.BoxGeometry(1.5, 0.35, 1.5).translate(L * 0.3, 0.9 + H + RH * 0.55 + 2.7, D * 0.7));
    wood.push(new THREE.BoxGeometry(L - 1, 0.25, 2.4).translate(0, 0.9, -1.2));       // deck with a gap for the steps
    for (let k = 0; k < 6; k++) wood.push(new THREE.BoxGeometry(0.2, 4.1, 0.2).translate(-6.5 + k * 2.6, 0, -2.3));   // posts, down into the snow
    for (const sx of [-1, 1]) wood.push(new THREE.BoxGeometry(5.2, 0.14, 0.14).translate(sx * 3.9, 2.0, -2.3));
    wood.push(new THREE.BoxGeometry(2.4, 2.6, 1.1).translate(0, -0.6, -2.9));
    wood.push(new THREE.BoxGeometry(1.8, 2.8, 0.2).translate(0, 0.9 + 1.4, -0.06));    // door
    for (let k = 0; k < 26; k++) {                                                      // icicles along both eaves
      const len = 0.35 + ((k * 7) % 5) * 0.14, x = -L / 2 - 0.6 + (k % 13) * (L + 1.2) / 12, zc = k < 13 ? -0.95 : D + 0.95;
      snow.push(new THREE.ConeGeometry(0.09, len, 4).rotateX(Math.PI).translate(x, 0.9 + H - 1.05 - len / 2, zc));
    }
    const toNI = a => a.map(x => (x.index ? x.toNonIndexed() : x));
    const add = (geos, mat) => { const m = new THREE.Mesh(mergeGeometries(toNI(geos)), mat); m.castShadow = m.receiveShadow = true; g.add(m); };
    add(wood, woodMat); add(snow, snowMat); add(stone, stoneMat);
    walls.castShadow = walls.receiveShadow = true;
    g.add(walls);
    const lampMat = new THREE.MeshStandardMaterial({ color: '#ffd9a0', emissive: '#ffb050', emissiveIntensity: 2.2 });
    for (const x of [-1.3, 1.3]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), lampMat); l.position.set(x, 3.3, -0.2); g.add(l); }
    const signTex = canvasTex(512, 96, (c, w, h) => {
      c.fillStyle = '#3a2416'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#c99a5b'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#ffe2a8'; c.font = 'bold 50px "Hiragino Sans","Yu Gothic",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('フロスト・ピーク ロッジ', w / 2, h / 2 + 2, w - 40);
    }, false);
    // signboard out front, facing the road
    const board = new THREE.Group();
    board.add(new THREE.Mesh(mergeGeometries(toNI([
      new THREE.BoxGeometry(0.22, 3.6, 0.22).translate(-2.5, 1.1, 0), new THREE.BoxGeometry(0.22, 3.6, 0.22).translate(2.5, 1.1, 0),
      new THREE.BoxGeometry(5.6, 1.4, 0.16).translate(0, 2.3, 0)])), woodMat));
    board.add(new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.2, 0.34).translate(0, 3.1, 0), snowMat));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.0), new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.25 }));
    sign.position.set(0, 2.3, -0.09); sign.rotation.y = Math.PI;
    board.add(sign);
    board.position.set(-L / 2 - 3, 0, -6); board.rotation.y = 0.3;
    g.add(board);
    // snowmen by the deck
    const sm = new THREE.Mesh(snowmanGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    sm.position.set(L / 2 + 2.5, 0, -3.2); sm.rotation.y = Math.PI + 0.5; sm.castShadow = true;
    const sm2 = sm.clone(); sm2.position.set(-L / 2 - 2.2, 0, -2.2); sm2.rotation.y = Math.PI - 0.7; sm2.scale.setScalar(0.75);
    g.add(sm, sm2);
    // chimney smoke
    g.add(smoke(new THREE.Vector3(L * 0.3, 0.9 + H + RH * 0.55 + 2.9, D * 0.7)));

    placeFacing(g, spot.i, spot.lat);
    if (!g.parent) world.add(g);
    g.position.y = groundAt(g.position.x, g.position.z) - 0.15;   // stone base reaches 2.7 m down for sloped ground
    g.updateMatrixWorld(true);
    for (const m of [sm, sm2, board]) { const w = m.getWorldPosition(new THREE.Vector3()); m.position.y = groundAt(w.x, w.z) - g.position.y - 0.1; }
    block(g.position.x, g.position.z, R + 4);
    block(g.position.x - Math.sin(g.rotation.y) * 15, g.position.z - Math.cos(g.rotation.y) * 15, 9);   // keep the view from the road open
  }

  function snowmanGeo() {
    const parts = [];
    const add = (geo, hex) => {
      const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) a.set([c.r, c.g, c.b], k * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    };
    add(new THREE.SphereGeometry(0.8, 14, 10).translate(0, 0.62, 0), '#f3f7fb');
    add(new THREE.SphereGeometry(0.56, 14, 10).translate(0, 1.62, 0), '#f3f7fb');
    add(new THREE.SphereGeometry(0.4, 14, 10).translate(0, 2.36, 0), '#f3f7fb');
    add(new THREE.ConeGeometry(0.08, 0.45, 6).rotateX(Math.PI / 2).translate(0, 2.36, 0.58), '#ff7a1a');
    for (const x of [-0.14, 0.14]) add(new THREE.SphereGeometry(0.05, 6, 4).translate(x, 2.48, 0.34), '#15171c');
    add(new THREE.TorusGeometry(0.42, 0.1, 6, 16).rotateX(Math.PI / 2).translate(0, 2.02, 0), '#d7263d');
    add(new THREE.CylinderGeometry(0.26, 0.3, 0.42, 12).translate(0, 2.86, 0), '#1c1f26');
    add(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 12).translate(0, 2.67, 0), '#1c1f26');
    return mergeGeometries(parts);
  }

  function smoke(at) {
    const n = 26, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([at.x, at.y, at.z], i * 3); seed[i] = i / n + Math.random() * 0.02; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; varying float vA;
        void main(){ float ph = fract(uTime * 0.06 + aSeed);
          vec3 p = position + vec3(sin(aSeed * 71.0) * 0.5 + ph * ph * 8.0 + sin(ph * 5.0 + aSeed * 9.0) * ph * 1.4, ph * 13.0, cos(aSeed * 53.0) * 0.5 - ph * 2.5);
          vA = (1.0 - ph) * smoothstep(0.0, 0.1, ph) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = mix(1.2, 6.5, ph) * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
        gl_FragColor = vec4(vec3(0.93, 0.94, 0.96), vA * smoothstep(0.5, 0.1, r)); }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    pts.onBeforeRender = sizeHook(mat);
    timed.push(mat);
    return pts;
  }

  // ---------------------------------------------------------------------------------------------- frozen lake
  function lake() {
    let best = null;
    for (let k = 0; k < 600; k++) {
      const R = 28 + rnd() * 26;
      const x = lerp(minX - 170, maxX + 170, rnd()), z = lerp(minZ - 170, maxZ + 170, rnd());
      const n = nearest(x, z);
      if (n.d < W2 + 14 + R * 1.25 || n.d > W2 + 14 + R * 1.25 + 25) continue;
      if (!isFree(x, z, R * 1.25)) continue;
      const hs = [groundAt(x, z)];
      for (let a = 0; a < 8; a++) hs.push(groundAt(x + Math.cos(a / 8 * TAU) * R, z + Math.sin(a / 8 * TAU) * R), groundAt(x + Math.cos(a / 8 * TAU + 0.4) * R * 0.55, z + Math.sin(a / 8 * TAU + 0.4) * R * 0.55));
      const spread = Math.max(...hs) - Math.min(...hs);
      const below = S[n.i].pos.y - hs[0];                       // lakes below the road read better from the car
      const score = spread / R - clamp(below, -5, 15) * 0.03 + (n.d - W2 - 14 - R * 1.25) * 0.01 - R * 0.004;
      if (!best || score < best.score) best = { x, z, R, score, i: n.i };
    }
    if (!best) return;
    const { x: lx, z: lz, R } = best;
    const K = 64, a0 = rnd() * TAU, a1 = rnd() * TAU;
    const rad = a => R * (1 + 0.13 * Math.sin(3 * a + a0) + 0.07 * Math.sin(5 * a + a1) + 0.04 * Math.sin(9 * a));
    let top = -Infinity;
    for (let k = 0; k < K; k++) { const a = k / K * TAU; for (const f of [0, 0.35, 0.7]) top = Math.max(top, groundAt(lx + Math.cos(a) * rad(a) * f, lz + Math.sin(a) * rad(a) * f)); }
    const y = top + 0.12;
    // ice: fan disc
    const pos = [lx, y, lz], uv = [0.5, 0.5], idx = [];
    for (let k = 0; k < K; k++) {
      const a = k / K * TAU, r = rad(a), c = Math.cos(a), s = Math.sin(a);
      pos.push(lx + c * r, y, lz + s * r); uv.push(0.5 + c * r / R * 0.45, 0.5 + s * r / R * 0.45);
      idx.push(0, 1 + (k + 1) % K, 1 + k);
    }
    const ig = new THREE.BufferGeometry();
    ig.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ig.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    ig.setIndex(idx);
    ig.computeVertexNormals();
    const iceTex = canvasTex(512, 512, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, '#4f93c0'); gr.addColorStop(0.55, '#79b3d6'); gr.addColorStop(0.85, '#b3d6ea'); gr.addColorStop(1, '#d7ebf6');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {      // frost / dusting patches
        const x = Math.random() * w, y2 = Math.random() * h, r = 10 + Math.random() * 50;
        const pg = g.createRadialGradient(x, y2, 0, x, y2, r);
        pg.addColorStop(0, 'rgba(240,247,252,0.45)'); pg.addColorStop(1, 'rgba(240,247,252,0)');
        g.fillStyle = pg; g.fillRect(x - r, y2 - r, 2 * r, 2 * r);
      }
      const crack = (x, y2, a, len, wdt, depth) => {   // branching cracks
        g.strokeStyle = `rgba(250,253,255,${0.35 + depth * 0.15})`; g.lineWidth = wdt;
        g.beginPath(); g.moveTo(x, y2);
        for (let s = 0; s < len; s += 6) { a += (Math.random() - 0.5) * 0.6; x += Math.cos(a) * 6; y2 += Math.sin(a) * 6; g.lineTo(x, y2); if (depth > 0 && Math.random() < 0.06) crack(x, y2, a + (Math.random() < 0.5 ? 1 : -1) * (0.6 + Math.random()), len * 0.45, wdt * 0.6, depth - 1); }
        g.stroke();
      };
      for (let i = 0; i < 9; i++) crack(w * (0.25 + Math.random() * 0.5), h * (0.25 + Math.random() * 0.5), Math.random() * TAU, 120 + Math.random() * 160, 1.6, 2);
    }, false);
    const ice = new THREE.Mesh(ig, new THREE.MeshStandardMaterial({ map: iceTex, roughness: 0.1, metalness: 0.05, envMap: skyEnv, envMapIntensity: 1.1 }));
    ice.receiveShadow = true;
    world.add(ice);
    // snowy bank from the ice edge down/up to the terrain (hides a floating edge on uneven ground)
    const bp = [], bi = [];
    for (let k = 0; k < K; k++) {
      const a = k / K * TAU, r = rad(a), c = Math.cos(a), s = Math.sin(a);
      const ox = lx + c * (r * 1.18 + 5), oz = lz + s * (r * 1.18 + 5);
      bp.push(lx + c * r * 0.97, y + 0.06, lz + s * r * 0.97, lx + c * (r + 1.2), y + 0.35, lz + s * (r + 1.2), ox, groundAt(ox, oz) - 0.25, oz);
      const A = k * 3, B = ((k + 1) % K) * 3;
      bi.push(A, B, A + 1, B, B + 1, A + 1, A + 1, B + 1, A + 2, B + 1, B + 2, A + 2);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setIndex(bi);
    bg.computeVertexNormals();
    const bank = new THREE.Mesh(bg, snowMat);
    bank.receiveShadow = true;
    world.add(bank);
    block(lx, lz, R * 1.3);
    const s0 = S[best.i].pos, dx = lx - s0.x, dz = lz - s0.z, dl = Math.hypot(dx, dz);   // no trees between road and lake
    for (let t = W2 + 22; t < dl - R; t += 10) block(s0.x + dx / dl * t, s0.z + dz / dl * t, 14);
  }

  // ---------------------------------------------------------------------------------------------- ski lift
  function skiLift() {
    const R0 = trackR + 130, LEN = 520, SPAN = 52;
    const h0 = head(0);
    let base = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8]) {
      const a = h0 + k * 0.35, ux = Math.sin(a), uz = Math.cos(a);
      const x0 = cx + ux * R0, z0 = cz + uz * R0;
      if (clear(x0, z0, 16) && clear(cx + ux * (R0 + LEN * 0.4), cz + uz * (R0 + LEN * 0.4), 10)) { base = { ux, uz, x0, z0 }; break; }
    }
    if (!base) return;
    const { ux, uz, x0, z0 } = base, px = uz, pz = -ux, yaw = Math.atan2(ux, uz);
    lift = { x0: x0 - ux * 16, z0: z0 - uz * 16, ux, uz, len: LEN + 32 };
    const towers = [];
    for (let s = 0; s <= LEN; s += SPAN) { const x = x0 + ux * s, z = z0 + uz * s; towers.push(new THREE.Vector3(x, groundAt(x, z), z)); }
    const TH = 13, ARM = 2.6;
    const steel = new THREE.MeshStandardMaterial({ color: '#39414f', metalness: 0.6, roughness: 0.45 });
    const tg = mergeGeometries([
      new THREE.CylinderGeometry(0.4, 0.7, TH + 3, 6).translate(0, (TH + 3) / 2 - 3, 0),
      new THREE.BoxGeometry(ARM * 2 + 0.8, 0.55, 0.55).translate(0, TH, 0),
      new THREE.BoxGeometry(0.3, 0.9, 1.4).translate(ARM, TH - 0.3, 0),
      new THREE.BoxGeometry(0.3, 0.9, 1.4).translate(-ARM, TH - 0.3, 0),
    ].map(x => x.toNonIndexed()));
    const tm = new THREE.InstancedMesh(tg, steel, towers.length);
    towers.forEach((t, i) => { dummy.position.copy(t); dummy.rotation.set(0, yaw, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); tm.setMatrixAt(i, dummy.matrix); });
    tm.castShadow = true;
    world.add(tm);
    // cables with sag, one polyline per direction
    const lines = [], paths = [[], []];
    [1, -1].forEach((side, si) => {
      const P = paths[si];
      for (let i = 0; i < towers.length - 1; i++) {
        const a = towers[i], b = towers[i + 1];
        for (let k = 0; k < 10; k++) {
          const t = k / 10;
          P.push(new THREE.Vector3(lerp(a.x, b.x, t) + px * ARM * side, lerp(a.y, b.y, t) + TH - 0.6 - Math.sin(t * Math.PI) * 1.4, lerp(a.z, b.z, t) + pz * ARM * side));
        }
      }
      const b = towers[towers.length - 1];
      P.push(new THREE.Vector3(b.x + px * ARM * side, b.y + TH - 0.6, b.z + pz * ARM * side));
      if (si) P.reverse();
      for (let i = 0; i < P.length - 1; i++) lines.push(P[i], P[i + 1]);
    });
    world.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), new THREE.LineBasicMaterial({ color: '#2a2f38' })));
    const cum = paths.map(P => { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + P[i].distanceTo(P[i - 1])); return c; });
    const at = (si, s, out) => {
      const P = paths[si], c = cum[si], L = c[c.length - 1];
      s = ((s % L) + L) % L;
      let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++;
      return out.copy(P[i]).lerp(P[i + 1], (s - c[i]) / (c[i + 1] - c[i] || 1));
    };
    const chairGeo = mergeGeometries([
      new THREE.BoxGeometry(0.08, 2.2, 0.08).translate(0, -1.1, 0),
      new THREE.BoxGeometry(1.8, 0.14, 0.7).translate(0, -2.2, 0.1),
      new THREE.BoxGeometry(1.8, 0.7, 0.1).translate(0, -1.9, 0.45),
    ].map(x => x.toNonIndexed()));
    const PER = 16, chairs = new THREE.InstancedMesh(chairGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), PER * 2);
    for (let j = 0; j < PER * 2; j++) chairs.setColorAt(j, col.set(j % 3 ? '#d7263d' : '#2a6fdb'));
    world.add(chairs);
    const tmp = new THREE.Vector3();
    const moveChairs = () => {
      for (let j = 0; j < PER * 2; j++) {
        const si = j % 2, L = cum[si][cum[si].length - 1];
        at(si, clock * 2.4 + (j >> 1) / PER * L, tmp);
        dummy.position.copy(tmp); dummy.rotation.set(0, yaw + (si ? Math.PI : 0), 0); dummy.scale.setScalar(1.3); dummy.updateMatrix();
        chairs.setMatrixAt(j, dummy.matrix);
      }
      chairs.instanceMatrix.needsUpdate = true;
    };
    moveChairs();
    onUpdate(moveChairs);
    // stations
    const woodMat = new THREE.MeshStandardMaterial({ color: '#5a3a26', roughness: 0.85 });
    const wood = [], snow = [];
    for (const [t, back] of [[towers[0], -1], [towers[towers.length - 1], 1]]) {
      const x = t.x + ux * back * 10, z = t.z + uz * back * 10, y = minGround(x, z, 5) - 0.4;
      const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
      wood.push(new THREE.BoxGeometry(9, 5.5, 7).translate(0, 2.75, 0).applyMatrix4(m));
      snow.push(new THREE.BoxGeometry(10.4, 0.7, 8.4).translate(0, 5.8, 0).applyMatrix4(m));
      wood.push(new THREE.CylinderGeometry(ARM + 0.4, ARM + 0.4, 0.5, 20).translate(0, TH - 0.6, back * -3.5).applyMatrix4(m));
      block(x, z, 8);
    }
    const ws = new THREE.Mesh(mergeGeometries(wood.map(x => x.toNonIndexed())), woodMat);
    const ss = new THREE.Mesh(mergeGeometries(snow.map(x => x.toNonIndexed())), snowMat);
    ws.castShadow = ss.castShadow = true;
    world.add(ws, ss);
    block(x0 + ux * LEN / 2, z0 + uz * LEN / 2, 8);
  }

  // ---------------------------------------------------------------------------------------------- rocks
  function rockGeo(detail, seed, stretch) {
    const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + noise3(x * 1.4 + seed, y * 1.6, z * 1.4 - seed) * 0.3;
      x *= k; y *= k; z *= k;
      if (y < -0.25) y = -0.25 + (y + 0.25) * 0.35;
      p.setXYZ(i, x, y * stretch, z);
    }
    g.computeVertexNormals();
    const nrm = g.attributes.normal, c = new Float32Array(p.count * 3), sn = new THREE.Color(SNOW), sh = new THREE.Color(SNOW_SHADE), r1 = new THREE.Color(ROCK), r2 = new THREE.Color(ROCK2);
    for (let f = 0; f < p.count; f += 3) {
      const ny = (nrm.getY(f) + nrm.getY(f + 1) + nrm.getY(f + 2)) / 3, hy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3;
      const j = Math.sin(f * 12.9898) * 0.5 + 0.5;
      const cc = ny > 0.62 - hy * 0.12 + j * 0.1 ? (ny > 0.8 ? sn : sh) : (j > 0.5 ? r1 : r2);
      for (let v = 0; v < 3; v++) c.set([cc.r, cc.g, cc.b], (f + v) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  function rocks() {
    const big = [], small = [], rim = [];
    const put = (list, x, z, sx, sy, sz, yaw, sink, y = minGround(x, z, Math.max(sx, sz) * 0.6)) => {
      dummy.position.set(x, y - sy * sink, z); dummy.rotation.set((rnd() - 0.5) * 0.15, yaw, (rnd() - 0.5) * 0.15);
      dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
      list.push(dummy.matrix.clone());
    };
    // crags / cliff walls along the course, preferring the outside of corners
    for (let t = 0; t < 600 && big.length < 40; t++) {
      const i = Math.floor(rnd() * N), b = bend[i];
      const side = Math.abs(b) > 0.22 ? (b > 0 ? 1 : -1) : (rnd() < 0.5 ? 1 : -1);
      const sx = 6 + rnd() * 8, sy = sx * (0.75 + rnd() * 0.5), sz = sx * (0.6 + rnd() * 0.3), r = sx * 1.25;
      const lat = side * (W2 + 13 + r + rnd() * 30), p = beside(i, lat);
      if (!clear(p.x, p.z, r)) continue;
      const yaw = Math.atan2(-S[i].tan.z, S[i].tan.x) + (rnd() - 0.5) * 0.6;
      put(big, p.x, p.z, sx, sy, sz, yaw, 0.3);
      block(p.x, p.z, r);
      for (let s = 0; s < 2; s++) {       // smaller companions
        const q = { x: p.x + Math.cos(yaw) * (rnd() - 0.5) * sx * 2.6, z: p.z - Math.sin(yaw) * (rnd() - 0.5) * sx * 2.6 };
        const k = 0.35 + rnd() * 0.35;
        if (clear(q.x, q.z, r * k)) put(big, q.x, q.z, sx * k, sy * k, sz * k * 1.2, rnd() * TAU, 0.3);
      }
    }
    // bigger crags further out on the hills
    for (let t = 0; t < 800 && big.length < 70; t++) {
      const i = Math.floor(rnd() * N), sx = 10 + rnd() * 12, r = sx * 1.25;
      const p = beside(i, (rnd() < 0.5 ? 1 : -1) * (W2 + 45 + r + rnd() * 120));
      if (!clear(p.x, p.z, r)) continue;
      put(big, p.x, p.z, sx, sx * (0.7 + rnd() * 0.5), sx * (0.6 + rnd() * 0.3), rnd() * TAU, 0.3);
      block(p.x, p.z, r);
    }
    // rock steps breaking up the big snow slopes of the rim: long along the contour, mostly buried
    for (let t = 0; t < 600 && rim.length < 44; t++) {
      const a = rnd() * TAU, rr = rimA + 110 + rnd() * 300, x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr, sx = 30 + rnd() * 40;
      if (!isFree(x, z, sx) || !offLift(x, z, sx + 12)) continue;
      put(rim, x, z, sx, sx * (0.7 + rnd() * 0.45), sx * (0.3 + rnd() * 0.15), a + Math.PI / 2 + (rnd() - 0.5) * 0.4, 0.2, (groundAt(x, z) + minGround(x, z, sx * 0.6)) / 2);
      block(x, z, sx);
    }
    // boulders in the snow
    for (let t = 0; t < 2000 && small.length < 110; t++) {
      const x = lerp(minX - 300, maxX + 300, rnd()), z = lerp(minZ - 300, maxZ + 300, rnd()), s = 0.7 + rnd() * rnd() * 3.5;
      if (!isFree(x, z, s * 1.3)) continue;
      put(small, x, z, s * (0.9 + rnd() * 0.4), s, s * (0.9 + rnd() * 0.3), rnd() * TAU, 0.25);
    }
    for (const [list, detail, stretch] of [[big, 2, 1.5], [small, 1, 0.75], [rim, 2, 0.5]]) {
      const m = new THREE.InstancedMesh(rockGeo(detail, detail * 3.1, stretch), vcMat, list.length);
      list.forEach((mx, i) => m.setMatrixAt(i, mx));
      m.castShadow = m.receiveShadow = true;
      world.add(m);
    }
  }

  // ---------------------------------------------------------------------------------------------- pines
  function pineGeo(low) {
    const parts = [], seg = low ? 5 : 8, paint = (geo, hex, jitter) => {
      const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { const v = 1 + (jitter ? (Math.sin(k * 7.13) * 0.5) * jitter : 0); a.set([c.r * v, c.g * v, c.b * v], k * 3); }
      geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    };
    if (!low) paint(new THREE.CylinderGeometry(0.22, 0.36, 2.6, 6, 1, true).translate(0, 1.2, 0), BARK, 0);
    const tiers = low ? [[2.8, 4.4, 0.6], [1.9, 3.8, 3.6], [1.05, 3.2, 6.4]] : [[2.9, 3.4, 1.6], [2.3, 3.0, 3.6], [1.6, 2.7, 5.5], [0.95, 2.3, 7.3]];
    tiers.forEach(([r, h, y], t) => {
      paint(new THREE.ConeGeometry(r, h, seg, 1, low || t > 0).translate(0, y + h / 2, 0), t % 2 ? PINE2 : PINE, 0.25);
      // snow cap: flatter cone sitting over the upper part of the tier, jagged lower rim, offset so ridges alternate
      const ch = h * 0.6, cap = new THREE.ConeGeometry(r * 0.84, ch, seg, 1, true).rotateY(Math.PI / seg);
      const p = cap.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) + Math.sin(i * 2.7 + t) * 0.18 * h);
      cap.computeVertexNormals();
      paint(cap.translate(0, y + h + 0.1 - ch / 2, 0), SNOW, 0.04);
    });
    return mergeGeometries(parts);
  }
  function pines() {
    const treeLine = maxY + 70;
    const dens = (x, z) => clamp(0.45 + 0.9 * (Math.sin(x * 0.019 + 1.7) * Math.cos(z * 0.016 - 0.4) * 0.6 + Math.sin((x + z) * 0.043 + 2.1) * 0.4), 0.04, 1);
    const grove = (x, z) => Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.013 + 1.1) * 0.7 + Math.sin((x - z) * 0.027) * 0.3;
    const plant = (low, max, pick, line = treeLine) => {
      const trees = new THREE.InstancedMesh(pineGeo(low), vcMat, max);
      let n = 0;
      for (let t = 0; t < 30000 && n < max; t++) {
        const q = pick();
        if (!q || !clear(q.x, q.z, 3 * q.sc) || !offLift(q.x, q.z, 9)) continue;
        const y = groundAt(q.x, q.z);
        if (y > line - rnd() * 30) continue;
        dummy.position.set(q.x, y - 0.3, q.z);
        dummy.rotation.set((rnd() - 0.5) * 0.06, rnd() * TAU, (rnd() - 0.5) * 0.06);
        dummy.scale.set(q.sc, q.sc * (0.9 + rnd() * 0.45), q.sc);
        dummy.updateMatrix();
        trees.setMatrixAt(n, dummy.matrix);
        const v = 0.88 + rnd() * 0.12;
        trees.setColorAt(n, col.setRGB(v, v, v * (1.0 + rnd() * 0.04)));
        n++;
      }
      trees.count = n;
      trees.castShadow = !low;
      trees.receiveShadow = !low;
      world.add(trees);
    };
    // detailed pines near the road, thinned into groves and clearings
    plant(false, 1300, () => {
      const p = beside(Math.floor(rnd() * N), (rnd() < 0.5 ? 1 : -1) * (W2 + 14 - Math.log(1 - rnd() * 0.97) * 60));
      return rnd() < dens(p.x, p.z) ? { ...p, sc: 0.75 + rnd() * 0.8 } : null;
    });
    // cheap pines forming dark forests on the far slopes
    plant(true, 1500, () => {
      const x = lerp(minX - 650, maxX + 650, rnd()), z = lerp(minZ - 650, maxZ + 650, rnd());
      return grove(x, z) > 0.15 && nearest(x, z).d > 120 ? { x, z, sc: 1 + rnd() * 0.8 } : null;
    });
    // forest fingers climbing the lower rim, thinning out towards the bare upper slopes
    plant(true, 1100, () => {
      const a = rnd() * TAU, u = rnd() ** 1.3, rr = rimA + 40 + u * 280;
      const finger = (0.5 + 0.5 * Math.sin(a * 19 + Math.sin(a * 5 + 1) * 2.5)) ** 3;
      if (rnd() > finger * (1.15 - u) + 0.03) return null;
      return { x: cx + Math.sin(a) * rr, z: cz + Math.cos(a) * rr, sc: 1.3 + rnd() * 1.0 };
    }, maxY + 150);
  }

  // ---------------------------------------------------------------------------------------------- mountain range
  // one continuous jagged ring rising from behind the rim: summits, rock where it is steep, snowfields where it is not
  function peaks() {
    const A = 360, r0 = rimB + 20, y0 = 175;
    const summits = Array.from({ length: 16 }, (_, k) => ({ a: (k + rnd() * 0.8) / 16 * TAU, amp: 90 + rnd() * 250, w: 0.09 + rnd() * 0.17 }));
    const ring = (a, f, s) => noise3(Math.cos(a) * f + s, s * 0.7, Math.sin(a) * f - s);
    const U = [0, 0.16, 0.31, 0.45, 0.57, 0.67, 0.76, 0.84, 0.9, 0.95, 1];
    const grid = [];   // grid[row][k] = [x, y, z]
    for (let k = 0; k < A; k++) {
      const a = k / A * TAU, sa = Math.sin(a), ca = Math.cos(a);
      let H = 340 + ring(a, 3, 1.3) * 40 + ring(a, 11, 4.1) * 12;
      for (const s of summits) { const d = Math.abs(wrapAngle(a - s.a)) / s.w; if (d < 1) H += s.amp * (1 - d) ** 1.5; }
      const rc = r0 + 360 + ring(a, 4, 2.2) * 70, spur = ring(a, 16, 0.6), spur2 = ring(a, 37, 3.3);
      const col = (r, y) => [cx + sa * r, y, cz + ca * r];
      U.forEach((u, j) => {
        const bulge = Math.sin(u * Math.PI);
        (grid[j] ??= [])[k] = col(lerp(r0, rc, u) - (spur * 45 + spur2 * 12) * bulge, y0 + (H - y0) * u ** 1.4 + (spur * 26 + spur2 * 8) * bulge * u);
      });
      (grid[U.length] ??= [])[k] = col(rc + 90, H - 110 - spur * 40);
      (grid[U.length + 1] ??= [])[k] = col(rc + 260, H - 380);
    }
    const pos = [];
    for (let j = 0; j < grid.length - 1; j++) for (let k = 0; k < A; k++) {
      const k1 = (k + 1) % A, a = grid[j][k], b = grid[j][k1], c = grid[j + 1][k], d = grid[j + 1][k1];
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);   // faces point inwards / up
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const nm = g.attributes.normal, n = pos.length / 3, c = new Float32Array(n * 3);
    const sn = new THREE.Color('#f4f7fc'), sh = new THREE.Color('#d3dfed'), r1 = new THREE.Color('#566072'), r2 = new THREE.Color('#465063');
    for (let f = 0; f < n; f += 3) {   // spatially smooth noise, so rock and snow form bands and couloirs, not a checkerboard
      const x = (pos[f * 3] + pos[f * 3 + 3] + pos[f * 3 + 6]) / 3, y = (pos[f * 3 + 1] + pos[f * 3 + 4] + pos[f * 3 + 7]) / 3, z = (pos[f * 3 + 2] + pos[f * 3 + 5] + pos[f * 3 + 8]) / 3;
      const q = noise3(x * 0.011, y * 0.017, z * 0.011), q2 = noise3(x * 0.031 + 5, y * 0.043, z * 0.031 - 2);
      const snow = nm.getY(f) + q * 0.28 + q2 * 0.08 > 0.6;
      const cc = snow ? (q2 > -0.25 ? sn : sh) : (q > 0 ? r1 : r2);
      for (let v = 0; v < 3; v++) c.set([cc.r, cc.g, cc.b], (f + v) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    world.add(new THREE.Mesh(g, vcMat));
  }

  // ---------------------------------------------------------------------------------------------- icy road edges
  function roadGlaze() {
    const W = def.width;
    const tex = canvasTex(128, 512, (g, w, h) => {
      const A = vnoise(10), B = vnoise(28), C = vnoise(64), I = vnoise(8);
      const img = g.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = y / h, e = Math.min(u, 1 - u) * W;            // metres from the road edge
        const n = A(u * 9, v * 10) * 0.5 + B(u * 22, v * 28) * 0.3 + C(u * 50, v * 64) * 0.2;
        const edge = clamp((2.8 - e) / 2.6, 0, 1);
        const snow = clamp((edge * 1.35 + (n - 0.5) * 1.3 - 0.3) * 2.4, 0, 1) * (0.8 + 0.2 * C(u * 50 + 7, v * 64));
        const ice = clamp((I(u * 6, v * 8) - 0.55) * 3, 0, 1) * 0.2 + 0.05;       // faint glaze over the lanes
        const a = Math.max(snow * 0.95, ice), k = snow * 0.95 >= ice ? 1 : 0, i = (y * w + x) * 4;
        d[i] = k ? 240 : 205; d[i + 1] = k ? 245 : 226; d[i + 2] = k ? 251 : 246; d[i + 3] = a * 255;
      }
      g.putImageData(img, 0, 0);
    });
    const rep = track.length / Math.max(1, Math.round(track.length / 42));
    const pos = [], uv = [], idx = [];
    const lat = W2 - 0.06;
    for (let i = 0; i <= N; i++) {
      const s = S[i % N], r = RIGHT[i % N], v = i * sp / rep;
      pos.push(s.pos.x - r.x * lat, s.pos.y + 0.06, s.pos.z - r.z * lat, s.pos.x + r.x * lat, s.pos.y + 0.06, s.pos.z + r.z * lat);
      uv.push(0, v, 1, v);
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.28, metalness: 0, envMap: skyEnv, envMapIntensity: 0.9,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    m.receiveShadow = true;
    world.add(m);
  }

  // ---------------------------------------------------------------------------------------------- snowfall
  function snowfall() {
    const n = 7000, BOX = 64, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], i * 3); seed[i] = Math.random(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    // flakes live in a lattice of period BOX and are wrapped into the box around the rendering camera,
    // so the same buffer serves every viewport and never needs a CPU update
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uBox: { value: BOX } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; uniform float uBox; varying float vA;
        void main(){
          vec3 p = position;
          p.y -= uTime * (1.3 + aSeed * 1.1);
          p.x += uTime * 1.1 + sin(uTime * 0.8 + aSeed * 40.0) * 0.9;
          p.z += cos(uTime * 0.6 + aSeed * 23.0) * 0.9;
          vec3 rel = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
          vec4 mv = viewMatrix * vec4(cameraPosition + rel, 1.0);
          float d = length(rel);
          vA = smoothstep(0.5 * uBox, 0.32 * uBox, d) * smoothstep(1.2, 3.5, d) * (0.65 + 0.35 * aSeed);
          gl_PointSize = min(16.0, (0.06 + aSeed * 0.06) * uScale / max(0.3, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;
        gl_FragColor = vec4(1.0, 1.0, 1.0, vA * smoothstep(0.5, 0.15, r)); }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 5;
    pts.onBeforeRender = sizeHook(mat);
    timed.push(mat);
    world.add(pts);
  }
}

export default { env, build };
