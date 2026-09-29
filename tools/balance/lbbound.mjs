// Generous best-lap bound (point mass on a racing line at the steering limit, no scrub, full brakes 34 m/s^2, always
// drifting when not planted: yaw x1.4) with one ability use per lap, every node. node lbbound.mjs [track ...]
// kinds: downforce (ur_graphite), family (ur_streak), tokyodive (ur_fortune; pocket run TAWAY s), none.
import { TRACKS } from 'file:///C:/Users/Ikeda/ngp-mobile/tracks.js';
import { minTimes } from 'file:///C:/Users/Ikeda/ngp-mobile/lb.js';
import { computeStats, SKILL_TREE } from 'file:///C:/Users/Ikeda/ngp-mobile/data.js';

const ALL = SKILL_TREE.flatMap(b => b.nodes.map(n => n.id));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const YAW = +(process.env.YAW || 1.4), BRAKE = 34, TAWAY = +(process.env.TAWAY || 4.4);

function poly(x0, x1, x2, x3, d0, d1, d2) {
  let t1 = (x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1;
  let t2 = (x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2;
  t1 *= d1; t2 *= d1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return t => x1 + t1 * t + c2 * t * t + c3 * t * t * t;
}
function curvePoint(P, t) {
  const l = P.length, p = l * t, i = Math.floor(p), w = p - i, q = k => P[((i + k) % l + l) % l];
  const [p0, p1, p2, p3] = [q(-1), q(0), q(1), q(2)];
  const d = (a, b) => Math.pow((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, 0.25);
  let d1 = d(p1, p2); if (d1 < 1e-4) d1 = 1;
  let d0 = d(p0, p1); if (d0 < 1e-4) d0 = d1;
  let d2 = d(p2, p3); if (d2 < 1e-4) d2 = d1;
  return [0, 1, 2].map(k => poly(p0[k], p1[k], p2[k], p3[k], d0, d1, d2)(w));
}
function course(def) {
  const P = def.points, D = 40000, pts = [], cum = [0], N = 1200;
  for (let i = 0; i <= D; i++) pts.push(curvePoint(P, (i % D) / D));
  for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = cum[D], out = [];
  for (let n = 0, j = 0; n < N; n++) {
    const s = n / N * L;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push(pts[j].map((v, k) => v + (pts[j + 1][k] - v) * f));
  }
  const sp = L / N, w = i => ((i % N) + N) % N;
  const S = out.map((p, i) => {
    const a = out[w(i - 1)], b = out[w(i + 1)], tx = b[0] - a[0], tz = b[2] - a[2], m = Math.hypot(tx, tz);
    return { x: p[0], z: p[2], tan: { x: tx / m, z: tz / m }, right: { x: -tz / m, z: tx / m }, curv: 0 };
  });
  for (let i = 0; i < N; i++) { const a = S[w(i - 3)].tan, b = S[w(i + 3)].tan; S[i].curv = wrapAngle(Math.atan2(b.x, b.z) - Math.atan2(a.x, a.z)) / (6 * sp); }
  const LIM = def.width / 2 - 1, off = new Float64Array(N);   // generous: car centre 1 m from the edge (the game's line: 2.2)
  const px = i => S[i].x + S[i].right.x * off[i], pz = i => S[i].z + S[i].right.z * off[i];
  const menger = (a, b, c, ob) => {
    const ax = px(a), az = pz(a), cx = px(c), cz = pz(c), bx = S[b].x + S[b].right.x * ob, bz = S[b].z + S[b].right.z * ob;
    const x1 = bx - ax, z1 = bz - az, x2 = cx - bx, z2 = cz - bz, x3 = cx - ax, z3 = cz - az;
    return 2 * (x1 * z2 - z1 * x2) / Math.sqrt((x1 * x1 + z1 * z1) * (x2 * x2 + z2 * z2) * (x3 * x3 + z3 * z3) + 1e-9);
  };
  for (const span of [40, 20, 10, 5]) {
    const K = Math.max(1, Math.round(span / sp));
    for (let it = 0; it < 80; it++) for (let i = 0; i < N; i++) {
      const p = w(i - K), n = w(i + K);
      const target = (menger(w(p - K), p, i, off[p]) + menger(i, n, w(n + K), off[n])) / 2;
      const k0 = menger(p, i, n, off[i]), slope = (menger(p, i, n, off[i] + 0.1) - k0) / 0.1;
      if (Math.abs(slope) > 1e-6) off[i] = Math.max(-LIM, Math.min(LIM, off[i] + (target - k0) / slope * 0.8));
    }
  }
  const head = new Float64Array(N), kap = new Float64Array(N), ds = new Float64Array(N);
  for (let i = 0; i < N; i++) { head[i] = Math.atan2(px(w(i + 1)) - px(w(i - 1)), pz(w(i + 1)) - pz(w(i - 1))); ds[i] = Math.hypot(px(w(i + 1)) - px(i), pz(w(i + 1)) - pz(i)); }
  for (let i = 0; i < N; i++) kap[i] = Math.abs(wrapAngle(head[w(i + 3)] - head[w(i - 3)]) / Math.max(1e-3, Math.hypot(px(w(i + 3)) - px(w(i - 3)), pz(w(i + 3)) - pz(w(i - 3))))) + 1e-5;
  return { N, L, sp, S, kap, ds, w, grip: def.grip || 1 };
}
// v with v·kap·(1 + v/(50 G)) = Y
const vCorner = (k, G, Y) => { const a = k / (50 * G); return (Math.sqrt(k * k + 4 * a * Y) - k) / (2 * a); };

// state(t) -> { top, acc, G, Y } (t: s since activation, or null = not active)
function lap(C, st, kind, x0) {
  const { N, kap, ds, w } = C, s0 = st.steer, top0 = st.top, acc0 = st.accel, grip0 = st.grip * C.grip, pw = st.abilityPower, dur = st.abilityDuration;
  const state = t => {
    const idle = { top: top0, acc: acc0, G: grip0, Y: s0 * YAW };
    if (t == null || t < 0) return idle;
    if (kind === 'downforce' && t < 7 * dur) return { top: top0 * (1 + 0.45 * pw + 0.2 * pw), acc: acc0 * (1 + pw + 0.6 * pw), G: 0.99, Y: s0 * (1 + pw) };   // slingshot always on
    if (kind === 'family') {
      if (t < 0.6) return idle;
      if (t < 7 * dur) return { top: top0 * (1 + 0.55 * pw), acc: acc0 * (1 + 2 * pw), G: grip0 * 2.8, Y: s0 * YAW };
      if (t < 7 * dur + 2) return { ...idle, top: top0 * 1.5, acc: acc0 * 1.5 };
    }
    if (kind === 'tokyodive' && t < 2 * dur) return { ...idle, top: top0 * 1.4, acc: acc0 * 1.4 };   // after the landing (t from landing)
    return idle;
  };
  // pass 1..3: which samples are reached while active -> braking envelope with those limits
  let tArr = null, best = null;
  for (let pass = 0; pass < 4; pass++) {
    const vmax = new Float64Array(N + 1);
    for (let k = 0; k <= N; k++) { const q = state(tArr ? tArr[k] : (kind === 'none' ? null : k >= x0 ? 0 : null)); vmax[k] = Math.min(vCorner(kap[w(k)], q.G, q.Y), 400); }
    const vb = new Float64Array(N + 2).fill(Infinity);
    for (let k = N; k >= 0; k--) vb[k] = Math.min(vmax[k], Math.sqrt(vb[k + 1] ** 2 + 2 * BRAKE * ds[w(k)]));
    // flying start: the speed a clean previous lap arrives with (idle top, capped by the envelope)
    let v = Math.min(top0, vb[0]), t = 0, act = null;
    const arr = new Float64Array(N + 1);
    let k = 0;
    while (k < N) {
      if (act == null && k >= x0 && kind !== 'none') act = t;
      if (kind === 'tokyodive' && act === t && k === x0) {   // away TAWAY s, lands J samples on, landSpeed-capped, then the boost
        const J = Math.round((top0 * 0.8 * 6 + pw * 0.8 * 302) / C.sp);
        if (k + J > N) return null;   // over the line: not this lap's
        t += TAWAY;
        for (let m = 0; m < J; m++) arr[k + m] = null;
        k += J;
        v = landSpeed(C, st, k, top0);
        act = t;   // boost timer from the landing
        continue;
      }
      arr[k] = act == null ? null : t - act;
      const q = state(act == null ? null : t - act);
      let rem = ds[w(k)];
      while (rem > 1e-9) {
        const step = Math.min(rem, 0.25), dt = step / Math.max(v, 1), qq = state(act == null ? null : t - act);
        if (v < qq.top) v = Math.min(qq.top, v + qq.acc * Math.max(0, 1 - (v / qq.top) ** 3) * dt);
        else v = Math.max(qq.top, v - (v - qq.top) * 1.3 * dt - 2 * dt);
        t += dt; rem -= step;
      }
      v = Math.min(v, vb[k + 1]);
      void q;
      k++;
    }
    arr[N] = act == null ? null : t - act;
    tArr = arr;
    best = t;
  }
  return best;
}
function landSpeed(C, st, i, v) {
  const lat = st.grip * C.grip * 36 * 1.3;
  for (let k = 0, d = 0; d < 150; k += 2, d = k * C.sp) v = Math.min(v, Math.sqrt(lat * (d < 15 ? 0.64 : 1) / (Math.abs(C.S[(i + k) % C.N].curv) + 1e-4) + 36 * d));
  return v;
}

const tracks = process.argv.slice(2).length ? process.argv.slice(2) : ['circuit', 'city', 'snow', 'canyon', 'coast'];
const CARS = { none: 'ur_graphite', downforce: 'ur_graphite', family: 'ur_streak', tokyodive: 'ur_fortune' };
for (const tid of tracks) {
  const def = TRACKS.find(t => t.id === tid), C = course(def), floor = minTimes(tid).lap;
  const row = [];
  for (const [kind, car] of Object.entries(CARS)) {
    const st = computeStats(car, ALL);
    let b = Infinity, bx = 0;
    for (let x = 0; x < C.N; x += 4) { const T = lap(C, st, kind, x); if (T != null && T < b) { b = T; bx = x; } if (kind === 'none') break; }
    row.push(`${kind} ${b.toFixed(2)}${kind !== 'none' ? '@' + Math.round(bx * C.sp) + 'm' : ''}${b < floor ? ' UNDER' : ''}`);
  }
  console.log(tid.padEnd(8), 'floor', floor, '|', row.join(' | '));
}
