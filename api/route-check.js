// Penyaring bahaya kedangkalan & lintasan daratan di sepanjang rute (data lokal, tanpa panggilan ke luar:
// koordinat rute tidak dikirim ke layanan lain).
// GET /api/route-check?lat=..,..&lon=..,..&draft=3.5&ukc=1.2   (waypoint, maks. 100; ukc opsional)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const D = require('../lib/depth.js');

let GRID = null, META = null;
function grid() {
  if (!GRID) {
    const dir = path.join(__dirname, '..', 'data');
    META = JSON.parse(fs.readFileSync(path.join(dir, 'depth-30s.json'), 'utf8'));
    GRID = D.makeGrid(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'depth-30s.bin.gz')))), META);
  }
  return GRID;
}

module.exports = async (req, res) => {
  try {
    const lat = String(req.query.lat || '').split(',').filter(Boolean).map(Number);
    const lon = String(req.query.lon || '').split(',').filter(Boolean).map(Number);
    const num = k => req.query[k] == null || req.query[k] === '' ? null : Number(req.query[k]);
    const draft = num('draft'), ukc = num('ukc');
    const bad = lat.length < 2 || lat.length !== lon.length || lat.length > 100 ||
      lat.some(v => !Number.isFinite(v) || v < -20 || v > 15) || lon.some(v => !Number.isFinite(v) || v < 85 || v > 150) ||
      (draft !== null && !(draft > 0 && draft <= 25)) || (ukc !== null && !(ukc > 0 && ukc <= 10));
    if (bad) return res.status(400).json({ error: 'Parameter tidak valid (2–100 waypoint di wilayah Indonesia, sarat 0–25 m).' });
    const g = grid();
    const r = D.assess(lat.map((v, i) => [v, lon[i]]), g, draft, ukc);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).json(Object.assign({
      source: 'ETOPO 2022 (NOAA NCEI), grid ±925 m, nilai terdangkal per sel, datum ±MSL',
      gridBuilt: META.built, notForNavigation: true
    }, r));
  } catch (e) {
    return res.status(500).json({ error: 'Pemeriksaan kedalaman gagal.', detail: String(e).slice(0, 200) });
  }
};
