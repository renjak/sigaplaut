// Uji unit logika rute (lib/route.js). Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/route.js');

const H = 3600e3;
const T0 = Date.UTC(2026, 10, 27, 0, 0); // 27 Nov 2026 00.00 UTC = 07.00 WIB
const hours = n => Array.from({ length: n }, (_, i) => T0 + i * H);
// Titik data: nilai konstan per jam kecuali diberi array.
const pt = (o, n = 48) => {
  const fill = v => Array.isArray(v) ? v : Array(n).fill(v === undefined ? null : v);
  return { t: hours(n), hx: fill(o.hx), hn: fill(o.hn ?? o.hx), sw: fill(null), tp: fill(null), cur: fill(o.cur), w: fill(o.w), g: fill(o.g), cell: o.cell, wm: o.wm };
};
const ALL = ['Open-Meteo (best match)', 'ECMWF WAM', 'NOAA GFS-Wave', 'Météo-France MFWAM'];
const data = (pts, extra) => Object.assign({ pts, at: T0, waveModels: ALL, windModels: ['ECMWF IFS'], windOk: true }, extra || {});
const SHIP = { hs: 2, speed: 10 };
const WPS = [[-7, 112], [-7, 112.5]];            // ±30 NM -> 3 titik sampel
const samples = R.buildSamples(WPS);
const fmt = { f1: v => v.toFixed(1), fn: v => String(v) };

test('buildSamples: titik bantu ≤20 NM, waypoint pertama & terakhir ikut', () => {
  assert.strictEqual(samples.length, 3);
  assert.strictEqual(samples[0].wp, 0);
  assert.strictEqual(samples[2].wp, 1);
  assert.ok(samples[1].cum <= 20 && samples[2].cum > 29 && samples[2].cum < 30);
});

test('verdict: tepat di batas tidak merah, tepat 80% tidak kuning (pembanding ketat)', () => {
  assert.strictEqual(R.verdict({ hs: 1.5 }, 0.5, SHIP), 'a');   // 2.0 = batas -> waspada, bukan merah
  assert.strictEqual(R.verdict({ hs: 1.51 }, 0.5, SHIP), 'r');
  assert.strictEqual(R.verdict({ hs: 1.1 }, 0.5, SHIP), 'g');   // 1.6 = 80% -> aman
  assert.strictEqual(R.verdict({ hs: 1.11 }, 0.5, SHIP), 'a');
  const s = { hs: 3, speed: 10, wind: 20, cur: 2 };
  assert.strictEqual(R.verdict({ hs: 0.5, w: 20, cur: 1 }, 0.5, s), 'a');
  assert.strictEqual(R.verdict({ hs: 0.5, w: 20.1, cur: 1 }, 0.5, s), 'r');
  assert.strictEqual(R.verdict({ hs: 0.5, w: 10, cur: 2 }, 0.5, s), 'g');
  assert.strictEqual(R.verdict({ hs: 0.5, w: 10, cur: 2.1 }, 0.5, s), 'a');
  assert.strictEqual(R.verdict({ hs: null }, 0.5, SHIP), 'x');
  assert.strictEqual(R.verdict({ hs: undefined }, 0.5, SHIP), 'x');
});

test('trip: semua data baik -> AMAN', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: 0.6 }), pt({ hx: 0.7 })]);
  const T = R.trip(samples, d, SHIP, T0, 10, 0.5, R.dataQuality(samples, d, SHIP, T0));
  assert.strictEqual(T.worst, 'g');
  assert.strictEqual(T.downgraded, false);
  assert.strictEqual(T.maxE, 1.2);
});

test('trip: satu titik tanpa data gelombang -> AMAN diturunkan ke WASPADA', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: null }), pt({ hx: 0.7 })]);
  const T = R.trip(samples, d, SHIP, T0, 10, 0.5, []);
  assert.strictEqual(T.worst, 'a');
  assert.strictEqual(T.downgraded, true);
  assert.strictEqual(T.missing, 1);
  assert.ok(T.reasons.some(r => r.includes('tanpa data gelombang')));
});

test('trip: data kosong tidak menutupi status merah', () => {
  const d = data([pt({ hx: 3 }), pt({ hx: null }), pt({ hx: 0.7 })]);
  assert.strictEqual(R.trip(samples, d, SHIP, T0, 10, 0.5, []).worst, 'r');
});

