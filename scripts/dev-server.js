// Server lokal sederhana yang meniru Vercel: file statis + fungsi di api/*.js.
// Untuk menguji perubahan sebelum deploy:  node scripts/dev-server.js  (port 3000, atau PORT=...)
// Di lingkungan dengan proxy HTTPS (mis. cloud Claude), jalankan dengan NODE_USE_ENV_PROXY=1.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PORT = +process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PUBLIC = /^\/(index\.html|manifest\.json|sw\.js|lib\/[\w.-]+\.js|data\/[\w.-]+\.json|icons\/[\w.-]+\.png)$/;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const api = u.pathname.match(/^\/api\/([\w-]+)$/);
  if (api && fs.existsSync(path.join(ROOT, 'api', api[1] + '.js'))) {
    const fn = require(path.join(ROOT, 'api', api[1] + '.js'));
    const shim = Object.assign(res, {
      status(c) { res.statusCode = c; return shim; },
      json(b) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(b)); return shim; }
    });
    // FORECAST_PROXY=https://sigap-laut.vercel.app: ambil /api/forecast dari situs live (data nyata yang sama)
    // bila Open-Meteo menolak IP mesin ini (HTTP 429). Hanya untuk pengujian lokal.
    if (api[1] === 'forecast' && process.env.FORECAST_PROXY) {
      const up = await fetch(process.env.FORECAST_PROXY.replace(/\/$/, '') + u.pathname + u.search).catch(e => ({ ok: false, status: 502, text: async () => JSON.stringify({ error: String(e) }) }));
      res.statusCode = up.status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Connection', 'close');
      return res.end(await up.text());
    }
    req.query = Object.fromEntries(u.searchParams);
    res.setHeader('Connection', 'close');   // hindari percobaan ulang browser pada koneksi keep-alive yang basi
    try { await fn(req, shim); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    return;
  }
  const p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (!PUBLIC.test(p)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(p)] || 'application/octet-stream');
  fs.createReadStream(path.join(ROOT, p)).on('error', () => { res.statusCode = 404; res.end('not found'); }).pipe(res);
}).listen(PORT, () => console.log('SIGAP LAUT lokal: http://localhost:' + PORT));
