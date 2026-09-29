import { startRace, stopRace } from './game.js';
import { tryActivate } from './abilities.js';
import * as AB from './abilities.js';
import { computeStats, SKILL_TREE, DIFFICULTY_BY_ID, CAR_BY_ID, ABILITIES } from './data.js';

const ALL = SKILL_TREE.flatMap(b => b.nodes.map(n => n.id));
const nodesOf = n => (n === 'all' ? ALL : n || []);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// every car AI-driven (control 'cpu' from the start: CPU ability paths), level lv, lane wander off unless o.wander
async function boot(o, ents) {
  window.__seed(o.seed ?? 7);
  const lv = DIFFICULTY_BY_ID[o.level || 'oni'];
  lv.__w ??= lv.wander;
  lv.wander = o.wander ?? 0;
  const players = ents.map((e, i) => ({ name: 'C' + i, carId: e.carId, stats: computeStats(e.carId, nodesOf(e.nodes)), control: e.control || 'cpu' }));
  await startRace({ mode: 'solo', trackId: o.track, quality: 'low', cpuCount: o.cpuCount || 0, cpuLevel: o.level || 'oni', players, onFinish() {}, onQuit() {} });
  const ctx = window.__race, race = ctx.race;
  // o.patch.driftCharge = X: ur_fortune's extra fill while drifting, 1 + X instead of the game's 1 + DRIFT_CHARGE (1.2), via gaugeRate
  const dc = o.patch?.driftCharge;
  if (dc != null) for (const c of race.cars) if (c.carId === 'ur_fortune') { const r = c.stats.gaugeRate || 1; Object.defineProperty(c.stats, 'gaugeRate', { get: () => (c.stats.driftCharge && c.drifting ? r * (1 + dc) / 2.2 : r), configurable: true }); }
  ctx.renderer.render = () => {};
  for (const c of race.cars) ctx.viewByCar.delete(c);
  // visuals only: no camera / HUD / scenery animation / game particles (physics untouched)
  try { ctx.touch?.destroy(); } catch { }
  ctx.touch = null; ctx.views = []; ctx.worldFx = null; ctx.smoke.update = ctx.glow.update = () => {};
  // exact 1/64 s frames (2 physics substeps of exactly 1/128 s): with 1000/60 ms steps on a large rAF timestamp, dt
  // wobbles by ~1e-15 and ceil(dt / (1/120)) sometimes gave 3 substeps, so two "identical" runs drifted apart.
  // Reseeded at GO: whatever the async loading drew from Math.random, the race itself replays exactly
  ctx.last = 0;
  let vt = 0, seeded = false;
  const step = () => {
    if (!seeded && race.state === 'running') { seeded = true; window.__seed((o.seed ?? 7) + 1); }
    vt += o.frameMs || 15.625; const cb = window.__rafCb; window.__rafCb = null; if (cb) cb(vt);
  };
  return { ctx, race, cars: race.cars, step, done() { stopRace(); lv.wander = lv.__w; } };
}

// put F off m along the track from L (+ = ahead), same lateral offset / heading error / speed
function place(tr, F, L, off) {
  const N = tr.N, i = (((L.trackIndex + Math.round(off / tr.spacing)) % N) + N) % N, s = tr.samples[i], sL = tr.samples[L.trackIndex];
  const lat = clamp((L.pos.x - sL.pos.x) * sL.right.x + (L.pos.z - sL.pos.z) * sL.right.z, -(tr.width / 2 - 2), tr.width / 2 - 2);
  F.pos.copy(s.pos).addScaledVector(s.right, lat);
  F.heading = Math.atan2(s.tan.x, s.tan.z) + wrap(L.heading - Math.atan2(sL.tan.x, sL.tan.z));
  F.speed = Math.max(0, L.speed);
  F.vel.set(Math.sin(F.heading) * F.speed, 0, Math.cos(F.heading) * F.speed);
  F.trackIndex = i;
  F.spin = 0;
  F.progress = L.progress + off / tr.length;
  Object.assign(F._, { h: F.heading, s: F.speed, yaw: L._.yaw, drift: false, driftT: 0, steerS: L._.steerS, lane: L._.lane, laneTarget: L._.laneTarget, laneT: L._.laneT, passT: 0,
    t: s.t, prevT: s.t, slip: 0, stuck: 0, turbo: 0, jump: 0, crossings: Math.round(F.progress + 1 - s.t), halfway: s.t >= 0.5 });
}

