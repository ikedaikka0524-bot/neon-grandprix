// node tools/check-save.mjs  — a car record this build doesn't know (added by a newer build in another tab) must survive
// reloadSave() + persist(), and selection must fall back to a known car.
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { getSave, persist, reloadSave } = await import('../save.js');
const { STARTER_CAR } = await import('../data.js');

getSave();
persist();
const s = JSON.parse(store.get('crg.save.v1'));
s.cars.zz_future = { dupes: 0, nodes: [], look: {}, best: {}, extra: 1 };
s.selected.p1 = 'zz_future';
store.set('crg.save.v1', JSON.stringify(s));

const r = reloadSave({ key: 'crg.save.v1' });
assert.equal(r.selected.p1, STARTER_CAR);
persist();
assert.deepEqual(JSON.parse(store.get('crg.save.v1')).cars.zz_future, s.cars.zz_future);

// solo CPU difficulty: kept when known, anything else (incl. prototype keys) falls back to 'normal'
for (const [v, want] of [['oni', 'oni'], ['constructor', 'normal'], [undefined, 'normal'], ['zz', 'normal']]) {
  const t = JSON.parse(store.get('crg.save.v1'));
  t.lastCpuLevel = v;
  store.set('crg.save.v1', JSON.stringify(t));
  assert.equal(reloadSave({ key: 'crg.save.v1' }).lastCpuLevel, want);
}
// cloud save chooser: what differs between two saves (sync.js saveDiff), from a's side
const { saveDiff } = await import('../sync.js');
const A = JSON.parse(store.get('crg.save.v1')), B = JSON.parse(JSON.stringify(A));
assert.deepEqual(saveDiff(A, B), []);
B.coins -= 120; B.tickets += 1;
B.cars.n_hatch.look.body = '#00ff00';
A.cars.n_hatch.nodes = ['s1', 's2'];
A.cars.n_hatch.best = { circuit: { lap: 30, race: 95 } };
const d = saveDiff(A, B).map(x => x[0]);
for (const t of ['コイン +120', 'チケット −1', 'ホットハッチ スキル+2', 'ホットハッチの色', 'ベスト記録 2件']) assert.ok(d.includes(t), `${t} in ${d}`);
assert.equal(saveDiff(A, B).find(x => x[0] === 'ホットハッチの色')[1], A.cars.n_hatch.look.body);
assert.ok(saveDiff(B, A).map(x => x[0]).includes('ホットハッチ スキル−2'));
console.log('save ok');
