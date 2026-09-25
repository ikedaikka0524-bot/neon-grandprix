// node tools/check-pwa.mjs — 設定 → データ引き継ぎ codec (pwa.js): round trip, and every malformed / tampered /
// oversized / hostile code is rejected (the code comes from a paste: a trust boundary).
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { encodeSave, decodeSave } = await import('../pwa.js');
const { getSave } = await import('../save.js');

const base = JSON.parse(JSON.stringify(getSave()));
base.coins = 12345;
base.cars.zz_future = { dupes: 0, nodes: [], look: {}, best: {}, extra: 1 };   // a newer build's car: kept, like save.js
const code = await encodeSave(base);
assert.match(code, /^NGP1\.[\w-]+\.[0-9a-z]+$/);
assert.deepEqual(await decodeSave(code), base);
assert.deepEqual(await decodeSave(`  ${code.slice(0, 20)}\n${code.slice(20)} `), base, 'line breaks from a paste are ignored');

const bad = async (what, s) => assert.equal(await decodeSave(typeof s === 'string' ? s : await encodeSave(s)), null, what);
const edit = f => { const s = JSON.parse(JSON.stringify(base)); f(s); return s; };
const mid = code.indexOf('.') + 10;
await bad('tampered', code.slice(0, mid) + (code[mid] === 'A' ? 'B' : 'A') + code.slice(mid + 1));
await bad('truncated', code.slice(0, -8));
await bad('not a code', 'hello');
await bad('too long', code + ' '.repeat(200000));
await bad('wrong version', edit(s => { s.v = 2; }));
await bad('negative coins', edit(s => { s.coins = -5; }));
await bad('fractional tickets', edit(s => { s.tickets = 1.5; }));
await bad('markup in a colour', edit(s => { s.cars.n_hatch.look.body = '"><img src=x onerror=alert(1)>'; }));
await bad('known car without nodes', edit(s => { delete s.cars.n_hatch.nodes; }));
await bad('no cars', edit(s => { s.cars = {}; }));
await bad('prototype key', JSON.parse(`{"v":1,"name":"a","coins":1,"tickets":1,"selected":{},"stats":{"races":0,"wins":0},"cars":{"__proto__":{"nodes":[],"dupes":0,"look":{}}}}`));
await bad('gzip bomb', edit(s => { s.pad = Array(300000).fill(1); }));
assert.equal((await decodeSave(await encodeSave(edit(s => { s.name = '<b>Ikeda</b>'; })))).name, 'bIkeda/b', 'name cleaned like lb.js');

// ids this build doesn't know (a newer build's node, or crafted ones) may come through, but the loaded save must work:
// computeStats skips them, save.js picks a real selected car ('constructor' is on every object's prototype)
const { computeStats, CAR_BY_ID } = await import('../data.js');
const { reloadSave } = await import('../save.js');
for (const nodes of [['no_such_node'], ['__proto__'], ['constructor'], ['s1', 's5']]) {
  const s = await decodeSave(await encodeSave(edit(x => { x.cars.n_hatch.nodes = nodes; x.selected.p1 = 'constructor'; x.selected.p2 = 'toString'; })));
  store.set('crg.save.v1', JSON.stringify(s));
  const g = reloadSave();
  for (const p of ['p1', 'p2']) assert.ok(Object.hasOwn(CAR_BY_ID, g.selected[p]) && Object.hasOwn(g.cars, g.selected[p]), `selected.${p} ${g.selected[p]}`);
  const st = computeStats('n_hatch', g.cars.n_hatch.nodes);
  assert.ok(Number.isFinite(st.top) && Number.isFinite(st.grip), `stats with nodes ${nodes}`);
}
console.log('pwa transfer ok');
