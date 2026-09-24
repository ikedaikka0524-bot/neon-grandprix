// node tools/check-netpredict.mjs — remote-car prediction math (netpredict.js): straight line, constant-radius turn,
// age clamp, snap, damping, and an end-to-end 200 km/h corner with 150 ms latency.
import assert from 'node:assert/strict';
import { netSample, ageOf, predict, newOffset, applyOffset, retarget, decay, MAX_AGE } from '../netpredict.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// straight line: 50 m/s for 0.2 s = 10 m along heading
{
  const n = netSample({ x: 1, z: 2, h: 0.3, s: 50, rt: 1 }, null, 10);
  assert.equal(n.w, 0);
  const [x, z, h] = predict(n, 0.2);
  near(x, 1 + Math.sin(0.3) * 10, 1e-9, 'straight x');
  near(z, 2 + Math.cos(0.3) * 10, 1e-9, 'straight z');
  near(h, 0.3, 1e-12, 'straight h');
}

// constant-radius turn: circle radius R around c, speed v; yaw rate recovered from two states, arc predicted exactly
const circle = (R, v, cx, cz, t) => {   // counter-clockwise seen from +y... any consistent param works: heading = tangent
  const w = v / R, a = w * t;
  // position P = C + R(-cos a, sin a) -> velocity = v(sin a, cos a) -> heading = a
  return { x: cx - R * Math.cos(a), z: cz + R * Math.sin(a), h: Math.atan2(Math.sin(a), Math.cos(a)), s: v, rt: t };
};
{
  const R = 40, v = 30;
  const a = netSample(circle(R, v, 5, -3, 1.0), null, 0);
  const b = netSample(circle(R, v, 5, -3, 1.05), a, 0.05);
  near(b.w, v / R, 1e-9, 'yaw rate');
  const [x, z, h] = predict(b, 0.3), t = circle(R, v, 5, -3, 1.35);
  near(x, t.x, 1e-6, 'arc x'); near(z, t.z, 1e-6, 'arc z'); near(h, t.h, 1e-9, 'arc h');
  near(Math.hypot(x - 5, z + 3), R, 1e-6, 'stays on circle');
}

// heading wrap across ±π gives a small yaw rate, not ~±125 rad/s; no sender clock -> receive-time delta
{
  const a = netSample({ h: 3.1, s: 20 }, null, 1);
  const b = netSample({ h: -3.1, s: 20 }, a, 1.1);
  near(b.w, (2 * Math.PI - 6.2) / 0.1, 1e-9, 'wrapped yaw');
}

// respawn (heading realigned in one frame) / warp (position jump): no yaw rate to extrapolate; a real spin keeps its rate
{
  const a = netSample({ x: 0, z: 0, h: 0, s: 0, rt: 1 }, null, 0);
  assert.equal(netSample({ x: 1, z: 0, h: Math.PI / 2, s: 0, rt: 1.05 }, a, 0.05).w, 0, 'respawn');
  assert.equal(netSample({ x: 0, z: 0, h: 1.2, s: 0, rt: 1.15 }, a, 0.15).w, 0, 'respawn over the thinned relay');
  assert.equal(netSample({ x: 40, z: 30, h: 0.1, s: 50, rt: 1.05 }, { ...a, s: 50 }, 0.05).w, 0, 'warp');
  near(netSample({ x: 0, z: 0, h: 3.4 * 0.05, s: 5, rt: 1.05 }, a, 0.05).w, 3.4, 1e-9, 'spin');
}

// latency / age: default 150 ms, clamp to [0, MAX_AGE] (a ~300 ms relay still rides out a ~700 ms broker stall)
{
  const n = netSample({ h: 0, s: 10 }, null, 5);
  near(ageOf(n, 5.05), 0.2, 1e-9, 'default lat');
  near(ageOf({ ...n, lat: 40 }, 5), 0.04, 1e-9, 'p2p lat');
  assert.equal(ageOf({ ...n, lat: 2000 }, 5), MAX_AGE, 'clamped by lat');
  assert.equal(ageOf(n, 60), MAX_AGE, 'clamped when states stop');
  assert.equal(ageOf({ ...n, lat: 0 }, 4), 0, 'never negative');
}

// snap: > 15 m or > 90° -> offset reset; smaller corrections keep the shown pose continuous
{
  const o = newOffset();
  retarget(o, [5, 0, 0], [0, 0, 0]);
  assert.deepEqual(applyOffset([0, 0, 0], o), [5, 0, 0]);
  retarget(o, [16, 0, 0], [0, 0, 0]);
  assert.deepEqual([o.x, o.z, o.h], [0, 0, 0], 'distance snap');
  retarget(o, [0, 0, 2], [0, 0, 0]);
  assert.deepEqual([o.x, o.z, o.h], [0, 0, 0], 'heading snap');
  retarget(o, [0, 0, 3.1], [0, 0, -3.1]);   // wrapped: 0.08 rad apart, not 6.2
  near(o.h, 6.2 - 2 * Math.PI, 1e-9, 'wrapped heading error');
}

// critically damped: no overshoot, ~gone in 0.6 s
{
  const o = newOffset();
  o.x = 5;
  let prev = 5;
  for (let i = 0; i < 36; i++) { decay(o, 1 / 60); assert.ok(o.x <= prev && o.x >= 0, 'monotonic'); prev = o.x; }
  assert.ok(o.x < 0.1, `decayed: ${o.x}`);
}

// end to end: 200 km/h through a 60 m radius corner, 20 Hz states arriving 150 ms late (lat known), 60 fps render.
// Shown car vs where the car really is now. (The old 150 ms interpolation buffer showed it ~0.3 s = 16 m behind.)
{
  const R = 60, v = 200 / 3.6;
  let n = null, worst = 0;
  const o = newOffset();
  const pending = [];
  for (let k = 0; k * 0.05 < 3; k++) pending.push({ ...circle(R, v, 0, 0, k * 0.05), lat: 150, at: k * 0.05 + 0.15 });
  for (let f = 0; f < 180; f++) {
    const now = f / 60;
    while (pending.length && pending[0].at <= now) {   // game.js 'state' handler, run when the message arrives
      const msg = pending.shift(), at = msg.at, next = netSample(msg, n, at);
      const shown = n ? applyOffset(predict(n, ageOf(n, at)), o) : [msg.x, msg.z, msg.h];
      retarget(o, shown, predict(next, ageOf(next, at)));
      n = next;
    }
    if (!n) continue;
    decay(o, 1 / 60);   // game.js netPredict
    const [x, z] = applyOffset(predict(n, ageOf(n, now)), o), t = circle(R, v, 0, 0, now);
    if (now > 1) worst = Math.max(worst, Math.hypot(x - t.x, z - t.z));
  }
  assert.ok(worst < 0.5, `end-to-end error ${worst.toFixed(3)} m`);
  console.log(`end-to-end worst error ${worst.toFixed(3)} m at 200 km/h, R=${R} m, 150 ms`);
}

console.log('netpredict OK');
