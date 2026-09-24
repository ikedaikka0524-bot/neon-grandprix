// Online multiplayer over a public MQTT broker (global `mqtt`, mqtt.js 5). Works behind any NAT/phone network:
// WebRTC needs a TURN relay for those and the free ones are dead. Room code picks the broker (first char), so
// host and guests always meet on the same one.
// Topics under neongp26/<CODE>/:  room (retained, host alive)  h (guest -> host control)  a (host -> all control)
//                                 g (game traffic from everyone: state / ability / finish)
import { CAR_BY_ID, STARTER_CAR } from './data.js';
import { newCarRec } from './save.js';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 4;
const CONNECT_TIMEOUT = 10000;   // per broker
const FIND_TIMEOUT = 8000;       // no retained room message -> room doesn't exist
const JOIN_TIMEOUT = 25000;      // whole join, incl. broker connect
const RESULTS_WAIT = 30000;      // after the first finisher
const HB_EVERY = 2000, HB_DEAD = 15000;   // generous: background tabs throttle timers
const READY_WAIT = 20000;        // start without a player whose race is still loading after this
const HEX = /^#[0-9a-f]{6}$/i;
const GAME = new Set(['state', 'ability', 'finish']);

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

function wire(client, base, onMsg) {
  client.on('message', (topic, buf) => {
    const kind = topic.slice(base.length + 1);
    let m = null;
    if (buf.length) { try { m = JSON.parse(buf.toString()); } catch { return; } }
    onMsg(kind, m);
  });
  const pub = (kind, m, opts = {}) => {
    try { client.publish(`${base}/${kind}`, m == null ? '' : JSON.stringify(m), { qos: opts.qos ?? 1, retain: !!opts.retain }); }
    catch (e) { console.warn('[net] publish failed', e); }
  };
  return pub;
}

