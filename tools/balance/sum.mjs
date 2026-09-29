// node sum.mjs a.jsonl [b.jsonl ...] — mixed races: per UR wins / starts, win %, mean place, uses per race, wins per course;
// ladder jobs: median CPU race time per level. Clean laps (L|) if present: % off the fastest UR per course.
import { readFileSync } from 'node:fs';
const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))).filter(x => !x.r?.err);
const races = rows.filter(x => x.job.fn === 'runRace' && Array.isArray(x.r));
const med = x => { const v = x.slice().sort((p, q) => p - q), n = v.length; return n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2; };
if (races.length) {
  const W = {}, TR = ['circuit', 'suzuka', 'city'];
  for (const x of races) {
    const order = x.r.slice().sort((p, q) => (p.t ?? 1e9) - (q.t ?? 1e9));
    order.forEach((e, i) => {
      const w = (W[e.id] ??= { w: 0, n: 0, u: 0, pl: 0, gap: 0, tw: {}, tn: {} });
      w.n++; w.u += e.uses; w.pl += i + 1; w.gap += (e.t ?? order[3].t) / order[0].t - 1;
      w.tn[x.job.track] = (w.tn[x.job.track] || 0) + 1;
      if (i === 0) { w.w++; w.tw[x.job.track] = (w.tw[x.job.track] || 0) + 1; }
    });
  }
  console.log(`${races.length} races`);
  console.log('UR'.padEnd(12), 'wins/n'.padStart(7), '  win%', 'place', ' gap%', 'uses', '| ' + TR.map(t => t.padEnd(8)).join(''));
  for (const [id, w] of Object.entries(W).sort((p, q) => q[1].w / q[1].n - p[1].w / p[1].n || p[1].pl / p[1].n - q[1].pl / q[1].n))
    console.log(id.padEnd(12), `${w.w}/${w.n}`.padStart(7), (100 * w.w / w.n).toFixed(0).padStart(5) + '%', (w.pl / w.n).toFixed(2).padStart(5), (100 * w.gap / w.n).toFixed(1).padStart(5), (w.u / w.n).toFixed(1).padStart(4), '| ' + TR.map(t => `${w.tw[t] || 0}/${w.tn[t] || 0}`.padEnd(8)).join(''));
}
const lad = rows.filter(x => x.job.fn === 'runLadder');
if (lad.length) {
  const L = {};
  for (const x of lad) for (const e of x.r) if (e.t) (L[x.job.level] ??= []).push(e.t);
  let prev = null;
  for (const [lv, ts] of Object.entries(L)) { const m = med(ts); console.log('ladder', lv.padEnd(7), `median CPU race ${m.toFixed(2)} s (${ts.length} CPUs)`, prev ? `${((1 - m / prev) * 100).toFixed(1)}% faster than the level below` : ''); prev = m; }
}
const laps = rows.filter(x => x.job.fn === 'runLap');
if (laps.length) {
  const TR = [...new Set(laps.map(x => x.job.track))], C = [...new Set(laps.map(x => x.job.car))];
  const best = Object.fromEntries(TR.map(t => [t, Math.min(...laps.filter(x => x.job.track === t).map(x => x.r.best))]));
  const out = C.map(c => { const p = TR.map(t => (laps.find(x => x.job.car === c && x.job.track === t).r.best / best[t] - 1) * 100); return { c, p, m: p.reduce((a, b) => a + b) / p.length }; }).sort((a, b) => a.m - b.m);
  console.log('clean best lap % off the fastest UR:', TR.join(' / '));
  for (const { c, p, m } of out) console.log(c.padEnd(12), '+' + m.toFixed(1) + '%', '|', p.map(v => v.toFixed(1).padStart(5)).join(''));
}
