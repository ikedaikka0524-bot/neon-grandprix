// Touch controls for single-player races (phones / tablets), the phone race-HUD layout, wake lock, haptics and the
// 操作設定 block of the settings screen. Settings are a device preference in localStorage 'ngp.touch' (kept by the data reset).
import { ABILITIES } from './data.js';

const KEY = 'ngp.touch';
const DEF = { scheme: 'slide', auto: true, swap: false, size: 'm' };
const OPTS = { scheme: ['slide', 'buttons', 'tilt'], size: ['s', 'm', 'l'] };
const SIZE = { s: 0.82, m: 1, l: 1.2 };
const FULL = 70, DEAD = 6;              // slide: px from the touch-down point to full lock / dead zone
const TILT_FULL = 26, TILT_DEAD = 2;    // tilt: degrees of steering-wheel roll to full lock / dead zone
const HOLD = ['brake', 'abil', 'accel', 'left', 'right'];
const RAD = Math.PI / 180;

export function touchSettings() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(KEY)); } catch { /* blocked storage */ }
  const o = { ...DEF, ...(s && typeof s === 'object' ? s : null) };
  for (const k in OPTS) if (!OPTS[k].includes(o[k])) o[k] = DEF[k];
  o.auto = o.auto !== false; o.swap = o.swap === true;
  return o;
}
function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* blocked storage */ } }

const coarse = () => matchMedia('(pointer: coarse)').matches;
// small touch screen (phone): game.js starts auto quality one step lower there
export const isPhone = () => coarse() && Math.min(innerWidth, innerHeight) < 500;
const portrait = () => innerHeight > innerWidth;

// ---- tilt permission (iOS 13+: DeviceOrientationEvent.requestPermission, only from a user gesture)
let tiltOk = null, tiltAsked = false;
const needsAsk = () => typeof window.DeviceOrientationEvent?.requestPermission === 'function';
// Must be called synchronously inside a tap handler (the request runs before the first await).
export async function askTilt() {
  const D = window.DeviceOrientationEvent;
  if (!D) return false;
  if (needsAsk()) {
    tiltAsked = true;
    try { tiltOk = (await D.requestPermission()) === 'granted'; } catch { tiltOk = false; }
    if (!tiltOk) return false;
  }
  // Android / desktop: no prompt, but a desktop has the API without a sensor: wait for one real reading
  return new Promise(res => {
    const t = setTimeout(() => { removeEventListener('deviceorientation', f); res(false); }, 1200);
    const f = e => { if (e.beta == null) return; clearTimeout(t); removeEventListener('deviceorientation', f); res(true); };
    addEventListener('deviceorientation', f);
  });
}
// iOS forgets the grant on reload: ask again on the first tap anywhere (menus, or the race itself) while tilt is chosen
addEventListener('touchend', () => { if (needsAsk() && !tiltAsked && touchSettings().scheme === 'tilt') askTilt(); }, { capture: true, passive: true });

// ---- screen wake lock for the race (re-requested when the page comes back; the browser drops it when hidden)
export function keepAwake() {
  let lock = null, dead = false;
  const req = async () => {
    if (dead || document.hidden || !navigator.wakeLock || (lock && !lock.released)) return;
    try { const l = await navigator.wakeLock.request('screen'); if (dead) l.release().catch(() => {}); else lock = l; } catch { /* not allowed / unsupported */ }
  };
  document.addEventListener('visibilitychange', req);
  req();
  return () => { dead = true; document.removeEventListener('visibilitychange', req); lock?.release().catch(() => {}); lock = null; };
}

const ICON = {
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4v4.5h4.5"/></svg>',
};

