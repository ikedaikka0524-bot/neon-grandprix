# Balance harness (dev only, not deployed)

Headless-Chrome tools used for the v8–v10 ability balance passes (see CONTRACT.md "Balance" sections).

- `server.mjs` — small static server for the repo root.
- `__bal.html` / `__bal.js` — test page that imports game.js directly, steps races at a fixed dt with rendering off, and applies page-side overrides (car stats, ability knobs, CPU level) so data.js/abilities.js never need editing to try a value.
- `run.mjs` — drives Chrome over CDP: per-use net value (one ability use vs the identical run without it) and mixed 4-UR oni races; writes `.jsonl` results.
- `sum.mjs`, `lbsum.mjs`, `anA.mjs` — summaries (win %, per-minute value, leaderboard best laps).
- `lbbound.mjs`, `racefloor.mjs` — leaderboard floor checks against tools/gen-rules.mjs.

Paths and ports inside the scripts come from the original machine; adjust them before use. Always set localStorage `ngp.lb.emu = '1'` so nothing reaches the production Firebase.