// One UR (O) + optional victim V (same car, gauge held at 0) teleported voff m from O at every cue.
// useCue = k: O's gauge is filled at cues[k]; fire 'rule' = the CPU's own tactics decide (forced after o.force s),
// 'fixed' = at once. The run ends at cues[k] + W. useCue null: the baseline (no ability), to o.T.
window.runAbil = async o => {
  const unpatch = patch(o.patch);
  try { return await abil1(o); } finally { unpatch(); }
};
async function abil1(o) {
  const ents = [{ carId: o.car, nodes: o.nodes }];
  if (o.voff != null) ents.push({ carId: o.vcar || o.car, nodes: o.vnodes ?? o.nodes });
  const B = await boot(o, ents), { race, step } = B, [O, V] = B.cars, tr = race.track, Lm = tr.length;
  tr.laps = 99;
  if (V && o.vedge) { V.stats.top *= 1 + o.vedge; V.stats.accel *= 1 + o.vedge; }   // a faster chaser (defensive abilities)
  const cues = o.cues || [], T = [], PO = [], PV = [];
  const endT = o.useCue != null ? cues[o.useCue] + o.W : o.T;
  let k = 0, armedAt = null, fire = null, n = 0, jump = null, jpace = null;
  for (let guard = 0; guard < 60 * 400; guard++) {
    if (race.state === 'running' && race.time >= endT - 1e-9) break;
    const a = O.ability;
    if (V) V.ability.gauge = 0;
    let g0 = null;
    if (race.state === 'running') {
      while (k < cues.length && race.time >= cues[k]) {
        if (V) place(tr, V, O, o.voff);
        if (o.useCue === k) { armedAt = race.time; a.gauge = 1; }
        k++;
      }
      if (armedAt != null && !fire) {
        a.gauge = 1;
        if (o.fire === 'fixed' || race.time - armedAt >= (o.force ?? 8)) {
          const ok = tryActivate(race, O);
          fire = { t: +race.time.toFixed(3), delay: +(race.time - armedAt).toFixed(2), why: o.fire === 'fixed' ? 'fixed' : 'forced', ok };
        } else g0 = a.gauge;
      } else if (a.gauge > 0.5) a.gauge = 0.5;
    }
    const pg0 = O.progress;
    step();
    if (a.landed && jump == null) jump = +((O.progress - pg0) * Lm).toFixed(1);
    if (g0 != null && !fire && a.gauge < 0.99) fire = { t: +race.time.toFixed(3), delay: +(race.time - armedAt).toFixed(2), why: O._.abilWhy || 'ai', ok: true };
    if (race.state === 'running' && (n++ % 2) === 0) {
      T.push(+race.time.toFixed(4)); PO.push(+(O.progress * Lm).toFixed(2));
      if (V) PV.push(+(V.progress * Lm).toFixed(2));
    }
  }
  // final sample exactly at the end
  T.push(+race.time.toFixed(4)); PO.push(+(O.progress * Lm).toFixed(2)); if (V) PV.push(+(V.progress * Lm).toFixed(2));
  const out = { L: Lm, T, PO, PV, fire, top: O.stats.top, jump, jpace };
  B.done();
  return out;
}

