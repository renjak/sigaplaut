// Uji geodesi WGS84 terhadap nilai acuan. Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const G = require('../lib/geo.js');
const dms = (d, m, s) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);

test('Vincenty: contoh acuan Flinders Peak → Buninyong (Vincenty 1975)', () => {
  const a = [-dms(37, 57, 3.72030), dms(144, 25, 29.52440)], b = [-dms(37, 39, 10.15610), dms(143, 55, 35.38390)];
  const r = G.inverse(a, b);
  assert.ok(Math.abs(r.m - 54972.271) < 0.002, r.m);
  assert.ok(Math.abs(r.bearing - dms(306, 52, 5.37)) < 1 / 3600, r.bearing);
  assert.strictEqual(r.method, 'vincenty');
});

test('Vincenty: 1 menit busur lintang di ekuator = 1.842,9 m (bukan 1.852 m)', () => {
  const r = G.inverse([0, 106], [1 / 60, 106]);
  assert.ok(Math.abs(r.m - 1842.9) < 0.1, r.m);
  assert.ok(Math.abs(r.bearing - 0) < 1e-9);
});

test('Vincenty: haluan sejati arah mata angin & titik sama', () => {
  // Haluan awal geodesik sepanjang lintang tetap menyimpang ±sin(lat)·Δlon/2 ≈ 0,05° dari 90°/270°.
  assert.ok(Math.abs(G.inverse([-6, 106], [-6, 107]).bearing - 90) < 0.1);
  assert.ok(Math.abs(G.inverse([-6, 106], [-7, 106]).bearing - 180) < 1e-9);
  assert.ok(Math.abs(G.inverse([-6, 107], [-6, 106]).bearing - 270) < 0.1);
  assert.deepStrictEqual(G.inverse([-6, 106], [-6, 106]).nm, 0);
});

test('Vincenty vs bola: selisih wajar (< 0,5%) untuk rute Indonesia', () => {
  const a = [1.125, 103.925], b = [-6.0958, 106.8861];
  const v = G.inverse(a, b).nm, s = G.sphere(a, b).m / 1852;
  assert.ok(Math.abs(v - s) / v < 0.005, `${v} vs ${s}`);
});
