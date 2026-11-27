// Membuat data/bmkg-ports.json: daftar pelabuhan prakiraan cuaca BMKG (kode, nama, koordinat)
// dari halaman publik https://www.bmkg.go.id/cuaca/maritim/pelabuhan (domain publik, tanpa proteksi).
// Dipakai untuk tautan "prakiraan pelabuhan BMKG terdekat". Jalankan ulang bila daftar pelabuhan berubah:
//   node scripts/update-bmkg-ports.js
// Tidak menyentuh maritim.bmkg.go.id / peta-maritim.bmkg.go.id (diproteksi Cloudflare).
const fs = require('node:fs');
const path = require('node:path');

const URL_ = 'https://www.bmkg.go.id/cuaca/maritim/pelabuhan';
const OUT = path.join(__dirname, '..', 'data', 'bmkg-ports.json');

function parse(html) {
  const m = html.match(/id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Struktur halaman BMKG berubah: __NUXT_DATA__ tidak ditemukan.');
  const d = JSON.parse(m[1]);
  const seen = new Map();
  for (const x of d) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    if (!['code', 'name', 'lat', 'lon'].every(k => k in x)) continue;
    const c = d[x.code], n = d[x.name], la = d[x.lat], lo = d[x.lon];
    if (typeof c !== 'string' || !/^[A-Z]{2}\d{3}$/.test(c) || !Number.isFinite(la) || !Number.isFinite(lo)) continue;
    if (la < -15 || la > 10 || lo < 90 || lo > 145) continue;
    seen.set(c, { c, n: String(n).replace(/^Pelabuhan\s+/i, ''), la: Math.round(la * 1e4) / 1e4, lo: Math.round(lo * 1e4) / 1e4 });
  }
  return [...seen.values()].sort((a, b) => a.c.localeCompare(b.c));
}

async function main() {
  const r = await fetch(URL_, { headers: { 'User-Agent': 'sigap-laut/0.3 (port list)' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ports = parse(await r.text());
  if (ports.length < 300) throw new Error('Hanya ' + ports.length + ' pelabuhan terbaca; batal menimpa file.');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: URL_, fetchedAt: new Date().toISOString(), count: ports.length, ports }) + '\n');
  console.log(`${ports.length} pelabuhan ditulis ke ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { parse };
