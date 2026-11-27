// Prakiraan per titik rute dari data terbuka (via Open-Meteo, CC BY 4.0):
// gelombang: ECMWF WAM, NOAA GFS-Wave, Meteo-France MFWAM (+ best match untuk swell/periode/arus)
// angin: ECMWF IFS, NOAA GFS, DWD ICON. Nilai yang dipakai aplikasi: maksimum antarmodel (konservatif).
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
const CMGRID = require('../lib/cmgrid.js');
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const WX = 'https://api.open-meteo.com/v1/forecast';
const WAVE = { ecmwf_wam025: 'ECMWF WAM', ncep_gfswave025: 'NOAA GFS-Wave', meteofrance_wave: 'Météo-France MFWAM' };
const WIND = { ecmwf_ifs025: 'ECMWF IFS', gfs_seamless: 'NOAA GFS', icon_seamless: 'DWD ICON' };
const MAX_POINTS = 150;
// Cadangan angin bila model angin Open-Meteo gagal (mis. kuota habis): MET Norway Locationforecast (CC BY 4.0).
// Syarat MET: User-Agent mengenali aplikasi (tanpa data pribadi), < 20 permintaan/detik.
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const MET_UA = 'sigap-laut/0.4 https://sigap-laut.vercel.app';
const MET_LABEL = 'MET Norway (cadangan)';

// Angin per jam (knot) dari MET Norway untuk satu titik, dipetakan ke jam t (unix detik).
// Jam yang ada di data MET dipakai langsung; di antara dua jam (data per 6 jam setelah ±60 jam) dipakai
// nilai TERBESAR dari keduanya (konservatif, tanpa interpolasi); di luar jangkauan = null.
async function metWindAt(lat, lon, t) {
  const r = await fetch(`${MET}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { headers: { 'User-Agent': MET_UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('MET ' + r.status);
  const j = await r.json();
  const ser = (j.properties && j.properties.timeseries || [])
    .map(x => [Date.parse(x.time) / 1000, x.data && x.data.instant && x.data.instant.details && x.data.instant.details.wind_speed])
    .filter(([s, v]) => Number.isFinite(s) && Number.isFinite(v)).map(([s, v]) => [s, v * 1.94384]);
  const out = [];
  let k = 0;
  for (const time of t) {
    while (k < ser.length - 1 && ser[k + 1][0] <= time) k++;
    if (!ser.length || time < ser[0][0] || time > ser[ser.length - 1][0]) { out.push(null); continue; }
    if (ser[k][0] === time) { out.push(ser[k][1]); continue; }
    const nx = ser[k + 1];
    out.push(nx && nx[0] - ser[k][0] <= 6 * 3600 ? Math.max(ser[k][1], nx[1]) : null);
  }
  return out;
}
// Stormglass (opsional, berbayar per titik): aktif hanya bila STORMGLASS_API_KEY diisi di server.
// Dipakai sebagai pembanding di sejumlah titik (STORMGLASS_MAX_POINTS, bawaan 10) yang tersebar rata,
// selalu termasuk titik pertama & terakhir. Nilai digabung konservatif: hanya bisa MENAIKKAN nilai maksimum.
// Catatan: koordinat titik itu dikirim ke Stormglass (layanan luar), jadi matikan untuk rute operasional.
const SG = 'https://api.stormglass.io/v2/weather/point';
const SG_PARAMS = 'waveHeight,windSpeed,gust,currentSpeed';
function pickEven(n, max) {
  if (n <= max) return [...Array(n).keys()];
  const out = new Set([0, n - 1]);
  for (let k = 1; out.size < max && k < max - 1; k++) out.add(Math.round(k * (n - 1) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}
const maxOf = o => { const v = Object.values(o || {}).filter(Number.isFinite); return v.length ? Math.max(...v) : null; };
async function stormglass(coords, t) {
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) return null;
  const max = Math.max(1, Math.min(50, parseInt(process.env.STORMGLASS_MAX_POINTS, 10) || 10));
  const idx = pickEven(coords.length, max), res = new Array(coords.length).fill(null);
  let error = null;
  await Promise.all(idx.map(async i => {
    try {
      const [la, lo] = coords[i];
      const r = await fetch(`${SG}?lat=${la}&lng=${lo}&params=${SG_PARAMS}&start=${t[0]}&end=${t[t.length - 1]}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('Stormglass ' + r.status + (r.status === 402 || r.status === 429 ? ' (kuota habis)' : ''));
      const j = await r.json(), m = new Map();
      (j.hours || []).forEach(h => m.set(Math.round(Date.parse(h.time) / 1000), {
        hs: maxOf(h.waveHeight), w: maxOf(h.windSpeed) == null ? null : maxOf(h.windSpeed) * 1.94384,
        g: maxOf(h.gust) == null ? null : maxOf(h.gust) * 1.94384, cur: maxOf(h.currentSpeed) == null ? null : maxOf(h.currentSpeed) * 1.94384
      }));
      res[i] = t.map(time => m.get(time) || null);
    } catch (e) { error = error || String(e.message || e); }
  }));
  const used = res.filter(Boolean).length;
  return { res, requested: idx.length, used, error };
}

