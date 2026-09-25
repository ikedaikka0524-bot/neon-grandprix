// Entry point: menus, garage, gacha, skill tree, online lobby, race launch and results.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  RARITY, RARITY_ORDER, ABILITIES, PASSIVES, CARS, CAR_BY_ID, STARTER_CAR, SKILL_TREE, NODE_BY_ID,
  nodeCost, nodeBlockReason, computeStats, GACHA, ECONOMY, DIFFICULTY, DIFFICULTY_BY_ID,
} from './data.js';
import { TRACKS, TRACK_BY_ID, DEFAULT_TRACK } from './tracks.js';
import { getSave, persist, newCarRec, resetSave, reloadSave, loadGhost, saveGhost, backupSave } from './save.js';
import { buildCarMesh, preloadCarModels } from './carmodel.js';
import { startRace, stopRace, raceBack } from './game.js';
import { mountTouchSettings } from './touch.js';
import { hostRoom, joinRoom } from './net.js';
import { BUILD } from './version.js';
import { lbReady, lbTop, lbGhost, lbQueue, lbFlush, lbPending, lbNeedsReload, nameAsked, setNameAsked, rarityOf, rankText } from './lb.js';
import { initSync, syncKick, syncDialogClose, renderSyncSettings, syncLinked } from './sync.js';

/* ================= helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rIdx = r => RARITY_ORDER.indexOf(r);
const rColor = id => RARITY[CAR_BY_ID[id].rarity].color;
const defLook = id => newCarRec(id).look;
const fmt = t => (t == null || !isFinite(t)) ? '--:--.---' : `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`;
const rb = r => `<span class="rb" data-r="${r}" style="--rc:${RARITY[r].color}">${r}</span>`;
const K = s => s.split(' ').map(k => `<kbd>${k}</kbd>`).join('');
const cleanName = n => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Player';
const hex6 = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) ? v : null;
const cleanLook = (l, id) => { const d = defLook(id); return { body: hex6(l?.body) || d.body, wheel: hex6(l?.wheel) || d.wheel, wing: !!l?.wing }; };
const pullCost = (n, tk) => tk ? (n === 10 ? GACHA.tenTickets : GACHA.singleTickets) : (n === 10 ? GACHA.tenCoins : GACHA.singleCoins);

let save = getSave();
const owned = () => CARS.filter(c => save.cars[c.id]);
const validGhost = (id, tid) => {
  const g = loadGhost(id, tid);
  return g && Array.isArray(g.frames) && g.frames.length > 1 && isFinite(g.time) && (!g.trackId || g.trackId === tid) ? g : null;
};
const curTrack = () => TRACK_BY_ID[save.lastTrack] ? save.lastTrack : DEFAULT_TRACK;
const bestOf = (id, tid) => save.cars[id]?.best?.[tid] || {};
const coinMul = tid => 1 + 0.25 * ((TRACK_BY_ID[tid]?.difficulty || 1) - 1);

/* ================= sound (tiny WebAudio synth) ================= */
let AC = null;
function tone(freq, dur = 0.12, type = 'sine', vol = 0.1, when = 0, slideTo = 0) {
  if (save.sound === false) return;
  try {
    AC ||= new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state !== 'running') AC.resume().catch(() => {});   // iOS: also 'interrupted' (call / app switch)
    const t = AC.currentTime + when, o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.03);
  } catch { /* audio unavailable */ }
}
const sfx = {
  click: () => tone(1250, 0.035, 'square', 0.025),
  drop: () => tone(900, 0.45, 'sine', 0.08, 0, 160),
  shake: i => { tone(190 + i * 90, 0.12, 'triangle', 0.16); tone(420 + i * 170, 0.06, 'square', 0.03, 0.02); },
  burst: ri => { tone(75, 0.8, 'sine', 0.3, 0, 32); [0, 4, 7, 12, 16, 19].slice(0, 3 + ri).forEach((s, i) => tone(523 * 2 ** (s / 12), 0.5, 'sawtooth', 0.04, 0.05 + i * 0.07)); },
  card: i => tone(620 + i * 55, 0.05, 'square', 0.025),
  coin: () => { tone(988, 0.07, 'square', 0.035); tone(1319, 0.2, 'square', 0.035, 0.07); },
  unlock: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.09, i * 0.06)),
  fanfare: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? 0.7 : 0.16, 'square', 0.045, i * 0.11)),
  go: () => tone(220, 0.45, 'sawtooth', 0.05, 0, 880),
  error: () => tone(150, 0.2, 'sawtooth', 0.07),
};

/* ================= toast / modal / wallet ================= */
let toastT = 0;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.className = ''; }, 3200);
}

let modalClose = null;
function ask({ title, html, yes = 'OK', no = 'キャンセル', yesDisabled = false, danger = false }) {
  modalClose?.();
  return new Promise(res => {
    const m = $('#modal'), y = $('#mYes'), n = $('#mNo');
    $('#mTitle').textContent = title;
    $('#mBody').innerHTML = html;
    y.textContent = yes; y.disabled = yesDisabled;
    y.classList.toggle('danger', danger); y.classList.toggle('primary', !danger);
    n.textContent = no;
    m.classList.remove('hidden');
    const done = v => { m.classList.add('hidden'); y.onclick = n.onclick = m.onclick = null; modalClose = null; res(v); };
    y.onclick = () => done(true);
    n.onclick = () => done(false);
    m.onclick = e => { if (e.target === m) done(false); };
    modalClose = () => done(false);
    (yesDisabled ? n : y).focus();
  });
}

const shown = { coins: null, tickets: null };
function refreshWallet() {
  for (const [k, id] of [['coins', 'Coins'], ['tickets', 'Tickets']]) {
    const el = $('#w' + id), to = save[k], from = shown[k] ?? to;
    shown[k] = to;
    if (from === to) { el.textContent = to.toLocaleString(); continue; }
    const chip = $('#chip' + id);
    chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    const t0 = performance.now();
    const step = now => {
      if (shown[k] !== to) return;
      const p = Math.min(1, (now - t0) / 700);
      el.textContent = Math.round(from + (to - from) * (1 - (1 - p) ** 3)).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}

/* ================= 3D preview: ONE renderer moved between screens ================= */
const PV = { r: null, canvas: null, slot: null, stages: [], w: 0, h: 0 };
let envTex = null;
try {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  r.setClearColor(0x000000, 0);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.1;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  const pm = new THREE.PMREMGenerator(r), room = new RoomEnvironment();
  envTex = pm.fromScene(room, 0.04).texture;
  pm.dispose(); room.dispose?.();
  PV.r = r; PV.canvas = r.domElement; PV.canvas.className = 'pv';
} catch (e) { console.warn('3D preview disabled:', e); }

const GLOW = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const SIL = new THREE.MeshStandardMaterial({ color: 0x05060c, roughness: 0.3, metalness: 0.9 });

function dispose(o) {
  // Shared (cached) geometries simply get re-uploaded by three.js on next use.
  o.traverse(n => { if (!n.isMesh) return; n.geometry?.dispose(); for (const m of [].concat(n.material)) if (m && m !== SIL) m.dispose(); });
}

class Stage {
  constructor(thumb = false) {
    const s = this.scene = new THREE.Scene();
    s.environment = envTex;
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    Object.assign(this, { dist: thumb ? 8.4 : 10.5, spin: thumb ? 0 : 0.5, rot: thumb ? 0.55 : 0.8, t: 0, pop: 1, flash: 0, hold: 0, key: '', token: 0, car: null });
    s.add(new THREE.HemisphereLight(0xb8c8ff, 0x1a1030, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 25 });
    s.add(key);
    for (const [c, x, z] of [[0x22e6ff, -5, -3], [0xff2bd6, 5, -4]]) { const p = new THREE.PointLight(c, 45, 25); p.position.set(x, 2.2, z); s.add(p); }
    this.fl = new THREE.PointLight(0xffffff, 0, 20);
    this.fl.position.set(0, 3.5, 2.5);
    s.add(this.fl);
    const flat = m => { m.rotation.x = -Math.PI / 2; return m; };
    const glowMat = (op, map = null) => new THREE.MeshBasicMaterial({ color: 0xffffff, map, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    if (thumb) {
      const sh = flat(new THREE.Mesh(new THREE.CircleGeometry(4, 40), new THREE.ShadowMaterial({ opacity: 0.5 })));
      sh.receiveShadow = true; s.add(sh);
    } else {
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.25, 3.4, 0.16, 72), new THREE.MeshStandardMaterial({ color: 0x0b0f22, metalness: 0.85, roughness: 0.32 }));
      plat.position.y = -0.08; plat.receiveShadow = true; s.add(plat);
      this.glow = flat(new THREE.Mesh(new THREE.PlaneGeometry(10, 10), glowMat(0.5, GLOW)));
      this.glow.position.y = -0.17; s.add(this.glow);
      this.ring = flat(new THREE.Mesh(new THREE.RingGeometry(3.02, 3.12, 96), glowMat(0.9)));
      this.ring.position.y = 0.005; s.add(this.ring);
      this.tickMat = glowMat(0.45);
      this.ticks = flat(new THREE.Group());
      this.ticks.position.y = -0.12;
      const tg = new THREE.RingGeometry(3.5, 3.7, 3, 1, 0, 0.09);
      for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(tg, this.tickMat); m.rotation.z = i * Math.PI * 2 / 40; this.ticks.add(m); }
      s.add(this.ticks);
    }
    this.table = new THREE.Group();
    s.add(this.table);
  }
  accent(hex) {
    const c = new THREE.Color(hex);
    this.fl.color.copy(c);
    if (!this.ring) return;
    this.ring.material.color.copy(c); this.tickMat.color.copy(c); this.glow.material.color.copy(c);
  }
  async set(carId, look, sil = false) {
    if (!PV.r) return;
    const key = `${carId}|${JSON.stringify(look)}|${sil}`;
    if (key === this.key) return;
    const newCar = !this.key.startsWith(carId + '|');
    this.key = key;
    const tok = ++this.token;
    this.accent(rColor(carId));
    let m;
    try { m = await buildCarMesh(carId, look); } catch (e) { console.warn('buildCarMesh failed', carId, e); if (tok === this.token) this.key = ''; return; }
    if (tok !== this.token) return dispose(m);
    m.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      if (sil) { for (const x of [].concat(o.material)) x.dispose(); o.material = SIL; }
    });
    if (this.car) { this.table.remove(this.car); dispose(this.car); }
    this.table.add(this.car = m);
    if (newCar) this.pop = 0;
  }
  update(dt, aspect) {
    this.t += dt;
    if (this.hold > 0) this.hold -= dt; else this.rot += dt * this.spin;
    this.pop = Math.min(1, this.pop + dt * 2.4);
    const q = this.pop - 1, e = 1 + 2.70158 * q ** 3 + 1.70158 * q ** 2;   // easeOutBack
    this.table.rotation.y = this.rot;
    this.table.scale.setScalar(0.5 + 0.5 * e);
    this.table.position.y = q * q * 1.4;
    this.car?.userData.anim?.(this.t, 0);
    this.flash = Math.max(0, this.flash - dt * 1.1);
    this.fl.intensity = this.flash * 160;
    if (this.ring) {
      this.ticks.rotation.z = this.t * 0.25;
      this.ring.material.opacity = 0.65 + 0.3 * Math.sin(this.t * 2.2) + this.flash * 0.5;
      this.glow.material.opacity = 0.45 + this.flash;
    }
    const d = this.dist * Math.max(1, 1.3 / aspect);
    this.cam.aspect = aspect;
    this.cam.updateProjectionMatrix();
    this.cam.position.set(0.62 * d, 0.33 * d, 0.71 * d);
    this.cam.lookAt(0, 0.6, 0);
  }
}
const S1 = new Stage(), S2 = new Stage(), TS = new Stage(true);