test('trip: semua titik tanpa data -> TANPA DATA, bukan AMAN', () => {
  const d = data([pt({ hx: null }), pt({ hx: null }), pt({ hx: null })]);
  assert.strictEqual(R.trip(samples, d, SHIP, T0, 10, 0.5, []).worst, 'x');
});

test('trip: batas angin diisi tetapi data angin kosong -> WASPADA', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: 0.5 }), pt({ hx: 0.5 })]);
  const T = R.trip(samples, d, { hs: 2, speed: 10, wind: 25 }, T0, 10, 0.5, []);
  assert.strictEqual(T.worst, 'a');
  assert.ok(T.windMissing);
});

test('trip: rute melewati batas hari & keluar jangkauan data', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: 0.5 }), pt({ hx: 0.5 })]);
  const late = T0 + 16 * H + 30 * 60e3;            // 23.30 WIB, tiba ±02.30 WIB hari berikutnya
  const T = R.trip(samples, d, SHIP, late, 10, 0.5, []);
  assert.strictEqual(T.out, false);
  assert.strictEqual(new Date(T.rows[2].eta + 7 * H).getUTCDate(), 28);
  const tooLate = T0 + 47 * H;                      // titik terakhir tiba setelah data habis
  const T2 = R.trip(samples, d, SHIP, tooLate, 10, 0.5, []);
  assert.strictEqual(T2.out, true);
  assert.notStrictEqual(T2.worst, 'g');
});

test('dataQuality: data usang (>6 jam) menurunkan status', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: 0.5 }), pt({ hx: 0.5 })]);
  const q = R.dataQuality(samples, d, SHIP, T0 + 7 * H);
  assert.ok(q.some(x => x.code === 'stale' && x.level === 'down'));
  const T = R.trip(samples, d, SHIP, T0 + 7 * H, 10, 0.5, q);
  assert.strictEqual(T.worst, 'a');
  assert.ok(T.reasons.includes('data usang'));
  assert.ok(!R.dataQuality(samples, d, SHIP, T0 + 5 * H).some(x => x.code === 'stale'));
});

test('dataQuality: model angin gagal & hanya 1 model gelombang', () => {
  const d = data([pt({ hx: 0.5 })], { windOk: false, windModels: [], waveModels: ['Open-Meteo (best match)', 'Météo-France MFWAM'] });
  const q = R.dataQuality(samples.slice(0, 1), d, { hs: 2, speed: 10, wind: 25 }, T0);
  assert.ok(q.some(x => x.code === 'noWind' && x.level === 'down'));
  assert.ok(q.some(x => x.code === 'oneWave' && x.text.includes('MFWAM')));
  const q2 = R.dataQuality(samples.slice(0, 1), d, SHIP, T0);
  assert.strictEqual(q2.find(x => x.code === 'noWind').level, 'info');   // tanpa batas angin: catatan saja
});

test('dataQuality: titik berbeda di sel grid sama -> peringatan resolusi', () => {
  const d = data([pt({ hx: 0.1, cell: [1.0417, 104.2084] }), pt({ hx: 0.1, cell: [1.0417, 104.2084] }), pt({ hx: 0.1, cell: [1.0417, 104.125] })]);
  const q = R.dataQuality(samples, d, SHIP, T0);
  const c = q.find(x => x.code === 'coarse');
  assert.ok(c && c.text.startsWith('2 titik'));
  assert.ok(c.text.includes('cek prakiraan pelabuhan BMKG'));
});

test('dataQuality: rute patroli kembali ke titik awal tidak dianggap sel sama', () => {
  const loop = R.buildSamples([[-8, 110], [-8.5, 110], [-8, 110]]);
  const pts = loop.map(p => pt({ hx: 1, cell: [p.lat, p.lon] }));
  assert.ok(!R.dataQuality(loop, data(pts), SHIP, T0).some(x => x.code === 'coarse'));
});

