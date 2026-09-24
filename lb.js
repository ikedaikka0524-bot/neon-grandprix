// Global online leaderboard: Firebase Anonymous Auth + Realtime Database (see SETUP-FIREBASE.md, database.rules.json).
// The SDK is imported lazily, only when the leaderboard is opened or a time-attack record is sent, so the game loads and
// runs exactly as before offline / blocked / unconfigured (FIREBASE_CONFIG null → lbReady() false, nothing is sent).
// Layout: lb/<trackId>/<bucket>/<uid> = { name, race, raceCar, raceAt, lap, lapCar, lapAt, v } (the player's bests;
// bucket = 'all' | rarity of the car), ghosts/<trackId>/<bucket>/<uid> = { data, time, carId, look, trackId, v }
// (the ghost of that entry's race time, a separate path so listing stays cheap).
// Emulator (tests): localStorage 'ngp.lb.emu' = '1' → demo project on 127.0.0.1:9099 (auth) / :9000 (database).
// Node-safe at import time (tools/gen-rules.mjs, tools/check-lb-rules.mjs import it): no DOM / three.js at top level.
import { CAR_BY_ID, RARITY_ORDER } from './data.js';
import { TRACK_BY_ID } from './tracks.js';
import { getSave } from './save.js';
import { FIREBASE_CONFIG } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
export const BUCKETS = ['all', ...RARITY_ORDER];
export const TOP = 50;
export const RANK_CAP = 1000;
export const GHOST_MAX = 204800;   // base64 chars; the rules allow the same
const DT = 0.05, SCALE = [100, 100, 100, 100, 1e4];   // ghost.js frames: x y z heading rounded to 0.01, progress to 1e-4
const QKEY = 'ngp.lb.queue', ASKED = 'ngp.lb.named';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
};
const emu = () => ls.get('ngp.lb.emu') === '1';
const config = () => (emu() ? { apiKey: 'demo-key', projectId: 'demo-neongp', databaseURL: 'https://demo-neongp-default-rtdb.firebaseio.com' } : FIREBASE_CONFIG);
export const lbReady = () => !!config()?.databaseURL;
export const nameAsked = () => ls.get(ASKED) === '1';
export const setNameAsked = () => ls.set(ASKED, '1');

// Car ids start with their rarity (n_ r_ sr_ ur_); the rules use the same pattern. Checking the shape (never a bare
// CAR_BY_ID[id] lookup) keeps ids like 'constructor' / '__proto__' from other players off Object.prototype.
export const CAR_RE = /^(n|r|sr|ur)_[a-z0-9_]{1,21}$/;
export const rarityOf = id => (typeof id === 'string' && CAR_RE.exec(id)?.[1].toUpperCase()) || null;
export const cleanName = n => String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12) || 'Player';
const hex6 = v => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null);
const cleanLook = (l, id) => ({ body: hex6(l?.body) || CAR_BY_ID[id]?.color || '#ffffff', wheel: hex6(l?.wheel) || '#222222', wing: !!l?.wing });

// Fastest plausible average speed. Measured best time attacks (UR + every node, ability on cooldown): circuit 60 m/s,
// Monza 73.5 m/s (ur_warp); top speed with every node is ≤ 83 m/s and warp adds ≈ 4 m/s on average. The control-point
// polyline is a little shorter than the driven line, so these floors are generous (the rules use the same numbers).
export const MAX_AVG = 120;
export function minTimes(tid) {
  const def = TRACK_BY_ID[tid], P = def.points;
  const L = P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); }, 0);
  return { race: Math.floor(L * def.laps / MAX_AVG * 100) / 100, lap: Math.floor(L / MAX_AVG * 100) / 100 };
}
const okTime = (v, min) => typeof v === 'number' && Number.isFinite(v) && v >= min && v < 3600;
// entries that break the rules (rules not deployed yet, old data) are simply not shown
function clean(uid, e, tid) {
  const m = minTimes(tid);
  if (!e || typeof e.name !== 'string' || !okTime(e.race, m.race) || !okTime(e.lap, m.lap) || !rarityOf(e.raceCar) || !rarityOf(e.lapCar)) return null;
  return { uid, name: cleanName(e.name), race: e.race, lap: e.lap, raceCar: e.raceCar, lapCar: e.lapCar, raceAt: +e.raceAt || 0, lapAt: +e.lapAt || 0 };
}

