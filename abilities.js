// Active abilities: gauges, effects written into car.mods, hazards (oil / timeslow) and all their visuals.
import * as THREE from 'three';
import { ABILITIES } from './data.js';

const OIL_RADIUS = 3, OIL_BEHIND = 4.2;
const DRIFT_CHARGE = 1.2;   // extra gauge fill rate while drifting (stats.driftCharge)
const COLOR = {
  boost: '#5fe3ff', nitro: '#ff9a3c', oil: '#b6ff3b', shield: '#5ef1ff',
  warp: '#6fe0ff', timeslow: '#c77dff', phase: '#ff8fd8',
};
const pal = (...h) => h.map(x => new THREE.Color(x));
const PAL = {
  boost: pal('#f0fdff', '#7ae8ff', '#2aa8ff', '#3d6bff'),
  nitro: pal('#fff4c2', '#ffc04a', '#ff6a1f', '#ff3d1f', '#6ab8ff'),
  shield: pal('#e8feff', '#5ef1ff', '#2a9dff'),
  warp: pal('#ffffff', '#bff4ff', '#4cc9f0', '#3a6bff'),
  timeslow: pal('#f0dcff', '#c77dff', '#7b2cbf', '#5a3dff'),
  phase: pal('#ffe0f0', '#ff8fd8', '#9ffcff'),
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
const isHuman = c => c.control === 'p1' || c.control === 'p2';
const flash = (race, text, color) => race.hud?.flash?.(text, color);
const who = (race, car) => (race.mode === 'split' ? (car.control === 'p1' ? 'P1 ' : 'P2 ') : '');
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

function tex(S, key) {
  return (S.tex[key] ||= key === 'clock' ? clockTex() : key === 'film' ? filmTex() : [blobTex(), blobTex(), blobTex()]);
}

// transient world FX (rings, flashes): tick(obj, k) with k 0→1
function addFx(S, obj, life, tick) {
  S.root.add(obj);
  S.fx.push({ obj, t: 0, life, tick });
  tick(obj, 0);
}

function ring(S, p, color, { vertical = false, heading = 0, r0 = 1, r1 = 8, life = 0.6, opacity = 0.9 } = {}) {
  const m = new THREE.Mesh(S.geo.ring, new THREE.MeshBasicMaterial({
    color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.position.copy(p);
  if (vertical) m.rotation.y = heading; else m.rotation.x = -Math.PI / 2;
  addFx(S, m, life, (o, k) => { o.scale.setScalar(r0 + (r1 - r0) * easeOut(k)); o.material.opacity = opacity * (1 - k); });
}

function glowBall(S, p, r, life, color = '#e8fbff') {
  const m = new THREE.Mesh(S.geo.sphere, new THREE.MeshBasicMaterial({
    color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  m.position.copy(p);
  addFx(S, m, life, (o, k) => { o.scale.setScalar(0.2 + r * easeOut(k)); o.material.opacity = (1 - k) ** 2; });
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
  const box = new THREE.Box3().setFromObject(m);
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
  if (!act && !a.slowVis && !a.fx && !(car.spin > 0)) return;
  if (a.id === 'phase') setPhase(car, act === 'phase');
  const fx = carFx(car);
  if (!fx) return;
  const t = S.time, sh = Math.sin(car.heading), ch = Math.cos(car.heading);
  const vx = car.vel ? car.vel.x : sh * car.speed, vz = car.vel ? car.vel.z : ch * car.speed;
  const world = (p, out = _v) => out.set(car.pos.x + p.z * sh + p.x * ch, car.pos.y + p.y, car.pos.z + p.z * ch - p.x * sh);

  if (a.id === 'boost' || a.id === 'nitro') {
    const nitro = a.id === 'nitro', g = flames(S, fx, nitro), on = act === a.id;
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

  if (car.spin > 0 && Math.random() < dt * 25) {   // dizzy sparkles
    const th = t * 9 + rnd(-0.3, 0.3);
    world(_w.set(Math.cos(th) * 0.9, fx.box.max.y + 0.5, Math.sin(th) * 0.9));
    S.glow.emit(_v.x, _v.y, _v.z, vx, rnd(0.5, 1.5), vz, pick(PAL.spark), 0.45, 0.45, 0.05, 0, 1);
  }
}

// ---------- effects ----------
function applyOwn(car, a) {
  const m = car.mods;
  if (!m) return;
  if (a.id === 'boost' || a.id === 'nitro') { m.speedMul += a.power; m.accelMul += a.power; }
  else if (a.id === 'shield') m.invulnerable = true;
  else if (a.id === 'phase') { m.noCollide = true; m.noOffroadPenalty = true; m.speedMul += a.power; }
}

function endFx(S, car) {
  const a = car.ability, p = _w.set(car.pos.x, car.pos.y + 0.8, car.pos.z);
  if (a.id === 'shield') burst(S.glow, p, 40, PAL.shield, 8, 0.5, 0.45, 0.05);
  else if (a.id === 'phase') { setPhase(car, false); burst(S.glow, p, 30, PAL.phase, 5, 0.6, 0.4, 0.05); }
  else burst(S.smoke, p, 10, PAL.smoke, 2, 0.8, 0.5, 1.4, -0.5, 1.5, 0.25);
}

// track-relative helpers
function rideOffset(tr, x, y, z) {
  if (!tr?.nearest) return { n: null, off: 0 };
  const n = tr.nearest(new THREE.Vector3(x, y, z));
  return { n, off: clamp(y - n.point.y, -0.5, 1) };
}

function warpDest(race, pose, dist) {
  const tr = race.track, from = new THREE.Vector3(pose.x, pose.y, pose.z);
  if (!tr?.nearest) return { pos: from.clone().add(_v.set(Math.sin(pose.h), 0, Math.cos(pose.h)).multiplyScalar(dist)), heading: pose.h };
  const { n, off } = rideOffset(tr, pose.x, pose.y, pose.z);
  const nt = (n.tangent || tr.tangentAt(n.t)).clone().normalize();
  const t = (((n.t + dist / tr.length) % 1) + 1) % 1;
  const c = tr.pointAt(t).clone(), tan = tr.tangentAt(t).clone().normalize();
  const lim = Math.max(0, tr.width / 2 - 1.8);
  const lat = clamp(_v.copy(from).sub(n.point).dot(_w.set(-nt.z, 0, nt.x).normalize()), -lim, lim);   // + = right
  const pos = c.addScaledVector(_w.set(-tan.z, 0, tan.x).normalize(), lat);
  pos.y += off;
  return { pos, heading: pose.h + wrap(Math.atan2(tan.x, tan.z) - pose.h) };   // keep heading continuous
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
    const { n: nc, off } = rideOffset(tr, pose.x, pose.y, pose.z);
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
    burst(S.glow, p.setY(p.y + 0.6), 24, PAL.shield, 7, 0.4, 0.4, 0.05);
    if (isHuman(car)) flash(race, who(race, car) + 'ガード!', COLOR.shield);
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

// shared by local activation and remote messages; car may be null (unknown remote pid)
function start(race, car, id, dur, pow, pose) {
  const S = st(race), at = new THREE.Vector3(pose.x, pose.y, pose.z);
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
  }
  const c = PAL[id];
  if (id !== 'oil') burst(S.glow, _w.copy(at).setY(at.y + 0.8), 36, c, 7, 0.5, 0.5, 0.05, 0, 2.5);
  if (id !== 'timeslow') ring(S, _w.copy(at).setY(at.y + 0.15), COLOR[id], { r0: 1.5, r1: 6, life: 0.4, opacity: 0.8 });
}

// ---------- tint overlay for slowed local players ----------
function updateTint(race, S) {
  if (typeof document === 'undefined') return;
  const split = race.mode === 'split';
  for (const car of race.cars) {
    if (!isHuman(car) || !car.ability) continue;
    const v = Math.round(car.ability.slowVis * 100) / 100;
    let el = S.tint[car.control];
    if (!el) {
      if (!v) continue;
      el = S.tint[car.control] = document.createElement('div');
      Object.assign(el.style, {
        position: 'fixed', left: '0', width: '100%', pointerEvents: 'none', zIndex: '4', opacity: '0',
        top: split && car.control === 'p2' ? '50%' : '0', height: split ? '50%' : '100%',
        background: 'radial-gradient(ellipse at center, rgba(150,70,255,0.07) 35%, rgba(110,30,220,0.55) 100%)',
      });
      (document.getElementById('game') || document.body).appendChild(el);
    }
    if (el.__v !== v) { el.__v = v; el.style.opacity = String(v); }
  }
}

// ---------- public API ----------
export function initAbility(race, car) {
  const id = ABILITIES[car.stats?.ability] ? car.stats.ability : (ABILITIES[car.def?.ability] ? car.def.ability : 'boost');
  car.ability = {
    id, name: ABILITIES[id].name, gauge: 0, active: 0, activeMax: 0, power: 0, t: 0,
    slow: 0, slowVis: 0, hit: 0, fx: null, phaseSwap: null,
  };
  car.spin ??= 0;
  return car.ability;
}

export function updateAbilities(race, dt) {
  const S = st(race), running = race.state === 'running';
  S.time += dt;

  for (const car of race.cars) {
    const a = car.ability || initAbility(race, car);
    if (car.spin > 0) car.spin = Math.max(0, car.spin - dt);
    if (a.active > 0) {
      a.t += dt;
      applyOwn(car, a);
      a.active = Math.max(0, a.active - dt);
      if (!a.active) endFx(S, car);
    } else if (running && !car.finished && car.control !== 'net' && a.gauge < 1) {
      const drift = car.stats?.driftCharge && car.drifting ? 1 + DRIFT_CHARGE : 1;
      a.gauge = Math.min(1, a.gauge + dt * (car.stats?.gaugeRate || 1) / ABILITIES[a.id].fill * drift);
      if (a.gauge >= 1 && isHuman(car)) {   // ready pulse
        ring(S, _w.set(car.pos.x, car.pos.y + 0.15, car.pos.z), COLOR[a.id], { r0: 1, r1: 5, life: 0.5, opacity: 0.8 });
        burst(S.glow, _w.setY(car.pos.y + 1), 20, PAL[a.id] === PAL.oil ? PAL.spark : PAL[a.id], 4, 0.5, 0.4, 0.05, 0, 2, 1, 2);
      }
    }
  }

  // timeslow: strongest field not owned by the car; shield ignores it
  for (const car of race.cars) {
    let p = 0;
    for (const hz of race.hazards) if (hz.kind === 'timeslow' && hz.owner !== car) p = Math.max(p, hz.power);
    if (car.mods?.invulnerable) p = 0;
    car.ability.slow = p;
    if (p && car.mods) car.mods.speedMul *= Math.max(0, 1 - p);
  }

  let j = 0;
  for (const hz of race.hazards) {
    if (hz.update(dt) === false) hz.dispose?.();
    else race.hazards[j++] = hz;
  }
  race.hazards.length = j;

  for (const car of race.cars) carVisuals(race, S, car, dt);
  if (S.tex.film) S.tex.film.rotation += dt * 0.25;

  j = 0;
  for (const f of S.fx) {
    f.t += dt;
    if (f.t >= f.life) { f.obj.removeFromParent(); f.obj.material.dispose(); }
    else { f.tick(f.obj, f.t / f.life); S.fx[j++] = f; }
  }
  S.fx.length = j;

  const h = typeof window !== 'undefined' ? window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) : 800;
  const scale = h * 0.5 * (race.mode === 'split' ? 0.5 : 1);
  S.glow.update(dt, scale);
  S.smoke.update(dt, scale);
  updateTint(race, S);
}

export function tryActivate(race, car) {
  const a = car.ability || initAbility(race, car);
  if (a.gauge < 1 || a.active > 0 || race.state !== 'running' || car.finished || car.control === 'net') return false;
  const def = ABILITIES[a.id];
  const dur = def.duration * (car.stats?.abilityDuration || 1), pow = def.power * (car.stats?.abilityPower || 1);
  const pose = { x: car.pos.x, y: car.pos.y, z: car.pos.z, h: car.heading };
  a.gauge = 0;
  start(race, car, a.id, dur, pow, pose);
  if (isHuman(car)) flash(race, who(race, car) + def.name + '!', COLOR[a.id]);
  else if (a.id === 'timeslow' && slowedHumans(race)) flash(race, `${car.name}の${def.name}!`, COLOR.timeslow);
  if (race.net && car.control === 'p1') {
    race.net.send({ t: 'ability', pid: race.localPid, id: a.id, x: r2(pose.x), y: r2(pose.y), z: r2(pose.z), h: r2(pose.h), dur: r2(dur), pow: r2(pow) });
  }
  return true;
}

export function applyRemoteAbility(race, msg) {
  const def = ABILITIES[msg?.id];
  if (!def || !race.scene) return;
  const car = race.cars.find(c => c.pid != null && c.pid === msg.pid) || null;
  if (car && !car.ability) initAbility(race, car);
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  // peer data is untrusted: cap at 2x base (skill tree max is +25%)
  const dur = clamp(num(msg.dur, def.duration * (car?.stats?.abilityDuration || 1)), 0, def.duration * 2);
  const pow = clamp(num(msg.pow, def.power * (car?.stats?.abilityPower || 1)), 0, def.power * 2);
  const pose = { x: num(msg.x, car?.pos.x ?? 0), y: num(msg.y, car?.pos.y ?? 0), z: num(msg.z, car?.pos.z ?? 0), h: num(msg.h, car?.heading ?? 0) };
  start(race, car, msg.id, dur, pow, pose);
  if (msg.id === 'timeslow' && slowedHumans(race)) flash(race, `${car ? car.name + 'の' : ''}${def.name}!`, COLOR.timeslow);
}

export function clearAbilities(race) {
  for (const hz of race.hazards || []) hz.dispose?.();
  if (race.hazards) race.hazards.length = 0;
  for (const car of race.cars || []) {
    const a = car.ability;
    if (!a) continue;
    setPhase(car, false);
    if (a.fx) { a.fx.group.removeFromParent(); a.fx.mats.forEach(m => m.dispose()); a.fx = null; }
    a.active = a.slow = a.slowVis = 0;
  }
  const S = STATE.get(race);
  if (!S) return;
  for (const f of S.fx) f.obj.material.dispose();
  S.root.removeFromParent();
  S.glow.dispose(); S.smoke.dispose();
  S.dropMat?.dispose();
  Object.values(S.geo).forEach(g => g.dispose());
  Object.values(S.tex).flat().forEach(t => t.dispose());
  Object.values(S.tint).forEach(el => el.remove());
  STATE.delete(race);
}
