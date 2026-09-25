// Persistent player data (localStorage). Every read/write is try/catch'd: storage can be blocked.
import { CAR_BY_ID, STARTER_CAR, ECONOMY, DIFFICULTY_BY_ID } from './data.js';
import { TRACK_BY_ID, DEFAULT_TRACK } from './tracks.js';

const KEY = 'crg.save.v1';
const GHOST_KEY = (carId, trackId) => `crg.ghost.${carId}.${trackId}`;
const OLD_GHOST_KEY = carId => 'crg.ghost.' + carId;   // pre-courses: the single track = DEFAULT_TRACK

function fresh() {
  return {
    v: 1,
    name: 'Player',
    coins: ECONOMY.startCoins,
    tickets: ECONOMY.startTickets,
    cars: { [STARTER_CAR]: newCarRec(STARTER_CAR) },  // carId -> { dupes, nodes: [nodeId], look, best: { [trackId]: { lap, race } } }
    selected: { p1: STARTER_CAR, p2: STARTER_CAR },
    stats: { races: 0, wins: 0 },
    lastTrack: DEFAULT_TRACK,
    lastCpuLevel: 'normal',   // solo CPU difficulty (data.js DIFFICULTY)
    quality: 'auto',   // graphics: 'auto' | 'high' | 'medium' | 'low' (game.js QUALITY)
  };
}

export function newCarRec(carId) {
  return { dupes: 0, nodes: [], look: { body: CAR_BY_ID[carId].color, wheel: '#222222', wing: false }, best: {} };
}

const minT = (a, b) => (a == null ? b ?? null : b == null ? a : Math.min(a, b));
// Old single-track records (bestLap/bestRace) belong to DEFAULT_TRACK. Idempotent: an old tab may write them again.
function migrateRec(rec) {
  if (!rec.best || typeof rec.best !== 'object') rec.best = {};
  if (rec.bestLap != null || rec.bestRace != null) {
    const b = rec.best[DEFAULT_TRACK] ||= { lap: null, race: null };
    b.lap = minT(b.lap, rec.bestLap);
    b.race = minT(b.race, rec.bestRace);
  }
  delete rec.bestLap; delete rec.bestRace;
}

let data = null;

export function getSave() {
  if (data) return data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { data = null; }
  if (!data || data.v !== 1) data = fresh();
  // Records of cars this build doesn't know stay in the save: a newer build in another tab may have added them, and
  // deleting them here would make this tab's next persist() erase them. The UI only ever lists CARS (owned()).
  // own keys only: 'constructor' etc. (a crafted transfer code) must not pass as a car
  const known = () => Object.keys(data.cars).filter(id => Object.hasOwn(CAR_BY_ID, id));
  if (!known().length) data.cars[STARTER_CAR] = newCarRec(STARTER_CAR);
  for (const id of known()) migrateRec(data.cars[id]);
  for (const p of ['p1', 'p2']) if (!Object.hasOwn(CAR_BY_ID, String(data.selected[p])) || !Object.hasOwn(data.cars, String(data.selected[p]))) data.selected[p] = known()[0];
  if (!Object.hasOwn(TRACK_BY_ID, String(data.lastTrack))) data.lastTrack = DEFAULT_TRACK;
  if (!Object.hasOwn(DIFFICULTY_BY_ID, String(data.lastCpuLevel))) data.lastCpuLevel = 'normal';
  if (!['auto', 'high', 'medium', 'low'].includes(data.quality)) data.quality = 'auto';
  return data;
}

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(getSave())); } catch {}
}

// Another tab wrote the save (storage event): drop the cached copy so this tab doesn't overwrite it with stale data.
export function reloadSave(e) {
  if (e && e.key !== KEY && e.key !== null) return null;   // null key = storage cleared
  data = null;
  return getSave();
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch {}
  data = null;
  return getSave();
}

// Ghosts are stored per car and course under their own key so the main save stays small.
export function loadGhost(carId, trackId = DEFAULT_TRACK) {
  try {
    const g = JSON.parse(localStorage.getItem(GHOST_KEY(carId, trackId)));
    if (g || trackId !== DEFAULT_TRACK) return g;
    const old = localStorage.getItem(OLD_GHOST_KEY(carId));
    if (old == null) return null;
    localStorage.setItem(GHOST_KEY(carId, trackId), old);
    localStorage.removeItem(OLD_GHOST_KEY(carId));
    return JSON.parse(old);
  } catch { return null; }
}
// ghost null = delete.
export function saveGhost(carId, trackId, ghost) {
  try {
    if (ghost == null) localStorage.removeItem(GHOST_KEY(carId, trackId));
    else localStorage.setItem(GHOST_KEY(carId, trackId), JSON.stringify(ghost));
    if (trackId === DEFAULT_TRACK) localStorage.removeItem(OLD_GHOST_KEY(carId));
    return true;
  } catch { return false; }
}
