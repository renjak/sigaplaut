// Uji pembaca grid Copernicus (lib/cmgrid.js) dengan grid kecil buatan. Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const CM = require('../lib/cmgrid.js');

// Grid 2x3 sel (lat -6..-5.8333, lon 106..106.1667), 2 waktu (3 jam-an), 2 variabel (hs, cur_spd).
const T0 = Math.floor(Date.UTC(2026, 10, 27, 0) / 1000);
const meta = {
  source: 'Copernicus Marine Service', datasets: { waves: 'wav', currents: 'cur' }, issued: '2026-11-27T00:00:00Z', synthetic: false,
  bbox: { lat0: -6, lon0: 106, res: 1 / 12, nlat: 2, nlon: 3 }, times: [T0, T0 + 10800], vars: ['hs', 'cur_spd'], units: { hs: 'm', cur_spd: 'kn' }
};
// layout [var][time][lat][lon]: hs t0, hs t1, cur t0, cur t1
const buf = Float32Array.from([
  0.5, 0.6, NaN, 0.7, 0.8, 0.9,   // hs t0 (baris0, baris1)
  1.5, 1.6, 1.7, 1.8, 1.9, 2.0,   // hs t1
  0.2, 0.3, 0.4, 0.5, 0.6, 0.7,   // cur_spd t0
  1.2, 1.3, 1.4, 1.5, 1.6, 1.7,   // cur_spd t1
]);

test('cmgrid: sel & waktu terdekat, nilai & provenance benar', () => {
  const g = CM.load(meta, buf);
  assert.strictEqual(g.at('hs', -6, 106, T0 * 1000), 0.5);
  assert.ok(Math.abs(g.at('hs', -5.9167, 106.0833, T0 * 1000) - 0.8) < 1e-6);  // baris 1 kolom 1
  assert.strictEqual(g.at('hs', -6, 106, (T0 + 10800) * 1000), 1.5);            // waktu kedua
  const p = g.point(-6, 106, (T0 + 1000) * 1000);                               // dibulatkan ke T0
  assert.ok(Math.abs(p.values.hs - 0.5) < 1e-6 && Math.abs(p.values.cur_spd - 0.2) < 1e-6);   // float32
  assert.deepStrictEqual(p.cell, [-6, 106]);
  assert.strictEqual(p.gridTimeMs, T0 * 1000);
  assert.strictEqual(p.datasets.waves, 'wav');
});

test('cmgrid: sel kosong (NaN) -> null, bukan 0', () => {
  const g = CM.load(meta, buf);
  assert.strictEqual(g.at('hs', -6, 106.1667, T0 * 1000), null);   // NaN di grid
  assert.strictEqual(g.point(-6, 106.1667, T0 * 1000).values.hs, null);
});

test('cmgrid: di luar grid / di luar jangkauan waktu -> null, ditandai', () => {
  const g = CM.load(meta, buf);
  assert.strictEqual(g.at('hs', 0, 106, T0 * 1000), null);                 // lintang di luar
  assert.strictEqual(g.at('hs', -6, 106, (T0 - 2 * 3600) * 1000), null);   // sebelum jam pertama > setengah langkah
  const po = g.point(10, 106, T0 * 1000); assert.strictEqual(po.inGrid, false); assert.strictEqual(po.values, null);
  const pt = g.point(-6, 106, (T0 + 10 * 3600) * 1000); assert.strictEqual(pt.inTime, false);
});

test('cmgrid: variabel tak dikenal -> null; ukuran salah -> error', () => {
  const g = CM.load(meta, buf);
  assert.strictEqual(g.at('angin', -6, 106, T0 * 1000), null);
  assert.throws(() => CM.load(meta, Float32Array.from([1, 2, 3])), /ukuran grid/);
});

test('cmgrid: toleransi batas waktu ±setengah langkah (1,5 jam)', () => {
  const g = CM.load(meta, buf);
  assert.strictEqual(g.at('hs', -6, 106, (T0 + 5399) * 1000), 0.5);   // < 1,5 jam -> T0
  assert.strictEqual(g.at('hs', -6, 106, (T0 + 5401) * 1000), 1.5);   // > 1,5 jam -> T1
});
