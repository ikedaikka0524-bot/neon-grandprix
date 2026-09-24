// Persistent player data (localStorage). Every read/write is try/catch'd: storage can be blocked.
import { CAR_BY_ID, STARTER_CAR, ECONOMY } from './data.js';

const KEY = 'crg.save.v1';
const GHOST_KEY = id => 'crg.ghost.' + id;

function fresh() {
  return {
    v: 1,
    name: 'Player',
    coins: ECONOMY.startCoins,
    tickets: ECONOMY.startTickets,
    cars: { [STARTER_CAR]: newCarRec(STARTER_CAR) },  // carId -> { dupes, nodes: [nodeId], look, bestLap, bestRace }
    selected: { p1: STARTER_CAR, p2: STARTER_CAR },
    stats: { races: 0, wins: 0 },
  };
}

export function newCarRec(carId) {
  return { dupes: 0, nodes: [], look: { body: CAR_BY_ID[carId].color, wheel: '#222222', wing: false }, bestLap: null, bestRace: null };
}

let data = null;

export function getSave() {
  if (data) return data;
  try { data = JSON.parse(localStorage.getItem(KEY)); } catch { data = null; }
  if (!data || data.v !== 1) data = fresh();
  // drop cars that no longer exist in data.js
  for (const id of Object.keys(data.cars)) if (!CAR_BY_ID[id]) delete data.cars[id];
  if (!Object.keys(data.cars).length) data.cars[STARTER_CAR] = newCarRec(STARTER_CAR);
  for (const p of ['p1', 'p2']) if (!data.cars[data.selected[p]]) data.selected[p] = Object.keys(data.cars)[0];
  return data;
}

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(getSave())); } catch {}
}

export function resetSave() {
  try { localStorage.removeItem(KEY); } catch {}
  data = null;
  return getSave();
}

// Ghosts are stored per car under their own key so the main save stays small.
export function loadGhost(carId) {
  try { return JSON.parse(localStorage.getItem(GHOST_KEY(carId))); } catch { return null; }
}
export function saveGhost(carId, ghost) {
  try { localStorage.setItem(GHOST_KEY(carId), JSON.stringify(ghost)); return true; } catch { return false; }
}
