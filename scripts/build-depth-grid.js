// Membangun data/depth-30s.bin.gz: grid kedalaman laut perairan Indonesia untuk peringatan kedangkalan.
// Sumber: NOAA NCEI ETOPO 2022 v1, 15 detik busur (domain publik), via ERDDAP CoastWatch.
// Setiap sel 30" (±925 m) menyimpan nilai TERDANGKAL dari 4 sel 15" di dalamnya (konservatif: beting tidak terhapus).
// Format: Uint8 per sel, baris dari selatan ke utara, kolom dari barat ke timur.
//   0 = daratan / kering (z >= 0); 1..254 = kedalaman dalam meter (dibulatkan ke bawah); 255 = lebih dalam dari 254 m.
// BUKAN untuk navigasi: hanya penyaring kasar; peta laut resmi Pushidrosal tetap rujukan.
// Jalankan: NODE_USE_ENV_PROXY=1 node scripts/build-depth-grid.js   (±200 MB diunduh, beberapa menit)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SRC = 'https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.dods';
const BOX = { lat0: -11.5, lat1: 6.5, lon0: 95, lon1: 141 };
const RES = 120;            // sel per derajat (30")
const TILE = 2;             // derajat per permintaan
const OUT = path.join(__dirname, '..', 'data');

function parseDods(buf) {
  const i = buf.indexOf('\nData:\n') + 7;
  if (i < 7) throw new Error('respons bukan DODS: ' + buf.slice(0, 200).toString());
  const dv = new DataView(buf.buffer, buf.byteOffset + i);
  const n = dv.getUint32(0);
  const z = new Float32Array(n);
  for (let k = 0; k < n; k++) z[k] = dv.getFloat32(8 + 4 * k);
  let o = 8 + 4 * n;
  const nLat = dv.getUint32(o); o += 8;
  const lat = []; for (let k = 0; k < nLat; k++) { lat.push(dv.getFloat64(o)); o += 8; }
  const nLon = dv.getUint32(o); o += 8;
  const lon = []; for (let k = 0; k < nLon; k++) { lon.push(dv.getFloat64(o)); o += 8; }
  if (nLat * nLon !== n) throw new Error('ukuran grid tidak cocok');
  return { z, lat, lon };
}

async function getTile(la, lo, tries = 4) {
  const e = 1 / 480;  // setengah sel 15": ambil pusat sel di dalam kotak
  const url = `${SRC}?z%5B(${(la + e).toFixed(6)}):1:(${(la + TILE - e).toFixed(6)})%5D%5B(${(lo + e).toFixed(6)}):1:(${(lo + TILE - e).toFixed(6)})%5D`;
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return parseDods(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      if (t >= tries) throw new Error(`tile ${la},${lo}: ${err.message}`);
      await new Promise(res => setTimeout(res, 2000 * t));
    }
  }
}

async function main() {
  const nlat = Math.round((BOX.lat1 - BOX.lat0) * RES), nlon = Math.round((BOX.lon1 - BOX.lon0) * RES);
  const grid = new Uint8Array(nlat * nlon).fill(255);
  const seen = new Uint8Array(nlat * nlon);
  const tiles = [];
  for (let la = BOX.lat0; la < BOX.lat1; la += TILE) for (let lo = BOX.lon0; lo < BOX.lon1; lo += TILE) tiles.push([la, lo]);
  let done = 0;
  const worker = async () => {
    for (;;) {
      const t = tiles.shift(); if (!t) return;
      const { z, lat, lon } = await getTile(t[0], t[1]);
      lat.forEach((y, a) => {
        const i = Math.floor((y - BOX.lat0) * RES); if (i < 0 || i >= nlat) return;
        lon.forEach((x, b) => {
          const j = Math.floor((x - BOX.lon0) * RES); if (j < 0 || j >= nlon) return;
          const v = z[a * lon.length + b];
          const u = !Number.isFinite(v) ? 255 : v >= 0 ? 0 : -v >= 254 ? 255 : Math.max(1, Math.floor(-v));
          const k = i * nlon + j;
          if (u < grid[k]) grid[k] = u;   // terdangkal menang
          seen[k] = 1;
        });
      });
      if (++done % 10 === 0) console.log(`${done} tile selesai`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const missing = seen.reduce((n, s) => n + (s ? 0 : 1), 0);
  if (missing) throw new Error(missing + ' sel tidak terisi; batal menulis.');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'depth-30s.bin.gz'), zlib.gzipSync(Buffer.from(grid), { level: 9 }));
  const meta = { source: 'NOAA NCEI ETOPO 2022 v1 15 arc-second (ETOPO_2022_v1_15s, CoastWatch ERDDAP), public domain',
    method: 'shallowest of 2x2 15" cells per 30" cell; 0 = land/drying, 1..254 = depth m (floored), 255 = deeper than 254 m; datum ~MSL',
    lat0: BOX.lat0, lon0: BOX.lon0, res: RES, nlat, nlon, built: new Date().toISOString(),
    warning: 'Not for navigation. Coarse global grid; ports and narrow channels are not resolved.' };
  fs.writeFileSync(path.join(OUT, 'depth-30s.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`selesai: ${nlat}×${nlon} sel`);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { parseDods };
