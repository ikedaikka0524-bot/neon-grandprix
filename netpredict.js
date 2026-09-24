// Online: where a remote car is NOW. Its last state is dead-reckoned forward by the link latency plus the time since it
// arrived (constant speed + yaw rate = arc), and each new state's jump is folded into an offset that a critically
// damped spring pulls back to 0, so the car never teleports and never trails a smoothing lag. Pure math: node-tested
// by tools/check-netpredict.mjs.
export const MAX_AGE = 1.0, SNAP_DIST = 15, SNAP_ANGLE = Math.PI / 2, BLEND = 10, MAX_YAW = 3.5, DEFAULT_LAT = 150;

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// msg: {x, z, h, s, rt? /* sender race time */, lat? /* ms one way, from net.js */}; prev: the previous sample or null
export function netSample(msg, prev, now) {
  const h = +msg.h || 0, rt = Number.isFinite(msg.rt) ? msg.rt : null;
  // sender clock when available: relayed states arrive in bursts, receive-time deltas would inflate the yaw rate
  const dt = prev ? (rt != null && prev.rt != null ? rt - prev.rt : now - prev.t) : 0;
  const x = +msg.x || 0, z = +msg.z || 0, s = +msg.s || 0, dh = prev ? wrap(h - prev.h) : 0;
  // respawn / warp / wall bounce: a jump no driving can make (turn faster than MAX_YAW, move farther than its speed
  // allows) is not a turn to keep extrapolating
  const jump = () => Math.abs(dh) > MAX_YAW * dt + 0.05 || Math.hypot(x - prev.x, z - prev.z) > Math.max(Math.abs(s), Math.abs(prev.s)) * dt + 2;
  const w = !prev ? 0 : !(dt > 0.001 && dt < 1) ? prev.w : jump() ? 0 : clamp(dh / dt, -MAX_YAW, MAX_YAW);
  const lat = Number.isFinite(msg.lat) ? msg.lat : null;
  return { x, z, h, s, w, t: now, rt, lat, p: msg.p };
}

export const ageOf = (n, now) => clamp((n.lat ?? DEFAULT_LAT) / 1000 + now - n.t, 0, MAX_AGE);

// [x, z, h] after `age` s along the heading at constant speed and yaw rate (forward = (sin h, cos h))
export function predict(n, age) {
  const h1 = n.h + n.w * age;
  if (Math.abs(n.w) < 1e-4) return [n.x + Math.sin(n.h) * n.s * age, n.z + Math.cos(n.h) * n.s * age, h1];
  const r = n.s / n.w;
  return [n.x + r * (Math.cos(n.h) - Math.cos(h1)), n.z + r * (Math.sin(h1) - Math.sin(n.h)), h1];
}

export const newOffset = () => ({ x: 0, z: 0, h: 0, vx: 0, vz: 0, vh: 0 });
export const applyOffset = (p, o) => [p[0] + o.x, p[1] + o.z, p[2] + o.h];

// a new state moved the prediction: keep the rendered pose where it is (offset = shown − predicted) unless it is far off
export function retarget(o, shown, pose) {
  o.x = shown[0] - pose[0]; o.z = shown[1] - pose[1]; o.h = wrap(shown[2] - pose[2]);
  if (Math.hypot(o.x, o.z) > SNAP_DIST || Math.abs(o.h) > SNAP_ANGLE) Object.assign(o, newOffset());
}

// exact critically damped step toward 0 (x(t) = (x0 + (v0 + k x0) t) e^-kt)
export function decay(o, dt) {
  const e = Math.exp(-BLEND * dt);
  for (const [k, v] of [['x', 'vx'], ['z', 'vz'], ['h', 'vh']]) {
    const t = (o[v] + BLEND * o[k]) * dt;
    o[v] = (o[v] - BLEND * t) * e;
    o[k] = (o[k] + t) * e;
  }
}
