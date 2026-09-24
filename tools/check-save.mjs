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
console.log('save ok');
