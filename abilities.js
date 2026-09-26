// Active abilities: gauges, effects written into car.mods, hazards (oil / timeslow) and all their visuals.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ABILITIES, CARS, CAR_BY_ID } from './data.js';
import { buildRobotMesh, buildCarMesh } from './carmodel.js';
import { getSave } from './save.js';
import { getDimension, makePortal, ORIGIN, RUN } from './tokyo-dimension.js';

const OIL_RADIUS = 3, OIL_BEHIND = 4.2;
const DRIFT_CHARGE = 1.2;   // extra gauge fill rate while drifting (stats.driftCharge)
const THUNDER_BOOST = 0.3;  // thunderbolt: own speedMul / accelMul bonus while active
const MAGNET_RANGE = 150, MAGNET_CATCH = 8;   // m along the track: pick a car ahead within range, pull until this close
const MAGNET_LEAD = { dur: 1, pow: 0.15 };    // nobody ahead: short weak boost instead
const MAGNET_DOCK = 16;   // m/s^2: the pull closes in no faster than this much braking could shed by MAGNET_CATCH
const DOMAIN_R = 45, DOMAIN_BOOST = 0.2, DOMAIN_MAX_SLOW = 0.6;
const ROBOT_T = 0.35, ROBOT_BOOST = 1.5;   // robotdash: transform time each way, boost after changing back
const KNOCK = { side: 12, spin: 0.4, keep: 0.7, again: 0.6 };   // robot hit: sideways m/s, spin s, speed kept, s before the same car again
// hellchain (m, s): pick a car ahead within range, snap when this close; tow spring point behind it, one lane beside it;
// chain flight time; max slow on the target; tow spring 1/s^2 and its cap (x power) m/s^2
// reel: extra closing speed over the target = min(reelMax, reel * (gap - follow)) x power/0.4 — the chain winds the owner in
const HELL = { range: 150, snap: 6, follow: 7, lane: 3, hook: 0.2, maxDrag: 0.6, k: 4, pull: 150, reel: 1.0, reelMax: 45 };
const HELL_SLING = { dur: 2, pow: 0.6, whip: 1.0 }, HELL_MISS = { dur: 1, pow: 0.15 };   // after the snap / nobody ahead or a shrugged-off chain
const LINKS = 240, LINK_PITCH = 0.36, CHAIN_SEG = 24;
// downforce, planted for its duration: full grip and steering at speed (game.js DF_STEER, mods.downforce = power), top +
// `top`, accel + `acc` (x power), no spin / knock / slow (mods.invulnerable). Slingshot: `turn` rad through a corner
// (|track curvature| > corner) fires it at the exit: accel + slingAcc, top + slingTop (x power) for `sling` s. Dirty air
// (乱気流): cars 2..wake m behind it, within wide (+ spread per m back) m of its line, heading its way, lose `grip` of their
// grip and get no slipstream from it (game.js); each client applies it to its own cars from the owner's ability state and
// pose (no messages). CPU rule: `twisty` rad of turning in the next `look` m. Value per use: CONTRACT.md 'Downforce (v8)'
const DF = { top: 0.45, acc: 1.0, corner: 1 / 250, turn: 0.25, sling: 2, slingAcc: 0.6, slingTop: 0.2, look: 300, twisty: 1.2, wake: 25, wide: 2.6, spread: 0.04, grip: 0.3 };
const CURB_CURV = 1 / 130, CURB_SPAN = 14;   // world.js lays curbs where |curv| exceeds this within ± this many samples
const COLOR = {
  boost: '#5fe3ff', nitro: '#ff9a3c', oil: '#b6ff3b', shield: '#5ef1ff',
  warp: '#6fe0ff', timeslow: '#c77dff', phase: '#ff8fd8', thunderbolt: '#ffe14d',
  magnet: '#ff4d6a', domain: '#b36bff', downforce: '#56c8ff', robotdash: '#ffb347', hellchain: '#ff5a1f', tokyodive: '#ff8a3d',
};
const pal = (...h) => h.map(x => new THREE.Color(x));
const PAL = {
  boost: pal('#f0fdff', '#7ae8ff', '#2aa8ff', '#3d6bff'),
  nitro: pal('#fff4c2', '#ffc04a', '#ff6a1f', '#ff3d1f', '#6ab8ff'),
  shield: pal('#e8feff', '#5ef1ff', '#2a9dff'),
  warp: pal('#ffffff', '#bff4ff', '#4cc9f0', '#3a6bff'),
  timeslow: pal('#f0dcff', '#c77dff', '#7b2cbf', '#5a3dff'),
  phase: pal('#ffe0f0', '#ff8fd8', '#9ffcff'),
  thunderbolt: pal('#ffffff', '#fff27a', '#ffd23f', '#9fe4ff', '#3a8bff'),
  magnet: pal('#ffffff', '#ff5a6e', '#ff2a3a', '#5a8bff', '#2a5bff'),
  domain: pal('#f3e0ff', '#c77dff', '#9b3dff', '#6a1fd0', '#3b1466'),
  downforce: pal('#ffffff', '#bff0ff', '#56c8ff', '#2a7bff'),
  robotdash: pal('#ffffff', '#fff1c9', '#ffb347', '#ff6b1a'),
  hellchain: pal('#fff2b0', '#ffb347', '#ff6a1f', '#ff2a10', '#b3120a'),
  tokyodive: pal('#ffffff', '#ffc27a', '#ff7a1a', '#ff2f9e', '#19f0e0'),
  oil: pal('#0b0a10', '#17131f', '#2b2438'),
  smoke: pal('#8a8f99', '#6b707a', '#a2a7b0'),
  spark: pal('#fff6b0', '#ffd23f', '#ffffff'),
};

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const r2 = v => Math.round(v * 100) / 100;
const clamp = THREE.MathUtils.clamp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const easeOut = k => 1 - (1 - k) ** 3;
const easeOutBack = k => 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2;
const smooth01 = k => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const isHuman = c => c.control === 'p1' || c.control === 'p2';
// robot form (incl. both transforms): immune, not slowed by hits, knocks others away
const isRobot = c => c.ability?.id === 'robotdash' && c.ability.active > 0 && c.ability.t < c.ability.robotDur + ROBOT_T;
// shield / phase / robot form shrug a hellchain off; so does diving into tokyodive's own space (no whip / slow in there)
// and its landing guard, and a planted downforce car (the chain can't hook it)
const chainProof = c => isRobot(c) || away(c) || diveGuard(c) || planted(c) || (c.ability?.active > 0 && (c.ability.id === 'shield' || c.ability.id === 'phase'));
// downforce (see DF): planted on the road - takes no spin, knock or slow (mods.invulnerable, like a shield; the face wall
// still holds it) and leaves dirty air behind it
const planted = c => c?.ability?.id === 'downforce' && c.ability.active > 0;
// tokyodive: off in its own space (a remote diver is just hidden here) - nothing can target or slow it meanwhile
const away = c => !!c?.ability?.away;
// tokyodive: just back on the road (ネオン・ブースト), still immune like a shield (DIVE.guard)
const diveGuard = c => c?.ability?.id === 'tokyodive' && c.ability.landed && c.ability.active > 0 && c.ability.t < DIVE.guard;
// reflect: this car's mirrors are up (every attack aimed at it bounces back, see REFLECT)
const mirrorOn = c => c?.ability?.id === 'reflect' && c.ability.active > 0;
// CPU 'hold' fallback (game.js): no attack while any car's mirrors are up (it would come back; cpuAbility checks its target)
export const mirrorBlocks = (race, id) => !!REFLECT[id] && race.cars.some(mirrorOn);
const halfLen = c => (c?.def?.len || 4.2) / 2;   // a longer vehicle (data.js len: the 6 m truck)
const flash = (race, text, color) => race.hud?.flash?.(text, color);
const who = (race, car) => (race.mode === 'split' ? (car.control === 'p1' ? 'P1 ' : 'P2 ') : '');
// a hit shrugged off: the shield's 'ガード!', or the downforce car's own name
const guardFlash = (race, car) => isHuman(car) && (planted(car) ? flash(race, who(race, car) + 'ダウンフォース!', COLOR.downforce) : flash(race, who(race, car) + 'ガード!', COLOR.shield));
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ---------- particles: one Points draw call per blend mode ----------
const PVERT = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
uniform float uScale; varying vec3 vC; varying float vA;
void main() {
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale * projectionMatrix[1][1] / max(-mv.z, 0.5);
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = `
uniform float uSoft; varying vec3 vC; varying float vA;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vC, vA * pow(1.0 - r, uSoft));
  #include <colorspace_fragment>
}`;
const STRIDE = 16; // pos3 vel3 col3 life maxLife size0 size1 grav drag alpha

class Particles {
  constructor(max, additive, soft) {
    this.max = max; this.n = 0; this.d = new Float32Array(max * STRIDE);
    const g = this.geo = new THREE.BufferGeometry();
    const attr = (name, k) => {
      const b = new THREE.BufferAttribute(new Float32Array(max * k), k).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, b);
      return b;
    };
    this.aPos = attr('position', 3); this.aCol = attr('aColor', 3); this.aSize = attr('aSize', 1); this.aAlpha = attr('aAlpha', 1);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uSoft: { value: soft } },
      vertexShader: PVERT, fragmentShader: PFRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
  }
  emit(x, y, z, vx, vy, vz, c, life, s0, s1, grav = 0, drag = 0, alpha = 1) {
    if (this.n >= this.max) return;
    const d = this.d, o = this.n++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = vx; d[o + 4] = vy; d[o + 5] = vz;
    d[o + 6] = c.r; d[o + 7] = c.g; d[o + 8] = c.b; d[o + 9] = life; d[o + 10] = life;
    d[o + 11] = s0; d[o + 12] = s1; d[o + 13] = grav; d[o + 14] = drag; d[o + 15] = alpha;
  }
  update(dt, scale) {
    const d = this.d, P = this.aPos.array, C = this.aCol.array, S = this.aSize.array, A = this.aAlpha.array;
    let i = 0;
    while (i < this.n) {
      const o = i * STRIDE;
      if ((d[o + 9] -= dt) <= 0) { this.n--; d.copyWithin(o, this.n * STRIDE, this.n * STRIDE + STRIDE); continue; }
      const k = Math.max(0, 1 - d[o + 14] * dt);
      d[o + 3] *= k; d[o + 4] = d[o + 4] * k - d[o + 13] * dt; d[o + 5] *= k;
      d[o] += d[o + 3] * dt; d[o + 1] += d[o + 4] * dt; d[o + 2] += d[o + 5] * dt;
      const f = d[o + 9] / d[o + 10];
      P[i * 3] = d[o]; P[i * 3 + 1] = d[o + 1]; P[i * 3 + 2] = d[o + 2];
      C[i * 3] = d[o + 6]; C[i * 3 + 1] = d[o + 7]; C[i * 3 + 2] = d[o + 8];
      S[i] = d[o + 12] + (d[o + 11] - d[o + 12]) * f;
      A[i] = d[o + 15] * Math.min(1, f * 1.6);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = true;
    this.mat.uniforms.uScale.value = scale;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

function burst(P, p, n, colors, speed, life, s0, s1, grav = 0, drag = 2, alpha = 1, up = 0) {
  for (let i = 0; i < n; i++) {
    const u = rnd(-1, 1), th = rnd(0, Math.PI * 2), r = Math.sqrt(1 - u * u), sp = speed * rnd(0.35, 1);
    P.emit(p.x, p.y, p.z, r * Math.cos(th) * sp, u * sp + up, r * Math.sin(th) * sp, pick(colors), life * rnd(0.6, 1), s0, s1, grav, drag, alpha);
  }
}

// ---------- shaders ----------
const SHIELD_VERT = `
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SHIELD_FRAG = `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uHit;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
float hexEdge(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508), h = r * 0.5;
  vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
  vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
  return smoothstep(0.41, 0.5, max(dot(g, normalize(r)), g.x));
}
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float hex = hexEdge(vec2(atan(vP.z, vP.x) * 1.9098593 + uTime * 0.15, vP.y * 3.2));
  float scan = smoothstep(0.95, 1.0, sin(vP.y * 6.0 - uTime * 4.0) * 0.5 + 0.5);
  float a = (0.05 + f * 0.85 + hex * (0.1 + f * 0.35) + scan * 0.3 + uHit * 0.6) * uOpacity;
  gl_FragColor = vec4(uColor * (0.7 + f + uHit), a);
  #include <colorspace_fragment>
}`;
// domain dome (unit hemisphere, seen from both sides): dark translucent shell, bright fresnel rim, drifting bands
const DOMAIN_FRAG = `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float h = clamp(vP.y, 0.0, 1.0);
  float bands = smoothstep(0.9, 1.0, sin(h * 30.0 - uTime * 1.6) * 0.5 + 0.5);
  float ribs = smoothstep(0.97, 1.0, sin(atan(vP.z, vP.x) * 16.0 + uTime * 0.25) * 0.5 + 0.5) * (1.0 - h);
  float base = smoothstep(0.12, 0.0, h);
  float glow = clamp(f * 0.9 + bands * 0.35 + ribs * 0.4 + base * 0.8, 0.0, 1.0);
  gl_FragColor = vec4(mix(vec3(0.07, 0.0, 0.14), uColor * 1.6, glow), min((0.3 + glow * 0.7) * uOpacity, 0.95));
  #include <colorspace_fragment>
}`;

// reflect: a glassy box shell round the car, bright bands sweeping along it, lit edges; uHit = a bounce just now
const MIRROR_FRAG = `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uHit;
varying vec3 vN; varying vec3 vV; varying vec3 vP;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
  float sweep = smoothstep(0.9, 1.0, sin((vP.z * 1.6 + vP.y * 0.9) * 6.2832 - uTime * 4.5) * 0.5 + 0.5);
  vec3 e = abs(vP) * 2.0;
  float edge = smoothstep(0.92, 1.0, max(max(min(e.x, e.y), min(e.y, e.z)), min(e.x, e.z)));
  float a = (0.05 + f * 0.2 + sweep * 0.5 + edge * 0.45 + uHit * 0.75) * uOpacity;
  gl_FragColor = vec4(uColor * (0.8 + sweep + uHit), a);
  #include <colorspace_fragment>
}`;

// ---------- canvas textures ----------
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'));
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const clockTex = () => canvasTex(256, g => {
  g.translate(128, 128);
  g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 8;
  const circle = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  const line = (a, r0, r1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0); g.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1); g.stroke(); };
  circle(116, 7); circle(102, 2);
  for (let i = 0; i < 60; i++) line(i / 60 * Math.PI * 2, i % 5 ? 90 : 76, 98, i % 5 ? 2 : 6);
  line(0, 0, 64, 6); line(2.1, 0, 44, 5);
  g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.fill();
});

// thin-film rainbow for the oil sheen (rotated over time via texture transform)
function filmTex() {
  const t = canvasTex(256, g => {
    g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
    g.globalCompositeOperation = 'lighter'; g.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      const cx = rnd(70, 186), cy = rnd(70, 186), ph = rnd(0, 6);
      for (let r = 4; r < 190; r += 3) {
        g.strokeStyle = `hsla(${(r * 5 + k * 120) % 360},100%,60%,0.14)`;
        g.beginPath();
        for (let s = 0; s <= 40; s++) {
          const a = s / 40 * Math.PI * 2, rr = r * (1 + 0.14 * Math.sin(a * 3 + ph + r * 0.04));
          g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        g.stroke();
      }
    }
  });
  t.center.set(0.5, 0.5);
  t.repeat.set(0.7, 0.7);
  return t;
}

// lightning ribbon cross-section (u across): white core, electric-blue halo
const beamTex = () => canvasTex(64, g => {
  const gr = g.createLinearGradient(0, 0, 64, 0);
  [[0, 'rgba(40,110,255,0)'], [0.28, 'rgba(90,170,255,0.55)'], [0.44, '#fff'], [0.56, '#fff'], [0.72, 'rgba(90,170,255,0.55)'], [1, 'rgba(40,110,255,0)']]
    .forEach(([k, c]) => gr.addColorStop(k, c));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

// downforce airflow (u along the streak, scrolled downstream): faint line + comets with their bright heads downstream
function flowTex() {
  const t = canvasTex(256, g => {
    g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 256, 256);
    for (const [x, w] of [[14, 76], [118, 44], [178, 62]]) {
      const gr = g.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, '#fff');
      g.fillStyle = gr; g.fillRect(x, 0, w, 256);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

// splat shape as grayscale alphaMap (max extent ≈ 0.86 of half size)
const blobTex = () => canvasTex(256, g => {
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  const dot = (x, y, r, soft) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, '#fff'); gr.addColorStop(soft, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  const at = (d, r, soft) => { const a = rnd(0, Math.PI * 2); dot(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, r, soft); };
  dot(128, 128, 62, 0.8);
  for (let i = 0; i < 8; i++) at(rnd(25, 58), rnd(30, 52), 0.75);
  for (let i = 0; i < 16; i++) at(rnd(85, 114), rnd(3, 9), 0.6);
}, false);

// domain floor sigil: rings, bands of made-up angular glyphs and a 7-point star (white; tinted by the material)
const runeTex = () => canvasTex(512, g => {
  g.translate(256, 256);
  g.strokeStyle = '#fff'; g.lineCap = g.lineJoin = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 10;
  const circle = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
  const glyph = (a, r, s) => {
    g.save(); g.rotate(a); g.translate(0, -r); g.lineWidth = 3; g.beginPath();
    for (let k = 0; k < 5; k++) g.lineTo(Math.round(rnd(-1, 1)) * s, Math.round(rnd(-1, 1)) * s);
    g.stroke();
    if (Math.random() < 0.5) { g.beginPath(); g.arc(0, 0, s * 0.3, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  };
  circle(250, 6); circle(234, 2); circle(198, 3); circle(118, 2); circle(52, 3);
  for (let i = 0; i < 28; i++) glyph(i / 28 * Math.PI * 2, 216, 10);
  for (let i = 0; i < 12; i++) glyph(i / 12 * Math.PI * 2, 85, 12);
  g.lineWidth = 3; g.beginPath();
  for (let i = 0; i <= 7; i++) { const a = i * 2 / 7 * Math.PI * 2; g.lineTo(Math.sin(a) * 198, -Math.cos(a) * 198); }
  g.stroke();
});

// ---------- per-race state ----------
const STATE = new WeakMap();

function st(race) {
  let S = STATE.get(race);
  if (S) return S;
  race.hazards ||= [];
  const root = new THREE.Group();
  root.name = 'abilities';
  race.scene.add(root);
  S = {
    root, time: 0, fx: [], tint: {}, tex: {}, dropMat: null,
    glow: new Particles(3000, true, 1.6), smoke: new Particles(1500, false, 1.0),
    geo: {
      ring: new THREE.RingGeometry(0.8, 1, 64),
      sphere: new THREE.SphereGeometry(1, 36, 24),
      cone: new THREE.ConeGeometry(0.2, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2), // tip → -Z
      plane: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      drop: new THREE.SphereGeometry(1, 10, 8),
    },
  };
  root.add(S.glow.points, S.smoke.points);
  STATE.set(race, S);
  return S;
}

const underTex = () => canvasTex(128, g => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});
const TEX = { clock: clockTex, film: filmTex, beam: beamTex, rune: runeTex, flow: flowTex, under: underTex, famTag: famTagTex, blobs: () => [blobTex(), blobTex(), blobTex()] };
function tex(S, key) {
  return (S.tex[key] ||= TEX[key]());
}

// transient world FX (rings, flashes): tick(obj, k) with k 0→1. Returns obj (may be re-parented, e.g. to ride along with a car)
function addFx(S, obj, life, tick) {
  S.root.add(obj);
  S.fx.push({ obj, t: 0, life, tick });
  tick(obj, 0);
  return obj;
}
function dropFx(f) {
  f.obj.removeFromParent();
  if (f.obj.userData.dispose) f.obj.userData.dispose();
  else if (!f.obj.userData.keepMat) f.obj.material.dispose();
  if (f.obj.userData.ownGeo) f.obj.geometry.dispose();
}

function ring(S, p, color, { vertical = false, heading = 0, r0 = 1, r1 = 8, life = 0.6, opacity = 0.9 } = {}) {
  const m = new THREE.Mesh(S.geo.ring, new THREE.MeshBasicMaterial({
    color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.position.copy(p);
  if (vertical) m.rotation.y = heading; else m.rotation.x = -Math.PI / 2;
  return addFx(S, m, life, (o, k) => { o.scale.setScalar(r0 + (r1 - r0) * easeOut(k)); o.material.opacity = opacity * (1 - k); });
}

function glowBall(S, p, r, life, color = '#e8fbff') {
  const m = new THREE.Mesh(S.geo.sphere, new THREE.MeshBasicMaterial({
    color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.copy(p);
  return addFx(S, m, life, (o, k) => { o.scale.setScalar(0.2 + r * easeOut(k)); o.material.opacity = (1 - k) ** 2; });
}

// ---------- per-car visuals (children of car.mesh, flagged so phase ignores them) ----------
function carFx(car) {
  const a = car.ability, m = car.mesh;
  if (!m) return a.fx;
  if (a.fx) {
    if (a.fx.group.parent !== m) m.add(a.fx.group);   // mesh swapped by game
    return a.fx;
  }
  const saved = [m.position.clone(), m.quaternion.clone(), m.scale.clone()];
  m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1);
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(a.body || m);   // robotdash: the car, not the 3.8 m robot under it
  m.position.copy(saved[0]); m.quaternion.copy(saved[1]); m.scale.copy(saved[2]);
  m.updateMatrixWorld(true);
  if (box.isEmpty() || box.getSize(_v).length() > 20) box.set(new THREE.Vector3(-0.9, 0, -2.1), new THREE.Vector3(0.9, 1.3, 2.1));
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const group = new THREE.Group();
  group.userData.abilFx = true;
  m.add(group);
  const ey = box.min.y + Math.min(0.55, size.y * 0.32);
  return (a.fx = {
    group, box, size, center, mats: [],
    exhaust: [-1, 1].map(s => new THREE.Vector3(center.x + s * size.x * 0.22, ey, box.min.z + 0.05)),
  });
}

function flames(S, fx, nitro) {
  if (fx.flames) return fx.flames;
  const mk = (color, opacity) => new THREE.MeshBasicMaterial({
    color, opacity, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const outer = mk(nitro ? '#ff7a2a' : '#35b8ff', 0.75), inner = mk(nitro ? '#fff1b8' : '#e6fbff', 0.9);
  const g = new THREE.Group();
  for (const e of fx.exhaust) {
    const o = new THREE.Mesh(S.geo.cone, outer), i = new THREE.Mesh(S.geo.cone, inner);
    o.position.copy(e); i.position.copy(e);
    g.add(o, i);
  }
  g.visible = false;
  fx.group.add(g);
  fx.mats.push(outer, inner);
  return (fx.flames = g);
}
function shieldMesh(S, fx) {
  if (fx.shield) return fx.shield;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(COLOR.shield) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uHit: { value: 0 } },
    vertexShader: SHIELD_VERT, fragmentShader: SHIELD_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(S.geo.sphere, mat);
  m.position.copy(fx.center);
  m.userData.scale = new THREE.Vector3(fx.size.x * 0.5 + 0.7, fx.size.y * 0.5 + 0.7, fx.size.z * 0.5 + 0.6);
  m.visible = false;
  m.renderOrder = 21;
  fx.group.add(m);
  fx.mats.push(mat);
  return (fx.shield = m);
}

function mirrorMesh(S, fx) {
  if (fx.mirror) return fx.mirror;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(COLOR.reflect) }, uTime: { value: 0 }, uOpacity: { value: 1 }, uHit: { value: 0 } },
    vertexShader: SHIELD_VERT, fragmentShader: MIRROR_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  S.geo.cube ||= new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Mesh(S.geo.cube, mat);
  m.position.copy(fx.center);
  m.userData.scale = new THREE.Vector3(fx.size.x + 0.3, fx.size.y + 0.25, fx.size.z + 0.3);
  m.visible = false;
  m.renderOrder = 21;
  fx.group.add(m);
  fx.mats.push(mat);
  return (fx.mirror = m);
}

function clockMeshes(S, fx) {
  if (fx.clock) return fx.clock;
  const map = tex(S, 'clock');
  const ringMat = new THREE.MeshBasicMaterial({
    map, color: COLOR.timeslow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const iconMat = new THREE.SpriteMaterial({ map, color: COLOR.timeslow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringM = new THREE.Mesh(S.geo.plane, ringMat), icon = new THREE.Sprite(iconMat);
  const r = Math.max(fx.size.x, fx.size.z) * 0.62;
  ringM.scale.set(r, 1, r);
  ringM.position.set(fx.center.x, 0.12, fx.center.z);
  icon.scale.setScalar(1.5);
  icon.position.set(fx.center.x, fx.box.max.y + 1.1, fx.center.z);
  fx.group.add(ringM, icon);
  fx.mats.push(ringMat, iconMat);
  return (fx.clock = { ring: ringM, icon });
}

// magnet: floating red / blue horseshoe over the car + field-line ribbons to the target (rewritten in place each frame)
const ARCS = 8, ARC_SEG = 14;
function magnetMeshes(S, fx) {
  const mk = color => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
  const shoeMats = [mk('#ff3548'), mk('#3d7bff')], tip = mk('#ffffff');
  S.geo.shoeArc ||= new THREE.TorusGeometry(0.42, 0.12, 10, 12, Math.PI / 2);
  S.geo.shoeLeg ||= new THREE.CylinderGeometry(0.12, 0.12, 0.42, 12);
  S.geo.shoeTip ||= new THREE.CylinderGeometry(0.125, 0.125, 0.14, 12);
  const shoe = new THREE.Group();
  [1, -1].forEach((s, i) => {   // U: lower quarter arcs, legs up, white pole tips
    const arc = new THREE.Mesh(S.geo.shoeArc, shoeMats[i]);
    arc.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI;
    const leg = new THREE.Mesh(S.geo.shoeLeg, shoeMats[i]);
    leg.position.set(s * 0.42, 0.21, 0);
    const tp = new THREE.Mesh(S.geo.shoeTip, tip);
    tp.position.set(s * 0.42, 0.49, 0);
    shoe.add(arc, leg, tp);
  });
  shoe.position.set(fx.center.x, fx.box.max.y + 0.45, fx.center.z);
  shoe.visible = false;
  const lines = ['#ff3a4e', '#4a85ff'].map(c => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), boltMat(S, c));
    m.frustumCulled = false; m.renderOrder = 22; m.visible = false;
    return m;
  });
  const pts = Array.from({ length: ARCS }, () => Array.from({ length: ARC_SEG + 1 }, () => new THREE.Vector3()));
  const segs = [[], []];
  pts.forEach((p, i) => { for (let j = 0; j < ARC_SEG; j++) segs[i % 2].push([p[j], p[j + 1], 0.5]); });
  fx.group.add(shoe, ...lines);
  fx.mats.push(...shoeMats, tip, ...lines.map(l => l.material));
  (fx.geos ||= []).push(...lines.map(l => l.geometry));
  return (fx.magnet = { shoe, shoeMats, lines, pts, segs });
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _u1 = new THREE.Vector3(), _u2 = new THREE.Vector3();
function magnetLines(S, M, car, fx, tg, t, dt, vx, vz) {
  // the lines are children of the car mesh, which is pitched, squatted and rolled too: target in its full frame
  car.mesh.updateMatrixWorld();
  const mw = car.mesh.matrixWorld;
  const A = _a.set(fx.center.x, fx.box.max.y + 0.7, fx.center.z);
  const B = car.mesh.worldToLocal(_b.set(tg.pos.x, tg.pos.y + 0.8, tg.pos.z));
  const d = _d.subVectors(B, A);
  _u1.crossVectors(d, _Y).normalize();   // sideways
  _u2.crossVectors(_u1, d).normalize();  // up-ish
  const bulge = clamp(d.length() * 0.15, 3, 8);
  M.pts.forEach((p, i) => {   // cubic arcs fanning out of both poles around the A→B axis, slowly rotating and breathing
    const phi = i / ARCS * Math.PI * 2 + t * 1.3, b = bulge * (0.8 + 0.2 * Math.sin(t * 5 + i * 1.7));
    const ox = (_u1.x * Math.cos(phi) + _u2.x * Math.sin(phi)) * b, oy = (_u1.y * Math.cos(phi) + _u2.y * Math.sin(phi)) * b, oz = (_u1.z * Math.cos(phi) + _u2.z * Math.sin(phi)) * b;
    for (let j = 0; j <= ARC_SEG; j++) {   // control points A + d/6 + o, B - d/6 + 0.7 o
      const s = j / ARC_SEG, w0 = (1 - s) ** 3, w1 = 3 * (1 - s) ** 2 * s, w2 = 3 * (1 - s) * s * s, w3 = s ** 3;
      const f = (w1 - w2) / 6, g = w1 + w2 * 0.7;
      p[j].set(A.x * (w0 + w1) + B.x * (w2 + w3) + d.x * f + ox * g, A.y * (w0 + w1) + B.y * (w2 + w3) + d.y * f + oy * g, A.z * (w0 + w1) + B.z * (w2 + w3) + d.z * f + oz * g);
    }
  });
  M.lines.forEach((l, k) => { ribbons(M.segs[k], l.geometry); l.material.opacity = 0.55 + 0.45 * Math.sin(t * 12 + k * Math.PI); });
  const Aw = A.applyMatrix4(mw);   // A is not needed in local space any more
  for (let n = Math.floor(dt * 60 + Math.random()); n > 0; n--) {   // sparks sliding along the lines toward the car
    const i = (Math.random() * ARCS) | 0, p = _v.copy(M.pts[i][(Math.random() * ARC_SEG) | 0]).applyMatrix4(mw);
    S.glow.emit(p.x, p.y, p.z, vx + (Aw.x - p.x) * 1.2, (Aw.y - p.y) * 1.2, vz + (Aw.z - p.z) * 1.2, PAL.magnet[i % 2 ? 3 : 1], rnd(0.3, 0.6), 0.5, 0.1, 0, 0);
  }
}

// downforce: glowing airflow streaks over the roof and along the flanks (one merged mesh, dash texture scrolled
// downstream, faded at both ends via vertex colours) and a hologram rear wing
function aeroMeshes(S, fx) {
  if (fx.aero) return fx.aero;
  const { box: b, size: sz, center: c } = fx, hl = sz.z / 2, hw = sz.x / 2, SEG = 48, RAD = 5;
  const tube = pts => {
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), SEG, 0.03, RAD, false);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i <= SEG; i++) col.fill(Math.min(1, i / SEG * 5, (1 - i / SEG) * 3), i * (RAD + 1) * 3, (i + 1) * (RAD + 1) * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const geos = [-0.45, 0, 0.45].map(x => {   // nose -> over the roof -> off the tail at wing height (q: +1 nose, -1 tail)
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const q = 1.35 - i * 0.29, e = Math.sqrt(Math.max(0, 1 - q * q));
      pts.push(new THREE.Vector3(c.x + x * hw, b.min.y + sz.y * (0.45 + 0.55 * (q < 0 ? Math.max(e, 0.75) : e)) + 0.12, c.z + q * hl));
    }
    return tube(pts);
  });
  for (const k of [1, -1]) geos.push(tube([1.3, 0.3, -0.6, -1.5].map(q => new THREE.Vector3(c.x + k * (hw + 0.1 + 0.06 * (1 - Math.abs(q))), b.min.y + sz.y * 0.5, c.z + q * hl))));
  const glowMat = (color, extra) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, ...extra });
  const streaks = new THREE.Mesh(mergeGeometries(geos), glowMat(COLOR.downforce, { map: tex(S, 'flow'), vertexColors: true }));
  geos.forEach(g => g.dispose());
  const wy = b.max.y + 0.14, wz = b.min.z + 0.5, span = sz.x * 0.94;
  const parts = [new THREE.BoxGeometry(span, 0.04, 0.42).translate(c.x, wy, wz), ...[1, -1].map(k => new THREE.BoxGeometry(0.05, 0.36, 0.22).translate(c.x + k * span * 0.3, wy - 0.18, wz))];
  const wing = new THREE.Mesh(mergeGeometries(parts), glowMat('#2f8cff', { side: THREE.DoubleSide }));
  parts.forEach(g => g.dispose());
  streaks.renderOrder = wing.renderOrder = 22;
  streaks.visible = wing.visible = false;
  fx.group.add(streaks, wing);
  fx.mats.push(streaks.material, wing.material);
  (fx.geos ||= []).push(streaks.geometry, wing.geometry);
  return (fx.aero = { streaks, wing });
}

function onCurb(tr, i) {
  const N = tr.samples.length;
  for (let k = -CURB_SPAN; k <= CURB_SPAN; k++) if (Math.abs(tr.samples[(i + k + N) % N].curv) > CURB_CURV) return true;
  return false;
}

// robotdash: build the robot once, hidden under the car mesh; the car's own parts move into a.body so the two can swap.
// Lights stay put (hiding a light changes the light count: every material recompiles).
function attachRobot(car) {
  const a = car.ability;
  buildRobotMesh(car.look).then(r => {
    const m = car.mesh;
    if (a.gone || car.ability !== a || a.robot || !m) return;
    const body = new THREE.Group();
    for (const c of [...m.children]) if ((c.isMesh || c.isGroup) && !c.userData.abilFx) body.add(c);
    m.add(body);
    r.visible = false;
    m.add(r);
    a.body = body;
    a.robot = r;
  }).catch(e => console.warn('robot', e));
}

// car <-> robot: white flash, rings and body panels flying off, riding along with the car (children of its fx group)
function transformFx(S, car, fx, toRobot) {
  const c = fx.center, y = toRobot ? 1.9 : 1.1;
  const fly = [
    glowBall(S, _w.set(c.x, y, c.z), toRobot ? 3.2 : 2.4, 0.3, '#ffffff'),
    ring(S, _w.set(c.x, y, c.z), '#ffffff', { vertical: true, r0: 0.4, r1: toRobot ? 4.5 : 3.5, life: 0.4 }),
    ring(S, _w.set(c.x, 0.15, c.z), COLOR.robotdash, { r0: 1, r1: 7, life: 0.5, opacity: 0.8 }),
  ];
  S.geo.panel ||= new THREE.BoxGeometry(0.46, 0.05, 0.32);
  // two panel materials kept per car (disposed with fx.mats): fresh ones each transform compiled a shader program
  // that disposing the last panel then threw away again (a frame hitch every change)
  if (!fx.panel) {
    fx.panel = [car.look?.body || COLOR.robotdash, '#dfe3ea'].map(color => new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35, transparent: true }));
    fx.mats.push(...fx.panel);
  }
  for (let i = 0; i < 14; i++) {
    const p0 = new THREE.Vector3(c.x + rnd(-0.8, 0.8), rnd(0.3, toRobot ? 1.3 : 2.8), c.z + rnd(-1.8, 1.8));
    const v = new THREE.Vector3(rnd(-1, 1), rnd(0.2, 1.3), rnd(-1, 1)).normalize().multiplyScalar(rnd(4, 9));
    const w = new THREE.Vector3(rnd(-14, 14), rnd(-14, 14), rnd(-14, 14));
    const panel = new THREE.Mesh(S.geo.panel, fx.panel[i % 4 ? 0 : 1]);
    panel.userData.keepMat = true;
    fly.push(addFx(S, panel, 0.55, (o, k) => {
      const s = k * 0.55;
      o.position.set(p0.x + v.x * s, p0.y + v.y * s - 7 * s * s, p0.z + v.z * s);
      o.rotation.set(w.x * s, w.y * s, w.z * s);
      o.material.opacity = 1 - k * k;
    }));
  }
  for (const o of fly) fx.group.add(o);
  const vx = car.vel?.x || 0, vz = car.vel?.z || 0;
  for (let i = 0; i < 50; i++) {
    S.glow.emit(car.pos.x + rnd(-1, 1), car.pos.y + rnd(0.3, 2.2), car.pos.z + rnd(-1, 1), vx + rnd(-6, 6), rnd(0, 5), vz + rnd(-6, 6), pick(PAL.robotdash), rnd(0.3, 0.6), 0.5, 0.05, 4, 1.5);
  }
}

// phase: swap this car's materials for transparent clones (materials may be shared between cars)
function walk(o, fn) {
  if (o.userData.abilFx) return;
  fn(o);
  for (const c of o.children) walk(c, fn);
}
function phaseMat(m) {
  const c = m.clone();
  c.transparent = true;
  c.depthWrite = false;
  c.userData.baseOpacity = m.opacity;
  if (c.emissive) { c.emissive.set('#ff5fb8'); c.emissiveIntensity = 0.45; }
  return c;
}
function setPhase(car, on) {
  const a = car.ability;
  if (on && !a.phaseSwap && car.mesh) {
    a.phaseSwap = [];
    walk(car.mesh, o => {
      if (!o.isMesh || !o.material) return;
      const clone = Array.isArray(o.material) ? o.material.map(phaseMat) : phaseMat(o.material);
      a.phaseSwap.push({ o, orig: o.material, clone, cast: o.castShadow });
      o.material = clone;
      o.castShadow = false;
    });
  } else if (!on && a.phaseSwap) {
    for (const s of a.phaseSwap) {
      s.o.material = s.orig;
      s.o.castShadow = s.cast;
      [].concat(s.clone).forEach(m => m.dispose());
    }
    a.phaseSwap = null;
  }
}

function carVisuals(race, S, car, dt) {
  const a = car.ability, act = a.active > 0 ? a.id : null;
  a.hit = Math.max(0, a.hit - dt * 2.5);
  a.slowVis += ((a.slow > 0 ? 1 : 0) - a.slowVis) * Math.min(1, dt * 6);
  if (a.slowVis < 0.005) a.slowVis = 0;
  a.dfVis += ((act === 'downforce' ? Math.min(1, Math.abs(car.speed) / 45) * (a.dfSling > 0 ? 1 : 0.7) : 0) - a.dfVis) * Math.min(1, dt * 5);   // speed lines
  if (a.dfVis < 0.005) a.dfVis = 0;
  if (!act && !a.slowVis && !a.fx && !(car.spin > 0) && a.id !== 'family') return;
  if (a.id === 'phase') setPhase(car, act === 'phase');
  const fx = carFx(car);
  if (!fx) return;
  const t = S.time, sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  const vx = car.vel ? car.vel.x : sh * car.speed, vz = car.vel ? car.vel.z : ch * car.speed;
  const world = (p, out = _v) => out.set(car.pos.x + p.z * sh + p.x * ch, car.pos.y + p.y, car.pos.z + p.z * ch - p.x * sh);

  if (a.id === 'boost' || a.id === 'nitro' || a.id === 'hellchain') {
    const nitro = a.id !== 'boost', g = flames(S, fx, nitro), on = act === a.id && !a.chained;
    g.visible = on;
    if (on) {
      const len = (nitro ? 1.8 : 1.1) * Math.min(1, a.t * 6) * (a.active < 0.3 ? a.active / 0.3 : 1);
      g.children.forEach((m, i) => {
        const inner = i % 2, w = (inner ? 0.6 : 1.25) * rnd(0.88, 1.12);
        m.scale.set(w, w, Math.max(0.01, len * (inner ? 0.55 : 1) * rnd(0.75, 1.2)));
      });
      for (const e of fx.exhaust) {
        const p = world(e);
        for (let n = Math.floor((nitro ? 110 : 60) * dt + Math.random()); n > 0; n--) {
          const back = rnd(6, 12);
          S.glow.emit(p.x + rnd(-0.1, 0.1), p.y + rnd(-0.1, 0.1), p.z + rnd(-0.1, 0.1),
            vx * 0.35 - sh * back + rnd(-1, 1), rnd(-0.5, 1.2), vz * 0.35 - ch * back + rnd(-1, 1),
            pick(nitro ? PAL.nitro : PAL.boost), rnd(0.18, 0.35), nitro ? 0.75 : 0.5, 0.05, 0, 2);
        }
        if (nitro && Math.random() < dt * 25) S.smoke.emit(p.x, p.y, p.z, vx * 0.2, 0.8, vz * 0.2, pick(PAL.smoke), 0.7, 0.4, 1.6, -0.5, 1.5, 0.22);
      }
    }
  }

  if (a.id === 'shield') {
    const m = shieldMesh(S, fx), on = act === 'shield';
    m.visible = on && (a.active > 1.2 || Math.sin(t * 28) > -0.3);   // blink before expiring
    if (on) {
      const pop = a.t < 0.3 ? easeOutBack(a.t / 0.3) : 1;
      m.scale.copy(m.userData.scale).multiplyScalar(Math.max(0.01, pop * (1 + Math.sin(t * 6) * 0.02 + a.hit * 0.12)));
      const u = m.material.uniforms;
      u.uTime.value = t; u.uHit.value = a.hit; u.uOpacity.value = Math.min(1, a.active * 2);
      if (Math.random() < dt * 12) {
        const th = rnd(0, Math.PI * 2), s = m.userData.scale;
        world(_w.set(fx.center.x + Math.cos(th) * s.x, fx.center.y + rnd(-0.3, 0.8), fx.center.z + Math.sin(th) * s.z));
        S.glow.emit(_v.x, _v.y, _v.z, vx, 1.5, vz, pick(PAL.shield), 0.4, 0.35, 0.05, 0, 0);
      }
    }
  }

  if (a.id === 'reflect' && (act || fx.mirror)) {
    const m = mirrorMesh(S, fx), on = act === 'reflect';
    m.visible = on && (a.active > 1 || Math.sin(t * 28) > -0.3);   // blink before expiring
    if (on) {
      const pop = a.t < 0.25 ? easeOutBack(a.t / 0.25) : 1;
      m.scale.copy(m.userData.scale).multiplyScalar(Math.max(0.01, pop * (1 + a.hit * 0.08)));
      const u = m.material.uniforms;
      u.uTime.value = t; u.uHit.value = a.hit; u.uOpacity.value = Math.min(1, a.active * 2);
      if (Math.random() < dt * 16) {   // glints running over the panels
        world(_w.set(fx.center.x + rnd(-0.5, 0.5) * fx.size.x, rnd(0.4, fx.box.max.y), fx.center.z + rnd(-0.5, 0.5) * fx.size.z));
        S.glow.emit(_v.x, _v.y, _v.z, vx, rnd(0.3, 1.2), vz, pick(PAL.reflect), rnd(0.2, 0.4), 0.5, 0.05, 0, 0);
      }
    }
  }

  if (a.id === 'phase' && act === 'phase' && a.phaseSwap) {
    const o = (0.3 + 0.12 * Math.sin(t * 13) + rnd(0, 0.06)) * (a.active < 1 ? (Math.sin(t * 30) > 0 ? 1.8 : 0.6) : 1);
    for (const s of a.phaseSwap) for (const m of [].concat(s.clone)) m.opacity = (m.userData.baseOpacity ?? 1) * o;
    if (Math.random() < dt * 30) {
      world(_w.set(fx.center.x + rnd(-1, 1) * fx.size.x * 0.5, rnd(0.2, fx.box.max.y), fx.center.z + rnd(-1, 1) * fx.size.z * 0.5));
      S.glow.emit(_v.x, _v.y, _v.z, vx * 0.5, rnd(0.5, 1.5), vz * 0.5, pick(PAL.phase), rnd(0.4, 0.7), 0.4, 0.05, 0, 1);
    }
  }

  if (a.slowVis || fx.clock) {
    const c = clockMeshes(S, fx), v = a.slowVis;
    c.ring.visible = c.icon.visible = v > 0;
    c.ring.material.opacity = 0.85 * v;
    c.icon.material.opacity = v;
    c.ring.rotation.y -= dt * 0.9;
    c.icon.material.rotation -= dt * 1.6;
    if (a.slow > 0 && Math.random() < dt * 14) {
      world(_w.set(fx.center.x + rnd(-1.5, 1.5), 0.3, fx.center.z + rnd(-2, 2)));
      S.glow.emit(_v.x, _v.y, _v.z, vx * 0.6, rnd(1, 2.5), vz * 0.6, pick(PAL.timeslow), rnd(0.6, 1), 0.45, 0.05, 0, 0.5);
    }
  }

  if (a.id === 'thunderbolt' && (act || fx.aura)) {   // electric aura: crackling arcs over the body + sparks
    const on = act === 'thunderbolt';
    if (!fx.aura) {
      const mat = boltMat(S, '#fff3a0');
      fx.aura = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      fx.aura.frustumCulled = false;
      fx.aura.renderOrder = 22;
      fx.auraT = 0;
      fx.group.add(fx.aura);
      fx.mats.push(mat);
    }
    fx.aura.visible = on;
    if (on && (fx.auraT -= dt) <= 0) {
      fx.auraT = 0.05;
      const b = fx.box, segs = [];
      for (let i = 0; i < 7; i++) {
        const p0 = new THREE.Vector3(rnd(b.min.x, b.max.x) * 1.1, rnd(b.min.y + 0.3, b.max.y + 0.2), rnd(b.min.z, b.max.z));
        jag(p0, p0.clone().add(_w.set(rnd(-1, 1), rnd(-0.3, 0.8), rnd(-1.5, 1.5))), 0.35, 3, 0.26, segs, false);
      }
      fx.aura.geometry.dispose();
      fx.aura.geometry = ribbons(segs);
      fx.aura.material.color.set(Math.random() < 0.5 ? '#fff3a0' : '#9fe4ff');
    }
    if (on && Math.random() < dt * 40) {
      world(_w.set(rnd(fx.box.min.x, fx.box.max.x), rnd(0.3, fx.box.max.y + 0.3), rnd(fx.box.min.z, fx.box.max.z)));
      S.glow.emit(_v.x, _v.y, _v.z, vx + rnd(-2, 2), rnd(0, 2), vz + rnd(-2, 2), pick(PAL.thunderbolt), rnd(0.15, 0.3), 0.35, 0.05, 0, 3);
    }
  }

  if (a.id === 'magnet' && (act || fx.magnet)) {
    const M = fx.magnet || magnetMeshes(S, fx), on = act === 'magnet', tg = on ? a.target : null;
    M.shoe.visible = on;
    M.lines.forEach(l => { l.visible = !!tg; });
    if (on) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 14);
      M.shoe.scale.setScalar((a.t < 0.25 ? Math.max(0.01, easeOutBack(a.t / 0.25)) : 1) * (1 + 0.08 * pulse));
      M.shoe.rotation.y = Math.sin(t * 3) * 0.25;
      M.shoeMats[0].opacity = 0.55 + 0.45 * pulse; M.shoeMats[1].opacity = 1 - 0.45 * pulse;
    }
    if (tg?.pos) magnetLines(S, M, car, fx, tg, t, dt, vx, vz);
  }

  if (a.id === 'downforce' && (act || fx.aero)) {
    const A = aeroMeshes(S, fx), on = act === 'downforce';
    A.streaks.visible = A.wing.visible = on;
    if (on) {
      const o = Math.min(1, a.t * 4, a.active * 2);
      A.streaks.material.opacity = o * (0.55 + 0.45 * Math.min(1, Math.abs(car.speed) / 40));
      A.wing.material.opacity = o * (0.45 + 0.2 * Math.sin(t * 9));
      // dirty air (乱気流): wisps curling off both wing tips, left behind at half the car's speed (about the wake's length)
      for (const k of [1, -1]) {
        const p = world(_w.set(fx.center.x + k * fx.size.x * 0.47, fx.box.max.y + 0.1, fx.box.min.z + 0.3));
        for (let n = Math.floor(dt * 110 + Math.random()); n > 0; n--) {
          const ang = t * 14 + k * 1.6 + rnd(-0.3, 0.3), r = rnd(1.5, 3.5), sx = Math.cos(ang) * r * k, sy = Math.sin(ang) * r;
          S.glow.emit(p.x, p.y, p.z, vx * 0.5 + ch * sx, sy, vz * 0.5 - sh * sx, pick(PAL.downforce), rnd(0.35, 0.55), 0.45, 0.12, 0, 0.6, 0.55);
        }
        if (Math.random() < dt * 25) S.smoke.emit(p.x, p.y - 0.3, p.z, vx * 0.55 + rnd(-2, 2), rnd(-0.5, 1), vz * 0.55 + rnd(-2, 2), pick(PAL.wisp), 0.8, 0.5, 2.4, 0, 0.8, 0.2);
      }
      if (a.dfKick) {   // out of a corner: the slingshot
        a.dfKick = false;
        const p = world(_w.set(fx.center.x, fx.box.min.y + 0.5, fx.box.min.z));
        burst(S.glow, p, 26, PAL.downforce, 7, 0.35, 0.45, 0.05, 0, 2);
        ring(S, p, COLOR.downforce, { vertical: true, heading: car.heading, r0: 0.4, r1: 3.2, life: 0.35 });
        if (isHuman(car)) race.hud?.shake?.(car, 0.12);
      }
      const tr = race.track, s = tr?.samples?.[car.trackIndex];
      if (s?.right && car.speed > 12 && onCurb(tr, car.trackIndex)) {   // pressed onto the curb: sparks from under the car
        const W2 = tr.width / 2, lat = (car.pos.x - s.pos.x) * s.right.x + (car.pos.z - s.pos.z) * s.right.z, sg = Math.sign(lat);
        if (Math.abs(lat) > W2 - 1.1 && Math.abs(lat) < W2 + 2.2) {
          const px = car.pos.x + s.right.x * sg * 0.75, pz = car.pos.z + s.right.z * sg * 0.75;
          for (let n = Math.floor(dt * 90 + Math.random()); n > 0; n--) {
            const along = rnd(-1.4, 1.4), back = rnd(2, 6);
            S.glow.emit(px + sh * along, car.pos.y + 0.08, pz + ch * along, vx * 0.55 - sh * back + rnd(-1.5, 1.5), rnd(0.5, 3), vz * 0.55 - ch * back + rnd(-1.5, 1.5),
              pick(PAL.spark), rnd(0.15, 0.35), 0.3, 0.05, 9, 0.5);
          }
        }
      }
    }
  }

  if (a.id === 'robotdash' && a.robot && a.body) {
    const ph = !act ? 0 : a.t < a.robotDur ? 1 : a.t < a.robotDur + ROBOT_T ? 2 : 3;   // car / robot / changing back / boost
    if (ph !== a.robotPh) {
      if (ph === 1 || ph === 2) transformFx(S, car, fx, ph === 1);
      if (ph === 3 && isHuman(car)) flash(race, who(race, car) + '大加速!', COLOR.robotdash);
      a.robotPh = ph;
    }
    const k = ph === 1 ? Math.min(1, a.t / ROBOT_T) : ph === 2 ? 1 - (a.t - a.robotDur) / ROBOT_T : 0;   // 0 car .. 1 robot
    const kc = smooth01(k / 0.6), kr = clamp((k - 0.35) / 0.65, 0, 1);   // the car spins down into panels, the robot grows in
    a.body.visible = kc < 1;
    a.body.scale.setScalar(Math.max(1e-3, 1 - kc));
    a.body.rotation.y = kc * Math.PI * 1.5;
    a.robot.visible = kr > 0;
    if (kr > 0) {
      a.robot.scale.setScalar(Math.max(1e-3, easeOutBack(kr)));
      a.robot.userData.anim?.(t, car.speed);
    }
  }

  if (a.id === 'hellchain' && (a.chained || a.chainFx)) chainVisuals(S, car, a, dt);
  if (a.id === 'tokyodive' && (act || fx.under)) {   // neon underglow while diving
    if (!fx.under) {
      const mat = new THREE.MeshBasicMaterial({ map: tex(S, 'under'), color: '#ff7a1a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      fx.under = new THREE.Mesh(S.geo.plane, mat);
      fx.under.scale.set(fx.size.x * 0.9, 1, fx.size.z * 0.62);
      fx.under.position.set(fx.center.x, 0.06, fx.center.z);
      fx.under.renderOrder = 2;
      fx.group.add(fx.under);
      fx.mats.push(mat);
    }
    fx.under.visible = !!act;
    if (act) fx.under.material.opacity = 0.7 + 0.3 * Math.sin(t * 9);
    const guard = act && diveGuard(car);   // immune: the glow flickers cyan / pink
    fx.under.material.color.copy(PAL.tokyodive[guard ? (Math.sin(t * 24) > 0 ? 4 : 3) : 2]);
    if (act && a.landed && !a.away) {   // ネオン・ブースト: cyan / pink neon trails left hanging behind the exhausts
      fx.exhaust.forEach((e, i) => {
        const p = world(e);
        for (let n = Math.floor((guard ? 110 : 70) * dt + Math.random()); n > 0; n--) {
          const k = rnd(0, 1);   // spread along this frame's travel: a continuous ribbon, not dots
          S.glow.emit(p.x - vx * dt * k + rnd(-0.15, 0.15), p.y + rnd(-0.1, 0.15), p.z - vz * dt * k + rnd(-0.15, 0.15), vx * 0.08, rnd(0, 0.4), vz * 0.08,
            Math.random() < 0.8 ? PAL.tokyodive[i ? 3 : 4] : PAL.tokyodive[2], rnd(0.45, 0.7), 0.6, 0.12, 0, 1);
        }
      });
    }
  }

  if (a.id === 'family') {   // always-on blue underglow, bright while the family rides along
    if (!fx.famUnder) {
      const mat = new THREE.MeshBasicMaterial({ map: tex(S, 'under'), color: COLOR.family, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      fx.famUnder = new THREE.Mesh(S.geo.plane, mat);
      fx.famUnder.scale.set(fx.size.x * 0.9, 1, fx.size.z * 0.62);
      fx.famUnder.position.set(fx.center.x, 0.06, fx.center.z);
      fx.famUnder.renderOrder = 2;
      fx.group.add(fx.famUnder);
      fx.mats.push(mat);
    }
    fx.famUnder.material.opacity = act ? 0.8 + 0.2 * Math.sin(t * 9) : 0.32 + 0.05 * Math.sin(t * 2.2);
  }

  if (car.spin > 0 && Math.random() < dt * 25) {   // dizzy sparkles
    const th = t * 9 + rnd(-0.3, 0.3);
    world(_w.set(Math.cos(th) * 0.9, fx.box.max.y + 0.5, Math.sin(th) * 0.9));
    S.glow.emit(_v.x, _v.y, _v.z, vx, rnd(0.5, 1.5), vz, pick(PAL.spark), 0.45, 0.45, 0.05, 0, 1);
  }
}

// ---------- effects ----------
function applyOwn(race, car, a, dt) {
  if (a.chained) return chainTow(race, car, a);
  const m = car.mods, tg = a.id === 'magnet' ? a.target : null, gap = tg ? magnetGap(race, car, tg) : 0;
  if (tg && (tg.finished || tg._?.left || away(tg) || gap <= MAGNET_CATCH)) {
    a.active = 0;   // caught up (or overtook / target gone): the pull ends
    return;
  }
  // (a remote target with its mirrors up, as seen here: no pull meanwhile; its own client decides, its bounce ends the pull)
  if (!m || (tg?.control === 'net' && mirrorOn(tg))) return;
  // dock behind the target instead of ramming it at +45%: no pull while closing in faster than it could brake off by then
  if (tg && car.speed > Math.max(0, tg.speed || 0) + Math.sqrt(2 * MAGNET_DOCK * (gap - MAGNET_CATCH))) return;
  if (a.id === 'boost' || a.id === 'nitro' || a.id === 'magnet' || a.id === 'hellchain') { m.speedMul += a.power; m.accelMul += a.power; }
  else if (a.id === 'shield') m.invulnerable = true;
  else if (a.id === 'phase') { m.noCollide = true; m.noOffroadPenalty = true; m.speedMul += a.power; }
  else if (a.id === 'thunderbolt') { m.speedMul += THUNDER_BOOST; m.accelMul += THUNDER_BOOST; }   // a.power = victim's spin
  else if (a.id === 'domain') { m.speedMul += DOMAIN_BOOST; m.accelMul += DOMAIN_BOOST; }        // a.power = slow inside the dome
  else if (a.id === 'downforce') { m.downforce = a.power; m.invulnerable = true; slingshot(race, car, a, m, dt); }
  else if (a.id === 'tokyodive' && a.away) { m.noCollide = true; m.noOffroadPenalty = true; }
  else if (a.id === 'tokyodive' && a.landed) {   // ネオン・ブースト
    const b = DIVE.boost * Math.min(1, a.power);   // node a3 doesn't raise it: the leaderboard lap bound (CONTRACT)
    m.speedMul += b; m.accelMul += b;
    if (diveGuard(car)) m.invulnerable = true;
  }
  else if (a.id === 'reflect') m.reflect = true;   // game.js collide(): keeps its speed, the rammer bounces off
  else if (a.id === 'family') {   // tucked in behind the lead ally (famStep: famK), then the parting boost
    const b = a.t >= a.famDur ? FAM.partPow : 0;   // (the draft fades out meanwhile: whichever is more, not both)
    m.speedMul += Math.max(FAM.top * a.power * a.famK, b); m.accelMul += Math.max(FAM.acc * a.power * a.famK, b);
    m.gripMul += FAM.grip * a.famK;   // on the lead's line
  }
  else if (a.id === 'robotdash') {
    if (isRobot(car)) m.invulnerable = true;
    else { m.speedMul += a.power; m.accelMul += a.power; }   // changed back: the dash
  }
}

// downforce: rad turned through the current corner; out of it (after DF.turn) the slingshot. A remote car runs it too,
// for the visuals (its own client moves it)
function slingshot(race, car, a, m, dt) {
  const k = Math.abs(race.track?.samples?.[car.trackIndex]?.curv || 0);
  if (k > DF.corner) a.dfTurn = (a.dfTurn || 0) + k * Math.max(0, car.speed) * dt;
  else if (k < DF.corner * 0.7) {
    if (a.dfTurn >= DF.turn) { a.dfSling = DF.sling; a.dfKick = true; }
    a.dfTurn = 0;
  }
  m.accelMul += DF.acc * a.power;   // full traction
  m.speedMul += DF.top * a.power;
  if (!(a.dfSling > 0)) return;
  a.dfSling -= dt;
  m.accelMul += DF.slingAcc * a.power;
  m.speedMul += DF.slingTop * a.power;
}

PAL.wisp = pal('#f4fbff', '#d6ebff');   // downforce: the dirty air's pale wisps

// the planted car o whose dirty air c is in: 2..DF.wake m behind it, near its line, heading its way
function wakeOf(race, c) {
  for (const o of race.cars) {
    if (o === c || !planted(o) || o.finished || o._?.left || away(o) || faceStale(o)) continue;   // stale: frozen, not solid
    const fx = Math.sin(o.heading), fz = Math.cos(o.heading), dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;
    const back = dx * fx + dz * fz;
    if (back > 2 && back < DF.wake && Math.abs(dx * fz - dz * fx) < DF.wide + back * DF.spread && Math.cos(c.heading - o.heading) > 0.7) return o;
  }
  return null;
}

function endFx(S, car) {
  const a = car.ability, p = _w.set(car.pos.x, car.pos.y + 0.8, car.pos.z);
  if (a.id === 'shield') burst(S.glow, p, 40, PAL.shield, 8, 0.5, 0.45, 0.05);
  else if (a.id === 'phase') { setPhase(car, false); burst(S.glow, p, 30, PAL.phase, 5, 0.6, 0.4, 0.05); }
  else if (['thunderbolt', 'magnet', 'domain', 'downforce', 'robotdash', 'hellchain'].includes(a.id)) burst(S.glow, p, 30, PAL[a.id], 6, 0.5, 0.4, 0.05);
  else if (['thunderbolt', 'magnet', 'domain', 'downforce', 'robotdash', 'tokyodive', 'reflect', 'family'].includes(a.id)) burst(S.glow, p, 30, PAL[a.id], 6, 0.5, 0.4, 0.05);
  else burst(S.smoke, p, 10, PAL.smoke, 2, 0.8, 0.5, 1.4, -0.5, 1.5, 0.25);
}

// track-relative helpers
// pose.i: the car's own track index. nearest() compares x/z only, so without it a pose where the course crosses
// itself (鈴鹿's overpass) can land on the other level, half a lap off
function rideOffset(tr, pose) {
  if (!tr?.nearest) return { n: null, off: 0 };
  const n = tr.nearest(new THREE.Vector3(pose.x, pose.y, pose.z), pose.i);
  return { n, off: clamp(pose.y - n.point.y, -0.5, 1) };
}

function warpDest(race, pose, dist) {
  const tr = race.track, from = new THREE.Vector3(pose.x, pose.y, pose.z);
  if (!tr?.nearest) return { pos: from.clone().add(_v.set(Math.sin(pose.h), 0, Math.cos(pose.h)).multiplyScalar(dist)), heading: pose.h };
  const { n, off } = rideOffset(tr, pose);
  const nt = (n.tangent || tr.tangentAt(n.t)).clone().normalize();
  const t = (((n.t + dist / tr.length) % 1) + 1) % 1;
  const c = tr.pointAt(t).clone(), tan = tr.tangentAt(t).clone().normalize();
  const lim = Math.max(0, tr.width / 2 - 1.8);
  const lat = clamp(_v.copy(from).sub(n.point).dot(_w.set(-nt.z, 0, nt.x).normalize()), -lim, lim);   // + = right
  const pos = c.addScaledVector(_w.set(-tan.z, 0, tan.x).normalize(), lat);
  pos.y += off;
  const i = Math.round(t * tr.samples.length) % tr.samples.length;   // hint for looking it up again
  return { pos, heading: pose.h + wrap(Math.atan2(tan.x, tan.z) - pose.h), i };   // keep heading continuous
}

function warpFx(S, from, to, h0, h1) {
  for (const [p, h, big] of [[from, h0, false], [to, h1, true]]) {
    const c = _w.copy(p); c.y += 0.9;
    ring(S, c, COLOR.warp, { vertical: true, heading: h, r0: 0.3, r1: big ? 4.5 : 3.2, life: big ? 0.55 : 0.45 });
    glowBall(S, c, big ? 4 : 2.8, big ? 0.35 : 0.3);
    burst(S.glow, c, big ? 80 : 50, PAL.warp, big ? 14 : 9, 0.6, 0.6, 0.05, 0, 2);
    c.y -= 0.8;
    ring(S, c, '#bff4ff', { r0: 1, r1: big ? 10 : 7, life: 0.6, opacity: 0.7 });
  }
  for (let i = 0; i < 40; i++) {   // streak along the jump
    _v.lerpVectors(from, to, i / 40);
    S.glow.emit(_v.x + rnd(-0.6, 0.6), _v.y + rnd(0.3, 1.5), _v.z + rnd(-0.6, 0.6), rnd(-1, 1), rnd(0, 1), rnd(-1, 1), pick(PAL.warp), rnd(0.3, 0.7), 0.55, 0.02, 0, 1);
  }
}

function spawnOil(race, S, pose, life, power, owner) {
  const sh = Math.sin(pose.h), ch = Math.cos(pose.h);
  const pos = new THREE.Vector3(pose.x - sh * OIL_BEHIND, pose.y, pose.z - ch * OIL_BEHIND);
  let tan = new THREE.Vector3(sh, 0, ch);
  const tr = race.track;
  if (tr?.nearest) {   // sit on the road surface, tilted with the slope
    const { n: nc, off } = rideOffset(tr, pose);
    const n = tr.nearest(pos, nc.index);
    pos.y = n.point.y + off;
    if (n.tangent) tan = n.tangent.clone().normalize();
  }
  const left = new THREE.Vector3(tan.z, 0, -tan.x).normalize();
  const normal = new THREE.Vector3().crossVectors(tan, left).normalize();
  const group = new THREE.Group();
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(left, normal, tan));
  group.position.copy(pos).addScaledVector(normal, 0.05);
  const inner = new THREE.Group();
  inner.rotation.y = rnd(0, Math.PI * 2);
  group.add(inner);

  const blob = pick(tex(S, 'blobs'));
  const base = new THREE.Mesh(S.geo.plane, new THREE.MeshStandardMaterial({
    color: '#08070c', roughness: 0.1, metalness: 0.1, alphaMap: blob, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const sheen = new THREE.Mesh(S.geo.plane, new THREE.MeshBasicMaterial({
    map: tex(S, 'film'), alphaMap: blob, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }));
  base.scale.setScalar(OIL_RADIUS * 1.15);
  sheen.scale.setScalar(OIL_RADIUS * 1.15);
  sheen.position.y = 0.01;
  base.receiveShadow = true;
  base.renderOrder = 1; sheen.renderOrder = 2;
  inner.add(base, sheen);
  S.dropMat ||= new THREE.MeshStandardMaterial({ color: '#050407', roughness: 0.05, metalness: 0.3 });
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(S.geo.drop, S.dropMat), a = rnd(0, Math.PI * 2), r = rnd(0.5, 2.2), s = rnd(0.12, 0.3);
    d.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    d.scale.set(s, 0.05, s * rnd(0.8, 1.4));
    inner.add(d);
  }
  S.root.add(group);
  burst(S.smoke, _w.copy(pos).setY(pos.y + 0.6), 26, PAL.oil, 6, 0.7, 0.4, 0.15, 12, 1, 0.9, 3);

  const ph = rnd(0, 6);
  race.hazards.push({
    kind: 'oil', pos, radius: OIL_RADIUS, owner, power, life, age: 0, hits: new Set(), last: new Map(),
    update(dt) {
      this.age += dt;
      const fade = clamp((this.life - this.age) / 1.5, 0, 1);
      const k = this.age < 0.35 ? easeOutBack(this.age / 0.35) : 1;
      group.scale.setScalar(Math.max(0.01, k * (0.7 + 0.3 * fade)));
      base.material.opacity = 0.95 * fade;
      sheen.material.opacity = (0.16 + 0.06 * Math.sin(S.time * 2.1 + ph)) * fade;
      for (const c of race.cars) {
        if (c === this.owner || c.control === 'net' || c.finished || this.hits.has(c)) continue;
        // swept: closest point of the path since the last frame (fast cars at low fps step over the slick);
        // a jump longer than 12 m is a warp / respawn, test only where the car landed
        const p = this.last.get(c) || { x: c.pos.x, z: c.pos.z }, ex = c.pos.x - p.x, ez = c.pos.z - p.z, L = ex * ex + ez * ez;
        const s = L > 0 && L < 144 ? clamp(((pos.x - p.x) * ex + (pos.z - p.z) * ez) / L, 0, 1) : 1;
        this.last.set(c, { x: c.pos.x, z: c.pos.z });
        const dx = p.x + ex * s - pos.x, dz = p.z + ez * s - pos.z;
        if (dx * dx + dz * dz > OIL_RADIUS * OIL_RADIUS || Math.abs(c.pos.y - pos.y) > 2.5) continue;
        this.hits.add(c);
        if (reflects(race, c, this.owner, 'oil', { pow: this.power, at: pos })) break;   // shattered (bounce() ends its life)
        oilHit(race, S, c, this.power);
      }
      return this.age < this.life;
    },
    dispose() { group.removeFromParent(); base.material.dispose(); sheen.material.dispose(); },
  });
}

function oilHit(race, S, car, power) {
  const p = _w.set(car.pos.x, car.pos.y + 0.4, car.pos.z);
  if (car.mods?.invulnerable) {
    car.ability.hit = 1;
    burst(S.glow, p.setY(p.y + 0.6), 24, planted(car) ? PAL.downforce : PAL.shield, 7, 0.4, 0.4, 0.05);
    guardFlash(race, car);
    return;
  }
  car.spin = Math.max(car.spin || 0, power);
  burst(S.smoke, p, 30, PAL.oil, 6, 0.8, 0.35, 0.15, 12, 1, 0.9, 3);
  burst(S.glow, p.setY(p.y + 0.8), 14, PAL.spark, 4, 0.6, 0.35, 0.05, -1);
  if (isHuman(car)) flash(race, who(race, car) + 'スピン!', '#ffd23f');
}

function slowedHumans(race) {
  return race.cars.some(c => isHuman(c) && !c.mods?.invulnerable);
}

// ---------- thunderbolt ----------
// best-placed other car still racing: the leader, or the 2nd when the activator leads (_.left = quit online, game-owned)
function thunderTarget(race, car) {
  let best = null;
  for (const c of race.cars) if (c !== car && !c.finished && !c._?.left && !away(c) && (!best || c.progress > best.progress)) best = c;
  return best;
}

// ---------- magnet ----------
// m along the track. A net car is drawn and collided ~0.1 s behind its last reported progress (and that is rounded):
// measure where it is drawn instead
function drawnProgress(tr, c) {
  if (c.control !== 'net' || !tr?.nearest) return c.progress;
  const t = tr.nearest(c.pos, c.trackIndex).t;
  return c.progress + ((((t - c.progress) % 1) + 1.5) % 1) - 0.5;
}
const magnetGap = (race, car, o) => (drawnProgress(race.track, o) - drawnProgress(race.track, car)) * (race.track?.length || 0);
// closest car ahead still racing, farther than the catch distance (one already that close is no use) and within range
function magnetTarget(race, car, min = MAGNET_CATCH, range = MAGNET_RANGE) {
  let best = null, bg = range;
  for (const c of race.cars) {
    if (c === car || c.finished || c._?.left || away(c)) continue;
    const g = magnetGap(race, car, c);
    if (g > min && g <= bg) { bg = g; best = c; }
  }
  return best;
}

// midpoint displacement; the upper levels fork off thinner side branches. out = [[a, b, width], ...]
function jag(a, b, d, n, w, out, fork) {
  if (n === 0) { out.push([a, b, w]); return out; }
  const m = new THREE.Vector3().lerpVectors(a, b, 0.5).add(_v.set(rnd(-d, d), rnd(-d, d) * 0.3, rnd(-d, d)));
  jag(a, m, d / 2, n - 1, w, out, fork);
  jag(m, b, d / 2, n - 1, w, out, fork);
  if (fork && n >= 3 && Math.random() < 0.45) {
    const e = new THREE.Vector3().subVectors(b, a).multiplyScalar(rnd(0.25, 0.5)).add(m).add(_v.set(rnd(-d, d) * 1.5, 0, rnd(-d, d) * 1.5));
    jag(m, e, d / 2, n - 2, w * 0.5, out, false);
  }
  return out;
}

// two crossed ribbons per segment: reads from any side without per-view billboarding
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
// g: rewrite an existing geometry in place (same segment count every call)
function ribbons(segs, g = new THREE.BufferGeometry()) {
  let P = g.attributes.position?.array, U = g.attributes.uv?.array;
  if (P?.length !== segs.length * 36) {
    P = new Float32Array(segs.length * 36); U = new Float32Array(segs.length * 24);
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  }
  const d = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3();
  let i = 0, j = 0;
  for (const [a, b, w] of segs) {
    d.subVectors(b, a).normalize();
    s1.crossVectors(d, Math.abs(d.y) > 0.7 ? _X : _Y).normalize();
    s2.crossVectors(d, s1);
    for (const s of [s1, s2]) {
      for (const [p, k] of [[a, -1], [b, -1], [b, 1], [a, -1], [b, 1], [a, 1]]) {
        P[i++] = p.x + s.x * k * w / 2; P[i++] = p.y + s.y * k * w / 2; P[i++] = p.z + s.z * k * w / 2;
        U[j++] = (k + 1) / 2; U[j++] = 0.5;
      }
    }
  }
  g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = true;
  return g;
}

const boltMat = (S, color) => new THREE.MeshBasicMaterial({
  map: tex(S, 'beam'), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  side: THREE.DoubleSide, fog: false, toneMapped: false,
});

// whole-viewport flash for a local player (bottom half in split screen for P2): thunder victim by default
const THUNDER_SCREEN = ['radial-gradient(ellipse at 50% 20%, rgba(255,255,255,0.9), rgba(160,215,255,0.6) 50%, rgba(60,110,255,0.45) 100%)',
  [{ opacity: 1 }, { opacity: 0.1, offset: 0.2 }, { opacity: 0.85, offset: 0.35 }, { opacity: 0 }], 450];
const HELL_SCREEN = ['radial-gradient(ellipse at center, rgba(255,120,30,0) 40%, rgba(255,70,10,0.45) 75%, rgba(170,10,0,0.75) 100%)',
  [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0.5, offset: 0.4 }, { opacity: 0 }], 700];
const DOMAIN_SCREEN = ['radial-gradient(ellipse at center, rgba(215,160,255,0.55), rgba(90,20,170,0.6) 55%, rgba(20,0,40,0.9) 100%)',
  [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.6, offset: 0.5 }, { opacity: 0 }], 900];
function screenFlash(race, car, [bg, frames, ms] = THUNDER_SCREEN) {
  if (typeof document === 'undefined') return;
  const split = race.mode === 'split', el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', left: '0', width: '100%', pointerEvents: 'none', zIndex: '5',
    top: split && car.control === 'p2' ? '50%' : '0', height: split ? '50%' : '100%',
    background: bg,
  });
  (document.getElementById('game') || document.body).appendChild(el);
  el.animate?.(frames, { duration: ms, fill: 'forwards' });
  setTimeout(() => el.remove(), ms + 10);
}

// bolt from the sky onto the target (follows it for its 0.4 s), spark burst; spin unless shielded or reflecting (src = the
// caster, may be null). A 'net' target's spin only turns its mesh here: its own client applies the real one (or reflects).
function strike(race, S, target, pow, src = null) {
  if (!target?.pos || away(target)) return;
  const bolt = new THREE.Mesh(ribbons(jag(new THREE.Vector3(rnd(-8, 8), 75, rnd(-8, 8)), new THREE.Vector3(0, 0.9, 0), 9, 6, 2.4, [], true)), boltMat(S, '#ffffff'));
  bolt.userData.ownGeo = true;
  bolt.frustumCulled = false;
  bolt.renderOrder = 22;
  addFx(S, bolt, 0.4, (o, k) => {
    o.position.copy(target.pos);
    o.material.opacity = (k > 0.12 && k < 0.2) || (k > 0.45 && k < 0.52) ? 0.15 : 1 - k * 0.6;   // strike, flicker, restrike
  });
  const p = new THREE.Vector3(target.pos.x, target.pos.y + 0.9, target.pos.z), guard = !!target.mods?.invulnerable || mirrorOn(target);
  glowBall(S, p, guard ? 2.4 : 2.8, 0.22, guard ? '#e8feff' : '#cfeaff');
  burst(S.glow, p, 70, guard ? (planted(target) ? PAL.downforce : PAL.shield) : PAL.thunderbolt, 14, 0.6, 0.55, 0.05, 12, 1.5, 1, 4);
  ring(S, _w.set(p.x, target.pos.y + 0.15, p.z), COLOR.thunderbolt, { r0: 1, r1: 9, life: 0.5 });
  if (target.finished || reflects(race, target, src, 'thunderbolt', { pow })) return;
  if (guard) {
    if (mirrorOn(target)) return;   // a remote reflector: its own client decides (the bounce message follows)
    if (target.ability) target.ability.hit = 1;
    guardFlash(race, target);
    return;
  }
  target.spin = Math.max(target.spin || 0, pow);
  burst(S.smoke, p, 14, PAL.smoke, 3, 0.9, 0.5, 1.6, -0.5, 1.5, 0.3);
  if (isHuman(target)) { flash(race, who(race, target) + '⚡ 落雷!', '#8fd8ff'); screenFlash(race, target); }
}

// ---------- domain ----------
// a dome of DOMAIN_R m that follows its owner (a remote owner's interpolated car; a static pose when the owner is unknown).
// The slow / seal itself is applied in updateAbilities, to this client's own cars only.
function spawnDomain(race, S, owner, at, dur, pow) {
  const g = new THREE.Group(), center = at.clone();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(COLOR.domain) }, uTime: { value: 0 }, uOpacity: { value: 0 } },
    vertexShader: SHIELD_VERT, fragmentShader: DOMAIN_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const dome = new THREE.Mesh(S.geo.dome ||= new THREE.SphereGeometry(1, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  dome.renderOrder = 18;
  const runes = [0.2, 0.35].map(y => {
    const m = new THREE.Mesh(S.geo.plane, new THREE.MeshBasicMaterial({
      map: tex(S, 'rune'), color: '#9b3dff', transparent: true, depthWrite: false,   // normal blend: additive washes out to white on bright ground
      fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    m.position.y = y;
    m.renderOrder = 17;
    return m;
  });
  g.add(dome, ...runes);
  g.position.copy(center);
  S.root.add(g);
  const c = _w.copy(center).setY(center.y + 0.4);
  ring(S, c, COLOR.domain, { r0: 2, r1: DOMAIN_R, life: 0.9, opacity: 0.9 });
  ring(S, c, '#f3e0ff', { r0: 1, r1: DOMAIN_R * 0.6, life: 0.6, opacity: 0.6 });
  glowBall(S, c.setY(center.y + 1.5), 9, 0.5, '#d9a6ff');
  burst(S.glow, c, 90, PAL.domain, 18, 0.9, 0.8, 0.05, -2, 1.5, 1, 4);
  const tr = race.track, tan = new THREE.Vector3(), left = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();
  let hint;
  race.hazards.push({
    kind: 'domain', owner, power: pow, center, life: dur, age: 0, on: true,
    update(dt) {
      this.age += dt;
      if (owner?._?.left) this.life = Math.min(this.life, this.age);   // owner quit (online)
      this.on = this.age < this.life;
      if (owner?.pos) center.copy(owner.pos);
      if (tr?.nearest) {   // lie on the road like the oil slick: tilt to the grade across the dome (chord over ~0.7 R each way)
        const N = tr.samples.length, i = hint = tr.nearest(center, hint).index, s = Math.round(DOMAIN_R * 0.7 / tr.length * N);
        tan.subVectors(tr.samples[(i + s) % N].pos, tr.samples[(i - s + N) % N].pos).normalize();
        left.set(tan.z, 0, -tan.x).normalize();
        g.quaternion.setFromRotationMatrix(basis.makeBasis(left, up.crossVectors(tan, left), tan));
      }
      const k = this.on ? Math.max(0.01, easeOutBack(Math.min(1, this.age / 0.7))) : 1 - (this.age - this.life) / 0.5;   // grow in, collapse out
      if (k <= 0) return false;
      const blink = this.on && this.life - this.age < 1 && Math.sin(S.time * 30) < -0.3 ? 0.55 : 1;   // about to expire
      g.position.copy(center);
      dome.scale.setScalar(DOMAIN_R * k);
      runes[0].scale.setScalar(DOMAIN_R * k);
      runes[1].scale.setScalar(DOMAIN_R * 0.55 * k);
      runes[0].rotation.y += dt * 0.12;
      runes[1].rotation.y -= dt * 0.3;
      const o = Math.min(1, this.age * 3) * Math.min(1, k) * blink;
      mat.uniforms.uTime.value = S.time;
      mat.uniforms.uOpacity.value = o;
      runes[0].material.opacity = o * (0.75 + 0.25 * Math.sin(S.time * 3));
      runes[1].material.opacity = o * 0.8;
      if (this.on) {
        for (let n = Math.floor(90 * dt + Math.random()); n > 0; n--) {   // motes drifting up inside the dome
          const r = Math.sqrt(Math.random()) * DOMAIN_R * k * 0.95, th = rnd(0, Math.PI * 2);
          const p = _w.set(Math.cos(th) * r, rnd(0, 2), Math.sin(th) * r).applyQuaternion(g.quaternion).add(center);
          S.glow.emit(p.x, p.y, p.z, rnd(-0.3, 0.3), rnd(2, 4), rnd(-0.3, 0.3), pick(PAL.domain), rnd(1.8, 2.8), 1.1, 0.3, -0.6, 0.2, 0.9);
        }
      }
      return true;
    },
    dispose() { g.removeFromParent(); mat.dispose(); runes.forEach(m => m.material.dispose()); },
  });
}

// ---------- hellchain ----------
const _cA = new THREE.Vector3(), _cB = new THREE.Vector3(), _Z = new THREE.Vector3(0, 0, 1), _one = new THREE.Vector3(1, 1, 1);
const _q = new THREE.Quaternion(), _roll = new THREE.Quaternion().setFromAxisAngle(_Z, Math.PI / 2), _m = new THREE.Matrix4(), _c = new THREE.Color();
const HEAT = pal('#8a1606', '#ffc861');
// the owner's nose -> the target's tail, sagging and rattling. Abilities run before physics: the ends are put where the
// cars will be drawn this frame (pos + vel dt). at(s) reuses _cA / _cB: use one curve before asking for the next.
function chainCurve(car, tg, dt, t) {
  for (const [c, P, k] of [[car, _cA, halfLen(car) - 0.15], [tg, _cB, 0.15 - halfLen(tg)]]) {
    P.set(c.pos.x + Math.sin(c.heading) * k + (c.vel?.x || 0) * dt, c.pos.y + 0.62, c.pos.z + Math.cos(c.heading) * k + (c.vel?.z || 0) * dt);
  }
  const len = _cA.distanceTo(_cB), sag = clamp(len * 0.02, 0.1, 0.45);
  return { len, at: (s, out) => { out.lerpVectors(_cA, _cB, s).y -= (4 * sag + 0.5 * Math.sin(s * 14 - t * 20)) * s * (1 - s); return out; } };
}

function chainMeshes(S) {
  S.geo.link ||= new THREE.TorusGeometry(0.13, 0.04, 6, 12).scale(1, 1.75, 1).rotateX(Math.PI / 2);   // oval link along Z
  S.chainMat ||= new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ff3408', emissiveIntensity: 1.6, metalness: 0.4, roughness: 0.45 });
  const links = new THREE.InstancedMesh(S.geo.link, S.chainMat, LINKS);
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  links.setColorAt(0, HEAT[0]);
  links.frustumCulled = false;
  links.count = 0;
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), boltMat(S, COLOR.hellchain));
  glow.frustumCulled = false;
  glow.renderOrder = 22;
  const pts = Array.from({ length: CHAIN_SEG + 1 }, () => new THREE.Vector3());
  S.root.add(links, glow);
  return { links, glow, pts, segs: pts.slice(1).map((p, i) => [pts[i], p, 0.6]) };
}

// burning chain: links (alternate ones turned 90 deg), a heat-glow ribbon, flames along it, sparks where it bites
function chainVisuals(S, car, a, dt) {
  const C = a.chainFx ||= chainMeshes(S), tg = a.chained ? a.target : null;
  C.links.visible = C.glow.visible = !!tg?.pos;
  if (!tg?.pos) return;
  const t = S.time, { len, at } = chainCurve(car, tg, dt, t), reach = Math.min(1, a.t / HELL.hook);   // it flies out first
  const pitch = Math.max(LINK_PITCH, len / LINKS), n = Math.min(LINKS, Math.floor(len * reach / pitch));
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * pitch / Math.max(len, 1e-3);
    _q.setFromUnitVectors(_Z, _d.subVectors(at(s + 0.01, _a), at(s - 0.01, _b)).normalize());
    if (i & 1) _q.multiply(_roll);
    C.links.setMatrixAt(i, _m.compose(at(s, _v), _q, _one));
    C.links.setColorAt(i, _c.lerpColors(HEAT[0], HEAT[1], 0.5 + 0.5 * Math.sin(s * len * 0.8 - t * 14 + (i & 3))));
  }
  C.links.count = n;
  C.links.instanceMatrix.needsUpdate = true;
  if (C.links.instanceColor) C.links.instanceColor.needsUpdate = true;
  S.chainMat.emissiveIntensity = 1.4 + 0.5 * Math.sin(t * 17);
  C.pts.forEach((p, j) => at(j / CHAIN_SEG * reach, p));
  C.segs.forEach((g, j) => { g[2] = 0.5 + 0.2 * Math.sin(t * 25 + j); });
  ribbons(C.segs, C.glow.geometry);
  C.glow.material.opacity = 0.55 + 0.3 * Math.sin(t * 23);
  const vx = ((car.vel?.x || 0) + (tg.vel?.x || 0)) / 2, vz = ((car.vel?.z || 0) + (tg.vel?.z || 0)) / 2;
  for (let k = Math.min(40, Math.floor(dt * (30 + len * 3) + Math.random())); k > 0; k--) {   // flames licking up off it
    const p = at(Math.random() * reach, _v);
    S.glow.emit(p.x + rnd(-0.15, 0.15), p.y, p.z + rnd(-0.15, 0.15), vx * 0.9 + rnd(-1, 1), rnd(1, 3.5), vz * 0.9 + rnd(-1, 1), pick(PAL.hellchain), rnd(0.25, 0.5), 0.55, 0.1, -2, 1.5);
  }
  if (Math.random() < dt * 10) { const p = at(Math.random() * reach, _v); S.smoke.emit(p.x, p.y + 0.3, p.z, vx * 0.8, 1.2, vz * 0.8, pick(PAL.smoke), 0.8, 0.4, 1.4, -0.4, 1.5, 0.2); }
  const tip = reach < 1 ? at(reach, _w) : _cB;
  for (const P of [_cA, tip]) {
    for (let k = Math.floor(dt * 35 + Math.random()); k > 0; k--) S.glow.emit(P.x, P.y, P.z, vx + rnd(-4, 4), rnd(1, 4), vz + rnd(-4, 4), pick(PAL.spark), rnd(0.2, 0.4), 0.3, 0.05, 12, 0.5);
  }
  if (reach >= 1 && !a.hookFx) {   // it bites
    a.hookFx = true;
    burst(S.glow, _cB, 40, PAL.hellchain, 8, 0.5, 0.5, 0.05, 6);
    ring(S, _cB, COLOR.hellchain, { vertical: true, heading: tg.heading, r0: 0.3, r1: 3, life: 0.35 });
  }
}

function chainSnapFx(S, car, tg) {
  const { at } = chainCurve(car, tg, 0, S.time), mid = at(0.5, new THREE.Vector3());
  const vx = ((car.vel?.x || 0) + (tg.vel?.x || 0)) / 2, vz = ((car.vel?.z || 0) + (tg.vel?.z || 0)) / 2;
  for (let i = 0; i < 80; i++) {   // the links burst into embers
    const p = at(Math.random(), _v);
    S.glow.emit(p.x, p.y, p.z, vx * 0.8 + rnd(-5, 5), rnd(1, 6), vz * 0.8 + rnd(-5, 5), pick(PAL.hellchain), rnd(0.4, 0.8), 0.6, 0.1, 9, 1);
  }
  glowBall(S, mid, 2.4, 0.25, '#ffb347');
  ring(S, mid, COLOR.hellchain, { vertical: true, heading: Math.atan2(_cB.x - _cA.x, _cB.z - _cA.z), r0: 0.4, r1: 4.5, life: 0.4 });
  burst(S.smoke, mid, 12, PAL.smoke, 3, 0.8, 0.5, 1.6, -0.5, 1.5, 0.3);
}

// chained: release checks on every client (a lost 'rel' can't leave a remote chain hanging), then, on the owner's own
// client, the tow toward a point HELL.follow m behind the target and the steering along its line
function chainTow(race, car, a) {
  const tg = a.target, tr = race.track;
  if (a.t < HELL.hook) return;   // still flying
  // a remote target's mirrors up (as this client sees them): hold the tow. Its own client decides: its bounce message
  // releases the chain here (bounce()); if our view of the mirrors ends first, it didn't reflect it and the chain carries on
  if (tg.control === 'net' && mirrorOn(tg)) return;
  const gap = magnetGap(race, car, tg), proof = chainProof(tg);
  // (owner quit online: its car is frozen where it left and no 'rel' will come)
  if (a.t >= a.chainDur || car.finished || car._?.left || tg.finished || tg._?.left || proof || gap < 0 || gap > HELL.range * 1.5 || car.pos.distanceTo(tg.pos) <= HELL.snap) {
    chainRelease(race, car, a, !proof);
    return;
  }
  const m = car.mods, inp = car.input;
  if (car.control === 'net' || !m || !tr?.samples) return;
  const N = tr.samples.length, W = Math.max(0, tr.width / 2 - 1.8), ts = tr.samples[tg.trackIndex] || tr.samples[0], own = tr.samples[car.trackIndex] || ts;
  // spring, only while facing down the road, adding speed up to the target's + 25% x power (the chain goes slack after that).
  // Coasting or on the throttle, but never against the brakes, a spin or the off-road drag; a CPU only while it is below
  // the corner speed it wants (full throttle)
  const align = Math.max(0, Math.sin(car.heading) * own.tan.x + Math.cos(car.heading) * own.tan.z);
  const want = car.spin > 0 || car.offroad ? 0 : car.control === 'cpu' ? +(inp.throttle >= 1) : 1 - inp.brake;
  const slack = Math.max(0, gap - HELL.follow), pw = a.power / 0.4;   // pw = 1 at base power
  m.tow = Math.min(HELL.k * slack, HELL.pull * a.power) * align * want;
  // the chain reels the owner in: faster the farther away, easing off near the follow point
  m.towV = Math.max(0, tg.speed || 0) + Math.min(HELL.reelMax * pw, HELL.reel * pw * slack);
  if (!isHuman(car)) return;   // a CPU keeps its own line (it pulls out beside a car it closes on anyway)
  // steering assist: aim at the road ahead (never past the target) one lane beside the target's line, inside the road.
  // game.js blends it into the player's own steer (a drift still needs the player's own hard steer)
  const tLat = (tg.pos.x - ts.pos.x) * ts.right.x + (tg.pos.z - ts.pos.z) * ts.right.z, room = k => W - k * tLat;
  if (room(a.side) < HELL.lane && room(-a.side) > room(a.side)) a.side = -a.side;
  const lane = clamp(tLat + a.side * HELL.lane, -W, W);
  const p = tr.samples[(car.trackIndex + Math.max(1, Math.round(Math.min(gap, 7 + Math.max(0, car.speed) * 0.42) / (tr.length / N)))) % N];
  m.assist = clamp(wrap(Math.atan2(p.pos.x + p.right.x * lane - car.pos.x, p.pos.z + p.right.z * lane - car.pos.z) - car.heading) * 2.4, -1, 1);
}

// the chain snaps: slingshot, or the small consolation boost when the target shrugged it off, or nothing when it was
// reflected (bounced: the penalty comes from bounce()). The owner's client tells everyone ('rel'); every client also
// releases on its own checks, whichever comes first.
function chainRelease(race, car, a, sling, bounced = false) {
  const S = st(race), tg = a.target, b = sling ? HELL_SLING : HELL_MISS;
  if (tg?.pos) chainSnapFx(S, car, tg);
  if (tg && !sling && !bounced && tg.control !== 'net' && !away(tg)) {
    if (tg.ability) tg.ability.hit = 1;
    guardFlash(race, tg);
  }
  // the snap whips the target round: a spin on the target's own client (every client runs the release; remote cars skip)
  if (tg && sling && tg.control !== 'net' && !tg.finished && !chainProof(tg) && !mirrorOn(tg)) {
    tg.spin = Math.max(tg.spin || 0, HELL_SLING.whip);
    if (isHuman(tg)) flash(race, who(race, tg) + '鎖で振り回された!', COLOR.hellchain);
  }
  a.chained = false; a.target = null; a.t = 0;
  a.active = a.activeMax = bounced ? 0 : b.dur;
  a.power = b.pow;
  if (sling && isHuman(car)) flash(race, who(race, car) + 'スリングショット!', COLOR.hellchain);
  if (race.net && car.control === 'p1') race.net.send({ t: 'ability', pid: race.localPid, id: 'hellchain', rel: 1, ...(bounced && { b: 1 }) });   // b: reflected, no slingshot / whip anywhere
}

// ---------- reflect ----------
// While a car's mirrors are up, every attack aimed at it bounces back onto whoever made it; the car itself is untouched.
// Only the reflecting car's own client decides (it owns the car): reflects() there applies the bounce to a local attacker
// (solo / split: CPUs, the other player) or sends { t:'ability', id:'reflect', ref, tp /* attacker */, n, sp, sl, st, ox?, oz? }
// so the attacker's own client applies it exactly once (dropped duplicates by pid + n; lost = no bounce, like any lost
// ability message). The attacker's own part of the attack (tow, pull, boost) ends; an attacker that is itself immune
// (shield / phase / robot / away) shrugs the bounce off: the reflect fizzles. Numbers per attack (x = the attack's own
// numbers, k = the reflector's power, 1 = as strong as the attack was); end = the attacker's own part stops:
const REFLECT = {
  thunderbolt: (x, k) => ({ spin: x.pow * k, end: true }),                          // the bolt jumps to the caster; its boost ends
  hellchain: (x, k) => ({ spin: HELL_SLING.whip * k, slow: 0.4, slowT: 1.5 * k, end: true }),   // snaps back: whipped round, no slingshot
  magnet: (x, k) => ({ slow: 0.35, slowT: 1.5 * k, end: true }),                    // repelled: the pull ends, a short slow
  timeslow: (x, k) => ({ slow: x.pow, slowT: x.left * k }),                         // the caster gets what was left of it
  domain: (x, k) => ({ slow: Math.min(x.pow, DOMAIN_MAX_SLOW), slowT: Math.min(x.left, 3) * k }),   // the owner gets the dome's slow (≤ 3 s); the reflector is free in there
  oil: (x, k) => ({ spin: x.pow * k }),                                             // the slick shatters, the glob flies back under the dropper
  facewall: (x, k) => ({ slow: 0.35, slowT: 1.5 * k }),                             // the reflector drives through; the wall's owner is held back
  robotdash: () => ({}),                                                            // the robot is immune: the knock just fizzles
};
const BOUNCE_MAX = { spin: 3, slow: 0.6, slowT: 6 };   // cap on what a (possibly crafted) message may ask for
COLOR.reflect = '#bfefff';
PAL.reflect = pal('#ffffff', '#e8f6ff', '#bfefff', '#8fd8ff', '#d9c8ff');
const MIRROR_SCREEN = ['radial-gradient(ellipse at 50% 40%, rgba(255,255,255,0.85), rgba(190,235,255,0.5) 45%, rgba(120,170,255,0.35) 100%)',
  [{ opacity: 1 }, { opacity: 0.2, offset: 0.25 }, { opacity: 0.6, offset: 0.4 }, { opacity: 0 }], 500];

// an attack `id` by src (null: an unknown remote car) meets tg: true = tg reflects it (the caller leaves tg alone)
function reflects(race, tg, src, id, x = {}) {
  if (!mirrorOn(tg) || tg.finished || tg.control === 'net' || src === tg || !REFLECT[id]) return false;   // finished: out of the race, its mirrors too
  const S = st(race), e = REFLECT[id](x, tg.ability.power || 1);
  bounce(race, S, tg, src, id, e, x.at);
  if (race.net && tg.control === 'p1' && src?.control === 'net' && src.pid != null) {
    race.net.send({ t: 'ability', pid: race.localPid, id: 'reflect', ref: id, tp: String(src.pid), n: S.rn = (S.rn || 0) + 1,
      x: r2(tg.pos.x), y: r2(tg.pos.y), z: r2(tg.pos.z), sp: r2(e.spin || 0), sl: r2(e.slow || 0), st: r2(e.slowT || 0), ...(x.at && { ox: r2(x.at.x), oz: r2(x.at.z) }) });
  }
  return true;
}

// on every client that learns of a reflection: the flash / beam, the attacker's own part ends, and where the attacker is
// local, the bounce lands (or fizzles). tg may be null (unknown remote pid): the beam starts at `from`.
function bounce(race, S, tg, src, id, e, at = null, from = tg?.pos) {
  if (tg?.ability) tg.ability.hit = 1;
  if (from) {
    const p = _v.set(from.x, from.y + 1.4, from.z);
    glowBall(S, p, 2, 0.22, '#ffffff');
    ring(S, p, COLOR.reflect, { vertical: true, heading: (tg?.heading || 0) + Math.PI / 2, r0: 0.5, r1: 4, life: 0.35 });   // across the car, facing its sides
    ring(S, _w.set(p.x, p.y - 1.2, p.z), '#ffffff', { r0: 1, r1: 7, life: 0.4, opacity: 0.7 });
    burst(S.glow, p, 50, PAL.reflect, 11, 0.5, 0.5, 0.05, 0, 2);
    if (src?.pos) {
      const q = _w.set(src.pos.x, src.pos.y + 1, src.pos.z), beam = new THREE.Mesh(ribbons(jag(p.clone(), q.clone(), 0.6, 4, 0.9, [], false)), boltMat(S, COLOR.reflect));
      beam.userData.ownGeo = true;
      beam.frustumCulled = false;
      beam.renderOrder = 22;
      addFx(S, beam, 0.4, (o, k) => { o.material.opacity = (1 - k) * (k < 0.1 ? 0.6 : 1); });
      ring(S, q, COLOR.reflect, { vertical: true, heading: src.heading, r0: 0.4, r1: 4, life: 0.4 });
      burst(S.glow, q, 30, PAL.reflect, 8, 0.45, 0.45, 0.05, 0, 2);
    }
  }
  if (at) {   // the oil slick: shattered, everywhere
    burst(S.smoke, _w.set(at.x, (tg?.pos.y ?? 0) + 0.5, at.z), 24, PAL.oil, 7, 0.6, 0.4, 0.15, 12, 1, 0.9, 3);
    for (const hz of race.hazards) if (hz.kind === 'oil' && hz.owner === src && (hz.pos.x - at.x) ** 2 + (hz.pos.z - at.z) ** 2 < 4) hz.life = Math.min(hz.life, hz.age);
  }
  const human = isHuman(tg || {}) ? tg : src && isHuman(src) ? src : null;
  if (human) flash(race, who(race, human) + '反射！', COLOR.reflect);
  if (!src) return;
  const a = src.ability;
  if (e.end && a) {   // the attacker's own part of it stops (on every client, so its visuals stop too)
    if (a.chained) chainRelease(race, src, a, false, true);
    else if (a.id === id && (id === 'magnet' || id === 'thunderbolt')) a.active = 0;
  }
  if (src.control === 'net' || src.finished || src._?.left || !a) return;
  if (chainProof(src)) {   // shield / phase / robot / away: the bounce fizzles
    a.hit = 1;
    if (isHuman(src)) flash(race, who(race, src) + 'ガード!', COLOR.shield);
    return;
  }
  if (e.spin > 0) src.spin = Math.max(src.spin || 0, e.spin);
  if (e.slow > 0 && e.slowT > 0) { a.bounceP = Math.max(a.bounceT > 0 ? a.bounceP : 0, e.slow); a.bounceT = Math.max(a.bounceT || 0, e.slowT); }
  if (isHuman(src)) { screenFlash(race, src, MIRROR_SCREEN); race.hud?.shake?.(src, 0.3); }
}

// ---------- facewall ----------
// Copies of the owner's own mesh (shared geometry / materials) in a line across the road at the owner's spot on the track:
// a pair every FACE.every s, FACE.gap m apart, out to the barriers, spinning and hopping. They ride along with the owner
// (a remote owner's predicted car). The block itself is faceWall(), run by game.js; each client blocks only its own cars.
const FACE = { gap: 4.5, every: 0.35, pop: 0.35, out: 0.5, half: 2.3, spin: 11, min: 4.4, push: 0.35, slower: 2, bounce: 3, again: 0.6 };
COLOR.facewall = '#ffb37a';
PAL.facewall = pal('#fff4e8', '#ffd2ad', '#ffb37a', '#ff8a5c');

function facePuff(S, p) {
  burst(S.smoke, _w.set(p.x, p.y + 1, p.z), 14, PAL.smoke, 4, 0.7, 0.8, 2.2, -0.5, 1.5, 0.45);
  burst(S.glow, _w.set(p.x, p.y + 1.2, p.z), 16, PAL.facewall, 6, 0.4, 0.45, 0.05);
}

// Lateral of face slot k (±1, ±2 …) beside an owner at lateral ol: clamped to lim (= barrier − FACE.half) so the outer
// faces pile up against the barrier and reach it; null = not shown (the slot before it is already at the barrier).
function faceLat(ol, k, lim) {
  const u = ol + k * FACE.gap;
  return Math.sign(k) * u - FACE.gap >= lim ? null : clamp(u, -lim, lim);
}
// the lateral edge (sg = 1 right, -1 left) of the shown faces, the owner itself counting as one: faceWall blocks up to it
function faceEdge(ol, pairs, lim, sg) {
  let e = ol;
  for (let k = 1, l; k <= pairs && (l = faceLat(ol, sg * k, lim)) != null; k++) e = l;
  return e + sg * FACE.half;
}
// a remote owner silent for 1 s (hidden tab, lost link) is frozen on screen: like game.js collide() (NET_STALE), its
// wall doesn't block and its faces fade out until its states come back
const faceStale = o => o.control === 'net' && performance.now() / 1000 - (o._?.net?.t ?? -Infinity) >= 1;
// forward (x, z) of the row's spot: the curve's own tangent there, so the row turns smoothly through a corner instead of
// swinging a few tenths of a radian each time the owner passes a track sample
function faceFwd(tr, n) {
  const t = tr.tangentAt(n.t), l = Math.hypot(t.x, t.z) || 1;
  return [t.x / l, t.z / l];
}

function spawnFaceWall(race, S, owner, dur) {
  const tr = race.track;
  if (!owner.mesh || !tr?.nearest) return;
  const proto = new THREE.Group();
  for (const c of owner.mesh.children) if (!c.userData.abilFx && !c.isLight) proto.add(c.clone());   // not its fx / headlight
  const wall = tr.wall ?? tr.width / 2 + 9.4, lim = wall - FACE.half, pairs = Math.ceil(2 * wall / FACE.gap), faces = [];
  let hint = owner.trackIndex;
  race.hazards.push({
    kind: 'facewall', owner, on: true, age: 0, life: dur, pairs: 0, lim,
    update(dt) {
      this.age += dt;
      if (owner._?.left) this.life = Math.min(this.life, this.age);   // owner quit (online)
      const was = this.on;
      this.on = this.age < this.life;
      while (this.on && faces.length < pairs * 2 && this.age >= faces.length / 2 * FACE.every) {
        const k = faces.length / 2 + 1;
        for (const sg of [1, -1]) {
          const o = proto.clone();
          S.root.add(o);
          faces.push({ o, k: sg * k, born: this.age, ph: rnd(0, Math.PI * 2), vis: null, puff: false });
        }
      }
      this.pairs = faces.length / 2;
      // placed where the owner will be after this frame's physics / net prediction (they run after the hazards), so the
      // row lines up with the drawn car and with faceWall()'s hold instead of trailing it by speed × dt
      const stale = faceStale(owner), at = stale ? owner.pos : _v.copy(owner.pos).addScaledVector(owner.vel, dt);
      const n = tr.nearest(at, hint), [fx, fz] = faceFwd(tr, n), h0 = Math.atan2(fx, fz), ax = at.x, az = at.z;
      hint = n.index;
      const end = this.on ? 0 : (this.age - this.life) / FACE.out;
      if (end >= 1) return false;
      for (const f of faces) {
        const t = this.age - f.born, lat = faceLat(n.lateral, f.k, lim), inside = lat != null && !stale;
        f.vis = f.vis == null ? +inside : f.vis + (+inside - f.vis) * Math.min(1, dt * 8);
        const sc = (t < FACE.pop ? easeOutBack(t / FACE.pop) : 1) * f.vis * (1 - end * end);
        f.o.visible = sc > 0.01;
        if (!f.o.visible) continue;
        f.o.scale.setScalar(sc);
        if (lat != null) f.o.position.set(ax - fz * (lat - n.lateral), n.point.y + 0.3 * Math.abs(Math.sin(t * 7 + f.ph)), az + fx * (lat - n.lateral));
        f.o.rotation.set(0, h0 + f.ph + t * FACE.spin + end * end * 25, Math.sin(t * 9 + f.ph) * 0.12);
        if ((!f.puff && inside) || (was && !this.on)) { f.puff = true; facePuff(S, f.o.position); }
      }
      return true;
    },
    dispose() { for (const f of faces) f.o.removeFromParent(); },   // geometry / materials are the owner's
  });
}

// CPU: raise the wall when a car is close behind (no use otherwise)
function faceWanted(race, car) {
  return race.cars.some(c => {
    const gap = (car.progress - c.progress) * (race.track?.length || 0);
    return c !== car && !c.finished && !c._?.left && !away(c) && gap > 3 && gap < 30;
  });
}

const armed = (c, k) => c.ability?.id === k && c.ability.gauge >= 1 && !(c.ability.active > 0) && !c.ability.sealed;
// an attack on its way to car (shield / reflect): chained, a full thunderbolt / hellchain that would pick it, a dome near
function incoming(race, car, rivals) {
  if (rivals.some(c => c.ability?.chained && c.ability.target === car)) return 'chained';
  if (rivals.some(c => armed(c, 'thunderbolt') && thunderTarget(race, c) === car)) return 'thunder armed';
  if (rivals.some(c => armed(c, 'hellchain') && magnetTarget(race, c, HELL.snap, HELL.range) === car)) return 'chain armed';
  if ((race.hazards || []).some(h => h.kind === 'domain' && h.on && h.owner !== car && !h.bounced?.has(car) && car.pos.distanceTo(h.center) < DOMAIN_R + 15)
    || rivals.some(c => armed(c, 'domain') && car.pos.distanceTo(c.pos) < DOMAIN_R)) return 'domain';
  return false;
}

// CPU tactics (difficulty 'hard' and up): game.js asks while a CPU's gauge is full and fires on a truthy answer, the reason
// (kept in car._.abilWhy for logs). road = { straight: flat-out m ahead, corner: m to the next lift, room: m it can go at
// this speed before it has to brake }. Anything without a rule here (new abilities) goes on a straight.
export function cpuAbility(race, car, road) {
  const id = car.ability.id, rivals = race.cars.filter(c => c !== car && !c.finished && !c._?.left && !away(c));   // a diver's progress is frozen
  const gap = c => magnetGap(race, car, c);   // m along the track, + = ahead
  const near = r => rivals.filter(c => car.pos.distanceTo(c.pos) < r);
  if (car.spin > 0) return id === 'robotdash' && 'spin';   // the robot shakes a spin off; anything else would be wasted
  switch (id) {
    case 'boost': return road.straight > 80 && 'straight';
    case 'nitro': return road.straight > 140 && 'straight';
    case 'downforce': {   // a twisty stretch just ahead (flat out through it, a slingshot out of each corner), a rival in
      // its dirty air to be, or an attack on its way (planted: no spin / slow, a chain can't hook it)
      const tr = race.track, S = tr.samples, N = S.length, s = S[car.trackIndex];
      let turn = 0;
      for (let k = 0; k * tr.spacing < DF.look; k++) turn += Math.abs(S[(car.trackIndex + k) % N].curv) * tr.spacing;
      if (turn > DF.twisty && road.corner < 80) return 'twisty';
      if (rivals.some(c => -gap(c) > 2 && -gap(c) < DF.wake && Math.abs((c.pos.x - car.pos.x) * s.right.x + (c.pos.z - car.pos.z) * s.right.z) < DF.wide + 1)) return 'wake';
      return incoming(race, car, rivals);
    }
    // attacks: never at a car whose mirrors are up (it would all come back)
    case 'thunderbolt': {   // not leading, and the leader close enough to pass while it spins
      const t = thunderTarget(race, car), g = t ? gap(t) : 0;
      return g > 0 && g < 120 && !t.mods?.invulnerable && !mirrorOn(t) && `target ${Math.round(g)}m`;
    }
    case 'magnet': case 'hellchain': {   // the car it would pick: the nearest one ahead (a magnet pulls at a planted one too)
      const t = id === 'magnet' ? magnetTarget(race, car) : magnetTarget(race, car, HELL.snap, HELL.range), g = t ? gap(t) : 0;
      return g >= (id === 'magnet' ? 30 : 20) && g <= 150 && (id === 'magnet' && planted(t) || !chainProof(t)) && !mirrorOn(t) && (id === 'magnet' || road.straight > 60) && `target ${Math.round(g)}m`;
    }
    case 'domain': { const n = near(35).filter(c => !c.mods?.invulnerable && !mirrorOn(c)).length; return n > 0 && !near(DOMAIN_R).some(mirrorOn) && `${n} in range`; }
    case 'oil': {   // a car 5-30 m behind, about in line (the slick lands 4 m behind, 3 m wide)
      const s = race.track.samples[car.trackIndex];
      return rivals.some(c => -gap(c) > 5 && -gap(c) < 30 && !mirrorOn(c) && Math.abs((c.pos.x - car.pos.x) * s.right.x + (c.pos.z - car.pos.z) * s.right.z) < 3.5) && 'behind';
    }
    case 'shield': return incoming(race, car, rivals) || (near(6).length > 0 && 'close');
    // like the shield, plus pulls, fields and slicks on their way, or a crowd to bounce rams off
    case 'reflect': {
      const why = incoming(race, car, rivals);
      if (why) return why;
      if (rivals.some(c => c.ability?.id === 'magnet' && c.ability.active > 0 && c.ability.target === car)) return 'pulled';
      if ((race.hazards || []).some(h => h.kind === 'timeslow' && h.owner !== car && !h.bounced?.has(car))) return 'timeslow';
      if (rivals.some(c => armed(c, 'magnet') && magnetTarget(race, c) === car)) return 'magnet armed';
      if (rivals.some(c => armed(c, 'timeslow') && gap(c) < 0 && gap(c) > -60)) return 'timeslow armed';
      if (rivals.some(c => (armed(c, 'oil') || armed(c, 'facewall')) && gap(c) > 3 && gap(c) < 30)) return 'trap armed';
      return near(15).length >= 2 && 'crowd';
    }
    case 'timeslow': return rivals.some(c => gap(c) > 0 && gap(c) < 60) && !rivals.some(mirrorOn) && 'ahead';
    case 'phase': return (road.straight > 120 || rivals.some(c => gap(c) > 0 && gap(c) < 20)) && 'through';
    case 'robotdash': return near(10).length > 0 && 'close';
    case 'facewall': return faceWanted(race, car) && 'behind';
    // lands pow m on at the same speed: only with 45 m of straight and of braking room left after the jump (less landed it
    // in a braking zone too fast, or off the line at the turn-in)
    case 'warp': return Math.min(road.straight, road.room) > ABILITIES.warp.power * (car.stats?.abilityPower || 1) + 45 && 'straight';
    // a long straight to draft down (road.straight tops out at 250), or a chaser up to 40 m back, behind where the rear
    // ally lands (famStep rAlong, + 3 m: it blocks only cars behind its centre)
    case 'family': {
      const back = FAM.rear + Math.max(0, car.speed) * FAM.rearV + (car.ability.fam?.allies?.[1]?.hl || 2.1) + 3;
      return (road.straight >= 250 && 'straight') || (rivals.some(c => gap(c) < -back && gap(c) > -40) && 'chaser');
    }
    default: return road.straight > 80 && 'straight';   // anything new
  }
}

// game.js, after car-car collisions (every physics substep): this client's own cars just behind a live wall and inside
// the shown faces' edges are held FACE.min m behind the row, no faster than the row − FACE.slower, with a bounce on
// contact. Cars ahead of the owner and shielded / phased / robot cars are free; a warp jumps past.
export function faceWall(race) {
  const tr = race.track;
  for (const hz of race.hazards || []) {
    if (hz.kind !== 'facewall' || !hz.on || !tr?.nearest || faceStale(hz.owner)) continue;
    const o = hz.owner, on = tr.nearest(o.pos, o.trackIndex), [fx, fz] = faceFwd(tr, on), curv = tr.samples[on.index].curv;
    const lo = faceEdge(on.lateral, hz.pairs, hz.lim, -1), hi = faceEdge(on.lateral, hz.pairs, hz.lim, 1);
    for (const c of race.cars) {
      // (a planted downforce car is invulnerable too, but no car drives through the wall: it is held like any other)
      if (c === o || c.control === 'net' || c.finished || c._?.left || (c.mods?.invulnerable && !planted(c)) || c.mods?.noCollide) continue;
      const n = tr.nearest(c.pos, c.trackIndex), min = FACE.min + halfLen(c) - 2.1;   // a longer car: held by its own nose
      if (n.lateral < lo || n.lateral > hi) continue;
      // the faces stand on a straight line across the road through the owner: measure (and push) square to that line,
      // not along the centreline, which in a corner is far shorter on the inside than on the outside
      const behind = (((on.t - n.t) % 1 + 1.5) % 1 - 0.5) * tr.length;   // m behind the owner along the track
      const gap = (o.pos.x - c.pos.x) * fx + (o.pos.z - c.pos.z) * fz;
      if (behind < 0 || behind > 15 || gap < 0 || gap >= min) continue;
      if (hz.bounced?.has(c)) continue;   // reflected once: this wall leaves it alone from then on
      if (mirrorOn(c)) { (hz.bounced ||= new Set()).add(c); reflects(race, c, o, 'facewall'); continue; }   // drives through; the owner is held back
      const push = Math.min(min - gap, FACE.push);
      c.pos.x -= fx * push; c.pos.z -= fz * push;
      // the row turns with the owner: at the car's offset from it, it moves at speed × (1 + curv × offset)
      const cap = Math.max(0, (o.speed || 0) * Math.max(0.3, 1 + curv * (n.lateral - on.lateral)) - FACE.slower);
      const vt = c.vel.x * fx + c.vel.z * fz;
      if (vt <= cap) continue;
      const S = st(race), a = c.ability || initAbility(race, c), hit = S.time - (a.faceAt ?? -9) > FACE.again;
      const dv = vt - cap + (hit ? FACE.bounce : 0);
      c.vel.x -= fx * dv; c.vel.z -= fz * dv;
      if (!hit) continue;
      if (isHuman(c) && S.time - (a.faceAt ?? -9) > 1.5) flash(race, who(race, c) + '顔にブロックされた!', COLOR.facewall);
      a.faceAt = S.time;
      burst(S.glow, _w.set(c.pos.x + fx * 2, c.pos.y + 1, c.pos.z + fz * 2), 18, PAL.facewall, 6, 0.35, 0.4, 0.05);
    }
  }
}

// shared by local activation and remote messages; car may be null (unknown remote pid).
// target: thunderbolt victim / magnet target or null
function start(race, car, id, dur, pow, pose, target = null) {
  const S = st(race), at = new THREE.Vector3(pose.x, pose.y, pose.z);
  if (id === 'tokyodive') { diveStart(race, S, car, dur, pow, pose); return; }
  if (id === 'family') { famStart(race, S, car, dur, pow, pose); return; }
  if (id === 'warp') {
    const d = warpDest(race, pose, pow);
    if (car && car.control !== 'net') {   // remote cars arrive via net state
      car.pos.copy(d.pos);
      car.heading = d.heading;
      car.vel?.set(Math.sin(d.heading), 0, Math.cos(d.heading)).multiplyScalar(car.speed);
      if (car.mesh) { car.mesh.position.copy(d.pos); car.mesh.rotation.y = d.heading; }
    }
    warpFx(S, at, d.pos, pose.h, d.heading);
    return;
  }
  if (id === 'domain') spawnDomain(race, S, car, at, dur, pow);
  if (id === 'facewall' && car) spawnFaceWall(race, S, car, dur);
  if (id === 'oil') spawnOil(race, S, pose, dur, pow, car);
  else if (id === 'timeslow') {
    race.hazards.push({ kind: 'timeslow', owner: car, power: pow, left: dur, update(dt) { return (this.left -= dt) > 0; }, dispose() {} });
    const g = _w.copy(at).setY(at.y + 0.15);
    ring(S, g, COLOR.timeslow, { r0: 2, r1: 60, life: 1.1, opacity: 0.8 });
    ring(S, g, '#f0dcff', { r0: 1, r1: 28, life: 0.7, opacity: 0.5 });
  } else if (car) {
    const a = car.ability;
    a.active = a.activeMax = dur;
    a.power = pow;
    a.t = 0;
    a.target = id === 'magnet' || id === 'hellchain' ? target : null;
    a.chained = false;
    a.dfTurn = a.dfSling = 0;
    if (id === 'hellchain' && target && target !== car) {   // chain for dur, then the slingshot; a.power = the chain's until the snap
      a.chained = true;
      a.hookFx = a.hookFlash = false;
      a.chainDur = dur;
      a.active = a.activeMax = dur + HELL_SLING.dur;
      a.side = (car.pos.x - target.pos.x) * -Math.cos(target.heading) + (car.pos.z - target.pos.z) * Math.sin(target.heading) < 0 ? -1 : 1;
    }
    if (id === 'robotdash') {   // robot for dur (transform in included), change back, then the dash
      a.robotDur = dur;
      a.active = a.activeMax = dur + ROBOT_T + ROBOT_BOOST;
      if (car.control !== 'net') car.spin = 0;   // shakes off a spin in progress
    }
  }
  if (id === 'thunderbolt') strike(race, S, target, pow, car);
  const c = PAL[id];
  if (id !== 'oil') burst(S.glow, _w.copy(at).setY(at.y + 0.8), 36, c, 7, 0.5, 0.5, 0.05, 0, 2.5);
  if (id !== 'timeslow') ring(S, _w.copy(at).setY(at.y + 0.15), COLOR[id], { r0: 1.5, r1: 6, life: 0.4, opacity: 0.8 });
}

// ---------- tokyodive ----------
// A gate opens ahead, the car drives in (DIVE.lead s) and is away: a local driver races the pocket course
// (tokyo-dimension.js, car._.track), a CPU is parked out of the world. It comes back along the track, from where it went
// in, by top speed x DIVE.base x the ability's own 6 s (pays for the time away; reaching the exit early keeps all of it,
// so a quick pocket run is the skill bonus) + power x the farthest it got in there x DIVE.inside. Back on the road it
// comes out at full speed (the corners ahead still cap it, landSpeed) into a 'ネオン・ブースト': speed / accel + boost
// (x power, at most 1) for boostT s (x node a2), the first guard s of it immune like a shield (diveGuard). Net ~+4.2 s
// over just driving on, ~+5.3 s with every node (CONTRACT.md). Power and node a2 touch only the pocket part and the boost. A CPU
// drives it like a clean run: DIVE.cpuIn m/s, back at the exit (RUN). A remote diver is only hidden here: its own client
// runs the dive and sends { out: 1 } with where it came back (every client then shows the boost and the guard).
// cpuIn is per real second (the pocket's clock runs 1.25x): 54 = ~302 m in 5.6 s, a clean pocket run
const DIVE = { lead: 0.3, minSpeed: 15, base: 0.8, inside: 0.8, cpuIn: 54, remoteSlack: 1.5, near: 25, boost: 0.4, boostT: 2, guard: 1.5 };
const DIVE_T = ABILITIES.tokyodive.duration;
const diveGain = (car, d, t, inside) => Math.min(t, DIVE_T) * (car.stats?.top || 60) * DIVE.base + d.pow * inside * DIVE.inside;
// the finish counts where it lands: a flag closer than a clean dive's time away (at this race's pace) comes sooner by driving
const diveLate = (race, car) => car.progress > 0.2 && (race.track?.laps - car.progress) * race.time / car.progress < DIVE.lead + RUN / DIVE.cpuIn;
const DIVE_SCREEN = ['radial-gradient(ellipse at center, rgba(255,255,255,0.95), rgba(255,140,40,0.75) 40%, rgba(255,40,160,0.7) 75%, rgba(25,10,40,0.9) 100%)',
  [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], 520];

function diveGate(S, p, h, life, out = false) {
  const g = makePortal(3.1);
  g.position.set(p.x, p.y + 1.7, p.z);
  g.rotation.y = h;
  addFx(S, g, life, (o, k) => {
    const tt = k * life, close = clamp((tt - (life - 0.3)) / 0.3, 0, 1);
    o.scale.setScalar(Math.max(0.01, (out ? 1 + 0.2 * k : easeOutBack(Math.min(1, tt / 0.18))) * (1 - close)));
    o.userData.spin(S.time);
    o.userData.fade(1 - close * 0.6);
  });
  const c = _w.set(p.x, p.y + 1.7, p.z);
  burst(S.glow, c, out ? 70 : 40, PAL.tokyodive, out ? 12 : 7, 0.55, 0.55, 0.05, 0, 2);
  ring(S, _w.set(p.x, p.y + 0.15, p.z), COLOR.tokyodive, { r0: 1, r1: out ? 9 : 6, life: 0.5, opacity: 0.8 });
}

function place(car, pos, h) {
  car.pos.copy(pos);
  car.heading = h;
  // a new heading along the road: the old yaw rate / drift (the garage helix, a corner here) must not carry over
  if (car._) { car._.yaw = 0; car._.drift = false; }
  car.vel?.set(Math.sin(h), 0, Math.cos(h)).multiplyScalar(car.speed);
  if (car.mesh) { car.mesh.position.copy(pos); car.mesh.rotation.y = h; }
}

function diveStart(race, S, car, dur, pow, pose) {
  const spd = Math.max(0, car?.speed || 0), g = warpDest(race, pose, Math.max(5, spd * DIVE.lead + 1.5));   // along the track: through a corner too
  diveGate(S, g.pos, g.heading, DIVE.lead + 0.45);
  if (!car) return;
  const a = car.ability, remote = car.control === 'net';
  a.active = a.activeMax = DIVE.lead + dur + (remote ? DIVE.remoteSlack : 1);   // a local dive ends itself before this
  a.power = pow;
  a.t = 0;
  a.landed = false;
  a.dive = { t: 0, phase: 'gate', dur, pow, speed0: spd, human: isHuman(car), remote };
}

// back on the road: the ネオン・ブースト (applyOwn) runs on as the ability's active time, longer with node a2 (d.dur);
// the guard counts from here (a.t)
function diveLand(a, d) {
  a.landed = true;
  a.t = 0;
  a.active = a.activeMax = DIVE.boostT * (d?.dur || DIVE_T) / DIVE_T;
}

function diveStep(race, S, car, dt) {
  const a = car.ability, d = a.dive;
  d.t += dt;
  if (d.phase === 'gate') {
    if (d.t < DIVE.lead) return;
    if (!d.remote && car.finished) {   // crossed the finish line on the way to the gate: the race is over, no dive
      a.dive = null;
      a.active = 0;
      sendOut(race, car, car.pos, car.heading);   // peers hid it at their gate
      return;
    }
    diveIn(race, S, car);
    return;
  }
  if (d.remote) {
    if (d.out && (car.pos.distanceTo(d.out) < DIVE.near || d.t - d.outAt > 1)) diveBack(race, S, car);
    return;
  }
  d.inT += dt;
  if (d.D) {
    const D = d.D, tr = D.track, n = tr.nearest(car.pos, car.trackIndex), s = n.t * tr.length;
    if (s < D.backS) {   // the wall behind the entry gate
      const q = tr.samples[n.index], vf = car.vel.dot(q.tan);
      car.pos.addScaledVector(q.tan, D.backS - s);
      if (vf < 0) car.vel.addScaledVector(q.tan, -vf);
    }
    d.maxS = Math.max(d.maxS, s);
    diveHud(race, S, car, `異空間ダイブ　残り ${Math.max(0, d.dur - d.inT).toFixed(1)}秒　+${Math.round(diveGain(car, d, d.inT, d.maxS - d.s0))}m`);
    if (s >= D.exitS) { diveOut(race, S, car); return; }
  }
  if (d.inT >= (d.D ? d.dur : Math.min(d.dur, RUN / DIVE.cpuIn))) diveOut(race, S, car);
}

function diveIn(race, S, car) {
  const a = car.ability, d = a.dive;
  d.phase = 'in';
  d.inT = 0;
  a.away = true;
  burst(S.glow, _w.set(car.pos.x, car.pos.y + 0.9, car.pos.z), 60, PAL.tokyodive, 10, 0.5, 0.6, 0.05, 0, 2);
  if (d.remote) { car.mesh.visible = false; car._.away = true; return; }
  d.entry = { x: car.pos.x, y: car.pos.y, z: car.pos.z, h: car.heading, i: car.trackIndex };
  car._.away = true;
  let D = null;
  if (d.human) try { D = getDimension(race); } catch (e) { console.warn('[tokyodive]', e); }
  if (D) {
    d.D = D;
    car._.track = D.track;
    car.speed = Math.max(car.speed, DIVE.minSpeed);
    place(car, D.start.pos, D.start.heading);
    car.trackIndex = D.start.index;
    d.s0 = d.maxS = D.start.s;
    screenFlash(race, car, DIVE_SCREEN);
    burst(S.glow, _w.copy(D.start.pos).setY(D.start.pos.y + 1.2), 80, PAL.tokyodive, 12, 0.6, 0.6, 0.05, 0, 2);
  } else {   // CPU: parked out of the world, where nothing can meet it
    car.mesh.visible = false;
    car.pos.set(-ORIGIN.x - car.index * 60, -500, -ORIGIN.z);
    car.mesh.position.copy(car.pos);
  }
}

function diveOut(race, S, car) {
  const a = car.ability, d = a.dive, tr = race.track, L = tr?.length || 1;
  const e = d.entry || { x: car.pos.x, y: car.pos.y, z: car.pos.z, h: car.heading, i: car.trackIndex };
  const inside = d.D ? d.maxS - d.s0 : Math.min(DIVE.cpuIn * d.inT, RUN);
  const dist = clamp(diveGain(car, d, DIVE_T, inside) || 0, 0, L * 0.9);   // reaching the exit early still earns the full base
  const dest = warpDest(race, e, dist);
  // a difficulty CPU (game.js racing line) lands on its line, heading along it: at the offset it went in with it landed
  // off the line, often mid-corner, and the line-speed corner ran it into the wall (~3x the wall hits right after)
  const line = car.control === 'cpu' && dest.i != null && tr.line, s = line && tr.samples[dest.i];
  if (s) {
    dest.pos.addScaledVector(s.right, line.off[dest.i] - _v.copy(dest.pos).sub(s.pos).dot(s.right));
    dest.heading += wrap(line.head[dest.i] - dest.heading);
  }
  // out of the gate at full speed (a pocket run ends slow, out of the garage helix), no faster than the corners ahead allow
  car.speed = Math.max(d.D ? car.speed : d.speed0, (car.stats?.top || 0) * (car._?.skill || 1));
  if (tr?.samples && dest.i != null) car.speed = landSpeed(tr, car, dest.i, car.speed);
  car._.track = null;
  car._.away = false;
  a.away = false;
  a.dive = null;
  diveLand(a, d);
  place(car, dest.pos, dest.heading);
  car.mesh.visible = true;
  if (tr?.nearest) car.trackIndex = tr.nearest(dest.pos, dest.i).index;
  car._.jump = dist / L;
  diveGate(S, dest.pos, dest.heading, 0.7, true);
  if (d.D) {
    diveHud(race, S, car, null);
    screenFlash(race, car, DIVE_SCREEN);
    flash(race, `${who(race, car)}+${Math.round(dist)}m! ネオン・ブースト!`, COLOR.tokyodive);
  }
  sendOut(race, car, dest.pos, dest.heading);
}

// back on the track no faster than the corners just ahead allow (game.js aiInput's limit): a landing in a hairpin at
// the speed it went in with (a CPU) or left the pocket at went straight into the wall. Landing inside the corner, the
// car starts from zero yaw: 80 % of the limit there, or it runs wide while the steering builds up
function landSpeed(tr, car, i, v) {
  const S = tr.samples, N = S.length, lat = (car.stats?.grip || 0.85) * (tr.grip || 1) * 36 * 1.3;
  for (let k = 0, d = 0; d < 150; k += 2, d = k * tr.spacing) {
    v = Math.min(v, Math.sqrt(lat * (d < 15 ? 0.64 : 1) / (Math.abs(S[(i + k) % N].curv || 0) + 1e-4) + 36 * d));
  }
  return v;
}

function sendOut(race, car, p, h) {   // online: where the diver is back on the track
  if (race.net && car.control === 'p1') race.net.send({ t: 'ability', pid: race.localPid, id: 'tokyodive', out: 1, x: r2(p.x), y: r2(p.y), z: r2(p.z), h: r2(h) });
}

function diveBack(race, S, car) {   // a remote diver reappears
  const a = car.ability, d = a.dive;
  a.away = false;
  a.dive = null;
  diveLand(a, d);   // its boost / guard as seen here: chains, bolts and reflects treat it as its own client does
  if (car._) car._.away = false;
  if (!car._?.left) car.mesh.visible = true;
  diveGate(S, car.pos, car.heading, 0.7, true);
}

// countdown + distance banner and a neon vignette on the diver's own viewport
function diveHud(race, S, car, text) {
  const key = car.control + 'dive';
  let el = S.tint[key];
  if (text == null) { el?.remove(); delete S.tint[key]; return; }
  if (!el) {
    const layer = typeof document !== 'undefined' && race.hud?.layer?.(car);
    if (!layer) return;
    el = S.tint[key] = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 58%, rgba(255,47,158,0.16) 82%, rgba(40,8,60,0.5) 100%)' });
    const t = document.createElement('div');
    Object.assign(t.style, {
      position: 'absolute', left: '50%', bottom: '112px', transform: 'translateX(-50%)', font: '800 17px system-ui,sans-serif', color: '#ffe0b8',
      letterSpacing: '0.06em', textShadow: '0 0 10px #ff6a1f, 0 2px 6px rgba(0,0,0,.7)', whiteSpace: 'nowrap',
    });
    el.appendChild(t);
    layer.appendChild(el);
  }
  if (el.firstChild.textContent !== text) el.firstChild.textContent = text;
}

// ---------- family ----------
// Two ally cars (a player's: its two best other cars from the garage; a CPU's: random; a remote owner's: the ones its
// ability message names) drive in from behind with a flash of headlights and ride along for dur s. They are placed from
// the owner's own spot on the track alone (same place on every screen, nothing about them goes over the net per frame):
// the lead FAM.lead m ahead, between the owner's lane and the racing line (FAM.follow = share of the owner's lane); the
// rear one with its nose FAM.rear + speed x rearV m behind the owner (behind the chase camera, which lags ~speed / 12 m
// behind its 7.4-9.6 m), sidestepping at FAM.dodge m/s to cover
// the closest car behind it. Tucked in behind the lead (≤ cone m sideways, nothing past coneOut) the owner gets speedMul
// += top x power, accelMul += acc x power and gripMul += grip (it takes the lead's line; game.js aiInput's corner limit
// honours gripMul). The rear one is solid for this client's own cars coming at it from behind (famBlock, from game.js
// collide): pushed back, bounced, speed x keep at most once per `again` s. After dur they peel off to the sides and
// vanish, and the owner gets a parting boost (partPow for part s). Net ~+3.5 s per use at stock (circuit / suzuka /
// monza, CONTRACT.md). Not race cars: not in the standings or on the map, nothing targets them. Gone at once when the
// owner finishes, dives, leaves or is reset onto the road.
const FAM = { lead: 12, rear: 12.5, rearV: 0.085, follow: 0.7, enter: 0.9, out: 0.9, part: 2, partPow: 0.5, top: 0.55, acc: 2, grip: 1.8, cone: 2.4, coneOut: 4,
  side: 3.8, cover: 60, dodge: 6, keep: 0.75, bounce: 3, again: 0.7, r: 1 };
COLOR.family = '#3d8bff';
PAL.family = pal('#ffffff', '#cfe6ff', '#6fb0ff', '#2f6bff', '#8fe0ff');
const HEX = /^#[0-9a-f]{6}$/i, RANK = { N: 0, R: 1, SR: 2, UR: 3 };
const famLook = (l, id) => ({ body: HEX.test(l?.body) ? l.body : CAR_BY_ID[id].color, wheel: HEX.test(l?.wheel) ? l.wheel : '#222222', wing: !!l?.wing });
const _fs = { s: 0, lat: 0 }, _fp = { x: 0, y: 0, z: 0, ty: 0, h: 0 }, _fa = new THREE.Vector3();

function famTagTex() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'italic 900 42px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = '#0a2a6e'; g.strokeText('FAMILY', 128, 34);
  g.shadowColor = '#3d8bff'; g.shadowBlur = 10; g.fillStyle = '#eaf4ff';
  g.fillText('FAMILY', 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// arc length (m) and lateral of p near sample i0 (track.nearest over i0 ± 3, without allocating)
function trackS(tr, p, i0) {
  const S = tr.samples, N = tr.N;
  let best = 0, bd = Infinity;
  for (let k = -3; k <= 3; k++) {
    const i = ((((i0 | 0) + k) % N) + N) % N, q = S[i].pos, d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const s = S[best], dx = p.x - s.pos.x, dz = p.z - s.pos.z;
  _fs.s = best * tr.spacing + dx * s.tan.x + dz * s.tan.z;
  _fs.lat = dx * s.right.x + dz * s.right.z;
  return _fs;
}
// the point at arc length s, lat m right of the centre line, with the slope (ty) and heading (h) of the track there
function trackPt(tr, s, lat) {
  const S = tr.samples, N = tr.N, u = ((s / tr.spacing) % N + N) % N, i = u | 0, f = u - i, a = S[i], b = S[(i + 1) % N];
  _fp.x = a.pos.x + (b.pos.x - a.pos.x) * f + (a.right.x + (b.right.x - a.right.x) * f) * lat;
  _fp.y = a.pos.y + (b.pos.y - a.pos.y) * f;
  _fp.z = a.pos.z + (b.pos.z - a.pos.z) * f + (a.right.z + (b.right.z - a.right.z) * f) * lat;
  _fp.ty = a.tan.y + (b.tan.y - a.tan.y) * f;
  _fp.h = Math.atan2(a.tan.x + (b.tan.x - a.tan.x) * f, a.tan.z + (b.tan.z - a.tan.z) * f);
  return _fp;
}
function famLine(tr, s) {   // racing line offset at s (game.js builds track.famLine when no difficulty line exists)
  const L = tr.line || tr.famLine;
  if (!L) return 0;
  const N = tr.N, u = ((s / tr.spacing) % N + N) % N, i = u | 0;
  return L.off[i] + (L.off[(i + 1) % N] - L.off[i]) * (u - i);
}
const famGap = (tr, a, b) => ((a - b) % tr.length + tr.length * 1.5) % tr.length - tr.length / 2;   // m s=b is behind s=a

// a player's allies: its two best other cars (rarity, then skills + limit break), topped up at random
function famPick(car) {
  let list = [];
  if (isHuman(car)) try {
    const cars = getSave().cars || {}, rank = id => RANK[CAR_BY_ID[id].rarity] * 100 + (cars[id].nodes?.length || 0) + (cars[id].dupes > 0 ? 1 : 0);
    list = Object.keys(cars).filter(id => Object.hasOwn(CAR_BY_ID, id) && id !== car.carId).sort((x, y) => rank(y) - rank(x))
      .slice(0, 2).map(id => ({ id, look: famLook(cars[id].look, id) }));
  } catch (e) { console.warn('[family]', e); }
  const pool = CARS.filter(c => c.id !== car.carId && !list.some(e => e.id === c.id));
  while (list.length < 2 && pool.length) { const d = pool.splice((Math.random() * pool.length) | 0, 1)[0]; list.push({ id: d.id, look: famLook(null, d.id) }); }
  return list;
}
// a remote owner's allies, from its message (untrusted: known car ids and #rrggbb colours only); built once per race
function famRemote(race, car, fam) {
  if (car.ability.fam) return;
  const list = (Array.isArray(fam) ? fam : []).slice(0, 2).filter(x => Array.isArray(x) && Object.hasOwn(CAR_BY_ID, String(x[0])))
    .map(x => ({ id: String(x[0]), look: famLook({ body: x[1], wheel: x[2], wing: x[3] }, String(x[0])) }));
  famBuild(race, car, list.length === 2 ? list : famPick(car));
}

// the allies' meshes, hidden in the scene (stopRace disposes them), their textures uploaded now, not on their first show
// (built while loading, or for a remote owner at 'go', famAnnounce)
function famBuild(race, car, list) {
  const a = car.ability, S = st(race), f = a.fam = { list, allies: [], rl: 0 };
  const p = Promise.all(list.map((e, i) => buildCarMesh(e.id, e.look).then(m => {
    if (a.gone || a.fam !== f || !race.scene) return;
    (f.allies[i] = famAlly(race, S, m, e.id)).g.traverse(o => [].concat(o.material || []).forEach(mt => {
      for (const k in mt) if (mt[k]?.isTexture && k !== 'envMap') race.renderer?.initTexture(mt[k]);
    }));
  }))).catch(e => console.warn('[family]', e));
  (race.loads ||= []).push(p);
}
const famMsg = f => f.list.map(e => [e.id, e.look.body, e.look.wheel, e.look.wing ? 1 : 0]);
// online, at the host's 'go' (every screen has loaded): this player's allies, so the others build them during the
// countdown instead of on its first use mid-race (lost: its ability message still names them)
export function famAnnounce(race) {
  const f = race.cars.find(c => c.control === 'p1')?.ability?.fam;
  if (race.net && f) race.net.send({ t: 'ability', pid: race.localPid, id: 'family', pre: 1, fam: famMsg(f) });
}

function famAlly(race, S, m, id) {
  const g = new THREE.Group(), box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), hl = (CAR_BY_ID[id]?.len || 4.2) / 2;
  g.rotation.order = 'YXZ';
  S.famMat ||= {
    under: new THREE.MeshBasicMaterial({ map: tex(S, 'under'), color: COLOR.family, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    tag: new THREE.SpriteMaterial({ map: tex(S, 'famTag'), transparent: true, opacity: 0.9, depthWrite: false }),
  };
  S.geo.lamp ||= new THREE.PlaneGeometry(0.75, 0.42);
  const under = new THREE.Mesh(S.geo.plane, S.famMat.under), tag = new THREE.Sprite(S.famMat.tag);
  under.scale.set(size.x * 0.85, 1, size.z * 0.6);
  under.position.y = 0.06;
  under.renderOrder = 2;
  tag.scale.set(3.2, 0.8, 1);
  tag.position.y = box.max.y + 0.75;
  const lampMat = new THREE.MeshBasicMaterial({ map: tex(S, 'under'), color: '#eef6ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  g.add(m, under, tag);
  for (const sx of [1, -1]) {   // headlights
    const l = new THREE.Mesh(S.geo.lamp, lampMat);
    l.position.set(sx * size.x * 0.3, box.min.y + size.y * 0.42, box.max.z + 0.05);
    l.renderOrder = 3;
    g.add(l);
  }
  g.visible = false;
  race.scene.add(g);
  return { g, m, lampMat, hl, off: hl - FAM.r, x: 0, y: 0, z: 0, h: 0, lat: 0, along: 0, placed: false, solid: false };
}

function famStart(race, S, car, dur, pow, pose) {
  burst(S.glow, _w.set(pose.x, pose.y + 0.8, pose.z), 36, PAL.family, 7, 0.5, 0.5, 0.05, 0, 2.5);
  ring(S, _w.set(pose.x, pose.y + 0.15, pose.z), COLOR.family, { r0: 1.5, r1: 7, life: 0.45, opacity: 0.8 });
  const a = car?.ability, tr = race.track;
  if (!a?.fam || !tr?.samples) return;
  const lat = trackS(tr, pose, pose.i ?? car.trackIndex).lat;
  a.active = a.activeMax = dur + FAM.part;
  a.power = pow;
  a.t = 0;
  a.famDur = dur;
  a.famK = 0;
  a.famOff = a.famSaid = false;
  a.famRes = car._?.resets || 0;
  a.famSide = lat > 0 ? -1 : 1;   // the lead comes by on the roomier side, the rear one on the other
  a.fam.rl = lat;
}

function famPlace(S, al, tr, s, along, lat, sc, dt, v, lamp) {
  if (!al) return;
  const p = trackPt(tr, s + along, lat), dx = p.x - al.x, dz = p.z - al.z;
  let h = p.h;
  if (al.placed && dx * dx + dz * dz > 1e-4) { h = Math.atan2(dx, dz); if (Math.cos(h - p.h) < 0) h = p.h; }   // along its own path: a lane change turns it
  al.h = al.placed ? al.h + wrap(h - al.h) * Math.min(1, dt * 12) : h;
  al.va = al.placed && dt > 0 ? (along - al.along) / dt : 0;   // m/s it moves on its owner (driving in / peeling back): famBlock
  al.placed = true; al.x = p.x; al.y = p.y; al.z = p.z; al.lat = lat; al.along = along;
  al.g.visible = true;
  al.g.position.set(p.x, p.y, p.z);
  al.g.rotation.set(-Math.asin(clamp(p.ty, -1, 1)), al.h, 0);
  al.g.scale.setScalar(Math.max(0.01, sc));
  al.lampMat.opacity = lamp;
  for (const wh of al.m.userData.wheels || []) wh.rotation.x += v * dt / (wh.userData.r || 0.35);
  al.m.userData.anim?.(S.time, v);
}

function famHide(S, a) {
  if (!a.famShown) return;
  a.famShown = false;
  for (const al of a.fam?.allies || []) {
    if (!al) continue;
    if (al.g.visible) {   // gone in a blue puff
      const p = _w.set(al.x, al.y + 0.8, al.z);
      burst(S.glow, p, 30, PAL.family, 6, 0.55, 0.6, 0.05, 0, 2);
      burst(S.smoke, p, 8, PAL.smoke, 2, 0.6, 0.6, 1.6, -0.3, 1.5, 0.25);
    }
    al.g.visible = al.placed = al.solid = false;
  }
}

function famEnd(race, S, car, send) {
  const a = car.ability;
  a.famOff = true;
  a.active = a.famK = 0;
  famHide(S, a);
  if (send && race.net && car.control === 'p1') race.net.send({ t: 'ability', pid: race.localPid, id: 'family', end: 1 });
}

function famStep(race, S, car, dt) {
  const a = car.ability, f = a.fam, tr = race.track;
  if (a.active > 0 && !a.famOff && (car.finished || car._?.left || away(car) || (car._?.resets || 0) !== a.famRes)) famEnd(race, S, car, true);
  const t = a.t, dur = a.famDur;
  a.famK = 0;
  if (!(a.active > 0) || a.famOff || !(t < dur + FAM.out) || !tr?.samples) { famHide(S, a); return; }
  a.famShown = true;
  const lim = tr.width / 2 - 1.6, wall = (tr.wall ?? tr.width / 2 + 9.4) - 1.5, side = a.famSide, v = Math.max(0, car.speed || 0);
  const q = trackS(tr, _fa.copy(car.pos).addScaledVector(car.vel, dt), car.trackIndex), s0 = q.s, ol = q.lat;   // drawn after this frame's physics
  const k = Math.min(1, t / FAM.enter), e = easeOut(k), w = smooth01((k - 0.45) / 0.55);
  const u = clamp((t - dur) / FAM.out, 0, 1), peel = smooth01(u), sc = 1 - smooth01((u - 0.6) / 0.4);
  const lamp = t > 0.55 && t < 1.25 && (t - 0.55) % 0.35 < 0.17 ? 1 : 0.35;   // two flashes of the headlights on the way in
  // rear: toward the closest car behind it (as this screen shows them)
  const rear = f.allies[1], rAlong = -(FAM.rear + v * FAM.rearV + (rear?.hl || 2.1));   // behind the lagging chase camera
  let tgt = ol, best = FAM.cover;
  for (const c of race.cars) {
    if (c === car || c.finished || c._?.left || away(c)) continue;
    const r = trackS(tr, c.pos, c.trackIndex), g = famGap(tr, s0, r.s);
    if (g > -rAlong - 1 && g < best) { best = g; tgt = r.lat; }
  }
  f.rl += clamp(clamp(tgt, -lim, lim) - f.rl, -FAM.dodge * dt, FAM.dodge * dt);
  const along = -26 + (FAM.lead + 26) * e + 16 * u * u;
  const line = famLine(tr, s0 + along), steady = clamp(line + (ol - line) * FAM.follow, -lim, lim);
  const ll = clamp(clamp(ol + side * FAM.side, -lim, lim) + (steady - clamp(ol + side * FAM.side, -lim, lim)) * w + side * 4.5 * peel, -wall, wall);
  famPlace(S, f.allies[0], tr, s0, along, ll, sc, dt, v, lamp);
  const rl = clamp(clamp(ol - side * FAM.side, -lim, lim) + (f.rl - clamp(ol - side * FAM.side, -lim, lim)) * w - side * 4.5 * peel, -wall, wall);
  famPlace(S, rear, tr, s0, -36 + (36 + rAlong) * e - 8 * u * u, rl, sc, dt, v, lamp);
  if (rear) rear.solid = k >= 0.5 && u < 0.3;   // solid once it has come up level (cars behind it only: famBlock)
  if (f.allies[0] && along > 3 && v > 8) a.famK = smooth01((FAM.coneOut - Math.abs(ol - ll)) / (FAM.coneOut - FAM.cone)) * (1 - peel);
  if (a.famK > 0.3 && isHuman(car)) {   // the air rushing past, tucked in behind the lead
    const sh = Math.sin(car.heading), ch = Math.cos(car.heading);
    for (let n = Math.floor(45 * dt * a.famK + Math.random()); n > 0; n--) {
      const x = rnd(-1.4, 1.4), y = rnd(0.3, 1.7), fwd = rnd(1, 4);
      S.glow.emit(car.pos.x + sh * fwd - ch * x, car.pos.y + y, car.pos.z + ch * fwd + sh * x, car.vel.x * 0.5, 0, car.vel.z * 0.5, PAL.family[1], 0.3, 0.3, 0.06, 0, 0, 0.5);
    }
  }
  if (t >= dur && !a.famSaid) {
    a.famSaid = true;
    if (isHuman(car)) flash(race, who(race, car) + 'ファミリー・ブースト!', COLOR.family);
  }
}

// game.js collide(), every physics substep: the rear ally is solid for this client's own cars that come at it from
// behind (a remote car's own client does it for that car). Shielded / phased / reflecting / robot cars go through.
export function famBlock(race) {
  const tr = race.track;
  if (!tr?.samples) return;
  for (const o of race.cars) {
    const a = o.ability, al = a?.fam?.allies?.[1];
    if (!al?.solid || a.famOff || !(a.active > 0) || faceStale(o)) continue;   // a frozen remote owner: like collide() NET_STALE
    const p = trackPt(tr, trackS(tr, o.pos, o.trackIndex).s + al.along, al.lat), px = p.x, pz = p.z, fx = Math.sin(al.h), fz = Math.cos(al.h);
    for (const c of race.cars) {
      if (c === o || c.control === 'net' || c.finished || c._?.left || away(c) || c.mods?.noCollide || c.mods?.invulnerable || c.mods?.reflect) continue;
      const dx = c.pos.x - px, dz = c.pos.z - pz;
      if (dx * dx + dz * dz > 64 || dx * fx + dz * fz > 0) continue;   // not near, or level with it / past it
      // a car it is catching (one its owner just passed, or it drives in on) isn't coming at it: it drives through
      if ((c.vel.x - (o.vel?.x || 0)) * fx + (c.vel.z - (o.vel?.z || 0)) * fz <= (al.va || 0)) continue;
      const hc = c._.hit, cx = Math.sin(c.heading), cz = Math.cos(c.heading);
      let pen = 0, nx = 0, nz = 0;
      for (let sa = -1; sa <= 1; sa += 2) for (const ob of hc.off) {
        const ex = c.pos.x + cx * ob - px - fx * sa * al.off, ez = c.pos.z + cz * ob - pz - fz * sa * al.off, d = Math.hypot(ex, ez), pn = FAM.r + hc.r - d;
        if (pn > pen) { pen = pn; nx = d > 1e-4 ? ex / d : -fx; nz = d > 1e-4 ? ez / d : -fz; }
      }
      if (pen <= 0) continue;
      c.pos.x += nx * pen; c.pos.z += nz * pen;
      const vrel = (c.vel.x - (o.vel?.x || 0)) * nx + (c.vel.z - (o.vel?.z || 0)) * nz;   // the ally moves with its owner
      if (vrel >= 0) continue;
      const S = st(race), ca = c.ability || initAbility(race, c), hit = S.time - (ca.famAt ?? -9) > FAM.again, sp0 = Math.hypot(c.vel.x, c.vel.z);
      const j = -vrel * 1.3 + (hit ? FAM.bounce : 0);
      c.vel.x += nx * j; c.vel.z += nz * j;
      const cap = sp0 * (hit ? FAM.keep : 1), sp1 = Math.hypot(c.vel.x, c.vel.z);
      if (sp1 > cap) c.vel.multiplyScalar(cap / sp1);   // never a push forward
      if (!hit) continue;
      if (isHuman(c)) {
        if (S.time - (ca.famAt ?? -9) > 1.5) flash(race, who(race, c) + 'ファミリーにブロックされた!', COLOR.family);
        race.hud?.shake?.(c, 0.25);
      }
      ca.famAt = S.time;
      burst(S.glow, _w.set(c.pos.x - nx * hc.r, c.pos.y + 0.8, c.pos.z - nz * hc.r), 22, PAL.family, 6, 0.35, 0.45, 0.05);
    }
  }
}

// ---------- tint overlays for local players: slowed (timeslow) / caught in a domain / downforce speed lines ----------
// the element is 1.8x its viewport (inset -40%), so these stops are 50% / 95% of the visible half-size
const RAYS_MASK = 'radial-gradient(closest-side, transparent 28%, #000 53%)';
const TINTS = [   // [key, style, keyframes of an endless stepped animation]
  ['slowVis', { background: 'radial-gradient(ellipse at center, rgba(150,70,255,0.07) 35%, rgba(110,30,220,0.55) 100%)' }],
  ['domVis', { background: 'radial-gradient(ellipse at center, rgba(60,10,110,0.22) 25%, rgba(35,0,70,0.62) 70%, rgba(15,0,30,0.88) 100%)' }],
  // thin rays toward the edges; oversized so the jittering turn never shows a corner (the viewport clips it)
  ['dfVis', { inset: '-40%', background: 'repeating-conic-gradient(rgba(215,245,255,0) 0deg 2.4deg, rgba(215,245,255,0.55) 2.6deg 2.9deg, rgba(215,245,255,0) 3.1deg 5deg)', maskImage: RAYS_MASK, webkitMaskImage: RAYS_MASK },
    [{ transform: 'rotate(0deg)' }, { transform: 'rotate(15deg)' }]],
];
function updateTint(race, S) {
  if (typeof document === 'undefined') return;
  for (const car of race.cars) {
    if (!isHuman(car) || !car.ability) continue;
    for (const [key, style, spin] of TINTS) {
      const v = Math.round((car.ability[key] || 0) * 100) / 100;
      let el = S.tint[car.control + key];
      if (!el) {
        const layer = race.hud?.layer?.(car);   // this car's viewport, under its HUD
        if (!v || !layer) continue;
        el = S.tint[car.control + key] = document.createElement('div');
        Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', opacity: '0' }, style);
        if (spin) el.animate?.(spin, { duration: 400, iterations: Infinity, easing: 'steps(5)' });
        layer.appendChild(el);
      }
      if (el.__v !== v) { el.__v = v; el.style.opacity = String(v); }
    }
  }
}

// ---------- public API ----------
export function initAbility(race, car) {
  const id = ABILITIES[car.stats?.ability] ? car.stats.ability : (ABILITIES[car.def?.ability] ? car.def.ability : 'boost');
  car.ability = {
    id, name: ABILITIES[id].name, gauge: 0, active: 0, activeMax: 0, power: 0, t: 0,
    slow: 0, slowVis: 0, hit: 0, fx: null, phaseSwap: null, target: null, sealed: false, domVis: 0,
    dfVis: 0, robot: null, body: null, robotDur: 0, robotPh: 0, chained: false, chainFx: null, dive: null, away: false,
    bounceP: 0, bounceT: 0,   // a slow bounced back onto this car by a reflector: power, s left
  };
  car.spin ??= 0;
  if (id === 'robotdash') attachRobot(car);
  if (id === 'tokyodive' && isHuman(car) && race.scene) {   // build the pocket course now, while loading (not mid-race)
    try { getDimension(race); } catch (e) { console.warn('[tokyodive] build failed', e); }
  }
  // family: the allies' meshes now, while loading (game.js awaits race.loads); a remote owner's come with its message
  if (id === 'family' && car.control !== 'net' && race.scene) famBuild(race, car, famPick(car));
  return car.ability;
}

// car–car contact (game.js collide, after the usual response): a robot sends the other car flying sideways.
// Only this client's own cars: a remote victim's own client does it when its car meets the robot there.
// Shielded cars are immune; phase cars never touch.
// (Also the contact hook for reflect: a glint on the mirrors; a robot's knock on a reflecting car fizzles, the robot is immune.)
export function robotKnock(race, a, b) {
  for (const [r, v] of [[a, b], [b, a]]) {
    if (mirrorOn(v) && v.control !== 'net') {
      const S = st(race), va = v.ability;
      if (S.time - (va.glintAt ?? -9) > 0.4) {
        va.glintAt = S.time;
        va.hit = 1;
        glowBall(S, _w.set((r.pos.x + v.pos.x) / 2, v.pos.y + 1.2, (r.pos.z + v.pos.z) / 2), 1.6, 0.18, '#ffffff');
        if (isRobot(r)) reflects(race, v, r, 'robotdash');
      }
      continue;
    }
    if (!isRobot(r) || isRobot(v) || v.control === 'net' || v.mods?.invulnerable) continue;
    const va = v.ability || initAbility(race, v), S = st(race);
    if (S.time - (va.knockAt ?? -9) < KNOCK.again) continue;
    va.knockAt = S.time;
    const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);   // v's right
    let side = (v.pos.x - r.pos.x) * rx + (v.pos.z - r.pos.z) * rz;
    if (Math.abs(side) < 0.1) side = Math.random() - 0.5;
    const dx = rx * Math.sign(side), dz = rz * Math.sign(side);
    v.vel.multiplyScalar(KNOCK.keep);
    v.vel.x += dx * KNOCK.side; v.vel.z += dz * KNOCK.side;
    v.spin = Math.max(v.spin || 0, KNOCK.spin);
    const p = _w.set((r.pos.x + v.pos.x) / 2, (r.pos.y + v.pos.y) / 2 + 1, (r.pos.z + v.pos.z) / 2);
    glowBall(S, p, 2.2, 0.2, '#fff1c9');
    ring(S, p, COLOR.robotdash, { vertical: true, heading: Math.atan2(dx, dz), r0: 0.5, r1: 4, life: 0.35 });
    for (let i = 0; i < 40; i++) S.glow.emit(p.x, p.y, p.z, v.vel.x * 0.6 + rnd(-7, 7), rnd(0, 6), v.vel.z * 0.6 + rnd(-7, 7), pick(PAL.robotdash), rnd(0.25, 0.5), 0.45, 0.05, 10, 1.5);
    if (isHuman(v)) flash(race, who(race, v) + 'ふっとばされた!', COLOR.robotdash);
  }
}

export function updateAbilities(race, dt) {
  const S = st(race), running = race.state === 'running';
  S.time += dt;

  for (const car of race.cars) {
    const a = car.ability || initAbility(race, car);
    if (car.spin > 0) car.spin = Math.max(0, car.spin - dt);
    if (a.bounceT > 0) a.bounceT = Math.max(0, a.bounceT - dt);   // a reflected slow
    if (a.active > 0) {
      a.t += dt;
      if (a.dive) diveStep(race, S, car, dt);   // may end it (came back)
      if (a.fam) famStep(race, S, car, dt);     // may end it (owner reset / finished)
      if (a.active > 0) {
        applyOwn(race, car, a, dt);
        a.active = Math.max(0, a.active - dt);
        if (!a.active) { if (a.dive) (a.dive.remote ? diveBack : diveOut)(race, S, car); endFx(S, car); }
      }
    } else if (running && !car.finished && car.control !== 'net' && a.gauge < 1 && !a.sealed) {
      const drift = car.stats?.driftCharge && car.drifting ? 1 + DRIFT_CHARGE : 1;
      a.gauge = Math.min(1, a.gauge + dt * (car.stats?.gaugeRate || 1) / ABILITIES[a.id].fill * drift);
      if (a.gauge >= 1 && isHuman(car)) {   // ready pulse
        ring(S, _w.set(car.pos.x, car.pos.y + 0.15, car.pos.z), COLOR[a.id], { r0: 1, r1: 5, life: 0.5, opacity: 0.8 });
        burst(S.glow, _w.setY(car.pos.y + 1), 20, PAL[a.id] === PAL.oil ? PAL.spark : PAL[a.id], 4, 0.5, 0.4, 0.05, 0, 2, 1, 2);
      }
    }
    if (a.id === 'facewall' && car.control === 'cpu') car.input.ability = a.gauge >= 1 && !(a.active > 0) && faceWanted(race, car);
  }

  // timeslow: strongest field not owned by the car; shield ignores it; a reflecting car bounces it onto its owner (and is
  // free of that field from then on). + a slow bounced back onto this car by a reflector (bounce())
  for (const car of race.cars) {
    let p = 0;
    for (const hz of race.hazards) {
      if (hz.kind !== 'timeslow' || hz.owner === car || hz.bounced?.has(car)) continue;
      if (reflects(race, car, hz.owner, 'timeslow', { pow: hz.power, left: hz.left })) { (hz.bounced ||= new Set()).add(car); continue; }
      p = Math.max(p, hz.power);
    }
    if (car.mods?.invulnerable || away(car)) p = 0;
    if (car.ability.bounceT > 0) p = Math.max(p, car.ability.bounceP);
    car.ability.slow = p;
    if (p && car.mods) car.mods.speedMul *= Math.max(0, 1 - p);
  }

  // downforce: dirty air (乱気流) behind a planted car costs this client's own cars grip (one wake at a time; a planted
  // car keeps its own full grip). Not an attack: a shield or mirrors don't stop air
  for (const car of race.cars) {
    const a = car.ability;
    a.wake = car.control !== 'net' && !car.finished && !away(car) && !planted(car) && car.mods ? wakeOf(race, car) : null;
    if (!a.wake) continue;
    car.mods.gripMul *= 1 - DF.grip;
    if (!isHuman(car)) continue;
    if (S.time - (a.wakeAt ?? -9) > 2) flash(race, who(race, car) + '乱気流!', COLOR.downforce);
    a.wakeAt = S.time;
    if (Math.random() < dt * 6) race.hud?.shake?.(car, 0.12);   // buffeted
  }

  // hellchain: the chained car hauls its owner along: slowed (after its own boosts, like timeslow) by the strongest chain
  // on it, not once per chain. Only this client's own cars: a remote target's own client does it
  const held = new Map();
  for (const car of race.cars) {
    const a = car.ability, tg = a.chained && a.t >= HELL.hook ? a.target : null;
    if (!tg || tg.control === 'net' || tg.finished || !tg.mods || chainProof(tg)) continue;
    if (reflects(race, tg, car, 'hellchain')) continue;   // snapped back (bounce() released it)
    const was = held.has(tg) || S.held?.has(tg);   // already on a chain: no second alarm
    held.set(tg, Math.max(held.get(tg) || 0, Math.min(HELL.maxDrag, a.power)));
    if (!isHuman(tg) || a.hookFlash) continue;
    a.hookFlash = true;
    if (was) continue;
    flash(race, who(race, tg) + '鎖につながれた!', COLOR.hellchain);
    screenFlash(race, tg, HELL_SCREEN);
    race.hud?.shake?.(tg, 0.4);
  }
  for (const [tg, p] of held) {
    tg.mods.speedMul *= 1 - p;
    if (isHuman(tg) && Math.random() < dt * 5) race.hud?.shake?.(tg, 0.15);   // the chain rattles
  }
  S.held = held;

  // magnet: a pull aimed at a reflecting car is repelled (only the target's own client: reflects() checks)
  for (const car of race.cars) {
    const a = car.ability;
    if (a.id === 'magnet' && a.active > 0 && a.target) reflects(race, a.target, car, 'magnet');
  }

  // domain: other cars inside a live dome are slowed and sealed (gauge frozen, can't activate); shield ignores it.
  // Only this client's own cars: a remote car's own client applies it there.
  for (const car of race.cars) {
    const a = car.ability;
    let p = 0;
    if (car.control !== 'net' && !car.finished && !car.mods?.invulnerable) {
      for (const hz of race.hazards) {
        if (hz.kind !== 'domain' || !hz.on || hz.owner === car || hz.bounced?.has(car) || car.pos.distanceToSquared(hz.center) >= DOMAIN_R * DOMAIN_R) continue;
        // a reflecting car inside: the dome's slow goes to its owner, and this dome leaves the car alone from then on
        if (reflects(race, car, hz.owner, 'domain', { pow: hz.power, left: hz.life - hz.age })) { (hz.bounced ||= new Set()).add(car); continue; }
        p = Math.max(p, Math.min(DOMAIN_MAX_SLOW, hz.power));
      }
    }
    if (p) {
      if (!a.sealed && isHuman(car) && S.time - (a.caughtAt ?? -9) > 2) flash(race, who(race, car) + '結界に囚われた！', COLOR.domain);
      a.caughtAt = S.time;
      if (car.mods) car.mods.speedMul *= 1 - p;
      if (Math.random() < dt * 14) {   // violet motes rising off the caught car
        S.glow.emit(car.pos.x + rnd(-1, 1), car.pos.y + rnd(0.5, 1.5), car.pos.z + rnd(-1, 1), car.vel?.x || 0, rnd(1.5, 3), car.vel?.z || 0, pick(PAL.domain), rnd(0.6, 1), 0.5, 0.1, 0, 0.5);
      }
    }
    a.sealed = p > 0;
    a.domVis += ((a.sealed ? 1 : 0) - a.domVis) * Math.min(1, dt * 5);
    if (a.domVis < 0.005) a.domVis = 0;
  }

  let j = 0;
  for (const hz of race.hazards) {
    if (hz.update(dt) === false) hz.dispose?.();
    else race.hazards[j++] = hz;
  }
  race.hazards.length = j;

  for (const car of race.cars) carVisuals(race, S, car, dt);
  if (S.tex.film) S.tex.film.rotation += dt * 0.25;
  if (S.tex.flow) S.tex.flow.offset.x -= dt * 4;

  j = 0;
  for (const f of S.fx) {
    f.t += dt;
    if (f.t >= f.life) dropFx(f);
    else { f.tick(f.obj, f.t / f.life); S.fx[j++] = f; }
  }
  S.fx.length = j;

  const h = typeof window !== 'undefined' ? window.innerHeight * (race.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2)) : 800;
  const scale = h * 0.5 * (race.mode === 'split' ? 0.5 : 1);
  S.glow.update(dt, scale);
  S.smoke.update(dt, scale);
  updateTint(race, S);
}

export function tryActivate(race, car) {
  const a = car.ability || initAbility(race, car);
  if (a.gauge < 1 || a.active > 0 || race.state !== 'running' || car.finished || car.control === 'net') return false;
  if (a.sealed) {   // inside someone's domain
    if (isHuman(car)) flash(race, who(race, car) + '封印中!', COLOR.domain);
    return false;
  }
  if (a.id === 'tokyodive' && diveLate(race, car)) {   // keeps the gauge
    if (isHuman(car)) flash(race, who(race, car) + 'ゴール目前!', COLOR.tokyodive);
    return false;
  }
  const def = ABILITIES[a.id];
  let dur = def.duration * (car.stats?.abilityDuration || 1), pow = def.power * (car.stats?.abilityPower || 1);
  const pose = { x: car.pos.x, y: car.pos.y, z: car.pos.z, h: car.heading, i: car.trackIndex };
  a.gauge = 0;
  // before start(): in split screen a thunderbolt victim's '落雷!' must be the flash that stays
  if (isHuman(car)) flash(race, who(race, car) + def.name + '!', COLOR[a.id]);
  else if (a.id === 'timeslow' && slowedHumans(race)) flash(race, `${car.name}の${def.name}!`, COLOR.timeslow);
  const target = a.id === 'thunderbolt' ? thunderTarget(race, car) : a.id === 'magnet' ? magnetTarget(race, car)
    : a.id === 'hellchain' ? magnetTarget(race, car, HELL.snap, HELL.range) : null;
  if (a.id === 'magnet' && !target) ({ dur, pow } = MAGNET_LEAD);   // leading: short weak boost
  if (a.id === 'hellchain' && !target) {
    ({ dur, pow } = HELL_MISS);
    if (isHuman(car)) flash(race, who(race, car) + '届かない!', COLOR.hellchain);
  }
  if (a.id === 'domain' && isHuman(car)) screenFlash(race, car, DOMAIN_SCREEN);
  start(race, car, a.id, dur, pow, pose, target);
  if (race.net && car.control === 'p1') {
    race.net.send({ t: 'ability', pid: race.localPid, id: a.id, x: r2(pose.x), y: r2(pose.y), z: r2(pose.z), h: r2(pose.h), dur: r2(dur), pow: r2(pow), ...(target?.pid != null && { tp: String(target.pid) }),
      ...(a.fam && { fam: famMsg(a.fam) }) });   // family: who comes
  }
  return true;
}

export function applyRemoteAbility(race, msg) {
  const def = ABILITIES[msg?.id];
  if (msg?.id === 'family' && msg.pre) {   // famAnnounce: only builds the meshes, so it may come before GO
    const car = race.cars.find(c => c.pid != null && c.pid === msg.pid);
    if (car?.control === 'net' && car.ability?.id === 'family' && race.scene) famRemote(race, car, msg.fam);
    return;
  }
  // a straggler still counting down (forced start) has no clock running: a spin / slow / slick / fx applied now
  // would freeze until its own GO and land there. Same rule as tryActivate: nothing acts before GO.
  if (!def || !race.scene || race.state !== 'running') return;
  const car = race.cars.find(c => c.pid != null && c.pid === msg.pid) || null;
  if (car && !car.ability) initAbility(race, car);
  if (msg.rel) {   // hellchain: the owner's chain snapped (b: a reflector bounced it: no slingshot / whip here either)
    const a = car?.ability;
    if (a?.chained && !reflects(race, a.target, car, 'hellchain')) chainRelease(race, car, a, !msg.b && !chainProof(a.target), !!msg.b);
    return;
  }
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  if (msg.id === 'reflect' && msg.ref != null) {   // car reflected an attack by tp: the bounce (applied here if tp is ours)
    const S = st(race), key = `${msg.pid}:${msg.n}`;
    if (!Object.hasOwn(REFLECT, String(msg.ref)) || !Number.isFinite(msg.n) || (S.refSeen ||= new Set()).has(key)) return;
    S.refSeen.add(key);
    const src = race.cars.find(c => c.pid != null && String(c.pid) === String(msg.tp)) || null;
    const e = { spin: clamp(num(msg.sp, 0), 0, BOUNCE_MAX.spin), slow: clamp(num(msg.sl, 0), 0, BOUNCE_MAX.slow), slowT: clamp(num(msg.st, 0), 0, BOUNCE_MAX.slowT), end: REFLECT[msg.ref]({ pow: 0, left: 0 }, 1).end };
    const at = Number.isFinite(msg.ox) && Number.isFinite(msg.oz) ? { x: msg.ox, z: msg.oz } : null;
    bounce(race, S, car, src, String(msg.ref), e, at, car?.pos || { x: num(msg.x, 0), y: num(msg.y, 0), z: num(msg.z, 0) });
    return;
  }
  // peer data is untrusted: cap at 2x base (skill tree max is +25%)
  const dur = clamp(num(msg.dur, def.duration * (car?.stats?.abilityDuration || 1)), 0, def.duration * 2);
  const pow = clamp(num(msg.pow, def.power * (car?.stats?.abilityPower || 1)), 0, def.power * 2);
  const pose = { x: num(msg.x, car?.pos.x ?? 0), y: num(msg.y, car?.pos.y ?? 0), z: num(msg.z, car?.pos.z ?? 0), h: num(msg.h, car?.heading ?? 0), i: car?.trackIndex };
  const target = msg.tp != null ? race.cars.find(c => c.pid != null && String(c.pid) === String(msg.tp)) || null : null;
  if (msg.id === 'tokyodive' && msg.out) {   // the diver came back there: show it once its car gets there
    const d = car?.ability?.dive;
    if (d?.remote) { d.out = new THREE.Vector3(pose.x, pose.y, pose.z); d.outAt = d.t; }
    return;
  }
  if (msg.id === 'family') {   // end: the owner was reset onto the road; else the allies it named (their meshes built now)
    if (msg.end) { if (car?.ability?.fam && car.ability.active > 0) famEnd(race, st(race), car, false); return; }
    if (car?.control === 'net') famRemote(race, car, msg.fam);
  }
  start(race, car, msg.id, dur, pow, pose, target);
  if (msg.id === 'timeslow' && slowedHumans(race)) flash(race, `${car ? car.name + 'の' : ''}${def.name}!`, COLOR.timeslow);
}

// online: every 'state' of a remote car says whether it is away in its own space (aw). The one-shot ability message
// can be dropped, and a sender slower than this client dives longer than the timeout here: the stream keeps it hidden.
export function netAway(race, car, away, msg) {
  const a = car?.ability;
  if (!a || a.id !== 'tokyodive') return;
  let d = a.dive;
  if (away) {
    if (!d) {   // its ability message never came
      d = a.dive = { t: DIVE.lead, phase: 'gate', remote: true };
      a.power = a.t = 0;
      a.activeMax = DIVE.remoteSlack;
    }
    if (!d.remote) return;
    if (d.phase === 'gate') diveIn(race, st(race), car);
    d.aw = true;
    a.active = Math.max(a.active, DIVE.remoteSlack);
  } else if (d?.remote && d.aw && !d.out) {   // the first state from back on the track
    d.out = new THREE.Vector3(+msg.x || 0, +msg.y || 0, +msg.z || 0);
    d.outAt = d.t;
  }
}

export function clearAbilities(race) {
  for (const hz of race.hazards || []) hz.dispose?.();
  if (race.hazards) race.hazards.length = 0;
  for (const car of race.cars || []) {
    const a = car.ability;
    if (!a) continue;
    setPhase(car, false);
    if (a.fx) { a.fx.group.removeFromParent(); a.fx.mats.forEach(m => m.dispose()); a.fx.aura?.geometry.dispose(); a.fx.geos?.forEach(g => g.dispose()); a.fx = null; }
    if (a.chainFx) {
      const { links, glow } = a.chainFx;
      links.removeFromParent(); links.dispose(); glow.removeFromParent(); glow.geometry.dispose(); glow.material.dispose();
      a.chainFx = null;
    }
    a.chained = false;
    a.gone = true;   // a robot still loading must not attach any more
    if (a.body) { a.body.visible = true; a.body.scale.setScalar(1); a.body.rotation.y = 0; }
    if (a.robot) a.robot.visible = false;   // stays under the car mesh: stopRace disposes it with the scene
    a.active = a.slow = a.slowVis = a.domVis = a.dfVis = a.robotPh = a.bounceT = 0;
    a.sealed = a.away = false;
    a.target = a.dive = null;
    if (car._) { car._.away = false; car._.track = null; }
  }
  const S = STATE.get(race);
  if (!S) return;
  S.fx.forEach(dropFx);
  S.root.removeFromParent();
  S.glow.dispose(); S.smoke.dispose();
  S.dropMat?.dispose();
  S.chainMat?.dispose();
  Object.values(S.geo).forEach(g => g.dispose());
  Object.values(S.tex).flat().forEach(t => t.dispose());
  Object.values(S.tint).forEach(el => el.remove());
  STATE.delete(race);
}
