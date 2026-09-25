// Service worker (registered by pwa.js): offline play + installable app. Every deploy runs tools/bump-build.mjs, which
// rewrites the block below, so each build is a new sw.js: it precaches exactly that build's files, takes over at once
// (skipWaiting + clients.claim) and deletes the older build's cache.
// --- bump-build ---
const BUILD = '20260925131923';
const FILES = [
 "./",
 "build.json",
 "manifest.webmanifest",
 "mobile.css?v=20260925131923",
 "abilities.js?v=20260925131923",
 "carmodel.js?v=20260925131923",
 "data.js?v=20260925131923",
 "firebase-config.js?v=20260925131923",
 "game.js?v=20260925131923",
 "ghost.js?v=20260925131923",
 "lb.js?v=20260925131923",
 "net.js?v=20260925131923",
 "netpredict.js?v=20260925131923",
 "p2p.js?v=20260925131923",
 "pwa.js?v=20260925131923",
 "save.js?v=20260925131923",
 "scenery/albertpark.js?v=20260925131923",
 "scenery/bahrain.js?v=20260925131923",
 "scenery/catalunya.js?v=20260925131923",
 "scenery/hockenheim.js?v=20260925131923",
 "scenery/hungaroring.js?v=20260925131923",
 "scenery/interlagos.js?v=20260925131923",
 "scenery/istanbul.js?v=20260925131923",
 "scenery/marinabay.js?v=20260925131923",
 "scenery/monaco.js?v=20260925131923",
 "scenery/montreal.js?v=20260925131923",
 "scenery/monza.js?v=20260925131923",
 "scenery/nring.js?v=20260925131923",
 "scenery/sepang.js?v=20260925131923",
 "scenery/shanghai.js?v=20260925131923",
 "scenery/silverstone.js?v=20260925131923",
 "scenery/spa.js?v=20260925131923",
 "scenery/suzuka.js?v=20260925131923",
 "scenery/yasmarina.js?v=20260925131923",
 "sync.js?v=20260925131923",
 "theme-beach.js?v=20260925131923",
 "theme-city.js?v=20260925131923",
 "theme-desert.js?v=20260925131923",
 "theme-snow.js?v=20260925131923",
 "tokyo-dimension.js?v=20260925131923",
 "touch.js?v=20260925131923",
 "tracks.js?v=20260925131923",
 "ui.js?v=20260925131923",
 "version.js?v=20260925131923",
 "world.js?v=20260925131923"
];
const CDN = [
 "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
 "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/environments/RoomEnvironment.js",
 "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/geometries/RoundedBoxGeometry.js",
 "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js",
 "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/utils/BufferGeometryUtils.js",
 "https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js",
 "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js",
 "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js",
 "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"
];
// --- /bump-build ---

const SHELL = `ngp-${BUILD}`, LIBS = 'ngp-cdn', ASSETS = 'ngp-assets';
// versioned CDN URLs never change: three@x.y.z, mqtt@x.y.z, firebasejs/x.y.z (cross-origin, only these and the fonts
// stylesheet are touched)
const PINNED = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/[^/]+@\d[^/]*\/|www\.gstatic\.com\/firebasejs\/\d)/;
// files whose content names the build: a CDN edge still serving the previous deploy fails the install (retried on the
// next visit) instead of caching an old page under the new build
const MUST = ['./', 'build.json', `version.js?v=${BUILD}`];

self.addEventListener('install', e => e.waitUntil((async () => {
  const res = await Promise.all(FILES.map(f => fetch(f, { cache: 'no-cache' })));
  await Promise.all(res.map(async (r, i) => {
    if (!r.ok) throw new Error(`${FILES[i]}: ${r.status}`);
    if (MUST.includes(FILES[i]) && !(await r.clone().text()).includes(BUILD)) throw new Error(`${FILES[i]}: not build ${BUILD}`);
  }));
  const c = await caches.open(SHELL);
  await Promise.all(res.map((r, i) => c.put(FILES[i], r)));
  // libraries: best effort (a blocked gstatic must not keep the game from working offline); cached on use otherwise
  const lib = await caches.open(LIBS);
  await Promise.allSettled(CDN.map(async u => (await lib.match(u)) || lib.put(u, await cors(u))));
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (/^ngp-\d+$/.test(k) && k !== SHELL) await caches.delete(k);
  const lib = await caches.open(LIBS);
  for (const r of await lib.keys()) if (!CDN.includes(r.url)) await lib.delete(r);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (PINNED.test(req.url)) e.respondWith(cacheFirst(req, LIBS));
    // the Google Fonts stylesheet blocks the first paint (a hanging request on a weak signal = a black screen): the last
    // copy at once, refreshed behind it. The font files it names stay with the browser's HTTP cache.
    else if (url.host === 'fonts.googleapis.com') e.respondWith(staleWhileRevalidate(e, true));
    return;   // Firebase, MQTT, font files, emulators...: never intercepted
  }
  const v = url.searchParams.get('v');
  if (v) {
    // another build's file (a tab still running an older build): straight to the network, not cached
    if (v === BUILD) e.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (/\.(glb|png|svg)$/.test(url.pathname)) e.respondWith(staleWhileRevalidate(e));
  else e.respondWith(networkFirst(req));
});

// CORS fetch for CDN files: a no-cors <script src> would give an opaque response (padded to MBs of quota)
const cors = async u => {
  const r = await fetch(u, { mode: 'cors', credentials: 'omit' });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r;
};

const ANY = { ignoreVary: true };
async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req, ANY);
  if (hit) return hit;
  const r = name === LIBS ? await cors(req.url) : await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}

// index.html, build.json, version.js, the manifest, ?retry= module imports: the network decides (so the version check
// sees a new deploy); offline, this build's copy. Nothing is written here: the cache only holds what install fetched.
function networkFirst(req) {
  const page = req.mode === 'navigate' || /\/(index\.html)?$/.test(new URL(req.url).pathname);
  const cached = () => caches.match(page ? './' : req, { cacheName: SHELL, ignoreSearch: true, ignoreVary: true });
  const net = fetch(req).catch(async () => (await cached()) || Response.error());
  if (req.mode !== 'navigate') return net;
  // opening the app on a bad signal: after 4 s this build's copy starts it
  return Promise.race([net, new Promise(r => setTimeout(r, 4000)).then(cached).then(c => c || net)]);
}

// car models, icons, the fonts stylesheet (cross = CORS, see cors above)
async function staleWhileRevalidate(e, cross = false) {
  const c = await caches.open(ASSETS), hit = await c.match(e.request, ANY);
  const net = (cross ? cors(e.request.url) : fetch(e.request)).then(r => { if (r.ok) e.waitUntil(c.put(e.request, r.clone())); return r; });
  if (!hit) return net;
  e.waitUntil(net.catch(() => {}));
  return hit;
}