function mount(slot, stages = [], spin = 0.5) {
  PV.slot = slot; PV.stages = stages; PV.w = 0;
  for (const s of stages) s.spin = spin;
  if (slot && PV.canvas && PV.canvas.parentNode !== slot) slot.prepend(PV.canvas);
}
function renderPV(dt) {
  const { r, slot, stages } = PV;
  if (!r || !slot || !stages.length) return;
  const w = slot.clientWidth, h = slot.clientHeight;
  if (!w || !h) return;
  if (w !== PV.w || h !== PV.h) { r.setSize(w, h, false); PV.w = w; PV.h = h; }
  const sw = w / stages.length;
  r.setScissorTest(true);
  stages.forEach((st, i) => {
    r.setViewport(i * sw, 0, sw, h); r.setScissor(i * sw, 0, sw, h);
    st.update(dt, sw / h);
    r.render(st.scene, st.cam);
  });
  r.setScissorTest(false);
}

// Card thumbnails: render into the shared canvas, grab a PNG, restore the live view in the same task.
const thumbs = new Map(), tq = [];
let tBusy = false;
function thumb(carId, look) {
  const k = carId + JSON.stringify(look);
  if (!thumbs.has(k)) thumbs.set(k, new Promise(res => { tq.push({ carId, look, res }); pumpThumbs(); }));
  return thumbs.get(k);
}
async function pumpThumbs() {
  if (tBusy) return;
  tBusy = true;
  while (tq.length) {
    const j = tq.shift();
    let url = null;
    if (PV.r) {
      try {
        const m = await buildCarMesh(j.carId, j.look);
        while (race) await sleep(500);
        m.traverse(o => { if (o.isMesh) o.castShadow = true; });
        TS.table.add(m);
        TS.accent(rColor(j.carId));
        const r = PV.r, W = 260, H = 160;
        r.setSize(W, H, false); r.setViewport(0, 0, W, H);
        TS.update(0, W / H); r.render(TS.scene, TS.cam);
        url = r.domElement.toDataURL('image/png');
        TS.table.remove(m); dispose(m);
        PV.w = 0; renderPV(0);
      } catch (e) { console.warn('thumbnail failed', j.carId, e); }
    }
    j.res(url);
    await new Promise(r => requestAnimationFrame(r));
  }
  tBusy = false;
}

// Drag to rotate the car.
if (PV.canvas) {
  let drag = null;
  PV.canvas.addEventListener('pointerdown', e => {
    const rect = PV.canvas.getBoundingClientRect(), n = PV.stages.length;
    const st = PV.stages[Math.min(n - 1, Math.floor((e.clientX - rect.left) / rect.width * n))];
    if (!st) return;
    drag = { x: e.clientX, st };
    PV.canvas.setPointerCapture(e.pointerId);
  });
  PV.canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    drag.st.rot += (e.clientX - drag.x) * 0.012; drag.x = e.clientX; drag.st.hold = 1.5;
  });
  const end = () => { drag = null; };
  PV.canvas.addEventListener('pointerup', end);
  PV.canvas.addEventListener('pointercancel', end);
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!race) renderPV(dt);
}

/* ================= screens / navigation ================= */
const PREP = {
  solo: { tag: 'SOLO', title: 'ソロ（CPU戦）', lead: 'CPUとレース。順位に応じてコインを獲得！ 難しいコースほど、強いCPUに勝つほど賞金アップ。' },
  ghost: { tag: 'GHOST', title: '過去の自分と対戦', lead: 'この車・このコースの最速記録を再現したゴーストとタイムアタック。' },
  split: { tag: 'VERSUS', title: '2人対戦（画面分割）', lead: '1台のキーボードで2人対戦。上画面がP1、下画面がP2。' },
};
const SCREENS = {
  home: ['#scr-home', '', renderHome],
  solo: ['#scr-prep', PREP.solo.title, () => renderPrep('solo')],
  ghost: ['#scr-prep', PREP.ghost.title, () => renderPrep('ghost')],
  split: ['#scr-prep', PREP.split.title, () => renderPrep('split')],
  online: ['#scr-online', 'オンライン対戦', renderOnline],
  gacha: ['#scr-gacha', 'ガチャ', renderGacha],
  garage: ['#scr-garage', 'ガレージ', renderGarage],
  tree: ['#scr-tree', 'スキルツリー', renderTree],
  settings: ['#scr-settings', '設定', renderSettings],
  lb: ['#scr-lb', 'ランキング', renderLb],
};
let cur = 'home';
const stack = [];
function show(name, push = true) {
  if (push && name !== cur) stack.push(cur);
  if (name === 'home') stack.length = 0;
  cur = name;
  const [sel, title, enter] = SCREENS[name], el = $(sel);
  $$('.screen').forEach(s => s.classList.remove('active'));
  void el.offsetWidth;
  el.classList.add('active');
  $('#scrTitle').textContent = title;
  $('#btnBack').hidden = name === 'home';
  document.activeElement?.blur?.();
  hideTip();
  enter();
  refreshWallet();
  $('#main').scrollTop = 0;
}
const rerender = () => SCREENS[cur][2]();
async function goBack() {
  if (cur === 'online' && NET.s) {
    if (!await ask({ title: '部屋から退出', html: '<p>ルームから退出しますか？</p>', yes: '退出する', danger: true })) return;
    leaveRoom();
  }
  show(stack.pop() || 'home', false);
}

/* ================= shared bits ================= */
function abilityHTML(st) {
  const a = ABILITIES[st.ability], p = st.passive && PASSIVES[st.passive];
  return `<div class="ab"><em>能力</em><b>${esc(a.name)}</b><span>${esc(a.desc)}</span><small>${(a.fill / st.gaugeRate).toFixed(1)}s</small></div>`
    + (p ? `<div class="ab ps"><em>特性</em><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div>` : '');
}

