// node tools/check-tracks.mjs  — sanity-checks every course in tracks.js (same curve math as THREE.CatmullRomCurve3 'centripetal').
import { TRACKS } from '../tracks.js';

const wallPad = tr => (tr.wallGap ?? 9.4) + 1.1;   // barriers sit at width/2 + wallGap (street circuits set it tight)
const MIN_RADIUS = 12, MAX_GRADE = 0.13, MIN_LEN = 900, MAX_LEN = 7500;   // real circuits: hairpins ~12-14 m, Spa ~7 km

function poly(x0, x1, x2, x3, d0, d1, d2) {
  let t1 = (x1 - x0) / d0 - (x2 - x0) / (d0 + d1) + (x2 - x1) / d1;
  let t2 = (x2 - x1) / d1 - (x3 - x1) / (d1 + d2) + (x3 - x2) / d2;
  t1 *= d1; t2 *= d1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return t => x1 + t1 * t + c2 * t * t + c3 * t * t * t;
}
function curvePoint(P, t) {
  const l = P.length, p = l * t, i = Math.floor(p), w = p - i;
  const q = k => P[((i + k) % l + l) % l];
  const [p0, p1, p2, p3] = [q(-1), q(0), q(1), q(2)];
  const d = (a, b) => Math.pow((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2, 0.25);
  let d1 = d(p1, p2); if (d1 < 1e-4) d1 = 1;
  let d0 = d(p0, p1); if (d0 < 1e-4) d0 = d1;
  let d2 = d(p2, p3); if (d2 < 1e-4) d2 = d1;
  return [0, 1, 2].map(k => poly(p0[k], p1[k], p2[k], p3[k], d0, d1, d2)(w));
}
function sample(P, N) {
  const D = 8000, pts = [], cum = [0];
  for (let i = 0; i <= D; i++) pts.push(curvePoint(P, (i % D) / D));
  for (let i = 1; i <= D; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const len = cum[D], out = [];
  for (let n = 0, j = 0; n < N; n++) {
    const s = n / N * len;
    while (cum[j + 1] < s) j++;
    const f = (s - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push(pts[j].map((v, k) => v + (pts[j + 1][k] - v) * f));
  }
  return { len, out };
}

let bad = 0;
for (const tr of TRACKS) {
  const N = 1200, { len, out } = sample(tr.points, N), sp = len / N;
  const head = i => { const a = out[(i + N) % N], b = out[(i + 1 + N) % N]; return Math.atan2(b[0] - a[0], b[2] - a[2]); };
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  let minR = Infinity, minRAt = 0, maxG = 0, maxGAt = 0;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(wrap(head(i + 3) - head(i - 3))) / (6 * sp);
    if (1 / k < minR) { minR = 1 / k; minRAt = i; }
    const a = out[i], b = out[(i + 1) % N], g = Math.abs(b[1] - a[1]) / Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (g > maxG) { maxG = g; maxGAt = i; }
  }
  const need = tr.width + 2 * wallPad(tr), gap = Math.ceil(1.7 * need / sp);
  let minSep = Infinity, sepAt = null;
  for (let i = 0; i < N; i += 2) for (let j = i + gap; j < N; j += 2) {
    if (N - (j - i) < gap) continue;
    if (Math.abs(out[i][1] - out[j][1]) > 5) continue;   // bridge / crossover (e.g. Suzuka)
    const d = Math.hypot(out[i][0] - out[j][0], out[i][2] - out[j][2]);
    if (d < minSep) { minSep = d; sepAt = [i, j]; }
  }
  const at = i => `(${out[i][0].toFixed(0)},${out[i][2].toFixed(0)})`;
  const errs = [];
  if (len < MIN_LEN || len > MAX_LEN) errs.push(`length ${len.toFixed(0)} m`);
  if (minR < MIN_RADIUS) errs.push(`corner radius ${minR.toFixed(1)} m at ${at(minRAt)}`);
  if (maxG > MAX_GRADE) errs.push(`grade ${(maxG * 100).toFixed(1)}% at ${at(maxGAt)}`);
  if (minSep < need) errs.push(`sections ${minSep.toFixed(1)} m apart (< ${need}) at ${at(sepAt[0])} / ${at(sepAt[1])}`);
  bad += errs.length;
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${tr.id.padEnd(8)} len ${len.toFixed(0)} m  minR ${minR.toFixed(1)} m  grade ${(maxG * 100).toFixed(1)}%  minSep ${minSep.toFixed(1)} m${errs.length ? '\n     ' + errs.join('\n     ') : ''}`);
}
process.exit(bad ? 1 : 0);
