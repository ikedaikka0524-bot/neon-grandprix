// node lbsum.mjs out.jsonl — best flying lap per car / course (over the `at` variants) vs lb.js minTimes lap floor
// (race floor = lap floor x laps, so a best lap above the lap floor keeps every race above the race floor too)
import { readFileSync } from 'node:fs';
const { minTimes } = await import('./app/lb.js');
const rows = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
const B = {};
for (const x of rows) {
  if (x.r?.err) { console.log('ERR', x.job.tag, x.r.err.slice(0, 120)); continue; }
  const k = `${x.job.car}|${x.job.track}`;
  B[k] = Math.min(B[k] ?? Infinity, ...x.r.laps.slice(1).filter(v => v > 0));   // lap 1 = standing start
}
let worst = Infinity;
for (const [k, b] of Object.entries(B)) {
  const f = minTimes(k.split('|')[1]).lap, m = b / f - 1;
  worst = Math.min(worst, m);
  console.log(k.padEnd(22), 'best lap', b.toFixed(2), 'floor', f, `(+${(m * 100).toFixed(0)}%)`);
}
console.log('closest best lap to its floor: +' + (worst * 100).toFixed(0) + '%');