// opts: { wrap: .rg-root, audio: game audio ({resume}) | null, pause() }
// -> { read(inp, state) -> reset?, hud(car), hide(), buzz(ms), destroy(), on }
export function createTouch({ wrap, audio, pause }) {
  const set = touchSettings();
  let mode = set.scheme;
  const layer = document.createElement('div');
  layer.className = `tc-layer${set.swap ? ' swap' : ''}${set.auto ? '' : ' noauto'}`;
  // 大 on a 360 px screen: ◀ ▶ + the corner button no longer fit a row, so the scale is capped by the short side
  const fit = () => layer.style.setProperty('--s', Math.min(SIZE[set.size], Math.min(innerWidth, innerHeight) / 340).toFixed(3));
  fit();
  layer.innerHTML = `<div class="tc-zone"></div><div class="tc-ring"><i>‹</i><i>›</i><b class="tc-knob"></b></div>
    <div class="tc-top"><div class="tc-tb" data-b="pause" aria-label="ポーズ">${ICON.pause}</div><div class="tc-tb" data-b="reset" aria-label="コースに戻る">${ICON.reset}</div></div>
    <div class="tc-btn tc-left" data-b="left">◀</div><div class="tc-btn tc-right" data-b="right">▶</div>
    <div class="tc-btn tc-accel" data-b="accel"><b>アクセル</b></div>
    <div class="tc-btn tc-brake" data-b="brake"><b>ブレーキ</b></div>
    <div class="tc-btn tc-abil" data-b="abil"><i class="tc-g"></i><b>能力</b><small></small></div>
    <div class="tc-help"></div><div class="tc-rot" data-b="rot">横向きがおすすめ <span>✕</span></div>`;
  wrap.appendChild(layer);
  const q = s => layer.querySelector(s);
  const els = Object.fromEntries([...layer.querySelectorAll('[data-b]')].map(e => [e.dataset.b, e]));
  const zone = q('.tc-zone'), ring = q('.tc-ring'), knob = q('.tc-knob'), abil = els.abil, help = q('.tc-help'), rot = els.rot;

  const ptrs = new Map();   // pointerId -> { steer: true, x0, x } | { btn: name | null }
  let on = false, done = false, abilQ = false, resetQ = false, lastState = null, dead = false;
  let tilt = null, tilt0 = null, tiltFallback = false, isPortrait = portrait(), idle = null, g = -1, cls = '', rotT = 0;
  const timers = [], offs = [];
  const listen = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };
  const steerZone = () => mode === 'slide' || (mode === 'tilt' && tiltFallback);
  const setMode = () => { layer.classList.toggle('sch-buttons', mode === 'buttons'); layer.classList.toggle('sch-tilt', mode === 'tilt' && !tiltFallback); };
  setMode();

  const inRect = (e, x, y, pad) => { const r = e.getBoundingClientRect(); return r.width > 0 && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; };
  const hit = (x, y, names, pad = 8) => names.find(n => els[n] && inRect(els[n], x, y, pad)) || null;
  const held = n => { for (const p of ptrs.values()) if (p.btn === n) return true; return false; };
  const steerPtr = () => { for (const p of ptrs.values()) if (p.steer) return p; return null; };
  const holds = () => (done ? [] : HOLD.filter(n => (n === 'accel' ? !set.auto : n === 'left' || n === 'right' ? mode === 'buttons' : true)));
  const paint = () => { for (const n of HOLD) els[n].classList.toggle('on', held(n)); };

  function placeIdle() {
    const r = zone.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    idle = { x: r.left - w.left + r.width / 2, y: r.bottom - w.top - Math.min(150, r.height * 0.3) };
  }
  function drawRing(x, y, dx, active) {
    ring.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    knob.style.transform = `translateX(${dx.toFixed(1)}px)`;
    ring.classList.toggle('act', active);
  }
  function releaseAll() { ptrs.clear(); paint(); if (idle) drawRing(idle.x, idle.y, 0, false); }

  function showHelp() {
    const how = mode === 'buttons' ? '◀ ▶ でハンドル' : mode === 'tilt' && !tiltFallback ? '端末を傾けてハンドル' : `${set.swap ? '右' : '左'}側を左右にスライドでハンドル`;
    help.innerHTML = `<span>${how}・</span><span>ブレーキ＋ハンドルでドリフト</span>`;   // wraps between the phrases only
    help.classList.remove('off');
    timers.push(setTimeout(() => help.classList.add('off'), 6000));
  }
  function setOn(v) {
    if (on === v || dead) return;
    on = v;
    wrap.classList.toggle('tc', v);
    releaseAll();
    if (v) { placeIdle(); drawRing(idle.x, idle.y, 0, false); showHelp(); }
  }

  const unlock = () => audio?.resume();
  function down(e) {
    if (dead) return;
    e.preventDefault();
    unlock();
    const x = e.clientX, y = e.clientY, w = wrap.getBoundingClientRect();
    const tap = hit(x, y, rot.classList.contains('show') ? ['pause', 'reset', 'rot'] : ['pause', 'reset'], 4);
    if (tap === 'pause') { pause(); return; }   // fingers still on steering / brake keep working after 続ける
    if (tap === 'reset') { resetQ = true; els.reset.classList.add('on'); timers.push(setTimeout(() => els.reset.classList.remove('on'), 150)); return; }
    if (tap === 'rot') { rot.classList.remove('show'); return; }
    const b = hit(x, y, holds());
    if (b) {
      ptrs.set(e.pointerId, { btn: b });
      if (b === 'abil') abilQ = true;
      paint();
      return;
    }
    if (!done && steerZone() && !steerPtr() && inRect(zone, x, y, 0)) {
      ptrs.set(e.pointerId, { steer: true, x0: x, x, y: y - w.top, ox: w.left });
      drawRing(x - w.left, y - w.top, 0, true);
    }
  }
  function move(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.steer) {
      if (p.rebase) { const w = wrap.getBoundingClientRect(); Object.assign(p, { rebase: false, x0: e.clientX, y: e.clientY - w.top, ox: w.left }); }
      p.x = e.clientX;
      if (Math.abs(p.x - p.x0) > FULL) p.x0 = p.x - Math.sign(p.x - p.x0) * FULL;   // floating origin: reversing is never more than 2x FULL
      drawRing(p.x0 - p.ox, p.y, p.x - p.x0, true);
      return;
    }
    const b = hit(e.clientX, e.clientY, holds());   // glide between buttons; leaving one releases it
    if (b !== p.btn) { if (b === 'abil') abilQ = true; p.btn = b; paint(); }
  }
  function up(e) {
    const p = ptrs.get(e.pointerId);
    if (e.type === 'pointerup') unlock();
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (p.steer && idle) drawRing(idle.x, idle.y, 0, false);
    paint();
  }
  // On the wrap: the first touch shows the controls (desktop with a touch screen, or after the keyboard hid them) and
  // already counts, but its moves stay with the element it landed on (implicit capture), not the layer.
  listen(wrap, 'pointerdown', e => {
    if (!on) { if (e.pointerType !== 'touch' || e.target.closest?.('button')) return; setOn(true); }
    else if (e.target !== layer) return;   // the quit prompt etc.
    down(e);
  });
  listen(wrap, 'pointermove', move);
  listen(wrap, 'pointerup', up);
  listen(wrap, 'pointercancel', up);
  // no scroll / pinch / pull-to-refresh / double-tap zoom / callout on the race screen (buttons like the quit prompt's stay tappable)
  listen(wrap, 'touchstart', e => { if (!e.target.closest?.('button')) e.preventDefault(); }, { passive: false });
  listen(wrap, 'touchmove', e => e.preventDefault(), { passive: false });
  listen(wrap, 'touchend', unlock);
  listen(wrap, 'gesturestart', e => e.preventDefault());
  listen(window, 'blur', releaseAll);
  listen(document, 'visibilitychange', releaseAll);
  listen(window, 'resize', () => {
    fit();
    // rotated with fingers down: a held steering finger re-centres on its next move, held buttons let go (a finger
    // that is still on one after the re-layout presses it again on its next move)
    if (portrait() !== isPortrait) { isPortrait = portrait(); for (const p of ptrs.values()) { if (p.steer) p.rebase = true; else p.btn = null; } paint(); tilt0 = null; }
    if (on) { placeIdle(); if (!steerPtr()) drawRing(idle.x, idle.y, 0, false); }
  });

  // ---- tilt: roll of the screen around its normal (a steering wheel), from the gravity direction in the screen plane
  if (mode === 'tilt') {
    listen(window, 'deviceorientation', e => {
      if (e.beta == null || e.gamma == null) return;
      const b = e.beta * RAD, gm = e.gamma * RAD, th = (screen.orientation?.angle ?? window.orientation ?? 0) * RAD;
      const ux = -Math.sin(gm) * Math.cos(b), uy = Math.sin(b);   // world up in device coordinates (x, y)
      const r = ux * Math.cos(th) - uy * Math.sin(th), u = ux * Math.sin(th) + uy * Math.cos(th);
      if (Math.hypot(r, u) < 0.25) return;   // lying almost flat: no reliable wheel angle
      tilt = Math.atan2(r, u) / RAD;
      tilt0 ??= tilt;
    });
    // no sensor / permission: steer by sliding for this race
    timers.push(setTimeout(() => { if (tilt == null && !dead) { tiltFallback = true; setMode(); if (on) showHelp(); } }, 1500));
  }
  const tiltSteer = () => {
    if (tilt == null || tilt0 == null) return 0;
    const d = ((tilt - tilt0 + 540) % 360) - 180, a = Math.abs(d);
    return a <= TILT_DEAD ? 0 : Math.sign(d) * Math.min(1, (a - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
  };

  if (coarse()) setOn(true);

  return {
    get on() { return on; },
    // merge into the keyboard input (game.js readKeys ran first); returns true once per ⟲ tap
    read(inp, state) {
      if (state === 'running' && lastState !== 'running' && tilt != null) tilt0 = tilt;   // calibrate at GO
      lastState = state;
      if (!on) return false;
      const sp = steerPtr();
      let steer = 0;
      if (sp && !sp.rebase) { const dx = sp.x - sp.x0, a = Math.abs(dx); steer = a <= DEAD ? 0 : -Math.sign(dx) * Math.min(1, (a - DEAD) / (FULL - DEAD)); }
      else if (mode === 'buttons') steer = (held('left') ? 1 : 0) - (held('right') ? 1 : 0);
      else if (mode === 'tilt' && !tiltFallback) steer = tiltSteer();
      const brake = held('brake') ? 1 : 0;
      inp.steer = Math.max(-1, Math.min(1, inp.steer + steer));
      inp.brake = Math.max(inp.brake, brake);
      inp.throttle = Math.max(inp.throttle, (set.auto ? !brake : held('accel')) ? 1 : 0);   // the brake overrides auto accel
      if (abilQ) inp.ability = true;
      abilQ = false;
      const r = resetQ;
      resetQ = false;
      return r;
    },
    hud(car) {
      if (!on) return;
      const fin = !!car.finished;
      if (fin !== done) { done = fin; layer.classList.toggle('done', fin); releaseAll(); }
      const ab = car.ability;
      if (ab) {
        const act = (ab.active || 0) > 0, gg = act ? 1 : Math.floor(Math.min(1, Math.max(0, ab.gauge || 0)) * 50) / 50;   // floor: gold only once a tap works (0.99 ≠ ready)
        const c = act ? 'active' : ab.sealed ? 'sealed' : gg >= 1 ? 'ready' : '';
        if (gg !== g) { g = gg; abil.style.setProperty('--g', gg); }
        if (c !== cls) { if (cls) abil.classList.remove(cls); if (c) abil.classList.add(c); cls = c; }
        const nm = ABILITIES[ab.id]?.name || '';
        if (abil.lastChild.textContent !== nm) abil.lastChild.textContent = nm;
      }
      if (mode === 'tilt' && !tiltFallback && idle) drawRing(idle.x, idle.y, -tiltSteer() * FULL, tilt != null);
      if (!rotT && isPortrait) {   // one-time hint, never blocks: tap it or it fades by itself
        rotT = 1;
        let seen = true;
        try { seen = localStorage.getItem(KEY + '.rot') === '1'; localStorage.setItem(KEY + '.rot', '1'); } catch { /* blocked storage */ }
        if (!seen) { rot.classList.add('show'); timers.push(setTimeout(() => rot.classList.remove('show'), 7000)); }
      }
    },
    hide() { setOn(false); },
    buzz(ms) { if (on && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* iOS: none */ } },
    destroy() {
      dead = true;
      timers.forEach(clearTimeout);
      offs.forEach(f => f());
      wrap.classList.remove('tc');
      layer.remove();
    },
  };
}

// ---- settings screen: 操作設定 rows inserted after `anchor` (idempotent; call on every render of the screen)
export function mountTouchSettings(anchor, toast) {
  let box = document.getElementById('touchSet');
  if (!box) {
    if (!anchor || !(coarse() || navigator.maxTouchPoints > 0)) return;
    box = document.createElement('div');
    box.id = 'touchSet';
    box.className = 'tc-set';
    box.innerHTML = `<h3>操作設定<small class="hint">タッチ操作（スマホ・タブレット）</small></h3>
      <div class="srow"><span>操作方法<small class="hint" id="touchHow"></small></span><div class="seg" data-k="scheme" role="group" aria-label="操作方法"><button data-v="slide">スライド</button><button data-v="buttons">ボタン</button><button data-v="tilt">傾き</button></div></div>
      <div class="srow"><span>自動アクセル<small class="hint">オフにするとアクセルボタンが出ます</small></span><input type="checkbox" class="toggle" data-k="auto" aria-label="自動アクセル"></div>
      <div class="srow"><span>左右入れ替え<small class="hint">ハンドルを右手、ボタンを左手で</small></span><input type="checkbox" class="toggle" data-k="swap" aria-label="左右入れ替え"></div>
      <div class="srow"><span>ボタンの大きさ</span><div class="seg" data-k="size" role="group" aria-label="ボタンの大きさ"><button data-v="s">小</button><button data-v="m">中</button><button data-v="l">大</button></div></div>`;
    anchor.after(box);
    box.addEventListener('click', async e => {
      const b = e.target.closest('button[data-v]'), k = b?.closest('[data-k]')?.dataset.k;
      if (!k) return;
      let v = b.dataset.v;
      if (k === 'scheme' && v === 'tilt' && v !== touchSettings().scheme) {
        if (await askTilt()) toast?.('傾き操作: スタートしたときの角度がまっすぐになります');
        else { v = 'slide'; toast?.('傾きセンサーを使えません。スライド操作にします', 'err'); }
      }
      saveSettings({ ...touchSettings(), [k]: v });
      sync(box);
    });
    box.addEventListener('change', e => {
      const k = e.target.dataset?.k;
      if (k) { saveSettings({ ...touchSettings(), [k]: e.target.checked }); sync(box); }
    });
  }
  sync(box);
}
// iOS home-screen apps before 18.4 ignore the Wake Lock API (WebKit bug 254545), and tilt steering never touches the
// screen, so auto-lock can dim / lock it mid-race. The web workaround (an unmuted, non-looping video) would take the audio
// session and stop the player's music, so the hint says how to avoid it instead.
const OLD_IOS_APP = navigator.standalone === true && (m => !!m && +m[1] * 100 + +m[2] < 1804)(/OS (\d+)_(\d+)/.exec(navigator.userAgent));
const HOW = {
  slide: '画面の左側を左右になぞってハンドル', buttons: '◀ ▶ ボタンでハンドル',
  tilt: '端末をハンドルのように傾ける' + (OLD_IOS_APP ? '。iOS 18.4 より前のホーム画面アプリでは画面が自動ロックされることがあります（iOSの 設定 → 画面表示と明るさ → 自動ロック を長めに・低電力モードはオフに）' : ''),
};
function sync(box) {
  const s = touchSettings();
  box.querySelector('#touchHow').textContent = HOW[s.scheme].replace('左側', s.swap ? '右側' : '左側');
  for (const seg of box.querySelectorAll('.seg[data-k]')) for (const b of seg.children) b.classList.toggle('on', b.dataset.v === s[seg.dataset.k]);
  for (const c of box.querySelectorAll('input[data-k]')) c.checked = !!s[c.dataset.k];
}

// ======================================================================================
// Styles: menus (split screen hidden on phones) + touch race layer + phone HUD layout (overrides game.js .rg-* rules)
// ======================================================================================
const CSS = `
@media (pointer:coarse) and (max-width:599px),(pointer:coarse) and (max-height:599px){
  .tile[data-go=split]{display:none!important}
  .modes .tile[data-go=online]{grid-column:1/-1}
}
.tc-set{display:flex;flex-direction:column;gap:14px}
.tc-set h3 small{display:block;margin-top:2px;font-family:var(--font)}
.tc-set .seg button{font-size:14px}
body.racing{overscroll-behavior:none}
html:has(body.racing){overscroll-behavior:none}
.rg-root{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.rg-root{--sl:env(safe-area-inset-left,0px);--sr:env(safe-area-inset-right,0px);--st:env(safe-area-inset-top,0px);--sb:env(safe-area-inset-bottom,0px)}
.rg-root .rg-tl{left:calc(22px + var(--sl));top:calc(16px + var(--st))}
.rg-root .rg-tr{right:calc(22px + var(--sr));top:calc(16px + var(--st))}
.rg-root .rg-speed{left:calc(14px + var(--sl));bottom:calc(8px + var(--sb))}
.rg-root .rg-map{right:calc(16px + var(--sr));bottom:calc(16px + var(--sb))}

.tc-layer{position:absolute;inset:0;z-index:6;display:none;touch-action:none;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;--s:1;font-family:"Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif}
.tc-layer *{pointer-events:none}
.rg-root.tc .tc-layer{display:block}
.rg-root.tc .rg-quit,.rg-root.tc .rg-hint,.rg-root.tc .rg-abil,.rg-root.tc .rg-modal kbd{display:none}
.tc-zone{position:absolute;left:0;top:0;bottom:0;width:45%}
.tc-layer.swap .tc-zone{left:auto;right:0}
.tc-ring{position:absolute;left:0;top:0;width:140px;height:140px;margin:-70px 0 0 -70px;border-radius:50%;border:2px solid rgba(255,255,255,.4);background:radial-gradient(circle,rgba(41,216,255,.14),rgba(10,14,24,.3) 70%);opacity:.3;transition:opacity .15s}
.tc-ring.act{opacity:1}
.tc-ring i{position:absolute;top:50%;margin-top:-14px;font:900 24px/28px system-ui,sans-serif;color:rgba(255,255,255,.7);font-style:normal}
.tc-ring i:first-child{left:10px}.tc-ring i:nth-child(2){right:10px}
.tc-knob{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff,#9fe8ff 45%,#29d8ff);box-shadow:0 0 18px rgba(41,216,255,.8)}
.tc-layer.sch-buttons .tc-ring{display:none}
.tc-layer.sch-tilt .tc-ring{opacity:.55}
.tc-top{position:absolute;left:50%;top:calc(6px + var(--st));transform:translateX(-50%);display:flex;gap:10px}
.tc-tb{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;background:rgba(10,14,24,.5);border:1px solid rgba(255,255,255,.35);opacity:.85}
.tc-tb svg{width:20px;height:20px;fill:#fff;stroke:#fff}
.tc-tb[data-b=reset] svg{fill:none}
.tc-tb.on{background:rgba(41,216,255,.5)}
.tc-btn{--d:96px;position:absolute;width:calc(var(--d) * var(--s));height:calc(var(--d) * var(--s));border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:#fff;text-align:center;
  background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.16),rgba(10,14,24,.5) 70%);border:2px solid rgba(255,255,255,.45);box-shadow:0 4px 14px rgba(0,0,0,.35);text-shadow:0 1px 4px rgba(0,0,0,.7);transition:transform .06s,background .06s}
.tc-btn b{font-weight:800;font-size:calc(15px * var(--s));line-height:1.1;letter-spacing:.02em}
.tc-btn.on{transform:scale(.93);background:radial-gradient(circle,rgba(255,255,255,.4),rgba(10,14,24,.4) 75%)}
.tc-brake{right:calc(16px + var(--sr));bottom:calc(16px + var(--sb));border-color:rgba(255,90,120,.85)}
.tc-brake.on{box-shadow:0 0 22px #ff4d6d}
.tc-accel{display:none;right:calc(16px + var(--sr));bottom:calc(16px + var(--sb));border-color:rgba(93,255,176,.85)}
.tc-accel.on{box-shadow:0 0 22px #5dffb0}
.tc-abil{--d:80px;right:calc(28px + var(--sr) + 96px * var(--s));bottom:calc(28px + var(--sb));border-color:rgba(255,255,255,.3)}
.tc-abil b{font-size:calc(14px * var(--s))}
.tc-abil small{max-width:86%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:700;font-size:calc(10px * var(--s));line-height:1.2;opacity:.85}
.tc-g{position:absolute;inset:-4px;border-radius:50%;background:conic-gradient(#b04dff calc(var(--g,0) * 1turn),rgba(255,255,255,.1) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px));mask:radial-gradient(farthest-side,transparent calc(100% - 7px),#000 calc(100% - 6px))}
.tc-abil.ready{border-color:#ffd23f;animation:tcglow .5s infinite alternate}
.tc-abil.ready .tc-g{background:conic-gradient(#ffd23f,#ff6b1a,#ffd23f)}
.tc-abil.ready b{color:#ffd23f}
.tc-abil.active .tc-g{background:conic-gradient(#5dffb0,#29d8ff,#5dffb0)}
.tc-abil.sealed .tc-g{background:repeating-conic-gradient(#8a2cff 0 10deg,#2a0a4e 10deg 20deg)}
.tc-abil.sealed{opacity:.6}
@keyframes tcglow{from{box-shadow:0 0 8px #ffb300}to{box-shadow:0 0 26px #ffb300,0 0 44px rgba(255,107,26,.5)}}
.tc-left,.tc-right{--d:84px;display:none;bottom:calc(20px + var(--sb));font:900 calc(30px * var(--s))/1 system-ui,sans-serif}
.tc-left{left:calc(16px + var(--sl))}
.tc-right{left:calc(30px + var(--sl) + 84px * var(--s))}
.tc-layer.sch-buttons .tc-left,.tc-layer.sch-buttons .tc-right{display:flex}
.tc-layer.noauto .tc-accel{display:flex}
.tc-layer.noauto .tc-brake{--d:84px;right:calc(28px + var(--sr) + 96px * var(--s))}
.tc-layer.noauto .tc-abil{--d:72px;right:calc(28px + var(--sr) + 102px * var(--s));bottom:calc(30px + var(--sb) + 84px * var(--s))}
.tc-layer.swap .tc-brake,.tc-layer.swap .tc-accel{right:auto;left:calc(16px + var(--sl))}
.tc-layer.swap .tc-abil{right:auto;left:calc(28px + var(--sl) + 96px * var(--s))}
.tc-layer.swap.noauto .tc-brake{left:calc(28px + var(--sl) + 96px * var(--s))}
.tc-layer.swap.noauto .tc-abil{left:calc(28px + var(--sl) + 102px * var(--s))}
.tc-layer.swap .tc-left{left:auto;right:calc(30px + var(--sr) + 84px * var(--s))}
.tc-layer.swap .tc-right{left:auto;right:calc(16px + var(--sr))}
.tc-layer.done .tc-btn,.tc-layer.done .tc-ring,.tc-layer.done .tc-tb[data-b=reset]{display:none}
.tc-help{position:absolute;left:50%;top:calc(var(--st) + 54px);transform:translateX(-50%);width:max-content;max-width:calc(100% - 32px);padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.45);font-weight:700;font-size:13px;line-height:1.4;text-align:center;transition:opacity 1s}
.tc-help.off{opacity:0}
.tc-help span{display:inline-block}
.tc-rot{display:none;position:absolute;left:50%;top:calc(var(--st) + 54px);transform:translateX(-50%);padding:6px 10px 6px 14px;border-radius:999px;background:rgba(10,14,24,.75);border:1px solid rgba(255,210,63,.7);font-weight:700;font-size:13px;line-height:1.3;white-space:nowrap}
.tc-rot.show{display:block;animation:rgtag .35s ease-out}
.tc-rot span{margin-left:8px;opacity:.7}

/* phone HUD (touch on): nothing under the thumbs; landscape: map under the timer, speed bottom center */
.rg-root.tc .rg-tl{left:calc(12px + var(--sl));top:calc(8px + var(--st))}
.rg-root.tc .rg-tr{right:calc(12px + var(--sr));top:calc(8px + var(--st))}
.rg-root.tc .rg-tags{top:calc(54px + var(--st))}
.rg-root.tc .rg-map{top:calc(var(--st) + 16px + 112px * var(--z));bottom:auto;right:calc(12px + var(--sr));width:108px;height:108px;transform:none;border-radius:12px}
.rg-root.tc .rg-link{top:calc(var(--st) + 22px + 112px * var(--z) + 108px);bottom:auto;right:calc(12px + var(--sr));transform-origin:100% 0}
.rg-root.tc .rg-speed{left:50%;bottom:calc(2px + var(--sb));transform:translateX(-50%) scale(calc(var(--z) * .85));transform-origin:50% 100%}
@media (max-height:500px){.rg-root.tc .rg-vp{--z:.55}}
@media (orientation:portrait){
  .rg-root.tc .rg-vp{--z:.6}
  .tc-zone{top:32%;width:50%}
  .tc-layer:not(.noauto) .tc-abil{right:calc(24px + var(--sr));bottom:calc(30px + var(--sb) + 96px * var(--s))}
  .tc-layer.swap:not(.noauto) .tc-abil{right:auto;left:calc(24px + var(--sl))}
  /* no auto accel: brake stacked above the accel, ability inward of the brake (a row of four doesn't fit 360-430 px) */
  .tc-layer.noauto .tc-brake{right:calc(16px + var(--sr) + 6px * var(--s));bottom:calc(28px + var(--sb) + 96px * var(--s))}
  .tc-layer.noauto .tc-abil{right:calc(28px + var(--sr) + 96px * var(--s));bottom:calc(34px + var(--sb) + 96px * var(--s))}
  .tc-layer.swap.noauto .tc-brake{right:auto;left:calc(16px + var(--sl) + 6px * var(--s))}
  .tc-layer.swap.noauto .tc-abil{right:auto;left:calc(28px + var(--sl) + 96px * var(--s))}
  .tc-help{top:48%}
  .rg-root.tc .rg-map{top:calc(var(--st) + 18px + 100px * var(--z));left:calc(12px + var(--sl));right:auto;width:96px;height:96px}
  .rg-root.tc .rg-link{top:calc(var(--st) + 24px + 100px * var(--z) + 96px);right:auto;left:calc(12px + var(--sl));text-align:left;transform-origin:0 0}
  .rg-root.tc .rg-speed{left:auto;right:calc(4px + var(--sr));top:calc(var(--st) + 8px + 112px * var(--z));bottom:auto;transform:scale(calc(var(--z) * .8));transform-origin:100% 0}
  .rg-root.tc .rg-center{top:30%}
  .rg-root.tc .rg-tags{top:calc(54px + var(--st))}
}
@media (orientation:portrait) and (max-width:500px){.rg-root.tc .rg-vp{--z:.52}}
`;
{
  const st = document.createElement('style');
  st.id = 'touch-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
