// Online multiplayer over PeerJS 1.5.4 (global `Peer`). Star topology: the host relays every message.
import { CAR_BY_ID, STARTER_CAR } from './data.js';
import { newCarRec } from './save.js';

const PREFIX = 'crg26-';
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const TIMEOUT = 10000;        // join / server open
const RESULTS_WAIT = 30000;   // after the first finisher
const HB_EVERY = 2000, HB_DEAD = 12000;   // liveness: close event alone misses dropped wifi etc.
const HB = { t: 'hb' };
const CONN_OPTS = { reliable: true, serialization: 'json' };
const PEER_OPTS = { debug: 1 };
// Never relayed from clients: host-authored or internal.
const HOST_ONLY = new Set(['roster', 'start', 'results', 'leave', 'full', 'closed', 'hello', 'me', 'hb']);
const HEX = /^#[0-9a-f]{6}$/i;

const genCode = () => Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');

function errText(e) {
  switch (e?.type) {
    case 'peer-unavailable': return '部屋が見つかりません';
    case 'timeout': return '接続タイムアウト';
    case 'no-lib': return '通信ライブラリを読み込めませんでした';
    case 'browser-incompatible': return 'このブラウザはオンライン対戦に対応していません';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'サーバーに接続できません';
    default: return '接続に失敗しました';
  }
}

function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type).delete(fn);
    },
    emit(type, payload) {
      for (const fn of [...(map.get(type) || [])]) {
        try { fn(payload); } catch (err) { console.error('[net] handler error', err); }
      }
    },
  };
}

function trySend(conn, m) {
  if (conn?.open) try { conn.send(m); } catch (e) { console.warn('[net] send failed', e); }
}

// Sanitized roster entry (peer data is untrusted).
function entry(pid, d = {}) {
  const carId = CAR_BY_ID[d.carId] ? d.carId : STARTER_CAR;
  const def = newCarRec(carId).look, l = d.look || {};
  return {
    pid,
    name: String(d.name ?? '').trim().slice(0, 16) || 'Player',
    carId,
    look: { body: HEX.test(l.body) ? l.body : def.body, wheel: HEX.test(l.wheel) ? l.wheel : def.wheel, wing: !!l.wing },
  };
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    if (typeof Peer !== 'function') return reject({ type: 'no-lib' });
    const peer = new Peer(id, PEER_OPTS);
    const timer = setTimeout(() => fail({ type: 'timeout' }), TIMEOUT);
    function fail(e) { clearTimeout(timer); peer.destroy(); reject(e); }
    peer.once('error', fail);
    peer.once('open', () => { clearTimeout(timer); peer.off('error', fail); resolve(peer); });
  });
}

