// Cloud save shared between the player's own devices (設定 → データ連携). No login: one device starts a sync group, the
// others join it with a one-time 6-character code. Firebase through lb.js (lazy SDK + the device's anonymous uid):
//   saves/<g>         = { data /* pwa.js encodeSave(), the transfer code */, rev /* +1 per write */, at, by /* label */ }
//   members/<g>/<uid> = { label, seen, code? /* the code it joined with */ }
//   codes/<CODE>      = { g, exp /* ≤ 10 min */, by /* creator uid */ }            rules: tools/gen-rules.mjs
//   own/<uid>         = the group this uid started last (the rules allow one at a time per uid)
// Local: localStorage 'ngp.sync' = { g, uid, rev /* cloud rev last synced */, h /* save fingerprint then */, dirty,
// at /* last local change */, synced /* last good sync */, sent /* [rev, h] of an upload not confirmed yet */ } | { lost }.
// A write only lands while the cloud rev is still the one this device last saw (the rules demand exactly rev + 1), so two
// devices that both changed never overwrite each other: that is a conflict and the player picks a side. 'Changed' = dirty
// or the save's fingerprint is not the synced one (another tab, or an old build's, wrote it). Every overwrite of local
// data is backed up first and stored before it counts as synced; if either write fails (storage full / blocked) nothing
// is applied (save.js backupSave / replaceSave, 設定 → 元に戻す). Linking needs working localStorage. Ghosts and device
// settings (graphics quality, sound) stay per device. Node-safe at import: tools/gen-rules.mjs reads the constants.
import { getSave, persist, replaceSave, backupSave, backups, setPersistHook } from './save.js';
import { CAR_BY_ID, ECONOMY } from './data.js';
import { fb, uidOf, within, lbReady } from './lb.js';
import { encodeSave, decodeSave, fnv } from './pwa.js';

export const CODE_ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // no 0/O or 1/I: 32^6 ≈ 1e9 codes
export const CODE_RE = /^[23456789A-HJ-NP-Z]{6}$/;
export const GROUP_RE = /^[A-Za-z0-9_-]{20,40}$/;
export const CODE_MS = 600000, SAVE_MAX = 200000;   // SAVE_MAX = pwa.js MAX_CODE, so decodeSave takes it
const G_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const SK = 'ngp.sync';

const rand = (n, abc) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => abc[b % abc.length]).join('');   // 256 % 32 = 256 % 64 = 0: uniform
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const denied = e => /permission/i.test(`${e?.code} ${e?.message}`);

// storage blocked (in-app browsers, site data off): never linked, start / join refuse (a download couldn't be kept)
const st = () => { try { const v = localStorage.getItem(SK); return v ? JSON.parse(v) : null; } catch { return null; } };
const put = v => { try { if (v) localStorage.setItem(SK, JSON.stringify(v)); else localStorage.removeItem(SK); } catch { /* no storage */ } };
const canStore = () => { try { localStorage.setItem(SK + '.t', '1'); localStorage.removeItem(SK + '.t'); return true; } catch { return false; } };
const set = patch => { const s = st(); if (s?.g) put({ ...s, ...patch }); };   // only while linked (an unlink may land mid-upload)
const linked = () => !!st()?.g;
export const syncLinked = linked;

const fpOf = s => fnv(JSON.stringify({ ...s, quality: undefined, sound: undefined }));
const fp = () => fpOf(getSave());
const carsOf = s => Object.keys(s.cars).filter(id => Object.hasOwn(CAR_BY_ID, id)).length;
const hasProgress = s => s.stats.races > 0 || carsOf(s) > 1 || s.coins !== ECONOMY.startCoins || s.tickets !== ECONOMY.startTickets;

