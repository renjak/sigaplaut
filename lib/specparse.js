// SIGAP LAUT – baca spesifikasi kapal dari teks OCR tabel "MAIN DIMENSION" (General Arrangement).
// Prinsip keselamatan: hanya isi nilai yang lolos rentang wajar; nilai di luar rentang (mis. desimal salah baca
// 2,57 -> 257) TIDAK diisi, tapi ditandai agar operator mengisi manual. Tidak menebak angka kritis.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapSpec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Rentang wajar (sama dengan form kapal).
  const RANGE = { loa: [3, 400], beam: [1, 80], draft: [0.2, 25], maxSpeed: [2, 60] };
  const LABEL = {
    loa: /LENGTH\s*O\.?\s*A\b/, beam: /BREADTH\s*MOULDED/,
    draft: /DESIGN\s*DRAU\w*\s*\(?\s*D\s*\)?/,            // "DESIGN DRAUGHT (d)" — bukan "LPP AT DESIGN DRAUGHT"
    maxSpeed: /MAX\.?\s*SPEED/
  };
  const NAMES = { loa: 'LOA', beam: 'Lebar', draft: 'Sarat', maxSpeed: 'Kecepatan maks.' };

  // Angka pertama setelah label pada baris yang sama (boleh ada ":" atau spasi), desimal titik.
  function numAfter(line) {
    const m = line.replace(/,/g, '.').match(/:?\s*([0-9]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  function parse(text) {
    const up = String(text || '').toUpperCase();
    const lines = up.split(/\n/);
    const fields = {}, warnings = [], lowConf = [];

    for (const key of Object.keys(LABEL)) {
      const re = LABEL[key];
      const line = lines.find(l => re.test(l) && !/LPP/.test(l));   // abaikan baris LPP AT DESIGN DRAUGHT
      if (!line) continue;
      const after = line.slice(line.search(re) + (line.match(re)[0].length));
      const v = numAfter(after);
      if (v == null) continue;
      const [lo, hi] = RANGE[key];
      if (v >= lo && v <= hi) fields[key] = Math.round(v * 100) / 100;
      else lowConf.push(NAMES[key]);                                 // terbaca tapi di luar rentang (kemungkinan salah baca)
    }

    // Nama kapal: "KRI <NAMA>" (satu/dua kata huruf besar).
    const nm = up.match(/\bKRI\s+([A-Z]{3,}(?:\s+[A-Z]{3,})?)\b/);
    if (nm) fields.name = 'KRI ' + nm[1].replace(/\s+/g, ' ').trim();

    if (lowConf.length) warnings.push(`Angka berikut terbaca tapi tidak wajar (kemungkinan salah baca OCR), isi manual: ${lowConf.join(', ')}.`);
    const missing = Object.keys(NAMES).filter(k => fields[k] == null && !lowConf.includes(NAMES[k]));
    if (missing.length) warnings.push(`Tidak ditemukan di foto: ${missing.map(k => NAMES[k]).join(', ')}. Isi manual bila perlu.`);
    return { fields, warnings, found: Object.keys(fields) };
  }

  return { parse, RANGE, LABEL };
});
