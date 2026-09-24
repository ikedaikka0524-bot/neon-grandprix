# Module contract (all agents must follow exactly)

Browser 3D racing game. Plain ES modules, no build step. Served by `python -m http.server 8000` from this folder.
UI text is **Japanese**. Code comments sparse, English.

Libraries (only these):
- three@0.169.0 via importmap in index.html:
  `"three": "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/"`
- mqtt.js 5.10.1 via `<script src="https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js"></script>` → global `mqtt`. (PeerJS/WebRTC was dropped: no working free TURN relay, joins timed out across phone/strict NATs. Do NOT reintroduce it.)

Existing, DO NOT rewrite (read them first): `data.js` (cars, abilities, passives, skill tree, gacha, economy, track, `computeStats`, `nodeCost`, `nodeBlockReason`), `save.js` (`getSave`, `persist`, `newCarRec`, `resetSave`, `loadGhost`, `saveGhost`).

## Files and owners

| File | Owner | Exports |
|---|---|---|
| index.html | UI | — (importmap, mqtt.js script tag, `<div id="menu">`, `<div id="game">`, CSS, `<script type="module" src="ui.js">`) |
| ui.js | UI | — (entry point) |
| carmodel.js | GAME | `buildCarMesh`, `preloadCarModels` |
| game.js | GAME | `startRace`, `stopRace` |
| abilities.js | ABIL | `initAbility`, `updateAbilities`, `tryActivate`, `applyRemoteAbility`, `clearAbilities` |
| ghost.js | ABIL | `createRecorder`, `createGhostPlayer` |
| net.js | NET | `hostRoom`, `joinRoom` |

## Coordinate conventions
- Y up. Meters. Car local forward = +Z. `heading` (radians, yaw): forward vector = `(sin h, 0, cos h)`; `mesh.rotation.y = heading`.
- Car length ≈ 4.2 m, wheels touch y=0 of the car group.

## carmodel.js
```js
// Returns a THREE.Group. Tries models/<carId>.glb (GLTFLoader, cached per carId, cloned per call; scaled so its
// longest horizontal side = 4.2 m, centered, bottom at y=0, then rotated by CAR.modelRot||0). On any failure
// (404 etc.) builds a procedural mesh from CAR.body ('kei','sedan','hatch','van','sports','suv','muscle','rally',
// 'formula','wedge','tank','shark','dragon','sushi' — each visibly distinct, the UR ones fun/iconic: shark fin,
// dragon horns/wings, a sushi roll with salmon on top).
// look = { body:'#hex', wheel:'#hex', wing:bool }. body color → recolor the largest-surface material of the GLB
// (clone materials first) / main body material of procedural. wheel color → procedural wheels only (GLB: skip).
// wing:true → add a procedural rear wing on top.
// opts.ghost → all materials transparent, opacity 0.35, depthWrite false.
// group.userData.wheels = array of wheel Object3Ds (procedural only; [] for GLB) for spin animation.
export async function buildCarMesh(carId, look, opts = {}) -> Promise<THREE.Group>
export async function preloadCarModels(carIds) -> Promise<void>   // warm the GLB cache, never throws
```

## game.js
```js
// Mounts into document.getElementById('game') (UI makes it visible before calling, hides after).
// Creates its own WebGLRenderer + HUD DOM inside #game; removes everything on stopRace().
export async function startRace(opts) -> void
opts = {
  mode: 'solo' | 'ghost' | 'split' | 'online',
  players: [ { name, carId, look, stats /* computeStats() result */, control: 'p1' | 'p2' | 'net', pid? } ],
    // solo/ghost: 1 player control 'p1'. split: 2 players 'p1','p2'. online: all roster players;
    // the local one has control 'p1', remote ones 'net'; each has pid (string) from the net roster.
    // Grid order = array order.
  cpuCount?: number,            // solo only (default 3). Game picks random CARS + random unlocked nodes for CPUs.
  ghost?: ghostData | null,     // ghost mode: data to replay (see ghost.js). null → no ghost car.
  net?: NetSession, localPid?: string,   // online only
  onFinish(result),             // called once when the local player(s) finished and results are known
  onQuit(),                     // player pressed Esc → confirm → quit. Game calls stopRace() itself before onQuit.
}
result = {
  mode,
  placements: [ { name, carId, time /* seconds or null=DNF */, isLocal:bool, control } ],  // sorted 1st→last
  locals: [ { control:'p1'|'p2', carId, place /*1-based*/, time, bestLap } ],
  ghostRecording: ghostData | null,   // solo & ghost modes: recording of the p1 run (only if finished)
  beatGhost: bool | null,             // ghost mode: finished faster than the ghost; else null
}
export function stopRace() -> void    // idempotent
```
Controls (KeyboardEvent.code): solo/ghost/online: WASD **or** arrows drive, `Space`/`ShiftLeft`/`ShiftRight` ability.
split: p1 = WASD + `ShiftLeft` (also `Space`); p2 = arrows + `ShiftRight` (also `Enter`/`NumpadEnter`). `Escape` = quit prompt.
Split screen = two viewports via `renderer.setScissor`/`setViewport` (top = p1, bottom = p2), each with own chase camera and HUD.

