// SIGAP LAUT – logika perhitungan rute (dipakai di browser dan diuji di Node).
// Prinsip: konservatif. Data kosong, data usang, atau model yang hilang TIDAK boleh menghasilkan "AMAN".
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapRoute = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP_NM = 20;
  const STALE_MS = 6 * 3600e3;          // data lebih tua dari 6 jam = usang
  const PORT_MAX_NM = 30;               // pelabuhan BMKG terdekat yang masih relevan
  const RANK = { x: 0, g: 1, a: 2, r: 3 };
  const BEST_MATCH = 'Open-Meteo (best match)';

  function nm(a, b) {
    const R = 3440.065, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Titik bantu tiap STEP_NM di sepanjang rute, termasuk semua waypoint.
  function buildSamples(wps, step) {
    step = step || STEP_NM;
    const out = [];
    if (!wps || wps.length < 2) return out;
    let cum = 0;
    for (let i = 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1], d = nm(a, b), n = Math.max(1, Math.ceil(d / step));
      for (let k = 0; k < n; k++) {
        const f = k / n;
        out.push({ lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, cum: cum + d * f, wp: k === 0 ? i : null, seg: i });
      }
      cum += d;
    }
    const last = wps[wps.length - 1];
    out.push({ lat: last[0], lon: last[1], cum, wp: wps.length - 1, seg: wps.length - 2 });
    return out;
  }
  const keyOf = samples => samples.map(p => p.lat.toFixed(2) + ',' + p.lon.toFixed(2)).join(';');

  // Nilai per jam terdekat. undefined = di luar jangkauan waktu data; null = data kosong.
  function valAt(pt, field, ms) {
    if (!pt || !pt.t || !pt.t.length) return undefined;
    const i = Math.round((ms - pt.t[0]) / 3600e3);
    if (i < 0 || i >= pt.t.length) return undefined;
    const v = (pt[field] || [])[i];
    return v == null ? null : v;
  }

  // Status satu titik. 'x' = tanpa data gelombang.
  function verdict(r, margin, ship) {
    if (r.hs === undefined || r.hs === null) return 'x';
    const e = r.hs + margin;
    let v = 'g';
    if (e > ship.hs) return 'r';
    if (e > 0.8 * ship.hs) v = 'a';
    if (ship.wind && r.w != null) { if (r.w > ship.wind) return 'r'; if (r.w > 0.8 * ship.wind) v = 'a'; }
    if (ship.cur && r.cur != null && r.cur > ship.cur) v = 'a';
    // Batas angin/arus diisi tetapi datanya kosong: tidak bisa dinyatakan aman.
    if (v === 'g' && ((ship.wind && r.w == null) || (ship.cur && r.cur == null))) v = 'a';
    return v;
  }

  // Masalah kualitas data yang tidak bergantung pada jam berangkat.
  // level 'down' = status AMAN diturunkan menjadi WASPADA; 'info' = catatan saja.
  function dataQuality(samples, data, ship, now) {
    const issues = [];
    if (!data || !data.pts) return issues;
    if (data.at && now - data.at > STALE_MS) {
      issues.push({ code: 'stale', level: 'down', text: `Data prakiraan sudah usang (diambil ${Math.round((now - data.at) / 3600e3)} jam lalu). Tekan "Hitung prakiraan rute" untuk memperbarui.` });
    }
    const realWave = (data.waveModels || []).filter(m => m !== BEST_MATCH);
    if (!(data.waveModels || []).length) {
      issues.push({ code: 'noWave', level: 'down', text: 'Tidak ada model gelombang yang memberi data.' });
    } else if (realWave.length <= 1) {
      issues.push({ code: 'oneWave', level: 'info', text: `Hanya ${realWave.length ? '1 model gelombang (' + realWave[0] + ')' : 'prakiraan gabungan Open-Meteo'} yang tersedia di rute ini; tidak ada pembanding antarmodel.` });
    }
    if (data.windOk === false || !(data.windModels || []).length) {
      issues.push({ code: 'noWind', level: ship && ship.wind ? 'down' : 'info', text: 'Model angin gagal/tidak tersedia: angin dan hembusan tidak dapat diperiksa terhadap batas kapal.' });
    }
    if (data.windBackup) {
      issues.push({ code: 'windBackup', level: 'info', text: 'Model angin utama gagal; angin diambil dari sumber cadangan MET Norway (model ECMWF) tanpa data hembusan. Setelah ±60 jam data per 6 jam: dipakai nilai terbesar di antara dua jam.' });
    }
    // Resolusi: beberapa titik rute berbeda jatuh di sel grid model yang sama.
    const cells = new Map();
    samples.forEach((p, i) => {
      const c = data.pts[i] && data.pts[i].cell;
      if (!c) return;
      const k = c[0].toFixed(3) + ',' + c[1].toFixed(3), pos = p.lat.toFixed(3) + ',' + p.lon.toFixed(3);
      if (!cells.has(k)) cells.set(k, new Set());
      cells.get(k).add(pos);
    });
    const shared = [...cells.values()].filter(s => s.size > 1).reduce((n, s) => n + s.size, 0);
    if (shared) {
      issues.push({ code: 'coarse', level: 'info', text: `${shared} titik rute berada di sel grid model yang sama (±8–25 km): nilai adalah rata-rata area, bukan kondisi lokal alur. Data model kasar — cek prakiraan pelabuhan BMKG & kondisi lokal.` });
    }
    // Pantai/selat sempit: sebagian model menganggap titik ini daratan (jumlah model lebih sedikit dari maksimum rute).
    const counts = samples.map((_, i) => data.pts[i] && Array.isArray(data.pts[i].wm) ? data.pts[i].wm.filter(m => m !== BEST_MATCH).length : null);
    const known = counts.filter(c => c != null);
    if (known.length) {
      const max = Math.max(...known);
      const coastal = counts.map((c, i) => (c != null && c < max) ? i : -1).filter(i => i >= 0);
      if (coastal.length) {
        issues.push({ code: 'coastal', level: 'info', text: `${coastal.length} titik dekat pantai/selat sempit: sebagian model gelombang menganggapnya daratan. Data model kasar — cek prakiraan pelabuhan BMKG & kondisi lokal.` });
      }
    }
    return issues;
  }

  // Hitung satu pelayaran untuk jam berangkat tertentu.
  function trip(samples, data, ship, depart, speed, margin, quality) {
    const rows = samples.map((p, i) => {
      const eta = depart + p.cum / speed * 3600e3, pt = data.pts[i];
      return { p, eta, hs: valAt(pt, 'hx', eta), hn: valAt(pt, 'hn', eta), sw: valAt(pt, 'sw', eta), tp: valAt(pt, 'tp', eta), cur: valAt(pt, 'cur', eta), w: valAt(pt, 'w', eta), g: valAt(pt, 'g', eta) };
    });
    rows.forEach(r => { r.vd = verdict(r, margin, ship); });
    const out = rows.some(r => r.hs === undefined);          // sebagian rute di luar jangkauan waktu prakiraan
    const missing = rows.filter(r => r.hs === null).length;   // titik tanpa data gelombang
    const windMissing = !!ship.wind && rows.some(r => r.hs != null && r.w == null);
    const curMissing = !!ship.cur && rows.some(r => r.hs != null && r.cur == null);
    let worst = 'g', maxE = -1, at = null, maxC = -1, atC = null, maxW = -1, atW = null, spread = 0, atS = null;
    rows.forEach(r => {
      if (r.vd !== 'x' && RANK[r.vd] > RANK[worst]) worst = r.vd;
      if (r.hs != null && r.hs + margin > maxE) { maxE = r.hs + margin; at = r; }
      if (r.cur != null && r.cur > maxC) { maxC = r.cur; atC = r; }
      if (r.w != null && r.w > maxW) { maxW = r.w; atW = r; }
      if (r.hs != null && r.hn != null && r.hs - r.hn > spread) { spread = r.hs - r.hn; atS = r; }
    });
    const reasons = [];
    if (missing) reasons.push(`${missing} titik tanpa data gelombang`);
    if (out) reasons.push('sebagian rute di luar jangkauan waktu prakiraan');
    if (windMissing) reasons.push('data angin kosong padahal batas angin diisi');
    if (curMissing) reasons.push('data arus kosong padahal batas arus diisi');
    (quality || []).filter(q => q.level === 'down').forEach(q => reasons.push(q.code === 'stale' ? 'data usang' : q.code === 'noWind' ? 'model angin gagal' : 'model gelombang tidak tersedia'));
    let downgraded = false;
    if (rows.every(r => r.hs == null)) worst = 'x';
    else if (worst === 'g' && reasons.length) { worst = 'a'; downgraded = true; }
    if (worst === 'a' && !downgraded && reasons.length && rows.every(r => r.vd === 'g' || r.vd === 'x' || (r.vd === 'a' && ((ship.wind && r.w == null) || (ship.cur && r.cur == null))))) downgraded = true;
    return { rows, worst, maxE, at, maxC, atC, maxW, atW, spread, atS, out, missing, windMissing, curMissing, reasons, downgraded };
  }

  // Jendela berangkat: dicoba tiap stepH jam mulai dari start.
  function windows(samples, data, ship, start, speed, margin, quality, opts) {
    const stepH = (opts && opts.stepH) || 3, max = (opts && opts.max) || 64;
    const slots = [];
    for (let k = 0; k < max; k++) {
      const d = start + k * stepH * 3600e3, t = trip(samples, data, ship, d, speed, margin, quality);
      slots.push({ d, vd: t.out ? 'x' : t.worst, maxE: t.maxE, downgraded: t.downgraded });
      if (t.out && slots.filter(s => s.vd === 'x').length > 2) break;
    }
    const best = slots.find(s => s.vd === 'g') || slots.filter(s => s.vd !== 'x').sort((a, b) => RANK[a.vd] - RANK[b.vd] || a.maxE - b.maxE)[0] || null;
    return { slots, best };
  }

  // Catatan untuk komandan (urutan tetap, teks siap tampil).
  function notesFor(T, ship, total, speed, fmt) {
    const f1 = fmt.f1, fn = fmt.fn, seg = r => `WP${r.p.seg + 1}–WP${r.p.seg + 2}`;
    const notes = [];
    if (T.downgraded) notes.push(`Status diturunkan dari AMAN menjadi WASPADA karena: ${T.reasons.join('; ')}.`);
    else if (T.reasons.length) notes.push(`Kelengkapan data: ${T.reasons.join('; ')}.`);
    if (ship.range && total > ship.range) notes.push(`Panjang rute ${Math.round(total)} NM melebihi jarak jelajah kapal ${fn(ship.range)} NM. Rencanakan pengisian bahan bakar.`);
    if (ship.cur && T.maxC > ship.cur) notes.push(`Arus maks. ${f1(T.maxC)} kn di ${seg(T.atC)} melebihi batas arus ${fn(ship.cur)} kn.`);
    if (ship.draft) notes.push(`Sarat ${fn(ship.draft)} m: periksa kedalaman alur dan pelabuhan pada peta laut.`);
    if (ship.wind && T.maxW > ship.wind) notes.push(`Angin maks. ${Math.round(T.maxW)} kn di ${seg(T.atW)} melebihi batas angin ${fn(ship.wind)} kn.`);
    if (T.spread > 0.5) notes.push(`Model berbeda hingga ${f1(T.spread)} m di ${seg(T.atS)}: ketidakpastian tinggi, pantau pembaruan.`);
    if (speed > ship.speed) notes.push(`Kecepatan rencana ${f1(speed)} kn di atas kecepatan jelajah ${fn(ship.speed)} kn.`);
    return notes;
  }

  // Pelabuhan BMKG terdekat (daftar: [{c,n,la,lo}]).
  function nearestPort(pt, ports, maxNm) {
    maxNm = maxNm == null ? PORT_MAX_NM : maxNm;
    let best = null;
    (ports || []).forEach(p => { const d = nm(pt, [p.la, p.lo]); if (d <= maxNm && (!best || d < best.d)) best = { port: p, d }; });
    return best;
  }
  const portUrl = code => 'https://www.bmkg.go.id/cuaca/maritim/pelabuhan/' + encodeURIComponent(code);

  return { STEP_NM, STALE_MS, PORT_MAX_NM, RANK, BEST_MATCH, nm, buildSamples, keyOf, valAt, verdict, dataQuality, trip, windows, notesFor, nearestPort, portUrl };
});
