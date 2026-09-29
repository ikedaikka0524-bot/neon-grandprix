// page-side helpers (evaluated once per page): window.Q
const G = await import('/game.js'), D = await import('/data.js'), AB = await import('/abilities.js');
const ALL = D.SKILL_TREE.flatMap(b => b.nodes.map(n => n.id));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const Q = window.Q = { G, D, AB, ALL, log: [], bad: [] };
Q.cpu = (carId, name) => ({ name, carId, control: 'cpu', pace: [1, 1], stats: D.computeStats(carId, ALL) });
Q.start = async (o) => {
  await G.startRace({ mode: 'solo', cpuLevel: 'oni', cpuCount: 0, quality: 'low', onFinish() {}, onQuit() {}, ...o });
  const ctx = window.__race;
  Q.ctx = ctx; Q.race = ctx.race;
  if (o.fast !== false) {   // headless stepping: no draw, and each frame's dt lengthened by X ms (60 fps + 33 ms = 0.05 s steps)
    ctx.renderer.render = () => {};
    const X = o.extra ?? 33;
    let l = ctx.last;
    Object.defineProperty(ctx, 'last', { get: () => l, set: v => { l = v - X; }, configurable: true });
  }
  Q.log = []; Q.bad = []; Q.stats = { fam: {}, wake: 0, famHits: 0, gripMin: 9, gripMax: 0, famWake: [], resets: {} };
  return ctx;
};
// p1 autopilot (game.js 'normal' driver) through the touch hook; Q.fire = true presses the ability once
Q.autopilot = (ctx = Q.ctx) => {
  const p1 = ctx.race.cars.find(c => c.control === 'p1');
  let stuck = 0;
  const t = ctx.touch || (ctx.touch = { hud() {}, hide() {}, buzz() {}, destroy() {} });
  t.read = (inp, state) => {
    const car = p1, tr = ctx.race.track, S = tr.samples, N = tr.N, W2 = tr.width / 2, spd = Math.max(0, car.speed), idx = car.trackIndex;
    if (car._.track) {   // in a pocket course: just go
      inp.throttle = 1; return false;
    }
    const ahead = S[(idx + Math.round(35 / tr.spacing)) % N].curv;
    const lane = clamp(-Math.sign(ahead) * Math.min(1, Math.abs(ahead) * 70) * (W2 - 3) * 0.6, -(W2 - 1.8), W2 - 1.8);
    const s = S[(idx + Math.round((7 + spd * 0.42) / tr.spacing)) % N];
    inp.steer = clamp(wrapA(Math.atan2(s.pos.x + s.right.x * lane - car.pos.x, s.pos.z + s.right.z * lane - car.pos.z) - car.heading) * 2.4, -1, 1);
    const lat = (car.mods.downforce ? 0.99 * 2.8 : car.stats.grip * car.mods.gripMul * tr.grip) * 36 * 1.3;
    let vA = Infinity;
    for (let k = 2; k < Math.round((25 + spd * 1.8) / tr.spacing); k += 3) {
      const vi = Math.sqrt(lat / (Math.abs(S[(idx + k) % N].curv) + 1e-4));
      vA = Math.min(vA, Math.sqrt(vi * vi + 36 * k * tr.spacing));
    }
    inp.throttle = spd < vA ? 1 : 0.2; inp.brake = spd > vA + 3 ? clamp((spd - vA) / 8, 0.2, 1) : 0;
    if ((Q.fire || Q.autoFire && car.ability.gauge >= 1) && state === 'running') { inp.ability = true; Q.fire = false; }
    stuck = state === 'running' && Math.abs(car.speed) < 2 ? stuck + 1 / 60 : 0;
    if (stuck > 2.5) { stuck = 0; return true; }
    return false;
  };
  return p1;
};
const fin = v => Number.isFinite(v);
// watcher: every animation frame, NaN checks + interaction stats
Q.watch = (ctx = Q.ctx) => {
  const race = ctx.race, st = Q.stats;
  let prev = new Map();
  const tick = () => {
    if (window.__race !== ctx) return;
    requestAnimationFrame(tick);
    for (const c of race.cars) {
      const a = c.ability, m = c.mods;
      for (const [k, v] of [['x', c.pos.x], ['z', c.pos.z], ['y', c.pos.y], ['vx', c.vel.x], ['vz', c.vel.z], ['speed', c.speed], ['heading', c.heading], ['progress', c.progress],
        ['speedMul', m.speedMul], ['accelMul', m.accelMul], ['gripMul', m.gripMul], ['gauge', a?.gauge], ['famK', a?.id === 'family' ? a.famK ?? 0 : 0]]) {
        if (!fin(v) && Q.bad.length < 30) Q.bad.push(`${c.carId} ${k}=${v} t=${race.time.toFixed(2)}`);
      }
      if (m.gripMul < st.gripMin) st.gripMin = m.gripMul;
      if (m.gripMul > st.gripMax) st.gripMax = m.gripMul;
      const was = prev.get(c) || {};
      if (a.active > 0 && !(was.active > 0)) Q.log.push(`${race.time.toFixed(1)} ${c.carId} fires ${a.id} (${c._.abilWhy || 'p1'})`);
      if (a.wake && !was.wake) { st.wake++; Q.log.push(`${race.time.toFixed(1)} ${c.carId} in wake of ${a.wake.carId} grip ${m.gripMul.toFixed(2)}`); }
      if (a.id === 'family' && a.active > 0 && a.wake) st.famWake.push([+race.time.toFixed(2), +(a.famK || 0).toFixed(2), +m.gripMul.toFixed(3)]);
      if (a.famAt !== was.famAt && a.famAt != null) { st.famHits++; Q.log.push(`${race.time.toFixed(1)} ${c.carId} blocked by family (inv=${m.invulnerable} planted=${a.id === 'downforce' && a.active > 0})`); }
      if ((c._.resets || 0) !== (was.resets || 0) && was.resets != null) { st.resets[c.carId] = (st.resets[c.carId] || 0) + 1; Q.log.push(`${race.time.toFixed(1)} ${c.carId} RESET`); }
      if (c.spin > 0 && !(was.spin > 0)) Q.log.push(`${race.time.toFixed(1)} ${c.carId} spins ${c.spin.toFixed(2)} inv=${m.invulnerable}`);
      prev.set(c, { active: a.active, wake: a.wake, famAt: a.famAt, resets: c._.resets || 0, spin: c.spin });
    }
  };
  requestAnimationFrame(tick);
};
Q.wait = (sec, ctx = Q.ctx) => new Promise(res => { const t0 = ctx.race.time; const iv = setInterval(() => { if (window.__race !== ctx || ctx.race.time - t0 >= sec) { clearInterval(iv); res(); } }, 100); });
Q.until = (fn, max = 60, ctx = Q.ctx) => new Promise(res => { const t0 = ctx.race.time; const iv = setInterval(() => { const r = window.__race === ctx && fn(); if (r || window.__race !== ctx || ctx.race.time - t0 >= max) { clearInterval(iv); res(r); } }, 50); });
Q.running = () => Q.until(() => Q.race.state === 'running', 30);
Q.byId = id => Q.race.cars.find(c => c.carId === id);
// put car at arc length s (m, of the track), lat m right, heading along, speed v
Q.place = (car, s, lat, v) => {
  const tr = Q.race.track, N = tr.N, i = ((Math.round(s / tr.spacing) % N) + N) % N, p = tr.samples[i];
  car.pos.set(p.pos.x + p.right.x * lat, p.pos.y, p.pos.z + p.right.z * lat);
  car.heading = Math.atan2(p.tan.x, p.tan.z); car.speed = v; car.trackIndex = i;
  car.vel.set(Math.sin(car.heading) * v, 0, Math.cos(car.heading) * v);
  car._.h = car.heading; car._.s = v;
};
Q.sOf = car => car.trackIndex * Q.race.track.spacing;
Q.fireNow = car => { car.ability.gauge = 1; return AB.tryActivate(Q.race, car); };
Q.stop = () => G.stopRace();
return 'ok';