### The Race and Car objects (shared with abilities.js / ghost.js)
```js
race = {
  THREE, scene, time /* seconds since GO, 0 during countdown */, state: 'countdown'|'running'|'finished',
  mode, cars: [Car], track, net /* session or null */, localPid,
  hazards: [],                  // owned by abilities.js (oil slicks etc.); abilities.js adds/removes meshes to scene itself
  hud: { flash(text, color) }   // game shows a big center message ~1s (for "ワープ!" etc.), on all viewports
       // + layer(car) -> that car's viewport element under its HUD (full-screen tints go there), or undefined
}
track = {
  curve /* THREE.CatmullRomCurve3, closed */, length /* m */, width,
  samples: [{ pos: Vector3, tan: Vector3 (unit), t }],   // N=1200 uniform by arc length
  nearest(pos, hintIndex?) -> { index, t, point, tangent, lateral /* signed m from center, + = right of travel */, dist },
  pointAt(t) -> Vector3, tangentAt(t) -> Vector3,   // t in [0,1), arc-length param, wraps
}
Car = {
  index, name, carId, def /* CARS entry */, stats, look,
  control: 'p1'|'p2'|'cpu'|'net',     // ghosts are NOT in race.cars
  mesh: THREE.Group,
  pos: Vector3, heading: number, speed: number /* signed forward m/s */, vel: Vector3 /* world, includes drift */,
  input: { throttle: 0..1, brake: 0..1, steer: -1..1 /* + = left */, ability: bool /* edge-triggered this frame */ },
  drifting: bool, offroad: bool,
  lap /* completed laps */, progress /* lap + t, monotonic-ish, used for ordering & ghost diff */, trackIndex,
  finished: bool, finishTime: number|null, bestLap: number|null,
  // per-frame modifiers: game resets to these defaults at the START of each frame, then calls updateAbilities(),
  // then runs physics honoring them:
  mods: { speedMul: 1, accelMul: 1, gripMul: 1, noCollide: false, noOffroadPenalty: false, invulnerable: false },
  spin: 0,          // seconds of spin-out remaining (set by abilities; game applies: steering randomized, grip≈0.2, speed decays)
  ability: {...}    // owned by abilities.js
}
```
Per frame order in game: input → reset mods → `updateAbilities(race, dt)` → if `car.input.ability` and car is local/cpu → `tryActivate(race, car)` → physics/collisions (skip car-car collisions if either `noCollide`; `invulnerable` car loses no speed on collision) → track progress/laps → ghost recorder sample → net send → render.
CPU cars: follow the spline with look-ahead; use ability when gauge full (after a random 0–4 s delay).
Remote ('net') cars: no local physics; position/heading interpolated from net state (~100 ms buffer).
Physics feel: arcade. Offroad (|lateral| > width/2): speed cap ×0.55 (×0.775 with passive 'offroad'), unless `noOffroadPenalty`. Passive 'launch': accel +30% for 3 s after GO. Slipstream (stats.slipstream or passive 'draft'): within 25 m directly behind another car → +8% top (+16% with 'draft'). Drift: handbrake-free — sharp steer at speed with low grip breaks traction; `car.drifting` true while lateral slip is high.
Race length `TRACK.laps` (3). Countdown 3-2-1-GO. Lap counts only if car passed the half-way sample since last crossing. Results screen overlay is UI's job: game just calls onFinish once all local players finished (and for solo: others get estimated times from their current progress/pace; online: host decides placements, see net).

