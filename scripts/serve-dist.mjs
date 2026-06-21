// Minimal static server for previewing `dist` at a deployment base path.
//
// Usage:
//   node scripts/serve-dist.mjs --port 4173 --base /alchemists-descent/
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(valueAfter('--port', process.env.PORT ?? 4173));
const host = valueAfter('--host', process.env.HOST ?? '127.0.0.1');
const distRoot = resolve(valueAfter('--root', 'dist'));
let base = valueAfter('--base', '/');
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
]);

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type });
  res.end(body);
}

function fileForUrl(url) {
  const parsed = new URL(url, `http://${host}:${port}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/' && base !== '/') {
    return { redirect: base };
  }
  if (base !== '/') {
    if (!pathname.startsWith(base)) return null;
    pathname = `/${pathname.slice(base.length)}`;
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const relative = normalize(pathname.replace(/^\/+/, ''));
  if (relative.startsWith('..') || relative.includes(`${sep}..${sep}`)) return null;
  const file = resolve(join(distRoot, relative));
  if (!file.startsWith(distRoot + sep) && file !== distRoot) return null;
  return { file };
}

const server = createServer((req, res) => {
  const resolved = fileForUrl(req.url ?? '/');
  if (!resolved) {
    send(res, 404, 'Not found');
    return;
  }
  if (resolved.redirect) {
    res.writeHead(302, { location: resolved.redirect });
    res.end();
    return;
  }
  const file = resolved.file;
  if (!existsSync(file) || !statSync(file).isFile()) {
    send(res, 404, 'Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': contentTypes.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Serving ${distRoot} at http://${host}:${port}${base}`);
});