const ALL_NODES = Object.keys(NODE_BY_ID);
const BARS = [
  ['top', '最高速', v => `${Math.round(v * 3.6)} km/h`], ['accel', '加速', v => v.toFixed(1)],
  ['grip', 'グリップ', v => v.toFixed(2)], ['steer', 'ハンドリング', v => v.toFixed(2)], ['mass', '重量', v => v.toFixed(2)],
].map(([k, label, f]) => {
  const vals = CARS.flatMap(c => [c.base[k], computeStats(c.id, ALL_NODES)[k]]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return { k, label, f, lo: lo - (hi - lo) * 0.35, hi };
});
function barsHTML(id, nodes) {
  const b = computeStats(id, []), s = computeStats(id, nodes);
  const pct = (v, B) => Math.max(3, Math.min(100, (v - B.lo) / (B.hi - B.lo) * 100));
  const bars = BARS.map(B => {
    const p0 = pct(b[B.k], B), p1 = pct(s[B.k], B);
    return `<div class="bar"><span class="bl">${B.label}</span><div class="bt"><i class="b0" style="width:${p0}%"></i>${p1 > p0 + 0.1 ? `<i class="b1" style="left:${p0}%;width:${p1 - p0}%"></i>` : ''}</div><span class="bv">${B.f(s[B.k])}</span></div>`;
  }).join('');
  const chips = [['ゲージ速度', s.gaugeRate], ['効果時間', s.abilityDuration], ['能力の強さ', s.abilityPower]]
    .map(([l, v]) => `<span class="chip2 ${v > 1 ? 'up' : ''}">${l} ×${v.toFixed(2)}</span>`).join('')
    + (s.slipstream ? '<span class="chip2 up">スリップストリーム</span>' : '')
    + (s.driftCharge ? '<span class="chip2 up">ドリフトチャージ</span>' : '');
  return `<div class="bars">${bars}</div><div class="chips">${chips}</div>`;
}

function fillPicker(p) {
  const c = CAR_BY_ID[save.selected[p]];
  $$(`.picker[data-p="${p}"]`).forEach(el => {
    el.querySelector('.pk').innerHTML = `${rb(c.rarity)}<span>${esc(c.name)}</span>`;
    el.style.setProperty('--rc', RARITY[c.rarity].color);
  });
}
function cycleCar(p, dir) {
  const list = owned(), i = list.findIndex(c => c.id === save.selected[p]);
  save.selected[p] = list[(i + dir + list.length) % list.length].id;
  persist();
  if (p === 'p1') myNet();
  rerender();
}

/* ================= home ================= */
function renderHome() {
  const id = save.selected.p1, c = CAR_BY_ID[id], rec = save.cars[id];
  mount($('#homeSlot'), [S1], 0.35);
  S1.set(id, rec.look);
  $('#homeAvatar').textContent = ([...save.name][0] || 'P').toUpperCase();
  $('#homeName').textContent = save.name;
  $('#homeStats').textContent = `レース ${save.stats.races} ・ 優勝 ${save.stats.wins} ・ コレクション ${owned().length}/${CARS.length}`;
  $('#homeCar').innerHTML = `${rb(c.rarity)}<span>${esc(c.name)}</span>`;
  $('#homeAbility').innerHTML = abilityHTML(computeStats(id, rec.nodes));
  const g = validGhost(id, curTrack());
  $('#tileGhost small').textContent = g ? `ゴースト ${fmt(g.time)} に挑戦` : 'タイムアタック';
  $('#gachaBadge').innerHTML = save.tickets > 0 ? `<i class="ic-ticket"></i>${save.tickets}` : '';
}

/* ================= solo / ghost / split ================= */
let cpuCount = 3;
const KEYS_SOLO = `<div><span>${K('W A S D')}<i>/</i>${K('↑ ← ↓ →')}</span>運転</div><div><span>${K('Space')}<i>/</i>${K('Shift')}</span>能力</div><div><span>${K('Esc')}</span>ポーズ</div>`;
const KEYS_SPLIT = `<div><span class="p1">P1 上画面</span><span>${K('W A S D')} ＋ ${K('左Shift')}</span></div><div><span class="p2">P2 下画面</span><span>${K('↑ ← ↓ →')} ＋ ${K('右Shift')}</span></div>`;

/* ---------- courses ---------- */
const THEME = {
  forest: { c: '#3dffa8', name: '森' }, city: { c: '#ff4fd8', name: '市街地' }, desert: { c: '#ff9a3d', name: '砂漠' },
  snow: { c: '#9fdcff', name: '雪山' }, beach: { c: '#22e6ff', name: '海岸' },
};
const TIME = { day: '昼', night: '夜', sunset: '夕暮れ' };
// Minimaps: same top-down orientation as the in-game map (+x to the left, +z up), start line across the road.
const COURSE = Object.fromEntries(TRACKS.map(t => {
  const curve = new THREE.CatmullRomCurve3(t.points.map(p => new THREE.Vector3(p[0], p[1], p[2])), true, 'centripetal');
  const pts = curve.getSpacedPoints(160).slice(0, -1);
  const xs = pts.map(p => p.x), zs = pts.map(p => p.z), maxX = Math.max(...xs), maxZ = Math.max(...zs);
  const w = maxX - Math.min(...xs), h = maxZ - Math.min(...zs), S = Math.max(w, h), pad = S * 0.07;
  const X = p => +(maxX - p.x + pad).toFixed(1), Y = p => +(maxZ - p.z + pad).toFixed(1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p)} ${Y(p)}`).join('') + 'Z';
  const tan = curve.getTangentAt(0), k = S * 0.055 / (Math.hypot(tan.x, tan.z) || 1), sx = X(pts[0]), sy = Y(pts[0]);
  const base = `<path class="tm-glow" d="${d}"/><path class="tm-line" d="${d}"/><path class="tm-start" d="M${(sx - tan.z * k).toFixed(1)} ${(sy + tan.x * k).toFixed(1)}L${(sx + tan.z * k).toFixed(1)} ${(sy - tan.x * k).toFixed(1)}"/>`;
  return [t.id, {
    km: (curve.getLength() / 1000).toFixed(2),
    svg: car => `<svg viewBox="0 0 ${(w + pad * 2).toFixed(0)} ${(h + pad * 2).toFixed(0)}" aria-hidden="true">${base}${car ? `<circle class="tm-car" r="${(S * 0.035).toFixed(1)}"><animateMotion dur="7s" repeatCount="indefinite" path="${d}"/></circle>` : ''}</svg>`,
  }];
}));
const stars = n => `${'★'.repeat(n)}<i>${'★'.repeat(3 - n)}</i>`;

// ro: guests in the online lobby only see the host's pick. ghost: show this car's ghost per course instead of bests.
function renderCourses(box, sel, { ro = false, ghost = false } = {}) {
  const id = save.selected.p1, x = box.scrollLeft;
  box.classList.toggle('ro', ro);
  box.innerHTML = TRACKS.map(t => {
    const on = t.id === sel, b = bestOf(id, t.id), mul = coinMul(t.id), g = ghost && validGhost(id, t.id);
    const foot = ghost
      ? (g ? `<span>ゴースト</span><b>${fmt(g.time)}</b>` : '<span class="none">ゴーストなし</span>')
      : `<span>ベスト</span><b>${fmt(b.race)}</b><span>ラップ</span><b>${fmt(b.lap)}</b>`;
    return `<button class="course ${on ? 'on' : ''}" data-track="${t.id}" style="--tc:${THEME[t.theme].c}" aria-pressed="${on}"${ro && !on ? ' disabled' : ''}>`
      + `<span class="c-map">${COURSE[t.id].svg(on)}<em>${t.label || THEME[t.theme].name}・${TIME[t.time]}</em><span class="c-diff" title="難易度 ${t.difficulty}">${stars(t.difficulty)}</span></span>`
      + `<span class="c-body"><span class="c-h"><b>${esc(t.name)}</b></span>`
      + `<span class="c-desc">${esc(t.desc)}</span>`
      + `<span class="c-spec"><span>${COURSE[t.id].km} km</span><span>${t.laps}周</span>${mul > 1 ? `<span class="c-mul">コイン×${mul}</span>` : ''}</span>`
      + `<span class="c-best">${foot}</span></span></button>`;
  }).join('');
  box.scrollLeft = x;
  const c = $('.on', box);   // keep the pick in view horizontally only (scrollIntoView would also scroll #main)
  if (c) {
    const br = box.getBoundingClientRect(), cr = c.getBoundingClientRect();
    if (cr.left < br.left || cr.right > br.right) box.scrollLeft += cr.left - br.left - (box.clientWidth - c.offsetWidth) / 2;
    if (cr.top < br.top || cr.bottom > br.bottom) box.scrollTop += cr.top - br.top - (box.clientHeight - c.offsetHeight) / 2;   // vertical list (ranking, landscape phones)
  }
}
function pickTrack(tid) {
  if (!TRACK_BY_ID[tid] || tid === save.lastTrack) return;
  save.lastTrack = tid;
  persist();
  rerender();
}

function renderPrep(mode) {
  const sec = $('#scr-prep'), P = PREP[mode], p1 = save.selected.p1, p2 = save.selected.p2;
  sec.dataset.mode = mode;
  $('#prepTag').textContent = P.tag;
  $('#prepTitle').textContent = P.title;
  $('#prepLead').textContent = P.lead;
  mount($('#prepSlot'), mode === 'split' ? [S1, S2] : [S1]);
  S1.set(p1, save.cars[p1].look);
  if (mode === 'split') S2.set(p2, save.cars[p2].look);
  fillPicker('p1'); fillPicker('p2');
  $$('#cpuSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === cpuCount));
  const lv = DIFFICULTY_BY_ID[save.lastCpuLevel];
  $('#diffSeg').innerHTML = DIFFICULTY.map(d => `<button class="dchip ${d.id === lv.id ? 'on' : ''} ${d.id === 'legend' ? 'legend' : ''}" data-lv="${d.id}" aria-pressed="${d.id === lv.id}" title="${esc(d.desc)} ・ 賞金${d.coinMul > 1 ? '最大' : ''}×${d.coinMul}"><b>${esc(d.name)}</b><small><i class="ic-coin"></i>×${d.coinMul}</small></button>`).join('');
  $('#diffDesc').textContent = lv.desc;
  const tid = curTrack(), ids = mode === 'split' ? [p1, p2] : [p1];
  renderCourses($('#prepCourses'), tid, { ghost: mode === 'ghost' });
  $('#prepRec').innerHTML = `<div class="rec-h">${esc(TRACK_BY_ID[tid].name)} の記録</div>` + ids.map((id, i) => {
    const b = bestOf(id, tid);
    return `<div class="rec">${mode === 'split' ? `<em class="p${i + 1}">P${i + 1}</em>` : ''}<span>ベストラップ <b>${fmt(b.lap)}</b></span><span>ベストレース <b>${fmt(b.race)}</b></span></div>`;
  }).join('');
  if (mode === 'ghost') {
    const g = validGhost(p1, tid);
    $('#ghostBox').innerHTML = (g
      ? `<div class="gh-ok"><span class="gh-ic"></span><div><b>ゴースト ${fmt(g.time)}</b><small>勝てば +${Math.round(ECONOMY.beatGhostBonus * coinMul(tid))} コイン</small></div></div>`
      : '<div class="gh-ok"><div><b>タイムアタック</b><small>ゴーストなし・ひとりで走ってゴーストを作ろう</small></div></div>')
      + (lbReady() ? '<p class="hint">タイムは世界ランキングに自動で登録されます</p>' : '');
  }
  $('#btnStart').disabled = false;
  $('#prepKeys').innerHTML = mode === 'split' ? KEYS_SPLIT : KEYS_SOLO;
}

function player(p, name) {
  const id = save.selected[p], rec = save.cars[id];
  return { name, carId: id, look: { ...rec.look }, stats: computeStats(id, rec.nodes), control: p };
}
function startMode(mode) {
  const trackId = curTrack();
  if (mode === 'solo') return launch({ mode, trackId, players: [player('p1', save.name)], cpuCount, cpuLevel: save.lastCpuLevel }, mode);
  if (mode === 'split') return launch({ mode, trackId, players: [player('p1', save.name), player('p2', 'プレイヤー2')] }, mode);
  if (mode === 'ghost') return launch({ mode, trackId, players: [player('p1', save.name)], ghost: validGhost(save.selected.p1, trackId) }, mode);
}

/* ================= race lifecycle ================= */
let race = null, raceTok = 0;
async function launch(opts, screen) {
  if (race) return;
  // newer build deployed: a course / scenery module this tab hasn't loaded yet would come from it (Pages ignores ?v)
  // and run against this tab's old world.js, so reload into the new build first (online: the lobby's build check)
  if (opts.mode !== 'online' && !$('#newVer').hidden && await update() !== false) return;
  const tok = ++raceTok, w = $('#wipe');
  race = { opts, screen, done: false };
  hideResults(); hideTip(); modalClose?.(); syncDialogClose();   // (an online start comes from the host, any time)
  sfx.go();
  w.className = 'in';
  await sleep(opts.mode === 'online' ? 150 : 450);
  if (tok !== raceTok) { w.className = ''; return; }
  document.body.classList.add('racing');
  try {
    await startRace({
      ...opts,
      quality: save.quality,
      onFinish: res => { if (tok === raceTok) onFinish(res); },
      onQuit: () => { if (tok === raceTok) quitRace(); },
    });
  } catch (e) {
    console.error('startRace failed', e);
    if (tok === raceTok) { quitRace(); toast('レースを開始できませんでした', 'err'); }
  }
  if (tok !== raceTok) return;
  race.live = true;   // the game's net handlers are hooked from here on
  w.className = 'out';
  setTimeout(() => { if (w.className === 'out') w.className = ''; }, 600);
}
function teardownRace() {
  raceTok++;
  race = null;
  try { stopRace(); } catch (e) { console.error(e); }
  document.body.classList.remove('racing');
  $('#wipe').className = '';
  hideResults();
}
function endRace() {
  const back = race?.screen || 'home';
  if (!$('#rLb').hidden) { if ($('#rName').value.trim()) setName($('#rName').value); $('#rLb').hidden = true; }   // name prompt left via another button
  teardownRace();
  show(back, false);
  checkUpdate(false);   // the 5-min poll skips race / results time, so back-to-back races would never look
  lbSend();             // a record held back by the name prompt goes out now
  syncKick();           // cloud save: send the rewards / take a download that waited for the race
}
// Quit from the race (Esc → 終了する) or a failed start. Online that means leaving the room ('オンライン対戦から退出します'),
// so the others get 'leave' (car removed, results not held up) and a quitting host can't restart over live races.
function quitRace() {
  if (race?.opts.mode === 'online') leaveRoom();
  endRace();
}

function onFinish(res) {
  if (!race || race.done) return;
  race.done = true;
  let rewards = [];
  try { rewards = applyRewards(res); } catch (e) { console.error('reward error', e); }
  refreshWallet();
  showResults(res, rewards);
  if (res.mode === 'ghost') lbRun(res).catch(e => console.warn('lb', e));
}

// Records, ghosts and the coin multiplier are per course (the one the UI launched).
const raceTrack = () => (TRACK_BY_ID[race?.opts.trackId] ? race.opts.trackId : DEFAULT_TRACK);
// solo: the CPU difficulty it was raced at (the place prize x its coinMul, on top of the course's)
const raceLevel = () => (race?.opts.mode === 'solo' && Object.hasOwn(DIFFICULTY_BY_ID, String(race.opts.cpuLevel)) ? DIFFICULTY_BY_ID[race.opts.cpuLevel] : null);
function applyRewards(res) {
  const out = [], locals = res.locals || [], multi = locals.length > 1, tid = raceTrack(), mul = coinMul(tid);
  const firstClear = save.stats.races === 0, coins = n => Math.round(n * mul);
  // time attack alone or against a ranking ghost: no win prize (a slow ranking ghost could be farmed)
  const alone = res.mode === 'ghost' && (!race?.opts.ghost || race.opts.ghost.lb);
  // CPU level (solo: one local car): a weaker one (coinMul < 1) always pays less; a stronger one's extra is paid per CPU
  // beaten, so finishing behind them all pays like ふつう (the bonus is for beating them, not for picking them)
  const lv = raceLevel(), cpus = (res.placements?.length || 1) - 1, beaten = lv && locals[0] ? Math.max(0, cpus + 1 - locals[0].place) : 0;
  const lmul = !lv ? 1 : lv.coinMul < 1 || !cpus ? Math.min(1, lv.coinMul) : +(1 + (lv.coinMul - 1) * beaten / cpus).toFixed(2);
  let finished = false, won = false;
  if (mul > 1 && locals.some(L => L.time != null)) out.push({ label: `コース難易度 ${'★'.repeat(TRACK_BY_ID[tid].difficulty)} コイン×${mul}` });
  if (lv && lv.coinMul !== 1 && locals.some(L => L.time != null)) out.push({ label: `CPU ${lv.name}${lv.coinMul > 1 ? ` ${beaten}/${cpus}台に勝利` : ''} 賞金×${lmul}` });
  for (const L of locals) {
    const tag = multi ? `${String(L.control).toUpperCase()} ` : '';
    if (L.time == null) { out.push({ label: `${tag}リタイア` }); continue; }
    finished = true;
    const place = alone ? 2 : L.place, pc = Math.round((ECONOMY.placeCoins[place - 1] || 0) * mul * lmul);
    if (pc) { save.coins += pc; out.push({ label: `${tag}${alone ? 'タイムアタック完走' : `${place}位 賞金`}`, coins: pc }); }
    if (place === 1) { won = true; save.tickets += ECONOMY.winTickets; out.push({ label: `${tag}1位ボーナス`, tickets: ECONOMY.winTickets }); }
    const rec = save.cars[L.carId];
    if (!rec) continue;
    const b = (rec.best ||= {})[tid] ||= { lap: null, race: null };
    if (L.bestLap != null && (b.lap == null || L.bestLap < b.lap)) {
      b.lap = L.bestLap;
      save.coins += coins(ECONOMY.bestLapBonus);
      out.push({ label: `${tag}ベストラップ更新 ${fmt(L.bestLap)}`, coins: coins(ECONOMY.bestLapBonus), hot: true });
    }
    if (b.race == null || L.time < b.race) { b.race = L.time; out.push({ label: `${tag}自己ベスト更新 ${fmt(L.time)}`, hot: true }); }
  }
  if (res.beatGhost && !alone) { save.coins += coins(ECONOMY.beatGhostBonus); out.push({ label: 'ゴースト撃破', coins: coins(ECONOMY.beatGhostBonus), hot: true }); }
  if (finished) {
    if (firstClear) { save.tickets += ECONOMY.firstClearTickets; out.push({ label: '初完走ボーナス', tickets: ECONOMY.firstClearTickets, hot: true }); }
    save.stats.races++;
    if (won) save.stats.wins++;
  }
  const g = res.ghostRecording;
  if (g && CAR_BY_ID[g.carId] && isFinite(g.time)) {
    const old = validGhost(g.carId, tid);
    if (!old || g.time < old.time) out.push({ label: saveGhost(g.carId, tid, { ...g, trackId: tid }) ? (old ? 'ゴーストを更新しました' : 'ゴーストを保存しました') : 'ゴーストを保存できませんでした（容量不足）' });
  }
  persist();
  return out;
}

function showResults(res, rewards) {
  const locals = res.locals || [], L = locals[0];
  let title = 'フィニッシュ！', win = false;
  if (res.mode === 'ghost') {
    win = !!res.beatGhost;
    title = res.beatGhost ? 'ゴースト撃破！' : res.beatGhost === false ? 'ゴーストに負けた…' : 'フィニッシュ！';
  } else if (res.mode === 'split') {
    const b = locals.filter(l => l.time != null).sort((a, c) => a.place - c.place)[0];
    if (b) { title = `${String(b.control).toUpperCase()} の勝利！`; win = true; }
  } else if (L) {
    if (L.time == null) title = 'リタイア';
    else if (L.place === 1) { title = '優勝！'; win = true; } else title = `${L.place}位 フィニッシュ`;
  }
  const t = $('#rTitle');
  t.textContent = title;
  t.classList.toggle('win', win);

  const ghost = res.mode === 'ghost' ? race?.opts.ghost : null, lv = raceLevel();
  $('#rSub').innerHTML = `<div class="rs-course">${esc(TRACK_BY_ID[raceTrack()].name)}${lv ? ` ・ CPU ${esc(lv.name)}` : ''}</div>`
    + (lv?.id === 'legend' && L?.place === 1 && L.time != null ? '<span class="lg-badge">伝説 撃破</span>' : '') + locals.map(l => {
    const diff = ghost && l.time != null ? l.time - ghost.time : null;
    return `<div>${locals.length > 1 ? `${esc(String(l.control).toUpperCase())} ・ ` : ''}タイム <b>${fmt(l.time)}</b> ・ ベストラップ <b>${fmt(l.bestLap)}</b>${diff != null ? ` ・ ゴースト差 <b>${diff > 0 ? '+' : ''}${diff.toFixed(3)}</b>` : ''}</div>`;
  }).join('');

  const rows = (res.placements || []).map(p => ({ ...p }));
  if (ghost) { rows.push({ name: ghost.name || 'ゴースト', carId: ghost.carId, time: ghost.time, gh: true }); rows.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity)); }
  $('#rTable').innerHTML = rows.map((p, i) => {
    const c = CAR_BY_ID[p.carId];
    return `<li class="${p.isLocal ? 'me' : ''} ${p.gh ? 'gh' : ''}" style="--i:${i};--rc:${c ? RARITY[c.rarity].color : '#888'}"><span class="pos">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="cr">${c ? esc(c.name) : ''}</span><span class="tm">${p.time == null ? 'DNF' : fmt(p.time)}</span></li>`;
  }).join('');

  const tc = rewards.reduce((a, r) => a + (r.coins || 0), 0), tt = rewards.reduce((a, r) => a + (r.tickets || 0), 0);
  const amt = r => `${r.coins ? `+${r.coins.toLocaleString()}<i class="ic-coin"></i>` : ''}${r.tickets ? `+${r.tickets}<i class="ic-ticket"></i>` : ''}`;
  $('#rRewards').innerHTML = rewards.map((r, i) => `<div class="rw ${r.hot ? 'hot' : ''}" style="--i:${i}"><span>${esc(r.label)}</span><b>${amt(r)}</b></div>`).join('')
    + (tc || tt ? `<div class="rw total" style="--i:${rewards.length}"><span>合計</span><b>${amt({ coins: tc, tickets: tt })}</b></div>` : '');
  rewards.forEach((r, i) => { if (r.coins || r.tickets) setTimeout(sfx.coin, 450 + i * 140); });

  const online = res.mode === 'online';
  $('#rAgain').textContent = online ? 'ロビーへ' : 'もう一度';
  $('#rMenu').textContent = online ? '退出してメニューへ' : 'メニューへ';
  $('#rLbBtn').hidden = res.mode !== 'ghost';
  $('#rLb').hidden = true;
  $('#rConfetti').innerHTML = win ? confetti() : '';
  if (win) sfx.fanfare();
  $('#results').classList.remove('hidden');
}
function confetti() {
  const cols = ['#22e6ff', '#ff2bd6', '#ffc94d', '#3dffa8', '#ffffff', '#8a5cff'];
  return Array.from({ length: 90 }, () => `<i style="left:${Math.random() * 100}%;--c:${cols[Math.random() * cols.length | 0]};--d:${(Math.random() * 1.6).toFixed(2)}s;--t:${(2.2 + Math.random() * 2).toFixed(2)}s;--x:${((Math.random() - 0.5) * 240).toFixed(0)}px;--r:${(Math.random() * 1080).toFixed(0)}deg"></i>`).join('');
}
function hideResults() { $('#results').classList.add('hidden'); $('#rConfetti').innerHTML = ''; }

/* ================= online ================= */
const NET = { s: null, offs: [], busy: false, roster: null };
const roster = () => (NET.roster || NET.s?.roster || []).slice(0, 4);
function status(msg, kind = '') { const el = $('#onStatus'); el.textContent = msg; el.className = 'status ' + kind; }
const me = () => { const id = save.selected.p1; return { name: save.name, carId: id, look: { ...save.cars[id].look } }; };
function myNet() {
  if (!NET.s) return;
  try { NET.s.setMe(me()); } catch (e) { console.warn(e); }
}
function renderOnline() {
  const s = NET.s;
  $('#onEntry').hidden = !!s;
  $('#onRoom').hidden = !s;
  $('#onName').value = save.name;
  $('#btnHost').disabled = $('#btnJoin').disabled = NET.busy;
  const id = save.selected.p1;
  mount($('#onSlot'), [S1]);
  S1.set(id, save.cars[id].look);
  fillPicker('p1');
  $('#onCoursePanel').hidden = !s;
  if (s) { $('#roomCode').textContent = s.code; renderRoster(); }
}
function renderLobbyCourses() {
  const s = NET.s;
  if (!s || cur !== 'online') return;
  $('#onCourseNote').textContent = s.isHost ? 'コースを選ぶと全員に反映されます' : 'ホストがコースを選びます';
  renderCourses($('#onCourses'), TRACK_BY_ID[s.trackId] ? s.trackId : DEFAULT_TRACK, { ro: !s.isHost });
}
// Build ids in the room: the newest wins, everyone else is outdated ('' = a build from before versions existed). Only
// same-build rooms start: an outdated player's cached files miss fixes (an old one had no P2P: '中継 150ms' lag).
function lobbyVer() {
  const s = NET.s, list = roster();
  const v = r => (r.pid === s.pid ? BUILD : typeof r.v === 'string' ? r.v : '');
  const newest = list.reduce((a, r) => (v(r) > a ? v(r) : a), BUILD);
  return { old: r => v(r) !== newest, any: list.some(r => v(r) !== newest), me: BUILD !== newest, host: !!list[0] && v(list[0]) !== newest };
}
function renderRoster() {
  const s = NET.s;
  if (!s || cur !== 'online') return;
  const list = roster(), ver = lobbyVer();
  $('#roster').innerHTML = [0, 1, 2, 3].map(i => {
    const r = list[i];
    if (!r) return `<li class="empty"><span class="slot">P${i + 1}</span><span class="nm">募集中…</span><span></span></li>`;
    const c = CAR_BY_ID[r.carId];
    return `<li style="--rc:${c ? RARITY[c.rarity].color : '#667'}"><span class="slot">P${i + 1}</span><span class="nm">${esc(cleanName(r.name))}${i === 0 ? '<em class="host">HOST</em>' : ''}${r.pid === s.pid ? '<em class="you">YOU</em>' : ''}${ver.old(r) ? '<em class="old">バージョンが古い</em>' : ''}</span><span class="car">${c ? rb(c.rarity) + esc(c.name) : ''}</span></li>`;
  }).join('');
  renderLobbyCourses();
  const go = $('#btnGo');
  go.hidden = !s.isHost;
  go.disabled = list.length < 2 || ver.any;
  $('#roomWait').textContent = s.isHost
    ? (list.length < 2 ? '2人以上そろうとスタートできます' : ver.any ? '全員のバージョンがそろうとスタートできます' : '準備OK！ スタートを押そう')
    : 'ホストがスタートするのを待っています…';
  const warn = $('#onVer');
  warn.hidden = !ver.any;
  warn.innerHTML = ver.me
    ? `<span>あなたのバージョンが古いです。更新してね${s.isHost ? '（部屋は閉じます）' : '（更新後この部屋に戻ります）'}</span><button class="btn primary big wide" data-update>更新</button>`
    : ver.host ? '<span>ホストのバージョンが古いです。ホストにページを更新（再読み込み）してもらってね</span>'
    : '<span>バージョンが古いプレイヤーがいます。その人が更新（再読み込み）するまでスタートできません</span>';
}
async function connect(host) {
  if (NET.busy || NET.s) return;
  const code = $('#codeIn').value.trim().toUpperCase();
  if (!host && code.length !== 5) { sfx.error(); status('5文字のルームコードを入力してね', 'err'); return; }
  NET.busy = true;
  renderOnline();
  status(host ? '部屋を作成中…' : '接続中…', 'busy');
  try {
    const s = host ? await hostRoom(save.name) : await joinRoom(code, save.name, me());
    NET.s = s; NET.roster = null;
    NET.offs = [
      s.on('roster', m => { const a = Array.isArray(m) ? m : m?.roster; if (Array.isArray(a)) NET.roster = a; renderRoster(); }),
      s.on('leave', () => renderRoster()),
      s.on('start', onNetStart),
      s.on('closed', onNetClosed),
    ];
    if (s.isHost) s.setTrack?.(curTrack());
    myNet();
    status('');
    sfx.unlock();
  } catch (e) {
    sfx.error();
    status(e?.message || '接続に失敗しました', 'err');
  }
  NET.busy = false;
  if (cur === 'online') renderOnline(); else leaveRoom();   // user navigated away while connecting
}
function leaveRoom() {
  const s = NET.s;
  if (!s) return;
  NET.offs.forEach(f => { try { f?.(); } catch { /* ignore */ } });
  NET.offs = []; NET.s = null; NET.roster = null;
  try { s.close(); } catch { /* ignore */ }
}
function onNetClosed() {
  const r = race?.opts.mode === 'online' ? race : null;
  leaveRoom();
  modalClose?.();
  sfx.error();
  toast('接続が切れました（ホストが退出した可能性があります）', 'err');
  // A running race handles 'closed' itself (this handler runs first): it finalizes a finished run or quits via onQuit,
  // and results already on screen stay readable.
  if (r?.live) return;
  if (r) teardownRace();
  if (r || cur === 'online') show('online', false);
}
function onNetStart(m) {
  const s = NET.s;
  if (!s) return;
  const list = (Array.isArray(m?.roster) ? m.roster : roster()).slice(0, 4);
  if (!list.some(r => r.pid === s.pid)) return;
  if (race) teardownRace();
  modalClose?.();
  const players = list.map(r => {
    const carId = CAR_BY_ID[r.carId] ? r.carId : STARTER_CAR, local = r.pid === s.pid, rec = local ? save.cars[carId] : null;
    return {
      name: cleanName(local ? save.name : r.name), carId,
      look: rec ? { ...rec.look } : cleanLook(r.look, carId),
      stats: computeStats(carId, rec ? rec.nodes : []),
      control: local ? 'p1' : 'net', pid: String(r.pid),
    };
  });
  if (cur !== 'online') show('online', false);
  launch({ mode: 'online', trackId: TRACK_BY_ID[s.trackId] ? s.trackId : DEFAULT_TRACK, players, net: s, localPid: s.pid }, 'online');
}

/* ================= gacha ================= */
function renderGacha() {
  mount(null);
  $$('[data-pull]').forEach(b => {
    const n = +b.dataset.pull, tk = b.dataset.pay === 't', cost = pullCost(n, tk);
    b.innerHTML = tk ? `<i class="ic-ticket"></i>チケット ×${cost}` : `<i class="ic-coin"></i>${cost.toLocaleString()} コイン`;
    b.disabled = (tk ? save.tickets : save.coins) < cost;
  });
  $('#guarText').textContent = `${GACHA.tenGuarantee}以上 1枠確定！`;
  const have = owned().length;
  $('#collect').innerHTML = `コレクション <b>${have}</b> / ${CARS.length}<div class="prog"><i style="width:${have / CARS.length * 100}%"></i></div>`;
  const guar = RARITY_ORDER.slice(rIdx(GACHA.tenGuarantee)), gsum = guar.reduce((a, r) => a + RARITY[r].rate, 0);
  $('#rateTable').innerHTML = [...RARITY_ORDER].reverse().map(r => {
    const list = CARS.filter(c => c.rarity === r), per = RARITY[r].rate / list.length * 100;
    return `<div class="rate-row" style="--rc:${RARITY[r].color}"><div class="rate-h">${rb(r)}<b>${(RARITY[r].rate * 100).toFixed(0)}%</b></div><ul>${list.map(c => `<li class="${save.cars[c.id] ? 'own' : ''}"><span>${esc(c.name)}</span><em>${per.toFixed(2)}%</em></li>`).join('')}</ul></div>`;
  }).join('') + `<p class="note">※10連で${GACHA.tenGuarantee}以上が1台も出なかった場合、最後の1枠は${guar.map(r => `${r} ${(RARITY[r].rate / gsum * 100).toFixed(1)}%`).join(' / ')}で抽選。<br>※重複：1回目は限界突破（Tier4解放）、2回目以降はレアリティに応じたコインに変換。</p>`;
}

function rollCar(min = 'N') {
  const pool = RARITY_ORDER.slice(rIdx(min));
  let x = Math.random() * pool.reduce((a, r) => a + RARITY[r].rate, 0), rar = pool[pool.length - 1];
  for (const r of pool) { if ((x -= RARITY[r].rate) < 0) { rar = r; break; } }
  const list = CARS.filter(c => c.rarity === rar);
  return list[Math.random() * list.length | 0];
}
function rollGacha(n) {
  const cars = [];
  for (let i = 0; i < n; i++) {
    const guarantee = n === 10 && i === 9 && !cars.some(c => rIdx(c.rarity) >= rIdx(GACHA.tenGuarantee));
    cars.push(rollCar(guarantee ? GACHA.tenGuarantee : 'N'));
  }
  return cars.map(car => {
    const rec = save.cars[car.id];
    if (!rec) { save.cars[car.id] = newCarRec(car.id); return { car, kind: 'new', coins: 0 }; }
    if (++rec.dupes === 1) return { car, kind: 'limit', coins: 0 };
    const coins = RARITY[car.rarity].dupeCoins;
    save.coins += coins;
    return { car, kind: 'dupe', coins };
  });
}

let pulling = false;
async function pull(n, tk) {
  if (pulling) return;
  const cost = pullCost(n, tk);
  if ((tk ? save.tickets : save.coins) < cost) { sfx.error(); toast(tk ? 'チケットが足りません' : 'コインが足りません', 'err'); return; }
  pulling = true;
  if (tk) save.tickets -= cost; else save.coins -= cost;
  const results = rollGacha(n);
  persist();
  refreshWallet();
  try { await playFx(results); } catch (e) { console.error(e); $('#gfx').className = 'hidden'; }
  pulling = false;
  if (cur === 'gacha') renderGacha();
}

const fx = { skip: false, wake: [], anim: false };
const fxWait = ms => new Promise(r => {
  if (fx.skip) return r();
  const t = setTimeout(r, ms);
  fx.wake.push(() => { clearTimeout(t); r(); });
});
function fxSkip() { if (!fx.anim) return; fx.skip = true; fx.wake.splice(0).forEach(f => f()); }

function particles(col, ri) {
  const n = 36 + ri * 24;
  $('#gParts').innerHTML = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * (240 + ri * 130);
    const c = ri === 3 && Math.random() < 0.5 ? `hsl(${Math.random() * 360 | 0} 100% 65%)` : Math.random() < 0.3 ? '#fff' : col;
    return `<i style="--dx:${(Math.cos(a) * d).toFixed(0)}px;--dy:${(Math.sin(a) * d).toFixed(0)}px;--s:${(4 + Math.random() * 10).toFixed(1)}px;--c:${c};--t:${(0.7 + Math.random() * 0.9).toFixed(2)}s;--r:${Math.random() * 720 | 0}deg"></i>`;
  }).join('');
}
const tagHTML = it => it.kind === 'new' ? '<span class="tag new">NEW!</span>'
  : it.kind === 'limit' ? '<span class="tag limit">限界突破！</span><small>Tier4スキルが解放可能になった！</small>'
  : `<span class="tag dupe">重複</span><small>+${it.coins.toLocaleString()} コインに変換</small>`;

function reveal(it) {
  const c = it.car, rec = save.cars[c.id], meta = $('#gMeta');
  mount($('#gSlot'), [S1], 1.1);
  S1.key = '';                // force rebuild so the pop-in animation always plays
  S1.set(c.id, rec ? rec.look : defLook(c.id));
  S1.flash = 1;
  meta.dataset.r = c.rarity;
  meta.style.setProperty('--rc', RARITY[c.rarity].color);
  $('#gRar').textContent = c.rarity;
  $('#gName').textContent = c.name;
  $('#gTag').innerHTML = tagHTML(it);
  meta.classList.remove('in'); void meta.offsetWidth; meta.classList.add('in');
}
function gridFx(results) {
  const g = $('#gGrid');
  g.innerHTML = results.map((it, i) => `<button class="gc" data-i="${i}" data-r="${it.car.rarity}" style="--rc:${RARITY[it.car.rarity].color};--i:${i}"><img alt=""><span class="gc-r">${it.car.rarity}</span><span class="gc-n">${esc(it.car.name)}</span><span class="gc-t ${it.kind}">${it.kind === 'new' ? 'NEW' : it.kind === 'limit' ? '限界突破' : '+' + it.coins}</span></button>`).join('');
  results.forEach((it, i) => {
    setTimeout(() => sfx.card(rIdx(it.car.rarity) * 2 + i * 0.3), 150 + i * 90);
    thumb(it.car.id, save.cars[it.car.id]?.look || defLook(it.car.id)).then(u => { const img = g.querySelector(`[data-i="${i}"] img`); if (u && img) img.src = u; });
  });
  g.onclick = e => {
    const b = e.target.closest('.gc');
    if (!b) return;
    $$('.gc', g).forEach(x => x.classList.toggle('sel', x === b));
    reveal(results[+b.dataset.i]);
  };
}

async function playFx(results) {
  const best = results.reduce((a, b) => rIdx(b.car.rarity) > rIdx(a.car.rarity) ? b : a);
  const ri = rIdx(best.car.rarity), col = RARITY[best.car.rarity].color;
  const g = $('#gfx'), cap = $('#gCap');
  Object.assign(fx, { skip: false, wake: [], anim: true });
  hideTip();
  g.className = results.length > 1 ? 'ten' : '';
  g.dataset.r = best.car.rarity;
  g.style.setProperty('--rc', col);
  $('#gParts').innerHTML = ''; $('#gGrid').innerHTML = '';
  cap.style.setProperty('--glow', '#dfe6ff'); cap.style.setProperty('--pow', 0);
  mount(null);
  void g.offsetWidth;
  g.classList.add('p-drop');
  sfx.drop();
  await fxWait(650);
  const shakes = 2 + ri;
  for (let i = 0; i < shakes; i++) {
    cap.style.setProperty('--glow', RARITY[RARITY_ORDER[Math.min(i, ri)]].color);
    cap.style.setProperty('--pow', (i + 1) / shakes);
    cap.style.setProperty('--amp', `${6 + i * 4}deg`);
    cap.classList.remove('jolt'); void cap.offsetWidth; cap.classList.add('jolt');
    sfx.shake(i);
    await fxWait(i === shakes - 1 ? 650 : 460);
  }
  cap.classList.remove('jolt');
  g.classList.add('p-burst');
  if (ri >= 2) g.classList.add('quake');
  sfx.burst(ri);
  particles(col, ri);
  await fxWait(700);
  fx.anim = false;
  g.classList.add('p-reveal');
  if (results.length > 1) gridFx(results);
  reveal(best);
  $('#gOk').focus({ preventScroll: true });   // phones: keep the big reveal in view, the 10連 cards are below
  await new Promise(r => { $('#gOk').onclick = r; });
  g.className = 'hidden';
}

/* ================= garage ================= */
let gaFocus = null, lookT = 0;
const SW_BODY = ['#ff2bd6', '#22e6ff', '#ffd23f', '#3dffa8', '#ff4d4d', '#8a5cff', '#ffffff', '#1b1f2e'];
const SW_WHEEL = ['#222222', '#c0c0c0', '#ffd23f', '#ff2bd6', '#22e6ff', '#ffffff'];

function loadThumb(id) {
  const rec = save.cars[id];
  thumb(id, rec ? rec.look : defLook(id)).then(u => {
    const img = $(`#gaCards [data-car="${id}"] img`);
    if (img && u) { img.src = u; img.classList.add('ok'); }
  });
}
function renderGarage() {
  if (!CAR_BY_ID[gaFocus]) gaFocus = save.selected.p1;
  $('#gaCount').textContent = `${owned().length} / ${CARS.length}`;
  $('#gaCards').innerHTML = CARS.map(c => {
    const rec = save.cars[c.id];
    const sel = rec ? ['p1', 'p2'].filter(p => save.selected[p] === c.id) : [];
    return `<button class="card ${rec ? '' : 'locked'}" data-car="${c.id}" data-r="${c.rarity}" style="--rc:${RARITY[c.rarity].color}">${rb(c.rarity)}${rec?.dupes ? '<span class="star" title="限界突破">★</span>' : ''}<img alt=""><span class="cn">${rec ? esc(c.name) : '？？？'}</span><span class="sel">${sel.map(p => `<em class="${p}">${p.toUpperCase()}</em>`).join('')}</span></button>`;
  }).join('');
  CARS.forEach(c => loadThumb(c.id));
  renderGaDetail();
}
function renderGaDetail() {
  const id = gaFocus, c = CAR_BY_ID[id], rec = save.cars[id], d = $('#gaDetail');
  $$('#gaCards .card').forEach(el => el.classList.toggle('focus', el.dataset.car === id));
  mount($('#gaSlot'), [S1]);
  S1.set(id, rec ? rec.look : defLook(id), !rec);
  d.classList.toggle('locked', !rec);
  d.style.setProperty('--rc', RARITY[c.rarity].color);
  $('#gaHead').innerHTML = `${rb(c.rarity)}<h2>${rec ? esc(c.name) : '？？？'}</h2>${rec?.dupes ? '<span class="lbk">★ 限界突破</span>' : ''}`;
  if (!rec) {
    $('#gaInfo').innerHTML = '<p class="lockmsg">まだ持っていない車です。ガチャで手に入れよう！</p><button class="btn primary" data-go="gacha">ガチャへ</button>';
    return;
  }
  const st = computeStats(id, rec.nodes);
  $('#gaInfo').innerHTML = `<div class="abil" style="margin:0">${abilityHTML(st)}</div>${barsHTML(id, rec.nodes)}<div class="crecs"><div class="crh"><span>コース記録</span><span>レース</span><span>ラップ</span></div>${TRACKS.map(t => { const b = bestOf(id, t.id); return `<div style="--tc:${THEME[t.theme].c}"><span>${esc(t.name)}</span><b>${fmt(b.race)}</b><b>${fmt(b.lap)}</b></div>`; }).join('')}</div>`;
  $('#lkBody').value = hex6(rec.look.body) || c.color;
  $('#lkWheel').value = hex6(rec.look.wheel) || '#222222';
  $('#lkWing').checked = !!rec.look.wing;
  for (const p of ['p1', 'p2']) {
    const b = $('#ga' + p.toUpperCase()), on = save.selected[p] === id;
    b.classList.toggle('on', on);
    b.textContent = on ? `${p.toUpperCase()} 使用中` : `${p.toUpperCase()}で使う`;
  }
}
function readLook() {
  const rec = save.cars[gaFocus];
  if (!rec) return null;
  rec.look = { body: $('#lkBody').value, wheel: $('#lkWheel').value, wing: $('#lkWing').checked };
  return rec;
}
function commitLook() {
  const rec = readLook();
  if (!rec) return;
  persist();
  S1.set(gaFocus, rec.look);
  loadThumb(gaFocus);
  if (save.selected.p1 === gaFocus) myNet();
}

