// SIGAP LAUT – penyaring bahaya kedangkalan di sepanjang rute.
// Grid: ETOPO 2022 (lihat scripts/build-depth-grid.js), datum ±MSL, resolusi ±925 m. BUKAN untuk navigasi.
// Prinsip: konservatif. Grid global tidak mengenal alur pelabuhan dan sering keliru di perairan dangkal,
// jadi hasil "tidak ada temuan" BUKAN berarti aman; peta laut Pushidrosal tetap wajib.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapDepth = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const STEP_NM = 0.25;          // jarak antartitik periksa (±460 m, lebih rapat dari sel grid ±925 m)
  const PORT_ZONE_NM = 3;        // radius sekitar titik awal/akhir yang dianggap alur pelabuhan
  const TIDE_ALLOW_M = 1.5;      // cadangan surut di bawah MSL
  const UNCERT_M = 5;            // cadangan ketidakpastian grid untuk tingkat WASPADA
  const NO_DRAFT_WARN_M = 10;    // tanpa sarat: kedalaman < 10 m diberi catatan

  function nm(a, b) {
    const R = 3440.065, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Kedalaman (m) di titik: 0 = daratan/kering, Infinity = >254 m, null = di luar cakupan grid.
  function depthAt(g, lat, lon) {
    const i = Math.floor((lat - g.lat0) * g.res), j = Math.floor((lon - g.lon0) * g.res);
    if (i < 0 || j < 0 || i >= g.nlat || j >= g.nlon) return null;
    const v = g.data[i * g.nlon + j];
    return v === 255 ? Infinity : v;
  }

  // Titik periksa rapat di sepanjang rute.
  function profile(wps, g, step) {
    step = step || STEP_NM;
    const out = [];
    let cum = 0;
    for (let s = 0; s < wps.length - 1; s++) {
      const a = wps[s], b = wps[s + 1], d = nm(a, b), n = Math.max(1, Math.ceil(d / step));
      for (let k = 0; k < n; k++) {
        const f = k / n, lat = a[0] + (b[0] - a[0]) * f, lon = a[1] + (b[1] - a[1]) * f;
        out.push({ lat, lon, cum: cum + d * f, seg: s, depth: depthAt(g, lat, lon) });
      }
      cum += d;
    }
    const last = wps[wps.length - 1];
    out.push({ lat: last[0], lon: last[1], cum, seg: wps.length - 2, depth: depthAt(g, last[0], last[1]) });
    return out;
  }

  function thresholds(draft) {
    if (!(draft > 0)) return { draft: null, ukc: null, red: null, amber: NO_DRAFT_WARN_M };
    const ukc = Math.max(1, 0.2 * draft);
    const red = draft + ukc + TIDE_ALLOW_M;
    return { draft, ukc, tide: TIDE_ALLOW_M, red, amber: red + UNCERT_M };
  }

  // Kelompokkan titik berurutan dengan kategori sama menjadi satu bentang.
  function stretches(points, cat) {
    const out = [];
    let cur = null;
    points.forEach(p => {
      if (p.cat === cat) {
        if (!cur) { cur = { cat, from: p.cum, to: p.cum, seg: p.seg, min: p.depth, at: [p.lat, p.lon] }; out.push(cur); }
        cur.to = p.cum;
        if (p.depth < cur.min) { cur.min = p.depth; cur.at = [p.lat, p.lon]; cur.seg = p.seg; }
      } else cur = null;
    });
    return out;
  }

  // Penilaian rute. level: 'r' bahaya, 'a' waspada, 'g' tidak ada temuan, 'x' sebagian di luar grid.
  function assess(wps, g, draft) {
    const th = thresholds(draft);
    const pts = profile(wps, g);
    const total = pts[pts.length - 1].cum;
    pts.forEach(p => {
      const inPort = p.cum <= PORT_ZONE_NM || total - p.cum <= PORT_ZONE_NM;
      if (p.depth === null) p.cat = 'unknown';
      else if (inPort) p.cat = p.depth === 0 || (th.red != null ? p.depth < th.red : p.depth < th.amber) ? 'port' : 'ok';
      else if (p.depth === 0) p.cat = 'land';
      else if (th.red != null && p.depth < th.red) p.cat = 'red';
      else if (p.depth < th.amber) p.cat = 'amber';
      else p.cat = 'ok';
    });
    const sea = pts.filter(p => p.depth !== null && p.cat !== 'port');
    const minP = sea.reduce((m, p) => (m == null || p.depth < m.depth ? p : m), null);
    const res = {
      thresholds: th, portZoneNm: PORT_ZONE_NM, stepNm: STEP_NM, checked: pts.length, totalNm: total,
      land: stretches(pts, 'land'), red: stretches(pts, 'red'), amber: stretches(pts, 'amber'),
      port: stretches(pts, 'port'), unknown: stretches(pts, 'unknown'),
      minDepth: minP ? minP.depth : null, minAt: minP ? [minP.lat, minP.lon] : null
    };
    res.level = res.land.length || res.red.length ? 'r'
      : res.amber.length && th.red != null ? 'a'
      : res.unknown.length ? 'x'
      : 'g';
    // Tanpa sarat kapal, perairan < 10 m hanya catatan (tidak bisa dinilai terhadap kapal).
    res.noDraftShallow = th.red == null && res.amber.length > 0;
    return res;
  }

  // Grid dari buffer Uint8 + metadata.
  const makeGrid = (data, meta) => ({ data, lat0: meta.lat0, lon0: meta.lon0, res: meta.res, nlat: meta.nlat, nlon: meta.nlon });

  return { STEP_NM, PORT_ZONE_NM, TIDE_ALLOW_M, UNCERT_M, NO_DRAFT_WARN_M, depthAt, profile, thresholds, assess, makeGrid };
});