const within = (p, ms = 12000) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

// A failed import() stays failed for the life of the page (the browser caches it in the module map, so an import made
// offline never works even after the signal is back). So: fetch() the SDK first (a failed fetch is not cached), and if
// import() still fails, give up until a reload (queued runs are sent on the next boot).
let conn = null, sdkDead = false;
export const lbNeedsReload = () => sdkDead;
function fb() {
  conn ||= (async () => {
    if (!lbReady()) throw new Error('not configured');
    if (sdkDead) throw new Error('reload needed');
    const urls = ['app', 'auth', 'database'].map(m => `${SDK}firebase-${m}.js`);
    await within(Promise.all(urls.map(u => fetch(u).then(r => { if (!r.ok) throw new Error(`sdk ${r.status}`); }))), 20000);
    const [A, U, D] = await within(Promise.all(urls.map(u => import(u))), 20000).catch(e => { if (e?.message !== 'timeout') sdkDead = true; throw e; });
    const app = A.getApps()[0] || A.initializeApp(config()), au = U.getAuth(app), d = D.getDatabase(app);
    if (emu()) { U.connectAuthEmulator(au, 'http://127.0.0.1:9099', { disableWarnings: true }); D.connectDatabaseEmulator(d, '127.0.0.1', 9000); }
    return { U, D, au, d };
  })().catch(e => { conn = null; throw e; });
  return conn;
}
async function uidOf(signIn) {
  const { U, au } = await fb();
  await within(au.authStateReady());
  return au.currentUser?.uid || (signIn ? (await within(U.signInAnonymously(au))).user.uid : null);
}

