// node tools/bump-build.mjs — run before EVERY deploy. Writes a new build id to build.json + version.js and pins every
// local module in index.html's import map to ?v=<id>. GitHub Pages lets browsers cache files for 10 min and a normal
// reload doesn't refetch ES modules, so without this players keep (or mix) old modules after a deploy.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const build = new Date().toISOString().replace(/\D/g, '').slice(0, 14);   // UTC yyyymmddhhmmss, sorts by age
writeFileSync(new URL('version.js', root), `// Written by tools/bump-build.mjs (must match build.json). Do not edit by hand.\nexport const BUILD = '${build}';\n`);
const SKIP = new Set(['tools', 'models', 'node_modules', '.git', '.claude']);
const files = readdirSync(root, { recursive: true })
  .map(f => String(f).replace(/\\/g, '/'))
  .filter(f => f.endsWith('.js') && !SKIP.has(f.split('/')[0]) && f !== 'sw.js')   // sw.js: the service worker, not a page module
  .sort();
writeFileSync(new URL('build.json', root), JSON.stringify({ build, files }, null, 2) + '\n');

const html = readFileSync(new URL('index.html', root), 'utf8');
const RE = /(<script type="importmap">\s*)([\s\S]*?)(\s*<\/script>)/;
const m = html.match(RE);
if (!m) throw new Error('index.html: no <script type="importmap">');
const imports = Object.fromEntries(Object.entries(JSON.parse(m[2]).imports).filter(([k]) => !k.startsWith('./')));
for (const f of files) imports[`./${f}`] = `./${f}?v=${build}`;
// local stylesheets (mobile.css) get ?v= too: sw.js then serves them cache-first like the modules, so a weak signal
// can't hold the first paint on a render-blocking network request, and a new build never pairs with an old copy
const css = [];
writeFileSync(new URL('index.html', root), html.replace(RE, (_, a, __, c) => a + JSON.stringify({ imports }, null, 2) + c)
  .replace(/(<link rel="stylesheet" href=")(?!https?:)([^"?]+\.css)(?:\?v=\d+)?"/g, (_, a, f) => { css.push(f); return `${a}${f}?v=${build}"`; }));

// sw.js precaches this build: the app shell + every module above, and the pinned CDN libraries the modules use
// (three + the addons imported anywhere, <script src> libs in index.html, the Firebase SDK files lb.js imports)
const src = files.map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
const addons = [...new Set([...src.matchAll(/['"]three\/addons\/([^'"]+)['"]/g)].map(m => m[1]))].sort();
const lb = readFileSync(new URL('lb.js', root), 'utf8');
const sdk = lb.match(/const SDK = '([^']+)'/)?.[1], fbMods = lb.match(/\[([^\]]*)\]\.map\(m => `\$\{SDK\}firebase-\$\{m\}\.js`\)/)?.[1].match(/\w+/g);
if (!sdk || !fbMods) console.warn('bump-build: Firebase SDK files not found in lb.js; sw.js caches them on first use instead');
const cdn = [
  imports.three,
  ...addons.map(a => imports['three/addons/'] + a),
  ...[...html.matchAll(/<script src="(https:\/\/[^"]+)"/g)].map(m => m[1]),
  ...(sdk && fbMods ? fbMods.map(m => `${sdk}firebase-${m}.js`) : []),
];
const shell = ['./', 'build.json', 'manifest.webmanifest', ...[...css, ...files].map(f => `${f}?v=${build}`)];
const SW = /(\/\/ --- bump-build ---\n)[\s\S]*?(\/\/ --- \/bump-build ---)/;
const sw = readFileSync(new URL('sw.js', root), 'utf8');
if (!SW.test(sw)) throw new Error('sw.js: no "// --- bump-build ---" block');
writeFileSync(new URL('sw.js', root), sw.replace(SW, (_, a, b) =>
  `${a}const BUILD = '${build}';\nconst FILES = ${JSON.stringify(shell, null, 1)};\nconst CDN = ${JSON.stringify(cdn, null, 1)};\n${b}`));
console.log(`build ${build}: ${files.length} modules, sw.js ${shell.length} files + ${cdn.length} CDN`);
