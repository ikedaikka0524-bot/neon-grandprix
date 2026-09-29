// static server for the balance measurements: project root, plus /__bal.* from this folder
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = 'C:/Users/Ikeda/ngp-mobile', HERE = fileURLToPath(new URL('.', import.meta.url)), PORT = +(process.argv[2] || 8212);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const mine = p.startsWith('/__bal');
  const file = mine ? join(HERE, p.slice(1)) : join(ROOT, normalize(p));
  if (!mine && !file.replaceAll('\\', '/').startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('404'); }
}).listen(PORT, '127.0.0.1', () => console.log('listening', PORT));
