// node mkuse3.mjs out.json car:voff,... seed shift — per-use jobs like mkuse2 but the 6 cues shifted by `shift` s (a
// different set of places on the lap: the same seed with the same cues replays bit for bit)
import { writeFileSync } from 'node:fs';
const V = Object.fromEntries(process.argv[3].split(',').map(s => s.split(':')).map(([c, v]) => [c, +v])), seed = +process.argv[4], sh = +process.argv[5];
const CUES = [10, 32, 54, 76, 98, 120].map(c => c + sh), J = [];
for (const [car, voff] of Object.entries(V)) for (const track of ['circuit', 'suzuka', 'monza', 'city']) for (const nodes of ['stock', 'all']) {
  const g = `A|${car}~s${seed}|${track}|${nodes}`, o = { fn: 'runAbil', car, track, nodes: nodes === 'all' ? 'all' : [], voff, cues: CUES, level: 'oni', seed };
  J.push({ ...o, tag: `${g}|B`, useCue: null, T: 150 + sh });
  CUES.forEach((_, k) => J.push({ ...o, tag: `${g}|${k}`, useCue: k, W: 20, fire: 'rule', force: 8 }));
}
writeFileSync(process.argv[2], JSON.stringify(J));
console.log(J.length, 'jobs');
