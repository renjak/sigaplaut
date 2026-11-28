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

test('parse: teks tanpa dimensi -> tidak ada field, ada peringatan', () => {
  const r = S.parse('foto buram tanpa teks jelas');
  assert.deepStrictEqual(r.found, []);
  assert.ok(r.warnings.length > 0);
});
