// Online multiplayer over a public MQTT broker (global `mqtt`, mqtt.js 5). Works behind any NAT/phone network:
// WebRTC needs a TURN relay for those and the free ones are dead. Room code picks the broker (first char), so
// host and guests always meet on the same one.
// Topics under neongp26/<CODE>/:  room (retained, host alive)  h (guest -> host control)  a (host -> all control)
//                                 g (game traffic from everyone: state / ability / finish; the host's own 'go' copy)
//                                 s/<pid> (WebRTC signalling to pid)  e/<pid> (pid's own broker-RTT echo)
// 'state' also goes straight to peers over WebRTC data channels where STUN manages to open one (see links()); MQTT
// stays the control plane and relays state to whoever has no working channel.
import { CAR_BY_ID, STARTER_CAR } from './data.js';
import { createP2P } from './p2p.js';
import { newCarRec } from './save.js';
import { TRACK_BY_ID, DEFAULT_TRACK } from './tracks.js';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
// broker.emqx.io silently drops whatever one client publishes beyond ~10 msg/s, QoS 1 included (measured: a 20 Hz
// state stream lost half of the 'go' / 'finish' / 'results' messages sent alongside it; hivemq and mosquitto lost
// none). So hosts try it last (the code -> broker mapping is unchanged), and on it states are thinned out.
const HOST_ORDER = [1, 2, 0];
const CAPPED = new Set([0]), CAPPED_STATE_MS = 150;
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const CONNECT_TIMEOUT = 10000;   // per broker
const FIND_TIMEOUT = 8000;       // no retained room message -> room doesn't exist
const JOIN_TIMEOUT = 25000;      // whole join, incl. broker connect
const RESULTS_WAIT = 30000;      // after the first finisher
const HB_EVERY = 2000, HB_DEAD = 15000;   // generous: background tabs throttle timers
// Start without a player whose race is still loading after this. A forced straggler counts 3-2-1 while the others
// already drive, so wait out slow first-visit model downloads (players that vanish are dropped after HB_DEAD anyway).
const READY_WAIT = 60000;
const GO_ECHO_WAIT = 2500;       // host: start anyway if its own 'go' never comes back from the broker
const HEX = /^#[0-9a-f]{6}$/i;
const GAME = new Set(['state', 'ability', 'finish']);
const ECHO_EVERY = 2000;   // broker RTT probe
const isTrack = id => typeof id === 'string' && Object.hasOwn(TRACK_BY_ID, id);   // peer data: no 'constructor' etc.
// Game traffic carries the start rid: a peer still on the last race's results screen keeps sending states (with its
// old ft) until its own 'start' arrives, and those must not land in the next race. No rid on either side: old client.
const sameRace = (m, rid) => m.rid == null || rid == null || m.rid === rid;

