// Jalankan: npm test
// Menguji fungsi server dengan data tiruan (tanpa internet).
const test = require('node:test');
const assert = require('node:assert');

const T = [1795737600, 1795741200, 1795744800];
const mk = (hourly, units, lat) => ({ latitude: lat == null ? 0 : lat, longitude: 110.0417, hourly_units: units || {}, hourly: Object.assign({ time: T }, hourly) });
const ok = b => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
// Satu lokasi per koordinat yang diminta (seperti Open-Meteo); sel grid = lintang dibulatkan ke 1/12 derajat.
const perLoc = (u, f) => new URL(u).searchParams.get('latitude').split(',').map(Number).map(la => f(Math.round(la * 12) / 12));

function mockFetch() {
  global.fetch = async url => {
    const u = String(url);
    if (u.includes('marine') && u.includes('models=')) return ok(perLoc(u, la => mk({ wave_height_ecmwf_wam025: [1, 2, 3], wave_height_ncep_gfswave025: [1.5, null, 0], wave_height_meteofrance_wave: [0.9, 2.2, null] }, null, la)));
    if (u.includes('marine')) return ok(perLoc(u, la => mk({ wave_height: [1.2, 2.1, 2.9], swell_wave_height: [1, 1, 1], wave_period: [8, 8, 8], ocean_current_velocity: [1.852, 3.704, null] }, { ocean_current_velocity: 'km/h' }, la)));
    if (u.includes('api.open-meteo.com')) return ok(perLoc(u, la => mk({ wind_speed_10m_ecmwf_ifs025: [10, 20, 30], wind_speed_10m_gfs_seamless: [12, 18, null], wind_speed_10m_icon_seamless: [null, null, 35], wind_gusts_10m_ecmwf_ifs025: [15, 25, 40] }, null, la)));
    if (u.endsWith('rss.xml')) return { ok: true, status: 200, text: async () => '<rss><item><link>https://www.bmkg.go.id/alerts/nowcast/id/ABC_alert.xml</link></item><item><link>https://www.bmkg.go.id/alerts/nowcast/id/OLD_alert.xml</link></item></rss>' };
    if (u.includes('ABC_alert')) return { ok: true, status: 200, text: async () => '<alert><info><event>Hujan Lebat &amp; Petir</event><severity>Moderate</severity><effective>2026-11-27T12:50:00+07:00</effective><expires>2099-01-01T00:00:00+07:00</expires><headline>Hujan di Jatim</headline><area><areaDesc>Jawa Timur</areaDesc><polygon>-7.1,112.6 -7.0,112.9 -7.3,112.9 -7.1,112.6</polygon></area></info></alert>' };
    if (u.includes('OLD_alert')) return { ok: true, status: 200, text: async () => '<alert><info><event>Old</event><expires>2020-01-01T00:00:00+07:00</expires><area><polygon>0,0 1,1 1,0 0,0</polygon></area></info></alert>' };
    throw new Error('URL tak terduga ' + u);
  };
}
const res = () => { const r = { h: {}, code: 0, body: null, setHeader(k, v) { r.h[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('forecast: nilai gelombang = maksimum antarmodel, nilai 0 (sel daratan) diabaikan', async () => {
  mockFetch();
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8', lon: '110' } }, r);
  assert.strictEqual(r.code, 200);
  const p = r.body.points[0];
  assert.deepStrictEqual(p.hx, [1.5, 2.2, 3]);
  assert.deepStrictEqual(p.hn, [0.9, 2, 2.9]);      // 0 dari GFS-Wave diabaikan
  assert.deepStrictEqual(p.cur, [1, 2, null]);       // km/j -> knot
  assert.deepStrictEqual(p.w, [12, 20, 35]);         // angin = maksimum antarmodel
});

test('forecast: koordinat di luar Indonesia ditolak', async () => {
  mockFetch();
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8', lon: '200' } }, r);
  assert.strictEqual(r.code, 400);
});

test('bmkg-warnings: hanya peringatan yang masih berlaku, poligon terbaca', async () => {
  mockFetch();
  const w = require('../api/bmkg-warnings.js'); const r = res();
  await w({ query: {} }, r);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.alerts.length, 1);
  assert.strictEqual(r.body.alerts[0].event, 'Hujan Lebat & Petir');
  assert.strictEqual(r.body.alerts[0].polys[0].length, 4);
});

test('forecast: sel grid dan daftar model per titik dikirim ke klien', async () => {
  mockFetch();
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8', lon: '110' } }, r);
  const p = r.body.points[0];
  assert.deepStrictEqual(p.cell, [-8, 110.0417]);
  assert.deepStrictEqual(p.wm.sort(), ['ECMWF WAM', 'Météo-France MFWAM', 'NOAA GFS-Wave', 'Open-Meteo (best match)']);
});

test('forecast: koordinat identik hanya diminta sekali, urutan titik tetap', async () => {
  const urls = []; mockFetch(); const inner = global.fetch;
  global.fetch = async u => { urls.push(String(u)); return inner(u); };
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8,-8.5,-8', lon: '110,110.5,110' } }, r);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.requested, 3);
  assert.strictEqual(r.body.fetched, 2);
  assert.strictEqual(r.body.points.length, 3);
  assert.deepStrictEqual(r.body.points[0], r.body.points[2]);
  assert.deepStrictEqual(r.body.points[1].cell, [-8.5, 110.0417]);
  assert.ok(urls.every(u => new URL(u).searchParams.get('latitude') === '-8.000,-8.500'));
});

test('forecast: model angin gagal -> cadangan MET Norway (nilai terbesar di antara jam per 6 jam)', async () => {
  mockFetch(); const inner = global.fetch; const seen = [];
  const iso = s => new Date(s * 1000).toISOString().replace('.000Z', 'Z');
  global.fetch = async (u, o) => {
    const url = String(u);
    if (url.includes('://api.open-meteo.com')) return { ok: false, status: 429, text: async () => 'limit' };
    if (url.includes('api.met.no')) {
      seen.push(o && o.headers && o.headers['User-Agent']);
      // jam 0: 10 m/s; jam 2 (lompat 2 jam): 5 m/s -> jam 1 = max(10,5) m/s
      const ts = [[T[0], 10], [T[2], 5]].map(([s, v]) => ({ time: iso(s), data: { instant: { details: { wind_speed: v } } } }));
      return { ok: true, status: 200, json: async () => ({ properties: { timeseries: ts } }) };
    }
    return inner(u, o);
  };
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8', lon: '110' } }, r);
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.windOk, true);
  assert.strictEqual(r.body.windBackup, true);
  assert.deepStrictEqual(r.body.windModels, ['MET Norway (cadangan)']);
  assert.deepStrictEqual(r.body.points[0].w, [19.44, 19.44, 9.72]);   // knot
  assert.deepStrictEqual(r.body.points[0].g, [null, null, null]);
  assert.ok(seen[0].startsWith('sigap-laut/') && !seen[0].includes('@'));
});

test('forecast: model angin & MET Norway gagal -> windOk false (aplikasi menurunkan status)', async () => {
  mockFetch(); const inner = global.fetch;
  global.fetch = async (u, o) => {
    const url = String(u);
    if (url.includes('://api.open-meteo.com') || url.includes('api.met.no')) return { ok: false, status: 503, text: async () => 'down' };
    return inner(u, o);
  };
  const f = require('../api/forecast.js'); const r = res();
  await f({ query: { lat: '-8', lon: '110' } }, r);
  assert.strictEqual(r.body.windOk, false);
  assert.strictEqual(r.body.windBackup, false);
  assert.deepStrictEqual(r.body.points[0].w, [null, null, null]);
});

test('forecast: Stormglass (opsional) hanya aktif dengan kunci, tersebar rata, hanya menaikkan nilai', async () => {
  const iso = x => new Date(x * 1000).toISOString().replace('.000Z', '+00:00');
  mockFetch(); const inner = global.fetch; const calls = [];
  global.fetch = async (u, o) => {
    const url = String(u);
    if (url.includes('api.stormglass.io')) {
      calls.push({ url, auth: o.headers.Authorization });
      const hours = T.map((x, k) => ({ time: iso(x), waveHeight: { sg: k === 0 ? 4 : 0.5, noaa: 0.6 }, windSpeed: { sg: 20 }, gust: { sg: 25 }, currentSpeed: { sg: 0.1 } }));
      return { ok: true, status: 200, json: async () => ({ hours }) };
    }
    return inner(u, o);
  };
  const f = require('../api/forecast.js');
  // tanpa kunci: tidak dipanggil
  delete process.env.STORMGLASS_API_KEY;
  let r = res(); await f({ query: { lat: '-8,-8.2,-8.4,-8.6', lon: '110,110,110,110' } }, r);
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(r.body.stormglass, null);
  // dengan kunci & maks. 2 titik: titik pertama dan terakhir
  process.env.STORMGLASS_API_KEY = 'uji'; process.env.STORMGLASS_MAX_POINTS = '2';
  r = res(); await f({ query: { lat: '-8,-8.2,-8.4,-8.6', lon: '110,110,110,110' } }, r);
  delete process.env.STORMGLASS_API_KEY; delete process.env.STORMGLASS_MAX_POINTS;
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[0].url.includes('lat=-8&') && calls[1].url.includes('lat=-8.6&'));
  assert.strictEqual(calls[0].auth, 'uji');
  assert.deepStrictEqual(r.body.stormglass, { points: 2, requested: 2, of: 4, error: null });
  const p0 = r.body.points[0], p1 = r.body.points[1];
  assert.deepStrictEqual(p0.hx, [4, 2.2, 3]);          // jam 0 dinaikkan oleh Stormglass 4 m; jam lain tetap
  assert.deepStrictEqual(p1.hx, [1.5, 2.2, 3]);        // titik tanpa Stormglass tidak berubah
  assert.deepStrictEqual(p0.w, [38.88, 38.88, 38.88]); // 20 m/s -> knot, lebih besar dari model lain
  assert.deepStrictEqual(p0.cur, [1, 2, 0.19]);         // arus: maksimum, tidak menurunkan 1 & 2 knot
  assert.ok(!p0.wm.includes('Stormglass'));
});