/* ---------- ghost codec: quantized 2nd-order deltas, column-major Int32, gzip, base64 ---------- */
// The input goes in 1 KB at a time while the output is read, so the cap is checked after every ≤ ~1 MB of output
// (deflate inflates at most ~1:1032): a whole-input write would let a small gzip bomb inflate to 150 MB before the check.
async function gz(bytes, fmt, cap = Infinity) {
  const w = fmt.writable.getWriter(), r = fmt.readable.getReader(), parts = [];
  (async () => { for (let i = 0; i < bytes.length; i += 1024) await w.write(bytes.subarray(i, i + 1024)); await w.close(); })().catch(() => {});   // errors surface on the reader
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    if ((n += value.length) > cap) { r.cancel().catch(() => {}); throw new Error('ghost too big'); }
    parts.push(value);
  }
  return new Uint8Array(await new Blob(parts).arrayBuffer());
}
export async function packGhost(g) {
  const F = g.frames, n = F.length, a = new Int32Array(n * 5);
  for (let k = 0; k < 5; k++) {
    let p = 0, pd = 0;
    for (let i = 0; i < n; i++) { const q = Math.round(F[i][k] * SCALE[k]), d = q - p; a[k * n + i] = d - pd; p = q; pd = d; }
  }
  const b = await gz(new Uint8Array(a.buffer), new CompressionStream('gzip'));
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function unpackGhost(s) {
  const b = await gz(Uint8Array.from(atob(s), c => c.charCodeAt(0)), new DecompressionStream('gzip'), 72000 * 20);
  if (!b.length || b.length % 20) throw new Error('bad ghost');
  const a = new Int32Array(b.buffer, 0, b.length / 4), n = a.length / 5, F = Array.from({ length: n }, () => new Array(5));
  for (let k = 0; k < 5; k++) {
    let p = 0, d = 0;
    for (let i = 0; i < n; i++) { d += a[k * n + i]; p += d; F[i][k] = p / SCALE[k]; }
  }
  return F;
}
// A downloaded ghost node → ghostData for game.js (throws if anything is off). time = the entry's race time.
export async function checkGhost(g, tid, time) {
  const def = TRACK_BY_ID[tid];
  if (!def || !g || typeof g.data !== 'string' || !g.data.length || g.data.length > GHOST_MAX || g.trackId !== tid
    || !okTime(g.time, minTimes(tid).race) || Math.abs(g.time - time) > 0.01 || !rarityOf(g.carId)) throw new Error('bad ghost');
  const F = await unpackGhost(g.data), last = F[F.length - 1];
  const sane = f => f.every(Number.isFinite) && Math.abs(f[0]) < 2e4 && Math.abs(f[1]) < 2e3 && Math.abs(f[2]) < 2e4 && f[4] > -1.5 && f[4] < def.laps + 1;
  if (F.length < 20 || Math.abs((F.length - 1) * DT - g.time) > 1 || last[4] < def.laps - 0.05 || !F.every(sane)) throw new Error('bad ghost');
  return { v: 1, trackId: tid, carId: g.carId, look: cleanLook(g.look, g.carId), time: g.time, dt: DT, frames: F };
}

/* ---------- reading ---------- */
async function rankOf(tid, bucket, metric, t) {
  const { D, d } = await fb();
  // ponytail: RTDB has no count query, so this downloads up to RANK_CAP faster entries; past that the rank shows as 1000+
  const s = await within(D.get(D.query(D.ref(d, `lb/${tid}/${bucket}`), D.orderByChild(metric), D.endAt(t), D.limitToFirst(RANK_CAP + 1))));
  let n = 0;
  s.forEach(c => { const e = clean(c.key, c.val(), tid); if (e && e[metric] < t) n++; });
  return Math.min(n, RANK_CAP) + 1;
}
export const rankText = r => (r > RANK_CAP ? `${RANK_CAP}+` : String(r));

// Top TOP of a bucket by metric ('race' | 'lap') + the player's own row (rank computed when outside the top).
export async function lbTop(tid, bucket, metric) {
  const { D, d } = await fb();
  const s = await within(D.get(D.query(D.ref(d, `lb/${tid}/${bucket}`), D.orderByChild(metric), D.limitToFirst(TOP))));
  const rows = [];
  s.forEach(c => { const e = clean(c.key, c.val(), tid); if (e) rows.push(e); });
  rows.sort((a, b) => a[metric] - b[metric]);
  rows.forEach((e, i) => { e.rank = i && rows[i - 1][metric] === e[metric] ? rows[i - 1].rank : i + 1; });
  const uid = await uidOf(false);
  let me = rows.find(e => e.uid === uid) || null;
  if (uid && !me) {
    const e = clean(uid, (await within(D.get(D.ref(d, `lb/${tid}/${bucket}/${uid}`)))).val(), tid);
    if (e) me = { ...e, rank: await rankOf(tid, bucket, metric, e[metric]) };
  }
  return { rows, me };
}

export async function lbGhost(tid, bucket, row) {
  const { D, d } = await fb();
  const g = (await within(D.get(D.ref(d, `ghosts/${tid}/${bucket}/${row.uid}`)), 20000)).val();
  return { ...await checkGhost(g, tid, row.race), name: row.name, lb: true };
}

/* ---------- submitting (queued in localStorage until the server has it) ---------- */
// The queue this tab last wrote, ghosts included: when storage is full the stored copy has lost its ghosts (or was not
// stored at all), so this tab still sends what it has in memory; localStorage is only the backup for the next boot.
let mem = [];
const sameRun = (a, b) => a.trackId === b.trackId && a.carId === b.carId && a.race === b.race && a.lap === b.lap;
const readQ = () => {
  let q = null;
  try { q = JSON.parse(ls.get(QKEY)); } catch {}
  q = Array.isArray(q) ? q : [];
  return [...q.map(x => mem.find(m => sameRun(m, x)) || x), ...mem.filter(m => !q.some(x => sameRun(x, m)))];
};
const writeQ = q => { mem = q; ls.set(QKEY, JSON.stringify(q)) || ls.set(QKEY, JSON.stringify(q.map(x => ({ ...x, ghost: null })))); };

// run = { trackId, carId, race, lap, ghost: ghostData } from a finished time attack
export async function lbQueue(run) {
  if (!lbReady() || !TRACK_BY_ID[run.trackId] || !rarityOf(run.carId) || !okTime(run.race, 0) || !okTime(run.lap, 0)) return;
  let ghost = null;
  try {
    const data = await packGhost(run.ghost);
    if (data.length <= GHOST_MAX) ghost = { data, time: run.race, carId: run.carId, look: cleanLook(run.ghost.look, run.carId), trackId: run.trackId, v: 1 };
  } catch (e) { console.warn('ghost pack failed', e); }
  const item = { trackId: run.trackId, carId: run.carId, race: run.race, lap: run.lap, ghost };
  const r = rarityOf(item.carId), q = readQ(), near = x => x.trackId === item.trackId && rarityOf(x.carId) === r;
  if (q.some(x => near(x) && x.race <= item.race && x.lap <= item.lap)) return;   // a queued run already beats it
  writeQ([...q.filter(x => !(near(x) && item.race <= x.race && item.lap <= x.lap)), item].slice(-20));
}
export const lbPending = () => readQ().length > 0;

async function submit(uid, it) {
  const { D, d } = await fb(), name = cleanName(getSave().name), buckets = ['all', rarityOf(it.carId)];
  const cur = await Promise.all(buckets.map(b => within(D.get(D.ref(d, `lb/${it.trackId}/${b}/${uid}`))).then(s => s.val())));
  const upd = {}, won = [];
  buckets.forEach((b, i) => {
    const e = cur[i], race = !(e?.race <= it.race), lap = !(e?.lap <= it.lap);
    if (!race && !lap) return;
    const path = `${it.trackId}/${b}/${uid}`;
    upd[`lb/${path}`] = {
      name, v: 1,
      race: race ? it.race : e.race, raceCar: race ? it.carId : e.raceCar, raceAt: race ? D.serverTimestamp() : e.raceAt,
      lap: lap ? it.lap : e.lap, lapCar: lap ? it.carId : e.lapCar, lapAt: lap ? D.serverTimestamp() : e.lapAt,
    };
    if (race) { upd[`ghosts/${path}`] = it.ghost; won.push([b, 'race']); }   // no ghost (too big): drop the stale one
    if (lap) won.push([b, 'lap']);
  });
  if (!won.length) return null;
  await within(D.update(D.ref(d), upd), 30000);
  won.sort((a, b) => (a[1] === 'race' ? 0 : 2) + (a[0] === 'all' ? 0 : 1) - (b[1] === 'race' ? 0 : 2) - (b[0] === 'all' ? 0 : 1));
  const [b, m] = won[0], rank = await rankOf(it.trackId, b, m, m === 'race' ? it.race : it.lap).catch(() => 0);   // saved even if this fails
  const where = `${m === 'lap' ? 'ベストラップ ' : ''}${b === 'all' ? '世界' : b}ランキング`;
  return rank ? `${where} ${rankText(rank)}位！` : `${where}に登録しました`;
}

// Sends every queued run; resolves to a toast text for the best new rank (or null). Rejects when offline etc.
// (the queue stays for next time). A run the rules reject is dropped so it can't block the queue forever.
let flushing = null;
export function lbFlush() {
  return flushing ||= (async () => {
    if (!lbReady() || !readQ().length) return null;
    const uid = await uidOf(true);
    let msg = null;
    for (const it of readQ()) {
      try { msg = (await submit(uid, it)) || msg; } catch (e) { if (!/permission/i.test(e?.message)) throw e; console.warn('lb: rejected', e); }
      writeQ(readQ().filter(x => !sameRun(x, it)));
    }
    return msg;
  })().finally(() => { flushing = null; });
}
