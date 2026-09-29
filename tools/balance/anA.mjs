// node anA.mjs out1.jsonl [out2.jsonl ...] — ability table: per group (car, track, nodes) mean own gain / victim loss per use
import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)));
// time at which trace (T, P) first reaches p (linear interpolation); P is monotonic enough
function tAt(T, P, p) {
  if (p <= P[0]) return T[0];
  let lo = 0, hi = P.length - 1;
  if (p >= P[hi]) return T[hi] + (p - P[hi]) / Math.max(1, (P[hi] - P[hi - 20]) / (T[hi] - T[hi - 20]));   // extrapolate at the end speed
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] < p) lo = m; else hi = m; }
  return T[lo] + (T[hi] - T[lo]) * (p - P[lo]) / (P[hi] - P[lo] || 1);
}
const G = new Map();
for (const { job, r } of rows) {
  if (!job.tag.startsWith('A|') || r?.err) { if (r?.err) console.error('err', job.tag, r.err); continue; }
  const g = job.tag.split('|').slice(1, 4).join('|'), k = job.tag.split('|')[4];
  if (!G.has(g)) G.set(g, { base: null, uses: [] });
  if (k === 'B') G.get(g).base = r; else G.get(g).uses.push({ k: +k, r, job });
}
export const table = [];
for (const [g, { base, uses }] of G) {
  if (!base) { console.error('no baseline', g); continue; }
  const per = uses.sort((a, b) => a.k - b.k).map(({ k, r, job }) => {
    const t = r.T[r.T.length - 1], po = r.PO[r.PO.length - 1], pv = r.PV?.[r.PV.length - 1];
    const own = tAt(base.T, base.PO, po) - t;
    const vic = pv != null ? t - tAt(base.T, base.PV, pv) : null;
    return { k, own, vic, fire: r.fire, act: r.act };
  });
  const m = a => a.reduce((s, v) => s + v, 0) / a.length;
  const own = m(per.map(p => p.own)), vic = per[0]?.vic != null ? m(per.map(p => p.vic)) : null;
  table.push({ g, own, vic, per });
}
if (process.argv[1].endsWith('anA.mjs')) {
  for (const t of table) console.log(t.g.padEnd(32), 'own', t.own.toFixed(2).padStart(6), 'vic', (t.vic ?? NaN).toFixed(2).padStart(6), '|', t.per.map(p => `${p.own.toFixed(1)}/${(p.vic ?? 0).toFixed(1)}${p.fire?.why === 'forced' ? '*' : ''}`).join(' '));
}
