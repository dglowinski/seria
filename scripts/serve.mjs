// Tiny static server for local use and tests: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

// Tests can pretend a new release came out: the offline worker is then served under another version name.
let swVersion = null;
export const setSwVersion = (name) => { swVersion = name; };

export function startServer(port = PORT) {
  return new Promise((ready) => {
    const server = createServer(handle).listen(port, '127.0.0.1', () => ready(server));
  });
}

async function handle(req, res) {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end('Forbidden'); return; }
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    let body = await readFile(file);
    if (swVersion && path === '/sw.js') body = Buffer.from(String(body).replace(/const VERSION = '[^']*';/, `const VERSION = '${swVersion}';`));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().then(() => console.log(`Seria on http://127.0.0.1:${PORT}`));
}
