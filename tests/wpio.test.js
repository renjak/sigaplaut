// Uji impor/ekspor & validasi waypoint (lib/wpio.js). Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const W = require('../lib/wpio.js');

test('parseCoord: desimal, koma desimal, derajat-menit-detik, arah S/B', () => {
  assert.strictEqual(W.parseCoord('-7.25'), -7.25);
  assert.strictEqual(W.parseCoord('-7,25'), -7.25);
  assert.ok(Math.abs(W.parseCoord("7°15'S") + 7.25) < 1e-12);
  assert.ok(Math.abs(W.parseCoord("112°45.5'E") - (112 + 45.5 / 60)) < 1e-12);
  assert.ok(Math.abs(W.parseCoord('06°05\'45"S') + (6 + 5 / 60 + 45 / 3600)) < 1e-12);
  assert.ok(Math.abs(W.parseCoord('104 13 B') + (104 + 13 / 60)) < 1e-12);
  assert.ok(Number.isNaN(W.parseCoord("7°75'S")));   // menit ≥ 60 ditolak, bukan dibulatkan
  assert.ok(Number.isNaN(W.parseCoord('abc')));
});

test('CSV: titik koma + koma desimal, urutan diikuti, nama & kecepatan terbaca', () => {
  const r = W.parseCsv('no;nama;lintang;bujur;kecepatan\n2;Tg Priok;-6,0958;106,8861;12\n1;Sekupang;1,125;103,925;\n');
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.list.map(w => [w.name, w.lat, w.lon, w.speed]), [['Sekupang', 1.125, 103.925, null], ['Tg Priok', -6.0958, 106.8861, 12]]);
  assert.ok(W.validate(r.list).ok);
});

test('CSV: baris rusak & duplikat berurutan ditolak dengan nomor baris, tidak diperbaiki', () => {
  const r = W.parseCsv('lat,lon\n-6.1,106.9\n-6.1,106.9\nx,106\n-6.2,200\n');
  const v = W.validate(r.list);
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some(e => e.startsWith('baris 3') && e.includes('duplikat')));
  assert.ok(v.errors.some(e => e.startsWith('baris 4') && e.includes('tidak terbaca')));
  assert.ok(v.errors.some(e => e.startsWith('baris 5') && e.includes('−180…180')));
  assert.strictEqual(r.list[3].lon, 200);   // nilai asli tetap, tidak dipotong ke 180
});

test('CSV: header tanpa lat/lon, urutan ganda, presisi rendah', () => {
  assert.ok(W.parseCsv('a,b\n1,2').errors[0].includes('lat'));
  assert.ok(W.parseCsv('seq,lat,lon\n1,-6.1,106\n1,-6.2,106.1').errors.some(e => e.includes('ganda')));
  const v = W.validate(W.parseCsv('lat,lon\n-6.1,106.9\n-6.25,107').list);
  assert.ok(v.ok && v.warnings.length === 2);
});

test('validate: di luar cakupan Indonesia, > 100 WP, kecepatan tak wajar', () => {
  assert.ok(W.validate([{ lat: 50, lon: 10 }, { lat: -6, lon: 106 }]).errors[0].includes('cakupan'));
  const many = Array.from({ length: 101 }, (_, i) => ({ lat: -6 - i * 0.01, lon: 106 }));
  assert.ok(W.validate(many).errors[0].includes('Maksimal 100'));
  assert.ok(W.validate([{ lat: -6, lon: 106, speed: 80 }, { lat: -6.1, lon: 106 }]).errors[0].includes('2…45'));
});

test('GeoJSON: LineString [bujur, lintang] & FeatureCollection Point dengan seq', () => {
  const ls = W.parseGeoJson({ type: 'LineString', coordinates: [[103.925, 1.125], [106.8861, -6.0958]] });
  assert.deepStrictEqual(ls.list.map(w => [w.lat, w.lon]), [[1.125, 103.925], [-6.0958, 106.8861]]);
  const fc = W.parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] } },
    { type: 'Feature', properties: { seq: 2, name: 'B', speed_kn: 10 }, geometry: { type: 'Point', coordinates: [106.9, -6.1] } },
    { type: 'Feature', properties: { seq: 1, name: 'A' }, geometry: { type: 'Point', coordinates: [104, 1.1] } }] }));
  assert.deepStrictEqual(fc.errors, []);
  assert.deepStrictEqual(fc.list.map(w => w.name), ['A', 'B']);   // garis diabaikan bila ada Point
});

test('GeoJSON: urutan [lintang, bujur] terdeteksi & ditolak (tidak ditukar)', () => {
  const r = W.parseGeoJson({ type: 'LineString', coordinates: [[1.125, 103.925], [-6.0958, 106.8861]] });
  assert.ok(r.errors.some(e => e.includes('[bujur, lintang]')));
  assert.strictEqual(r.list[0].lat, 103.925);   // tidak diubah
});

test('Ekspor CSV & GeoJSON bolak-balik tanpa kehilangan presisi 6 desimal', () => {
  const rows = [{ seq: 1, name: 'Sekupang, Batam', lat: 1.125, lon: 103.925, speed: 15, legNm: 3.21, bearing: 280.5, etaMs: Date.UTC(2026, 10, 27, 12) },
    { seq: 2, name: 'Pondok Dayung', lat: -6.0958, lon: 106.8861, speed: null, legNm: null, bearing: null, etaMs: null }];
  const csv = W.toCsv(rows);
  assert.ok(csv.startsWith('seq,name,lat,lon,speed_kn,leg_nm,bearing_deg_true,eta_utc\n1,"Sekupang, Batam",1.125000,103.925000,15,3.21,280.5,2026-11-27T12:00:00.000Z'));
  const back = W.parseCsv(csv);
  assert.deepStrictEqual(back.list.map(w => [w.name, w.lat, w.lon]), [['Sekupang, Batam', 1.125, 103.925], ['Pondok Dayung', -6.0958, 106.8861]]);
  const gj = W.toGeoJson(rows);
  assert.deepStrictEqual(gj.features[0].geometry.coordinates[0], [103.925, 1.125]);   // [bujur, lintang]
  assert.deepStrictEqual(W.parseGeoJson(gj).list.map(w => [w.lat, w.lon]), [[1.125, 103.925], [-6.0958, 106.8861]]);
});
