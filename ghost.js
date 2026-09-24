// Ghost recording (fixed 0.05 s frames) and replay.
import { buildCarMesh } from './carmodel.js';

const DT = 0.05;
const r2 = v => Math.round(v * 100) / 100;
const r4 = v => Math.round(v * 1e4) / 1e4;   // progress: 2 decimals = 13 m steps, too coarse for the HUD diff
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const cr = (p0, p1, p2, p3, t) =>   // uniform Catmull-Rom
  0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);

export function createRecorder(car, trackId) {
  const frames = [];
  let next = 0, prev = null, done = false;
  const pose = () => [car.pos.x, car.pos.y, car.pos.z, car.heading, car.progress];
  return {
    sample(race) {
      if (done) return;
      const t = race.time, cur = pose();
      // one frame per 0.05 s slot, interpolated between this and the previous call (survives frame hitches)
      while (t >= next) {
        const k = prev && t > prev.t ? Math.min(1, (next - prev.t) / (t - prev.t)) : 1;
        frames.push(cur.map((v, i) => {
          const a = prev ? prev.v[i] : v;
          const x = i === 3 ? a + wrap(v - a) * k : a + (v - a) * k;
          return i === 4 ? r4(x) : r2(x);
        }));
        next = frames.length * DT;
      }
      prev = { t, v: cur };
      if (car.finished) done = true;
    },
    finish(totalTime) {
      // end on the finish-line pose: the last 0.05 s slot can predate the crossing (or a warp over the line),
      // leaving the ghost's final progress short of the line and the HUD diff blank there
      const end = pose().map((v, i) => (i === 4 ? r4(v) : r2(v)));
      if (!frames.length || frames[frames.length - 1][4] < end[4]) frames.push(end);
      return { v: 1, trackId, carId: car.carId, look: { ...car.look }, time: Math.round(totalTime * 1000) / 1000, dt: DT, frames };
    },
  };
}

// Pure replay math (no THREE / DOM).
function ghostTrack(ghostData) {
  const F = (ghostData?.frames || []).filter(f => Array.isArray(f) && f.length >= 5 && f.every(Number.isFinite));
  const dt = ghostData?.dt > 0 ? ghostData.dt : DT;
  const P = new Float64Array(F.length);   // running max: progress may dip slightly when reversing
  F.forEach((f, i) => { P[i] = i ? Math.max(P[i - 1], f[4]) : f[4]; });
  return {
    frames: F,
    // [x, y, z, heading] at race time; parks on the last frame after the end
    poseAt(time) {
      const n = F.length;
      if (!n) return null;
      const x = Math.max(0, time / dt), i = Math.min(Math.floor(x), n - 1), t = i < n - 1 ? x - i : 0;
      const f0 = F[Math.max(0, i - 1)], f1 = F[i], f2 = F[Math.min(n - 1, i + 1)], f3 = F[Math.min(n - 1, i + 2)];
      const h1 = f1[3], h0 = h1 + wrap(f0[3] - h1), h2 = h1 + wrap(f2[3] - h1), h3 = h2 + wrap(f3[3] - f2[3]);
      return [cr(f0[0], f1[0], f2[0], f3[0], t), cr(f0[1], f1[1], f2[1], f3[1], t), cr(f0[2], f1[2], f2[2], f3[2], t), cr(h0, h1, h2, h3, t)];
    },
    // first time the ghost reached `progress`, or null if never / before start
    timeAtProgress(progress) {
      const n = P.length;
      if (!n || !(progress >= P[0]) || progress > P[n - 1]) return null;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (P[mid] >= progress) hi = mid; else lo = mid + 1;
      }
      if (!lo) return 0;
      const a = P[lo - 1], b = P[lo];
      return (lo - 1 + (b > a ? (progress - a) / (b - a) : 1)) * dt;
    },
  };
}

function nameTag(THREE, name) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '800 64px system-ui, sans-serif';
  const w = Math.min(496, g.measureText(name).width + 56);
  g.fillStyle = 'rgba(8,12,30,0.72)';
  g.beginPath(); (g.roundRect || g.rect).call(g, 256 - w / 2, 16, w, 96, 48); g.fill();   // roundRect: 2023+ browsers
  g.fillStyle = '#e6ecff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 256, 66, 440);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(6, 1.5, 1);
  s.position.y = 3;
  return s;
}

export async function createGhostPlayer(race, ghostData) {
  const track = ghostTrack(ghostData);
  const mesh = await buildCarMesh(ghostData.carId, ghostData.look || {}, { ghost: true });
  mesh.traverse(o => { o.castShadow = false; });
  mesh.visible = track.frames.length > 0;
  if (ghostData.name) mesh.add(nameTag(race.THREE, ghostData.name));   // ranking ghost (lb.js): whose run it is
  race.scene.add(mesh);
  const wheels = mesh.userData.wheels || [];
  let last = null;
  const player = {
    mesh,
    update(time) {
      const p = track.poseAt(time);
      if (!p) return;
      mesh.position.set(p[0], p[1], p[2]);
      mesh.rotation.y = p[3];
      if (last) {
        const d = Math.hypot(p[0] - last[0], p[2] - last[2]);
        for (const w of wheels) w.rotation.x += d / 0.34;
      }
      last = p;
    },
    timeAtProgress: track.timeAtProgress,
    dispose() { mesh.removeFromParent(); },
  };
  player.update(0);
  return player;
}