// clean laps, no ability: best / mean lap of each car
window.runLap = async o => {
  const unpatch = patch(o.patch);
  try { return await lap1(o); } finally { unpatch(); }
};
async function lap1(o) {
  const B = await boot(o, [{ carId: o.car, nodes: o.nodes }]), { race, step } = B, [O] = B.cars;
  race.track.laps = o.laps;
  let vmax = 0, nst = 0;
  const w0 = performance.now();
  for (let guard = 0; guard < 60 * 600 && !O.finished; guard++) { O.ability.gauge = 0; step(); nst++; vmax = Math.max(vmax, O.speed); }
  const out = { best: O.bestLap, fin: O.finishTime, vmax, msPerStep: +((performance.now() - w0) / nst).toFixed(3) };
  B.done();
  return out;
}

// oni race: o.cars = [carId x n] (grid order = array order), every node; the game's own CPU tactics
// counterfactuals (harness only): o.patch = { base: { carId: {...} }, abil: { id: {...} } }, undone after the race
function patch(p) {
  const undo = [];
  for (const [id, v] of Object.entries(p?.base || {})) { const d = CAR_BY_ID[id], b = d.base; d.base = { ...b, ...v }; undo.push(() => { d.base = b; }); }
  for (const [id, v] of Object.entries(p?.passive || {})) { const d = CAR_BY_ID[id], old = d.passive; d.passive = v; undo.push(() => { d.passive = old; }); }
  for (const [id, v] of Object.entries(p?.lv || {})) { const d = DIFFICULTY_BY_ID[id], old = { ...d }; Object.assign(d, v); undo.push(() => { for (const k in v) d[k] = old[k]; }); }
  for (const [id, v] of Object.entries(p?.k || {})) { const o = AB['__' + id], old = { ...o }; Object.assign(o, v); undo.push(() => { for (const k in v) delete o[k]; Object.assign(o, old); }); }
  for (const [id, v] of Object.entries(p?.K || {})) { const o = globalThis.__K[id], old = { ...o }; Object.assign(o, v); undo.push(() => Object.assign(o, old)); }
  for (const [id, v] of Object.entries(p?.abil || {})) { const a = ABILITIES[id], old = { ...a }; Object.assign(a, v); undo.push(() => Object.assign(a, old)); }
  return () => undo.forEach(f => f());
}
window.runRace = async o => {
  const unpatch = patch(o.patch);
  try { return await race1(o); } finally { unpatch(); }
};
async function race1(o) {
  const B = await boot({ ...o, wander: o.wander ?? DIFFICULTY_BY_ID[o.level || 'oni'].wander }, o.cars.map(id => ({ carId: id, nodes: o.nodes === 'stock' ? [] : 'all' })));
  const { race, step, cars } = B, uses = cars.map(() => 0), g = cars.map(() => 0);
  for (let guard = 0; guard < 60 * 900 && !cars.every(c => c.finished); guard++) {
    step();
    cars.forEach((c, i) => { if (g[i] >= 0.99 && c.ability.gauge < 0.5) uses[i]++; g[i] = c.ability.gauge; });
  }
  const out = cars.map((c, i) => ({ id: c.carId, t: c.finishTime, best: c.bestLap, uses: uses[i], resets: c._.resets || 0 }));
  B.done();
  return out;
}

