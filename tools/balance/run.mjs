// node run.mjs [--patch JSON] [--races 48] [--seed 1] [--workers 6] [--nodes all|stock] [--out f.jsonl] [--laps] [--ladder N]
// Mixed oni races: 4 distinct URs each (all 11 rotated, least-started first), circuit / suzuka / city round robin, the
// game's own CPU tactics. --patch = page-side counterfactual ({ base: { carId: {...} }, abil: { id: {...} } }), data.js
// untouched. --laps: + clean laps of every UR. --ladder N: instead N solo races per difficulty on circuit (1 AI 'player'
// n_hatch + 3 CPUs the level picks), CPU race times.
// Serves ./app (a snapshot of the repo) + /__bal.* on 127.0.0.1:8310; headless Chromes CDP 9761.., profiles %TEMP%\fy<i>;
// ngp.lb.emu = 1 before load. Server, Chromes and profiles are always torn down.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { rmSync, mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = fileURLToPath(new URL('.', import.meta.url)), ROOT = join(HERE, process.env.APP || 'app'), WEB = 8310;
const { CARS, DIFFICULTY } = await import('file:///' + join(ROOT, 'data.js').replaceAll('\\', '/'));
const { values: a } = parseArgs({ options: { patch: { type: 'string' }, races: { type: 'string', default: '48' }, workers: { type: 'string', default: '6' }, seed: { type: 'string', default: '1' }, nodes: { type: 'string', default: 'all' }, out: { type: 'string' }, laps: { type: 'boolean' }, ladder: { type: 'string' }, jobs: { type: 'string' }, always: { type: 'string' } } });
const patch = a.patch ? JSON.parse(a.patch) : undefined;
const NR = +a.races, NW = Math.max(1, +a.workers), SEED = +a.seed || 1;
const TRACKS = ['circuit', 'suzuka', 'city'], URS = CARS.filter(c => c.rarity === 'UR').map(c => c.id);

let s = SEED;
const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const shuffle = x => { for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };
const jobs = [];
if (a.jobs) jobs.push(...JSON.parse(readFileSync(a.jobs, 'utf8')));
else if (a.ladder) {
  for (const d of DIFFICULTY) for (let i = 0; i < +a.ladder; i++) jobs.push({ fn: 'runLadder', tag: `D|${d.id}|${i}`, track: 'circuit', level: d.id, seed: 500 + i + 1000 * SEED, patch });
} else {
  const starts = Object.fromEntries(URS.map(id => [id, 0]));
  for (let i = 0; i < NR; i++) {
    const fixed = a.always ? a.always.split(',') : [];   // --always ids: in every race, the rest least-started first
    const cars = shuffle([...fixed, ...shuffle(URS.filter(id => !fixed.includes(id))).sort((p, q) => starts[p] - starts[q]).slice(0, 4 - fixed.length)]);
    cars.forEach(id => starts[id]++);
    jobs.push({ fn: 'runRace', tag: `R${i}`, track: TRACKS[i % 3], cars, level: 'oni', nodes: a.nodes, seed: 100 + i + 1000 * SEED, patch });
  }
  if (a.laps) for (const car of URS) for (const track of TRACKS) jobs.push({ fn: 'runLap', tag: `L|${car}|${track}`, car, track, nodes: a.nodes === 'stock' ? [] : 'all', laps: 3, level: 'oni', seed: 7, patch });
  jobs.sort((p, q) => (q.fn === 'runRace') - (p.fn === 'runRace') || (q.track === 'suzuka') - (p.track === 'suzuka'));
}
const same = (j, x) => JSON.stringify(j) === JSON.stringify(x);
const done = a.out && existsSync(a.out) ? readFileSync(a.out, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).filter(x => !x.r?.err) : [];
const reused = done.filter(x => jobs.some(j => same(j, x.job)));
for (const x of reused) jobs.splice(jobs.findIndex(j => same(j, x.job)), 1);
if (reused.length) console.error(`reusing ${reused.length} results from ${a.out}`);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const mine = p.startsWith('/__bal'), file = mine ? join(HERE, p.slice(1)) : join(ROOT, normalize(p));
  if (!mine && !file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try { const buf = await readFile(file); res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(buf); }
  catch { res.writeHead(404); res.end('404'); }
});
await new Promise((ok, bad) => server.once('error', bad).listen(WEB, '127.0.0.1', ok));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const chromes = [], profs = [];
// no taskkill (process listing hangs on this box): Browser.close over CDP, then TerminateProcess on the launcher pid
const { cdpClose } = await import('./cdpclose.mjs');
const ports = [];
const cleanup = async () => {
  for (const p of ports) await cdpClose(p);
  await sleep(800);
  for (const c of chromes) try { c.kill(); } catch { }
  try { server.close(); server.closeAllConnections(); } catch { }
};
const rmProfs = async () => {
  for (let i = 0; i < 15 && profs.some(p => existsSync(p)); i++) { await sleep(1000); for (const p of profs) try { rmSync(p, { recursive: true, force: true }); } catch { } }
  for (const p of profs) if (existsSync(p)) console.error('profile cleanup failed', p);
};
process.on('SIGINT', async () => { await cleanup(); await rmProfs(); process.exit(130); });

async function worker(slot) {
  const PORT = 9910 + slot, PROF = process.env.TEMP + '\\fy' + slot;
  profs.push(PROF); ports.push(PORT); mkdirSync(PROF, { recursive: true });
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROF}`,
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--window-size=640,360', 'about:blank'], { stdio: 'ignore' });
  chromes.push(chrome);
  let list = null;
  for (let i = 0; i < 100 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') console.error(`[w${slot} exc]`, JSON.stringify(m.params.exceptionDetails).slice(0, 300));
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600)); return r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('ngp.lb.emu','1')}catch(e){}" });
  await send('Page.navigate', { url: `http://127.0.0.1:${WEB}/__bal.html?${Date.now()}` });
  for (let i = 0; i < 150; i++) { await sleep(200); try { if (await ev('window.ready === true')) break; } catch { } }
  if (!(await ev('window.ready === true').catch(() => false))) throw new Error(`worker ${slot}: page never loaded`);
  for (let j; (j = jobs.shift());) {
    const t0 = Date.now();
    let r;
    try { r = await ev(`${j.fn}(${JSON.stringify(j)})`); } catch (e) { r = { err: String(e.message).slice(0, 300) }; console.error('ERR', j.tag, r.err); try { await ev('import("./game.js").then(m => m.stopRace())'); } catch { } }
    if (a.out) appendFileSync(a.out, JSON.stringify({ job: j, r }) + '\n');
    console.error(`w${slot}`, j.tag, j.track, ((Date.now() - t0) / 1000).toFixed(1) + 's', `(${jobs.length} left)`);
  }
  try { await ev('localStorage.clear()'); } catch { }
  ws.close();
}
const T0 = Date.now();
try { await Promise.all(Array.from({ length: Math.min(NW, jobs.length) }, (_, i) => worker(i + 1).catch(e => console.error('worker dropped:', e.message)))); }
finally { await cleanup(); await rmProfs(); }
console.error(`done ${((Date.now() - T0) / 1000).toFixed(0)} s wall`);
process.exit(0);
