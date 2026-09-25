// node tools/check-sync-rules.mjs — tests the cloud save rules (codes / own / members / saves, from tools/gen-rules.mjs) in
// database.rules.json against the Firebase emulators, REST only. Start them first (Java 17 + firebase-tools 13):
//   npx firebase-tools@13.35.1 emulators:start --only auth,database --project demo-neongp
// WIPES the emulator database.
import { readFileSync } from 'node:fs';
import { CODE_MS, SAVE_MAX } from '../sync.js';

const DB = 'http://127.0.0.1:9000', NS = '?ns=demo-neongp-default-rtdb', AUTH = 'http://127.0.0.1:9099';
let bad = 0;
const ok = (cond, what) => { if (!cond) bad++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); };
async function req(method, path, body, token, q = '') {
  const r = await fetch(`${DB}/${path}.json${NS}${q}${token && token !== 'owner' ? `&auth=${token}` : ''}`, {
    method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    headers: token === 'owner' ? { Authorization: 'Bearer owner' } : {},
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const user = async () => {
  const u = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', body: '{"returnSecureToken":true}', headers: { 'content-type': 'application/json' } })).json();
  return { t: u.idToken, uid: u.localId };
};
const accept = async (what, ...a) => { const r = await req(...a); ok(r.status === 200, `accept: ${what}${r.status === 200 ? '' : ` (${r.status} ${JSON.stringify(r.json)})`}`); return r; };
const reject = async (what, ...a) => { const r = await req(...a); ok(r.status === 401 || r.status === 403, `reject: ${what}${r.status === 200 ? ' (was accepted)' : ` (${r.status})`}`); };

ok((await req('PUT', '.settings/rules', readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), 'owner')).status === 200, 'load rules');
await req('PUT', '', 'null', 'owner');
const [A, B, C, X] = [await user(), await user(), await user(), await user()];
const NOW = { '.sv': 'timestamp' }, soon = () => Date.now() + 5 * 60000;
const G = 'Grp_aaaaaaaaaaaaaaaaaaaa', G2 = 'Grp_bbbbbbbbbbbbbbbbbbbb', G3 = 'Grp_dddddddddddddddddddd';
const save = (rev, x = {}) => ({ data: 'NGP1.abc.def', rev, at: NOW, by: 'Windows PC・Chrome', ...x });
const mem = (x = {}) => ({ label: 'iPhone・Safari', seen: NOW, ...x });
const code = (g, by, x = {}) => ({ g, exp: soon(), by, ...x });

// ---- starting a group: own/<uid> + first member + save + code in one update
await reject('new group with a short id', 'PATCH', '', { [`own/${A.uid}`]: 'short', [`members/short/${A.uid}`]: mem(), 'saves/short': save(1) }, A.t);
await reject('new group save with rev 2', 'PATCH', '', { [`own/${A.uid}`]: G, [`members/${G}/${A.uid}`]: mem(), [`saves/${G}`]: save(2) }, A.t);
await reject('new group without naming it in own/<uid>', 'PATCH', '', { [`members/${G}/${A.uid}`]: mem(), [`saves/${G}`]: save(1) }, A.t);
await reject('code for a group this device is not in', 'PUT', 'codes/AAAAAA', code(G, A.uid), A.t);
await accept('start: own + member + save rev 1 + code at once', 'PATCH', '', { [`own/${A.uid}`]: G, [`members/${G}/${A.uid}`]: mem(), [`saves/${G}`]: save(1), 'codes/K7MX2P': code(G, A.uid) }, A.t);
await reject('a second "new group" member once the group exists', 'PUT', `members/${G}/${B.uid}`, mem(), B.t);

// ---- reading
await accept('member reads the save', 'GET', `saves/${G}`, undefined, A.t);
await reject('non-member reads the save', 'GET', `saves/${G}`, undefined, B.t);
await reject('unauthenticated read of the save', 'GET', `saves/${G}`);
await reject('non-member lists the members', 'GET', `members/${G}`, undefined, B.t);
await accept('member lists the members', 'GET', `members/${G}`, undefined, A.t);
await reject('listing all saves', 'GET', 'saves', undefined, A.t);
await reject('listing all members', 'GET', 'members', undefined, A.t);
await accept('reading one code by its exact path', 'GET', 'codes/K7MX2P', undefined, B.t);
await reject('guessing by listing codes', 'GET', 'codes', undefined, B.t);
await reject('guessing by listing codes (shallow)', 'GET', 'codes', undefined, B.t, '&shallow=true');
await reject('guessing by a codes query', 'GET', 'codes', undefined, B.t, '&orderBy="$key"&startAt="K"&limitToFirst=5');
await reject('unauthenticated code read', 'GET', 'codes/K7MX2P');

// ---- writing the save: members only, rev + 1 exactly
await reject('non-member writes the save', 'PUT', `saves/${G}`, save(2), B.t);
await reject('rev skip (1 -> 3)', 'PUT', `saves/${G}`, save(3), A.t);
await reject('same rev again (1 -> 1)', 'PUT', `saves/${G}`, save(1), A.t);
await reject(`data over ${SAVE_MAX} chars`, 'PUT', `saves/${G}`, save(2, { data: 'A'.repeat(SAVE_MAX + 1) }), A.t);
await reject('empty data', 'PUT', `saves/${G}`, save(2, { data: '' }), A.t);
await reject('client-chosen date', 'PUT', `saves/${G}`, save(2, { at: 1 }), A.t);
await reject('device label over 24 chars', 'PUT', `saves/${G}`, save(2, { by: 'x'.repeat(25) }), A.t);
await reject('extra field', 'PUT', `saves/${G}`, save(2, { coins: 1 }), A.t);
await reject('data changed without moving rev', 'PUT', `saves/${G}/data`, '"NGP1.zzz.yyy"', A.t);
await accept(`data of exactly ${SAVE_MAX} chars, rev 1 -> 2`, 'PUT', `saves/${G}`, save(2, { data: 'A'.repeat(SAVE_MAX) }), A.t);
await reject('stale device writes rev 2 again (conflict)', 'PUT', `saves/${G}`, save(2), A.t);

// ---- joining with a code
await reject('join without a code', 'PUT', `members/${G}/${B.uid}`, mem(), B.t);
await reject('join with a code, keeping the code (single use)', 'PUT', `members/${G}/${B.uid}`, mem({ code: 'K7MX2P' }), B.t);
await reject("writing someone else's membership", 'PATCH', '', { [`members/${G}/${C.uid}`]: mem({ code: 'K7MX2P' }), 'codes/K7MX2P': null }, B.t);
await reject('join with a made-up code', 'PATCH', '', { [`members/${G}/${B.uid}`]: mem({ code: 'ZZZZZZ' }), 'codes/ZZZZZZ': null }, B.t);
await reject('non-member deletes a code', 'DELETE', 'codes/K7MX2P', undefined, B.t);
await accept('join: membership + deleting the code at once', 'PATCH', '', { [`members/${G}/${B.uid}`]: mem({ code: 'K7MX2P' }), 'codes/K7MX2P': null }, B.t);
await accept('the new member reads the save', 'GET', `saves/${G}`, undefined, B.t);
await reject('reused code', 'PATCH', '', { [`members/${G}/${C.uid}`]: mem({ code: 'K7MX2P' }), 'codes/K7MX2P': null }, C.t);
await accept('new member writes rev 3', 'PUT', `saves/${G}`, save(3), B.t);
await reject('other device, still on rev 2, writes rev 3 (conflict)', 'PUT', `saves/${G}`, save(3), A.t);
await accept('member updates its own last-seen', 'PATCH', `members/${G}/${B.uid}`, { seen: NOW }, B.t);
await reject("member edits another member's entry", 'PATCH', `members/${G}/${A.uid}`, { label: 'hacked' }, B.t);
await reject("member removes another member", 'DELETE', `members/${G}/${A.uid}`, undefined, B.t);

// ---- codes: creation / expiry / cleanup
await accept('member issues a code', 'PUT', 'codes/ABCDEF', code(G, B.uid), B.t);
await reject('rewriting a live code', 'PUT', 'codes/ABCDEF', code(G, B.uid), B.t);
await reject('non-member issues a code for the group', 'PUT', 'codes/BCDEFG', code(G, C.uid), C.t);
await reject(`code valid longer than ${CODE_MS / 60000} minutes`, 'PUT', 'codes/BCDEFG', code(G, A.uid, { exp: Date.now() + CODE_MS + 60000 }), A.t);
await reject('code already expired at creation', 'PUT', 'codes/BCDEFG', code(G, A.uid, { exp: Date.now() - 1000 }), A.t);
await reject("code created in another uid's name", 'PUT', 'codes/BCDEFG', code(G, B.uid), A.t);
await reject('code with look-alike letters (O, 0, I, 1)', 'PUT', 'codes/AB0OI1', code(G, A.uid), A.t);
await reject('code with a lower-case / short key', 'PUT', 'codes/abcdef', code(G, A.uid), A.t);
await reject('code with an extra field', 'PUT', 'codes/BCDEFG', code(G, A.uid, { save: 'x' }), A.t);
await accept('another member deletes the code', 'DELETE', 'codes/ABCDEF', undefined, A.t);
await req('PUT', 'codes/EXPRD2', { g: G, exp: Date.now() - 1000, by: A.uid }, 'owner');   // a code whose 10 min ran out
await reject('join with an expired code', 'PATCH', '', { [`members/${G}/${C.uid}`]: mem({ code: 'EXPRD2' }), 'codes/EXPRD2': null }, C.t);
await accept('creator deletes its expired code', 'DELETE', 'codes/EXPRD2', undefined, A.t);
// a member of group 2 can't open group 1 with its own code
await accept('X starts group 2', 'PATCH', '', { [`own/${X.uid}`]: G2, [`members/${G2}/${X.uid}`]: mem(), [`saves/${G2}`]: save(1), 'codes/XXXXXX': code(G2, X.uid) }, X.t);
await reject("code of group 2 used to join group 1", 'PATCH', '', { [`members/${G}/${X.uid}`]: mem({ code: 'XXXXXX' }), 'codes/XXXXXX': null }, X.t);
await reject('group 2 member reads group 1', 'GET', `saves/${G}`, undefined, X.t);
await reject('group 2 member writes group 1', 'PUT', `saves/${G}`, save(4), X.t);

// ---- storage per sign-in is bounded: one group it started at a time, no orphaned saves (tools/gen-rules.mjs)
await reject('X starts a second group while still in group 2', 'PATCH', '', { [`own/${X.uid}`]: G3, [`members/${G3}/${X.uid}`]: mem(), [`saves/${G3}`]: save(1) }, X.t);
await reject("a new group named in another uid's own", 'PATCH', '', { [`own/${X.uid}`]: G3, [`members/${G3}/${C.uid}`]: mem(), [`saves/${G3}`]: save(1) }, C.t);
await reject('deleting own/<uid> (to start over)', 'DELETE', `own/${X.uid}`, undefined, X.t);
await accept('reading its own own/<uid>', 'GET', `own/${X.uid}`, undefined, X.t);
await reject("reading another uid's own", 'GET', `own/${X.uid}`, undefined, A.t);
await accept('X issues a code for group 2', 'PUT', 'codes/DEADCD', code(G2, X.uid), X.t);
await reject('the last member leaves, keeping the save (orphan)', 'DELETE', `members/${G2}/${X.uid}`, undefined, X.t);
await accept('X leaves group 2 (taking its save) and starts group 3 at once', 'PATCH', '', { [`members/${G2}/${X.uid}`]: null, [`saves/${G2}`]: null, [`own/${X.uid}`]: G3, [`members/${G3}/${X.uid}`]: mem(), [`saves/${G3}`]: save(1) }, X.t);
await reject('joining group 2 (no save any more) with its leftover code', 'PATCH', '', { [`members/${G2}/${C.uid}`]: mem({ code: 'DEADCD' }), 'codes/DEADCD': null }, C.t);
const F = await user();
let made = 0;
for (let i = 0; i < 5; i++) {
  const g = `Grp_flood${i}xxxxxxxxxxxxxx`;
  if ((await req('PATCH', '', { [`own/${F.uid}`]: g, [`members/${g}/${F.uid}`]: mem(), [`saves/${g}`]: save(1, { data: 'A'.repeat(SAVE_MAX) }) }, F.t)).status === 200) made++;
}
ok(made === 1, `one sign-in sends 5 new groups of ${SAVE_MAX} chars: ${made} stored`);

// ---- more devices (no cap: see tools/gen-rules.mjs)
const extra = [];
for (const k of ['MNRE22', 'MNRE33', 'MNRE44', 'MNRE55', 'MNRE66', 'MNRE77', 'MNRE88']) {
  const U = await user();
  await req('PUT', `codes/${k}`, code(G, A.uid), A.t);
  if ((await req('PATCH', '', { [`members/${G}/${U.uid}`]: mem({ code: k }), [`codes/${k}`]: null }, U.t)).status === 200) extra.push(U);
}
ok(extra.length === 7, `9 devices in one group (${extra.length + 2})`);

// ---- leaving
await reject('member deletes the save while others remain', 'DELETE', `saves/${G}`, undefined, B.t);
await accept('member leaves (removes itself)', 'DELETE', `members/${G}/${B.uid}`, undefined, B.t);
await reject('the device that left reads the save', 'GET', `saves/${G}`, undefined, B.t);
await reject('the device that left writes the save', 'PUT', `saves/${G}`, save(4), B.t);
await reject('the device that left rejoins without a code', 'PUT', `members/${G}/${B.uid}`, mem(), B.t);
for (const U of extra) await req('DELETE', `members/${G}/${U.uid}`, undefined, U.t);
await accept('last member leaves and deletes the save', 'PATCH', '', { [`members/${G}/${A.uid}`]: null, [`saves/${G}`]: null }, A.t);
const left = await req('GET', '', undefined, 'owner');
ok(!left.json?.saves?.[G] && !left.json?.members?.[G], 'group 1 is gone');
await req('PUT', 'saves/Grp_cccccccccccccccccccc', save(5, { at: 1 }), 'owner');   // a save nobody is a member of
await reject('"new group" membership where a save already exists', 'PATCH', '', { [`own/${A.uid}`]: 'Grp_cccccccccccccccccccc', [`members/Grp_cccccccccccccccccccc/${A.uid}`]: mem() }, A.t);
await accept('after leaving, the same uid starts a new group', 'PATCH', '', { [`own/${A.uid}`]: G3.replace('d', 'e'), [`members/${G3.replace('d', 'e')}/${A.uid}`]: mem(), [`saves/${G3.replace('d', 'e')}`]: save(1) }, A.t);

// ---- nothing else
await reject('write outside lb / ghosts / codes / own / members / saves', 'PUT', `coins/${A.uid}`, 1, A.t);
await reject('write to the root', 'PUT', '', { saves: {} }, A.t);

console.log(bad ? `${bad} FAILED` : 'all passed');
process.exit(bad ? 1 : 0);