test('dataQuality: model lebih sedikit di satu titik -> peringatan pantai/selat', () => {
  const d = data([pt({ hx: 0.5, wm: ALL }), pt({ hx: 0.5, wm: ['Open-Meteo (best match)', 'Météo-France MFWAM'] }), pt({ hx: 0.5, wm: ALL })]);
  const c = R.dataQuality(samples, d, SHIP, T0).find(x => x.code === 'coastal');
  assert.ok(c && c.text.startsWith('1 titik'));
});

test('notesFor: rute melebihi jarak jelajah & alasan penurunan status', () => {
  const d = data([pt({ hx: 0.5 }), pt({ hx: null }), pt({ hx: 0.5 })]);
  const ship = { hs: 2, speed: 10, range: 20 };
  const T = R.trip(samples, d, ship, T0, 10, 0.5, []);
  const notes = R.notesFor(T, ship, samples[2].cum, 10, fmt);
  assert.ok(notes[0].startsWith('Status diturunkan dari AMAN menjadi WASPADA'));
  assert.ok(notes.some(n => n.includes('melebihi jarak jelajah kapal 20 NM')));
});

test('windows: jendela aman pertama ditemukan; slot di luar data = x', () => {
  const hx = Array(48).fill(1.8); for (let i = 6; i < 48; i++) hx[i] = 0.5;   // buruk 6 jam pertama
  const d = data([pt({ hx }), pt({ hx }), pt({ hx })]);
  const W = R.windows(samples, d, SHIP, T0, 10, 0.5, []);
  assert.strictEqual(W.slots[0].vd, 'r');
  assert.strictEqual(W.best.vd, 'g');
  assert.strictEqual(W.best.d, T0 + 6 * H);
  assert.strictEqual(W.slots[W.slots.length - 1].vd, 'x');
});

test('nearestPort: pelabuhan terdekat dalam 30 NM, selain itu null', () => {
  const ports = [{ c: 'XR004', n: 'Pelabuhan Telaga Punggur', la: 1.035, lo: 104.133 }, { c: 'XO007', n: 'Tanjung Perak', la: -7.197, lo: 112.733 }];
  const p = R.nearestPort([1.058, 104.145], ports);
  assert.strictEqual(p.port.c, 'XR004');
  assert.ok(p.d < 2);
  assert.strictEqual(R.nearestPort([-10, 130], ports), null);
  assert.strictEqual(R.portUrl('XR004'), 'https://www.bmkg.go.id/cuaca/maritim/pelabuhan/XR004');
});

test('verdict/trip: batas arus diisi tetapi data arus kosong -> titik & rute tidak AMAN', () => {
  const s = { hs: 3, speed: 10, wind: 20, cur: 2 };
  assert.strictEqual(R.verdict({ hs: 0.5, w: 10, cur: null }, 0.5, s), 'a');
  assert.strictEqual(R.verdict({ hs: 0.5, w: null, cur: 1 }, 0.5, s), 'a');
  assert.strictEqual(R.verdict({ hs: 0.5 }, 0.5, { hs: 3, speed: 10 }), 'g');   // tanpa batas angin/arus: tidak terpengaruh
  const d = data([pt({ hx: 0.5, w: 10 }), pt({ hx: 0.5, w: 10 }), pt({ hx: 0.5, w: 10 })]);
  const T = R.trip(samples, d, s, T0, 10, 0.5, []);
  assert.strictEqual(T.worst, 'a');
  assert.ok(T.curMissing && T.downgraded);
  assert.ok(T.reasons.includes('data arus kosong padahal batas arus diisi'));
});

test('dataQuality: angin dari cadangan MET Norway -> catatan', () => {
  const d = data([pt({ hx: 0.5, w: 10 })], { windBackup: true, windModels: ['MET Norway (cadangan)'] });
  assert.ok(R.dataQuality(samples.slice(0, 1), d, SHIP, T0).some(x => x.code === 'windBackup' && x.level === 'info'));
});

test('dataQuality: Stormglass pembanding & galat kuota tampil sebagai catatan', () => {
  const d = data([pt({ hx: 0.5 })], { stormglass: { points: 3, requested: 10, of: 40, error: 'Stormglass 429 (kuota habis)' } });
  const q = R.dataQuality(samples.slice(0, 1), d, SHIP, T0).find(x => x.code === 'stormglass');
  assert.ok(q && q.text.includes('3 dari 40') && q.text.includes('kuota habis'));
});
