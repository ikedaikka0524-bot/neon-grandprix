// Course world: sky, lights, terrain, road, curbs, barriers, start gantry (shared), then the theme's scenery.
// The forest theme (the original circuit scenery) lives here; the others are theme-*.js ({ env, build }).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function noiseFill(g, w, h, base, amp) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

// ======================================================================================
// Themes
// ======================================================================================
const FOREST = {
  env: {
    sky: { top: '#2459bd', horizon: '#c6dbea', bottom: '#8fa98f' },
    fog: { color: '#c6dbea', near: 210, far: 1350 },
    sun: { dir: [-0.55, 0.66, -0.46], color: '#fff0d6', intensity: 2.7 }, hemi: { sky: '#cfe4ff', ground: '#4a6a36', intensity: 0.8 },
    exposure: 0.95,
    night: false,
    terrain: {
      base: '#467f30', hills: 16, rim: 90, rimColor: '#3f5d44',   // rim = distant forested ridges
      paint(g, w, h) {
        noiseFill(g, w, h, '#467f30', 30);
        for (let i = 0; i < 26; i++) {   // soft clover / dry patches so the 7 m tile does not read as flat paint
          const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 26, gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, Math.random() < 0.5 ? 'rgba(30,80,20,0.22)' : 'rgba(150,170,70,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
        }
        for (let i = 0; i < 1100; i++) { g.fillStyle = `rgba(${30 + Math.random() * 60},${95 + Math.random() * 70},${20 + Math.random() * 30},0.55)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 3); }
        for (let i = 0; i < 40; i++) { g.fillStyle = ['#fff6d8', '#ffe066', '#f4a3c0'][i % 3]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      },
    },
    road: { base: '#3b3e44', line: '#f1f1ec', edge: '#f1f1ec' }, shoulder: '#8e8878',
    barrier: 'ads',
    curb: ['#d7263d', '#f4f4f4'],
  },
  build(api) {   // grandstands, pit building, groves of pines + broadleaf trees, bushes, rocks, clouds, balloons
    const { track, rnd } = api, S = track.samples, N = track.N, W2 = track.width / 2, b = track.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    // less grey room light keeps the greens saturated (set here, not as env.envIntensity: other themes inherit forest env keys)
    if (api.world.parent?.isScene) api.world.parent.environmentIntensity = 0.38;
    const outward = i => (Math.sign(S[i].curv) >= 0 ? 1 : -1);   // right side = outside of a left turn
    const spots = [[30, 1], [Math.round(N * 0.47), outward(Math.round(N * 0.47))], [Math.round(N * 0.74), outward(Math.round(N * 0.74))]];
    for (const [i, sg] of spots) { const p = api.placeFacing(grandstand(44, rnd), i, sg * (W2 + 14)); api.block(p.x, p.z, 34); }
    const pit = api.placeFacing(pitBuilding(), 40, -(W2 + 21));
    api.block(pit.x, pit.z, 34);

    // corner side per sample: sign of the sharpest nearby curvature (0 = straight) -> keeps the inside of corners open
    const corner = new Int8Array(N);
    for (let i = 0; i < N; i++) {
      let m = 0;
      for (let k = -30; k <= 30; k += 3) { const c = S[(i + k + N) % N].curv; if (Math.abs(c) > Math.abs(m)) m = c; }
      corner[i] = Math.abs(m) > 1 / 160 ? Math.sign(m) : 0;
    }
    const nearI = (x, z) => {
      let bd = Infinity, bi = 0;
      for (let i = 0; i < N; i += 3) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
      return [Math.sqrt(bd), bi];
    };
    // tall things: >= 20 m behind the barrier on the inside of a corner (the chase camera looks across it)
    const tallOk = (x, z, d, i) => {
      const s = S[i], lat = (x - s.pos.x) * s.right.x + (z - s.pos.z) * s.right.z;
      return d >= W2 + 30 || corner[i] === 0 || Math.sign(lat) === corner[i];
    };
    const grove = (x, z) => Math.sin(x * 0.011 + 0.4) * Math.cos(z * 0.013 - 1.1) + 0.6 * Math.sin(x * 0.027 - z * 0.019 + 2);
    const dummy = new THREE.Object3D(), tc = new THREE.Color();

    // trees: pine cones (deep blue-green) in the grove cores and on the far ridges, round broadleaf crowns at the edges
    const PINES = 900, LEAFY = 800;
    const pineGeo = mergeGeometries([new THREE.ConeGeometry(2.5, 4.8, 7).translate(0, 3.6, 0), new THREE.ConeGeometry(1.9, 3.8, 7).translate(0, 5.7, 0), new THREE.ConeGeometry(1.2, 2.6, 7).translate(0, 7.4, 0)]);
    const leafyGeo = mergeGeometries([
      new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.2, 0), new THREE.IcosahedronGeometry(1.7, 0).translate(1.3, 3.5, 0.5),
      new THREE.IcosahedronGeometry(1.6, 0).translate(-1.1, 3.7, -0.6), new THREE.IcosahedronGeometry(1.4, 0).translate(0.2, 5.6, -0.3),
    ]);
    const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    const pines = new THREE.InstancedMesh(pineGeo, leafMat, PINES), leafy = new THREE.InstancedMesh(leafyGeo, leafMat, LEAFY);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.34, 2.8, 6, 1, true).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 0.9 }), PINES + LEAFY);
    let np = 0, nl = 0, tries = 0;
    while ((np < PINES || nl < LEAFY) && tries++ < 60000) {
      const x = cx + (rnd() - 0.5) * 1700, z = cz + (rnd() - 0.5) * 1700;
      const gv = grove(x, z);
      if (rnd() > 0.04 + 0.96 * smooth(-0.1, 0.75, gv)) continue;   // clumps + clearings instead of an even sprinkle
      const [d, i] = nearI(x, z);
      if (d > 260 && rnd() < 0.4) continue;   // spend most trees where the player can see them
      if (d > 640 || !api.isFree(x, z, 3.5) || !tallOk(x, z, d, i)) continue;
      const y = api.groundAt(x, z);
      const pine = rnd() < smooth(0.1, 1.0, gv) * 0.75 + smooth(12, 50, y) * 0.6;
      if (pine ? np >= PINES : nl >= LEAFY) continue;
      const sc = (0.75 + rnd() * 0.8) * (d > 300 ? 1.35 : 1);   // far ridge trees a bit bigger so they read as forest
      dummy.position.set(x, y - 0.3, z);
      dummy.rotation.set((rnd() - 0.5) * 0.08, rnd() * TAU, (rnd() - 0.5) * 0.08);
      dummy.scale.set(sc, sc * (0.85 + rnd() * 0.4), sc);
      dummy.updateMatrix();
      trunks.setMatrixAt(np + nl, dummy.matrix);
      if (pine) {
        pines.setMatrixAt(np, dummy.matrix);
        pines.setColorAt(np++, tc.setHSL(0.3 + rnd() * 0.06, 0.38 + rnd() * 0.15, 0.15 + rnd() * 0.08));
      } else {
        leafy.setMatrixAt(nl, dummy.matrix);
        const r = rnd();   // a few autumn crowns for colour accents
        leafy.setColorAt(nl++, r < 0.05 ? tc.setHSL(0.07 + rnd() * 0.05, 0.75, 0.42) : r < 0.1 ? tc.setHSL(0.13, 0.7, 0.42) : tc.setHSL(0.25 + rnd() * 0.07, 0.5 + rnd() * 0.15, 0.2 + rnd() * 0.09));
      }
    }
    pines.count = np; leafy.count = nl; trunks.count = np + nl;
    for (const m of [pines, leafy, trunks]) { m.castShadow = m.receiveShadow = true; api.world.add(m); }

    // low bushes just behind the ad boards (never taller than ~1.6 m, so they frame the road without hiding it)
    const BUSH = 700;
    const bushes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), BUSH);
    let nb = 0;
    for (let t = 0; t < BUSH * 4 && nb < BUSH; t++) {
      const s = S[Math.floor(rnd() * N)], sg = rnd() < 0.5 ? 1 : -1, lat = sg * (W2 + 13 + rnd() * 16);
      const x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat, r = 0.7 + rnd() * 0.9;
      if (!api.isFree(x, z, r)) continue;
      dummy.position.set(x, api.groundAt(x, z) + r * 0.25, z);
      dummy.rotation.set(rnd(), rnd() * TAU, rnd());
      dummy.scale.set(r * (1.1 + rnd() * 0.6), r * 0.65, r * (1.1 + rnd() * 0.6));
      dummy.updateMatrix();
      bushes.setMatrixAt(nb, dummy.matrix);
      bushes.setColorAt(nb++, tc.setHSL(0.29 + rnd() * 0.06, 0.5 + rnd() * 0.15, 0.11 + rnd() * 0.07));
    }
    bushes.count = nb;
    bushes.castShadow = bushes.receiveShadow = true;
    api.world.add(bushes);

    // boulders in the meadows, half sunk
    const ROCKS = 90;
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), ROCKS);
    let nr = 0;
    for (let t = 0; t < 3000 && nr < ROCKS; t++) {
      const x = cx + (rnd() - 0.5) * 1100, z = cz + (rnd() - 0.5) * 1100, r = 0.8 + rnd() * rnd() * 3.2;
      const [d, i] = nearI(x, z);
      if (d > 420 || !api.isFree(x, z, r + 1) || (r > 2 && !tallOk(x, z, d, i))) continue;
      dummy.position.set(x, api.groundAt(x, z) - r * 0.35, z);
      dummy.rotation.set(rnd() * TAU, rnd() * TAU, rnd() * TAU);
      dummy.scale.set(r * (1 + rnd() * 0.4), r * (0.6 + rnd() * 0.3), r);
      dummy.updateMatrix();
      rocks.setMatrixAt(nr, dummy.matrix);
      rocks.setColorAt(nr++, tc.setHSL(0.1, 0.06, 0.42 + rnd() * 0.14));
    }
    rocks.count = nr;
    rocks.castShadow = rocks.receiveShadow = true;
    api.world.add(rocks);

    // cloud deck: one big fogged plane, drifting (fog fades it into the horizon, so its edge never shows)
    const cloudTex = api.canvasTex(512, 512, (g, w, h) => {
      for (let c = 0; c < 22; c++) {
        const ox = rnd() * w, oy = rnd() * h, n = 5 + Math.floor(rnd() * 9), sp = 18 + rnd() * 46;
        for (let k = 0; k < n; k++) {
          const x = ox + (rnd() - 0.5) * sp * 2, y = oy + (rnd() - 0.5) * sp * 0.7, r = 12 + rnd() * 30;
          for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {   // wrap so the tile is seamless
            const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
            gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
          }
        }
      }
    });
    cloudTex.repeat.set(4, 4);
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: cloudTex, color: 0xf6f8fb, transparent: true, depthWrite: false }));
    clouds.position.set(cx, 240, cz);
    clouds.renderOrder = -5;
    api.world.add(clouds);

    // hot-air balloons drifting around the valley: the course's landmark silhouettes
    const balloons = [];
    const profile = [[1.3, 0], [2.2, 2], [4.6, 4.6], [7.6, 8.4], [9.2, 12], [9.1, 15.2], [7.4, 18.3], [4.2, 20.4], [0.01, 21.2]].map(([r, y]) => new THREE.Vector2(r, y));
    const envGeo = new THREE.LatheGeometry(profile, 20);
    const basketGeo = mergeGeometries([
      new THREE.BoxGeometry(1.8, 1.3, 1.8).translate(0, -3.4, 0),
      ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, c]) => new THREE.CylinderGeometry(0.05, 0.05, 3.6, 4).translate(0, -1.2, 0).rotateZ(-a * 0.18).rotateX(c * 0.18).translate(a * 0.55, 0, c * 0.55)),
    ]);
    const basketMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const schemes = [['#e63946', '#ffd166'], ['#118ab2', '#f1faee'], ['#8338ec', '#ff8fa3'], ['#06d6a0', '#ffb703']];
    schemes.forEach(([a, c], k) => {
      const tex = api.canvasTex(256, 128, (g, w, h) => {
        for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? a : c; g.fillRect(i * w / 12, 0, w / 12 + 1, h); }
        g.fillStyle = a; g.fillRect(0, h * 0.44, w, h * 0.1);
        g.fillStyle = '#f7f3ea'; g.fillRect(0, h * 0.4, w, h * 0.04); g.fillRect(0, h * 0.54, w, h * 0.04);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, w, h * 0.08);
      }, false);
      const bl = new THREE.Group();
      bl.add(new THREE.Mesh(envGeo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide })), new THREE.Mesh(basketGeo, basketMat));
      const ang = k / schemes.length * TAU + 0.6, rad = 330 + k * 55;
      bl.scale.setScalar(1.2 + (k % 2) * 0.25);
      api.world.add(bl);
      balloons.push({ bl, ang, rad, y: 70 + k * 22, ph: k * 1.7 });
    });
    let t = 0;
    const moveBalloons = dt => {
      t += dt;
      for (const q of balloons) {
        const a = q.ang + t * 0.006;
        q.bl.position.set(cx + Math.cos(a) * q.rad, q.y + Math.sin(t * 0.35 + q.ph) * 2.5, cz + Math.sin(a) * q.rad);
        q.bl.rotation.y = t * 0.05 + q.ph;
      }
      cloudTex.offset.x = t * 0.0012; cloudTex.offset.y = t * 0.0005;
    };
    moveBalloons(0);
    api.onUpdate(moveBalloons);
  },
};

// Exported so a test page can register an extra theme; the course themes load on first use.
export const THEMES = { forest: Promise.resolve(FOREST) };
const themeFails = {};
function loadTheme(name) {
  // a failed fetch stays failed in the module map under its URL: after a failure, the next race retries with a fresh one
  const p = THEMES[name] ??= import(`./theme-${name}.js${themeFails[name] ? `?retry=${themeFails[name]}` : ''}`).then(m => {
    if (!m.default?.env || typeof m.default.build !== 'function') throw new Error('bad theme module');
    return m.default;
  });
  return Promise.resolve(p).catch(err => {   // a broken theme must not stop the race
    console.warn(`[world] theme '${name}' failed, using forest`, err);
    if (THEMES[name] === p) { delete THEMES[name]; themeFails[name] = (themeFails[name] || 0) + 1; }
    return FOREST;
  });
}

// Missing env fields fall back to the forest look (the ground painter is never inherited).
function mergeEnv(env = {}) {
  const F = FOREST.env, out = { ...F, ...env };
  for (const k of ['sky', 'fog', 'sun', 'hemi', 'road']) out[k] = { ...F[k], ...env[k] };
  out.terrain = { ...F.terrain, paint: null, ...env.terrain };
  return out;
}

// ======================================================================================
// buildWorld
// ======================================================================================
export async function buildWorld(ctx, def) {
  const theme = await loadTheme(def.theme || 'forest');
  if (ctx.dead) return { update() {} };   // race stopped while the theme was loading
  const env = ctx.env = mergeEnv(theme.env);
  const { track, world, scene, renderer } = ctx;
  const S = track.samples, N = track.N, W = track.width, W2 = W / 2, night = !!env.night;
  const rnd = seeded(20260924);
  const col = c => new THREE.Color(c);

  // reflections, exposure
  const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  ctx.envRT = pmrem.fromScene(room, 0.04);
  room.dispose?.();
  pmrem.dispose();
  scene.environment = ctx.envRT.texture;
  scene.environmentIntensity = env.envIntensity ?? (night ? 0.18 : 0.55);
  renderer.toneMappingExposure = env.exposure ?? 1.05;

  // sky + fog + lights
  const sunDir = ctx.sunDir = new THREE.Vector3(...env.sun.dir).normalize();
  scene.fog = new THREE.Fog(col(env.fog.color), env.fog.near, env.fog.far);
  scene.background = col(env.fog.color);
  const sky = ctx.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
    uniforms: {
      top: { value: col(env.sky.top) }, horizon: { value: col(env.sky.horizon) }, bottom: { value: col(env.sky.bottom) },
      sunDir: { value: sunDir }, sunCol: { value: col(env.sun.color) }, glow: { value: night ? 0.35 : 1 }, stars: { value: night ? 1 : 0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; uniform float stars; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = d.y;
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.5));
        c = mix(c, bottom, clamp(-h * 4.0, 0.0, 1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * glow * (pow(s, 1200.0) * 8.0 + pow(s, 30.0) * 0.4 + pow(s, 4.0) * 0.08);
        if (stars > 0.0) { float r = fract(sin(dot(floor(d * 300.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          c += vec3(0.9, 0.95, 1.0) * step(0.9975, r) * stars * smoothstep(0.02, 0.3, h) * (0.4 + 0.6 * fract(r * 97.0)); }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  world.add(sky);
  world.add(new THREE.HemisphereLight(col(env.hemi.sky), col(env.hemi.ground), env.hemi.intensity));
  const sun = ctx.sun = new THREE.DirectionalLight(col(env.sun.color), env.sun.intensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  world.add(sun, sun.target);

  // terrain: flat shelf along the road, hills beyond, a rim of mountains / dunes around the course
  const { minX, maxX, minZ, maxZ } = track.bounds, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const T = env.terrain, H = T.hills ?? 12;
  const R0 = Math.max(...S.map(s => Math.hypot(s.pos.x - cx, s.pos.z - cz)));
  const rimA = Math.max(380, R0 + 150), rimB = rimA + 440;
  const near = (x, z) => {
    let bd = Infinity, by = 0;
    for (let i = 0; i < N; i += 3) { const p = S[i].pos, d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; by = p.y; } }
    return [Math.sqrt(bd), by];
  };
  const groundY = (x, z, dist, ny) => {
    const f = smooth(W2 + 14, W2 + 70, dist);
    const hills = (Math.sin(x * 0.012 + 1.3) * Math.cos(z * 0.014 - 0.7) * 0.5 + 0.5) * H + Math.sin(x * 0.033 + z * 0.021) * H / 6;
    const rim = smooth(rimA, rimB, Math.hypot(x - cx, z - cz)) * (T.rim ?? 75);
    const y = lerp(ny - 0.2, ny * 0.5 + hills + rim, f);
    return T.height ? T.height(x, z, y, dist) : y;   // optional theme reshaping (sea, flat city blocks...)
  };
  const groundAt = ctx.groundAt = (x, z) => { const [d, y] = near(x, z); return groundY(x, z, d, y); };
  const SIZE = Math.max(1800, Math.ceil(2 * (rimB + 80) / 10) * 10), SEG = SIZE / 10;
  const gg = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2).translate(cx, 0, cz);
  const gp = gg.attributes.position, gcol = new Float32Array(gp.count * 3), rc = col(T.rimColor || '#cecbc8');
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), [d, ny] = near(x, z), y = groundY(x, z, d, ny);
    gp.setY(i, y);
    const v = 0.82 + 0.28 * (Math.sin(x * 0.045) * Math.cos(z * 0.039) * 0.5 + 0.5) + (rnd() - 0.5) * 0.06;
    const rock = smooth(20, 70, y - ny * 0.5);
    gcol[i * 3] = lerp(v * 0.95, rc.r, rock); gcol[i * 3 + 1] = lerp(v, rc.g, rock); gcol[i * 3 + 2] = lerp(v * 0.9, rc.b, rock);
  }
  gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  gg.computeVertexNormals();
  const groundTex = canvasTex(256, 256, (g, w, h) => { if (T.paint) { g.fillStyle = T.base; g.fillRect(0, 0, w, h); T.paint(g, w, h); } else noiseFill(g, w, h, T.base, 30); });
  groundTex.repeat.set(SIZE / 7, SIZE / 7);
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  world.add(ground);

  // ribbons along the track
  const vScale = track.length / Math.round(track.length / 12);
  function ribbon(latA, latB, dyA, dyB, opt = {}) {
    const pos = [], uv = [], cl = [];
    for (let i = 0; i < N; i++) {
      if (opt.filter && !opt.filter(i)) continue;
      const a = S[i], b = S[(i + 1) % N];
      const P = (s, lat, dy) => [s.pos.x + s.right.x * lat, s.pos.y + dy, s.pos.z + s.right.z * lat];
      const a0 = P(a, latA, dyA), b0 = P(a, latB, dyB), a1 = P(b, latA, dyA), b1 = P(b, latB, dyB);
      const v0 = i * track.spacing / (opt.vScale || vScale), v1 = (i + 1) * track.spacing / (opt.vScale || vScale);
      pos.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
      uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
      if (opt.color) { const c = opt.color(i); for (let k = 0; k < 6; k++) cl.push(c.r, c.g, c.b); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (cl.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    geo.computeVertexNormals();
    return geo;
  }
  const R = env.road;
  const roadTex = canvasTex(256, 512, (g, w, h) => {
    noiseFill(g, w, h, R.base, 26);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 10); }
    g.fillStyle = 'rgba(20,20,22,0.25)'; g.fillRect(w * 0.28, 0, w * 0.1, h); g.fillRect(w * 0.62, 0, w * 0.1, h);   // worn racing line
    g.fillStyle = R.edge;
    g.fillRect(w * 0.035, 0, w * 0.022, h); g.fillRect(w * 0.943, 0, w * 0.022, h);
    g.fillStyle = R.line;
    g.fillRect(w * 0.494, 0, w * 0.014, h * 0.45);
  });
  // night: faintly self-lit paint so the course still reads outside the headlight cone
  const road = new THREE.Mesh(ribbon(-W2, W2, 0.03, 0.03), new THREE.MeshStandardMaterial({
    map: roadTex, roughness: R.roughness ?? 0.82, metalness: 0.02, ...(night ? { emissive: 0xffffff, emissiveMap: roadTex, emissiveIntensity: 0.12 } : {}),
  }));
  road.receiveShadow = true;
  world.add(road);
  const shoulderMat = new THREE.MeshStandardMaterial({ color: col(env.shoulder), roughness: 0.95 });
  for (const sg of [1, -1]) {
    const m = new THREE.Mesh(ribbon(sg > 0 ? W2 - 0.02 : -W2 - 2.6, sg > 0 ? W2 + 2.6 : -W2 + 0.02, 0.0, 0.0), shoulderMat);
    m.receiveShadow = true;
    world.add(m);
  }
  // curbs where the corner is tight
  const tight = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (Math.abs(S[i].curv) > 1 / 130) for (let k = -14; k <= 14; k++) tight[(i + k + N) % N] = 1;
  const [ca, cb] = env.curb.map(col);
  const curbColor = i => (Math.floor(i * track.spacing / 2.2) % 2 ? ca : cb);
  const curbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  for (const [a, b, ya, yb] of [[W2 - 0.05, W2 + 1.4, 0.04, 0.12], [-W2 - 1.4, -W2 + 0.05, 0.12, 0.04]]) {
    const m = new THREE.Mesh(ribbon(a, b, ya, yb, { filter: i => tight[i], color: curbColor }), curbMat);
    m.receiveShadow = true;
    world.add(m);
  }

  buildBarriers({ THREE, world, track, env, night, rnd, col });
  buildStart(ctx, world, track);

  // theme scenery
  const blockers = [], updaters = [];
  const api = {
    THREE, world, track, def, env, rnd, night,
    near, groundAt, canvasTex,
    isFree: (x, z, r = 0) => near(x, z)[0] >= W2 + 12 + r && !blockers.some(b => (b.x - x) ** 2 + (b.z - z) ** 2 < (b.r + r) ** 2),
    block: (x, z, r) => { blockers.push({ x, z, r }); },
    placeFacing(obj, i, lat) {
      const s = S[((Math.round(i) % N) + N) % N];
      const x = s.pos.x + s.right.x * lat, z = s.pos.z + s.right.z * lat;
      const dx = -s.right.x * Math.sign(lat), dz = -s.right.z * Math.sign(lat);    // direction toward the track
      obj.position.set(x, s.pos.y - 0.2, z);
      obj.rotation.y = Math.atan2(-dx, -dz);                                        // local -Z faces the track
      world.add(obj);
      return { x, z };
    },
    onUpdate: fn => { updaters.push(fn); },
  };
  try { theme.build(api); } catch (err) { console.warn(`[world] theme '${def.theme}' build failed`, err); }
  return {
    update(dt, time) {
      for (let i = updaters.length - 1; i >= 0; i--) {
        try { updaters[i](dt, time); } catch (err) { console.warn('[world] theme update dropped', err); updaters.splice(i, 1); }
      }
    },
  };
}

// ======================================================================================
// Barriers (visual; the physical wall is in game.js at width/2 + wallGap, default 9.4)
// ======================================================================================
function buildBarriers({ THREE, world, track, env, night, rnd, col }) {
  const S = track.samples, N = track.N, W2 = track.width / 2, L = W2 + (track.def?.wallGap ?? 9.4) + 0.6;
  // vertical strip at lateral `lat`, y0..y1 above the centerline; u runs backwards on the right so text reads from the road
  const wall = (lat, y0, y1, uLen = 32) => {
    const pos = [], uv = [], sg = Math.sign(lat);
    for (let i = 0; i < N; i++) {
      const a = S[i], b = S[(i + 1) % N];
      const ax = a.pos.x + a.right.x * lat, az = a.pos.z + a.right.z * lat, bx = b.pos.x + b.right.x * lat, bz = b.pos.z + b.right.z * lat;
      const u0 = -sg * i * track.spacing / uLen, u1 = -sg * (i + 1) * track.spacing / uLen;
      pos.push(ax, a.pos.y + y0, az, bx, b.pos.y + y0, bz, bx, b.pos.y + y1, bz, ax, a.pos.y + y0, az, bx, b.pos.y + y1, bz, ax, a.pos.y + y1, az);
      uv.push(u0, 0, u1, 0, u1, 1, u0, 0, u1, 1, u0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo;
  };
  const add = (geo, mat, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = true; world.add(m); return m; };
  const dummy = new THREE.Object3D();
  // one instance every `step` m on both sides; place(dummy, sample, side) sets the transform, may return a tint
  const along = (geo, mat, step, place) => {
    const k = Math.max(1, Math.round(step / track.spacing)), n = Math.floor(N / k);
    const im = new THREE.InstancedMesh(geo, mat, n * 2);
    let c = 0;
    for (const sg of [1, -1]) for (let j = 0; j < n; j++) {
      const s = S[j * k];
      dummy.position.set(0, 0, 0); dummy.rotation.set(0, Math.atan2(s.tan.x, s.tan.z), 0); dummy.scale.set(1, 1, 1);
      const tint = place(dummy, s, sg);
      dummy.updateMatrix();
      im.setMatrixAt(c, dummy.matrix);
      if (tint) im.setColorAt(c, tint);
      c++;
    }
    im.count = c;
    im.castShadow = im.receiveShadow = true;
    world.add(im);
    return im;
  };
  const at = (d, s, sg, lat, y) => d.position.set(s.pos.x + s.right.x * sg * lat, s.pos.y + y, s.pos.z + s.right.z * sg * lat);
  const style = env.barrier;

  if (style === 'guardrail') {
    const tex = canvasTex(8, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      [['#7c838d', 0], ['#eef1f5', 0.22], ['#8a919b', 0.5], ['#eef1f5', 0.78], ['#7c838d', 1]].forEach(([c, t]) => gr.addColorStop(t, c));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const railMat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
    for (const sg of [1, -1]) add(wall(sg * L, 0.42, 0.86, 4), railMat);
    along(new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.55, 0), new THREE.MeshStandardMaterial({ color: 0x5d636d, metalness: 0.5, roughness: 0.5 }), 4,
      (d, s, sg) => { at(d, s, sg, L + 0.14, -0.25); });
  } else if (style === 'neon') {
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171f, metalness: 0.4, roughness: 0.4, side: THREE.DoubleSide });
    const [c0, c1] = env.curb.map(col);
    const glowA = new THREE.MeshBasicMaterial({ color: c0, toneMapped: false, side: THREE.DoubleSide });
    const glowB = new THREE.MeshBasicMaterial({ color: c1, toneMapped: false, side: THREE.DoubleSide });
    for (const sg of [1, -1]) {
      add(wall(sg * L, -0.3, 0.95), dark);
      add(wall(sg * (L - 0.04), 0.66, 0.8), glowA, false);
      add(wall(sg * (L - 0.04), 0.1, 0.17), glowB, false);
    }
  } else if (style === 'rock') {
    const base = col(env.terrain.rimColor || '#8d8378'), tc = new THREE.Color();
    along(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), 2.3, (d, s, sg) => {
      const sx = 1.1 + rnd() * 0.7, sy = 0.7 + rnd() * 0.6, sz = 1.2 + rnd() * 0.8;
      at(d, s, sg, L + 0.2 + sx * 0.9, -0.3 + sy * 0.35);
      d.rotation.set(rnd() * 0.5, d.rotation.y + rnd() * TAU, rnd() * 0.5);
      d.scale.set(sx, sy, sz);
      return tc.copy(base).multiplyScalar(0.55 + rnd() * 0.35);
    });
  } else if (style === 'snowbank') {
    // rounded bank, lumpy along the track: profile [lateral beyond W2, height]
    const prof = [[9.5, -0.3], [9.8, 0.45], [10.3, 0.95], [11.1, 1.25], [12.1, 1.1], [13.1, 0.6], [14.1, 0.05], [14.8, -0.45]];
    const mat = new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 0.85 });
    for (const sg of [1, -1]) {
      const P = prof.length, pos = new Float32Array(N * P * 3), idx = [];
      for (let i = 0; i < N; i++) {
        const s = S[i], lump = 1 + 0.22 * Math.sin(i * 0.31 + sg) * Math.sin(i * 0.071 + 2 * sg);
        prof.forEach(([l, h], k) => {
          const lat = sg * (W2 + l);
          pos.set([s.pos.x + s.right.x * lat, s.pos.y + (h > 0 ? h * lump : h), s.pos.z + s.right.z * lat], (i * P + k) * 3);
        });
      }
      for (let i = 0; i < N; i++) for (let k = 0; k < P - 1; k++) {
        const a = i * P + k, b = ((i + 1) % N) * P + k;
        if (sg > 0) idx.push(a, a + 1, b, b, a + 1, b + 1); else idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      add(geo, mat);
    }
  } else if (style === 'fence') {
    const wood = canvasTex(64, 16, (g, w, h) => {
      noiseFill(g, w, h, '#8b6a48', 18);
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(60,40,22,${0.15 + Math.random() * 0.2})`; g.fillRect(0, Math.random() * h, w, 1); }
    });
    const mat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.9, side: THREE.DoubleSide });
    for (const sg of [1, -1]) { add(wall(sg * (L - 0.1), 0.5, 0.66, 3), mat); add(wall(sg * (L - 0.1), 0.95, 1.11, 3), mat); }
    along(new THREE.BoxGeometry(0.16, 1.4, 0.16).translate(0, 0.7, 0), new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.9 }), 2.8,
      (d, s, sg) => { at(d, s, sg, L, -0.25); });
  } else {   // 'ads'
    const adTex = canvasTex(1024, 128, (g, w, h) => {
      const ads = [['NITRO GP', '#e5383b'], ['スシ・ファントム', '#ff5d8f'], ['TURBO', '#1f6feb'], ['クロノ杯', '#7b2cbf']];
      ads.forEach(([txt, bg], i) => {
        const x = i * w / 4;
        g.fillStyle = bg; g.fillRect(x, 0, w / 4, h);
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(x, 0, w / 4, 10); g.fillRect(x, h - 10, w / 4, 10);
        g.fillStyle = '#fff'; g.font = 'bold 54px "Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(txt, x + w / 8, h / 2 + 2, w / 4 - 20);
      });
    });
    const adMat = new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.6, side: THREE.DoubleSide, ...(night ? { emissive: 0xffffff, emissiveMap: adTex, emissiveIntensity: 0.5 } : {}) });
    for (const sg of [1, -1]) add(wall(sg * L, -0.3, 1.05), adMat);
  }
}

