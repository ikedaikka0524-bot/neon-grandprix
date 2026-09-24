// Best-effort WebRTC data channels between race peers, for game traffic (state) only. MQTT (net.js) stays the
// always-working transport and the control plane; this just cuts the broker relay out of the state path when the two
// NATs allow a direct link. No TURN (the free ones are dead): strict NATs / some phone networks never open and callers
// keep using MQTT. Roles are fixed (the smaller pid offers), so there is never glare. Never throws into callers.
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
const OPEN_TIMEOUT = 8000;    // no open channel by then: give up quietly
const RETRY_AFTER = 20000;    // ... and try once more this much later (the initiator re-offers; the other side answers)
const PING_EVERY = 1000;
const STALE = 2500;           // no pong for this long (pings go every second, one may be lost): report not open -> MQTT copies too
const CAND_BATCH = 100;       // ms: bundle trickled candidates, the rate-capped broker (emqx) drops bursts
const MAX_BUFFERED = 16384;   // bytes queued in the channel: past this it only adds latency

export function createP2P({ selfPid, sendSignal, iceServers = ICE }) {
  selfPid = String(selfPid);
  const RTC = globalThis.RTCPeerConnection;
  // pid -> { pid, init, tries, pc, dc, cid, open, lastRx, rtt, q, cands, candT, giveUp, retryT }
  const peers = new Map();
  const fns = { msg: new Set(), open: new Set(), close: new Set() };
  let dead = false;
  const now = () => performance.now();
  const fire = (set, ...a) => { for (const fn of set) try { fn(...a); } catch (e) { console.error('[p2p] handler error', e); } };
  const signal = (pid, data) => { try { sendSignal(pid, data); } catch (e) { console.warn('[p2p] signal failed', e); } };
  const live = p => !!p && p.open && p.dc?.readyState === 'open' && now() - p.lastRx < STALE;
  const raw = (p, m) => { try { p.dc.send(JSON.stringify(m)); return true; } catch { return false; } };
  const ping = p => raw(p, { t: '_ping', ts: (p.ping = now()) });
  const safe = fn => (...a) => { try { return fn(...a); } catch (e) { console.warn('[p2p]', e); } };

  function teardown(p) {
    clearTimeout(p.giveUp); clearTimeout(p.candT);
    const pc = p.pc, wasOpen = p.open;
    p.pc = p.dc = null; p.open = false; p.rtt = null;
    try { pc?.close(); } catch {}
    if (wasOpen) fire(fns.close, p.pid);
  }
  function fail(p) {
    teardown(p);
    if (p.init && p.tries < 2 && !dead && peers.get(p.pid) === p) p.retryT = setTimeout(() => attempt(p), RETRY_AFTER);
  }
  // pc operations run one after another (a candidate must not overtake the remote description)
  function queue(p, fn) {
    const pc = p.pc;
    p.q = p.q.then(() => (p.pc === pc ? fn(pc) : 0)).catch(e => console.warn('[p2p]', p.pid, e?.message || e));
  }

  function newPc(p, cid) {
    teardown(p);
    let pc, dc;
    try {
      pc = new RTC({ iceServers });
      dc = pc.createDataChannel('g', { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    } catch (e) { console.warn('[p2p]', e); try { pc?.close(); } catch {} return false; }
    Object.assign(p, { pc, dc, cid, open: false, q: Promise.resolve(), cands: [] });
    const mine = () => p.pc === pc;
    pc.onicecandidate = e => {
      if (!mine() || !e.candidate?.candidate) return;
      p.cands.push(e.candidate.toJSON());
      if (p.cands.length === 1) p.candT = setTimeout(() => { if (mine()) { signal(p.pid, { cid, cands: p.cands }); p.cands = []; } }, CAND_BATCH);
    };
    pc.onconnectionstatechange = () => { if (mine() && pc.connectionState === 'failed') fail(p); };
    dc.onopen = () => {
      if (!mine()) return;
      clearTimeout(p.giveUp);
      p.open = true; p.lastRx = now();
      ping(p);
      fire(fns.open, p.pid);
    };
    dc.onclose = () => { if (mine()) fail(p); };
    dc.onmessage = e => { if (mine()) rx(p, e.data); };
    p.giveUp = setTimeout(() => { if (mine() && !p.open) fail(p); }, OPEN_TIMEOUT);
    return true;
  }

  function attempt(p) {
    if (dead || peers.get(p.pid) !== p) return;
    p.tries++;
    const cid = Math.random().toString(36).slice(2);
    if (!newPc(p, cid)) return;
    queue(p, async pc => {
      await pc.setLocalDescription(await pc.createOffer());
      signal(p.pid, { cid, offer: pc.localDescription.sdp });
    });
  }

  function rx(p, data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === '_ping') raw(p, { t: '_pong', ts: m.ts });
    else if (m.t === '_pong') {
      // liveness = our own pings come back: proves this side's sends arrive (incoming traffic alone doesn't; a
      // one-way dead link would keep us sending into the void instead of falling back to MQTT)
      p.lastRx = now();
      // only the latest ping counts (a stall flushes a backlog of old ones); rises slowly, falls fast, so one hiccup
      // doesn't inflate the latency estimate for long
      if (m.ts !== p.ping) return;
      const s = now() - m.ts;
      p.rtt = p.rtt == null ? s : p.rtt + (s - p.rtt) * (s > p.rtt ? 0.1 : 0.4);
    } else fire(fns.msg, p.pid, m);
  }

  function handleSignal(from, d) {
    from = String(from);
    if (dead || !RTC || from === selfPid || !d || typeof d.cid !== 'string') return;
    let p = peers.get(from);
    if (typeof d.offer === 'string') {
      if (selfPid < from || (p?.pc && p.cid === d.cid)) return;   // roles are fixed; QoS1 may deliver twice
      if (!p) peers.set(from, p = { pid: from, init: false, tries: 0, rtt: null });
      if (!newPc(p, d.cid)) return;
      queue(p, async pc => {
        await pc.setRemoteDescription({ type: 'offer', sdp: d.offer });
        await pc.setLocalDescription(await pc.createAnswer());
        signal(from, { cid: d.cid, answer: pc.localDescription.sdp });
      });
    } else if (!p?.pc || p.cid !== d.cid) return;
    else if (typeof d.answer === 'string') {
      queue(p, pc => pc.signalingState === 'have-local-offer' && pc.setRemoteDescription({ type: 'answer', sdp: d.answer }));
    } else if (Array.isArray(d.cands)) {
      for (const c of d.cands.slice(0, 30)) queue(p, pc => pc.remoteDescription && pc.addIceCandidate(c));
    }
  }

  const pingT = setInterval(() => { for (const p of peers.values()) if (p.open) ping(p); }, PING_EVERY);
  const on = set => fn => { set.add(fn); return () => set.delete(fn); };

  return {
    connect: safe(pid => {
      pid = String(pid);
      if (dead || !RTC || pid === selfPid || peers.has(pid) || !(selfPid < pid)) return;   // the other side waits
      const p = { pid, init: true, tries: 0, rtt: null };
      peers.set(pid, p);
      attempt(p);
    }),
    handleSignal: safe(handleSignal),
    // still sends on a channel that went quiet (it may only have lost a pong), but returns false so MQTT carries a copy
    send: (pid, obj) => {
      const p = peers.get(String(pid));
      return !!p?.open && p.dc?.readyState === 'open' && p.dc.bufferedAmount < MAX_BUFFERED && raw(p, obj) && live(p);
    },
    isOpen: pid => live(peers.get(String(pid))),
    rtt: pid => { const p = peers.get(String(pid)); return live(p) && p.rtt != null ? Math.round(p.rtt) : null; },
    onMessage: on(fns.msg),
    onOpen: on(fns.open),
    onClose: on(fns.close),
    close: safe(pid => {
      if (pid == null) { dead = true; clearInterval(pingT); }
      for (const p of pid == null ? [...peers.values()] : [peers.get(String(pid))]) {
        if (!p) continue;
        clearTimeout(p.retryT);
        peers.delete(p.pid);
        teardown(p);
      }
    }),
  };
}
