// Prakiraan per titik rute dari data terbuka (via Open-Meteo, CC BY 4.0):
// gelombang: ECMWF WAM, NOAA GFS-Wave, Meteo-France MFWAM (+ best match untuk swell/periode/arus)
// angin: ECMWF IFS, NOAA GFS, DWD ICON. Nilai yang dipakai aplikasi: maksimum antarmodel (konservatif).
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const WX = 'https://api.open-meteo.com/v1/forecast';
const WAVE = { ecmwf_wam025: 'ECMWF WAM', ncep_gfswave025: 'NOAA GFS-Wave', meteofrance_wave: 'Météo-France MFWAM' };
const WIND = { ecmwf_ifs025: 'ECMWF IFS', gfs_seamless: 'NOAA GFS', icon_seamless: 'DWD ICON' };

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return Array.isArray(j) ? j : [j];
}
const rnd = v => (v == null || !Number.isFinite(v)) ? null : Math.round(v * 100) / 100;
const rnd4 = v => Math.round(v * 1e4) / 1e4;

module.exports = async (req, res) => {
  try {
    const lat = String(req.query.lat || '').split(',').filter(Boolean).map(Number);
    const lon = String(req.query.lon || '').split(',').filter(Boolean).map(Number);
    const bad =
      !lat.length || lat.length !== lon.length || lat.length > 80 ||
      lat.some(v => !Number.isFinite(v) || v < -20 || v > 15) ||
      lon.some(v => !Number.isFinite(v) || v < 85 || v > 150);
    if (bad) return res.status(400).json({ error: 'Koordinat tidak valid (maks. 80 titik, wilayah perairan Indonesia).' });
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
      const wm = new Set();
      if (base.status === 'fulfilled' && (B.wave_height || []).some(v => v != null && v > 0.01)) wm.add('Open-Meteo (best match)');
      t.forEach(time => {
        const kb = bi.get(time), km = mi.get(time), kw = wi.get(time);
        const waves = [];
        if (kb != null && B.wave_height && B.wave_height[kb] > 0.01) waves.push(B.wave_height[kb]);
        Object.keys(WAVE).forEach(m => {
          const v = km != null && M['wave_height_' + m] ? M['wave_height_' + m][km] : null;
          if (v != null && v > 0.01) { waves.push(v); usedWave.add(WAVE[m]); wm.add(WAVE[m]); } // 0 = sel daratan/tertutup
        });
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
        o.cur.push(kb != null && B.ocean_current_velocity && B.ocean_current_velocity[kb] != null ? rnd(B.ocean_current_velocity[kb] * ck) : null);
        o.w.push(rnd(ws));
        o.g.push(rnd(gs));
      });
      // Sel grid yang dipakai sumber data (best match ±8 km); dipakai klien untuk peringatan resolusi.
      const c = ref[i];
      o.cell = Number.isFinite(c.latitude) && Number.isFinite(c.longitude) ? [rnd4(c.latitude), rnd4(c.longitude)] : null;
      o.wm = [...wm];
      return o;
    });
    const points = idx.map(k => uniqPoints[k]);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({
      source: 'Open-Meteo (data terbuka ECMWF, NOAA, Météo-France, DWD)',
      waveModels: [...usedWave], windModels: [...usedWind],
      windOk: wind.status === 'fulfilled',
      fetchedAt: Date.now(), requested: lat.length, fetched: uniq.length, t, points
    });
  } catch (e) {
    return res.status(500).json({ error: 'Gagal mengambil data.', detail: String(e).slice(0, 300) });
  }
};