async function metWind(coords, t) {
  const res = new Array(coords.length).fill(null);
  let i = 0;
  const worker = async () => { while (i < coords.length) { const k = i++; try { res[k] = await metWindAt(coords[k][0], coords[k][1], t); } catch (e) { res[k] = null; } } };
  await Promise.all(Array.from({ length: Math.min(6, coords.length) }, worker));
  return res;
}

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}
const rnd = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 100) / 100;
const rnd4 = v => Math.round(v * 1e4) / 1e4;

// Grid prakiraan resmi Copernicus Marine (gelombang & arus+pasut), bila sudah di-ingest oleh worker.
// Dibaca dari berkas lokal di server: tidak ada panggilan ke luar, koordinat rute tidak dikirim.
const CM_CACHE = new Map();   // per direktori; TTL 10 menit agar grid baru hasil ingest terpakai
function copernicusGrid() {
  const dir = process.env.CMGRID_DIR || path.join(__dirname, '..', 'data');
  const hit = CM_CACHE.get(dir);
  if (hit && Date.now() - hit.at < 600e3) return hit.g;
  let g = null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'cmgrid.json'), 'utf8'));
    const buf = new Float32Array(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'cmgrid.bin.gz')))).buffer);
    g = CMGRID.load(meta, buf);
  } catch (e) { g = null; }   // belum ada grid = fitur mati, bukan galat
  CM_CACHE.set(dir, { g, at: Date.now() });
  return g;
}