/* ================= skill tree ================= */
let treeCar = null;
const ANG = [-90, 30, 150], DIST = [228, 304, 380, 456], NR = 34, ROMAN = ['I', 'II', 'III', 'IV'];
const LOCK = '<g class="lk"><rect x="-10" y="-3" width="20" height="16" rx="3"/><path d="M-6 -3v-5a6 6 0 0 1 12 0v5"/></g>';

function nodeState(id, rec, n) {
  const why = nodeBlockReason(rec, n.id), cost = nodeCost(id, n.id);
  const st = rec.nodes.includes(n.id) ? 'on' : why ? 'lock' : 'avail';
  const poor = st === 'avail' && save.coins < cost;
  const sub = st === 'on' ? '解放済み' : st === 'avail' ? `${cost.toLocaleString()} コイン` : n.tier === 4 && rec.dupes < 1 ? '限界突破が必要' : 'ロック中';
  return { st, poor, cost, why, sub };
}
function treeSVG(id, rec) {
  let lines = '', nodes = '', labels = '', names = '';
  SKILL_TREE.forEach((b, bi) => {
    const a = ANG[bi] * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const [ox, oy] = bi === 0 ? [50, -2] : [dx > 0 ? 29 : -29, -50];
    const anchor = bi === 2 ? 'end' : 'start';
    let px = dx * 160, py = dy * 160;
    b.nodes.forEach((n, ti) => {
      const x = dx * DIST[ti], y = dy * DIST[ti], S = nodeState(id, rec, { ...n, tier: ti + 1 });
      const seg = `x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(x - dx * NR).toFixed(1)}" y2="${(y - dy * NR).toFixed(1)}"`;
      lines += `<line class="ln" ${seg}/>` + (S.st === 'on' ? `<line class="ln lit" ${seg} style="--bc:${b.color}"/>` : '');
      const icon = S.st === 'lock' ? (ti === 3 && rec.dupes < 1 ? '<text class="star" dy="10">★</text>' : LOCK) : `<text class="tier" dy="9">${ROMAN[ti]}</text>`;
      nodes += `<g class="nd ${S.st}${S.poor ? ' poor' : ''}" data-node="${n.id}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" style="--bc:${b.color}" tabindex="0" role="button" aria-label="${esc(n.name)}：${esc(S.sub)}"><circle class="halo" r="${NR + 9}"/><circle class="core" r="${NR}"/>${icon}</g>`;
      const lx = (x + ox).toFixed(1);
      labels += `<text class="lbl ${S.st}${S.poor ? ' poor' : ''}" x="${lx}" y="${(y + oy).toFixed(1)}" text-anchor="${anchor}">${esc(n.name)}<tspan class="t2" x="${lx}" dy="24">${esc(S.sub)}</tspan></text>`;
      px = x + dx * NR; py = y + dy * NR;
    });
    names += `<text class="bname" x="${(dx * 535).toFixed(1)}" y="${(dy * 535 + 9).toFixed(1)}" text-anchor="middle" style="fill:${b.color}">${esc(b.name)}</text>`;
  });
  return `<defs><filter id="glow" filterUnits="userSpaceOnUse" x="-600" y="-620" width="1200" height="960"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><circle class="hub" r="160"/>${lines}${nodes}${labels}${names}`;
}
function renderTree() {
  if (!save.cars[treeCar]) treeCar = save.selected.p1;
  const id = treeCar, c = CAR_BY_ID[id], rec = save.cars[id];
  $('#tCars').innerHTML = owned().map(o => `<button class="tchip ${o.id === id ? 'on' : ''}" data-tcar="${o.id}" style="--rc:${RARITY[o.rarity].color}">${rb(o.rarity)}${esc(o.name)}</button>`).join('');
  // centre the chip horizontally only: scrollIntoView would also scroll #main back up on phones (list below the tree)
  const strip = $('#tCars'), chip = $('.on', strip);
  if (chip) strip.scrollLeft += chip.getBoundingClientRect().left - strip.getBoundingClientRect().left - (strip.clientWidth - chip.offsetWidth) / 2;
  // phones pan a tree wider than the screen (mobile.css): start each car centred on its nodes
  const pan = $('.t-pan');
  if (pan.dataset.car !== id) { pan.dataset.car = id; pan.scrollLeft = (pan.scrollWidth - pan.clientWidth) / 2; pan.scrollTop = pan.scrollHeight * 0.52 - pan.clientHeight / 2; }
  mount($('#tSlot'), [S1], 0.4);
  S1.set(id, rec.look);
  $('#tSvg').innerHTML = treeSVG(id, rec);
  const list = SKILL_TREE.map(b => `<div class="sk-b" style="--bc:${b.color}"><h4>${esc(b.name)}</h4>${b.nodes.map((n, ti) => {
    const S = nodeState(id, rec, { ...n, tier: ti + 1 });
    return `<button class="sk ${S.st}${S.poor ? ' poor' : ''}" data-node="${n.id}"><span class="sk-i">${ROMAN[ti]}</span><span class="sk-n">${esc(n.name)}</span><span class="sk-c">${esc(S.sub)}</span></button>`;
  }).join('')}</div>`).join('');
  $('#tSide').innerHTML = `<div class="t-head">${rb(c.rarity)}<h3>${esc(c.name)}</h3></div>
    <div class="t-prog">解放 <b>${rec.nodes.length}</b> / ${ALL_NODES.length}${rec.dupes ? '<span class="lbk">★ 限界突破済み</span>' : '<span class="lbk off">限界突破：未（同じ車をガチャで引く）</span>'}</div>
    ${barsHTML(id, rec.nodes)}${list}<p class="hint">ノードをクリック（タップ）して解放。コインはレースで稼げます。</p>`;
}
async function clickNode(nid) {
  const id = treeCar, n = NODE_BY_ID[nid];
  let rec = save.cars[id];
  if (!rec || !n) return;
  const why = nodeBlockReason(rec, nid);
  if (why) { if (why !== '解放済み') { sfx.error(); toast(why, 'err'); } return; }
  const cost = nodeCost(id, nid), ok = save.coins >= cost;
  hideTip();
  const yes = await ask({
    title: 'スキル解放',
    html: `<p>「${esc(n.name)}」を解放しますか？</p>${n.desc ? `<p>${esc(n.desc)}</p>` : ''}<p>費用 <b>${cost.toLocaleString()}</b> コイン（所持 ${save.coins.toLocaleString()}）</p>${ok ? '' : '<p class="err">コインが足りません</p>'}`,
    yes: '解放する', yesDisabled: !ok,
  });
  rec = save.cars[id];   // another tab may have replaced the save while the dialog was open
  if (!yes || !rec || treeCar !== id || nodeBlockReason(rec, nid) || save.coins < cost) return;
  save.coins -= cost;
  rec.nodes.push(nid);
  persist();
  sfx.unlock();
  refreshWallet();
  if (cur === 'tree') { renderTree(); $(`#tSvg .nd[data-node="${nid}"]`)?.classList.add('just'); }
  toast(`「${n.name}」を解放しました！`);
}
function showTip(g) {
  const nid = g.dataset.node, n = NODE_BY_ID[nid], rec = save.cars[treeCar];
  if (!n || !rec) return;
  const b = SKILL_TREE.find(x => x.branch === n.branch), S = nodeState(treeCar, rec, n);
  const cls = S.st === 'on' ? 'on' : S.st === 'lock' ? 'lock' : S.poor ? 'poor' : 'ok';
  const txt = S.st === 'on' ? '✓ 解放済み' : S.st === 'lock' ? `ロック：${S.why}` : `費用 ${S.cost.toLocaleString()} コイン${S.poor ? '（不足）' : ''}`;
  const tip = $('#tip');
  tip.innerHTML = `<div class="tp-h" style="color:${b.color}">${esc(b.name)} ・ TIER ${ROMAN[n.tier - 1]}</div><b>${esc(n.name)}</b>${n.desc ? `<p>${esc(n.desc)}</p>` : ''}<div class="tp-s ${cls}">${esc(txt)}</div>`;
  tip.classList.add('show');
  const r = g.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let y = r.top - th - 10;
  if (y < 8) y = r.bottom + 10;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tw - 8, r.left + r.width / 2 - tw / 2))}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { $('#tip').classList.remove('show'); }