export async function hostRoom(name) {
  let client = null, code, pid = randId(), lastErr;
  for (let b = 0; b < BROKERS.length && !client; b++) {
    code = genCode(b);
    const room = `neongp26/${code}/room`;
    try { client = await connectBroker(BROKERS[b], { topic: room, payload: '', retain: true, qos: 1 }); }
    catch (e) { lastErr = e; }
  }
  if (!client) throw lastErr || new Error('サーバーに接続できません');

  const base = `neongp26/${code}`;
  const ee = emitter();
  const seen = new Map();    // guest pid -> last receive time
  let race = null, closed = false;
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const inRoster = p => s.roster.some(e => e.pid === p);

  const pub = wire(client, base, (kind, m) => {
    if (closed || !m || typeof m.t !== 'string') return;
    if (kind === 'h') onControl(m);
    else if (kind === 'g') onGame(m);
  });
  const pushRoster = () => { pub('a', { t: 'roster', roster: s.roster }); emit('roster', s.roster); };
  const setEntry = (p, me) => { s.roster = s.roster.map(e => (e.pid === p ? entry(p, { ...e, ...me }) : e)); pushRoster(); };

  function finishRace(r) {
    if (race !== r) return;
    clearTimeout(r.timer);
    race = null;
    const prog = p => r.prog.get(p) ?? -1;
    const placements = r.pids
      .map(p => ({ pid: p, time: r.times.get(p) ?? null }))
      .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || prog(b.pid) - prog(a.pid));
    const m = { t: 'results', placements };
    pub('a', m);
    emit('results', m);
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
    if (r.went) { if (p !== pid) pub('a', { t: 'go' }); return; }   // straggler after a forced start
    r.ready.add(p);
    checkReady();
  }
  function checkReady(force) {
    const r = race;
    if (!r || r.went || !(force || r.pids.every(p => r.ready.has(p) || !inRoster(p)))) return;
    r.went = true;
    clearTimeout(r.readyTimer);
    pub('a', { t: 'go' });
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
  function onGame(m) {
    if (!GAME.has(m.t)) return;
    const p = String(m.pid ?? '');
    if (p !== pid) {
      if (!inRoster(p)) return;
      seen.set(p, Date.now());
      emit(m.t, m);
    }
    const r = race;
    if (!r || !r.pids.includes(p)) return;
    if (m.t === 'state' && Number.isFinite(m.p)) r.prog.set(p, m.p);
    if (m.t === 'finish' && Number.isFinite(m.time) && !r.times.has(p)) {
      r.times.set(p, m.time);
      r.timer ??= setTimeout(() => finishRace(r), RESULTS_WAIT);
      checkDone();
    }
  }

  await new Promise((res, rej) => client.subscribe([`${base}/h`, `${base}/g`], { qos: 1 }, e => (e ? rej(e) : res())))
    .catch(() => { client.end(true); throw new Error('サーバーに接続できません'); });
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
    if (race) { clearTimeout(race.timer); clearTimeout(race.readyTimer); }
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
    on: ee.on,
    setMe: me => setEntry(pid, me),
    send: msg => { if (!closed && GAME.has(msg?.t)) pub('g', { ...msg, pid }, { qos: msg.t === 'state' ? 0 : 1 }); },
    ready: () => markReady(pid),
    startGame() {
      if (race) { clearTimeout(race.timer); clearTimeout(race.readyTimer); }
      const r = race = { pids: s.roster.map(e => e.pid), times: new Map(), prog: new Map(), timer: null, ready: new Set(), went: false };
      r.readyTimer = setTimeout(() => { if (race === r) checkReady(true); }, READY_WAIT);
      const m = { t: 'start', roster: s.roster };
      pub('a', m);
      emit('start', m);
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
  let joined = false, found = false, closed = false, last = Date.now(), hb = 0, helloT = 0, readyT = 0, resolveJoin, rejectJoin;
  const joinP = new Promise((res, rej) => { resolveJoin = res; rejectJoin = rej; });
  const emit = (t, p) => { if (!closed) ee.emit(t, p); };
  const findT = setTimeout(() => { if (!found) fail('部屋が見つかりません'); }, FIND_TIMEOUT);
  const joinT = setTimeout(() => fail('接続タイムアウト'), JOIN_TIMEOUT);

  const pub = wire(client, base, (kind, m) => {
    if (closed) return;
    if (kind === 'room') {
      if (m?.host && !found) { found = true; clearTimeout(findT); sayHello(); helloT = setInterval(sayHello, 2000); }
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    last = Date.now();
    if (kind === 'g') {
      if (joined && GAME.has(m.t) && String(m.pid) !== pid) emit(m.t, m);
      return;
    }
    // kind === 'a': host control
    if (m.t === 'hb') return;
    if (m.t === 'full') { if (m.to === pid) fail(m.started ? 'レースが始まっています' : '満員です'); return; }
    if (m.t === 'closed') return lost();
    if (m.t === 'go') clearInterval(readyT);
    if (m.t === 'start') clearInterval(readyT);
    if (m.t === 'roster' || m.t === 'start') s.roster = Array.isArray(m.roster) ? m.roster : s.roster;
    if (!joined) {
      if (m.t !== 'roster' || !s.roster.some(e => e.pid === pid)) return;
      joined = true;
      clearTimeout(joinT); clearInterval(helloT);
      hb = setInterval(() => (Date.now() - last > HB_DEAD ? lost() : pub('h', { t: 'hb', pid }, { qos: 0 })), HB_EVERY);
      resolveJoin(s);
    }
    emit(m.t, m.t === 'roster' ? m.roster : m);
  });
  const sayHello = () => pub('h', { t: 'hello', pid, name, carId: me.carId, look: me.look });

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(findT); clearTimeout(joinT); clearInterval(helloT); clearInterval(hb); clearInterval(readyT);
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

  client.subscribe([`${base}/a`, `${base}/g`, `${base}/room`], { qos: 1 }, e => { if (e) fail('サーバーに接続できません'); });

  const s = {
    isHost: false, code, pid,
    roster: [],
    on: ee.on,
    setMe: m => pub('h', { ...m, t: 'me', pid }),
    ready() {   // repeat until the host's 'go' (a QoS1 publish can still be lost across a broker reconnect)
      clearInterval(readyT);
      const say = () => pub('h', { t: 'ready', pid });
      say();
      readyT = setInterval(say, 3000);
    },
    send: msg => { if (!closed && GAME.has(msg?.t)) pub('g', { ...msg, pid }, { qos: msg.t === 'state' ? 0 : 1 }); },
    close,
  };
  return joinP;
}
