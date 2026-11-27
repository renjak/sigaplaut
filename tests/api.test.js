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