/* ================= settings ================= */
function renderSettings() {
  mount(null);
  $('#setName').value = save.name;
  $('#setSound').checked = save.sound !== false;
  $$('#setQuality button').forEach(b => b.classList.toggle('on', b.dataset.q === save.quality));
  mountTouchSettings($('#setQuality').closest('.srow'), toast);   // 操作設定 (touch devices only)
  $('#setStats').innerHTML = `<span>レース<b>${save.stats.races}</b></span><span>優勝<b>${save.stats.wins}</b></span><span>コレクション<b>${owned().length}/${CARS.length}</b></span>`;
  renderSyncSettings();   // データ連携 (sync.js)
}
function setName(v) {
  save.name = String(v).replace(/\s+/g, ' ').trim().slice(0, 12) || 'Player';
  persist();
  myNet();
  return save.name;
}

/* ================= leaderboard (lb.js) ================= */
// Time attacks (ghost mode: no CPUs / other players) go to the online ranking per course, overall and per rarity.
const LB = { metric: 'race', bucket: 'all', tok: 0, rows: [], me: null };
const ymd = t => { const d = new Date(t); return t ? `${d.getFullYear() === new Date().getFullYear() ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}` : ''; };
function lbRow(e, me) {
  const m = LB.metric, id = m === 'race' ? e.raceCar : e.lapCar, r = rarityOf(id), go = m === 'race';
  return `<li class="${me ? 'me' : ''}${go ? ' go' : ''}" data-uid="${esc(e.uid)}"${go ? ' tabindex="0"' : ''} style="--rc:${r ? RARITY[r].color : '#888'}">`
    + `<span class="pos">${rankText(e.rank)}</span><span class="nm">${esc(e.name)}</span>`
    + `<span class="cr">${r || ''} ${esc(CAR_BY_ID[id]?.name || id)} ・ ${ymd(m === 'race' ? e.raceAt : e.lapAt)}</span><span class="tm">${fmt(e[m])}</span></li>`;
}
function renderLb() {
  mount(null);
  const tid = curTrack(), list = $('#lbList'), tok = ++LB.tok;
  renderCourses($('#lbCourses'), tid);
  $$('#lbMetric button').forEach(b => b.classList.toggle('on', b.dataset.m === LB.metric));
  $$('#lbBucket button').forEach(b => b.classList.toggle('on', b.dataset.b === LB.bucket));
  $('#lbHint').textContent = LB.metric === 'race' && lbReady() ? 'タップでそのゴーストと対戦（いま選んでいる車で）' : '';
  const msg = (t, x = '') => { list.innerHTML = `<li class="lb-msg">${t}</li>${x}`; };
  if (!lbReady()) return msg('オンラインランキングは準備中です');
  if (!navigator.onLine) return msg('オフラインです。電波が戻ると自動で読み込みます');   // (the SDK would wait out a 12 s timeout)
  msg('読み込み中…');
  lbTop(tid, LB.bucket, LB.metric).then(({ rows, me }) => {
    if (tok !== LB.tok) return;
    Object.assign(LB, { rows, me });
    if (!rows.length) return msg('まだ記録がありません。タイムアタックで一番乗りしよう！');
    list.innerHTML = rows.map(e => lbRow(e, e === me)).join('') + (me && !rows.includes(me) ? `<li class="lb-msg">…</li>${lbRow(me, true)}` : '');
  }, e => {
    console.warn('lb', e);
    if (tok === LB.tok) msg(lbNeedsReload() ? '接続できませんでした。ページを再読み込みしてください' : 'ランキングを読み込めませんでした', '<li class="lb-msg"><button class="btn sm" id="lbRetry">再読み込み</button></li>');
  });
}
async function lbRace(uid) {
  const tid = curTrack(), e = [...LB.rows, LB.me].find(x => x?.uid === uid), c = CAR_BY_ID[save.selected.p1];
  if (LB.metric !== 'race' || !e) return;
  if (!navigator.onLine) { sfx.error(); return toast('オフラインのためゴーストを読み込めません', 'err'); }
  if (!await ask({ title: 'ゴーストと対戦', html: `<p>${esc(e.name)} のゴースト（<b>${fmt(e.race)}</b>）とタイムアタック。</p><p>使う車：${rb(c.rarity)} ${esc(c.name)}</p>`, yes: '対戦する' })) return;
  toast('ゴーストを読み込み中…');
  try {
    const ghost = await lbGhost(tid, LB.bucket, e);
    if (cur === 'lb' && tid === curTrack()) launch({ mode: 'ghost', trackId: tid, players: [player('p1', save.name)], ghost }, 'lb');
  } catch (err) { console.warn('lb ghost', err); sfx.error(); toast('ゴーストを読み込めませんでした', 'err'); }
}
// finished time attack → queue (sent now, or after the one-time name prompt / when back online)
async function lbRun(res) {
  const L = res.locals?.[0], g = res.ghostRecording;
  if (!lbReady() || L?.time == null || !g) return;
  await lbQueue({ trackId: raceTrack(), carId: L.carId, race: g.time, lap: L.bestLap, ghost: g });
  if (save.name === 'Player' && !nameAsked() && race?.done) {
    setNameAsked();
    $('#rName').value = '';
    $('#rLb').hidden = false;
    return;
  }
  lbSend();
}
function lbSend() {
  if (lbPending() && $('#rLb').hidden) lbFlush().then(m => { if (m) { toast(m); sfx.fanfare(); } }, e => console.warn('lb: kept for later', e));
}
$('#lbCourses').onclick = e => { const c = e.target.closest('[data-track]'); if (c) pickTrack(c.dataset.track); };
$('#lbMetric').onclick = e => { const b = e.target.closest('button'); if (b) { LB.metric = b.dataset.m; renderLb(); } };
$('#lbBucket').onclick = e => { const b = e.target.closest('button'); if (b) { LB.bucket = b.dataset.b; renderLb(); } };
$('#lbBucket').innerHTML = ['all', ...RARITY_ORDER].map(b => `<button data-b="${b}"${b === 'all' ? '' : ` style="color:${RARITY[b].color}"`}>${b === 'all' ? 'ALL' : b}</button>`).join('');
$('#lbList').onclick = e => {
  if (e.target.closest('#lbRetry')) return lbNeedsReload() ? location.reload() : renderLb();
  const li = e.target.closest('li[data-uid]');
  if (li) lbRace(li.dataset.uid);
};
$('#lbList').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.closest?.('li[data-uid]')?.click(); });
$('#rLbBtn').onclick = () => { endRace(); show('lb'); };
$('#rNameOk').onclick = () => { setName($('#rName').value); $('#rLb').hidden = true; lbSend(); };
$('#rName').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) $('#rNameOk').click(); });   // not the Enter that confirms an IME conversion
addEventListener('online', lbSend);
addEventListener('online', () => { if (cur === 'lb' && !race) renderLb(); });
setTimeout(lbSend, 4000);   // runs queued while offline

