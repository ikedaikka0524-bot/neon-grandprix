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
  .filter(f => f.endsWith('.js') && !SKIP.has(f.split('/')[0]))
  .sort();
writeFileSync(new URL('build.json', root), JSON.stringify({ build, files }, null, 2) + '\n');

const html = readFileSync(new URL('index.html', root), 'utf8');
const RE = /(<script type="importmap">\s*)([\s\S]*?)(\s*<\/script>)/;
const m = html.match(RE);
if (!m) throw new Error('index.html: no <script type="importmap">');
const imports = Object.fromEntries(Object.entries(JSON.parse(m[2]).imports).filter(([k]) => !k.startsWith('./')));
for (const f of files) imports[`./${f}`] = `./${f}?v=${build}`;
writeFileSync(new URL('index.html', root), html.replace(RE, (_, a, __, c) => a + JSON.stringify({ imports }, null, 2) + c));
console.log(`build ${build}: ${files.length} modules`);