module.exports = async (req, res) => {
  try {
    const lat = String(req.query.lat || '').split(',').filter(Boolean).map(Number);
    const lon = String(req.query.lon || '').split(',').filter(Boolean).map(Number);
    const bad =
      !lat.length || lat.length !== lon.length || lat.length > MAX_POINTS ||
      lat.some(v => !Number.isFinite(v) || v < -20 || v > 15) ||
      lon.some(v => !Number.isFinite(v) || v < 85 || v > 150);
    if (bad) return res.status(400).json({ error: 'Koordinat tidak valid (maks. ' + MAX_POINTS + ' titik, wilayah perairan Indonesia).' });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 8);
    // Koordinat identik (mis. rute patroli kembali ke titik awal) hanya diminta sekali ke sumber data.
    const keys = lat.map((v, i) => v.toFixed(3) + ',' + lon[i].toFixed(3));
    const uniq = [...new Set(keys)];
    const idx = keys.map(k => uniq.indexOf(k));
    const loc = '?latitude=' + uniq.map(k => k.split(',')[0]).join(',') + '&longitude=' + uniq.map(k => k.split(',')[1]).join(',') +
      '&forecast_days=' + days + '&timeformat=unixtime';

    const [base, models, wind] = await Promise.allSettled([
      getJSON(MARINE + loc + '&hourly=wave_height,swell_wave_height,wave_period,ocean_current_velocity'),
      getJSON(MARINE + loc + '&hourly=wave_height&models=' + Object.keys(WAVE).join(',')),
      getJSON(WX + loc + '&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn&models=' + Object.keys(WIND).join(','))
    ]);
    if (base.status !== 'fulfilled' && models.status !== 'fulfilled') {
      return res.status(502).json({ error: 'Sumber data gelombang tidak merespons.', detail: String(base.reason).slice(0, 200) });
    }
    const ref = base.status === 'fulfilled' ? base.value : models.value;
    const t = ref[0].hourly.time;
    const usedWave = new Set(), usedWind = new Set();
    // Model angin Open-Meteo gagal: coba MET Norway untuk titik unik.
    const met = wind.status === 'fulfilled' ? null : await metWind(uniq.map(k => k.split(',').map(Number)), t);
    const metOk = !!met && met.some(a => a && a.some(v => v != null));
    const sg = await stormglass(uniq.map(k => k.split(',').map(Number)), t);
    const cm = copernicusGrid();
    let cmUsed = 0;
    if (base.status === 'fulfilled') usedWave.add('Open-Meteo (best match)');

    const uniqPoints = ref.map((p, i) => {
      const at = arr => {
        const m = new Map();
        ((arr && arr.time) || []).forEach((x, k) => m.set(x, k));
        return m;
      };
      const B = base.status === 'fulfilled' ? base.value[i].hourly : {};
      const M = models.status === 'fulfilled' ? models.value[i].hourly : {};
      const W = wind.status === 'fulfilled' ? wind.value[i].hourly : {};
      const bi = at(B), mi = at(M), wi = at(W);
      const curUnit = String((base.status === 'fulfilled' && base.value[i].hourly_units && base.value[i].hourly_units.ocean_current_velocity) || 'km/h');
      const ck = curUnit.includes('m/s') ? 1.94384 : curUnit.includes('kn') ? 1 : 1 / 1.852;
      const o = { hx: [], hn: [], sw: [], tp: [], cur: [], w: [], g: [] };
      const mw = met && met[i];
      const sgp = sg && sg.res[i];
      const [plat, plon] = uniq[i].split(',').map(Number);
      let cmHit = false;
      const wm = new Set();
      if (base.status === 'fulfilled' && (B.wave_height || []).some(v => v != null && v > 0.01)) wm.add('Open-Meteo (best match)');
      t.forEach((time, ti) => {
        const kb = bi.get(time), km = mi.get(time), kw = wi.get(time);
        const waves = [];
        if (kb != null && B.wave_height && B.wave_height[kb] > 0.01) waves.push(B.wave_height[kb]);
        Object.keys(WAVE).forEach(m => {
          const v = km != null && M['wave_height_' + m] ? M['wave_height_' + m][km] : null;
          if (v != null && v > 0.01) { waves.push(v); usedWave.add(WAVE[m]); wm.add(WAVE[m]); } // 0 = sel daratan/tertutup
        });
        const sv = sgp && sgp[ti];
        if (sv && sv.hs != null && sv.hs > 0.01) { waves.push(sv.hs); usedWave.add('Stormglass'); }   // tidak dihitung di wm (hanya sebagian titik)
        const cmhs = cm ? cm.at('hs', plat, plon, time * 1000) : null;
        if (cmhs != null && cmhs > 0.01) { waves.push(cmhs); usedWave.add('Copernicus Marine'); wm.add('Copernicus Marine'); cmHit = true; }
        let ws = null, gs = null;
        Object.keys(WIND).forEach(m => {
          const v = kw != null && W['wind_speed_10m_' + m] ? W['wind_speed_10m_' + m][kw] : null;
          const g = kw != null && W['wind_gusts_10m_' + m] ? W['wind_gusts_10m_' + m][kw] : null;
          if (v != null) { ws = Math.max(ws ?? 0, v); usedWind.add(WIND[m]); }
          if (g != null) gs = Math.max(gs ?? 0, g);
        });
        o.hx.push(waves.length ? rnd(Math.max(...waves)) : null);
        o.hn.push(waves.length ? rnd(Math.min(...waves)) : null);
        o.sw.push(kb != null && B.swell_wave_height ? rnd(B.swell_wave_height[kb]) : null);
        o.tp.push(kb != null && B.wave_period ? rnd(B.wave_period[kb]) : null);
        let c0 = kb != null && B.ocean_current_velocity && B.ocean_current_velocity[kb] != null ? B.ocean_current_velocity[kb] * ck : null;
        if (sv && sv.cur != null) c0 = Math.max(c0 ?? 0, sv.cur);
        const cmcur = cm ? cm.at('cur_spd', plat, plon, time * 1000) : null;   // arus total Copernicus (termasuk pasut): hanya menaikkan
        if (cmcur != null) { c0 = Math.max(c0 ?? 0, cmcur); cmHit = true; }
        o.cur.push(rnd(c0));
        if (ws == null && mw && mw[ti] != null) { ws = mw[ti]; usedWind.add(MET_LABEL); }   // cadangan: tanpa data hembusan
        if (sv && sv.w != null) { ws = Math.max(ws ?? 0, sv.w); usedWind.add('Stormglass'); }   // pembanding: hanya menaikkan
        if (sv && sv.g != null) gs = Math.max(gs ?? 0, sv.g);
        o.w.push(rnd(ws));
        o.g.push(rnd(gs));
      });
      // Sel grid yang dipakai sumber data (best match ±8 km); dipakai klien untuk peringatan resolusi.
      const c = ref[i];
      o.cell = Number.isFinite(c.latitude) && Number.isFinite(c.longitude) ? [rnd4(c.latitude), rnd4(c.longitude)] : null;
      o.wm = [...wm];
      if (cmHit) cmUsed++;
      return o;
    });
    const points = idx.map(k => uniqPoints[k]);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      source: 'Open-Meteo (data terbuka ECMWF, NOAA, Météo-France, DWD)',
      waveModels: [...usedWave], windModels: [...usedWind],
      windOk: wind.status === 'fulfilled' || metOk,
      windBackup: wind.status !== 'fulfilled' && metOk,
      stormglass: sg ? { points: sg.used, requested: sg.requested, of: uniq.length, error: sg.error } : null,
      copernicus: cm ? { points: cmUsed, of: uniq.length, issued: cm.meta.issued, synthetic: !!cm.meta.synthetic } : null,
      fetchedAt: Date.now(), requested: lat.length, fetched: uniq.length, t, points
    });
  } catch (e) {
    return res.status(500).json({ error: 'Gagal mengambil data.', detail: String(e).slice(0, 300) });
  }
};
