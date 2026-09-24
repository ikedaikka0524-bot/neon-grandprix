// Race runtime: track, arcade physics, CPU AI, laps, HUD, cameras, split screen, online sync. Scenery: world.js.
import * as THREE from 'three';
import { CARS, CAR_BY_ID, ABILITIES, SKILL_TREE, computeStats } from './data.js';
import { TRACK_BY_ID, DEFAULT_TRACK } from './tracks.js';
import { buildCarMesh } from './carmodel.js';
import { buildWorld } from './world.js';
import { initAbility, updateAbilities, tryActivate, applyRemoteAbility, clearAbilities, robotKnock } from './abilities.js';
import { createRecorder, createGhostPlayer } from './ghost.js';
import { netSample, ageOf, predict, newOffset, applyOffset, retarget, decay } from './netpredict.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const wrap01 = t => t - Math.floor(t);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;
const poisson = rate => Math.floor(rate + Math.random());
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function fmtTime(s) {
  if (s == null || !isFinite(s)) return '-:--.--';
  const cs = Math.max(0, Math.round(s * 100)), m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, c = cs % 100;
  return `${m}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

// downforce: ability power (0 = off): grip 0.99 whatever the course, no drift / lateral slip / cornering scrub, more steering
// tow / towV (hellchain): pulled forward at tow m/s^2, throttle or not, but never past towV m/s (abilities.js zeroes it
// under brakes / spin / off-road). assist: steering assist (-1..1) blended into a player's own steer
const MODS0 = Object.freeze({ speedMul: 1, accelMul: 1, gripMul: 1, noCollide: false, noOffroadPenalty: false, invulnerable: false, downforce: 0, tow: 0, towV: 0, assist: 0 });
const CPU_NAMES = ['ハヤテ', 'ミズキ', 'ライデン', 'サクラ', 'ゴンタ', 'ツバサ', 'カエデ', 'レン', 'ヒカル', 'シズク'];
const KEYSETS = {
  single: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], ability: ['Space', 'ShiftLeft', 'ShiftRight'], reset: ['KeyR'], label: 'SPACE' },
  p1: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], ability: ['ShiftLeft', 'Space'], reset: ['KeyR'], label: 'L-SHIFT' },
  p2: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], ability: ['ShiftRight', 'Enter', 'NumpadEnter'], reset: ['Numpad0', 'Period'], label: 'R-SHIFT' },
};
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Enter', 'NumpadEnter', 'Tab']);

// Graphics quality ('high' = the original look). Lower levels trade pixels, shadows, scenery density, effects and view
// distance for frame rate. 'auto' starts from a device guess, steps down on slow measured frames (at most once back up).
const QUALITY = {
  high: { pr: 2, shadow: 2048, inst: 1, fx: 1, far: 1 },
  medium: { pr: 1.25, shadow: 1024, inst: 0.6, fx: 0.6, far: 0.8 },
  low: { pr: 1, shadow: 0, inst: 0.35, fx: 0.3, far: 0.6 },
};
const LEVELS = ['low', 'medium', 'high'], LEVEL_JA = { high: '高', medium: '中', low: '低' };
// 'auto' steps on a ladder: 0 = 'low' at pixel ratio 0.7, 1 = low, 2 = medium, 3 = high. Page session: the level the
// previous race settled at, the lowest step still worth going to, the highest step that held.
let autoLevel = null, autoMin = 0, autoMax = 3;
const guessLevel = () => ((navigator.hardwareConcurrency || 4) >= 8 && !matchMedia('(pointer: coarse)').matches ? 'high' : 'medium');

let R = null;   // active race context

// ======================================================================================
// Public API
// ======================================================================================
export async function startRace(opts) {
  stopRace();
  const root = document.getElementById('game');
  if (!root) throw new Error('#game not found');
  const mode = opts.mode || 'solo';
  const ctx = R = {
    opts, mode, root, keys: new Set(), pressed: new Set(), timers: [], offs: [], listeners: [], views: [],
    paused: false, quitOpen: false, clock: 0, last: performance.now(), netAcc: 0, finalized: false,
    count: 3.9, lastCount: 99, order: [], world: new THREE.Group(), fx: [], errors: 0, firstLocalFinish: null,
  };
  window.__race = ctx;   // debug handle (console inspection / automated play-tests)
  try { await setup(ctx, root, opts, mode); }
  catch (err) { if (R === ctx) stopRace(); throw err; }
}

async function setup(ctx, root, opts, mode) {
  const def = TRACK_BY_ID[opts.trackId] || TRACK_BY_ID[DEFAULT_TRACK];
  // ---- DOM + renderer
  ctx.style = document.createElement('style');
  ctx.style.textContent = CSS;
  document.head.appendChild(ctx.style);
  if (getComputedStyle(root).position === 'static') { ctx.restorePos = root.style.position; root.style.position = 'relative'; }
  const wrap = ctx.wrap = document.createElement('div');
  wrap.className = 'rg-root';
  if (root.clientHeight < 50) wrap.style.position = 'fixed';
  root.appendChild(wrap);
  const loading = el(wrap, 'div', 'rg-loading', `<div class="rg-spin"></div>${esc(def.name)} を準備中…`);

  ctx.auto = !QUALITY[opts.quality];
  ctx.q = ctx.auto ? (autoLevel ??= guessLevel()) : opts.quality;
  // antialias is fixed per context: decided here (pixel ratio, shadows etc. follow the level live, see applyQuality)
  const renderer = ctx.renderer = new THREE.WebGLRenderer({ antialias: ctx.q !== 'low', powerPreference: 'high-performance' });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // every level: only shadows on/off changes the lit shaders
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'rg-gl';
  wrap.appendChild(renderer.domElement);

  const scene = ctx.scene = new THREE.Scene();
  scene.add(ctx.world);

  const track = ctx.track = buildTrack(def);
  const race = ctx.race = {
    THREE, scene, time: 0, state: 'countdown', mode, def, cars: [], track,
    net: mode === 'online' ? (opts.net || null) : null, localPid: opts.localPid ?? null,
    hazards: [], hud: {
      flash: (text, color) => flashAll(ctx, text, color), layer: car => ctx.viewByCar?.get(car)?.hud.tints,
      shake: (car, s) => { const v = ctx.viewByCar?.get(car); if (v) v.shake = Math.max(v.shake, s); },   // that car's camera, if local
    },
  };
  ctx.worldFx = await buildWorld(ctx, def);
  if (R !== ctx) return;
  ctx.smoke = new Particles(ctx, 1400, false);
  ctx.glow = new Particles(ctx, 2200, true);
  ctx.skids = new Skids(ctx, 2600);

  // ---- cars
  const { list, grid } = buildEntries(opts, mode);
  const meshes = await Promise.all(list.map(e => buildCarMesh(e.carId, e.look)));
  if (R !== ctx) return;
  race.cars = list.map((e, i) => makeCar(i, e, meshes[i]));
  if (ctx.env.night) for (const car of race.cars) carLights(ctx, car);
  for (const car of race.cars) { blobShadow(ctx, car); scene.add(car.mesh); }
  // a ghost from another course would drive through the scenery (pre-v2 ghosts are from the original circuit)
  ctx.ghostData = opts.ghost && (opts.ghost.trackId ?? DEFAULT_TRACK) === def.id ? opts.ghost : null;
  const g0 = mode === 'ghost' && ctx.ghostData?.frames?.[0];
  grid.forEach((e, slot) => placeOnGrid(ctx, race.cars[list.indexOf(e)], Array.isArray(g0) ? ghostSlot(track, g0) : slot));
  for (const car of race.cars) initAbility(race, car);

  // ---- viewports
  const p1 = race.cars.find(c => c.control === 'p1') || race.cars[0];
  const p2 = race.cars.find(c => c.control === 'p2');
  ctx.audio = makeAudio();
  if (mode === 'split' && p2) {
    ctx.views = [makeView(ctx, p1, KEYSETS.p1, 0, 2), makeView(ctx, p2, KEYSETS.p2, 1, 2)];
    el(wrap, 'div', 'rg-divider');
  } else ctx.views = [makeView(ctx, p1, KEYSETS.single, 0, 1)];
  ctx.viewByCar = new Map(ctx.views.map(v => [v.car, v]));
  buildMapBase(ctx);
  if (race.net) ctx.linkEl = el(ctx.views[0].hud.root, 'div', 'rg-link');

  // ---- ghost / recorder
  if (mode === 'ghost' && ctx.ghostData) {
    try { ctx.ghost = await createGhostPlayer(race, ctx.ghostData); } catch (err) { console.warn('ghost failed', err); ctx.ghost = null; }
    if (R !== ctx) { ctx.ghost?.dispose?.(); return; }
  }
  if (mode === 'solo' || mode === 'ghost') {
    try { ctx.recorder = createRecorder(p1, def.id); } catch (err) { console.warn('recorder failed', err); }
  }

  // ---- net
  if (race.net) hookNet(ctx);

  // ---- input / misc DOM
  ctx.modal = el(wrap, 'div', 'rg-modal', `<div class="rg-modal-box"><h2>レースを終了しますか？</h2>
    <p>${mode === 'online' ? 'オンライン対戦から退出します' : '進行中のレースは記録されません'}</p>
    <div class="rg-modal-btns"><button class="rg-btn rg-cancel">続ける <kbd>Esc</kbd></button><button class="rg-btn rg-ok">終了する <kbd>${mode === 'split' ? 'Y' : 'Enter'}</kbd></button></div></div>`);
  ctx.modal.querySelector('.rg-cancel').addEventListener('click', () => closeQuit(ctx));
  ctx.modal.querySelector('.rg-ok').addEventListener('click', () => confirmQuit(ctx));
  // touch / mouse way into the quit prompt (Esc is the only other one)
  const quitBtn = el(wrap, 'button', 'rg-quit', '✕');
  quitBtn.setAttribute('aria-label', 'レースを終了');
  quitBtn.addEventListener('click', () => { quitBtn.blur(); if (!ctx.finalized && !ctx.quitOpen) openQuit(ctx); });
  const hint = el(wrap, 'div', 'rg-hint', mode === 'split'
    ? 'P1: WASD + L-Shift　P2: 矢印 + R-Shift　Esc: 終了　M: 音'
    : 'WASD/矢印: 運転　Space: 能力　R: コースに戻る　Esc: 終了　M: 音');
  ctx.timers.push(setTimeout(() => hint.classList.add('off'), 7000));

  listen(ctx, window, 'keydown', e => onKey(ctx, e, true));
  listen(ctx, window, 'keyup', e => onKey(ctx, e, false));
  listen(ctx, window, 'blur', () => ctx.keys.clear());
  listen(ctx, window, 'resize', () => resize(ctx));
  // hidden tab: RAF stops but the AudioContext would keep droning the last engine/skid levels
  listen(ctx, document, 'visibilitychange', () => {
    if (document.hidden) { ctx.audio?.ac.suspend().catch(() => {}); netReady(ctx); } else ctx.audio?.resume();
  });
  applyQuality(ctx);
  resize(ctx);
  // link every program now (parallel where the driver can) instead of one by one as the countdown camera swings round.
  // auto: the other shadow setup (on <-> off) too, so a step mid-race is a program-cache hit, not a main-thread freeze
  try {
    renderer.compile(scene, ctx.views[0].camera);
    if (ctx.auto) {
      const q = ctx.q;
      ctx.q = q === 'low' ? 'medium' : 'low'; applyQuality(ctx); renderer.compile(scene, ctx.views[0].camera);
      ctx.q = q; applyQuality(ctx);
    }
  } catch (e) { console.warn(e); }
  loading.remove();
  ctx.last = performance.now();
  ctx.raf = requestAnimationFrame(t => frame(ctx, t));
  // online: everyone loads at a different speed, so hold the countdown until the host's 'go' (sent once all are ready).
  // 'ready' goes out from frame() once the first frames are drawn: the first render blocks the main thread for
  // shader linking / texture upload (0.3 s on a desktop, seconds on a cold cache), and a 'go' handled after that
  // stall started this player's countdown that much after everyone else's. A hidden tab draws nothing, so nothing can stall.
  if (race.net) {
    ctx.holdStart = true;
    if (document.hidden) netReady(ctx);
  }
}

function netReady(ctx) {
  if (!ctx.holdStart || ctx.readySent) return;
  ctx.readySent = true;
  try { ctx.race.net.ready?.(); } catch (e) { console.warn(e); }
}

export function stopRace() {
  const ctx = R;
  if (!ctx) return;
  R = null;
  ctx.dead = true;
  if (window.__race === ctx) window.__race = null;
  cancelAnimationFrame(ctx.raf);
  ctx.timers.forEach(clearTimeout);
  for (const [t, ev, fn] of ctx.listeners) t.removeEventListener(ev, fn);
  for (const off of ctx.offs) { try { off(); } catch { /* ignore */ } }
  try { if (ctx.race) clearAbilities(ctx.race); } catch (e) { console.warn(e); }
  try { ctx.audio?.close(); } catch { /* ignore */ }
  // Whole scene, not just the world: car / ghost meshes share carmodel.js's cached GLB geometry and textures, whose
  // per-renderer 'dispose' listeners would otherwise keep every old renderer alive (shared ones just re-upload).
  (ctx.scene || ctx.world).traverse(o => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
      for (const u of Object.values(m.uniforms || {})) if (u?.value?.isTexture) u.value.dispose();   // theme shaders
      m.dispose();
    }
    if (o.isInstancedMesh || o.isLight) o.dispose();   // instance buffers, shadow maps
  });
  if (ctx.scene?.background?.isTexture) ctx.scene.background.dispose();
  try { ctx.ghost?.dispose?.(); } catch (e) { console.warn(e); }
  for (const p of ctx.fx) { p.points.geometry.dispose(); p.points.material.dispose(); }
  ctx.skids?.mesh.geometry.dispose();
  ctx.envRT?.dispose();
  if (ctx.renderer) { ctx.renderer.dispose(); ctx.renderer.forceContextLoss(); }
  ctx.wrap?.remove();
  ctx.style?.remove();
  if (ctx.restorePos !== undefined) ctx.root.style.position = ctx.restorePos;
}

// ======================================================================================
// Entries / cars
// ======================================================================================
function buildEntries(opts, mode) {
  const players = (opts.players || []).map(p => ({
    ...p,
    look: { body: CAR_BY_ID[p.carId]?.color || '#ffffff', wheel: '#222222', wing: false, ...(p.look || {}) },
    stats: p.stats || computeStats(p.carId, []),
  }));
  if (mode !== 'solo') return { list: players, grid: players };
  const names = CPU_NAMES.slice().sort(() => Math.random() - 0.5);
  const cpus = [];
  for (let i = 0; i < (opts.cpuCount ?? 3); i++) {
    const def = CARS[Math.floor(Math.random() * CARS.length)];
    const nodes = [];
    for (const br of SKILL_TREE) {
      let k = Math.floor(Math.random() * 4);
      if (k === 3 && Math.random() < 0.3) k = 4;
      nodes.push(...br.nodes.slice(0, k).map(n => n.id));
    }
    let body = def.color;
    if (players.some(p => p.carId === def.id)) {
      // a hue shift does nothing to white / grey / cream paint: give those a vivid colour instead
      // (HSV saturation of the sRGB paint, as carmodel's repaint judges it; HSL calls pale cream saturated)
      const c = new THREE.Color(def.color), { r, g, b } = c.getRGB({}, THREE.SRGBColorSpace);
      body = '#' + (1 - Math.min(r, g, b) / Math.max(r, g, b, 1e-6) < 0.25 ? c.setHSL(Math.random(), 0.8, 0.5) : c.offsetHSL(0.5, 0, 0)).getHexString();
    }
    cpus.push({ name: 'CPU ' + names[i % names.length], carId: def.id, look: { body, wheel: '#222222', wing: Math.random() < 0.3 }, stats: computeStats(def.id, nodes), control: 'cpu' });
  }
  return { list: [...players, ...cpus], grid: [...cpus, ...players] };  // solo: player starts at the back
}

function makeCar(index, e, mesh) {
  mesh.rotation.order = 'YXZ';
  return {
    index, name: e.name || 'Player', carId: e.carId, def: CAR_BY_ID[e.carId], stats: e.stats, look: e.look,
    control: e.control, pid: e.pid ?? null, mesh,
    pos: new THREE.Vector3(), heading: 0, speed: 0, vel: new THREE.Vector3(),
    input: { throttle: 0, brake: 0, steer: 0, ability: false },
    drifting: false, offroad: false, lap: 0, progress: 0, trackIndex: 0,
    finished: false, finishTime: null, bestLap: null,
    mods: { ...MODS0 }, spin: 0, ability: null,
    _: {
      h: 0, s: 0, yaw: 0, steerS: 0, drift: false, driftDir: 0, driftT: 0, turbo: 0, slip: 0, rubber: 1,
      skill: e.control === 'cpu' ? 0.95 + Math.random() * 0.05 : 1,
      t: 0, prevT: null, crossings: 0, halfway: true, lapStart: 0, lastLap: null, pitch: 0, acc: 0, rollS: 0,
      spinVis: 0, spinTot: 0, lastSpin: 0, spinSteer: 0, spinSteerT: 0,
      lane: 0, laneTarget: 0, laneT: 0, stuck: 0, abilDelay: null, wrong: 0, net: null, off: newOffset(), left: false,
    },
  };
}

// night: glowing head / tail lamps on every car; a real headlight only on local cars (scene light budget)
function carLights(ctx, car) {
  const box = new THREE.Box3().setFromObject(car.mesh), size = box.getSize(new THREE.Vector3());
  if (!ctx.lampMats) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const map = new THREE.CanvasTexture(c);
    const mat = color => new THREE.MeshBasicMaterial({ map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    ctx.lampGeo = new THREE.PlaneGeometry(1, 0.55);
    ctx.lampMats = [mat(0xfff4dd), mat(0xff2030)];
  }
  const y = box.min.y + size.y * 0.4, x = size.x * 0.3;
  for (const [z, mat, rot, sc] of [[box.max.z + 0.03, ctx.lampMats[0], 0, 0.8], [box.min.z - 0.03, ctx.lampMats[1], Math.PI, 0.6]]) {
    for (const sx of [1, -1]) {
      const m = new THREE.Mesh(ctx.lampGeo, mat);
      m.position.set(sx * x, y, z); m.rotation.y = rot; m.scale.setScalar(sc);
      car.mesh.add(m);
    }
  }
  if (!isLocal(car)) return;
  const spot = new THREE.SpotLight(0xfff1d6, 45, 110, 0.5, 0.6, 1);
  spot.position.set(0, y + 0.2, box.max.z - 0.4);
  spot.target.position.set(0, -1.5, box.max.z + 24);
  car.mesh.add(spot, spot.target);
}

// soft dark quad under the car, shown only while real shadows are off (quality 'low')
function blobShadow(ctx, car) {
  if (!ctx.blobMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    ctx.blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ctx.blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  }
  const size = new THREE.Box3().setFromObject(car.mesh).getSize(new THREE.Vector3());
  const m = car.blob = new THREE.Mesh(ctx.blobGeo, ctx.blobMat);
  m.scale.set(size.x * 1.3, 1, size.z * 1.15);
  m.position.y = 0.05;
  m.visible = false;
  car.mesh.add(m);
}

function applyQuality(ctx) {
  const Q = QUALITY[ctx.q], r = ctx.renderer, sun = ctx.sun, dpr = window.devicePixelRatio || 1, sh = Q.shadow > 0;
  let pr = Math.min(dpr, Q.pr);
  if (ctx.q === 'low' && dpr >= 2 && window.innerWidth >= 1400) pr = 0.8;
  if (ctx.views.length > 1 && ctx.q !== 'high') pr = Math.min(pr, 1);   // split screen draws everything twice
  if (ctx.prCut) pr = Math.min(pr, 0.7);                                // auto: still slow at 'low'
  r.setPixelRatio(ctx.race.pixelRatio = pr);   // race.pixelRatio: abilities.js sizes its point sprites with it
  // together: the sun's castShadow is in three's lights hash, so every lit material picks its program for the new
  // shadow setup by itself (a cache hit after setup's prewarm; unlit ones never sample shadows and keep theirs)
  r.shadowMap.enabled = sun.castShadow = sh;
  if (sh && sun.shadow.mapSize.x !== Q.shadow) { sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  for (const car of ctx.race.cars) if (car.blob) car.blob.visible = !sh;
  for (const p of ctx.fx) p.keep = Q.fx;
  ctx.skids.limit(Q.fx);
  ctx.worldFx?.setQuality?.({ level: ctx.q, inst: Q.inst, far: Q.far });
}

// auto: median of real frame intervals (rAF timestamps) per window: 2 s during the countdown (the first step lands
// before GO), else 3 s. Ignores the first 1 s, 1 s after each change and gaps > 250 ms (tab switches).
// > 20 ms: one step down. Still slow at the bottom: the steps bought no frames (30 Hz rAF cap in iOS Low Power Mode /
// Chrome Energy Saver, or CPU-bound), so back to the highest step that was as fast, and no lower this page session.
// 5 windows < 11 ms (> 60 Hz screens): one step up, once per race; if that step turns out slow, it is the session's ceiling.
function autoQuality(ctx, now) {
  const a = ctx.aq ||= { t0: now - 1000, prev: now, iv: [], sum: 0, fast: 0, up: null, med: [] };
  const d = now - a.prev;
  a.prev = now;
  if (now - a.t0 < 2000 || d > 250) return;
  a.iv.push(d);
  if ((a.sum += d) < (ctx.race.state === 'countdown' ? 2000 : 3000)) return;
  const med = a.iv.sort((x, y) => x - y)[a.iv.length >> 1], s = ctx.prCut ? 0 : LEVELS.indexOf(ctx.q) + 1;
  a.iv.length = 0; a.sum = 0;
  a.med[s] = med;
  let to = s;
  if (med > 20) {
    a.fast = 0;
    if (a.up === s) autoMax = s - 1;
    if (s > autoMin) to = s - 1;
    else {
      const best = Math.min(...a.med.filter(Boolean));
      for (let k = 3; k > s; k--) if (a.med[k] <= best * 1.12) { to = autoMin = k; break; }
    }
  } else if (med < 11 && s < autoMax && !a.up) { if (++a.fast >= 5) a.up = to = s + 1; }
  else a.fast = 0;
  if (to === s) return;
  const q = ctx.q;
  ctx.q = autoLevel = LEVELS[Math.max(0, to - 1)];
  ctx.prCut = to === 0;
  applyQuality(ctx);
  a.t0 = now - 1000;
  if (ctx.q === q) return;
  const e = el(ctx.wrap, 'div', 'rg-qtoast', `画質を自動調整: ${LEVEL_JA[ctx.q]}`);
  ctx.timers.push(setTimeout(() => e.remove(), 2600));
}

function gridSlot(tr, slot) {
  const back = 9 + Math.floor(slot / 2) * 8.5 + (slot % 2) * 4;
  const idx = ((Math.round((1 - back / tr.length) * tr.N) % tr.N) + tr.N) % tr.N, s = tr.samples[idx];
  return { idx, s, pos: s.pos.clone().addScaledVector(s.right, (slot % 2 ? -1 : 1) * 3.6) };
}

// ghost mode: start from the slot the ghost's run started from (solo puts the player behind the CPUs)
function ghostSlot(tr, frame) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < 8; k++) { const p = gridSlot(tr, k).pos, d = (p.x - frame[0]) ** 2 + (p.z - frame[2]) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}

function placeOnGrid(ctx, car, slot) {
  const { idx, s, pos } = gridSlot(ctx.track, slot);
  car.pos.copy(pos);
  car.heading = Math.atan2(s.tan.x, s.tan.z);
  car.vel.set(0, 0, 0);
  car.speed = 0;
  car.trackIndex = idx;
  Object.assign(car._, { h: car.heading, s: 0, t: s.t, prevT: s.t, pitch: Math.asin(clamp(s.tan.y, -1, 1)) });
  car.progress = -1 + s.t;
  car.mesh.position.copy(car.pos);
  car.mesh.rotation.set(-car._.pitch, car.heading, 0);
}

function respawn(ctx, car) {
  const tr = ctx.track, n = tr.nearest(car.pos, car.trackIndex), s = tr.samples[n.index];
  car.pos.copy(s.pos).addScaledVector(s.right, clamp(n.lateral, -(tr.width / 2 - 2), tr.width / 2 - 2));
  car.heading = Math.atan2(s.tan.x, s.tan.z);
  car.vel.set(0, 0, 0);
  car.speed = 0;
  car.spin = 0;
  Object.assign(car._, { h: car.heading, s: 0, yaw: 0, drift: false, stuck: 0 });
  const v = ctx.viewByCar?.get(car);
  if (v) flashView(v, 'コースに復帰', '#9fe8ff');
}

// ======================================================================================
// Track
// ======================================================================================
function buildTrack(def) {
  const curve = new THREE.CatmullRomCurve3(def.points.map(p => new THREE.Vector3(p[0], p[1], p[2])), true, 'centripetal');
  curve.arcLengthDivisions = 4000;
  const length = curve.getLength();
  const N = 1200, spacing = length / N, samples = [];
  for (let i = 0; i < N; i++) {
    const t = i / N, pos = curve.getPointAt(t), tan = curve.getTangentAt(t).normalize();
    samples.push({ pos, tan, t, right: new THREE.Vector3(-tan.z, 0, tan.x).normalize(), curv: 0 });
  }
  for (let i = 0; i < N; i++) {
    const a = samples[(i - 3 + N) % N].tan, b = samples[(i + 3) % N].tan;
    samples[i].curv = wrapAngle(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)) / (6 * spacing);   // + = turning left
  }
  function nearest(pos, hint) {
    let best = 0, bd = Infinity;
    const scan = (a, b) => {
      for (let j = a; j <= b; j++) {
        const i = ((j % N) + N) % N, p = samples[i].pos, d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    };
    if (Number.isInteger(hint) && hint >= 0) scan(hint - 80, hint + 80);
    if (bd > 900) { bd = Infinity; scan(0, N - 1); }
    const s = samples[best], dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const along = dx * s.tan.x + dz * s.tan.z, lateral = dx * s.right.x + dz * s.right.z;
    return {
      index: best, t: wrap01((best + along / spacing) / N), point: s.pos.clone().addScaledVector(s.tan, along),
      tangent: s.tan.clone(), lateral, dist: Math.abs(lateral),
    };
  }
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const { pos: p } of samples) {
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
  }
  return {
    curve, length, samples, N, spacing, nearest, bounds, def,
    width: def.width, laps: def.laps || 3, grip: def.grip || 1,
    wall: def.width / 2 + (def.wallGap ?? 9.4),   // physical barrier (lateral m); street circuits set a tight wallGap
    pointAt: t => curve.getPointAt(wrap01(t)),
    tangentAt: t => curve.getTangentAt(wrap01(t)).normalize(),
  };
}

// ======================================================================================
// Effects: particles, skid marks, audio
// ======================================================================================
class Particles {
  constructor(ctx, max, additive) {
    this.max = max; this.i = 0; this.keep = 1; this.live = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = psize * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
        gl_FragColor = vec4(vC.rgb, vC.a * smoothstep(0.5, 0.05, r)); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    ctx.scene.add(this.points);
    ctx.fx.push(this);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, grav = 0, drag = 0) {
    if (this.keep < 1 && Math.random() > this.keep) return;   // quality: fewer particles
    const i = this.i; this.i = (i + 1) % this.max;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.col.set([r, g, b, a], i * 4);
    this.life[i] = this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a; this.grav[i] = grav; this.drag[i] = drag;
    this.size[i] = s0;
  }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.size[i]) this.size[i] = 0; continue; }
      live++;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      const k = 1 - this.life[i] / this.maxLife[i], j = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.vel[j] *= dr; this.vel[j + 1] = this.vel[j + 1] * dr - this.grav[i] * dt; this.vel[j + 2] *= dr;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = lerp(this.s0[i], this.s1[i], k);
      this.col[i * 4 + 3] = this.a0[i] * (1 - k) * Math.min(1, k * 8 + 0.3);
    }
    if (!live && !this.live) return;   // nothing alive: skip the buffer upload
    this.live = live;
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.psize.needsUpdate = true;
  }
}

class Skids {
  constructor(ctx, max) {
    this.max = this.lim = max; this.n = 0; this.i = 0; this.last = new Map();
    this.pos = new Float32Array(max * 12);
    const idx = new Uint32Array(max * 6);
    for (let q = 0; q < max; q++) idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x101010, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    ctx.scene.add(this.mesh);
  }
  add(key, x, y, z, rx, rz) {
    const prev = this.last.get(key);
    if (prev) {
      const d2 = (prev[6] - x) ** 2 + (prev[8] - z) ** 2;
      if (d2 < 0.09) return;
      if (d2 < 16) {
        const q = this.i; this.i = (q + 1) % this.lim; this.n = Math.min(this.n + 1, this.lim);
        const w = 0.14;
        this.pos.set([prev[0], prev[1], prev[2], prev[3], prev[4], prev[5], x + rx * w, y, z + rz * w, x - rx * w, y, z - rz * w], q * 12);
        this.mesh.geometry.attributes.position.needsUpdate = true;
        this.mesh.geometry.setDrawRange(0, this.n * 6);
      }
    }
    this.last.set(key, [x - rx * 0.14, y, z - rz * 0.14, x + rx * 0.14, y, z + rz * 0.14, x, y, z]);
  }
  cut(key) { this.last.delete(key); }
  limit(k) {   // quality: keep only the newest k share of the marks
    this.lim = Math.max(1, Math.round(this.max * k));
    if (this.i >= this.lim) this.i = 0;
    this.n = Math.min(this.n, this.lim);
    this.mesh.geometry.setDrawRange(0, this.n * 6);
  }
}

function makeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  let ac;
  try { ac = new AC(); } catch { return null; }
  const master = ac.createGain();
  master.gain.value = 0.4;
  master.connect(ac.destination);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return {
    ac, muted: false,
    engine() {
      const g = ac.createGain(); g.gain.value = 0; g.connect(master);
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 4; f.connect(g);
      const o1 = ac.createOscillator(); o1.type = 'sawtooth'; o1.connect(f); o1.start();
      const o2 = ac.createOscillator(); o2.type = 'square';
      const g2 = ac.createGain(); g2.gain.value = 0.35; o2.connect(g2); g2.connect(f); o2.start();
      const n = ac.createBufferSource(); n.buffer = noise; n.loop = true;
      const nf = ac.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2300; nf.Q.value = 1.4;
      const ng = ac.createGain(); ng.gain.value = 0;
      n.connect(nf); nf.connect(ng); ng.connect(master); n.start();
      return {
        set(freq, vol, skid) {
          const t = ac.currentTime;
          o1.frequency.setTargetAtTime(freq, t, 0.04);
          o2.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
          f.frequency.setTargetAtTime(250 + freq * 6, t, 0.05);
          g.gain.setTargetAtTime(vol, t, 0.08);
          ng.gain.setTargetAtTime(skid, t, 0.06);
        },
      };
    },
    beep(freq, dur = 0.2, vol = 0.22) {
      const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    },
    hit(v) {
      const t = ac.currentTime, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; f.type = 'lowpass'; f.frequency.value = 500;
      g.gain.setValueAtTime(Math.min(0.6, v), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 0.35);
    },
    toggle() { this.muted = !this.muted; master.gain.value = this.muted ? 0 : 0.4; return this.muted; },
    resume() { if (ac.state === 'suspended') ac.resume().catch(() => {}); },
    close() { ac.close().catch(() => {}); },
  };
}

// ======================================================================================
// Views / HUD
// ======================================================================================
function el(parent, tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

function makeView(ctx, car, keys, idx, total) {
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3000);
  const f = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
  const camPos = car.pos.clone().addScaledVector(f, -12).add(new THREE.Vector3(0, 5, 0));
  camera.position.copy(camPos);
  const d = el(ctx.wrap, 'div', 'rg-vp' + (total > 1 ? ' small' : ''));
  d.style.top = (idx * 100 / total) + '%';
  d.style.height = (100 / total) + '%';
  d.innerHTML = `<div class="rg-vig"></div><div class="rg-tints"></div><div class="rg-labels"></div>
    <div class="rg-tl"><div class="rg-pos"></div><div class="rg-lap"></div>${total > 1 ? `<div class="rg-who">P${idx + 1}　${esc(car.name)}</div>` : ''}</div>
    <div class="rg-tr"><div class="rg-time">0:00.00</div><div class="rg-sub rg-cur"></div><div class="rg-sub rg-best"></div><div class="rg-ghost"></div></div>
    <div class="rg-tags"><span class="rg-tag slip">スリップストリーム</span><span class="rg-tag drift">ドリフト</span><span class="rg-tag turbo">ブースト!</span><span class="rg-tag wrong">逆走中!</span></div>
    <div class="rg-center"><div class="rg-count"></div><div class="rg-flash"></div><div class="rg-msg"></div></div>
    <div class="rg-speed"><svg viewBox="0 0 200 200"><defs><linearGradient id="rgg${idx}" x1="0" x2="1"><stop offset="0" stop-color="#29d8ff"/><stop offset="0.6" stop-color="#b04dff"/><stop offset="1" stop-color="#ff4d6d"/></linearGradient></defs>
      <path d="M43.4 156.6 A80 80 0 1 1 156.6 156.6" class="rg-arc-bg"/><path d="M43.4 156.6 A80 80 0 1 1 156.6 156.6" class="rg-arc" pathLength="100" stroke="url(#rgg${idx})"/></svg>
      <div class="rg-kmh"><b>0</b><span>km/h</span></div></div>
    <div class="rg-abil"><div class="rg-abil-top"><span class="rg-abil-name"></span><span class="rg-abil-key">${keys.label}</span></div><div class="rg-bar"><i></i></div><div class="rg-ready">READY!</div></div>
    <canvas class="rg-map"></canvas>`;
  const q = s => d.querySelector(s);
  const map = q('.rg-map');
  map.width = map.height = Math.round(180 * Math.min(window.devicePixelRatio || 1, 2));
  return {
    car, keys, camera, camPos, camH: car.heading, fov: 62, shake: 0, tmp: new THREE.Vector3(),
    engine: ctx.audio?.engine(),
    hud: {
      root: d, pos: q('.rg-pos'), lap: q('.rg-lap'), time: q('.rg-time'), cur: q('.rg-cur'), best: q('.rg-best'), ghost: q('.rg-ghost'),
      count: q('.rg-count'), flash: q('.rg-flash'), msg: q('.rg-msg'), kmh: q('.rg-kmh b'), arc: q('.rg-arc'),
      abil: q('.rg-abil'), abilName: q('.rg-abil-name'), bar: q('.rg-bar i'), ready: q('.rg-ready'), map,
      slip: q('.rg-tag.slip'), drift: q('.rg-tag.drift'), turbo: q('.rg-tag.turbo'), wrong: q('.rg-tag.wrong'), vig: q('.rg-vig'), tints: q('.rg-tints'),
      labels: q('.rg-labels'), labelEls: new Map(),
    },
  };
}

function setText(e, s) { if (e._t !== s) { e._t = s; e.textContent = s; } }
function setHtml(e, s) { if (e._h !== s) { e._h = s; e.innerHTML = s; } }
function setCls(e, c, on) { if (!!e['_' + c] !== on) { e['_' + c] = on; e.classList.toggle(c, on); } }
function setStyle(e, k, v) { if (e['_s' + k] !== v) { e['_s' + k] = v; e.style[k] = v; } }

function pop(e, text, color) {
  e.textContent = text;
  e.style.color = color || '';
  e.classList.remove('go');
  void e.offsetWidth;
  e.classList.add('go');
}
function flashView(v, text, color) { pop(v.hud.flash, text, color); }
function flashAll(ctx, text, color) { for (const v of ctx.views) flashView(v, text, color); }

function buildMapBase(ctx) {
  const { minX, maxX, minZ, maxZ } = ctx.track.bounds, S = ctx.views[0]?.hud.map.width || 180, pad = S * 0.09;
  const sc = (S - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (S - (maxX - minX) * sc) / 2, oy = (S - (maxZ - minZ) * sc) / 2;
  ctx.mapProj = (x, z) => [ox + (maxX - x) * sc, oy + (maxZ - z) * sc];
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const path = () => { g.beginPath(); ctx.track.samples.forEach((s, i) => { if (i % 3) return; const [x, y] = ctx.mapProj(s.pos.x, s.pos.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
  g.lineJoin = 'round';
  path(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = S * 0.06; g.stroke();
  path(); g.strokeStyle = '#2a3140'; g.lineWidth = S * 0.04; g.stroke();
  const s0 = ctx.track.samples[0], [x0, y0] = ctx.mapProj(s0.pos.x, s0.pos.z);
  g.fillStyle = '#ffd23f'; g.fillRect(x0 - S * 0.035, y0 - S * 0.008, S * 0.07, S * 0.016);
  ctx.mapBase = c;
}

function drawMap(ctx, v) {
  const cv = v.hud.map, g = cv.getContext('2d'), S = cv.width;
  g.clearRect(0, 0, S, S);
  g.drawImage(ctx.mapBase, 0, 0, S, S);
  const dot = (x, z, r, fill, stroke) => {
    const [px, py] = ctx.mapProj(x, z);
    g.beginPath(); g.arc(px, py, r * S / 180, 0, TAU);
    g.fillStyle = fill; g.fill();
    g.lineWidth = 2 * S / 180; g.strokeStyle = stroke; g.stroke();
  };
  const gm = ctx.ghost?.mesh;
  if (gm) dot(gm.position.x, gm.position.z, 4.5, 'rgba(180,230,255,0.45)', 'rgba(255,255,255,0.6)');
  for (const car of ctx.race.cars) if (car !== v.car && !car._.left) dot(car.pos.x, car.pos.z, 4.5, car.look.body, '#111');
  dot(v.car.pos.x, v.car.pos.z, 6.5, v.car.look.body, '#fff');
}

function updateHud(ctx, v) {
  const race = ctx.race, car = v.car, h = v.hud, c = car._;
  const active = race.cars.filter(x => !x._.left);
  if (active.length > 1) setHtml(h.pos, `${ctx.order.indexOf(car) + 1}<small>位 / ${active.length}</small>`);
  else setHtml(h.pos, '');
  setHtml(h.lap, `LAP <b>${Math.min(car.lap + 1, race.track.laps)}</b>/${race.track.laps}`);
  const t = race.state === 'countdown' ? 0 : car.finished ? car.finishTime : race.time;
  setText(h.time, fmtTime(t));
  setText(h.cur, car.finished ? `ラスト ${fmtTime(c.lastLap)}` : `ラップ ${fmtTime(race.state === 'countdown' ? 0 : race.time - c.lapStart)}`);
  setText(h.best, `ベスト ${fmtTime(car.bestLap)}`);
  let gtxt = '', gcol = '';
  if (ctx.ghost && car.control === 'p1' && race.state !== 'countdown' && car.progress > 0.01) {
    let diff = null;
    if (car.finished && ctx.ghostData?.time) diff = car.finishTime - ctx.ghostData.time;
    else { const gt = ctx.ghost.timeAtProgress(car.progress); if (gt != null) diff = race.time - gt; }
    if (diff != null) { gtxt = `ゴースト差 ${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}秒`; gcol = diff > 0 ? '#ff7676' : '#5dffb0'; }
  }
  setText(h.ghost, gtxt);
  setStyle(h.ghost, 'color', gcol);
  const kmh = Math.round(Math.abs(car.speed) * 3.6);
  setText(h.kmh, String(kmh));
  setStyle(h.arc, 'strokeDashoffset', String(Math.round(100 - Math.min(1, kmh / 320) * 100)));
  const ab = car.ability;
  if (ab) {
    const def = ABILITIES[ab.id];
    setText(h.abilName, def ? def.name : String(ab.id));
    const g = clamp(ab.gauge || 0, 0, 1), on = (ab.active || 0) > 0, sealed = !!ab.sealed && !on;
    setStyle(h.bar, 'width', (on ? 100 : Math.round(g * 100)) + '%');
    setCls(h.abil, 'ready', g >= 1 && !on && !sealed);
    setCls(h.abil, 'active', on);
    setCls(h.abil, 'sealed', sealed);
    setText(h.ready, on ? '発動中!' : sealed ? '封印中' : g >= 1 ? 'READY!' : '');
  }
  const boosting = car.mods.speedMul > 1.02 || car.mods.accelMul > 1.02;
  setCls(h.slip, 'on', c.slip > 0.02);
  setCls(h.drift, 'on', car.drifting && c.driftT > 0.35);
  setCls(h.turbo, 'on', c.turbo > 0);
  setCls(h.wrong, 'on', c.wrong > 1.2 && !car.finished);
  setStyle(h.vig, 'opacity', boosting || c.turbo > 0 ? '1' : '0');
  if (car.finished && !v.finishShown) {
    v.finishShown = true;
    const place = ctx.order.indexOf(car) + 1;
    setHtml(h.msg, `<div class="rg-goal">ゴール!</div>${active.length > 1 ? `<div class="rg-place">${place}位</div>` : ''}<div class="rg-ftime">${fmtTime(car.finishTime)}</div>${ctx.mode === 'online' && !ctx.finalized ? '<div class="rg-wait">他のプレイヤーのゴールを待っています…</div>' : ''}`);
  }
  drawMap(ctx, v);
  updateLabels(ctx, v);
  if (ctx.linkEl && v === ctx.views[0] && ctx.clock - (ctx.linkAt ?? -9) > 0.5) { ctx.linkAt = ctx.clock; updateLink(ctx); }
}

// online: per opponent '直結 45ms' (WebRTC data channel) or '中継 180ms' (MQTT broker relay)
function updateLink(ctx) {
  const race = ctx.race;
  let info = null;
  try { info = race.net.linkInfo?.() || null; } catch { /* older session: MQTT only */ }
  const rows = race.cars.filter(c => c.control === 'net' && !c._.left).map(car => {
    const li = info?.[car.pid] || { p2p: false, lat: null };   // net.js label: '直結 45ms' / '中継 (旧版) ~' ...
    const lat = Number.isFinite(li.lat) ? Math.round(li.lat) : null;
    const col = lat != null && lat > 250 ? '#ff7676' : li.p2p ? '#5dffb0' : '#ffd23f';
    return `<div><i style="background:${esc(car.look.body)}"></i>${esc(car.name)} <b style="color:${col}">${esc(li.label ?? `${li.p2p ? '直結' : '中継'} ${lat != null ? `${lat}ms` : '~'}`)}</b></div>`;
  });
  setHtml(ctx.linkEl, rows.join(''));
}

const _proj = new THREE.Vector3();
function updateLabels(ctx, v) {
  const lab = v.hud.labels, rect = { width: ctx.W, height: ctx.H / ctx.views.length };
  for (const car of ctx.race.cars) {
    let e = v.hud.labelEls.get(car);
    const show = car !== v.car && !car._.left && car.pos.distanceTo(v.car.pos) < 90;
    if (!show) { if (e) setStyle(e, 'display', 'none'); continue; }
    if (!e) { e = el(lab, 'div', 'rg-label', esc(car.name)); e.style.borderColor = car.look.body; v.hud.labelEls.set(car, e); }
    _proj.set(car.pos.x, car.pos.y + 2.3, car.pos.z).project(v.camera);
    if (_proj.z > 1 || Math.abs(_proj.x) > 1.2 || Math.abs(_proj.y) > 1.2) { setStyle(e, 'display', 'none'); continue; }
    setStyle(e, 'display', '');
    e.style.transform = `translate(${((_proj.x + 1) / 2 * rect.width).toFixed(1)}px, ${((1 - _proj.y) / 2 * rect.height).toFixed(1)}px) translate(-50%, -100%)`;
  }
}

function setLamps(ctx, n) {
  // n: 3,2,1 -> red lamps filling up, 0 -> all green, -1 -> off
  ctx.lamps.forEach((m, i) => {
    const lit = n > 0 ? i < [0, 5, 4, 2][n] : n === 0;
    m.emissive.set(!lit ? 0x000000 : n === 0 ? 0x22ff66 : 0xff2020);
    m.color.set(!lit ? 0x220000 : n === 0 ? 0x0a5a1a : 0x5a0000);
  });
}

// ======================================================================================
// Input
// ======================================================================================
function listen(ctx, target, ev, fn) { target.addEventListener(ev, fn); ctx.listeners.push([target, ev, fn]); }

function onKey(ctx, e, down) {
  if (R !== ctx) return;
  if (!down) { ctx.keys.delete(e.code); return; }
  if (ctx.finalized) return;   // results screen belongs to the UI now
  ctx.audio?.resume();
  if (e.code === 'Escape') { e.preventDefault(); if (!e.repeat) ctx.quitOpen ? closeQuit(ctx) : openQuit(ctx); return; }
  if (ctx.quitOpen) {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    // split: Enter is P2's ability key, so only Y confirms
    if (e.code === 'KeyY' || (ctx.mode !== 'split' && (e.code === 'Enter' || e.code === 'NumpadEnter'))) confirmQuit(ctx);
    else if (e.code === 'KeyN') closeQuit(ctx);
    return;
  }
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  ctx.keys.add(e.code);
  if (!e.repeat) ctx.pressed.add(e.code);
  if (e.code === 'KeyM' && !e.repeat && ctx.audio) flashAll(ctx, ctx.audio.toggle() ? 'サウンド OFF' : 'サウンド ON', '#cfe8ff');
}

function openQuit(ctx) {
  ctx.quitOpen = true;
  if (ctx.mode !== 'online') ctx.paused = true;
  ctx.modal.classList.add('on');
}
function closeQuit(ctx) {
  ctx.quitOpen = false;
  ctx.paused = false;
  ctx.last = performance.now();
  ctx.modal.classList.remove('on');
}
function confirmQuit(ctx) {
  const onQuit = ctx.opts.onQuit;
  stopRace();
  try { onQuit?.(); } catch (e) { console.error(e); }
}

function readKeys(ctx, ks, inp) {
  const any = list => list.some(k => ctx.keys.has(k));
  inp.throttle = any(ks.up) ? 1 : 0;
  inp.brake = any(ks.down) ? 1 : 0;
  inp.steer = (any(ks.left) ? 1 : 0) - (any(ks.right) ? 1 : 0);
  inp.ability = ks.ability.some(k => ctx.pressed.has(k));
  return ks.reset.some(k => ctx.pressed.has(k));
}

// ======================================================================================
// CPU AI (also drives local cars after they finish)
// ======================================================================================
function aiInput(ctx, car, dt) {
  const race = ctx.race, tr = race.track, S = tr.samples, N = tr.N, W2 = tr.width / 2, c = car._, inp = car.input;
  const spd = Math.max(0, car.speed), idx = car.trackIndex;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  c.laneT -= dt;
  if (c.laneT <= 0) { c.laneTarget = (Math.random() * 2 - 1) * (W2 - 3.5); c.laneT = 2 + Math.random() * 4; }
  for (const o of race.cars) {
    if (o === car || o._.left) continue;
    const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z, along = dx * fx + dz * fz;
    if (along < 2 || along > 20) continue;
    const lat = -dx * fz + dz * fx;
    if (Math.abs(lat) < 2.6 && o.speed < car.speed + 3) {
      c.laneTarget = clamp(c.lane + (lat > 0 ? -4 : 4), -(W2 - 2), W2 - 2);
      c.laneT = 1.2;
      break;
    }
  }
  c.lane += (c.laneTarget - c.lane) * damp(1.3, dt);
  const ahead = S[(idx + Math.round(35 / tr.spacing)) % N].curv;
  const apex = -Math.sign(ahead) * Math.min(1, Math.abs(ahead) * 70) * (W2 - 3);   // hug the inside of the next corner
  const lane = clamp(c.lane * 0.5 + apex * 0.6, -(W2 - 1.8), W2 - 1.8);
  const look = Math.round((7 + spd * 0.42) / tr.spacing);
  const s = S[(idx + look) % N];
  const tx = s.pos.x + s.right.x * lane, tz = s.pos.z + s.right.z * lane;
  const diff = wrapAngle(Math.atan2(tx - car.pos.x, tz - car.pos.z) - car.heading);
  inp.steer = clamp(diff * 2.4, -1, 1);
  // (mods still hold last frame's abilities here) downforce: no scrub, so the limit is steering, not grip
  const latLimit = (car.mods.downforce ? 0.99 * 1.45 : car.stats.grip * tr.grip) * 36 * 1.3;
  const range = Math.round((25 + spd * 1.8) / tr.spacing);
  let vAllowed = Infinity;
  for (let k = 2; k < range; k += 3) {
    const kap = Math.abs(S[(idx + k) % N].curv) + 1e-4;
    const vi = Math.sqrt(latLimit / kap);
    vAllowed = Math.min(vAllowed, Math.sqrt(vi * vi + 2 * 18 * k * tr.spacing));
  }
  inp.throttle = spd < vAllowed ? 1 : 0.2;
  inp.brake = spd > vAllowed + 3 ? clamp((spd - vAllowed) / 8, 0.2, 1) : 0;
  inp.ability = false;
  if (car.control === 'cpu' && race.state === 'running' && car.ability && car.ability.gauge >= 1 && !(car.ability.active > 0)) {
    if (c.abilDelay == null) c.abilDelay = Math.random() * 4;
    c.abilDelay -= dt;
    if (c.abilDelay <= 0) { inp.ability = true; c.abilDelay = null; }
  }
  if (race.state === 'running' && Math.abs(car.speed) < 2 && car.spin <= 0) c.stuck += dt; else c.stuck = 0;
  if (c.stuck > 2.5) respawn(ctx, car);
}

// ======================================================================================
// Physics
// ======================================================================================
function stepCar(ctx, car, dt) {
  const race = ctx.race, tr = race.track, c = car._, st = car.stats, m = car.mods, inp = car.input, W2 = tr.width / 2;
  if (car.heading !== c.h || car.speed !== c.s) {   // changed from outside (warp etc.) -> rebuild velocity
    car.vel.set(Math.sin(car.heading) * car.speed, 0, Math.cos(car.heading) * car.speed);
  }
  const spinning = car.spin > 0;
  let steerIn = clamp(inp.steer + m.assist * (1 - Math.abs(inp.steer) * 0.7), -1, 1);
  if (spinning) {
    c.spinSteerT -= dt;
    if (c.spinSteerT <= 0) { c.spinSteer = Math.random() * 2 - 1; c.spinSteerT = 0.2; }
    steerIn = c.spinSteer;
  }
  c.steerS += (steerIn - c.steerS) * damp(10, dt);

  let fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let vF = car.vel.x * fx + car.vel.z * fz;
  const vR0 = car.vel.z * fx - car.vel.x * fz;   // sideways speed before this step's steering (bounces, knocks)
  const spd = Math.abs(vF);
  const off = car.offroad && !m.noOffroadPenalty;
  const df = m.downforce || 0;
  const grip = (df ? 0.99 : st.grip * m.gripMul * tr.grip) * (spinning ? 0.2 : 1) * (off ? 0.85 : 1);
  // higher grip keeps more steering authority at speed
  const steerRate = st.steer * Math.min(1, spd / 6) / (1 + spd / (50 * grip)) * (1 + 0.25 * df * Math.min(1, spd / 25));
  let yawT = c.steerS * steerRate * (vF < -0.5 ? -1 : 1);
  if (c.drift && df) endDrift(ctx, car);
  // drift only on purpose: hard steer + brake at speed (keyboard steering is always full lock), the player's own steer
  if (!c.drift && !df && !spinning && vF > 18 && Math.abs(c.steerS) > 0.6 && Math.abs(inp.steer) > 0.6 && inp.brake > 0.3 && car.control !== 'cpu') {
    c.drift = true; c.driftDir = Math.sign(c.steerS); c.driftT = 0;
  }
  if (c.drift) {
    c.driftT += dt;
    yawT = c.driftDir * steerRate * (0.9 + 0.5 * c.steerS * c.driftDir);
    if (vF < 10 || Math.abs(c.steerS) < 0.2 || spinning) endDrift(ctx, car);
  }
  if (spinning) yawT = c.steerS * 3.5;
  c.yaw += (yawT - c.yaw) * damp(c.drift ? 6 : 12, dt);
  car.heading += c.yaw * dt;

  fx = Math.sin(car.heading); fz = Math.cos(car.heading);
  const rx = -fz, rz = fx;
  vF = car.vel.x * fx + car.vel.z * fz;
  let vR = car.vel.x * rx + car.vel.z * rz;
  const prevVF = vF;

  let top = st.top * m.speedMul * c.rubber * c.skill * (1 + c.slip) * (c.turbo > 0 ? 1.1 : 1);
  if (off) top *= st.passive === 'offroad' ? 0.775 : 0.55;
  const acc = st.accel * m.accelMul * (st.passive === 'launch' && race.time < 3 ? 1.3 : 1) * (c.turbo > 0 ? 1.4 : 1);
  const thr = spinning ? 0 : inp.throttle, brk = spinning ? 0 : inp.brake;
  if (thr > 0 && vF > -1) {
    if (vF < top) vF = Math.min(top, vF + acc * thr * Math.max(0, 1 - (Math.max(vF, 0) / top) ** 3) * dt);
  } else if (thr > 0) vF += 30 * thr * dt;
  if (brk > 0) {
    if (vF > 0.5) vF = Math.max(0, vF - 34 * brk * dt);
    else vF = Math.max(-14, vF - acc * 0.6 * brk * dt);
  }
  if (thr === 0 && brk === 0) vF -= Math.sign(vF) * Math.min(Math.abs(vF), (1.4 + 0.025 * Math.abs(vF)) * dt);
  const vCap = m.towV > 0 ? Math.max(top, m.towV) : top;   // a hellchain reel may pull past the car's own top speed
  if (vF > vCap) vF = Math.max(vCap, vF - (vF - vCap) * (off ? 2.4 : 1.3) * dt - 2 * dt);
  if (spinning) vF *= Math.exp(-0.9 * dt);
  if (m.tow > 0 && vF < m.towV) vF = Math.min(m.towV, vF + m.tow * dt);
  if (m.towV > 0 && vF > m.towV) vF -= (vF - m.towV) * 3.5 * dt;   // chain tension: the reel speed eases the owner in, no ramming

  // lateral grip; part of the scrubbed sideways speed is turned forward, never adding energy
  const k = spinning ? 1.2 : c.drift ? 2.5 + 6 * grip : 30 * grip;
  const mag0 = Math.hypot(vF, vR);
  // downforce: on rails — the slip steering creates is all turned forward, but a wall / car bounce still decays
  // as usual (dropping it would steer the car straight back into what it hit)
  vR = (df && !spinning ? vR0 : vR) * Math.exp(-k * dt);
  if (!spinning && vF > 2) {
    const mag1 = Math.hypot(vF, vR), target = mag1 + (mag0 - mag1) * (df ? 1 : c.drift ? 0.9 : 0.75);
    vF = Math.sqrt(Math.max(vF * vF, target * target - vR * vR));
  }
  if (c.drift) vF -= vF * 0.03 * dt;

  car.vel.set(fx * vF + rx * vR, 0, fz * vF + rz * vR);
  car.pos.x += car.vel.x * dt;
  car.pos.z += car.vel.z * dt;
  c.acc += ((vF - prevVF) / Math.max(dt, 1e-4) - c.acc) * damp(6, dt);

  const n = tr.nearest(car.pos, car.trackIndex);
  car.trackIndex = n.index;
  c.t = n.t;
  let lat = n.lateral;
  if (Math.abs(lat) > tr.wall) {
    const sg = Math.sign(lat), s = tr.samples[n.index], push = Math.abs(lat) - tr.wall;
    car.pos.x -= s.right.x * sg * push; car.pos.z -= s.right.z * sg * push;
    lat = sg * tr.wall;
    const out = (car.vel.x * s.right.x + car.vel.z * s.right.z) * sg;
    if (out > 0) {
      car.vel.x -= s.right.x * sg * out * 1.35; car.vel.z -= s.right.z * sg * out * 1.35;
      if (!m.invulnerable) car.vel.multiplyScalar(Math.max(0.55, 1 - out * 0.025));
      const tH = Math.atan2(s.tan.x, s.tan.z) + (Math.cos(car.heading - Math.atan2(s.tan.x, s.tan.z)) < 0 ? Math.PI : 0);
      car.heading += wrapAngle(tH - car.heading) * Math.min(0.35, out * 0.04);
      if (out > 3) impact(ctx, car.pos.x + s.right.x * sg, car.pos.y + 0.5, car.pos.z + s.right.z * sg, out, [car]);
    }
  }
  car.offroad = Math.abs(lat) > W2;
  car.pos.y = n.point.y - 0.2 * smooth(W2 + 0.5, W2 + 3, Math.abs(lat));
  c.pitch = Math.asin(clamp(n.tangent.y, -1, 1)) * Math.cos(car.heading - Math.atan2(n.tangent.x, n.tangent.z));
  car.drifting = c.drift && Math.abs(vR) > 2;
}

function endDrift(ctx, car) {
  const c = car._;
  c.drift = false;
  if (c.driftT > 1.1 && car.speed > 12) {
    const lvl = Math.min(1, (c.driftT - 1.1) / 2);
    c.turbo = 0.5 + lvl * 0.7;
    const f = 2 + lvl * 2;
    car.vel.x += Math.sin(car.heading) * f; car.vel.z += Math.cos(car.heading) * f;
    const col = lvl > 0.5 ? [1, 0.55, 0.15] : [0.3, 0.7, 1];
    for (let i = 0; i < 26; i++) ctx.glow.spawn(car.pos.x, car.pos.y + 0.4, car.pos.z, (Math.random() - 0.5) * 8, Math.random() * 4, (Math.random() - 0.5) * 8, 0.45, 0.7, 0.1, ...col, 1, 6, 2);
    const v = ctx.viewByCar.get(car);
    if (v) { v.shake = Math.max(v.shake, 0.12); ctx.audio?.beep(lvl > 0.5 ? 990 : 740, 0.12, 0.12); }
  }
  c.driftT = 0;
}

function settle(car) {
  car.speed = car.vel.x * Math.sin(car.heading) + car.vel.z * Math.cos(car.heading);
  car._.h = car.heading;
  car._.s = car.speed;
}

const NET_STALE = 1;   // s without 'state': the peer is loading, hidden or gone, so its frozen car must not be a wall

function collide(ctx) {
  const cars = ctx.race.cars, now = performance.now() / 1000;
  const solid = c => !c._.left && !c.mods.noCollide && (c.control !== 'net' || now - (c._.net?.t ?? -Infinity) < NET_STALE);
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if ((a.control === 'net' && b.control === 'net') || !solid(a) || !solid(b)) continue;
    if ((b.pos.x - a.pos.x) ** 2 + (b.pos.z - a.pos.z) ** 2 > 30) continue;
    let best = null;
    const afx = Math.sin(a.heading), afz = Math.cos(a.heading), bfx = Math.sin(b.heading), bfz = Math.cos(b.heading);
    for (const oa of [-1.05, 1.05]) for (const ob of [-1.05, 1.05]) {
      const ax = a.pos.x + afx * oa, az = a.pos.z + afz * oa, bx = b.pos.x + bfx * ob, bz = b.pos.z + bfz * ob;
      const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), pen = 2.0 - d;
      if (pen > 0 && (!best || pen > best.pen)) best = { pen, nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, x: (ax + bx) / 2, z: (az + bz) / 2 };
    }
    if (!best) continue;
    const shieldA = a.mods.invulnerable && !b.mods.invulnerable, shieldB = b.mods.invulnerable && !a.mods.invulnerable;
    const ma = a.control === 'net' ? 0 : 1 / (a.stats.mass || 1), mb = b.control === 'net' ? 0 : 1 / (b.stats.mass || 1);
    const ia = shieldA ? 0 : ma, ib = shieldB ? 0 : mb;   // impulse: a shielded car loses no speed
    // Position: a shield shoves the other car aside, but a remote car can't be moved here (its own screen does the
    // shoving), so vs a net car the shielded local car takes the correction instead of driving through it.
    const pa = ia + ib ? ia : ma, pb = ia + ib ? ib : mb;   // never both 0: net-vs-net was skipped above
    const wa = pa / (pa + pb), wb = pb / (pa + pb);
    a.pos.x -= best.nx * best.pen * wa; a.pos.z -= best.nz * best.pen * wa;
    b.pos.x += best.nx * best.pen * wb; b.pos.z += best.nz * best.pen * wb;
    const vrel = (b.vel.x - a.vel.x) * best.nx + (b.vel.z - a.vel.z) * best.nz;
    if (vrel < 0 && ia + ib) {
      const jimp = -1.3 * vrel / (ia + ib);
      a.vel.x -= best.nx * jimp * ia; a.vel.z -= best.nz * jimp * ia;
      b.vel.x += best.nx * jimp * ib; b.vel.z += best.nz * jimp * ib;
      if (-vrel > 2.5) impact(ctx, best.x, (a.pos.y + b.pos.y) / 2 + 0.5, best.z, -vrel, [a, b]);
    }
    robotKnock(ctx.race, a, b);   // robotdash: the robot sends the other car flying
  }
}

function impact(ctx, x, y, z, strength, cars) {
  const n = Math.min(40, 6 + strength * 2);
  for (let i = 0; i < n; i++) {
    ctx.glow.spawn(x, y, z, (Math.random() - 0.5) * 12, Math.random() * 6, (Math.random() - 0.5) * 12, 0.3 + Math.random() * 0.3, 0.35, 0.05, 1, 0.75, 0.3, 1, 14, 1);
  }
  let local = false;
  for (const car of cars) { const v = ctx.viewByCar.get(car); if (v) { v.shake = Math.max(v.shake, Math.min(0.45, strength * 0.03)); local = true; } }
  if (local && (ctx.lastHit || 0) + 0.12 < ctx.clock) { ctx.lastHit = ctx.clock; ctx.audio?.hit(strength * 0.04); }
}

// ======================================================================================
// Laps / progress / results
// ======================================================================================
function updateProgress(ctx, car) {
  const c = car._, t = c.t;
  if (c.prevT == null) c.prevT = t;
  let crossed = false;
  if (c.prevT > 0.75 && t < 0.25) {
    if (c.halfway) { c.crossings++; c.halfway = false; crossed = true; }
  } else if (c.prevT < 0.25 && t > 0.75) { c.crossings--; c.halfway = true; }
  if (t > 0.4 && t < 0.6) c.halfway = true;
  c.prevT = t;
  car.progress = c.crossings - 1 + t;
  if (crossed) lapCross(ctx, car);   // after progress: finishCar's ghost sample must see the finish-line progress
}

function lapCross(ctx, car) {
  const c = car._, race = ctx.race, done = c.crossings - 1, laps = race.track.laps;
  if (done < 1 || done <= car.lap || car.finished) return;
  const lt = race.time - c.lapStart;
  c.lapStart = race.time;
  c.lastLap = lt;
  car.lap = done;
  const newBest = car.bestLap == null || lt < car.bestLap;
  if (newBest) car.bestLap = lt;
  const v = ctx.viewByCar.get(car);
  if (car.lap >= laps) { finishCar(ctx, car); return; }
  if (v) {
    flashView(v, car.lap === laps - 1 ? 'ファイナルラップ!' : `ラップ ${car.lap + 1}`, car.lap === laps - 1 ? '#ffd23f' : '#9fe8ff');
    ctx.audio?.beep(car.lap === laps - 1 ? 880 : 660, 0.25, 0.15);
  }
}

function finishCar(ctx, car) {
  const race = ctx.race;
  car.finished = true;
  car.finishTime = race.time;
  const v = ctx.viewByCar.get(car);
  if (!v) return;
  if (ctx.firstLocalFinish == null) ctx.firstLocalFinish = race.time;
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * TAU, sp = 4 + Math.random() * 8;
    ctx.glow.spawn(car.pos.x, car.pos.y + 3, car.pos.z, Math.cos(a) * sp, 6 + Math.random() * 8, Math.sin(a) * sp, 1.6 + Math.random(), 0.5, 0.3, Math.random(), Math.random(), Math.random(), 1, 9, 1.2);
  }
  if (ctx.audio) [523, 659, 784, 1047].forEach((f, i) => ctx.timers.push(setTimeout(() => ctx.audio?.beep(f, 0.3, 0.16), i * 110)));
  if (car.control === 'p1' && race.net && !ctx.finalized) race.net.send({ t: 'finish', pid: race.localPid, time: r3(car.finishTime) });
  if (car.control === 'p1' && ctx.recorder) {
    try { ctx.recorder.sample(race); ctx.ghostRec = ctx.recorder.finish(car.finishTime); } catch (e) { console.warn('ghost finish failed', e); }
  }
}

const isLocal = car => car.control === 'p1' || car.control === 'p2';

function standings(cars) {
  return cars.slice().sort((a, b) => {
    if (a._.left !== b._.left) return a._.left ? 1 : -1;
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
}

function localPlacements(ctx) {
  const race = ctx.race;
  const list = race.cars.map(car => {
    let time = car.finished ? car.finishTime : null;
    if (time == null && ctx.mode === 'solo' && car.control === 'cpu' && car.progress > 0.05 && race.time > 0) {
      time = race.time + Math.max(0, race.track.laps - car.progress) * (race.time / car.progress);
    }
    return { car, name: car.name, carId: car.carId, time: time == null ? null : r2(time), isLocal: isLocal(car), control: car.control };
  });
  return list.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
}

function finalize(ctx, placements) {
  if (ctx.finalized) return;
  ctx.finalized = true;
  const race = ctx.race;
  race.state = 'finished';
  placements = placements || localPlacements(ctx);
  const p1 = race.cars.find(c => c.control === 'p1');
  const gd = ctx.ghostData;
  const beatGhost = ctx.mode === 'ghost' && gd && gd.time ? !!(p1?.finished && p1.finishTime < gd.time) : null;
  const result = {
    mode: ctx.mode,
    trackId: race.def.id,
    placements: placements.map(({ car, ...rest }) => rest),
    locals: race.cars.filter(isLocal).map(car => {
      const i = placements.findIndex(p => p.car === car);
      // ghost mode races the ghost: 1st only when it was beaten (else every time trial would pay the win prize)
      const place = beatGhost != null ? (beatGhost ? 1 : 2) : i < 0 ? placements.length : i + 1;
      return { control: car.control, carId: car.carId, place, time: car.finished ? r2(car.finishTime) : null, bestLap: car.bestLap == null ? null : r2(car.bestLap) };
    }),
    ghostRecording: (ctx.mode === 'solo' || ctx.mode === 'ghost') && p1?.finished ? (ctx.ghostRec || null) : null,
    beatGhost,
  };
  for (const v of ctx.views) {
    if (!v.car.finished) setHtml(v.hud.msg, '<div class="rg-goal dnf">タイムアップ</div>');
    v.hud.msg.querySelector('.rg-wait')?.remove();
  }
  try { ctx.opts.onFinish?.(result); } catch (e) { console.error(e); }
}

function checkFinalize(ctx) {
  if (ctx.finalized) return;
  const race = ctx.race, locals = race.cars.filter(isLocal);
  if (!locals.some(c => c.finished)) return;
  const allDone = locals.every(c => c.finished);
  const lastT = Math.max(...locals.filter(c => c.finished).map(c => c.finishTime));
  if (ctx.mode === 'online') {
    if (race.time - ctx.firstLocalFinish > 45) finalize(ctx);   // host never answered
  } else if (allDone) {
    if (race.time - lastT > 2.5) finalize(ctx);
  } else if (race.time - ctx.firstLocalFinish > 30) finalize(ctx);  // split: the other player gets DNF
}

// ======================================================================================
// Online
// ======================================================================================
function hookNet(ctx) {
  const race = ctx.race, net = race.net, byPid = new Map(race.cars.filter(c => c.pid != null).map(c => [String(c.pid), c]));
  const on = (type, fn) => { try { const off = net.on(type, fn); if (typeof off === 'function') ctx.offs.push(off); } catch (e) { console.warn(e); } };
  on('state', msg => {
    const car = byPid.get(String(msg.pid));
    if (!car || car.control !== 'net' || car._.left) return;
    const c = car._, now = performance.now() / 1000, prev = c.net;
    const next = netSample(msg, prev, now);
    // pose on screen right now (the grid slot before the first state), kept continuous across the new prediction
    const shown = prev ? applyOffset(predict(prev, ageOf(prev, now)), c.off) : [car.pos.x, car.pos.z, car.heading];
    retarget(c.off, shown, predict(next, ageOf(next, now)));
    c.net = next;
    if (Number.isFinite(msg.lap)) car.lap = msg.lap;
    if (Number.isFinite(msg.p)) car.progress = msg.p;
    if (Number.isFinite(msg.ft) && !car.finished) { car.finished = true; car.finishTime = msg.ft; }
  });
  on('go', () => { if (!ctx.goAt) ctx.goAt = performance.now() + 3900; });   // same 3.9 s lead-in as offline
  on('ability', msg => { if (R === ctx && String(msg.pid) !== String(race.localPid)) applyRemoteAbility(race, msg); });
  on('finish', msg => {
    const car = byPid.get(String(msg.pid));
    if (car && car.control === 'net' && !car.finished) { car.finished = true; car.finishTime = +msg.time || race.time; }
  });
  on('results', msg => {
    const seen = new Set(), list = [];
    for (const p of msg.placements || []) {
      const car = byPid.get(String(p.pid));
      if (!car || seen.has(car)) continue;
      seen.add(car);
      list.push({ car, name: car.name, carId: car.carId, time: p.time == null ? null : r2(p.time), isLocal: car.control === 'p1', control: car.control });
    }
    for (const car of race.cars) if (!seen.has(car)) list.push({ car, name: car.name, carId: car.carId, time: null, isLocal: car.control === 'p1', control: car.control });
    finalize(ctx, list);
  });
  const leave = car => {
    if (!car || car.control !== 'net' || car._.left) return;
    car._.left = true;
    car.mesh.visible = false;
    flashAll(ctx, `${car.name} が退出しました`, '#ffb3b3');
  };
  on('leave', msg => leave(byPid.get(String(msg.pid))));
  // a 'leave' sent while this peer was still loading the race had no listener yet: reconcile with the live roster
  if (Array.isArray(net.roster)) for (const car of byPid.values()) if (!net.roster.some(e => String(e.pid) === String(car.pid))) leave(car);
  on('closed', () => {
    if (R !== ctx || ctx.finalized) return;
    const p1 = race.cars.find(c => c.control === 'p1');
    flashAll(ctx, '接続が切れました', '#ff8080');
    if (p1?.finished) { finalize(ctx); return; }
    ctx.timers.push(setTimeout(() => { if (R === ctx) confirmQuit(ctx); }, 2500));
  });
}

// Remote car shown where it is now (dead reckoning over the link latency, see netpredict.js), not ~0.3 s in the past.
function netPredict(ctx, car, nowS, dt) {
  const c = car._, n = c.net;
  if (!n) return;   // no state yet: stays on its grid slot
  decay(c.off, dt);
  const age = ageOf(n, nowS), [x, z, h] = applyOffset(predict(n, age), c.off);
  car.pos.x = x; car.pos.z = z;
  car.heading = h;
  car.speed = n.s;
  c.yaw = n.w;   // body roll
  car.vel.set(Math.sin(h) * n.s, 0, Math.cos(h) * n.s);
  if (Number.isFinite(n.p)) car.progress = n.p + Math.max(0, n.s) * age / ctx.race.track.length;
}

// ======================================================================================
// Main loop
// ======================================================================================
function frame(ctx, now) {
  if (R !== ctx) return;
  ctx.raf = requestAnimationFrame(t => frame(ctx, t));
  // not behind the results overlay / quit prompt: their full-screen backdrop blur is not race cost
  if (ctx.auto && !ctx.finalized && !ctx.quitOpen) autoQuality(ctx, now);
  // 0.1 s cap (physics substeps at 120 Hz regardless): with 0.05 a device under 20 fps raced in slow motion, and online
  // its car fell behind in real time on everyone else's screen
  const raw = clamp((now - ctx.last) / 1000, 0, 0.1);
  ctx.last = now;
  const dt = ctx.paused ? 0 : raw;
  try { update(ctx, dt); } catch (e) { if (ctx.errors++ < 3) console.error(e); }
  if (R !== ctx) return;
  try { render(ctx); } catch (e) { if (ctx.errors++ < 3) console.error(e); }
  if (ctx.holdStart && !ctx.readySent && (ctx.drawn = (ctx.drawn || 0) + 1) >= 2) netReady(ctx);
}

function update(ctx, dt) {
  const race = ctx.race, cars = race.cars;
  ctx.clock += dt;

  // countdown
  if (race.state === 'countdown') {
    if (!ctx.holdStart) ctx.count -= dt;
    else if (ctx.goAt) ctx.count = (ctx.goAt - performance.now()) / 1000;   // wall clock: frame drops can't desync the start
    else if (ctx.clock - (ctx.waitMsgAt ?? -9) > 2.5) { ctx.waitMsgAt = ctx.clock; flashAll(ctx, '他のプレイヤーを待っています…', '#9fe8ff'); }
    const n = Math.ceil(ctx.count);
    if (n !== ctx.lastCount && n >= 1 && n <= 3) {
      for (const v of ctx.views) pop(v.hud.count, String(n), '#ffffff');
      setLamps(ctx, n);
      ctx.audio?.beep(520, 0.22);
    }
    ctx.lastCount = n;
    if (ctx.count <= 0) {
      race.state = 'running';
      race.time = 0;
      for (const v of ctx.views) pop(v.hud.count, 'GO!', '#5dffb0');
      setLamps(ctx, 0);
      ctx.audio?.beep(1040, 0.6, 0.26);
      ctx.timers.push(setTimeout(() => { if (R === ctx) setLamps(ctx, -1); }, 4000));
    }
  } else race.time += dt;

  // 1) input
  for (const car of cars) {
    const inp = car.input;
    inp.ability = false;
    if (car.control === 'net') continue;
    const v = ctx.viewByCar.get(car);
    if (v && !car.finished) {
      const reset = readKeys(ctx, v.keys, inp);
      if (reset && race.state === 'running' && Math.abs(car.speed) < 30) respawn(ctx, car);
    } else aiInput(ctx, car, dt);
    if (race.state !== 'running') inp.ability = false;
  }
  ctx.pressed.clear();
  if (dt === 0) { ctx.order = standings(cars); updateViews(ctx, 0); return; }

  // 2) mods reset, 3) abilities
  for (const car of cars) Object.assign(car.mods, MODS0);
  if (race.state !== 'countdown') updateAbilities(race, dt);
  if (race.state === 'running') {
    for (const car of cars) if (car.input.ability && car.control !== 'net' && !car.finished) tryActivate(race, car);
  }

  // per-frame modifiers: slipstream, rubber band, timers
  const leadLocal = cars.filter(isLocal).reduce((m, c) => Math.max(m, c.progress), -Infinity);
  for (const car of cars) {
    if (car.control === 'net') continue;
    const c = car._;
    c.turbo = Math.max(0, c.turbo - dt);
    let slip = 0;
    if ((car.stats.slipstream || car.stats.passive === 'draft') && car.speed > 15) {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      for (const o of cars) {
        if (o === car || o._.left) continue;
        const dx = o.pos.x - car.pos.x, dz = o.pos.z - car.pos.z, along = dx * fx + dz * fz, lat = -dx * fz + dz * fx;
        if (along > 2 && along < 25 && Math.abs(lat) < 2.4 && Math.cos(o.heading - car.heading) > 0.8) { slip = car.stats.passive === 'draft' ? 0.16 : 0.08; break; }
      }
    }
    c.slip += (slip - c.slip) * damp(3, dt);
    if (car.control === 'cpu' && leadLocal > -Infinity) {
      const gap = (car.progress - leadLocal) * race.track.length;
      c.rubber = gap > 0 ? lerp(1, 0.93, smooth(40, 220, gap)) : lerp(1, 1.06, smooth(60, 300, -gap));
    }
  }

  // 4) physics (substeps)
  if (race.state !== 'countdown') {
    const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
    for (let k = 0; k < steps; k++) {
      for (const car of cars) if (car.control !== 'net' && !car._.left) stepCar(ctx, car, h);
      collide(ctx);
      for (const car of cars) if (car.control !== 'net') settle(car);
    }
  }
  const nowS = performance.now() / 1000;
  for (const car of cars) {
    if (car.control !== 'net' || car._.left) continue;
    netPredict(ctx, car, nowS, dt);
    const tr = race.track, n = tr.nearest(car.pos, car.trackIndex);
    car.trackIndex = n.index;
    if (n.dist > tr.wall) {   // a prediction can overshoot a corner: keep it inside the barriers
      const s = tr.samples[n.index], push = n.lateral - Math.sign(n.lateral) * tr.wall;
      car.pos.x -= s.right.x * push; car.pos.z -= s.right.z * push;
      n.dist = tr.wall;
    }
    car.offroad = n.dist > tr.width / 2;
    if (car._.net) car.pos.y = n.point.y - 0.2 * smooth(tr.width / 2 + 0.5, tr.width / 2 + 3, n.dist);   // same as stepCar
    car._.pitch = Math.asin(clamp(n.tangent.y, -1, 1)) * Math.cos(car.heading - Math.atan2(n.tangent.x, n.tangent.z));
  }

  // 5) progress / laps
  if (race.state !== 'countdown') for (const car of cars) if (car.control !== 'net') updateProgress(ctx, car);
  ctx.order = standings(cars);
  for (const car of cars) {
    if (!isLocal(car)) continue;
    const tn = race.track.samples[car.trackIndex].tan;
    const wrong = race.state === 'running' && car.speed > 4 && (Math.sin(car.heading) * tn.x + Math.cos(car.heading) * tn.z) < -0.3;
    car._.wrong = wrong ? car._.wrong + dt : 0;
  }

  // 6) ghost
  if (ctx.recorder && race.state === 'running') {
    const p1 = cars.find(c => c.control === 'p1');
    if (p1 && !p1.finished) try { ctx.recorder.sample(race); } catch (e) { if (ctx.errors++ < 3) console.warn(e); }
  }
  if (ctx.ghost) try { ctx.ghost.update(race.time); } catch (e) { if (ctx.errors++ < 3) console.warn(e); }

  // 7) net
  // nothing moves before GO (remote cars wait on their grid slots), and a state stream alongside the ready/go
  // handshake only gives a rate-capped broker reasons to drop the 'go'
  if (race.net && race.state !== 'countdown') {
    ctx.netAcc += dt;
    const p1 = cars.find(c => c.control === 'p1');
    if (p1 && ctx.netAcc >= 0.05) {
      ctx.netAcc = Math.min(ctx.netAcc - 0.05, 0.05);   // keep the remainder: a steady 20 Hz at any frame rate
      // ft: the public broker has been seen to ack and then drop a single QoS1 'finish', so the finish time also rides
      // on every state message, and 'finish' itself is repeated until results arrive
      const ft = p1.finished ? { ft: r3(p1.finishTime) } : null;
      try { race.net.send({ t: 'state', pid: race.localPid, x: r2(p1.pos.x), y: r2(p1.pos.y), z: r2(p1.pos.z), h: r3(p1.heading), s: r2(p1.speed), lap: p1.lap, p: r3(p1.progress), rt: r3(race.time), ...ft }); }
      catch (e) { if (ctx.errors++ < 3) console.warn(e); }
      if (ft && !ctx.finalized && ctx.clock - (ctx.finishSentAt ?? 0) > 2) {
        ctx.finishSentAt = ctx.clock;
        try { race.net.send({ t: 'finish', pid: race.localPid, time: ft.ft }); } catch (e) { console.warn(e); }
      }
    }
  }
  checkFinalize(ctx);

  // 8) visuals
  updateCars(ctx, dt);
  ctx.smoke.update(dt);
  ctx.glow.update(dt);
  ctx.worldFx?.update(dt, ctx.clock);
  updateViews(ctx, dt);
}

function updateCars(ctx, dt) {
  const race = ctx.race;
  for (const car of race.cars) {
    const c = car._, mesh = car.mesh;
    if (c.left) continue;
    if (car.spin > 0) {
      if (!c.spinTot || car.spin > c.lastSpin + 1e-3) c.spinTot = car.spin;
      c.spinVis = (1 - car.spin / c.spinTot) * TAU * Math.max(1, Math.round(c.spinTot * 1.3));
    } else { c.spinTot = 0; c.spinVis = 0; }
    c.lastSpin = car.spin;
    c.rollS += (clamp(c.yaw * car.speed * 0.0035, -0.09, 0.09) - c.rollS) * damp(8, dt);
    mesh.position.copy(car.pos);
    mesh.rotation.set(-c.pitch - clamp(c.acc * 0.004, -0.05, 0.05), car.heading + c.spinVis, c.rollS);
    for (const w of mesh.userData.wheels || []) w.rotation.x += car.speed * dt / (w.userData.r || 0.35);
    for (const p of mesh.userData.steer || []) p.rotation.y = c.steerS * 0.45;
    mesh.userData.anim?.(ctx.clock, car.speed);
    if (car.control === 'net' || race.state === 'countdown') continue;

    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = -fz, rz = fx;
    const spd = Math.abs(car.speed);
    const skid = (car.drifting || car.spin > 0 || (car.input.brake > 0.5 && car.speed > 12)) && !car.offroad;
    for (const sd of [1, -1]) {
      const wx = car.pos.x - fx * 1.35 + rx * 0.8 * sd, wz = car.pos.z - fz * 1.35 + rz * 0.8 * sd, wy = car.pos.y;
      const key = car.index * 2 + (sd > 0 ? 0 : 1);
      if (skid) ctx.skids.add(key, wx, wy + 0.035, wz, rx, rz); else ctx.skids.cut(key);
      if ((car.drifting || car.spin > 0) && spd > 6) {
        for (let i = poisson(38 * dt); i > 0; i--) ctx.smoke.spawn(wx, wy + 0.25, wz, car.vel.x * 0.15 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), car.vel.z * 0.15 + (Math.random() - 0.5) * 2, 1.1 + Math.random() * 0.5, 1.0, 4.2, 0.9, 0.9, 0.92, 0.32, -0.3, 1.2);
      }
      if (c.drift && c.driftT > 1.1) {
        const hot = c.driftT > 2.2, col = hot ? [1, 0.55, 0.15] : [0.35, 0.7, 1];
        for (let i = poisson(45 * dt); i > 0; i--) ctx.glow.spawn(wx, wy + 0.1, wz, -car.vel.x * 0.1 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, -car.vel.z * 0.1 + (Math.random() - 0.5) * 4, 0.3, 0.45, 0.05, ...col, 1, 12, 1);
      }
      if (car.offroad && spd > 6) {
        for (let i = poisson(24 * dt); i > 0; i--) ctx.smoke.spawn(wx, wy + 0.2, wz, (Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2, 0.9, 0.8, 3.2, 0.55, 0.45, 0.32, 0.45, 1, 1.5);
      }
    }
    const boosting = car.mods.speedMul > 1.02 || car.mods.accelMul > 1.02 || c.turbo > 0;
    if (boosting && spd > 1) {
      const blue = c.turbo > 0 && car.mods.speedMul <= 1.02;
      for (const sd of [1, -1]) {
        const ex = car.pos.x - fx * 2.2 + rx * 0.35 * sd, ez = car.pos.z - fz * 2.2 + rz * 0.35 * sd, ey = car.pos.y + 0.45;
        for (let i = poisson(80 * dt); i > 0; i--) {
          ctx.glow.spawn(ex, ey, ez, car.vel.x * 0.7 - fx * 9 + (Math.random() - 0.5) * 2, (Math.random() - 0.3) * 1.5, car.vel.z * 0.7 - fz * 9 + (Math.random() - 0.5) * 2, 0.22, 1.0, 0.15, ...(blue ? [0.3, 0.6, 1] : [1, 0.5, 0.12]), 1, 0, 3);
          ctx.glow.spawn(ex, ey, ez, car.vel.x * 0.8 - fx * 6, 0, car.vel.z * 0.8 - fz * 6, 0.1, 0.55, 0.1, 1, 0.95, 0.8, 1, 0, 3);
        }
      }
    }
    if (c.slip > 0.03) {
      for (let i = poisson(30 * dt); i > 0; i--) {
        const s = (Math.random() - 0.5) * 3, up = Math.random() * 1.6;
        ctx.glow.spawn(car.pos.x + rx * s + fx * 3, car.pos.y + 0.4 + up, car.pos.z + rz * s + fz * 3, car.vel.x * 0.6, 0, car.vel.z * 0.6, 0.35, 0.25, 0.08, 0.7, 0.9, 1, 0.35, 0, 0);
      }
    }
  }
}

function updateViews(ctx, dt) {
  const race = ctx.race;
  for (const v of ctx.views) {
    const car = v.car, c = car._, cam = v.camera, spd = Math.abs(car.speed);
    let targetH = car.heading;
    if (spd > 4 && car.speed > 0) targetH = car.heading + wrapAngle(Math.atan2(car.vel.x, car.vel.z) - car.heading) * 0.55;
    let dist = 7.4 + Math.min(spd, 80) * 0.028, height = 2.7 + Math.min(spd, 80) * 0.006;
    if (race.state === 'countdown') { const k = smooth(0, 3.9, ctx.count); targetH += k * 2.6; dist += k * 5; height += k * 2.5; }
    v.camH += wrapAngle(targetH - v.camH) * damp(race.state === 'countdown' ? 4 : 6, dt);
    const fx = Math.sin(v.camH), fz = Math.cos(v.camH);
    v.tmp.set(car.pos.x - fx * dist, car.pos.y + height, car.pos.z - fz * dist);
    if (v.camPos.distanceToSquared(v.tmp) > 900) v.camPos.copy(v.tmp);   // warp / respawn: cut instead of flying
    else v.camPos.lerp(v.tmp, damp(12, dt));
    v.camPos.y = Math.max(v.camPos.y, car.pos.y + 1.2);
    v.shake *= Math.exp(-7 * dt);
    const sh = (v.shake + (car.offroad ? Math.min(spd, 40) * 0.0025 : 0)) * (dt > 0 ? 1 : 0);
    cam.position.set(v.camPos.x + (Math.random() - 0.5) * sh, v.camPos.y + (Math.random() - 0.5) * sh, v.camPos.z + (Math.random() - 0.5) * sh);
    cam.lookAt(car.pos.x + fx * 5, car.pos.y + 1.2, car.pos.z + fz * 5);
    const boosting = car.mods.speedMul > 1.02 || c.turbo > 0;
    const fov = 62 + Math.min(spd, 85) / 85 * 16 + (boosting ? 8 : 0);
    v.fov += (fov - v.fov) * damp(4, dt);
    // fov is tuned for 16:9; wider viewports (split screen halves) keep that horizontal fov instead of a fisheye
    const f = cam.aspect > 1.78 ? 2 * Math.atan(Math.tan(v.fov * Math.PI / 360) * 1.78 / cam.aspect) * 180 / Math.PI : v.fov;
    if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }

    if (v.engine) {
      const ratio = clamp(spd / car.stats.top, 0, 1.3), gp = ratio * 5, gear = Math.min(4, Math.floor(gp));
      const running = race.state !== 'countdown';
      const freq = running ? 52 + (gp - gear) * 95 + gear * 14 : 52 + car.input.throttle * 90;
      const vol = ctx.paused ? 0 : (0.05 + 0.06 * car.input.throttle) * (ctx.views.length > 1 ? 0.7 : 1);
      v.engine.set(freq, vol, ctx.paused ? 0 : (car.drifting || car.spin > 0) && !car.offroad ? 0.1 : 0);
    }
    updateHud(ctx, v);
  }
}

function resize(ctx) {
  const w = ctx.wrap.clientWidth || window.innerWidth, h = ctx.wrap.clientHeight || window.innerHeight;
  ctx.W = w; ctx.H = h;
  ctx.renderer.setSize(w, h, false);
}

function render(ctx) {
  const r = ctx.renderer, W = ctx.W, H = ctx.H, n = ctx.views.length;
  r.setScissorTest(n > 1);
  ctx.views.forEach((v, i) => {
    const vh = H / n, y = (n - 1 - i) * vh, cam = v.camera, asp = W / Math.max(1, vh);
    r.setViewport(0, y, W, vh);
    r.setScissor(0, y, W, vh);
    if (Math.abs(cam.aspect - asp) > 1e-3) { cam.aspect = asp; cam.updateProjectionMatrix(); }
    ctx.sky.position.copy(cam.position);
    ctx.sun.position.copy(v.car.pos).addScaledVector(ctx.sunDir, 150);
    ctx.sun.target.position.copy(v.car.pos);
    ctx.sun.target.updateMatrixWorld();
    const u = vh * r.getPixelRatio() * cam.projectionMatrix.elements[5] * 0.5;
    for (const p of ctx.fx) p.points.material.uniforms.uScale.value = u;
    ctx.worldFx?.cull?.(cam);
    r.render(ctx.scene, cam);
  });
}

// ======================================================================================
// HUD styles
// ======================================================================================
const CSS = `
.rg-root{position:absolute;inset:0;overflow:hidden;background:#0b0f18;font-family:"Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif;user-select:none;-webkit-user-select:none;color:#fff}
.rg-root .rg-gl{position:absolute;inset:0;width:100%;height:100%;display:block}
.rg-loading{position:absolute;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;font-size:20px;font-weight:700;letter-spacing:.1em;z-index:5;background:radial-gradient(circle at 50% 40%,#1b2540,#070a12)}
.rg-spin{width:42px;height:42px;border-radius:50%;border:4px solid rgba(255,255,255,.15);border-top-color:#29d8ff;animation:rgspin .8s linear infinite}
@keyframes rgspin{to{transform:rotate(360deg)}}
.rg-divider{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;background:linear-gradient(90deg,#29d8ff,#b04dff,#ff4d6d);box-shadow:0 0 12px rgba(176,77,255,.7);z-index:3}
.rg-vp{position:absolute;left:0;right:0;pointer-events:none;overflow:hidden;text-shadow:0 2px 8px rgba(0,0,0,.65)}
.rg-vp{--z:1}.rg-vp.small{--z:.72}
@media (max-width:900px),(max-height:640px){.rg-vp{--z:.72}.rg-vp.small{--z:.55}}
@media (max-width:640px),(max-height:420px){.rg-vp{--z:.55}.rg-vp.small{--z:.45}}
.rg-vig{position:absolute;inset:0;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at center,transparent 50%,rgba(255,120,30,.28) 85%,rgba(255,80,20,.5) 100%)}
.rg-tints,.rg-labels{position:absolute;inset:0}
.rg-label{position:absolute;left:0;top:0;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:700;background:rgba(10,14,24,.55);border-bottom:3px solid #fff;white-space:nowrap;will-change:transform}
.rg-tl{position:absolute;left:22px;top:16px;transform:scale(var(--z));transform-origin:0 0}
.rg-pos{font:italic 900 64px/1 system-ui,sans-serif;letter-spacing:-2px;background:linear-gradient(180deg,#fff,#9fe8ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 3px 6px rgba(0,0,0,.6))}
.rg-pos small{font-size:22px;letter-spacing:0;margin-left:4px}
.rg-lap{margin-top:6px;font:800 20px/1 system-ui,sans-serif;letter-spacing:.06em}
.rg-lap b{font-size:28px;color:#ffd23f}
.rg-who{margin-top:8px;display:inline-block;padding:3px 10px;border-radius:999px;background:rgba(0,0,0,.45);font-weight:800;font-size:14px}
.rg-tr{position:absolute;right:22px;top:16px;text-align:right;font-variant-numeric:tabular-nums;transform:scale(var(--z));transform-origin:100% 0}
.rg-time{font:800 34px/1 ui-monospace,Consolas,monospace;letter-spacing:.02em}
.rg-sub{font:600 16px/1.5 ui-monospace,Consolas,monospace;opacity:.9}
.rg-best{color:#ffd23f}
.rg-ghost{font:800 20px/1.5 system-ui,sans-serif}
.rg-tags{position:absolute;left:50%;top:18px;transform:translateX(-50%) scale(var(--z));transform-origin:50% 0;display:flex;gap:8px}
.rg-tag{display:none;padding:5px 14px;border-radius:999px;font:800 15px/1 system-ui,sans-serif;background:rgba(10,14,24,.6);border:1px solid rgba(255,255,255,.25)}
.rg-tag.on{display:block;animation:rgtag .35s ease-out}
.rg-tag.slip{color:#9fe8ff}.rg-tag.drift{color:#ffd23f}.rg-tag.turbo{color:#ff9d3a}
.rg-tag.wrong{color:#fff;background:rgba(220,30,50,.85);animation:rgblink .5s steps(2) infinite}
@keyframes rgtag{from{transform:scale(.6);opacity:0}}
@keyframes rgblink{50%{opacity:.35}}
.rg-center{position:absolute;left:0;right:0;top:24%;text-align:center;transform:scale(var(--z));transform-origin:50% 0}
.rg-center>div{position:absolute;left:0;right:0;top:0}
.rg-flash{top:34px!important}
.rg-wait{margin-top:10px;font:700 18px/1.4 system-ui,sans-serif;opacity:.9;animation:rgblink 1.2s steps(2) infinite}
.rg-count,.rg-flash{opacity:0;font:italic 900 150px/1 system-ui,sans-serif;-webkit-text-stroke:3px rgba(0,0,0,.35)}
.rg-flash{font-size:56px;margin-top:10px;-webkit-text-stroke:2px rgba(0,0,0,.35)}
.rg-count.go{animation:rgcount 1s cubic-bezier(.2,.9,.3,1.3) forwards}
.rg-flash.go{animation:rgflash 1.2s ease-out forwards}
@keyframes rgcount{0%{opacity:0;transform:scale(2.4)}20%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0;transform:scale(.85)}}
@keyframes rgflash{0%{opacity:0;transform:translateY(20px) scale(.7)}15%{opacity:1;transform:none}80%{opacity:1}100%{opacity:0;transform:translateY(-14px)}}
.rg-msg .rg-goal{font:italic 900 96px/1 system-ui,sans-serif;background:linear-gradient(180deg,#fff6c2,#ffb300 60%,#ff6b1a);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 4px 10px rgba(0,0,0,.6));animation:rggoal .9s cubic-bezier(.2,.9,.3,1.3) both}
@keyframes rggoal{0%{opacity:0;transform:scale(2.4)}40%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}
.rg-msg .rg-goal.dnf{background:linear-gradient(180deg,#fff,#aab)}
.rg-msg .rg-place{font:italic 900 56px/1.2 system-ui,sans-serif}
.rg-msg .rg-ftime{font:800 28px/1.4 ui-monospace,Consolas,monospace}
.rg-speed{position:absolute;left:14px;bottom:8px;width:190px;height:190px;transform:scale(var(--z));transform-origin:0 100%}
.rg-speed svg{width:100%;height:100%;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5))}
.rg-arc-bg,.rg-arc{fill:none;stroke-width:14;stroke-linecap:round}
.rg-arc-bg{stroke:rgba(255,255,255,.14)}
.rg-arc{stroke-dasharray:100;stroke-dashoffset:100;transition:stroke-dashoffset .08s linear}
.rg-kmh{position:absolute;left:0;right:0;top:66px;text-align:center}
.rg-kmh b{display:block;font:italic 900 54px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
.rg-kmh span{font:700 14px/1.4 system-ui,sans-serif;opacity:.8;letter-spacing:.1em}
.rg-abil{position:absolute;left:50%;bottom:22px;transform:translateX(-50%) scale(var(--z));transform-origin:50% 100%;width:min(380px,46%);text-align:center}
.rg-abil-top{display:flex;justify-content:space-between;align-items:flex-end;font:800 18px/1.3 system-ui,sans-serif;margin-bottom:5px}
.rg-abil-key{font:700 12px/1 system-ui,sans-serif;padding:3px 7px;border-radius:5px;border:1px solid rgba(255,255,255,.5);opacity:.85}
.rg-bar{height:16px;border-radius:9px;background:rgba(10,14,24,.55);border:1px solid rgba(255,255,255,.3);overflow:hidden}
.rg-bar i{display:block;height:100%;width:0;border-radius:9px;background:linear-gradient(90deg,#29d8ff,#b04dff);transition:width .12s linear}
.rg-abil.ready .rg-bar i{background:linear-gradient(90deg,#ffd23f,#ff6b1a);box-shadow:0 0 18px #ffb300;animation:rgpulse .5s infinite alternate}
.rg-abil.active .rg-bar i{background:linear-gradient(90deg,#5dffb0,#29d8ff);box-shadow:0 0 18px #29d8ff}
.rg-ready{height:26px;font:italic 900 22px/26px system-ui,sans-serif;color:#ffd23f;letter-spacing:.08em}
.rg-abil.ready .rg-ready{animation:rgpulse .5s infinite alternate}
.rg-abil.active .rg-ready{color:#5dffb0}
.rg-abil.sealed .rg-bar i{background:repeating-linear-gradient(135deg,#5a1a9e 0 8px,#2a0a4e 8px 16px);box-shadow:0 0 14px #8a2cff}
.rg-abil.sealed .rg-ready{color:#c79bff}
@keyframes rgpulse{from{filter:brightness(1)}to{filter:brightness(1.6)}}
.rg-map{position:absolute;right:16px;bottom:16px;width:176px;height:176px;transform:scale(var(--z));transform-origin:100% 100%;border-radius:16px;background:rgba(10,14,24,.5);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(4px)}
.rg-link{position:absolute;right:16px;bottom:calc(22px + 176px * var(--z));transform:scale(var(--z));transform-origin:100% 100%;text-align:right;font:700 12px/1.5 system-ui,sans-serif;font-variant-numeric:tabular-nums}
.rg-link div{white-space:nowrap}
.rg-link i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;border:1px solid #111}
.rg-link b{margin-left:4px;padding:0 6px;border-radius:6px;background:rgba(10,14,24,.6)}
.rg-hint{position:absolute;left:50%;bottom:4px;transform:translateX(-50%);font-size:12px;opacity:.75;background:rgba(0,0,0,.4);padding:3px 12px;border-radius:999px;transition:opacity 1s;z-index:4;white-space:nowrap}
.rg-hint.off{opacity:0}
.rg-qtoast{position:absolute;left:50%;top:54px;transform:translateX(-50%);z-index:4;font:700 13px/1 system-ui,sans-serif;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.5);white-space:nowrap;pointer-events:none;animation:rgq 2.6s forwards}
@keyframes rgq{0%,80%{opacity:1}100%{opacity:0}}
.rg-quit{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;width:36px;height:36px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.4);color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer;opacity:.7}
.rg-quit:hover{opacity:1}
.rg-modal{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(4,6,12,.6);backdrop-filter:blur(4px);z-index:10}
.rg-modal.on{display:flex}
.rg-modal-box{min-width:320px;padding:28px 34px;border-radius:18px;text-align:center;background:linear-gradient(160deg,#18203a,#0e1322);border:1px solid rgba(120,160,255,.35);box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 30px rgba(41,216,255,.15)}
.rg-modal-box h2{margin:0 0 8px;font-size:24px}
.rg-modal-box p{margin:0 0 20px;opacity:.75}
.rg-modal-btns{display:flex;gap:12px;justify-content:center}
.rg-btn{font:700 16px system-ui,sans-serif;padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;cursor:pointer}
.rg-btn:hover{background:rgba(255,255,255,.16)}
.rg-btn.rg-ok{background:linear-gradient(90deg,#ff4d6d,#ff6b1a);border-color:transparent}
.rg-btn kbd{font-size:11px;opacity:.7;margin-left:6px}
`;
