// node tools/gen-rules.mjs — writes database.rules.json (Firebase Realtime Database rules for lb.js and sync.js) from tracks.js.
// Re-run after adding a course, then paste the file into the console's Rules tab (SETUP-FIREBASE.md).
// Per course: race >= length × laps / MAX_AVG, lap >= length / MAX_AVG (lb.js minTimes, generous: see MAX_AVG).
import { writeFileSync } from 'node:fs';
import { TRACKS } from '../tracks.js';
import { minTimes, CAR_RE } from '../lb.js';
import { CODE_RE, GROUP_RE, CODE_MS, SAVE_MAX } from '../sync.js';

const own = 'auth != null && auth.uid == $uid';
const bucket = "($b == 'all' || $b == 'N' || $b == 'R' || $b == 'SR' || $b == 'UR')";
// car ids start with their rarity (n_ r_ sr_ ur_, lb.js CAR_RE); a rarity bucket only takes its own cars
const car = `newData.isString() && newData.val().matches(${CAR_RE}) && ` + "($b == 'all' || ($b == 'N' && newData.val().beginsWith('n_')) || ($b == 'R' && newData.val().beginsWith('r_')) || ($b == 'SR' && newData.val().beginsWith('sr_')) || ($b == 'UR' && newData.val().beginsWith('ur_')))";
const time = min => `newData.isNumber() && newData.val() >= ${min} && newData.val() < 3600 && (!data.exists() || newData.val() <= data.val())`;   // bests only improve
const at = 'newData.isNumber() && (newData.val() == now || newData.val() == data.val())';
const V = s => ({ '.validate': s });
const NO = { $other: V('false') };

const entry = m => ({
  '.write': own,
  '.validate': `${bucket} && newData.hasChildren(['name', 'race', 'raceCar', 'raceAt', 'lap', 'lapCar', 'lapAt', 'v'])`,
  name: V('newData.isString() && newData.val().length >= 1 && newData.val().length <= 12'),
  race: V(time(m.race)), raceCar: V(car), raceAt: V(at),
  lap: V(time(m.lap)), lapCar: V(car), lapAt: V(at),
  v: V('newData.isNumber()'),
  ...NO,
});
const ghost = {
  '.write': own,
  // the ghost of this player's entry: same race time (lb/ is written in the same update)
  '.validate': `${bucket} && newData.hasChildren(['data', 'time', 'carId', 'look', 'trackId', 'v']) && newData.child('time').val() == newData.parent().parent().parent().parent().child('lb/' + $t + '/' + $b + '/' + $uid + '/race').val()`,
  data: V('newData.isString() && newData.val().length > 0 && newData.val().length <= 204800'),
  time: V('newData.isNumber()'),
  carId: V(car),
  look: {
    '.validate': "newData.hasChildren(['body', 'wheel', 'wing'])",
    body: V('newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)'),
    wheel: V('newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{6}$/)'),
    wing: V('newData.isBoolean()'),
    ...NO,
  },
  trackId: V('newData.val() == $t'),
  v: V('newData.isNumber()'),
  ...NO,
};

