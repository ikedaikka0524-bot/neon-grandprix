// node tools/gen-rules.mjs — writes database.rules.json (Firebase Realtime Database rules for lb.js) from tracks.js.
// Re-run after adding a course, then paste the file into the console's Rules tab (SETUP-FIREBASE.md).
// Per course: race >= length × laps / MAX_AVG, lap >= length / MAX_AVG (lb.js minTimes, generous: see MAX_AVG).
import { writeFileSync } from 'node:fs';
import { TRACKS } from '../tracks.js';
import { minTimes, CAR_RE } from '../lb.js';

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

const rules = {
  rules: {
    lb: { '.read': true, ...Object.fromEntries(TRACKS.map(t => [t.id, { $b: { '.indexOn': ['race', 'lap'], $uid: entry(minTimes(t.id)) } }])) },
    ghosts: { '.read': true, $t: { $b: { $uid: ghost } } },
  },
};
writeFileSync(new URL('../database.rules.json', import.meta.url), JSON.stringify(rules, null, 2) + '\n');
console.log(TRACKS.map(t => `${t.id.padEnd(12)} race >= ${minTimes(t.id).race}  lap >= ${minTimes(t.id).lap}`).join('\n'));
