// SIGAP LAUT – penilaian ruang-waktu peringatan (poligon) terhadap rute.
// Menjawab: seberapa dekat ke rute, di ruas mana, kapan kapal tiba di titik terdekat,
// dan apakah peringatan masih berlaku saat itu. Rute diperiksa tiap 1 NM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./geo.js'));
  else root.SigapHazard = factory(root.SigapGeo);
})(typeof self !== 'undefined' ? self : this, function (GEO) {
  const DENSE_NM = 1;
  const NM_PER_DEG_LAT = 60;   // proyeksi lokal (equirectangular) hanya untuk jarak pendek ke tepi poligon

  // Titik rapat di sepanjang rute dengan jam tempuh. speed: angka knot atau fungsi seg -> knot.
  function densify(wps, speed, step) {
    step = step || DENSE_NM;
    const spd = typeof speed === 'function' ? speed : () => speed;
    const out = [];
    let cum = 0, hrs = 0;
    for (let s = 0; s < wps.length - 1; s++) {
      const a = wps[s], b = wps[s + 1], d = GEO.distNm(a, b), n = Math.max(1, Math.ceil(d / step)), v = spd(s);
      for (let k = 0; k < n; k++) {
        const f = k / n;
        out.push({ lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, cum: cum + d * f, h: hrs + d * f / v, seg: s });
      }
      cum += d; hrs += d / v;
    }
    const last = wps[wps.length - 1];
    out.push({ lat: last[0], lon: last[1], cum, h: hrs, seg: wps.length - 2 });
    return out;
  }

  function inside(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  // Jarak (NM) titik ke tepi poligon; 0 bila di dalam.
  function distToPoly(pt, poly) {
    if (inside(pt, poly)) return 0;
    const k = Math.cos(pt[0] * Math.PI / 180);
    const P = q => [(q[1] - pt[1]) * k * NM_PER_DEG_LAT, (q[0] - pt[0]) * NM_PER_DEG_LAT];
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ax, ay] = P(poly[j]), [bx, by] = P(poly[i]);
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }

  // alert: { polys: [[[lat,lon],...]], effective, expires } (ms). Hasil null bila di luar koridor.
  function encounter(alert, dense, depart, corridorNm) {
    let best = null;
    dense.forEach(p => {
      for (const poly of alert.polys || []) {
        const d = distToPoly([p.lat, p.lon], poly);
        if (d <= corridorNm && (!best || d < best.d - 1e-9)) best = { d, p };
      }
    });
    if (!best) return null;
    const eta = depart + best.p.h * 3600e3;
    const timing = alert.expires && alert.expires < eta ? 'ended'          // berakhir sebelum kapal tiba
      : alert.effective && alert.effective > eta ? 'notyet'                 // belum berlaku saat kapal tiba
      : 'active';                                                           // berlaku saat kapal tiba (atau tanpa batas waktu)
    return { distanceNm: best.d, at: [best.p.lat, best.p.lon], seg: best.p.seg, cumNm: best.p.cum, eta, timing };
  }

  return { DENSE_NM, densify, distToPoly, inside, encounter };
});
