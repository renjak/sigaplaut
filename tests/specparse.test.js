// Uji pembaca spesifikasi dari teks OCR (lib/specparse.js). Jalankan: npm test
const test = require('node:test');
const assert = require('node:assert');
const S = require('../lib/specparse.js');

// Teks OCR NYATA dari foto GA KRI Kerambit (apa adanya, termasuk salah baca desimal 2,57->257 dll).
const OCR = `MAIN DIMENSION
LENGTH O. A. : 60.000 m
LENGTH W. L. (LWL) : 55.200 m
LPP 85% AT H : 64970 m
LPP AT DESIGN DRAUGTH  : 53.670 m
BREADTH MOULDED (Bm)  : 8.100m
DEPTH MOULDED (Dm) 474m
DEPTH FROM SKEG (D) 487m
DESIGN DRAUGTH (d) 257m
MAX. SPEED (V max.) : 28 knots
MAX ENGINE POWER (MCR): 2 x 3900 kW
"KAPAL CEPAT RUDAL 60M (KCR 60M)
KRI KERAMBIT`;

test('parse: isi hanya nilai wajar; nama kapal terbaca', () => {
  const r = S.parse(OCR);
  assert.strictEqual(r.fields.name, 'KRI KERAMBIT');
  assert.strictEqual(r.fields.loa, 60);
  assert.strictEqual(r.fields.beam, 8.1);
  assert.strictEqual(r.fields.maxSpeed, 28);
});

test('parse: sarat salah baca (257) TIDAK diisi, ditandai manual', () => {
  const r = S.parse(OCR);
  assert.strictEqual(r.fields.draft, undefined);            // 257 m di luar 0,2–25 -> tidak diisi
  assert.ok(r.warnings.some(w => /Sarat/.test(w) && /isi manual/.test(w)));
});

test('parse: LPP AT DESIGN DRAUGHT tidak tertukar dengan DESIGN DRAUGHT (d)', () => {
  // Bila sarat benar (2.57) di baris (d), terisi; baris LPP (53.670) diabaikan.
  const r = S.parse(OCR.replace('DESIGN DRAUGTH (d) 257m', 'DESIGN DRAUGHT (d) : 2.57 m'));
  assert.strictEqual(r.fields.draft, 2.57);
});

test('parse: koma desimal & satuan menempel diterima', () => {
  const r = S.parse('BREADTH MOULDED (Bm) : 8,10 m\nLENGTH O.A. : 60.0m\nMAX. SPEED : 28knots');
  assert.strictEqual(r.fields.beam, 8.1);
  assert.strictEqual(r.fields.loa, 60);
  assert.strictEqual(r.fields.maxSpeed, 28);
});

test('parse: teks tanpa dimensi -> tidak ada field terbaca', () => {
  const r = S.parse('foto buram tanpa teks jelas');
  assert.deepStrictEqual(r.found, []);
  assert.ok(Array.isArray(r.warnings));
});

test('parse: deteksi UKC & batas gelombang/arus/angin dari dokumen operasi', () => {
  const doc = `OPERATIONAL LIMITS
  Under Keel Clearance (UKC) : 1.2 m
  Significant wave height limit : 3.5 m
  Max current : 2.0 kn
  Max wind speed : 30 knots`;
  const r = S.parse(doc);
  assert.strictEqual(r.fields.ukc, 1.2);
  assert.strictEqual(r.fields.hs, 3.5);
  assert.strictEqual(r.fields.cur, 2);
  assert.strictEqual(r.fields.wind, 30);
});

test('parse: batas angin/arus dalam m/s dikonversi ke knot', () => {
  const r = S.parse('MAX WIND 18 m/s\nBATAS ARUS 1.0 m/s');
  assert.ok(Math.abs(r.fields.wind - 34.99) < 0.02);   // 18 m/s -> ~35 kn
  assert.ok(Math.abs(r.fields.cur - 1.94) < 0.02);     // 1 m/s -> ~1,94 kn
});

test('parse: batas di luar rentang tidak diisi, ditandai manual', () => {
  const r = S.parse('WAVE HEIGHT : 35 m\nMAX WIND : 300 knots');   // salah baca
  assert.strictEqual(r.fields.hs, undefined);
  assert.strictEqual(r.fields.wind, undefined);
  assert.ok(r.warnings.some(w => /Batas gelombang/.test(w)) && r.warnings.some(w => /Batas angin/.test(w)));
});

test('parseMany: gabung GA + dokumen batas; UKC default dari sarat', () => {
  const ga = `LENGTH O. A. : 60.000 m\nBREADTH MOULDED (Bm) : 8.100 m\nDESIGN DRAUGHT (d) : 2.57 m\nMAX. SPEED : 28 knots\nKRI KERAMBIT`;
  const lim = `Significant wave height : 3.0 m\nMax wind : 35 knots`;
  const r = S.parseMany([ga, lim]);
  assert.strictEqual(r.fields.loa, 60);
  assert.strictEqual(r.fields.draft, 2.57);
  assert.strictEqual(r.fields.hs, 3);
  assert.strictEqual(r.fields.wind, 35);
  assert.strictEqual(r.fields.name, 'KRI KERAMBIT');
  assert.strictEqual(r.perPhoto.length, 2);
  // UKC tak ada di kedua foto -> dihitung default dari sarat
  assert.strictEqual(r.fields.ukc, undefined);
  assert.strictEqual(S.ukcDefault(2.57), 1);            // maks(1, 0.514) = 1
  assert.strictEqual(S.ukcDefault(8), 1.6);             // 20% dari 8
});

test('parseMany: nilai wajar dari foto pertama dipakai; tidak ditimpa foto lain', () => {
  const r = S.parseMany(['DESIGN DRAUGHT (d) : 2.5 m', 'DESIGN DRAUGHT (d) : 3.1 m']);
  assert.strictEqual(r.fields.draft, 2.5);
});