## abilities.js
```js
export function initAbility(race, car)       // sets car.ability = { id: car.stats.ability, gauge: 0 /*0..1*/, active: 0 /*s left*/, ... }
export function updateAbilities(race, dt)    // only while race.state==='running': fill gauges
  // (gauge += dt / (ABILITIES[id].fill / stats.gaugeRate); +extra while drifting if stats.driftCharge),
  // apply active effects into car.mods, tick spin, update hazards (oil hits → car.spin = power unless invulnerable), expire.
export function tryActivate(race, car) -> bool   // if gauge>=1: consume, start effect, race.hud.flash(name),
  // and if race.net && car.control==='p1': race.net.send({ t:'ability', pid: race.localPid, id, x, y, z, h })
export function applyRemoteAbility(race, msg)    // online: effects caused by a remote car (oil slick placed at x,y,z,h; timeslow affects local cars)
export function clearAbilities(race)             // remove hazard meshes
```
Effects (numbers from ABILITIES; duration×stats.abilityDuration, power×stats.abilityPower):
boost/nitro: speedMul & accelMul += power. oil: slick decal+mesh ~4 m behind the car, lives `duration` s; any other car touching it (radius 3 m) spins `power` s. shield: invulnerable (ignores collision slowdown, oil, timeslow). warp: move car forward `power` m along track center (keep lateral offset clamped inside road, set heading to tangent, keep speed), flash + particle burst. timeslow: all other cars get speedMul ×(1−power) for duration (shield ignores); only the activator is unaffected. phase: noCollide, noOffroadPenalty, speedMul += power, and make its mesh semi-transparent while active.
Show visual feedback for active effects (e.g. glow/flame for nitro, bubble for shield).
thunderbolt / magnet carry the target's pid as `tp` in the ability message. magnet: nearest car ahead by progress (>8 m, ≤150 m) → speedMul & accelMul += power until ≤8 m behind it (none ahead: +0.15 for 1 s). domain: 45 m dome following the owner; other cars inside get speedMul ×(1−min(power,0.6)) and `ability.sealed` (gauge frozen, tryActivate refuses), shield immune; each client applies it only to its own cars; owner +0.2 speed/accel.

## ghost.js
```js
ghostData = { v:1, carId, look, time /* total race seconds */, dt: 0.05, frames: [[x,y,z,h,progress], ...] } // numbers rounded to 2 decimals
export function createRecorder(car) -> { sample(race) /* call every frame; records every 0.05 s of race.time */, finish(totalTime) -> ghostData }
export async function createGhostPlayer(race, ghostData) -> {
  mesh,                         // buildCarMesh(..., {ghost:true}), already added to race.scene
  update(time),                 // interpolate frames to race time; after end, park at finish
  timeAtProgress(progress) -> seconds|null   // for HUD "ゴースト差 +0.82秒" (localTime − ghostTimeAtSameProgress)
  dispose()
}
```

## net.js
Transport = public MQTT broker (see net.js header; tested working on GitHub Pages). Room code first char selects the broker. Host is authoritative for roster/start/results; game traffic (state/ability/finish) goes to a shared topic.
```js
export async function hostRoom(name) -> NetSession
export async function joinRoom(code, name, me? /* { carId, look }, sent with hello */) -> NetSession   // rejects with Japanese message on failure/timeout (10 s)
NetSession = {
  isHost, code, pid /* own id */,
  roster: [{ pid, name, carId, look }],        // host first. Max 4 players; 5th gets {t:'full'} and is closed.
  setMe({ name, carId, look }),                 // update own roster entry (sent to host, host rebroadcasts roster)
  on(type, fn) -> off(),  send(msg),  close(),
}
```
Events (`type`): `'roster'` (roster array), `'start'` ({ t:'start', roster }), `'state'`, `'ability'`, `'finish'`, `'results'`, `'leave'` ({pid}), `'closed'` (host gone / connection lost).
Messages game sends: `{t:'state', pid, x,y,z,h, s /*speed*/, lap, p /*progress*/}` ~20 Hz; `{t:'ability', ...}`; `{t:'finish', pid, time}`.
Host-only: `session.startGame()` → broadcasts `{t:'start', roster}` (also delivered locally). Host collects `finish` messages; when all players finished or 30 s after the first finisher, broadcasts `{t:'results', placements:[{pid, time|null}]}` (sorted). Game (on every peer) builds result.placements from that. If a pid leaves mid-race, treat as DNF.
Messages include `pid` of the original sender; session never delivers a peer's own message back to it.