/* ================= event wiring ================= */
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  sfx.click();
  if (t.dataset.go) show(t.dataset.go);
  else if (t.dataset.cyc) cycleCar(t.closest('.picker').dataset.p, +t.dataset.cyc);
});
$('#btnBack').onclick = goBack;
$('#btnStart').onclick = () => startMode(cur);
$('#prepCourses').onclick = e => { const c = e.target.closest('[data-track]'); if (c) pickTrack(c.dataset.track); };
$('#onCourses').onclick = e => {
  const c = e.target.closest('[data-track]'), s = NET.s;
  if (!c || !s?.isHost || !TRACK_BY_ID[c.dataset.track]) return;
  save.lastTrack = c.dataset.track;
  persist();
  s.setTrack(save.lastTrack);   // re-broadcasts the roster (with trackId) -> renderRoster redraws the cards
};
$('#cpuSeg').onclick = e => { const b = e.target.closest('button'); if (b) { cpuCount = +b.dataset.n; renderPrep('solo'); } };
$('#diffSeg').onclick = e => {
  const b = e.target.closest('[data-lv]');
  if (!b || !Object.hasOwn(DIFFICULTY_BY_ID, b.dataset.lv) || b.dataset.lv === save.lastCpuLevel) return;
  save.lastCpuLevel = b.dataset.lv;
  persist();
  renderPrep('solo');
  $(`#diffSeg [data-lv="${save.lastCpuLevel}"]`).focus();   // the chips were rebuilt: keep keyboard focus on the picked one
};

