// node pool.mjs — each UR's wins / starts pooled over the runs at its final values (see the sets below)
import { readFileSync } from 'node:fs';
const F = { b0: ['b0_s1', 'b0_s2'], i1: ['i1_s1', 'i1_s2'], i2: ['i2_s1', 'i2_s2', 'i2_s3'], i3: ['i3_s1', 'i3_s2', 'i3_s3'], i4: ['i4_s1', 'i4_s2', 'i4_s3'], mf: ['mf_p5'], f: ['f_s11', 'f_s12', 'f_s13', 'f_s14'], g: ['g_s21', 'g_s22', 'g_s23', 'g_s24', 'g_s25', 'g_s26'] };
const SETS = { ur_graphite: [['g', 'i2'], ['i1', 'i2', 'i3', 'i4', 'f', 'g']], ur_fortune: [['f', 'g']], ur_phase: [['i3', 'i4', 'f', 'g']], ur_changer: [['i1', 'i2', 'i3', 'i4', 'f', 'g']],
  ur_warp: [['i3', 'i4', 'f', 'g']], ur_thunder: [['b0', 'i1', 'i2', 'i3', 'i4', 'f', 'g']], ur_streak: [['b0', 'i1', 'i2', 'i3', 'i4', 'f', 'g']], ur_time: [['i4', 'f', 'g']],
  ur_domain: [['i1', 'i2', 'i3', 'i4', 'f', 'g']], ur_inferno: [['i4', 'f', 'g']], ur_megaface: [['i4', 'mf', 'f', 'g']] };
const races = k => F[k].flatMap(f => readFileSync(f + '.jsonl', 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l))).filter(x => x.job.fn === 'runRace' && Array.isArray(x.r));
for (const [id, sets] of Object.entries(SETS)) console.log(id.padEnd(12), sets.map(S => {
  let w = 0, n = 0;
  for (const x of S.flatMap(races)) { const e = x.r.find(e => e.id === id); if (!e) continue; n++; if (x.r.slice().sort((p, q) => (p.t ?? 1e9) - (q.t ?? 1e9))[0].id === id) w++; }
  return `${S.join('+')}: ${w}/${n} = ${(100 * w / n).toFixed(0)}%`;
}).join(' | '));
