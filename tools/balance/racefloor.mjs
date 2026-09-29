// race floors: best sum of <laps> consecutive flying laps (a lower bound on a real race, which starts from rest with an
// empty gauge) per car / course from the D sweeps, vs lb.js minTimes race
import { readFileSync } from 'node:fs';
import { minTimes } from 'file:///C:/Users/Ikeda/ngp-mobile/lb.js';
import { TRACK_BY_ID } from 'file:///C:/Users/Ikeda/ngp-mobile/tracks.js';
const rows = process.argv.slice(2).flatMap(f => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))).filter(x => x.job.fn === 'runLB' && !x.r?.err);
const best = {};
for (const x of rows) {
  const k = x.job.car + '|' + x.job.track, n = TRACK_BY_ID[x.job.track].laps, L = x.r.laps.slice(1);
  for (let i = 0; i + n <= L.length; i++) { const s = L.slice(i, i + n).reduce((a, b) => a + b, 0); if (!(best[k] <= s)) best[k] = s; }
}
for (const [k, s] of Object.entries(best)) { const t = k.split('|')[1], m = minTimes(t); console.log(k.padEnd(22), 'best', TRACK_BY_ID[t].laps, 'flying laps', s.toFixed(2), 'race floor', m.race, `(+${((s / m.race - 1) * 100).toFixed(0)}%)`); }
