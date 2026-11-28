// Uji perkiraan data kapal dari data yang terbaca (lib/specest.js).
const test = require('node:test');
const assert = require('node:assert');
const est = require('../lib/specest.js');

test('perkiraan dari LOA + lebar (contoh KRI 60 m, lebar 8,1)', () => {
  const r = est.estimate({ loa: 60, beam: 8.1 });
  // sarat = maks(0,33x8,1=2,67 ; 0,05x60=3,0) = 3,0 (konservatif tinggi)
  assert.strictEqual(r.fields.draft, 3.0);
  assert.strictEqual(r.methods.draft, 'perkiraan');
  // UKC = maks(1 ; 0,2x3,0=0,6) = 1,0 (dihitung)
  assert.strictEqual(r.fields.ukc, 1.0);
  assert.strictEqual(r.methods.ukc, 'hitung');
  // batas gelombang pita 50-70 m = 3,0 m
  assert.strictEqual(r.fields.hs, 3.0);
  assert.strictEqual(r.methods.hs, 'perkiraan');
  // batas angin pita 50-90 m = 30 kn
  assert.strictEqual(r.fields.wind, 30);
  // batas arus dasar = 2,0 kn
  assert.strictEqual(r.fields.cur, 2.0);
});

test('field yang sudah diketahui tidak ditimpa', () => {
  const r = est.estimate({ loa: 60, beam: 8.1, draft: 2.57, hs: 4, wind: 35, cur: 3 });
  assert.ok(!('draft' in r.fields), 'sarat tidak diisi karena sudah diketahui');
  assert.ok(!('hs' in r.fields));
  assert.ok(!('wind' in r.fields));
  assert.ok(!('cur' in r.fields));
  // UKC tetap boleh dihitung dari sarat yang diketahui
  assert.strictEqual(r.fields.ukc, 1.0);
  assert.strictEqual(r.methods.ukc, 'hitung');
});

test('UKC dihitung dari sarat yang diketahui (20%, minimal 1 m)', () => {
  const r = est.estimate({ draft: 8 });        // 0,2x8 = 1,6
  assert.strictEqual(r.fields.ukc, 1.6);
  const r2 = est.estimate({ draft: 3 });       // 0,2x3 = 0,6 -> dibatasi 1,0
  assert.strictEqual(r2.fields.ukc, 1.0);
});

test('sarat dari lebar saja bila LOA tak ada', () => {
  const r = est.estimate({ beam: 12 });        // 0,33x12 = 3,96 -> 4,0
  assert.strictEqual(r.fields.draft, 4.0);
});

test('tanpa ukuran apa pun: tak ada yang bisa diperkirakan', () => {
  const r = est.estimate({});
  assert.deepStrictEqual(r.fields, {});
});

test('pita batas konservatif naik sesuai ukuran, tapi tidak melebihi kapal besar', () => {
  assert.strictEqual(est.hsBand(25), 2.0);
  assert.strictEqual(est.hsBand(60), 3.0);
  assert.strictEqual(est.hsBand(150), 5.5);
  assert.strictEqual(est.windBand(40), 25);
  assert.strictEqual(est.windBand(100), 35);
});

test('kapal besar: sarat & batas lebih tinggi', () => {
  const r = est.estimate({ loa: 110, beam: 14 });
  assert.strictEqual(r.fields.draft, 5.5);     // maks(0,33x14=4,62 ; 0,05x110=5,5)
  assert.strictEqual(r.fields.hs, 4.5);        // pita 90-120
  assert.strictEqual(r.fields.wind, 35);       // pita >=90
  assert.strictEqual(r.fields.ukc, 1.1);       // 0,2x5,5 = 1,1
});