// ---- cloud save (sync.js): a sync group g of devices (anonymous uids) sharing saves/<g>, joined with a one-time code.
// Multi-path updates are checked against the state after the whole update (newData), so a new group writes its first
// member + save + code at once, and a join writes its membership and deletes the code it used at once.
const up = n => `newData${'.parent()'.repeat(n)}`;               // the root of the future state, n levels up
const member = (root, g, uid = 'auth.uid') => `${root}.child('members/' + ${g} + '/' + ${uid}).exists()`;
const codeOf = "newData.child('code').val()";
const code = {
  '.read': 'auth != null',                                          // exact path only: nothing above it is readable
  // create: by a member of the group it opens (after this update); delete: its creator or a member of its group
  // (the device joining with it is one after this update); never rewritten
  '.write': `auth != null && ((!data.exists() && newData.exists() && ${member(up(2), "newData.child('g').val()")})`
    + ` || (data.exists() && !newData.exists() && (data.child('by').val() == auth.uid || ${member('root', "data.child('g').val()")} || ${member(up(2), "data.child('g').val()")})))`,
  '.validate': `$code.matches(${CODE_RE}) && newData.hasChildren(['g', 'exp', 'by'])`,
  g: V(`newData.isString() && newData.val().matches(${GROUP_RE})`),
  exp: V(`newData.isNumber() && newData.val() > now && newData.val() <= now + ${CODE_MS}`),
  by: V('newData.val() == auth.uid'),
  ...NO,
};
// Storage per uid is bounded like ghosts: a uid is in at most one group it started (own/<uid> names it; repointed only
// once out of the old one), a group's last member takes its save with it (no orphaned saves), and a code only opens
// a group that still has a save. So saves ≤ uids, whatever one sign-in sends. (Codes: ~100 B each, 10 min, a member's
// only; not counted per uid.)
const owner = {
  '.read': 'auth != null && auth.uid == $uid',
  '.write': `auth != null && auth.uid == $uid && newData.exists() && (!data.exists() || !${member(up(2), 'data.val()', '$uid')})`,
  '.validate': `newData.isString() && newData.val().matches(${GROUP_RE})`,
};
const membership = {
  // only yourself: leave (the last member deleting the save in the same update), update your entry, start a new group
  // (no members and no save yet, named by own/<uid> after this update), or join a group that has a save with a live
  // code for it that this same update deletes (single use). No cap on the group size: rules can't count children, and
  // a device that lost its sign-in keeps its entry (only a member removes itself), so a cap would lock players out
  // over time; outsiders can't grow a group anyway (codes are single use and only members make them)
  '.write': `auth != null && auth.uid == $uid && ((!newData.exists() && (${up(1)}.exists() || !${up(3)}.child('saves/' + $g).exists()))`
    + ' || (data.exists() && newData.exists())'
    + ` || (!data.parent().exists() && !root.child('saves/' + $g).exists() && ${up(3)}.child('own/' + $uid).val() == $g)`
    + ` || (${codeOf} != null && root.child('saves/' + $g).exists() && root.child('codes/' + ${codeOf} + '/g').val() == $g`
    + ` && root.child('codes/' + ${codeOf} + '/exp').val() > now && !${up(3)}.child('codes/' + ${codeOf}).exists()))`,
  '.validate': `$g.matches(${GROUP_RE}) && newData.hasChildren(['label', 'seen'])`,
  label: V('newData.isString() && newData.val().length >= 1 && newData.val().length <= 24'),
  seen: V('newData.val() == now'),
  code: V(`newData.isString() && newData.val().matches(${CODE_RE})`),
  ...NO,
};
const cloud = {
  '.read': `auth != null && ${member('root', '$g')}`,
  // members write (a joining / new member included); the last member leaving may delete it
  '.write': `auth != null && ((newData.exists() && ${member(up(2), '$g')}) || (!newData.exists() && ${member('root', '$g')} && !${up(2)}.child('members/' + $g).exists()))`,
  // every write moves rev on by exactly one (1 = new): a stale device's write fails, so this is a compare-and-set
  '.validate': "newData.hasChildren(['data', 'rev', 'at', 'by']) && ((!data.exists() && newData.child('rev').val() == 1) || (data.exists() && newData.child('rev').val() == data.child('rev').val() + 1))",
  data: V(`newData.isString() && newData.val().length > 0 && newData.val().length <= ${SAVE_MAX}`),
  rev: V('newData.isNumber()'),
  at: V('newData.val() == now'),
  by: V('newData.isString() && newData.val().length >= 1 && newData.val().length <= 24'),
  ...NO,
};

const rules = {
  rules: {
    lb: { '.read': true, ...Object.fromEntries(TRACKS.map(t => [t.id, { $b: { '.indexOn': ['race', 'lap'], $uid: entry(minTimes(t.id)) } }])) },
    ghosts: { '.read': true, $t: { $b: { $uid: ghost } } },
    codes: { $code: code },
    own: { $uid: owner },
    members: { $g: { '.read': 'auth != null && data.child(auth.uid).exists()', $uid: membership } },
    saves: { $g: cloud },
  },
};
writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify(rules, null, 2) + '\n');
console.log(TRACKS.map(t => `${t.id.padEnd(12)} race >= ${minTimes(t.id).race}  lap >= ${minTimes(t.id).lap}`).join('\n'));