const brokerOf = code => CODE_CHARS.indexOf(code[0]) % BROKERS.length;
const randId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
function genCode(broker) {
  let code;
  do code = Array.from({ length: 5 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  while (brokerOf(code) !== broker);
  return code;
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

// Sanitized roster entry (peer data is untrusted).
function entry(pid, d = {}) {
  const carId = CAR_BY_ID[d.carId] ? d.carId : STARTER_CAR;
  const def = newCarRec(carId).look, l = d.look || {};
  return {
    pid: String(pid),
    name: String(d.name ?? '').trim().slice(0, 16) || 'Player',
    carId,
    look: { body: HEX.test(l.body) ? l.body : def.body, wheel: HEX.test(l.wheel) ? l.wheel : def.wheel, wing: !!l.wing },
  };
}

function connectBroker(url, will) {
  return new Promise((resolve, reject) => {
    if (typeof mqtt === 'undefined' || !mqtt.connect) return reject(new Error('通信ライブラリを読み込めませんでした'));
    const c = mqtt.connect(url, {
      clientId: 'ngp_' + randId(), clean: true, keepalive: 20,
      connectTimeout: CONNECT_TIMEOUT, reconnectPeriod: 2000, resubscribe: true, will,
    });
    c.on('error', e => console.warn('[net] mqtt error', e?.message || e));   // unhandled 'error' would throw
    const timer = setTimeout(() => { c.end(true); reject(new Error('サーバーに接続できません')); }, CONNECT_TIMEOUT + 500);
    c.once('connect', () => { clearTimeout(timer); resolve(c); });
  });
}

function wire(client, base, onMsg, capped) {
  let lastState = 0;
  client.on('message', (topic, buf) => {
    const kind = topic.slice(base.length + 1);
    let m = null;
    if (buf.length) { try { m = JSON.parse(buf.toString()); } catch { return; } }
    onMsg(kind, m);
  });
  const pub = (kind, m, opts = {}) => {
    if (capped && m?.t === 'state') { const now = Date.now(); if (now - lastState < CAPPED_STATE_MS) return; lastState = now; }
    try { client.publish(`${base}/${kind}`, m == null ? '' : JSON.stringify(m), { qos: opts.qos ?? 1, retain: !!opts.retain }); }
    catch (e) { console.warn('[net] publish failed', e); }
  };
  return pub;
}

// State fast path shared by host and guest. pub = wire() publisher, roster() = current roster, onP2P(m) gets states
// that came over a data channel (m.pid set from the channel, not trusted from the payload).
// Every state carries q (per-sender sequence: the same state can arrive over both paths, receivers keep only newer
// ones) and br (own broker RTT, for the relay latency estimate). It goes over MQTT too while any peer lacks an open
// channel (p2p send/isOpen turn false 2.5 s after the last pong; send then still uses the channel too).
function links(pid, pub, roster, onP2P) {
  let p2p = null, brtt = null, seq = 0, closed = false;
  const peers = new Map();   // pid -> { q, br }
  const linked = new Set();
  const call = (fn, ...a) => { try { return p2p?.[fn](...a); } catch (e) { console.warn('[net] p2p', e); } };
  const others = () => roster().flatMap(e => (e?.pid != null && String(e.pid) !== pid ? [String(e.pid)] : []));
  const inRoster = p => others().includes(p);
  const lat = (p, direct) => {
    if (direct) return (call('rtt', p) ?? 60) / 2;   // rtt: null until the first pong
    const br = peers.get(p)?.br;
    return br != null && brtt != null ? (br + brtt) / 2 : 150;
  };
  try {
    p2p = createP2P({ selfPid: pid, sendSignal: (to, data) => { if (!closed) pub(`s/${to}`, { from: pid, data }); } });
    p2p.onMessage((from, m) => {
      if (closed || m?.t !== 'state') return;   // only state travels this way
      m.pid = String(from);
      onP2P(m);
    });
  } catch (e) { console.warn('[net] p2p unavailable', e); p2p = null; }
  const echo = setInterval(() => pub(`e/${pid}`, { at: performance.now() }, { qos: 0 }), ECHO_EVERY);

  return {
    // own-topic MQTT traffic (signalling, echo); true if handled
    mqtt(kind, m) {
      if (kind === `e/${pid}`) {
        const r = performance.now() - m?.at;
        if (r >= 0 && r < 10000) brtt = brtt == null ? r : brtt + (r - brtt) * 0.3;
        return true;
      }
      if (kind !== `s/${pid}`) return false;
      // not roster-filtered: an offer can overtake the roster update that lists its sender (what comes over the
      // channel is roster-checked in accept()/onGame anyway)
      if (!closed && m?.from != null) call('handleSignal', String(m.from), m.data);
      return true;
    },
    // connect to new roster peers, drop gone ones (connect is deterministic: the smaller pid offers)
    sync() {
      if (closed) return;
      const now = new Set(others());
      for (const p of now) if (!linked.has(p)) { linked.add(p); call('connect', p); }
      for (const p of linked) if (!now.has(p)) { linked.delete(p); peers.delete(p); call('close', p); }
    },
    // incoming state (either path): false if stale / duplicate / not a roster peer; else notes it and sets m.lat
    accept(m, viaP2P) {
      const p = String(m.pid);
      if (!inRoster(p)) return false;
      let st = peers.get(p);
      if (!st) peers.set(p, st = {});
      if (Number.isFinite(m.q)) { if (m.q <= st.q) return false; st.q = m.q; }   // no q: old client, MQTT only
      st.br = Number.isFinite(m.br) ? Math.min(Math.max(m.br, 0), 5000) : null;
      m.lat = lat(p, viaP2P);
      return true;
    },
    // outgoing state: stamps it, sends it on every open channel; true if it must go over MQTT as well
    state(m) {
      m.q = ++seq;
      if (brtt != null) m.br = Math.round(brtt);
      let relay = false;
      for (const p of others()) if (!call('send', p, m)) relay = true;
      return relay;
    },
    // { [pid]: { p2p, lat } } for the HUD
    info() {
      const out = {};
      for (const p of others()) {
        const direct = !!call('isOpen', p);
        out[p] = { p2p: direct, lat: Math.round(lat(p, direct)) };
      }
      return out;
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(echo);
      call('close');
    },
  };
}

export async function hostRoom(name) {
  let client = null, code, pid = randId(), lastErr;
  for (const b of HOST_ORDER) {
    if (client) break;
    code = genCode(b);
    const room = `neongp26/${code}/room`;
    try { client = await connectBroker(BROKERS[b], { topic: room, payload: '', retain: true, qos: 1 }); }
    catch (e) { lastErr = e; }
  }
  if (!client) throw lastErr || new Error('サーバーに接続できません');

  const base = `neongp26/${code}`;
  const ee = emitter();
  const seen = new Map();    // guest pid -> last receive time
  let race = null, closed = false, rid = null;
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const inRoster = p => s.roster.some(e => e.pid === p);

  const pub = wire(client, base, (kind, m) => {
    if (closed || L.mqtt(kind, m) || !m || typeof m.t !== 'string') return;
    if (kind === 'h') onControl(m);
    else if (kind === 'g') onGame(m);
  }, CAPPED.has(brokerOf(code)));
  const L = links(pid, pub, () => s.roster, m => { if (!closed) onGame(m, true); });
  const pushRoster = () => { pub('a', { t: 'roster', roster: s.roster, trackId: s.trackId }); emit('roster', s.roster); L.sync(); };
  const setEntry = (p, me) => { s.roster = s.roster.map(e => (e.pid === p ? entry(p, { ...e, ...me }) : e)); pushRoster(); };

  function finishRace(r) {
    if (race !== r) return;
    clearTimeout(r.timer);
    clearInterval(r.startTimer);
    race = null;
    const prog = p => r.prog.get(p) ?? -1;
    const placements = r.pids
      .map(p => ({ pid: p, time: r.times.get(p) ?? null }))
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || prog(b.pid) - prog(a.pid));
    const m = { t: 'results', placements };
    pub('a', m);
    emit('results', m);
    // the broker can drop a QoS1 message: repeat (games ignore duplicates) unless a new race already started
    for (const d of [1500, 4000]) setTimeout(() => { if (!closed && !race) pub('a', m); }, d);
  }
  // Deferred so a 'results' never fires re-entrantly inside the host game's own send().
  function checkDone() {
    const r = race;
    if (r && r.pids.every(p => r.times.has(p) || !inRoster(p))) setTimeout(() => finishRace(r), 0);
  }

  function drop(p) {
    seen.delete(p);
    if (!inRoster(p) || p === pid) return;
    s.roster = s.roster.filter(e => e.pid !== p);
    const m = { t: 'leave', pid: p };
    pub('a', m);
    emit('leave', m);
    pushRoster();
    checkDone();
    checkReady();
  }

  // Everyone has loaded the race (or READY_WAIT passed): one 'go' starts all countdowns together.
  function markReady(p) {
    const r = race;
    if (!r) return;
    // straggler after a forced start. The host itself too: its 'go' was emitted while its race was still loading,
    // with nobody listening (if goSent is still false, the echo / goTimer delivers it, and the listener exists now).
    if (r.went) { if (p !== pid) pub('a', { t: 'go' }); else if (r.goSent) emit('go', { t: 'go' }); return; }
    r.ready.add(p);
    checkReady();
  }
  function checkReady(force) {
    const r = race;
    if (!r || r.went || !(force || r.pids.every(p => r.ready.has(p) || !inRoster(p)))) return;
    r.went = true;
    clearTimeout(r.readyTimer);
    clearInterval(r.startTimer);
    pub('a', { t: 'go' });
    // The host's own countdown starts when a copy of its 'go' comes back through the broker, i.e. when the guests
    // get theirs; emitting it right away put the host a whole relay trip (~1 s measured) ahead of everyone else.
    pub('g', { t: 'go', pid });
    r.goTimer = setTimeout(() => hostGo(r), GO_ECHO_WAIT);
  }
  function hostGo(r) {
    if (!r || r.goSent) return;
    r.goSent = true;
    clearTimeout(r.goTimer);
    emit('go', { t: 'go' });
  }

  function onControl(m) {
    const p = String(m.pid ?? '');
    if (!p || p === pid) return;
    if (m.t === 'bye') return drop(p);
    if (m.t === 'hello') {
      seen.set(p, Date.now());
      if (inRoster(p)) return pushRoster();            // repeated hello: guest missed the roster
      if (s.roster.length >= MAX_PLAYERS || race) return pub('a', { t: 'full', to: p, started: !!race });
      s.roster = [...s.roster, entry(p, m)];
      return pushRoster();
    }
    if (!inRoster(p)) return;
    seen.set(p, Date.now());
    if (m.t === 'me') setEntry(p, m);
    else if (m.t === 'ready') markReady(p);
  }

  // Everyone's game traffic (the host's own comes back too: MQTT echoes to subscribers).
  function onGame(m, viaP2P = false) {
    const p = String(m.pid ?? '');
    if (m.t === 'go') { if (p === pid && race?.went) hostGo(race); return; }
    if (!GAME.has(m.t) || !sameRace(m, rid)) return;
    if (p !== pid) {
      if (!inRoster(p) || (m.t === 'state' && !L.accept(m, viaP2P))) return;
      seen.set(p, Date.now());
      emit(m.t, m);
    }
    const r = race;
    if (!r || !r.pids.includes(p)) return;
    if (m.t === 'state' && Number.isFinite(m.p)) r.prog.set(p, m.p);
    // finish time from 'finish' or piggybacked on 'state' (ft): either one getting through is enough
    const ft = m.t === 'finish' ? m.time : m.t === 'state' ? m.ft : NaN;
    if (Number.isFinite(ft) && !r.times.has(p)) {
      r.times.set(p, ft);
      r.timer ??= setTimeout(() => finishRace(r), RESULTS_WAIT);
      checkDone();
    }
  }

  await new Promise((res, rej) => client.subscribe([`${base}/h`, `${base}/g`, `${base}/s/${pid}`, `${base}/e/${pid}`], { qos: 1 }, e => (e ? rej(e) : res())))
    .catch(() => { L.close(); client.end(true); throw new Error('サーバーに接続できません'); });
  const announce = () => pub('room', { v: 1, host: pid }, { retain: true });
  announce();
  client.on('connect', announce);   // re-announce after an auto-reconnect (the will cleared it)

  const hb = setInterval(() => {
    const now = Date.now();
    for (const [p, t] of seen) if (now - t > HB_DEAD) drop(p);
    pub('a', { t: 'hb' }, { qos: 0 });
  }, HB_EVERY);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(hb);
    L.close();
    if (race) { clearTimeout(race.timer); clearTimeout(race.readyTimer); clearTimeout(race.goTimer); clearInterval(race.startTimer); }
    race = null;
    removeEventListener('pagehide', close);
    pub('a', { t: 'closed' });
    pub('room', null, { retain: true });
    client.end(false);
  }
  addEventListener('pagehide', close);

  const s = {
    isHost: true, code, pid,
    roster: [entry(pid, { name })],
    trackId: DEFAULT_TRACK,
    setTrack(id) { if (isTrack(id) && !closed) { s.trackId = id; pushRoster(); } },
    on: ee.on,
    setMe: me => setEntry(pid, me),
    send: msg => {
      if (closed || !GAME.has(msg?.t)) return;
      const m = { ...msg, pid, rid };
      if (m.t !== 'state' || L.state(m)) pub('g', m, { qos: m.t === 'state' ? 0 : 1 });
      onGame(m);   // count the host's own finish now instead of trusting the broker echo
    },
    linkInfo: () => L.info(),
    ready: () => markReady(pid),
    startGame() {
      if (race) { clearTimeout(race.timer); clearTimeout(race.readyTimer); clearTimeout(race.goTimer); clearInterval(race.startTimer); }
      const r = race = { pids: s.roster.map(e => e.pid), times: new Map(), prog: new Map(), timer: null, ready: new Set(), went: false };
      r.readyTimer = setTimeout(() => { if (race === r) checkReady(true); }, READY_WAIT);
      const m = { t: 'start', roster: s.roster, trackId: s.trackId, rid: (rid = randId()) };
      pub('a', m);
      emit('start', m);
      // repeat until everyone is loaded (guests start a given rid only once)
      r.startTimer = setInterval(() => { if (race === r && !r.went) pub('a', m); else clearInterval(r.startTimer); }, 3000);
    },
    close,
  };
  return s;
}

// me = optional { carId, look }: sent with 'hello' so the first roster entry already has the right car
export async function joinRoom(code, name, me = {}) {
  code = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  if (!/^[A-Z2-9]{5}$/.test(code)) throw new Error('部屋が見つかりません');
  const base = `neongp26/${code}`, pid = randId();
  const client = await connectBroker(BROKERS[brokerOf(code)], { topic: `${base}/h`, payload: JSON.stringify({ t: 'bye', pid }), qos: 1, retain: false });

  const ee = emitter();
  let joined = false, found = false, closed = false, last = Date.now(), hb = 0, helloT = 0, readyT = 0, lastRid = null, resolveJoin, rejectJoin;
  const joinP = new Promise((res, rej) => { resolveJoin = res; rejectJoin = rej; });
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const findT = setTimeout(() => { if (!found) fail('部屋が見つかりません'); }, FIND_TIMEOUT);
  const joinT = setTimeout(() => fail('接続タイムアウト'), JOIN_TIMEOUT);

  const pub = wire(client, base, (kind, m) => {
    if (closed || L.mqtt(kind, m)) return;
    if (kind === 'room') {
      if (m?.host && !found) { found = true; clearTimeout(findT); sayHello(); helloT = setInterval(sayHello, 2000); }
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    last = Date.now();
    if (kind === 'g') {
      if (joined && GAME.has(m.t) && String(m.pid) !== pid && sameRace(m, lastRid) && (m.t !== 'state' || L.accept(m, false))) emit(m.t, m);
      return;
    }
    // kind === 'a': host control
    if (m.t === 'hb') return;
    if (m.t === 'full') { if (m.to === pid) fail(m.started ? 'レースが始まっています' : '満員です'); return; }
    if (m.t === 'closed') return lost();
    if (m.t === 'start') {
      if (m.rid && m.rid === lastRid) return;   // host repeats 'start' until everyone is ready
      lastRid = m.rid;
      clearInterval(readyT);
    }
    if (m.t === 'go') clearInterval(readyT);
    if (m.t === 'roster' || m.t === 'start') s.roster = Array.isArray(m.roster) ? m.roster : s.roster;
    if ((m.t === 'roster' || m.t === 'start') && isTrack(m.trackId)) s.trackId = m.trackId;
    if (!joined) {
      if (m.t !== 'roster' || !s.roster.some(e => e.pid === pid)) return;
      joined = true;
      clearTimeout(joinT); clearInterval(helloT);
      hb = setInterval(() => (Date.now() - last > HB_DEAD ? lost() : pub('h', { t: 'hb', pid }, { qos: 0 })), HB_EVERY);
      resolveJoin(s);
    }
    if (m.t === 'roster' || m.t === 'start') L.sync();
    emit(m.t, m.t === 'roster' ? m.roster : m);
  }, CAPPED.has(brokerOf(code)));
  const L = links(pid, pub, () => s.roster, m => { if (joined && !closed && sameRace(m, lastRid) && L.accept(m, true)) emit('state', m); });
  const sayHello = () => pub('h', { t: 'hello', pid, name, carId: me.carId, look: me.look });

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(findT); clearTimeout(joinT); clearInterval(helloT); clearInterval(hb); clearInterval(readyT);
    L.close();
    removeEventListener('pagehide', close);
    pub('h', { t: 'bye', pid });
    client.end(false);
  }
  function fail(text) {
    if (joined || closed) return;
    close();
    rejectJoin(new Error(text));
  }
  function lost() {
    if (closed) return;
    if (!joined) return fail('接続に失敗しました');
    close();
    ee.emit('closed', { t: 'closed' });
  }
  addEventListener('pagehide', close);

  client.subscribe([`${base}/a`, `${base}/g`, `${base}/room`, `${base}/s/${pid}`, `${base}/e/${pid}`], { qos: 1 }, e => { if (e) fail('サーバーに接続できません'); });

  const s = {
    isHost: false, code, pid,
    roster: [],
    trackId: DEFAULT_TRACK,
    on: ee.on,
    setMe: m => pub('h', { ...m, t: 'me', pid }),
    ready() {   // repeat until the host's 'go' (a QoS1 publish can still be lost across a broker reconnect)
      clearInterval(readyT);
      const say = () => pub('h', { t: 'ready', pid });
      say();
      readyT = setInterval(say, 3000);
    },
    send: msg => {
      if (closed || !GAME.has(msg?.t)) return;
      const m = { ...msg, pid, rid: lastRid };
      if (m.t !== 'state' || L.state(m)) pub('g', m, { qos: m.t === 'state' ? 0 : 1 });
    },
    linkInfo: () => L.info(),
    close,
  };
  return joinP;
}