// leaderboard check: one car, every node, driven by o.level; gauge forced full at o.at m before (-) / after (+) the line
// every o.every laps (and only then). Returns every lap time.
window.runLB = async o => {
  const unpatch = patch(o.patch);
  try { return await lb1(o); } finally { unpatch(); }
};
async function lb1(o) {
  const B = await boot(o, [{ carId: o.car, nodes: 'all' }]), { race, step } = B, [O] = B.cars, tr = race.track, Lm = tr.length;
  tr.laps = o.laps;
  const laps = [], fires = [];
  let armedLap = -1, lastLap = 0;
  for (let guard = 0; guard < 60 * 900 && !O.finished; guard++) {
    const a = O.ability;
    if (race.state === 'running') {
      const pm = O.progress * Lm, lapNo = Math.floor(O.progress + 1e-9), into = pm - lapNo * Lm;   // m into the current lap
      // target: at o.at m relative to the line of lap L (L = 1, 1 + every, ...)
      const want = o.at >= 0 ? (lapNo >= 1 && (lapNo - 1) % o.every === 0 && into >= o.at && armedLap !== lapNo)
        : (lapNo >= 0 && (lapNo) % o.every === 0 && into >= Lm + o.at && armedLap !== lapNo + 1);
      if (want && !(a.active > 0)) { armedLap = o.at >= 0 ? lapNo : lapNo + 1; a.gauge = 1; const ok = tryActivate(race, O); fires.push({ t: +race.time.toFixed(2), ok, lap: armedLap }); }
      else if (!(a.active > 0)) a.gauge = Math.min(a.gauge, 0.5);
    }
    step();
    if (O.lap > lastLap) { laps.push(+(O._.lastLap ?? 0).toFixed(3)); lastLap = O.lap; }
  }
  const out = { laps, fires, fin: O.finishTime, best: O.bestLap };
  B.done();
  return out;
};
// dive probe: ur_fortune AI, fires at o.fires = [{ t } | { lap, at }] (lap 0-based, at m into it), records each jump
// o.control 'p1': a scripted human instead (throttle held, no steering: it drives the real pocket), o.patch as runRace
window.runDive = async o => {
  const unpatch = patch(o.patch);
  try { return await dive1(o); } finally { unpatch(); }
};
async function dive1(o) {
  const B = await boot(o, [{ carId: o.car || 'ur_fortune', nodes: o.nodes, control: o.control }]), { race, step } = B, [O] = B.cars, tr = race.track, Lm = tr.length, N = tr.N;
  tr.laps = 99;
  if (O.control === 'p1') B.ctx.keys.add('KeyW');
  const out = [], todo = [...o.fires];
  let cur = null, wasAway = false;
  for (let guard = 0; guard < 60 * 400 && (todo.length || cur); guard++) {
    const a = O.ability;
    if (race.state === 'running' && !cur && todo.length && !(a.active > 0)) {
      const f = todo[0], pm = O.progress * Lm;
      if (f.t != null ? race.time >= f.t : pm >= f.lap * Lm + f.at) {
        todo.shift(); a.gauge = 1;
        const i0 = O.trackIndex, V = a.lapV, zeros = V ? Array.from({ length: 600 }, (_, k) => V[(i0 + k) % N]).filter(v => !v).length : -1;
        const vs = V ? Array.from({ length: 600 }, (_, k) => V[(i0 + k) % N]) : [];
        const ok = tryActivate(race, O);
        cur = { f, ok, t: +race.time.toFixed(2), i0, prog0: +(O.progress * Lm).toFixed(1), zeros, vMin: vs.length ? Math.min(...vs.filter(v => v)) : null };
        if (!ok) { out.push(cur); cur = null; }
      } else a.gauge = Math.min(a.gauge, 0.5);
    } else if (!(a.active > 0)) a.gauge = Math.min(a.gauge, 0.5);
    const entry = a.dive?.entry?.i;
    step();
    if (cur && entry != null) cur.ie = entry;
    if (cur && a.away) wasAway = true;
    if (cur && wasAway && !a.away) {
      const i1 = O.trackIndex;
      cur.jumpM = +(((i1 - (cur.ie ?? cur.i0)) % N + N) % N * tr.spacing).toFixed(1);
      cur.jumpProg = +(O._.jump * Lm).toFixed(1);
      cur.nan = !Number.isFinite(O.pos.x) || !Number.isFinite(O.speed);
      cur.landV = +O.speed.toFixed(1);
      cur.t1 = +race.time.toFixed(4);
      cur.pos = [O.pos.x, O.pos.z, O.speed];
      out.push(cur); cur = null; wasAway = false;
    }
  }
  const r = { L: +Lm.toFixed(1), top: O.stats.top, dives: out };
  B.done();
  return r;
}
// review probe: oni race, every node, o.cars; per car: wall-contact entries inside event windows (warp landing, phase
// materialise, robot change-back, facewall owner dash) vs outside, and facewall knocks on victims
window.runProbe = async o => {
  const B = await boot({ ...o, wander: o.wander ?? DIFFICULTY_BY_ID[o.level || 'oni'].wander }, o.cars.map(id => ({ carId: id, nodes: o.nodes === 'stock' ? [] : 'all' })));
  const { race, step, cars } = B, tr = race.track;
  if (o.laps) tr.laps = o.laps;
  const st = cars.map(() => ({ wall: false, act: 0, ph: false, rob: false, faceAt: null, win: null, ev: [], wIn: 0, wOut: 0, tOut: 0, knocks: 0, prevProg: 0, lapJumps: 0 }));
  const isRob = c => c.ability.id === 'robotdash' && c.ability.active > 0 && c.ability.t < c.ability.robotDur + 0.35;
  const isPh = c => c.ability.id === 'phase' && c.ability.active > 0 && c.ability.t < c.ability.phaseDur;
  const curvAhead = (i, m) => { let k = 0; for (let j = 0; j * tr.spacing < m; j++) k = Math.max(k, Math.abs(tr.samples[(i + j) % tr.N].curv)); return k; };
  let dtAcc = 0;
  for (let guard = 0; guard < 60 * 900 && !cars.every(c => c.finished); guard++) {
    step();
    if (race.state !== 'running') continue;
    const now = race.time;
    cars.forEach((c, i) => {
      const s = st[i], a = c.ability;
      if (c.finished) return;
      const n = tr.nearest(c.pos, c.trackIndex), wall = Math.abs(n.lateral) >= tr.wall - 0.3;
      // window openers
      const lsp = (i, v) => { const S = tr.samples, N = S.length, lat = (c.stats?.grip || 0.85) * (tr.grip || 1) * 36 * 1.3; for (let k = 0, d = 0; d < 150; k += 2, d = k * tr.spacing) v = Math.min(v, Math.sqrt(lat * (d < 15 ? 0.64 : 1) / (Math.abs(S[(i + k) % N].curv || 0) + 1e-4) + 36 * d)); return v; };
      const open = (kind, len) => { s.win = { kind, ls: +lsp(c.trackIndex, c.speed).toFixed(1), t0: now, t1: now + len, v0: +c.speed.toFixed(1), k: +curvAhead(c.trackIndex, 150).toFixed(4), wall: 0, vmin: c.speed, off: 0, maxOff: 0, spin: 0, trace: [] }; s.ev.push(s.win); };
      if (a.id === 'warp' && (c.progress - s.prevProg) * tr.length > 30) { open('warp', 2.5); s.win.jump = +((c.progress - s.prevProg) * tr.length).toFixed(0); }
      if (a.id === 'phase' && a.active > 0 && !(s.act > 0)) open('ghost', a.phaseDur);
      if (a.id === 'robotdash' && a.active > 0 && !(s.act > 0)) open('robot', a.robotDur + 0.35);
      const ph = isPh(c), rob = isRob(c);
      if (s.ph && !ph && a.active > 0) open('materialise', a.active);
      if (a.id === 'phase' && a.phaseDur == null && !(a.active > 0) && s.act > 0) open('materialise', 2);
      if (s.rob && !rob && a.active > 0) open('robot-dash', a.active);
      if (a.id === 'facewall' && a.active > 0 && !(s.act > 0)) open('facewall', 3);
      if (a.faceAt != null && a.faceAt !== s.faceAt) { s.knocks++; s.faceAt = a.faceAt; }
      s.ph = ph; s.rob = rob; s.act = a.active;
      const w = s.win && now <= s.win.t1 ? s.win : null;
      if (wall && !s.wall) { if (w) { w.wall++; s.wIn++; (w.hitV ||= []).push(+c.speed.toFixed(0)); } else s.wOut++; }
      if (w) { w.vmin = Math.min(w.vmin, c.speed); w.spin = Math.max(w.spin, +(c.spin || 0).toFixed(2)); if (o.trace && (Math.round(now * 64) % 8) === 0) w.trace.push([+now.toFixed(2), +c.speed.toFixed(1), +n.lateral.toFixed(1), c.trackIndex]); if (Math.abs(n.lateral) > tr.width / 2) w.off++; w.maxOff = Math.max(w.maxOff, +(Math.abs(n.lateral) - tr.width / 2).toFixed(1)); }
      else s.tOut += 1 / 64;
      s.wall = wall;
      if (c.progress - s.prevProg > 0.3) s.lapJumps++;
      s.prevProg = c.progress;
    });
  }
  const out = cars.map((c, i) => ({ id: c.carId, fin: c.finishTime, lap: c.lap, resets: c._.resets || 0, knocks: st[i].knocks, wOut: st[i].wOut, tOut: +st[i].tOut.toFixed(1), wIn: st[i].wIn,
    ev: st[i].ev.map(e => ({ ...e, vmin: +e.vmin.toFixed(1), t0: +e.t0.toFixed(2), t1: undefined })), lapJumps: st[i].lapJumps }));
  B.done();
  return out;
};
// per-frame trace of car 0 between o.t0 and o.t1 (debug)
window.runTrace = async o => {
  const B = await boot({ ...o, wander: o.wander ?? DIFFICULTY_BY_ID[o.level || 'oni'].wander }, o.cars.map(id => ({ carId: id, nodes: o.nodes === 'stock' ? [] : 'all' })));
  const { race, step, cars } = B, tr = race.track, C = cars[0], out = [];
  if (o.laps) tr.laps = o.laps;
  for (let guard = 0; guard < 60 * 900 && !C.finished && race.time < o.t1; guard++) {
    step();
    if (race.state !== 'running' || race.time < o.t0) continue;
    const n = tr.nearest(C.pos, C.trackIndex), i = C.trackIndex, a = C.ability, m = C.mods;
    out.push([+race.time.toFixed(3), +C.speed.toFixed(1), +n.lateral.toFixed(2), i, +(tr.line?.off[i] ?? 0).toFixed(2), +(tr.samples[i].curv).toFixed(4), +(tr.line?.curv[i] ?? 0).toFixed(4),
      +C.input.throttle.toFixed(2), +C.input.brake.toFixed(2), +C.input.steer.toFixed(2), +m.speedMul.toFixed(2), +m.accelMul.toFixed(2), +m.gripMul.toFixed(2), +(C._.yaw || 0).toFixed(3), C._.drift ? 1 : 0, +(a.t || 0).toFixed(2)]);
  }
  B.done();
  return { W2: tr.width / 2, wall: tr.wall, sp: tr.spacing, out };
};
{ const rp = window.runProbe; window.runProbe = async o => { const u = patch(o.patch); try { return await rp(o); } finally { u(); } }; }
window.dbgK = async o => { const u = patch(o.patch); const v = JSON.stringify(globalThis.__K?.ROBOT) + ' ' + (window.runProbe.toString().slice(0, 60)); u(); return v; };
// fix checks. o.kind: 'face' | 'fam' (cars [owner, ur_time]: the timeslow owner o.off m from the owner, both fire, T timeslows
// o.tsAt s after the owner) → did the wall / rear ally hold or knock ur_time while its timeslow ran; 'pace' (cars [ur_domain,
// victim]: victim o.off m from it, dome fired) → victim's ability.pace before and after o.T s in the dome
window.runFix = async o => {
  const B = await boot(o, o.cars.map(id => ({ carId: id, nodes: 'all' }))), { race, step } = B, [O, T] = B.cars, tr = race.track;
  tr.laps = 99;
  while (!(race.state === 'running' && race.time >= 6)) { O.ability.gauge = T.ability.gauge = 0; step(); }
  place(tr, T, O, o.off);
  O.ability.gauge = 1; const okO = tryActivate(race, O);
  const out = { okO, ts: null, faceAt: [], famAt: [], minGap: 1e9, maxGap: -1e9, pace0: +T.ability.pace?.toFixed(2), sealed: 0 };
  const t0 = race.time;
  while (race.time < t0 + o.T) {
    if (o.kind !== 'pace' && out.ts == null && race.time >= t0 + o.tsAt) { T.ability.gauge = 1; out.ts = tryActivate(race, T); out.tsT = +race.time.toFixed(2); }
    else if (!(T.ability.active > 0)) T.ability.gauge = 0;
    if (!(O.ability.active > 0)) O.ability.gauge = 0;
    const fa = T.ability.faceAt, fm = T.ability.famAt;
    step();
    const tsOn = T.ability.id === 'timeslow' && T.ability.active > 0;
    if (T.ability.faceAt !== fa && T.ability.faceAt != null) out.faceAt.push([+race.time.toFixed(2), tsOn]);
    if (T.ability.famAt !== fm && T.ability.famAt != null) out.famAt.push([+race.time.toFixed(2), tsOn]);
    if (T.ability.sealed) out.sealed++;
    if (tsOn) { const g = (O.progress - T.progress) * tr.length; out.minGap = Math.min(out.minGap, +g.toFixed(1)); out.maxGap = Math.max(out.maxGap, +g.toFixed(1)); }
  }
  out.pace1 = +T.ability.pace?.toFixed(2); out.speed1 = +T.speed.toFixed(1); out.top = T.stats.top;
  B.done();
  return out;
};
// per-frame trace of car o.ci (default 0) between o.t0 and o.t1, with the AI's pass state and the nearest car ahead
window.runTrace2 = async o => {
  const u = patch(o.patch);
  const B = await boot({ ...o, wander: o.wander ?? DIFFICULTY_BY_ID[o.level || 'oni'].wander }, o.cars.map(id => ({ carId: id, nodes: o.nodes === 'stock' ? [] : 'all' })));
  const { race, step, cars } = B, tr = race.track, C = cars[o.ci || 0], out = [];
  if (o.laps) tr.laps = o.laps;
  try {
  for (let guard = 0; guard < 60 * 900 && !C.finished && race.time < o.t1; guard++) {
    step();
    if (race.state !== 'running' || race.time < o.t0) continue;
    const n = tr.nearest(C.pos, C.trackIndex), i = C.trackIndex, a = C.ability, m = C.mods, c = C._;
    const fx = Math.sin(C.heading), fz = Math.cos(C.heading);
    let near = null;
    for (const q of cars) { if (q === C) continue; const dx = q.pos.x - C.pos.x, dz = q.pos.z - C.pos.z, al = dx * fx + dz * fz, la = -dx * fz + dz * fx; if (al > -5 && al < 80 && (!near || al < near[0])) near = [+al.toFixed(1), +la.toFixed(1), +q.speed.toFixed(1)]; }
    out.push([+race.time.toFixed(3), +C.speed.toFixed(1), +n.lateral.toFixed(2), i, +(tr.line?.off[i] ?? 0).toFixed(2), +(tr.samples[i].curv).toFixed(4),
      +C.input.throttle.toFixed(2), +C.input.brake.toFixed(2), +C.input.steer.toFixed(2), +m.speedMul.toFixed(2), +m.accelMul.toFixed(2), +m.gripMul.toFixed(2), +(a.t || 0).toFixed(2),
      +(c.passT || 0).toFixed(2), +(c.laneTarget || 0).toFixed(1), +(c.lane || 0).toFixed(1), near, +(C.spin || 0).toFixed(2), +(c.straight ?? 0).toFixed(0), +(c.room ?? 0).toFixed(0)]);
  }
  } finally { B.done(); u(); }
  return { W2: tr.width / 2, wall: tr.wall, sp: tr.spacing, out };
};
// review-fix checks 2. 'fam': [ur_streak, ur_time]: once the rear ally is solid, ur_time (timeslow on if o.ts) is put 5 m
// behind it on its line, closing 10 m/s faster, every frame for 1.5 s: blocks counted (famAt changes).
// 'pace': [ur_domain, victim]: victim o.off m from the owner, dome up: frames the victim's pace moved while it was sealed /
// chained / bounce-slowed at the start of the frame
window.runFix2 = async o => {
  const B = await boot(o, o.cars.map(id => ({ carId: id, nodes: 'all' }))), { race, step } = B, [O, T] = B.cars, tr = race.track;
  tr.laps = 99;
  const out = {};
  try {
    while (!(race.state === 'running' && race.time >= 6)) { O.ability.gauge = T.ability.gauge = 0; step(); }
    place(tr, T, O, o.off ?? -40);
    O.ability.gauge = 1; out.okO = tryActivate(race, O);
    if (o.kind === 'fam') {
      const t0 = race.time; let n = 0, blocks = 0, tsFrames = 0;
      while (race.time < t0 + 8 && !(O.ability.fam?.allies?.[1]?.solid)) { T.ability.gauge = 0; step(); }
      out.solidAt = +(race.time - t0).toFixed(2);
      if (o.ts) { T.ability.gauge = 1; out.ts = tryActivate(race, T); }
      const t1 = race.time;
      while (race.time < t1 + 1.5) {
        const al = O.ability.fam.allies[1];
        if (!(T.ability.active > 0)) T.ability.gauge = 0;
        const fx = Math.sin(al.h), fz = Math.cos(al.h), v = Math.max(0, O.speed) + 10;
        T.pos.set(al.x - fx * (o.back || 3.4), T.pos.y, al.z - fz * (o.back || 3.4)); T.heading = al.h; T.speed = v; T.vel.set(fx * v, 0, fz * v); T.spin = 0;
        T.trackIndex = tr.nearest(T.pos, O.trackIndex).index;
        const fa = T.ability.famAt;
        step(); n++;
        if (T.ability.id === 'timeslow' && T.ability.active > 0) tsFrames++;
        if (T.ability.famAt !== fa && T.ability.famAt != null) blocks++;
      }
      Object.assign(out, { frames: n, tsFrames, blocks });
    } else {
      let moved = 0, heldFrames = 0, freeMoved = 0, free = 0;
      const t0 = race.time;
      while (race.time < t0 + (o.T || 5)) {
        if (!(O.ability.active > 0)) O.ability.gauge = 0; T.ability.gauge = 0;
        const a = T.ability, was = a.sealed || a.bounceT > 0 || T.spin > 0, p0 = a.pace;
        step();
        if (was) { heldFrames++; if (a.pace !== p0) moved++; } else { free++; if (a.pace !== p0) freeMoved++; }
      }
      Object.assign(out, { heldFrames, movedWhileHeld: moved, free, freeMoved, pace: +T.ability.pace.toFixed(2), speed: +T.speed.toFixed(1), top: T.stats.top });
    }
  } finally { B.done(); }
  return out;
};
// CPU ladder: 1 AI 'player' (n_hatch, stock) + 3 CPUs the level picks itself (cars, nodes, edge, pace); CPU race times
window.runLadder = async o => {
  const unpatch = patch(o.patch);
  try {
    const B = await boot({ ...o, cpuCount: 3, wander: DIFFICULTY_BY_ID[o.level].wander ?? 1 }, [{ carId: 'n_hatch', nodes: [] }]), { race, step, cars } = B;
    for (let guard = 0; guard < 60 * 900 && !cars.filter(c => c.name.startsWith('CPU')).every(c => c.finished); guard++) step();
    const out = cars.filter(c => c.name.startsWith('CPU')).map(c => ({ id: c.carId, t: c.finishTime, best: c.bestLap }));
    B.done();
    return out;
  } finally { unpatch(); }
};
window.ready = true;