/* ================= browser side ================= */
const S = { phase: '', msg: '', err: false, conflict: null, members: null, code: null, offset: 0, online: false, subs: null, info: null, uploading: false, seen: 0, joining: false, joinCode: '', confirm: '', bakOpen: false };
let H = { idle: () => true, applied() {}, toast() {} }, LABEL = '端末';
const $ = id => document.getElementById(id);
const serverNow = () => Date.now() + S.offset;
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const when = t => { if (!t) return '—'; const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${hm(t)}`; };
const ago = t => { const m = (serverNow() - t) / 60000; return !t ? '' : m < 2 ? 'たった今' : m < 60 ? `${m | 0}分前` : m < 2880 ? `${m / 60 | 0}時間前` : `${m / 1440 | 0}日前`; };
const sum = s => `コイン ${s.coins.toLocaleString()}・チケット ${s.tickets.toLocaleString()}・車 ${carsOf(s)}台`;

// What save a has that b doesn't, short (the chooser: coins / cars can match while paint or skills differ).
// [text, swatch colour | null]. Node-safe (tools/check-save.mjs).
export function saveDiff(a, b) {
  const out = [], sg = n => (n > 0 ? '+' : '−') + Math.abs(n).toLocaleString(), known = id => Object.hasOwn(CAR_BY_ID, id);
  const num = (x, k) => (Number.isFinite(x?.[k]) ? x[k] : 0);
  for (const [k, t] of [['coins', 'コイン'], ['tickets', 'チケット']]) if (num(a, k) !== num(b, k)) out.push([`${t} ${sg(num(a, k) - num(b, k))}`, null]);
  if (num(a.stats, 'races') !== num(b.stats, 'races')) out.push([`レース ${sg(num(a.stats, 'races') - num(b.stats, 'races'))}回`, null]);
  let recs = 0;
  for (const id of Object.keys(a.cars).filter(known)) {
    const x = a.cars[id] || {}, y = b.cars[id], n = CAR_BY_ID[id].name, col = /^#[0-9a-f]{6}$/i.test(x.look?.body) ? x.look.body : null;
    if (!y) { out.push([`${n}を持っている`, null]); continue; }
    const xn = Array.isArray(x.nodes) ? x.nodes : [], yn = Array.isArray(y.nodes) ? y.nodes : [];
    if (xn.length !== yn.length) out.push([`${n} スキル${sg(xn.length - yn.length)}`, null]);
    else if ([...xn].sort().join() !== [...yn].sort().join()) out.push([`${n}のスキル`, null]);
    if (num(x, 'dupes') !== num(y, 'dupes')) out.push([`${n} 限界突破${sg(num(x, 'dupes') - num(y, 'dupes'))}`, null]);
    const lx = x.look || {}, ly = y.look || {};
    if (lx.body !== ly.body || lx.wheel !== ly.wheel) out.push([`${n}の色`, col]);
    else if (!!lx.wing !== !!ly.wing) out.push([`${n}のウイング${lx.wing ? 'あり' : 'なし'}`, null]);
    for (const [tid, r] of Object.entries(x.best || {})) {   // records this side holds that are better than the other's
      const o = y.best?.[tid] || {};
      for (const k of ['lap', 'race']) if (Number.isFinite(r?.[k]) && !(o[k] <= r[k])) recs++;
    }
  }
  for (const id of Object.keys(b.cars).filter(known)) if (!Object.hasOwn(a.cars, id)) out.push([`${CAR_BY_ID[id].name}を持っていない`, null]);
  if (recs) out.push([`ベスト記録 ${recs}件`, null]);
  if (a.name !== b.name) out.push([`名前「${String(a.name).slice(0, 12)}」`, null]);
  if (a.selected?.p1 !== b.selected?.p1 && known(String(a.selected?.p1))) out.push([`選んでいる車: ${CAR_BY_ID[a.selected.p1].name}`, null]);
  return out;
}

function deviceLabel() {
  const ua = navigator.userAgent, touch = navigator.maxTouchPoints > 1;
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && touch) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Androidタブレット') : /CrOS/.test(ua) ? 'Chromebook'
      : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : '端末';
  const app = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  const br = app ? 'アプリ' : /Edg\//.test(ua) ? 'Edge' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return (br ? `${os}・${br}` : os).slice(0, 24);
}

// the SDK (lb.js) + connection state; throws 'offline' at once rather than waiting out a timeout
async function db(signIn = false) {
  if (!lbReady()) throw new Error('not configured');
  if (!navigator.onLine) throw new Error('offline');
  const c = await fb(), { D, d } = c;
  S.info ||= [D.onValue(D.ref(d, '.info/connected'), s => {
    const was = S.online;
    S.online = !!s.val();
    // back online: the SDK reconnects on its own schedule, so a run started by the 'online' event may have timed out
    if (S.online && !was && linked() && (st().dirty || S.phase === 'error' || S.phase === 'offline')) kick();
    render();
  }),
    D.onValue(D.ref(d, '.info/serverTimeOffset'), s => { S.offset = +s.val() || 0; })];
  return { ...c, uid: await uidOf(signIn) };
}
async function connected() {   // writes that need the server clock (code expiry) or must not sit in the offline queue
  for (const t = Date.now(); !S.online;) { if (Date.now() - t > 12000) throw new Error('timeout'); await sleep(150); }
}

function listen(D, d, s) {
  if (S.subs) return;
  const bad = e => { console.warn('sync: listener', e); unlisten(); kick(); };   // e.g. no longer a member: the next step says so
  S.subs = [
    D.onValue(D.ref(d, `saves/${s.g}/rev`), snap => { if (!S.uploading && snap.val() !== st()?.rev) kick(); }, bad),
    D.onValue(D.ref(d, `members/${s.g}`), snap => {
      const m = snap.val() || {};
      const joined = S.code && Object.values(m).find(x => x?.code === S.code.code);
      if (joined) { dropCode(false); S.msg = `${String(joined.label).slice(0, 24)} が連携しました`; H.toast(S.msg); }
      S.members = m;
      render();
    }, bad),
  ];
}
function unlisten() { S.subs?.forEach(off => off()); S.subs = null; S.members = null; }

// a new state (offline / waiting / conflict / error) replaces what the status line said before (e.g. 'X が連携しました')
function phase(p) {
  if (p !== S.phase && p !== 'sync' && p !== 'ok') { S.msg = ''; S.err = false; }
  S.phase = p;
}

/* ---------- the engine: one run at a time ---------- */
let running = null, again = false, T = 0, idleT = 0;
const schedule = ms => { clearTimeout(T); T = setTimeout(run, ms); };
const kick = () => schedule(0);
function run() {
  if (running) { again = true; return running; }
  clearTimeout(T);
  running = (async () => {
    for (let i = 0; i < 3; i++) {
      again = false;
      try { await step(); S.err = false; if (S.phase !== 'wait' && S.msg.startsWith('⚠')) S.msg = ''; }
      catch (e) {
        if (denied(e) && i < 2) { again = true; continue; }   // a stale upload (another device wrote first): look again
        fail(e);
        schedule(60000);
        break;
      }
      if (!again) break;
    }
  })().finally(() => { running = null; render(); if (again) schedule(1000); });
  return running;
}
function fail(e) {
  console.warn('sync', e);
  const m = String(e?.message);
  phase(m === 'offline' ? 'offline' : 'error');
  if (S.phase === 'error') S.msg = `⚠ ${m === 'too big' ? 'データが大きすぎて送れません' : m === 'bad cloud' ? 'クラウドのデータを読めませんでした'
    : m === 'no space' ? 'この端末に保存できませんでした（空き容量不足など）。データはそのままです' : 'つながりませんでした。あとで自動でやり直します'}`;
}

async function step() {
  const s = st();
  if (!s?.g || S.conflict) return;
  if (!navigator.onLine) { phase('offline'); return; }
  phase('sync');
  render();
  const { D, d, uid } = await db();
  if (uid !== s.uid) return lost();   // the anonymous sign-in is gone (storage cleared): not a member any more
  listen(D, d, s);
  let c;
  try { c = (await within(D.get(D.ref(d, `saves/${s.g}`)))).val(); } catch (e) { if (denied(e)) return lost(); throw e; }
  let cur = st();
  if (cur?.g !== s.g) return;   // unlinked meanwhile
  // changed without this tab's persist hook (another tab, an old build's tab): as good as dirty
  if (!cur.dirty && cur.h && fp() !== cur.h) put(cur = { ...cur, dirty: true, at: serverNow() });
  if (Date.now() - S.seen > 600000) {   // 'last seen' in the device list
    S.seen = Date.now();
    D.update(D.ref(d, `members/${s.g}/${uid}`), { label: LABEL, seen: D.serverTimestamp() }).catch(e => console.warn('sync: seen', e));
  }
  const crev = c?.rev || 0;
  if (crev !== cur.rev) {
    if (!c) set({ rev: 0, dirty: true });   // no cloud copy (should not happen while a member): send ours
    else {
      const cs = await decodeSave(c.data);
      if (!cs) throw new Error('bad cloud');
      const ch = fpOf(cs), mine = cur.sent?.[0] === crev && cur.sent?.[1] === ch;
      // the same data (another tab here sent it, or our upload whose answer got lost): just take the rev
      if (ch === fp() || mine) set({ rev: crev, h: ch, dirty: fp() !== ch, sent: null });
      else if (cur.dirty) return conflict(c, cs);
      else return apply(c, cs);
    }
  }
  if (st().dirty) await upload(D, d, st());
  set({ synced: Date.now() });
  phase('ok');
}

async function upload(D, d, s) {
  const h = fp(), data = await encodeSave(getSave()), rev = s.rev + 1;
  if (data.length > SAVE_MAX) throw new Error('too big');
  set({ sent: [rev, h] });
  S.uploading = true;
  try {
    await within(D.set(D.ref(d, `saves/${s.g}`), { data, rev, at: D.serverTimestamp(), by: LABEL }), 20000);
  } finally { S.uploading = false; }
  set({ rev, h, dirty: fp() !== h, sent: null });   // changes made while it was on its way stay dirty
}

// cloud → this device, never mid-race / mid-dialog: wait until the UI is idle. force = the player chose the cloud's in a
// conflict (this device's data is the unchosen side). Throws 'no space' having changed nothing if a write fails.
function apply(c, cs, force = false) {
  if (!H.idle()) { phase('wait'); waitIdle(); return; }
  if (!force && st().dirty) return conflict(c, cs);
  const cur = getSave();
  if (!backupSave(force ? 'この端末のデータ（選ばなかった方）' : 'クラウドのデータを読み込む前', cur, !force)
    || !replaceSave({ ...cs, quality: cur.quality, sound: cur.sound })) throw new Error('no space');
  set({ rev: c.rev, h: fp(), dirty: false, sent: null, synced: Date.now() });
  phase('ok');
  H.applied();
  H.toast(`クラウドのデータを読み込みました（${String(c.by || '別の端末').slice(0, 24)}）`);
}
function waitIdle() {
  clearTimeout(idleT);
  idleT = setTimeout(() => {
    if (!H.idle()) return waitIdle();
    if (!S.conflict) run();
    else if (!S.conflict.shown) choose();
  }, 1500);
}
function conflict(c, cs) {
  S.conflict = { c, cs, shown: false };
  phase('conflict');
  if (H.idle()) choose(); else waitIdle();
}
function lost() {
  unlisten();
  dropCode(false);
  closeChooser();
  put({ lost: true });
  Object.assign(S, { conflict: null, phase: '', msg: '' });
  H.toast('連携が切れました。もう一度コードで連携してください', 'err');
  render();
}

/* ---------- conflict / join chooser (in-page) ---------- */
function choose() {
  const k = S.conflict;
  if (!k) return;
  k.shown = true;
  let el = $('syncAsk');
  if (!el) {
    el = Object.assign(document.createElement('div'), { id: 'syncAsk', className: 'overlay' });
    document.body.append(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-sy]'); if (b) resolve(b.dataset.sy); });
  }
  const joined = !st()?.rev, me = getSave();
  const diff = (s, o) => {   // what this side has that the other doesn't: up to 6 chips
    const d = saveDiff(s, o), chip = ([t, c]) => `<li>${esc(t)}${c ? `<i style="background:${c}"></i>` : ''}</li>`;
    return `<ul class="sync-diff" aria-label="もう一方との違い">${d.length ? d.slice(0, 6).map(chip).join('') + (d.length > 6 ? `<li>ほか${d.length - 6}件</li>` : '') : '<li>違いは細かい設定だけ</li>'}</ul>`;
  };
  const side = (title, s, o, at, by, key) => `<div class="sync-side"><b>${title}</b><dl>`
    + `<dt>コイン</dt><dd>${s.coins.toLocaleString()}</dd><dt>チケット</dt><dd>${s.tickets.toLocaleString()}</dd><dt>車</dt><dd>${carsOf(s)}台</dd>`
    + `<dt>レース</dt><dd>${s.stats.races}回</dd><dt>最終更新</dt><dd>${when(at)}</dd><dt>端末</dt><dd>${esc(by)}</dd></dl>${diff(s, o)}`
    + `<button class="btn primary" data-sy="${key}">${title}を使う</button></div>`;
  el.innerHTML = '<div class="panel sync-ask" role="dialog" aria-modal="true" aria-labelledby="syncAskT"><h3 id="syncAskT">どちらのデータを使いますか？</h3>'
    + `<p>${joined ? 'この端末にも遊んだデータがあります。' : 'この端末とクラウドの両方でデータが変わりました。'}使う方を選んでください（合算はされません）。選ばなかった方はこの端末のバックアップに残ります（設定 → データ連携 → 元に戻す）</p>`
    + `<div class="sync-cmp">${side('この端末のデータ', me, k.cs, st()?.at, LABEL, 'local')}${side('クラウドのデータ', k.cs, me, +k.c.at || 0, String(k.c.by || '?'), 'cloud')}</div>`
    + `<div class="sync-foot">${joined ? '<button class="btn sm" data-sy="leave">連携をやめる</button>' : ''}<button class="btn sm" data-sy="later">あとで選ぶ</button></div></div>`;
  el.hidden = false;
  el.querySelector('[data-sy="later"]').focus();   // it opens on its own: a stray Enter / Space must not pick a side
  render();
}
function closeChooser() { const el = $('syncAsk'); if (el) el.hidden = true; }
function resolve(pick) {
  const k = S.conflict;
  closeChooser();
  if (!k || pick === 'later') return render();
  if (pick === 'leave') { S.conflict = null; return unlink(); }
  try {
    if (pick === 'cloud') apply(k.c, k.cs, true);
    // this device's data goes up over the cloud's; the cloud's is kept here as a backup
    else if (!backupSave('クラウドのデータ（選ばなかった方）', k.cs)) throw new Error('no space');
    else set({ rev: k.c.rev, dirty: true, sent: null });
    S.conflict = null;
    if (pick === 'local') run();
  } catch (e) { fail(e); }   // the conflict stays (設定 → 選ぶ)
  render();
}
// Esc / Android back (ui.js): 'あとで選ぶ'
export function syncDialogClose() {
  if ($('syncAsk')?.hidden !== false) return false;
  resolve('later');
  return true;
}

/* ---------- linking ---------- */
const say = (m, err = false) => { S.msg = m; S.err = err; render(); };
const oops = e => {
  const m = String(e?.message);
  console.warn('sync', e);
  say(m === 'offline' ? 'オフラインです。電波のあるところでもう一度どうぞ' : m === 'too big' ? 'データが大きすぎて送れません' : 'つながりませんでした。もう一度どうぞ', true);
};
async function newCode(D, d, g, uid, extra = {}) {   // retried on a (1e-9) collision with a live code
  for (let i = 0; ; i++) {
    const code = rand(6, CODE_ABC), exp = serverNow() + CODE_MS - 15000;   // 15 s for clock / offset error
    try {
      await within(D.update(D.ref(d), { ...extra, [`codes/${code}`]: { g, exp, by: uid } }), 20000);
      dropCode();
      S.code = { code, exp };
      clearInterval(S.tick);
      S.tick = setInterval(tickCode, 1000);
      return;
    } catch (e) { if (!denied(e) || i >= 2) throw e; }
  }
}
function dropCode(del = true) {
  clearInterval(S.tick);
  const c = S.code?.code;
  S.code = null;
  if (del && c) fb().then(({ D, d }) => D.remove(D.ref(d, `codes/${c}`))).catch(() => {});
}
function tickCode() {
  if (!S.code) return clearInterval(S.tick);
  const left = S.code.exp - serverNow();
  if (left <= 0) { dropCode(); return say('コードの期限が切れました。「端末を追加」でもう一度出せます'); }
  const el = $('syncCd');
  if (el) el.textContent = `のこり ${left / 60000 | 0}:${pad((left / 1000 | 0) % 60)}`;
}

const NO_STORE = 'このブラウザはデータを保存できないため連携できません（Safari / Chrome で開くか、サイトデータの保存を許可してください）';
// the update that takes uid out of group g; the last member takes the cloud copy with it (the rules require that)
async function leaving(D, d, g, uid) {
  const m = (await within(D.get(D.ref(d, `members/${g}`)))).val() || {};
  return m[uid] ? { [`members/${g}/${uid}`]: null, ...(Object.keys(m).every(u => u === uid) && { [`saves/${g}`]: null }) } : {};
}
async function start() {
  if (!canStore()) return say(NO_STORE, true);
  say('クラウドに保存しています…');
  try {
    const { D, d, uid } = await db(true);
    await connected();
    const h = fp(), data = await encodeSave(getSave()), g = rand(24, G_ABC);
    if (data.length > SAVE_MAX) throw new Error('too big');
    // a uid may be in only one group it started (own/<uid>, the rules): still in the last one (this device's link was
    // dropped without leaving, e.g. part of its site data cleared)? leave it in the same update
    const old = (await within(D.get(D.ref(d, `own/${uid}`)))).val();
    const out = old ? await leaving(D, d, old, uid).catch(e => { if (denied(e)) return {}; throw e; }) : {};   // denied: not in it
    // one update: first member ('new group' rule) + the save + a code
    await newCode(D, d, g, uid, {
      ...out,
      [`own/${uid}`]: g,
      [`members/${g}/${uid}`]: { label: LABEL, seen: D.serverTimestamp() },
      [`saves/${g}`]: { data, rev: 1, at: D.serverTimestamp(), by: LABEL },
    });
    put({ g, uid, rev: 1, h, dirty: fp() !== h, synced: Date.now() });
    S.seen = Date.now();
    say('連携を始めました。もう一方の端末でこのコードを入れてください');
    run();
  } catch (e) { oops(e); }
}
async function issue() {
  const s = st();
  say('コードを発行しています…');
  try {
    const { D, d, uid } = await db();
    await connected();
    await newCode(D, d, s.g, uid);
    say('');
  } catch (e) { oops(e); if (denied(e)) run(); }
}
async function join() {
  const code = S.joinCode.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!CODE_RE.test(code)) return say('6文字のコードを入れてね（0・1・I・O は使いません）', true);
  if (!canStore()) return say(NO_STORE, true);
  say('確認しています…');
  try {
    const { D, d, uid } = await db(true);
    await connected();
    const c = (await within(D.get(D.ref(d, `codes/${code}`)))).val();
    if (!c || !GROUP_RE.test(String(c.g))) return say('コードが見つかりません。期限切れ（10分）か、もう使われたコードかもしれません', true);
    if (!(c.exp > serverNow())) return say('コードの期限が切れています。もう一方の端末で新しいコードを出してね', true);
    try {
      // membership + using up the code, at once (the rules require both)
      await within(D.update(D.ref(d), { [`members/${c.g}/${uid}`]: { label: LABEL, seen: D.serverTimestamp(), code }, [`codes/${code}`]: null }), 20000);
    } catch (e) {
      if (denied(e)) return say('このコードでは連携できませんでした（使用済みか期限切れです）', true);
      throw e;
    }
    // rev 0: the cloud copy is always 'new'; with progress here that is a conflict → the chooser
    put({ g: c.g, uid, rev: 0, h: '', dirty: hasProgress(getSave()), at: null });
    Object.assign(S, { joining: false, joinCode: '', seen: Date.now() });
    say('連携しました');
    run();
  } catch (e) { oops(e); }
}
async function unlink() {
  const s = st();
  if (!s?.g) return;
  say('解除しています…');
  try {
    const { D, d, uid } = await db();
    await connected();
    if (uid === s.uid) {
      unlisten();
      // denied twice = not a member (any more); once may be the member list changing between the read and the write
      for (let i = 0; ; i++) {
        try { await within(D.update(D.ref(d), await leaving(D, d, s.g, uid)), 20000); break; } catch (e) { if (!denied(e) || i) throw e; }
      }
    }
  } catch (e) { if (!denied(e)) { oops(e); return run(); } }   // denied: not a member anyway
  dropCode();
  unlisten();
  closeChooser();
  put(null);
  Object.assign(S, { conflict: null, phase: '', confirm: '' });
  say('連携を解除しました。この端末のデータはそのままです');
}
function restore(at) {   // by the backup's time: a download meanwhile shifts the list
  const b = backups().find(x => x.at === at);
  if (!b) return render();
  if (!backupSave('元に戻す前') || !replaceSave(b.save)) return say('⚠ この端末に保存できませんでした（空き容量不足など）。データはそのままです', true);
  persist();   // → dirty → sent to the linked devices like any change
  H.applied();
  say(`${when(b.at)} のデータに戻しました`);
}

/* ---------- 設定 → データ連携, and the home icon ---------- */
function icon() {
  const el = $('syncIcon');
  if (!el) return;
  const s = st() || {};
  el.hidden = !s.g && !s.lost;
  const k = s.lost || S.conflict || S.phase === 'error' ? 'bad' : S.phase === 'sync' ? 'sync' : s.dirty || S.phase === 'wait' ? 'wait' : 'ok';
  el.dataset.k = k;
  el.querySelector('i').textContent = { bad: '⚠', sync: '↻', wait: '↻', ok: '✓' }[k];
  el.title = el.ariaLabel = `クラウドセーブ: ${{ bad: s.lost ? '連携が切れました' : S.conflict ? 'データの競合' : 'エラー', sync: '同期中', wait: '未送信の変更あり', ok: '同期済み' }[k]}`;
}
function render() {
  icon();
  const box = $('syncSet');
  if (!box?.closest('.screen.active')) return;
  const s = st() || {}, focus = document.activeElement?.id;
  let h = '<h3>データ連携（クラウドセーブ）</h3>';
  if (!lbReady()) h += '<p class="hint">準備中です</p>';
  else if (!s.g) {
    if (s.lost) h += '<div class="sync-warn"><p>連携が切れました。もう一度コードで連携してください（この端末のデータはそのままです）</p><button class="btn sm" data-sy="dismiss">閉じる</button></div>';
    h += '<p class="hint">PC・スマホ・タブレット（Safari とホーム画面のアプリも）で同じデータを自動で共有します。ログイン不要、6文字のコードでつなぎます。ゴーストは共有されません（端末ごと）。</p>'
      + '<div class="pwa-xf"><button class="btn sm primary" data-sy="start">連携を始める</button><button class="btn sm" data-sy="enter">コードを入力</button></div>';
    if (S.joining) {
      h += `<div class="sync-join"><input class="inp sync-in" id="syncIn" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="6文字のコード" aria-label="連携コード" value="${esc(S.joinCode)}"><button class="btn sm primary" data-sy="join">連携する</button></div>`
        + '<p class="hint">もう一方の端末の 設定 →「データ連携」で出したコードを入れてください</p>';
    }
  } else {
    const m = S.members, n = m ? Object.keys(m).length : null;
    h += `<p class="sync-st">連携中 ✓ ・ 最終同期 ${s.synced ? hm(s.synced) : '—'} ・ 連携端末 ${n ?? '—'}台</p>`;
    const now = S.conflict ? '⚠ データの競合：どちらを使うか選んでください' : S.phase === 'sync' ? '同期中…'
      : S.phase === 'wait' ? 'レースが終わったらクラウドのデータを読み込みます' : !navigator.onLine || S.phase === 'offline' ? `オフライン${s.dirty ? '：変更は電波が戻ったら送ります' : ''}`
        : s.dirty ? '未送信の変更があります' : '';
    if (now) h += `<p class="sync-now${S.conflict ? ' err' : ''}">${now}${S.conflict ? ' <button class="btn sm" data-sy="choose">選ぶ</button>' : ''}</p>`;
    if (m) {
      h += `<ul class="sync-devs">${Object.entries(m).sort(([a, x], [b, y]) => (b === s.uid) - (a === s.uid) || (y?.seen || 0) - (x?.seen || 0))
        .map(([u, x]) => `<li><span>${esc(String(x?.label || '?').slice(0, 24))}</span><small>${u === s.uid ? 'この端末' : ago(+x?.seen || 0)}</small></li>`).join('')}</ul>`;
    }
    if (S.code) {
      const left = S.code.exp - serverNow();
      h += `<div class="sync-code"><span>連携コード</span><b>${S.code.code}</b><small id="syncCd">のこり ${Math.max(0, left / 60000 | 0)}:${pad(Math.max(0, (left / 1000 | 0) % 60))}</small>`
        + '<p class="hint">追加したい端末で 設定 →「データ連携」→「コードを入力」。1回だけ・10分間使えます</p>'
        + '<div class="pwa-xf"><button class="btn sm" data-sy="copy">コピー</button><button class="btn sm" data-sy="uncode">取り消す</button></div></div>';
    }
    h += `<div class="pwa-xf"><button class="btn sm" data-sy="now">今すぐ同期</button>${S.code ? '' : '<button class="btn sm" data-sy="issue">端末を追加</button>'}<button class="btn sm" data-sy="ask-unlink">連携を解除</button></div>`;
    if (S.confirm === 'unlink') {
      h += `<div class="pwa-ask"><p>この端末の連携を解除します。この端末のデータはそのまま残り、ほかの端末との同期が止まります${n === 1 ? '（最後の1台なので、クラウドのデータは削除されます）' : ''}</p>`
        + '<div class="pwa-acts"><button class="btn sm" data-sy="no">やめる</button><button class="btn sm danger" data-sy="unlink">解除する</button></div></div>';
    }
    h += '<p class="hint">ゴーストと画質・効果音の設定は共有されません（端末ごと）</p>';
  }
  h += `<div class="pwa-msg${S.err ? ' err' : ''}" role="status">${esc(S.msg)}</div>`;
  const bak = backups();
  if (bak.length) {
    h += `<details class="sync-bak"${S.bakOpen ? ' open' : ''}><summary>元に戻す（上書き前のバックアップ ${bak.length}件）</summary><ul>`
      + bak.map(b => `<li><span>${when(b.at)} ${esc(b.why)}<small>${esc(sum(b.save))}</small></span>`
        + (S.confirm === `bak${b.at}` ? `<span class="pwa-acts"><button class="btn sm" data-sy="no">やめる</button><button class="btn sm danger" data-sy="restore" data-i="${+b.at}">戻す</button></span>`
          : `<button class="btn sm" data-sy="ask-bak" data-i="${+b.at}">元に戻す</button>`) + '</li>').join('')
      + `</ul><p class="hint">いまのデータもバックアップに残ります${s.g ? '。連携中の端末にも送られます' : ''}</p></details>`;
  }
  box.innerHTML = h;
  if (focus && $(focus) && box.contains($(focus))) $(focus).focus();
}
export const renderSyncSettings = render;

async function click(b) {
  const a = b.dataset.sy, s = st() || {};
  S.confirm = a.startsWith('ask-') ? a.slice(4) + (b.dataset.i ?? '') : '';
  if (S.confirm) return render();
  if (a === 'start') start();
  else if (a === 'enter') { S.joining = true; render(); $('syncIn')?.focus(); }
  else if (a === 'join') join();
  else if (a === 'now') { S.msg = ''; S.seen = 0; await run(); if (!S.err) say(S.phase === 'ok' ? '同期しました' : S.phase === 'offline' ? 'オフラインです。電波が戻ったら同期します' : ''); }
  else if (a === 'issue') issue();
  else if (a === 'uncode') { dropCode(); say('コードを取り消しました'); }
  else if (a === 'copy' && S.code) {
    try { await navigator.clipboard.writeText(S.code.code); say('コピーしました'); } catch { say('コードを見ながら入力してね'); }
  } else if (a === 'unlink') unlink();
  else if (a === 'choose') choose();
  else if (a === 'restore') restore(+b.dataset.i);
  else if (a === 'dismiss') { if (s.lost) put(null); render(); } else render();
}

// ui.js at boot: idle() = no race / dialog / gacha reveal (a download waits for it), applied() = the save object was
// replaced in place (refresh the screen), toast(msg, kind)
export function initSync(hooks) {
  H = { ...H, ...hooks };
  LABEL = deviceLabel();
  setPersistHook(() => {
    const s = st();
    if (!s?.g) return;
    const dirty = fp() !== s.h;
    if (dirty || s.dirty) set({ dirty, ...(dirty && { at: serverNow() }) });   // server clock: the chooser shows it next to the cloud's
    if (dirty) { schedule(3000); icon(); }
  });
  const box = $('syncSet');
  box?.addEventListener('click', e => { const b = e.target.closest('[data-sy]'); if (b && !b.disabled) click(b); });
  box?.addEventListener('input', e => {
    if (e.target.id !== 'syncIn') return;
    e.target.value = S.joinCode = e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 6);
  });
  box?.addEventListener('keydown', e => { if (e.target.id === 'syncIn' && e.key === 'Enter' && !e.isComposing) join(); });
  box?.addEventListener('toggle', e => { if (e.target.matches?.('.sync-bak')) S.bakOpen = e.target.open; }, true);   // re-renders keep it open
  // the home icon (topbar, home only): opens 設定 at this section
  const ic = Object.assign(document.createElement('button'), { id: 'syncIcon', className: 'sync-ic', hidden: true, innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/></svg><i></i>' });
  ic.dataset.go = 'settings';
  ic.addEventListener('click', () => setTimeout(() => $('syncSet')?.scrollIntoView({ block: 'start' }), 0));
  document.querySelector('.wallet')?.prepend(ic);
  // upload: ~3 s after a change (persist hook), when the page is hidden, back online, after a race (syncKick);
  // download: at start, when shown again, and when the cloud rev moves (listener)
  document.addEventListener('visibilitychange', () => { if (linked() && (!document.hidden || st().dirty)) run(); });
  addEventListener('online', () => { if (linked()) run(); render(); });
  addEventListener('offline', () => { if (linked()) { phase('offline'); render(); } });
  if (linked()) setTimeout(run, 1500);
  icon();
}
export function syncKick() { if (linked()) run(); }
