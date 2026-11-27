// Uji penilaian ruang-waktu peringatan (lib/hazard.js). Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const H = require('../lib/hazard.js');

const T0 = Date.UTC(2026, 10, 27, 0);
const ROUTE = [[-6, 106], [-6, 108]];                  // ±119 NM ke timur, 10 kn -> ±12 jam
const box = (la0, la1, lo0, lo1) => [[la0, lo0], [la0, lo1], [la1, lo1], [la1, lo0], [la0, lo0]];

test('densify: titik tiap ≤1 NM, jam tempuh dari kecepatan per ruas', () => {
  const d = H.densify(ROUTE, 10);
  assert.ok(d.length >= 119);
  assert.ok(Math.abs(d[d.length - 1].h - d[d.length - 1].cum / 10) < 1e-9);
  const v = H.densify([[-6, 106], [-6, 107], [-6, 108]], s => (s === 0 ? 10 : 5));
  const last = v[v.length - 1];
  assert.ok(Math.abs(last.h - (v.find(p => p.seg === 1).cum / 10 + (last.cum - v.find(p => p.seg === 1).cum) / 5)) < 1e-9);
});

test('distToPoly: di dalam = 0, di luar = jarak ke tepi (NM)', () => {
  const poly = box(-6.5, -6.1, 106.9, 107.1);
  assert.strictEqual(H.distToPoly([-6.3, 107], poly), 0);
  assert.ok(Math.abs(H.distToPoly([-6, 107], poly) - 6) < 0.01);   // 0,1° lintang = 6 NM
});

test('encounter: poligon kecil di antara titik sampel 20 NM tetap terdeteksi', () => {
  const small = { polys: [box(-6.02, -5.98, 107.05, 107.07)], effective: T0, expires: T0 + 24 * 3600e3 };
  const e = H.encounter(small, H.densify(ROUTE, 10), T0, 10);
  assert.ok(e && e.distanceNm === 0 && e.timing === 'active');
  assert.ok(Math.abs((e.eta - T0) / 3600e3 - e.cumNm / 10) < 1e-6);
});

test('encounter: berakhir sebelum kapal tiba / belum berlaku / di luar koridor', () => {
  const dense = H.densify(ROUTE, 10);
  const far = { polys: [box(-7.5, -7.3, 107, 107.2)] };                       // ±78 NM dari rute
  assert.strictEqual(H.encounter(far, dense, T0, 10), null);
  const east = box(-6.1, -5.9, 107.9, 108.1);                                  // di ujung timur: tiba ±11 jam
  assert.strictEqual(H.encounter({ polys: [east], effective: T0, expires: T0 + 3 * 3600e3 }, dense, T0, 10).timing, 'ended');
  assert.strictEqual(H.encounter({ polys: [east], effective: T0 + 20 * 3600e3, expires: T0 + 30 * 3600e3 }, dense, T0, 10).timing, 'notyet');
  assert.strictEqual(H.encounter({ polys: [east], effective: T0, expires: T0 + 30 * 3600e3 }, dense, T0, 10).timing, 'active');
});
