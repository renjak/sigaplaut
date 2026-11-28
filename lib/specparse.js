// SIGAP LAUT – baca spesifikasi & batas operasi kapal dari teks OCR (bisa gabung beberapa foto).
// Dimensi (LOA/lebar/sarat/kecepatan maks) biasanya di "Main Dimension" gambar rencana umum.
// Batas keselamatan (UKC, batas gelombang/arus/angin) biasanya di dokumen stabilitas/perintah operasi.
// PRINSIP KESELAMATAN: hanya isi nilai yang lolos rentang wajar; nilai di luar rentang (mis. desimal
// salah baca) TIDAK diisi, hanya ditandai agar diisi manual. Tidak pernah menebak/menghitung batas
// keselamatan dari dimensi — hanya UKC yang boleh dihitung default (itu pun wajib dikonfirmasi).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapSpec = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RANGE = { loa: [3, 400], beam: [1, 80], draft: [0.2, 25], maxSpeed: [2, 60],
    ukc: [0.3, 10], hs: [0.3, 15], cur: [0.3, 10], wind: [5, 80] };
  const LABEL = {
    loa: /LENGTH\s*O\.?\s*A\b/, beam: /BREADTH\s*MOULDED/,
    draft: /DESIGN\s*DRAU\w*\s*\(?\s*D\s*\)?/,                 // "DESIGN DRAUGHT (d)" — bukan "LPP AT DESIGN DRAUGHT"
    maxSpeed: /MAX\.?\s*SPEED/,
    ukc: /UNDER[\s-]*KEEL[\s-]*CLEARANCE|\bUKC\b|RUANG\s*BAWAH\s*LUNAS/,
    hs: /WAVE\s*HEIGHT|SIGNIFICANT\s*WAVE|TINGGI\s*GELOMBANG|BATAS\s*GELOMBANG|GELOMBANG\s*(?:MAKS|AMAN)\w*|\bHS\s*(?:MAX|MAKS)/,
    cur: /CURRENT\s*(?:SPEED\s*)?(?:LIMIT|MAX)?|ARUS\s*(?:MAKS\w*|LIMIT)?|BATAS\s*ARUS|MAX\w*\s*CURRENT/,
    wind: /WIND\s*(?:SPEED\s*)?(?:LIMIT|MAX)?|ANGIN\s*(?:MAKS\w*|LIMIT)?|BATAS\s*ANGIN|MAX\w*\s*WIND/
  };
  const NAMES = { loa: 'LOA', beam: 'Lebar', draft: 'Sarat', maxSpeed: 'Kecepatan maks.',
    ukc: 'UKC', hs: 'Batas gelombang', cur: 'Batas arus', wind: 'Batas angin' };
  const CONV = { wind: true, cur: true };                     // boleh konversi m/s & km/j ke knot

  // Angka pertama setelah label + satuan opsional. Untuk angin/arus, konversi m/s & km/j ke knot.
  function val(after, key) {
    const m = after.replace(/,/g, '.').match(/([0-9]+(?:\.[0-9]+)?)\s*(KNOTS?|KTS?|KN|M\/?S|MPS|KM\/?H)?/);
    if (!m) return null;
    let v = parseFloat(m[1]); const u = (m[2] || '').toUpperCase().replace(/\s/g, '');
    if (CONV[key]) { if (u === 'M/S' || u === 'MS' || u === 'MPS') v *= 1.94384; else if (u === 'KM/H' || u === 'KMH') v /= 1.852; }
    return v;
  }

  function parse(text) {
    const up = String(text || '').toUpperCase();
    const lines = up.split(/\n/);
    const fields = {}, warnings = [], lowConf = [];
    for (const key of Object.keys(LABEL)) {
      const re = LABEL[key];
      const line = lines.find(l => re.test(l) && !/LPP/.test(l));
      if (!line) continue;
      const mm = line.match(re);
      const after = line.slice(line.indexOf(mm[0]) + mm[0].length);
      const v = val(after, key);
      if (v == null) continue;
      const [lo, hi] = RANGE[key];
      if (v >= lo && v <= hi) fields[key] = Math.round(v * 100) / 100;
      else lowConf.push(NAMES[key]);                           // terbaca tapi di luar rentang -> jangan isi
    }
    const nm = up.match(/\bKRI\s+([A-Z]{3,}(?:\s+[A-Z]{3,})?)\b/);
    if (nm) fields.name = 'KRI ' + nm[1].replace(/\s+/g, ' ').trim();
    if (lowConf.length) warnings.push(`Angka berikut terbaca tapi tidak wajar (kemungkinan salah baca OCR), isi manual: ${lowConf.join(', ')}.`);
    return { fields, warnings, found: Object.keys(fields) };
  }

  // Gabung beberapa foto: nilai pertama yang wajar untuk tiap field menang; warning digabung.
  function parseMany(texts) {
    const all = (Array.isArray(texts) ? texts : [texts]).map(parse);
    const fields = {}, warnings = [];
    all.forEach(r => {
      for (const k in r.fields) if (fields[k] == null) fields[k] = r.fields[k];
      r.warnings.forEach(w => { if (!warnings.includes(w)) warnings.push(w); });
    });
    return { fields, warnings, found: Object.keys(fields), perPhoto: all.map(r => r.found) };
  }

  // UKC default (bila tak terdeteksi) = maks(1 m, 20% sarat). WAJIB dikonfirmasi operator.
  const ukcDefault = draft => (draft > 0 ? Math.max(1, Math.round(0.2 * draft * 10) / 10) : null);

  return { parse, parseMany, ukcDefault, RANGE, LABEL, NAMES };
});
