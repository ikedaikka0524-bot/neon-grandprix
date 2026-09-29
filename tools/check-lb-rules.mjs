// node tools/check-lb-rules.mjs — tests database.rules.json against the Firebase emulators (REST only, no deps) and the
// lb.js ghost codec: the current season (lb.js SEASON: lb2/, ghosts2/) takes valid writes only, season 1 (lb/, ghosts/)
// takes none at all. Start the emulators first (Java 17 works with firebase-tools 13):
//   npx firebase-tools@13.35.1 emulators:start --only auth,database --project demo-neongp
// WIPES the emulator database.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { packGhost, checkGhost, minTimes, rarityOf, SEASON, lbPath, ghostPath } from '../lb.js';

const DB = 'http://127.0.0.1:9000', NS = '?ns=demo-neongp-default-rtdb', AUTH = 'http://127.0.0.1:9099';
let bad = 0;
const ok = (cond, what) => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
async function req(method, path, body, token) {
  const r = await fetch(`${DB}/${path}.json${NS}${token && token !== 'owner' ? `&auth=${token}` : ''}`, {
    method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: token === 'owner' ? { Authorization: 'Bearer owner' } : {},
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const user = async () => (await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', body: '{"returnSecureToken":true}', headers: { 'content-type': 'application/json' } })).json());
const accept = async (what, ...a) => { const r = await req(...a); ok(r.status === 200, `accept: ${what}${r.status === 200 ? '' : ` (${r.status} ${JSON.stringify(r.json)})`}`); };
const reject = async (what, ...a) => { const r = await req(...a); ok(r.status === 401 || r.status === 403, `reject: ${what}${r.status === 200 ? ' (was accepted)' : ''}`); };

// ---- rules
ok((await req('PUT', '.settings/rules', readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), 'owner')).status === 200, 'load rules');
await req('PUT', '', 'null', 'owner');
const [A, B] = [await user(), await user()], a = A.idToken, uidA = A.localId, uidB = B.localId;
const T = 'circuit', min = minTimes(T), NOW = { '.sv': 'timestamp' }, L = lbPath(SEASON), GH = ghostPath(SEASON);
ok(L === 'lb2' && GH === 'ghosts2', `season ${SEASON} writes to ${L}/ and ${GH}/`);
const entry = (race, lap, car = 'n_hatch', x = {}) => ({ name: 'テスト', race, raceCar: car, raceAt: NOW, lap, lapCar: car, lapAt: NOW, v: 1, ...x });
const look = { body: '#ff00aa', wheel: '#222222', wing: false };
const ghost = (time, x = {}) => ({ data: 'H4sI', time, carId: 'n_hatch', look, trackId: T, v: 1, ...x });

await accept('first entry + ghost in all and N (one multi-path update)', 'PATCH', '', {
  [`${L}/${T}/all/${uidA}`]: entry(60, 19), [`${GH}/${T}/all/${uidA}`]: ghost(60),
  [`${L}/${T}/N/${uidA}`]: entry(60, 19), [`${GH}/${T}/N/${uidA}`]: ghost(60),
}, a);
await accept('public read without auth', 'GET', `${L}/${T}/all`);
const q = await fetch(`${DB}/${L}/${T}/all.json${NS}&orderBy="race"&limitToFirst=50`);
ok(q.status === 200, 'indexed orderBy query');
await reject('unauthenticated write', 'PUT', `${L}/${T}/all/${uidA}`, entry(59, 19));
await reject("write to someone else's uid", 'PUT', `${L}/${T}/all/${uidB}`, entry(59, 19), a);
await reject('slower race than the stored best', 'PUT', `${L}/${T}/all/${uidA}`, entry(61, 19), a);
await reject('slower lap than the stored best', 'PUT', `${L}/${T}/all/${uidA}`, entry(60, 20), a);
await accept('faster race, same lap', 'PATCH', '', { [`${L}/${T}/all/${uidA}`]: entry(58, 19), [`${GH}/${T}/all/${uidA}`]: ghost(58) }, a);
await reject('race below the course minimum', 'PUT', `${L}/${T}/all/${uidA}`, entry(min.race - 0.01, 19), a);
await reject('lap below the course minimum', 'PUT', `${L}/${T}/all/${uidA}`, entry(57, min.lap - 0.01), a);
await reject('time >= 3600 (new entry)', 'PUT', `${L}/${T}/all/${uidB}`, entry(3600, 19), B.idToken);
await reject('time as a string', 'PUT', `${L}/${T}/all/${uidB}`, entry('50', 19), B.idToken);
await reject('name longer than 12', 'PUT', `${L}/${T}/all/${uidB}`, entry(50, 19, 'n_hatch', { name: 'x'.repeat(13) }), B.idToken);
await reject('empty name', 'PUT', `${L}/${T}/all/${uidB}`, entry(50, 19, 'n_hatch', { name: '' }), B.idToken);
await reject('UR car in the N bucket', 'PUT', `${L}/${T}/N/${uidB}`, entry(50, 19, 'ur_warp'), B.idToken);
for (const c of ['constructor', 'constructor_x', '__proto__', 'x_hatch']) await reject(`car id '${c}' (not n_/r_/sr_/ur_)`, 'PUT', `${L}/${T}/all/${uidB}`, entry(50, 19, c), B.idToken);
await reject("ghost carId '__proto__'", 'PUT', `${GH}/${T}/all/${uidA}`, ghost(58, { carId: '__proto__' }), a);
await reject('unknown bucket', 'PUT', `${L}/${T}/X/${uidB}`, entry(50, 19), B.idToken);
await reject('unknown course', 'PUT', `${L}/nowhere/all/${uidB}`, entry(500, 190), B.idToken);
await reject('extra field', 'PUT', `${L}/${T}/all/${uidB}`, entry(50, 19, 'n_hatch', { coins: 1 }), B.idToken);
await reject('missing field', 'PUT', `${L}/${T}/all/${uidB}`, (({ lapAt, ...e }) => e)(entry(50, 19)), B.idToken);
await reject('client-chosen date', 'PUT', `${L}/${T}/all/${uidB}`, entry(50, 19, 'n_hatch', { raceAt: 1 }), B.idToken);
await reject('ghost time != entry race', 'PUT', `${GH}/${T}/all/${uidA}`, ghost(57), a);
await reject('ghost with no entry', 'PUT', `${GH}/${T}/all/${uidB}`, ghost(50), B.idToken);
await reject('ghost over 200 KB', 'PUT', `${GH}/${T}/all/${uidA}`, ghost(58, { data: 'A'.repeat(204801) }), a);
await reject('ghost trackId mismatch', 'PUT', `${GH}/${T}/all/${uidA}`, ghost(58, { trackId: 'city' }), a);
await reject('ghost bad look', 'PUT', `${GH}/${T}/all/${uidA}`, ghost(58, { look: { ...look, body: 'red' } }), a);
await reject('write outside the leaderboard', 'PUT', `coins/${uidA}`, 1, a);
await reject('write the whole course', 'PUT', `${L}/${T}`, { all: {} }, a);
await accept('second player, UR bucket', 'PATCH', '', { [`${L}/${T}/UR/${uidB}`]: entry(40, 13, 'ur_warp'), [`${L}/${T}/all/${uidB}`]: entry(40, 13, 'ur_warp') }, B.idToken);
const top = (await (await fetch(`${DB}/${L}/${T}/all.json${NS}&orderBy="race"&limitToFirst=1`)).json());
ok(Object.keys(top)[0] === uidB, 'orderBy race puts the faster player first');

// ---- season 1 (lb/, ghosts/): a read-only archive. Seeded as the owner (old data), then nobody may write anything there.
const S1 = { [`lb/${T}/all/${uidA}`]: entry(70, 20, 'n_hatch', { raceAt: 1, lapAt: 1 }), [`ghosts/${T}/all/${uidA}`]: ghost(70), [`lb/${T}/UR/${uidB}`]: entry(45, 14, 'ur_warp', { raceAt: 1, lapAt: 1 }) };
ok((await req('PATCH', '', S1, 'owner')).status === 200, 'season 1: seed old data as the owner');
const snap = async () => JSON.stringify([(await req('GET', 'lb', undefined, 'owner')).json, (await req('GET', 'ghosts', undefined, 'owner')).json]);
const before = await snap();
await accept('season 1: public read without auth', 'GET', `lb/${T}/all`);
await accept('season 1: public ghost read without auth', 'GET', `ghosts/${T}/all/${uidA}`);
ok((await fetch(`${DB}/lb/${T}/UR.json${NS}&orderBy="race"&limitToFirst=50`)).status === 200, 'season 1: indexed orderBy query');
await reject('season 1: faster own entry', 'PUT', `lb/${T}/all/${uidA}`, entry(60, 19), a);
await reject('season 1: faster own entry + ghost (one update)', 'PATCH', '', { [`lb/${T}/all/${uidA}`]: entry(60, 19), [`ghosts/${T}/all/${uidA}`]: ghost(60) }, a);
await reject('season 1: a field of the own entry', 'PUT', `lb/${T}/all/${uidA}/name`, '"x"', a);
await reject('season 1: new entry', 'PUT', `lb/${T}/N/${uidA}`, entry(60, 19), a);
await reject('season 1: new entry, other course', 'PUT', `lb/city/all/${uidB}`, entry(60, 19), B.idToken);
await reject('season 1: ghost of the own entry', 'PUT', `ghosts/${T}/all/${uidA}`, ghost(70, { look: { ...look, body: '#00ff00' } }), a);
await reject('season 1: delete the own entry', 'DELETE', `lb/${T}/all/${uidA}`, undefined, a);
await reject('season 1: delete the own ghost', 'DELETE', `ghosts/${T}/all/${uidA}`, undefined, a);
await reject("season 1: someone else's entry", 'PUT', `lb/${T}/UR/${uidB}`, entry(40, 13, 'ur_warp'), a);
await reject('season 1: unauthenticated', 'PUT', `lb/${T}/all/${uidB}`, entry(60, 19));
await reject('season 1: the whole tree', 'PUT', 'lb', {}, a);
await reject('season 1: the whole ghost tree', 'PUT', 'ghosts', {}, a);
await reject('season 1: new course key', 'PUT', `lb/nowhere/all/${uidA}`, entry(500, 190), a);
await reject(`season 1 + season ${SEASON} in one update (all or nothing)`, 'PATCH', '', { [`${L}/city/all/${uidA}`]: entry(60, 19), [`lb/city/all/${uidA}`]: entry(60, 19) }, a);
ok((await req('GET', `${L}/city/all/${uidA}`, undefined, 'owner')).json === null, `season ${SEASON} part of the rejected update not written`);
await reject(`season ${SEASON} ghost matching only the season 1 entry`, 'PUT', `${GH}/${T}/UR/${uidB}`, ghost(45, { carId: 'ur_warp' }), B.idToken);
ok(await snap() === before, 'season 1 data unchanged');

// ---- ghost codec (node has CompressionStream)
const laps = 3, n = 1200, frames = Array.from({ length: n }, (_, i) => {
  const t = i / (n - 1), a2 = t * laps * 2 * Math.PI;
  return [Math.round(300 * Math.sin(a2) * 100) / 100, Math.round(3 * Math.sin(a2 * 3) * 100) / 100, Math.round(200 * Math.cos(a2) * 100) / 100, Math.round(-a2 * 100) / 100, Math.round((t * laps - 0.01) * 1e4) / 1e4];
});
frames[n - 1][4] = laps;
const time = (n - 1) * 0.05, g = { v: 1, trackId: T, carId: 'ur_warp', look, time, dt: 0.05, frames };
const data = await packGhost(g), node = { data, time, carId: 'ur_warp', look, trackId: T, v: 1 };
console.log(`     ghost ${n} frames: JSON ${JSON.stringify(frames).length} B -> ${data.length} B base64`);
const back = await checkGhost(node, T, time);
ok(JSON.stringify(back.frames) === JSON.stringify(frames), 'ghost round trip is exact');
const bad1 = async (what, nd, t = time) => ok(await checkGhost(nd, T, t).then(() => false, () => true), `ghost check rejects ${what}`);
await bad1('another course', { ...node, trackId: 'city' });
await bad1('time != entry', node, time + 1);
await bad1('duration != time', { ...node, time: time + 5 }, time + 5);
await bad1('garbage data', { ...node, data: 'aGVsbG8=' });
await bad1('a run that never finished', { ...node, data: await packGhost({ frames: frames.map(f => [...f.slice(0, 4), Math.min(f[4], 1.5)]) }) });
await bad1("carId 'constructor'", { ...node, carId: 'constructor' });
ok(['constructor', 'constructor_x', '__proto__', 'hasOwnProperty'].every(c => rarityOf(c) === null) && rarityOf('sr_nitro') === 'SR', 'rarityOf ignores Object.prototype names');
// gzip bomb inside GHOST_MAX (150 MB of zeros). Node inflates in small steps anyway; the 1 KB feeding in gz() is what
// keeps Chromium / WebKit (which inflate a whole input chunk at once) from allocating it all before the cap check.
const bomb = gzipSync(Buffer.alloc(150 * 2 ** 20)).toString('base64');
ok(bomb.length <= 204800 && await checkGhost({ ...node, data: bomb }, T, time).then(() => false, e => e.message === 'ghost too big'), 'gzip bomb stops at the cap');
ok(await checkGhost({ ...node, data: await packGhost({ frames: frames.map((f, i) => (i > 5 && i < 60 ? [20000 + i, f[1], 20100 + i, ...f.slice(3)] : f)) }) }, T, time).then(() => true, () => false), 'ghost check accepts a tokyodive run (pocket course at 20 km, 20 km)');
await bad1('non-finite / huge coordinates', { ...node, data: await packGhost({ frames: frames.map((f, i) => (i === 5 ? [1e6, ...f.slice(1)] : f)) }) });

console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