// ======================================================================================
// Start / finish line, gantry with the start lamps (ctx.lamps), grid marks
// ======================================================================================
function buildStart(ctx, world, track) {
  const S = track.samples, N = track.N, W = track.width, W2 = W / 2;
  const s0 = S[0], h0 = Math.atan2(s0.tan.x, s0.tan.z);
  const checker = canvasTex(256, 32, g => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); }
  }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.position.copy(s0.pos).setY(s0.pos.y + 0.045);
  line.rotation.y = h0;
  line.receiveShadow = true;
  world.add(line);
  const gantry = new THREE.Group();
  gantry.position.copy(s0.pos);
  gantry.rotation.y = h0;
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.7, roughness: 0.35 });
  for (const sx of [1, -1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), steel); p.position.set(sx * (W2 + 1.6), 4, 0); p.castShadow = true; gantry.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(W + 4, 1.5, 0.9), steel);
  beam.position.y = 7.4; beam.castShadow = true; gantry.add(beam);
  const bannerTex = canvasTex(1024, 128, (g, w, h) => {
    g.fillStyle = '#10131a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < 8; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#fff' : '#111'; g.fillRect(x * 16, y * 32, 16, 32); g.fillRect(w - 128 + x * 16, y * 32, 16, 32); }
    g.fillStyle = '#ffd23f'; g.font = 'bold 72px "Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('スタート ／ ゴール', w / 2, h / 2 + 4, w - 300);
  }, false);
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: 0.35 });
  for (const sz of [1, -1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(W + 3.6, 1.3), bannerMat); b.position.set(0, 7.4, sz * 0.46); if (sz < 0) b.rotation.y = Math.PI; gantry.add(b); }
  ctx.lamps = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 3 });
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.15, 20).rotateX(Math.PI / 2), m);
    l.position.set((i - 2) * 1.0, 6.1, -0.5);
    gantry.add(l);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.3), steel);
    housing.position.set((i - 2) * 1.0, 6.1, -0.32);
    gantry.add(housing);
    ctx.lamps.push(m);
  }
  world.add(gantry);
  const gridMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const gridGeos = [];
  for (let slot = 0; slot < 8; slot++) {
    const back = 9 + Math.floor(slot / 2) * 8.5 + (slot % 2) * 4 - 2.6;
    const s = S[((Math.round((1 - back / track.length) * N) % N) + N) % N], lat = (slot % 2 ? -1 : 1) * 3.6;
    const g = new THREE.BoxGeometry(2.6, 0.02, 0.22).rotateY(Math.atan2(s.tan.x, s.tan.z));
    g.translate(s.pos.x + s.right.x * lat, s.pos.y + 0.04, s.pos.z + s.right.z * lat);
    gridGeos.push(g);
  }
  world.add(new THREE.Mesh(mergeGeometries(gridGeos), gridMat));
}