// online
$('#btnHost').onclick = () => connect(true);
$('#btnJoin').onclick = () => connect(false);
$('#codeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') connect(false); });
$('#onName').addEventListener('change', e => { e.target.value = setName(e.target.value); });
$('#btnCopy').onclick = () => {
  const code = NET.s?.code;
  if (!code) return;
  navigator.clipboard?.writeText(code).then(() => toast('ルームコードをコピーしました'), () => toast(`ルームコード：${code}`));
};
$('#btnLeave').onclick = async () => {
  if (!await ask({ title: '部屋から退出', html: '<p>ルームから退出しますか？</p>', yes: '退出する', danger: true })) return;
  leaveRoom();
  renderOnline();
};
$('#btnGo').onclick = () => {
  const s = NET.s;
  if (!s?.isHost || roster().length < 2 || lobbyVer().any) return;
  $('#btnGo').disabled = true;
  try { s.startGame(); } catch (e) { console.error(e); toast('スタートできませんでした', 'err'); renderRoster(); }
};

// gacha
$$('[data-pull]').forEach(b => { b.onclick = () => pull(+b.dataset.pull, b.dataset.pay === 't'); });
$('#gfx').addEventListener('click', () => fxSkip());

// garage
$('#swBody').innerHTML = SW_BODY.map(c => `<button class="sw" data-sw="lkBody" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
$('#swWheel').innerHTML = SW_WHEEL.map(c => `<button class="sw" data-sw="lkWheel" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join('');
$('#gaCards').onclick = e => {
  const card = e.target.closest('.card');
  if (!card) return;
  gaFocus = card.dataset.car;
  renderGaDetail();
  if (innerWidth <= 900) $('#gaDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
$('#gaLook').addEventListener('input', () => {
  const rec = readLook();
  if (!rec) return;
  clearTimeout(lookT);
  lookT = setTimeout(() => S1.set(gaFocus, rec.look), 80);
});
$('#gaLook').addEventListener('change', commitLook);
$('#gaLook').addEventListener('click', e => {
  const sw = e.target.closest('[data-sw]');
  if (sw) { $('#' + sw.dataset.sw).value = sw.dataset.c; commitLook(); }
});
$('#lkReset').onclick = () => {
  const rec = save.cars[gaFocus];
  if (!rec) return;
  const d = defLook(gaFocus);
  $('#lkBody').value = d.body; $('#lkWheel').value = d.wheel; $('#lkWing').checked = d.wing;
  commitLook();
};
for (const p of ['p1', 'p2']) {
  $('#ga' + p.toUpperCase()).onclick = () => {
    if (!save.cars[gaFocus]) return;
    save.selected[p] = gaFocus;
    persist();
    if (p === 'p1') myNet();
    renderGarage();
    toast(`${CAR_BY_ID[gaFocus].name} を${p.toUpperCase()}の車に設定しました`);
  };
}
$('#gaTree').onclick = () => { treeCar = gaFocus; show('tree'); };

// skill tree
$('#tCars').onclick = e => { const b = e.target.closest('[data-tcar]'); if (b) { treeCar = b.dataset.tcar; renderTree(); } };
$('#tSide').onclick = e => { const b = e.target.closest('[data-node]'); if (b) clickNode(b.dataset.node); };
const svg = $('#tSvg');
svg.addEventListener('click', e => { const g = e.target.closest('.nd'); if (g) clickNode(g.dataset.node); });
svg.addEventListener('keydown', e => {
  const g = e.target.closest('.nd');
  if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); clickNode(g.dataset.node); }
});
svg.addEventListener('pointerover', e => { const g = e.target.closest('.nd'); if (g) showTip(g); });
svg.addEventListener('pointerout', e => { const g = e.target.closest('.nd'); if (g && !g.contains(e.relatedTarget) && e.pointerType !== 'touch') hideTip(); });
// touch has no hover: a tapped node keeps its tip (locked / unlocked nodes have no dialog) until the next tap or a scroll
addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && !e.target.closest?.('#tSvg .nd')) hideTip(); }, true);
addEventListener('scroll', hideTip, { capture: true, passive: true });
svg.addEventListener('focusin', e => { const g = e.target.closest('.nd'); if (g) showTip(g); });
svg.addEventListener('focusout', hideTip);

