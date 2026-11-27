// SIGAP LAUT – geodesi WGS84 (EPSG:4326). Dipakai di browser dan Node.
// Jarak & haluan awal: Vincenty inverse pada elipsoid WGS84 (akurasi ±0,5 mm),
// dengan cadangan rumus bola bila tidak konvergen (hanya terjadi untuk titik hampir antipodal).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F);
  const M_PER_NM = 1852;
  const toR = Math.PI / 180, toD = 180 / Math.PI;

  function sphere(a, b) {
    const R = 6371008.8, dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    const y = Math.sin(dLon) * Math.cos(b[0] * toR);
    const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos(dLon);
    return { m: 2 * R * Math.asin(Math.sqrt(h)), bearing: (Math.atan2(y, x) * toD + 360) % 360, method: 'sphere' };
  }

  // a, b = [lat, lon] derajat. Hasil: { m, nm, bearing (derajat sejati 0–360), method }
  function inverse(a, b) {
    if (a[0] === b[0] && a[1] === b[1]) return { m: 0, nm: 0, bearing: 0, method: 'vincenty' };
    const L = (b[1] - a[1]) * toR;
    const U1 = Math.atan((1 - F) * Math.tan(a[0] * toR)), U2 = Math.atan((1 - F) * Math.tan(b[0] * toR));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lambda = L, prev, iter = 0, sinS, cosS, sigma, sinAlpha, cos2Alpha, cos2SM, sinL, cosL;
    do {
      sinL = Math.sin(lambda); cosL = Math.cos(lambda);
      sinS = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
      if (sinS === 0) return { m: 0, nm: 0, bearing: 0, method: 'vincenty' };
      cosS = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
      sigma = Math.atan2(sinS, cosS);
      sinAlpha = cosU1 * cosU2 * sinL / sinS;
      cos2Alpha = 1 - sinAlpha * sinAlpha;
      cos2SM = cos2Alpha !== 0 ? cosS - 2 * sinU1 * sinU2 / cos2Alpha : 0;
      const C = F / 16 * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
      prev = lambda;
      lambda = L + (1 - C) * F * sinAlpha * (sigma + C * sinS * (cos2SM + C * cosS * (-1 + 2 * cos2SM * cos2SM)));
    } while (Math.abs(lambda - prev) > 1e-12 && ++iter < 200);
    if (iter >= 200) { const s = sphere(a, b); return Object.assign(s, { nm: s.m / M_PER_NM }); }
    const u2 = cos2Alpha * (A * A - B * B) / (B * B);
    const Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
    const Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    const dS = Bk * sinS * (cos2SM + Bk / 4 * (cosS * (-1 + 2 * cos2SM * cos2SM) - Bk / 6 * cos2SM * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2SM * cos2SM)));
    const m = B * Ak * (sigma - dS);
    const brg = Math.atan2(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL) * toD;
    return { m, nm: m / M_PER_NM, bearing: (brg + 360) % 360, method: 'vincenty' };
  }

  const distNm = (a, b) => inverse(a, b).nm;
  return { A, F, M_PER_NM, inverse, distNm, sphere };
});