// ======================================================================================
// Forest landmarks
// ======================================================================================
function grandstand(len, rnd) {
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, roughness: 0.85 });
  const steps = [];
  for (let r = 0; r < 7; r++) steps.push(new THREE.BoxGeometry(len, 0.55 * (r + 1), 1.2).translate(0, 0.275 * (r + 1), r * 1.2));
  const base = new THREE.Mesh(mergeGeometries(steps), conc);
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.7, 0.32), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 7 * 70);
  const d = new THREE.Object3D(), c = new THREE.Color();
  // team shirts + neutrals instead of a rainbow; blocks of the same colour read as fan sections
  const shirts = ['#e63946', '#e63946', '#1d3557', '#457b9d', '#f1faee', '#ffb703', '#2a9d8f', '#3a3a3a', '#d9d4c7', '#ff7b00'];
  let n = 0;
  for (let r = 0; r < 7; r++) for (let k = 0; k < 70; k++) {
    if (rnd() < 0.18) continue;
    d.position.set(-len / 2 + 0.5 + k * (len - 1) / 69, 0.55 * (r + 1) + 0.35, r * 1.2 - 0.1);
    d.scale.set(1, 0.85 + rnd() * 0.35, 1);
    d.updateMatrix();
    crowd.setMatrixAt(n, d.matrix);
    const section = Math.floor(k / 14) % 3;
    crowd.setColorAt(n, c.set(rnd() < 0.45 ? ['#e63946', '#1f6feb', '#ffb703'][section] : shirts[Math.floor(rnd() * shirts.length)]).multiplyScalar(0.8 + rnd() * 0.25));
    n++;
  }
  crowd.count = n;
  g.add(crowd);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.5, metalness: 0.3 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.25, 9.5), roofMat);
  roof.position.set(0, 7.9, 3.4); roof.rotation.x = -0.06; roof.castShadow = true;
  g.add(roof);
  const posts = [];
  for (let x = -len / 2; x <= len / 2 + 0.1; x += len / 4) posts.push(new THREE.CylinderGeometry(0.14, 0.14, 7.9, 8).translate(x, 3.95, 7.6));
  const p = new THREE.Mesh(mergeGeometries(posts), roofMat);
  p.castShadow = true; g.add(p);
  // red fascia under the roof edge so the stand reads from far away
  const fascia = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.7, 0.2), new THREE.MeshStandardMaterial({ color: 0xd7263d, roughness: 0.5 }));
  fascia.position.set(0, 7.65, -1.3); g.add(fascia);
  return g;
}