// settings
$('#setName').addEventListener('change', e => { e.target.value = setName(e.target.value); toast('名前を保存しました'); });
$('#setSound').addEventListener('change', e => { save.sound = e.target.checked; persist(); if (save.sound) sfx.coin(); });
$('#setQuality').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  save.quality = b.dataset.q;
  persist();
  renderSettings();
};
$('#setReset').onclick = async () => {
  if (!await ask({ title: 'データのリセット', html: `<p>コイン・チケット・車・スキル・記録・ゴーストがすべて消えます。${syncLinked() ? '<b>連携中のほかの端末のデータもリセットされます。</b>' : ''}<br>本当にリセットしますか？</p><p class="hint">直前のデータは 設定 → データ連携 →「元に戻す」で戻せます（ゴーストは戻りません）</p>`, yes: 'リセットする', danger: true })) return;
  backupSave('リセットする前');
  CARS.forEach(c => TRACKS.forEach(t => saveGhost(c.id, t.id, null)));
  save = resetSave();
  persist();   // linked: the reset goes to the cloud like any change
  gaFocus = treeCar = null;
  refreshWallet();
  renderSettings();
  toast('データをリセットしました');
};
// another tab wrote the save: adopt it, or this tab's next persist() overwrites that tab's pulls/unlocks/rewards
addEventListener('storage', e => {
  const s = reloadSave(e);
  if (!s) return;
  save = s;
  refreshWallet();
  if (!race) rerender();
});

// results
$('#rAgain').onclick = () => {
  const o = race?.opts, mode = o?.mode;
  endRace();
  if (o?.ghost?.lb) launch({ ...o, players: [player('p1', save.name)] }, 'lb');   // the same ranking ghost again
  else if (mode && mode !== 'online') startMode(mode);
};
$('#rMenu').onclick = () => {
  const online = race?.opts.mode === 'online';
  endRace();
  if (online) leaveRoom();
  show('home');
};

// keyboard (the game owns the keyboard while a race is running)
addEventListener('keydown', e => {
  if (race) return;
  if (!$('#gfx').classList.contains('hidden')) {
    if (['Escape', 'Space', 'Enter', 'NumpadEnter'].includes(e.code)) { e.preventDefault(); fx.anim ? fxSkip() : $('#gOk').click(); }
    return;
  }
  if (e.code === 'Escape') {
    if (syncDialogClose()) return;
    if (modalClose) modalClose();
    else if (cur !== 'home') goBack();
    return;
  }
  const a = document.activeElement;
  if (modalClose || a?.tagName === 'INPUT' || a?.tagName === 'BUTTON') return;
  if ((e.code === 'Enter' || e.code === 'NumpadEnter') && PREP[cur] && !$('#btnStart').disabled) { e.preventDefault(); startMode(cur); }
});

/* ================= back: Android back button / edge swipe, browser back ================= */
// Screens have no URLs, so back used to leave the page: the installed app closed (a left thumb steering from the screen
// edge is Android's back gesture) and an online room lost the player. One history entry stands for "in the app": back
// consumes it and does what Esc does (race: the quit prompt; results: back to the screen the race started from; menus:
// close the dialog / previous screen; home: a note, so a second back leaves). The next tap or key puts it back, never
// popstate itself: Chrome and Safari skip entries a page pushes without a user activation.
if (history.state?.ngp) history.replaceState(null, '');   // reloaded on our entry: the one before it is the old document
const guard = () => { if (!history.state?.ngp && navigator.userActivation?.isActive !== false) history.pushState({ ngp: 1 }, ''); };
for (const ev of ['pointerup', 'click', 'keydown']) addEventListener(ev, guard, true);
addEventListener('popstate', () => {
  if (race) race.done ? endRace() : raceBack();
  else if (!$('#gfx').classList.contains('hidden')) fx.anim ? fxSkip() : $('#gOk').click();
  else if (syncDialogClose()) { /* sync chooser: decide later */ }
  else if (modalClose) modalClose();
  else if (cur !== 'home') goBack();
  else toast('もう一度「戻る」で終了します');
});

/* ================= phones: on-screen keyboard ================= */
// The keyboard shrinks only the visual viewport (iOS Safari, and Android Chrome by default): lift the focused text field
// above it, with the keyboard's height as extra bottom padding so its scroller can go that far.
if (window.visualViewport) {
  const vv = visualViewport;
  let padded = null;
  const fit = () => {
    const el = document.activeElement;
    const box = el?.matches?.('input:not([type=checkbox]):not([type=color]), textarea') ? el.closest('main, .overlay') : null;
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    if (padded && (padded !== box || kb < 60)) { padded.style.paddingBottom = ''; padded = null; }
    if (!box) { if (scrollY) scrollTo(0, 0); return; }   // iOS can leave the page shifted after the keyboard closes
    if (kb >= 60) { box.style.paddingBottom = `${kb + 24}px`; padded = box; }
    const r = el.getBoundingClientRect(), top = Math.max(vv.offsetTop, box.getBoundingClientRect().top) + 8, bottom = vv.offsetTop + vv.height - 12;
    if (r.bottom > bottom) box.scrollTop += r.bottom - bottom;
    else if (r.top < top) box.scrollTop -= top - r.top;
  };
  vv.addEventListener('resize', fit);
  addEventListener('focusin', () => setTimeout(fit, 50));
  addEventListener('focusout', () => setTimeout(fit, 50));
}

/* ================= auto-update ================= */
// build.json (uncached) names the deployed build, version.js the one this tab runs. GitHub Pages lets browsers cache
// files for 10 min and a normal reload keeps cached ES modules, so a tab can come up old: re-fetch the page and the
// new build's modules past the HTTP cache, then reload (index.html's import map loads every module as ?v=<build>,
// so the reload can't mix old and new files).
async function latestBuild() {
  try {
    const j = await (await fetch('build.json', { cache: 'no-store', signal: AbortSignal.timeout?.(8000) })).json();
    return typeof j?.build === 'string' ? j : null;
  } catch { return null; }   // offline / no build.json: carry on with what we have
}
let updating = false;
async function update(info) {
  if (updating) return;
  updating = true;
  $('#updating').hidden = false;
  try { if (NET.s && !NET.s.isHost) sessionStorage.setItem('ngp.rejoin', NET.s.code); } catch { /* no storage */ }
  info ??= await latestBuild();
  const urls = [location.href.split('#')[0], 'index.html', ...(info?.files || []).map(f => `${f}?v=${info.build}`)];
  const ok = await Promise.all(urls.map(u => fetch(u, { cache: 'reload', signal: AbortSignal.timeout?.(20000) }).then(r => r.ok, () => false)));
  if (ok[0]) return location.reload();
  // page unreachable (offline): a reload would swap the running game for the browser's error page
  updating = false;
  $('#updating').hidden = true;
  try { sessionStorage.removeItem('ngp.rejoin'); } catch { /* no storage */ }
  toast('オフラインのため更新できません', 'err');
  return false;
}
async function checkUpdate(boot) {
  const info = await latestBuild();
  if (updating || !(info?.build > BUILD)) return;
  // once per build per tab: if the reload still came up old (CDN lag), don't loop, offer the button instead
  let tried = null;
  try { tried = sessionStorage.getItem('ngp.upd'); } catch { /* no storage */ }
  if (!boot || race || NET.s || tried === info.build) { $('#newVer').hidden = false; return; }
  try { sessionStorage.setItem('ngp.upd', info.build); } catch { $('#newVer').hidden = false; return; }   // no storage: can't guard against a loop
  update(info);
}
$('#btnNewVer').onclick = () => update();
$('#onVer').onclick = e => { if (e.target.closest('[data-update]')) update(); };
checkUpdate(true);
setInterval(() => { if (!race) checkUpdate(false); }, 5 * 60e3);

/* ================= boot ================= */
$('#homeCourses').innerHTML = `<span class="tz-h"><small>COURSES</small><b>${TRACKS.length} コース</b><em>${TRACKS.map(t => t.label || THEME[t.theme].name).join('・')}</em></span>`
  + `<span class="tz-maps">${TRACKS.map(t => `<i style="--tc:${THEME[t.theme].c}" title="${esc(t.name)}">${COURSE[t.id].svg(false)}</i>`).join('')}</span>`;
preloadCarModels(CARS.map(c => c.id)).catch(() => {});
// cloud save: a download / the conflict chooser waits for no race / dialog / gacha reveal / online room (its host may
// start any moment), then the save object (the one `save` holds) is replaced in place and the screen redrawn
initSync({
  idle: () => !race && !modalClose && !NET.s && $('#gfx').classList.contains('hidden'),
  applied: () => { refreshWallet(); if (!race) rerender(); },
  toast,
});
show('home', false);
requestAnimationFrame(loop);
let rejoin = null;   // an outdated guest pressed 更新 in a room: go back in
try { rejoin = sessionStorage.getItem('ngp.rejoin'); sessionStorage.removeItem('ngp.rejoin'); } catch { /* no storage */ }
if (rejoin) { show('online'); $('#codeIn').value = rejoin; connect(false); }
