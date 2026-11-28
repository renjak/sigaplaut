// SIGAP LAUT – perkiraan data kapal yang kosong, dari data yang terbaca (ukuran kapal).
// Dipakai untuk mengisi awal field yang belum ada di foto, SEBAGAI PERKIRAAN yang wajib diperiksa &
// diedit operator sebelum dipakai. BUKAN pengganti dokumen stabilitas/batas operasi resmi.
// Sifat perkiraan: KONSERVATIF — sarat & UKC cenderung lebih besar (waspada kandas), batas gelombang/
// angin/arus cenderung lebih kecil/ketat (lebih cepat memberi peringatan). Tidak pernah dipakai diam-diam:
// field yang diisi perkiraan ditandai 'perkiraan' agar terlihat jelas dan tercatat di briefing.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapEst = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const r1 = v => Math.round(v * 10) / 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Pita batas gelombang aman menurut panjang kapal (m) — sisi konservatif (cenderung rendah).
  function hsBand(loa) {
    if (loa < 30) return 2.0; if (loa < 50) return 2.5; if (loa < 70) return 3.0;
    if (loa < 90) return 3.5; if (loa < 120) return 4.5; return 5.5;
  }
  // Pita batas angin (knot) menurut panjang — konservatif (cenderung rendah).
  function windBand(loa) { return loa < 50 ? 25 : loa < 90 ? 30 : 35; }

  // known: field yang sudah pasti/terbaca {loa,beam,draft,maxSpeed,...}. Hasil hanya untuk field yang BISA
  // diperkirakan; method per field: 'perkiraan' (dari ukuran) atau 'hitung' (rumus baku, mis. UKC).
  function estimate(known) {
    known = known || {};
    const out = { fields: {}, methods: {}, notes: [] };
    const put = (k, v, m) => { if (v != null && Number.isFinite(v)) { out.fields[k] = v; out.methods[k] = m; } };

    // Sarat: dari lebar (≈0,33×lebar) atau panjang (≈0,05×LOA); ambil yang lebih besar (konservatif).
    let draft = known.draft;
    if (draft == null) {
      const c = [];
      if (known.beam > 0) c.push(0.33 * known.beam);
      if (known.loa > 0) c.push(0.05 * known.loa);
      if (c.length) { draft = clamp(r1(Math.max(...c)), 0.5, 25); put('draft', draft, 'perkiraan'); }
    }
    // UKC: rumus baku dari sarat (maks 1 m atau 20% sarat).
    if (known.ukc == null && draft > 0) put('ukc', Math.max(1, r1(0.2 * draft)), 'hitung');
    // Batas gelombang aman: dari panjang kapal (konservatif).
    if (known.hs == null && known.loa > 0) put('hs', hsBand(known.loa), 'perkiraan');
    // Batas angin: dari panjang kapal (konservatif).
    if (known.wind == null && known.loa > 0) put('wind', windBand(known.loa), 'perkiraan');
    // Batas arus: nilai dasar aman untuk olah gerak di alur (konservatif).
    if (known.cur == null && (known.loa > 0 || known.beam > 0)) put('cur', 2.0, 'perkiraan');
    // Kecepatan jelajah: ~55% kecepatan maks (bila terbaca) — kecepatan ekonomis khas; atau pita dari panjang.
    if (known.speed == null) {
      let sp = null;
      if (known.maxSpeed > 0) sp = clamp(Math.round(0.55 * known.maxSpeed), 2, 45);
      else if (known.loa > 0) sp = known.loa < 50 ? 12 : known.loa < 90 ? 14 : 16;
      put('speed', sp, 'perkiraan');
    }

    return out;
  }

  return { estimate, hsBand, windBand };
});