function pitBuilding() {
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(64, 5.5, 12), new THREE.MeshStandardMaterial({ color: 0xf1f1f1, roughness: 0.6 }));
  wall.position.set(0, 2.75, 6); wall.castShadow = wall.receiveShadow = true; g.add(wall);
  const doorTex = canvasTex(64, 64, (g, w, h) => {   // roller shutter slats
    g.fillStyle = '#2a3140'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) { g.fillStyle = '#1a1f2a'; g.fillRect(0, y, w, 1); }
  }, false);
  const doors = [];
  for (let i = 0; i < 8; i++) doors.push(new THREE.BoxGeometry(6, 3.6, 0.2).translate(-28 + i * 8, 1.8, -0.05));
  g.add(new THREE.Mesh(mergeGeometries(doors), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.4 })));
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(64.2, 0.6, 12.2), new THREE.MeshStandardMaterial({ color: 0xe5383b, roughness: 0.5 }));
  stripe.position.set(0, 4.6, 6); g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(66, 0.3, 15), new THREE.MeshStandardMaterial({ color: 0x3a3f4b, roughness: 0.6 }));
  deck.position.set(0, 5.65, 5.2); deck.castShadow = true; g.add(deck);
  // glass race-control box + name board on the roof
  const glass = new THREE.Mesh(new THREE.BoxGeometry(24, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x1b3a52, roughness: 0.15, metalness: 0.6 }));
  glass.position.set(0, 7.1, 6); glass.castShadow = true; g.add(glass);
  const signTex = canvasTex(1024, 128, (g2, w, h) => {
    g2.fillStyle = '#10131a'; g2.fillRect(0, 0, w, h);
    g2.fillStyle = '#e5383b'; g2.fillRect(0, h - 14, w, 14);
    g2.fillStyle = '#ffffff'; g2.font = 'bold 76px "Hiragino Sans","Yu Gothic",sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.fillText('NEON GRAND PRIX  ピット', w / 2, h / 2 - 4, w - 60);
  }, false);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.75), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
  sign.position.set(0, 10.3, 5.2); sign.rotation.y = Math.PI; g.add(sign);
  return g;
}
