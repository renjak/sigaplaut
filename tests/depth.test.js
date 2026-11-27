// Uji unit penyaring kedangkalan (lib/depth.js) dengan grid buatan. Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const D = require('../lib/depth.js');

// Grid 0..1°S x 106..108°E, 120 sel/derajat, default 40 m.
const meta = { lat0: -1, lon0: 106, res: 120, nlat: 120, nlon: 240 };
function mk(paint) {
  const data = new Uint8Array(meta.nlat * meta.nlon).fill(40);
  if (paint) paint((lat, lon, v) => { const i = Math.floor((lat - meta.lat0) * 120), j = Math.floor((lon - meta.lon0) * 120); data[i * meta.nlon + j] = v; });
  return D.makeGrid(data, meta);
}
const box = (set, la0, la1, lo0, lo1, v) => { for (let la = la0; la < la1; la += 1 / 240) for (let lo = lo0; lo < lo1; lo += 1 / 240) set(la, lo, v); };
const ROUTE = [[-0.5, 106.1], [-0.5, 107.9]];   // ±108 NM ke timur

test('depthAt: daratan 0, dalam = Infinity, di luar grid null', () => {
  const g = mk(set => { set(-0.5, 107, 0); set(-0.4, 107, 255); });
  assert.strictEqual(D.depthAt(g, -0.5, 107), 0);
  assert.strictEqual(D.depthAt(g, -0.4, 107), Infinity);
  assert.strictEqual(D.depthAt(g, -0.5, 106.5), 40);
  assert.strictEqual(D.depthAt(g, 2, 107), null);
});

test('thresholds: sarat 4 m -> merah < 6,5 m (4 + UKC 1 + surut 1,5), kuning < 11,5 m', () => {
  const t = D.thresholds(4);
  assert.strictEqual(t.ukc, 1);
  assert.strictEqual(t.red, 6.5);
  assert.strictEqual(t.amber, 11.5);
  assert.strictEqual(D.thresholds(10).ukc, 2);   // 20% sarat bila > 1 m
});

test('assess: perairan dalam -> tidak ada temuan', () => {
  const r = D.assess(ROUTE, mk(), 4);
  assert.strictEqual(r.level, 'g');
  assert.strictEqual(r.minDepth, 40);
  assert.ok(r.checked > 400);   // titik periksa tiap 0,25 NM
});

test('assess: pulau kecil (±1 km) di tengah rute terdeteksi sebagai lintasan daratan', () => {
  const g = mk(set => box(set, -0.505, -0.495, 107.0, 107.008, 0));
  const r = D.assess(ROUTE, g, 4);
  assert.strictEqual(r.level, 'r');
  assert.strictEqual(r.land.length, 1);
  assert.ok(Math.abs(r.land[0].at[1] - 107.004) < 0.01);
});

test('assess: beting lebih dangkal dari sarat+UKC+surut -> merah; sedikit di atasnya -> kuning', () => {
  const shoal = v => mk(set => box(set, -0.52, -0.48, 107.2, 107.25, v));
  assert.strictEqual(D.assess(ROUTE, shoal(6), 4).level, 'r');     // 6 < 6,5
  const r = D.assess(ROUTE, shoal(7), 4);                           // 7 >= 6,5 tapi < 11,5
  assert.strictEqual(r.level, 'a');
  assert.strictEqual(r.amber[0].min, 7);
  assert.strictEqual(D.assess(ROUTE, shoal(12), 4).level, 'g');
});

test('assess: dangkal/daratan dalam 3 NM dari titik awal & akhir = alur pelabuhan (catatan), bukan merah', () => {
  const g = mk(set => { box(set, -0.52, -0.48, 106.08, 106.12, 0); box(set, -0.52, -0.48, 107.88, 107.92, 2); });
  const r = D.assess(ROUTE, g, 4);
  assert.strictEqual(r.level, 'g');
  assert.strictEqual(r.port.length, 2);
});

test('assess: tanpa sarat -> hanya daratan yang merah, perairan < 10 m dicatat', () => {
  const g = mk(set => box(set, -0.52, -0.48, 107.2, 107.25, 7));
  const r = D.assess(ROUTE, g, null);
  assert.strictEqual(r.level, 'g');
  assert.strictEqual(r.noDraftShallow, true);
  const g2 = mk(set => box(set, -0.505, -0.495, 107.0, 107.01, 0));
  assert.strictEqual(D.assess(ROUTE, g2, null).level, 'r');
});

test('assess: rute keluar cakupan grid -> x (tidak dinilai), bukan aman', () => {
  const r = D.assess([[-0.5, 106.1], [0.5, 107.9]], mk(), 4);
  assert.strictEqual(r.level, 'x');
  assert.ok(r.unknown.length >= 1);
});
