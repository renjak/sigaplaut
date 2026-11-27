// SIGAP LAUT – baca/tulis & validasi waypoint (CSV, GeoJSON, teks koordinat). WGS84 / EPSG:4326.
// Prinsip: koordinat tidak pernah diubah diam-diam. Data yang tidak valid DITOLAK dengan pesan per baris.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapWpio = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_WP = 100;
  const AREA = { latMin: -20, latMax: 15, lonMin: 85, lonMax: 150 };   // cakupan layanan (perairan Indonesia)

  // Teks koordinat: desimal (-7.25 / -7,25) atau derajat-menit(-detik) dengan arah (7°15'S, 112°45.5'E, 7 15 S).
  function parseCoord(str) {
    const s = String(str == null ? '' : str).trim().toUpperCase().replace(',', '.');
    if (!s) return NaN;
    if (/^[-+]?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
    const m = s.match(/^([-+]?\d+(?:\.\d+)?)\s*[°D ]\s*(?:(\d+(?:\.\d+)?)\s*['M′]?\s*)?(?:(\d+(?:\.\d+)?)\s*["″S]?\s*)?([NSEWUTLB])?$/);
    if (!m) return NaN;
    const deg = parseFloat(m[1]), min = parseFloat(m[2]) || 0, sec = parseFloat(m[3]) || 0;
    if (min >= 60 || sec >= 60) return NaN;
    let v = Math.abs(deg) + min / 60 + sec / 3600;
    const h = m[4] || '';
    if (h === 'S' || h === 'W' || h === 'B' || deg < 0) v = -v;   // B = barat, S = selatan
    return v;
  }
  const decimals = s => { const m = String(s).trim().replace(',', '.').match(/^[-+]?\d+\.(\d+)$/); return m ? m[1].length : null; };

  // Validasi daftar waypoint [{lat, lon, name?, speed?, latText?, lonText?, line?}]
  function validate(list) {
    const errors = [], warnings = [];
    const where = (w, i) => (w.line ? `baris ${w.line}` : `WP${i + 1}`);
    if (list.length < 2) errors.push('Minimal 2 waypoint.');
    if (list.length > MAX_WP) errors.push(`Maksimal ${MAX_WP} waypoint (ada ${list.length}). Bagi menjadi beberapa leg.`);
    list.forEach((w, i) => {
      if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon)) { errors.push(`${where(w, i)}: koordinat tidak terbaca (${w.latText ?? w.lat}, ${w.lonText ?? w.lon}).`); return; }
      if (w.lat < -90 || w.lat > 90) errors.push(`${where(w, i)}: lintang ${w.lat} di luar −90…90.`);
      if (w.lon < -180 || w.lon > 180) errors.push(`${where(w, i)}: bujur ${w.lon} di luar −180…180.`);
      else if (w.lat < AREA.latMin || w.lat > AREA.latMax || w.lon < AREA.lonMin || w.lon > AREA.lonMax)
        errors.push(`${where(w, i)}: (${w.lat}, ${w.lon}) di luar cakupan perairan Indonesia (lintang ${AREA.latMin}…${AREA.latMax}, bujur ${AREA.lonMin}…${AREA.lonMax}).`);
      if (w.speed != null && !(w.speed >= 2 && w.speed <= 45)) errors.push(`${where(w, i)}: kecepatan ${w.speed} kn di luar 2…45.`);
      const dLat = w.latText != null ? decimals(w.latText) : null, dLon = w.lonText != null ? decimals(w.lonText) : null;
      if ((dLat != null && dLat < 3) || (dLon != null && dLon < 3)) warnings.push(`${where(w, i)}: presisi koordinat rendah (< 3 desimal ≈ ±110 m).`);
      if (i > 0) {
        const p = list[i - 1];
        if (p.lat === w.lat && p.lon === w.lon) errors.push(`${where(w, i)}: sama persis dengan titik sebelumnya (duplikat berurutan).`);
      }
    });
    return { ok: errors.length === 0, errors, warnings };
  }

  function splitCsvLine(line, delim) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }

  // CSV dengan header. Kolom dikenali: seq/no/urutan, name/nama, lat/lintang, lon/lng/bujur, speed/speed_kn/kecepatan.
  // Pemisah koma atau titik koma (Excel Indonesia); dengan titik koma, koma desimal diterima.
  function parseCsv(text) {
    const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.trim() && !x.l.trim().startsWith('#'));
    if (!lines.length) return { list: [], errors: ['Berkas CSV kosong.'] };
    const delim = (lines[0].l.match(/;/g) || []).length > (lines[0].l.match(/,/g) || []).length ? ';' : ',';
    const head = splitCsvLine(lines[0].l, delim).map(h => h.toLowerCase().replace(/[^a-z_]/g, ''));
    const col = names => head.findIndex(h => names.includes(h));
    const c = { seq: col(['seq', 'no', 'urutan', 'sequence']), name: col(['name', 'nama', 'wp', 'waypoint']), lat: col(['lat', 'lintang', 'latitude']), lon: col(['lon', 'lng', 'long', 'bujur', 'longitude']), speed: col(['speed', 'speedkn', 'speed_kn', 'kecepatan', 'knot']) };
    if (c.lat < 0 || c.lon < 0) return { list: [], errors: ['Header CSV harus memuat kolom lat/lintang dan lon/bujur.'] };
    const errors = [];
    const list = lines.slice(1).map(({ l, n }) => {
      const f = splitCsvLine(l, delim);
      const sp = c.speed >= 0 && f[c.speed] !== '' && f[c.speed] != null ? Number(String(f[c.speed]).replace(',', '.')) : null;
      return { line: n, seq: c.seq >= 0 && f[c.seq] !== '' ? Number(f[c.seq]) : null, name: c.name >= 0 ? f[c.name] || '' : '',
        latText: f[c.lat], lonText: f[c.lon], lat: parseCoord(f[c.lat]), lon: parseCoord(f[c.lon]), speed: sp };
    });
    return orderBySeq(list, errors);
  }

  function orderBySeq(list, errors) {
    if (list.some(w => w.seq != null)) {
      if (list.some(w => w.seq == null || !Number.isInteger(w.seq))) errors.push('Kolom urutan harus terisi bilangan bulat di semua baris.');
      else {
        const seen = new Set();
        list.forEach(w => { if (seen.has(w.seq)) errors.push(`Urutan ${w.seq} ganda (baris ${w.line || '?'}).`); seen.add(w.seq); });
        list = list.slice().sort((a, b) => a.seq - b.seq);
      }
    }
    return { list, errors };
  }

  // GeoJSON: LineString / MultiPoint, Feature, atau FeatureCollection berisi Point (properties: seq, name, speed_kn).
  // Koordinat GeoJSON = [bujur, lintang]. Urutan terbalik terdeteksi & ditolak (tidak ditukar otomatis).
  function parseGeoJson(text) {
    let g;
    try { g = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { return { list: [], errors: ['GeoJSON tidak valid: ' + e.message] }; }
    const errors = [];
    const pts = [];
    const add = (c, props, label) => {
      if (!Array.isArray(c) || c.length < 2) { errors.push(`${label}: koordinat tidak lengkap.`); return; }
      const [lon, lat] = c;
      pts.push({ line: null, label, lat: Number(lat), lon: Number(lon), latText: String(lat), lonText: String(lon),
        name: props && (props.name || props.nama) || '', seq: props && props.seq != null ? Number(props.seq) : null,
        speed: props && (props.speed_kn ?? props.speed) != null ? Number(props.speed_kn ?? props.speed) : null });
    };
    const geom = (gm, props, label) => {
      if (!gm) return errors.push(`${label}: geometri kosong.`);
      if (gm.type === 'Point') add(gm.coordinates, props, label);
      else if (gm.type === 'LineString' || gm.type === 'MultiPoint') gm.coordinates.forEach((c, i) => add(c, null, `${label} titik ${i + 1}`));
      else errors.push(`${label}: tipe geometri ${gm.type} tidak didukung (pakai Point/LineString).`);
    };
    if (g.type === 'FeatureCollection') {
      const feats = g.features || [];
      const hasPoints = feats.some(f => f.geometry && f.geometry.type === 'Point');
      feats.filter(f => !hasPoints || (f.geometry && f.geometry.type === 'Point')).forEach((f, i) => geom(f.geometry, f.properties, `fitur ${i + 1}`));
    } else if (g.type === 'Feature') geom(g.geometry, g.properties, 'fitur');
    else geom(g, null, 'geometri');
    // Deteksi urutan terbalik [lintang, bujur] untuk wilayah Indonesia.
    if (pts.length && pts.every(p => Math.abs(p.lon) <= 20 && p.lat >= 85 && p.lat <= 150)) {
      errors.push('Koordinat tampaknya tertulis [lintang, bujur]. GeoJSON wajib [bujur, lintang] (RFC 7946). Perbaiki berkas; aplikasi tidak menukar otomatis.');
    }
    pts.forEach(p => { p.line = null; });
    const r = orderBySeq(pts, errors);
    r.list.forEach((p, i) => { if (!p.label) p.label = `titik ${i + 1}`; });
    return r;
  }

  // Ekspor. rows: [{seq,name,lat,lon,speed,legNm,bearing,etaMs}]
  const q = v => /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  function toCsv(rows) {
    const head = ['seq', 'name', 'lat', 'lon', 'speed_kn', 'leg_nm', 'bearing_deg_true', 'eta_utc'];
    return [head.join(',')].concat(rows.map(r => [r.seq, q(r.name || ''), r.lat.toFixed(6), r.lon.toFixed(6), r.speed ?? '',
      r.legNm == null ? '' : r.legNm.toFixed(2), r.bearing == null ? '' : r.bearing.toFixed(1), r.etaMs ? new Date(r.etaMs).toISOString() : ''].join(','))).join('\n') + '\n';
  }
  function toGeoJson(rows, meta) {
    const props = r => ({ seq: r.seq, name: r.name || `WP${r.seq}`, speed_kn: r.speed ?? null, leg_nm: r.legNm == null ? null : +r.legNm.toFixed(2),
      bearing_deg_true: r.bearing == null ? null : +r.bearing.toFixed(1), eta_utc: r.etaMs ? new Date(r.etaMs).toISOString() : null });
    return {
      type: 'FeatureCollection',
      properties: Object.assign({ crs: 'EPSG:4326', coordinate_order: '[lon, lat]', generator: 'SIGAP LAUT' }, meta || {}),
      features: [{ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: rows.map(r => [+r.lon.toFixed(6), +r.lat.toFixed(6)]) } }]
        .concat(rows.map(r => ({ type: 'Feature', properties: props(r), geometry: { type: 'Point', coordinates: [+r.lon.toFixed(6), +r.lat.toFixed(6)] } })))
    };
  }

  return { MAX_WP, AREA, parseCoord, validate, parseCsv, parseGeoJson, toCsv, toGeoJson };
});