export async function hostRoom(name) {
  let peer, code;
  for (let tries = 0; !peer; tries++) {
    code = genCode();
    try { peer = await openPeer(PREFIX + code); }
    catch (e) { if (e?.type !== 'unavailable-id' || tries >= 5) throw new Error(errText(e)); }
  }

  const ee = emitter();
  const conns = new Map();   // pid -> admitted DataConnection
  const seen = new Map();    // every live DataConnection -> last receive time
  let race = null, closed = false;
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const broadcast = (m, except) => { for (const c of conns.values()) if (c !== except) trySend(c, m); };
  const inRoster = pid => s.roster.some(e => e.pid === pid);
  const pushRoster = () => { broadcast({ t: 'roster', roster: s.roster }); emit('roster', s.roster); };
  const setEntry = (pid, me) => {
    s.roster = s.roster.map(e => (e.pid === pid ? entry(pid, { ...e, ...me }) : e));
    pushRoster();
  };

  function finishRace(r) {
    if (race !== r) return;
    clearTimeout(r.timer);
    race = null;
    const prog = pid => r.prog.get(pid) ?? -1;
    const placements = r.pids
      .map(pid => ({ pid, time: r.times.get(pid) ?? null }))
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || prog(b.pid) - prog(a.pid));
    const m = { t: 'results', placements };
    broadcast(m);
    emit('results', m);
  }

  // Deferred so a 'results' never fires re-entrantly inside the host game's own send().
  function checkDone() {
    const r = race;
    if (r && r.pids.every(p => r.times.has(p) || !inRoster(p))) setTimeout(() => finishRace(r), 0);
  }

  // Game message from anyone; from = null for the host's own.
  function route(m, from) {
    broadcast(m, from);
    if (from) emit(m.t, m);
    const r = race;
    if (!r || !r.pids.includes(m.pid)) return;
    if (m.t === 'state' && Number.isFinite(m.p)) r.prog.set(m.pid, m.p);
    if (m.t === 'finish' && Number.isFinite(m.time) && !r.times.has(m.pid)) {
      r.times.set(m.pid, m.time);
      r.timer ??= setTimeout(() => finishRace(r), RESULTS_WAIT);
      checkDone();
    }
  }

  function drop(conn) {
    seen.delete(conn);
    const pid = conn.peer;
    if (conns.get(pid) !== conn) return;
    conns.delete(pid);
    s.roster = s.roster.filter(e => e.pid !== pid);
    const m = { t: 'leave', pid };
    broadcast(m);
    emit('leave', m);
    pushRoster();
    checkDone();
  }

  function onData(conn, d) {
    if (!d || typeof d.t !== 'string' || !seen.has(conn)) return;
    seen.set(conn, Date.now());
    const pid = conn.peer;
    if (d.t === 'hello') {
      if (conns.has(pid)) return;
      if (s.roster.length >= MAX_PLAYERS) {
        trySend(conn, { t: 'full' });
        setTimeout(() => conn.close(), 500);   // let 'full' flush first
        return;
      }
      conns.set(pid, conn);
      s.roster = [...s.roster, entry(pid, d)];
      return pushRoster();
    }
    if (!conns.has(pid) || d.t === 'hb') return;
    if (d.t === 'me') return setEntry(pid, d);
    if (!HOST_ONLY.has(d.t)) route({ ...d, pid }, conn);   // pid forced to the real sender
  }

  peer.on('connection', conn => {
    if (closed) return conn.close();
    seen.set(conn, Date.now());
    conn.on('data', d => onData(conn, d));
    conn.on('close', () => drop(conn));
    conn.on('error', e => console.warn('[net] conn error', e?.type, e));
  });
  // Lost the signaling server: existing players stay connected, reconnect so new ones can join.
  peer.on('disconnected', () => setTimeout(() => {
    if (!closed && !peer.destroyed && peer.disconnected) peer.reconnect();
  }, 1000));
  peer.on('error', e => console.warn('[net] peer error', e?.type, e));

  const hb = setInterval(() => {
    const now = Date.now();
    for (const [conn, t] of seen) {
      if (now - t > HB_DEAD) { conn.close(); drop(conn); } else trySend(conn, HB);
    }
  }, HB_EVERY);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    if (race) clearTimeout(race.timer);
    race = null;
    removeEventListener('pagehide', close);
    peer.destroy();
  }
  addEventListener('pagehide', close);

  const s = {
    isHost: true, code, pid: peer.id,
    roster: [entry(peer.id, { name })],
    on: ee.on,
    setMe: me => setEntry(s.pid, me),
    send: msg => route({ ...msg, pid: msg.pid ?? s.pid }, null),
    startGame() {
      if (race) clearTimeout(race.timer);
      race = { pids: s.roster.map(e => e.pid), times: new Map(), prog: new Map(), timer: null };
      const m = { t: 'start', roster: s.roster };
      broadcast(m);
      emit('start', m);
    },
    close,
  };
  return s;
}

export async function joinRoom(code, name) {
  code = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  if (!/^[A-Z2-9]{5}$/.test(code)) throw new Error('部屋が見つかりません');
  const deadline = Date.now() + TIMEOUT;
  let peer;
  try { peer = await openPeer(); } catch (e) { throw new Error(errText(e)); }

  const ee = emitter();
  let joined = false, closed = false, last = Date.now(), hb = 0, resolveJoin, rejectJoin;
  const joinP = new Promise((res, rej) => { resolveJoin = res; rejectJoin = rej; });
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const conn = peer.connect(PREFIX + code, CONN_OPTS);
  const timer = setTimeout(() => fail('接続タイムアウト'), Math.max(1000, deadline - Date.now()));

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    clearInterval(hb);
    removeEventListener('pagehide', close);
    peer.destroy();
  }
  function fail(text) {
    if (joined) return;
    close();
    rejectJoin(new Error(text));
  }
  function lost() {
    if (closed) return;
    if (!joined) return fail('接続に失敗しました');
    close();
    ee.emit('closed', { t: 'closed' });
  }

  peer.on('error', e => (joined ? console.warn('[net] peer error', e?.type, e) : fail(errText(e))));
  conn.on('open', () => conn.send({ t: 'hello', name }));
  conn.on('close', lost);
  conn.on('error', e => console.warn('[net] conn error', e?.type, e));
  conn.on('data', m => {
    if (!m || typeof m.t !== 'string' || closed) return;
    last = Date.now();
    if (m.t === 'hb') return;
    if (m.t === 'full') return fail('満員です');
    if (m.t === 'roster' || m.t === 'start') s.roster = m.roster;
    if (m.t === 'roster' && !joined) {
      joined = true;
      clearTimeout(timer);
      hb = setInterval(() => (Date.now() - last > HB_DEAD ? lost() : trySend(conn, HB)), HB_EVERY);
      resolveJoin(s);
    }
    emit(m.t, m.t === 'roster' ? m.roster : m);
  });
  addEventListener('pagehide', close);

  const s = {
    isHost: false, code, pid: peer.id,
    roster: [],
    on: ee.on,
    setMe: me => trySend(conn, { ...me, t: 'me' }),
    send: msg => trySend(conn, { ...msg, pid: msg.pid ?? s.pid }),
    close,
  };
  return joinP;
}