## ui.js / index.html
Screens (hash-less, show/hide divs): Home (coins, tickets, selected car 3D preview, buttons) → ソロ(CPU戦) / 過去の自分と対戦 / 2人対戦(画面分割) / オンライン対戦 / ガチャ / ガレージ / スキルツリー / 設定(name, reset data).
- Gacha: 1回 / 10連 with tickets or coins (GACHA). Rates by RARITY.rate, uniform car within rarity. 10連 guarantees ≥ SR in the last slot if none. New car → `save.cars[id] = newCarRec(id)`; duplicate → `dupes++` (first dupe unlocks tier 4 = "限界突破！"), further dupes → +RARITY.dupeCoins. Animation: capsule spins/shakes, bursts in rarity color, car 3D preview spins with name + rarity. 10連 → grid of results. Show rate table.
- Garage: owned cars list (rarity-colored cards, locked silhouettes for unowned), select for P1 / P2, look editor (`<input type=color>` body/wheel, wing checkbox), stats bars from computeStats, ability + passive description, live rotating 3D preview.
- Skill tree: SVG, 3 branches radiating from the car in the center, 4 nodes each, lines lit when unlocked, node states (unlocked / available / locked-with-reason tooltip), click → confirm cost → coins −= nodeCost → push node id → persist.
- Solo / ghost / split / online: build players from save (stats = computeStats(carId, rec.nodes)). Ghost mode disabled with message if `loadGhost(carId)` is null ("まずこの車でソロかゴースト戦を1回完走しよう").
- Online lobby: 部屋を作る (shows big code) / 参加する (code input). Roster list with car names. Host has スタート (≥2 players). Uses session.setMe on car change.
- On result: overlay with placements, times, rewards; apply ECONOMY (placeCoins[place-1], winTickets if 1st, firstClearTickets if stats.races was 0, bestLapBonus if new bestLap on this car, beatGhostBonus); update rec.bestLap/bestRace; save ghostRecording via saveGhost if it's faster than existing ghost (or none). persist(). Buttons: もう一度 / メニューへ.
- Stylish dark neon look, responsive, keyboard hint panel.
- Use `preloadCarModels(CARS.map(c=>c.id))` at boot (don't block UI).

---------------------------------------------------------------------------------------------------
# COURSES UPDATE (v2) — supersedes anything above about the single TRACK

`tracks.js` (exists, DO NOT change the point data; tools/check-tracks.mjs validates it): `TRACKS`, `TRACK_BY_ID`, `DEFAULT_TRACK`.
Each def: `{ id, name, desc, theme: 'forest'|'city'|'desert'|'snow'|'beach', time: 'day'|'night'|'sunset', difficulty 1..3, width, laps, grip, points }`.
Nobody may use `TRACK` from data.js any more (integration removes it). Everything is per-course.

## Files / owners (v2)
| File | Owner | Notes |
|---|---|---|
| game.js | CORE | per-course plumbing; world building moved out to world.js |
| world.js (new) | CORE | `buildWorld(ctx, def)` common parts + dispatch to a theme; also contains the **forest** theme (the current scenery, moved) |
| theme-city.js / theme-desert.js / theme-snow.js / theme-beach.js (new) | one THEME agent each | `export default { env, build }` (below) |
| ghost.js | CORE | ghostData gains `trackId` |
| ui.js, index.html, save.js, net.js | UI | course select, per-course records & ghosts, online course choice |
| carmodel.js, data.js (modelRot values only) | CARS | Meshy GLB orientation + tint QA |

## game.js (v2)
- `startRace(opts)`: new `opts.trackId` (default `DEFAULT_TRACK`). `race.def` = the TRACKS entry. `track.width/laps/grip/def` come from it.
  Barrier lateral = `def.width/2 + 9.4` (was the WALL constant). Laps from `def.laps` (HUD, lap logic, estimates). Every car's effective grip ×= `def.grip`.
- `result.trackId` added. Ghost recorder writes `trackId`.
- Calls `buildWorld(ctx, def)` from world.js; if it returns `{ update(dt, time) }` call it every frame (theme animation: waves, snowfall...).
- Night courses (`env.night`): cars get emissive head/tail lights; local player car(s) get one SpotLight headlight (shadow off). Keep total real lights ≤ 8.

## world.js
`export function buildWorld(ctx, def) -> { update(dt, time) }`. Builds, parameterised by the theme's `env`: sky dome, fog, hemi + sun (shadow camera follows the player as now), terrain (height fn + ground texture + vertex tint), road ribbon, shoulders, curbs, barrier walls (style per env), start/finish line + gantry + grid marks, and the minimap-independent `ctx.groundAt`. Then calls `theme.build(api)`.
Theme lookup: `{ forest: <inline in world.js>, city, desert, snow, beach }` via static imports of the theme files.
```js
api = {
  THREE, world /* Group to add to */, track, def, env, rnd /* seeded 0..1 */, night,
  near(x, z) -> [distToCenterline, centerlineY], groundAt(x, z) -> y,
  canvasTex(w, h, draw(g, w, h), repeat = true) -> CanvasTexture,
  isFree(x, z, r) -> bool   // true if a circle of radius r at (x,z) is outside barriers (dist >= width/2 + 12 + r) and not overlapping blockers
  block(x, z, r)            // reserve space (call for every big object you place)
  placeFacing(obj, sampleIndex, lateral) -> {x, z}   // put obj beside the track, local -Z facing the road
  onUpdate(fn(dt, time))    // per-frame animation hook
}
```
Theme module shape:
```js
export default {
  env: {
    sky: { top, horizon, bottom },                 // '#hex'
    fog: { color, near, far },
    sun: { dir: [x, y, z], color, intensity }, hemi: { sky, ground, intensity },
    exposure,                                      // renderer.toneMappingExposure
    night: bool,
    terrain: { base: '#hex', paint(g, w, h) /* 256² ground texture painter */, hills /* m */, rim /* m, mountains/dunes at the edge */, rimColor: '#hex' },
    road: { base: '#hex', line: '#hex', edge: '#hex' }, shoulder: '#hex',
    barrier: 'ads' | 'guardrail' | 'neon' | 'rock' | 'snowbank' | 'fence',
    curb: ['#hex', '#hex'],
  },
  build(api) {}   // scenery; may call api.onUpdate
}
```
Rules for themes: scenery never on or over the road (use isFree/block); budget ≤ ~150 draw calls and ≤ ~250k triangles for the whole theme (InstancedMesh / mergeGeometries); no external assets (procedural geometry + canvas textures only); nothing may block the chase camera's view along the road (keep tall things ≥ 20 m from the barrier on the inside of corners).
Themes: **city** night — skyline of lit-window towers (canvas window textures, emissive), neon signs in Japanese/English, streetlights (emissive heads; at most 4 PointLights total), elevated-road pillars where the road is raised, wet-look dark asphalt. **desert** sunset — sand dunes, red mesas/buttes, cacti, rock arches, tumbleweeds rolling (onUpdate), heat-haze-ish warm fog. **snow** day — snowy terrain, snow-covered pines, frozen lake, rocky cliffs, falling snow particles around the camera area (onUpdate, Points), snowbank barriers. **beach** day — animated ocean plane (shader waves, foam line) on the outside of the east side, sand, palm trees, beach huts/umbrellas, lighthouse, sailboats bobbing.

## save.js (v2)
- Car record: `best: { [trackId]: { lap, race } }` (migrate old `bestLap`/`bestRace` into `best.circuit`, then delete them).
- `loadGhost(carId, trackId)`, `saveGhost(carId, trackId, ghost|null)`; key `crg.ghost.<carId>.<trackId>`; old key `crg.ghost.<carId>` is read as circuit (migrate on first read).
- `save.lastTrack` (default DEFAULT_TRACK).

## net.js (v2)
- Host: `session.setTrack(id)` (ignored unless id in TRACK_BY_ID) → stores `session.trackId` and re-broadcasts roster. Roster message becomes `{ t:'roster', roster, trackId }`; `start` becomes `{ t:'start', roster, trackId }`. Guests keep `session.trackId` updated before emitting. The emitted 'roster' payload stays the roster array.

## ui.js / index.html (v2)
- Course picker (cards: SVG minimap from the course points, name, desc, theme colour, ★ difficulty, length, laps, the selected car's best lap/race on that course) in the solo / ghost / split setup screens and in the online lobby (host picks; guests see the host's choice live, read-only). Remembers `save.lastTrack`.
- Pass `trackId` to startRace. Records, rewards and ghosts are per course. Ghost mode needs a ghost for car+course.
- Coin rewards × (1 + 0.25 × (difficulty − 1)).
- Home screen shows the course count / a small "5 コース" teaser; replace the single-track info (`#trackMap`, `#trkInfo`).

## carmodel.js (v2, CARS agent)
- Verify in the browser that every `models/*.glb` car faces +Z (nose forward) with its `modelRot`; fix per-car `modelRot` in data.js if not.
- Textured GLBs: the Meshy texture already has the right colours. Default look must show the texture untinted; only when the player picks a body colour different from the car's default, tint the largest material in a way that keeps texture detail (e.g. multiply by a lightened colour or hue-shift). Verify visually for 3–4 cars.
