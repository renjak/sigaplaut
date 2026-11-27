// SIGAP LAUT – pembaca grid prakiraan Copernicus Marine (lihat scripts/ingest_copernicus.py).
// Server-side: diberi lat/lon/jam, mengembalikan nilai sel terdekat + provenance (dataset, jam terbit, jam grid).
// Prinsip: nilai di luar grid atau di luar jangkауan waktu = null (bukan 0, bukan "aman"). Tidak ada interpolasi diam-diam.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SigapCmGrid = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // meta = cmgrid.json; buf = Float32Array([var][time][lat][lon]).
  function load(meta, buf) {
    const b = meta.bbox, V = meta.vars, nt = meta.times.length, cells = b.nlat * b.nlon;
    const per = nt * cells;
    if (buf.length !== V.length * per) throw new Error(`ukuran grid tidak cocok: ${buf.length} != ${V.length * per}`);
    const vi = {}; V.forEach((v, i) => { vi[v] = i; });
    const idxTime = ms => {   // jam grid terdekat (3 jam-an); null bila di luar jangkauan ± setengah langkah
      const t = ms / 1000, T = meta.times;
      if (t < T[0] - 5400 || t > T[T.length - 1] + 5400) return null;
      let k = 0; for (let i = 1; i < T.length; i++) if (Math.abs(T[i] - t) < Math.abs(T[k] - t)) k = i;
      return k;
    };
    const cellOf = (lat, lon) => {
      const i = Math.round((lat - b.lat0) / b.res), j = Math.round((lon - b.lon0) / b.res);
      if (i < 0 || j < 0 || i >= b.nlat || j >= b.nlon) return null;
      return { i, j, lat: +(b.lat0 + i * b.res).toFixed(4), lon: +(b.lon0 + j * b.res).toFixed(4) };
    };
    function at(v, lat, lon, ms) {
      if (vi[v] === undefined) return null;
      const c = cellOf(lat, lon), k = idxTime(ms);
      if (!c || k === null) return null;
      const val = buf[vi[v] * per + k * cells + c.i * b.nlon + c.j];
      return Number.isNaN(val) ? null : val;
    }
    // Semua parameter untuk satu titik & jam + provenance.
    function point(lat, lon, ms) {
      const c = cellOf(lat, lon), k = idxTime(ms);
      if (!c || k === null) return { inGrid: !!c, inTime: k !== null, values: null };
      const values = {};
      V.forEach(v => { const val = buf[vi[v] * per + k * cells + c.i * b.nlon + c.j]; values[v] = Number.isNaN(val) ? null : val; });
      return { inGrid: true, inTime: true, values, cell: [c.lat, c.lon], gridTimeMs: meta.times[k] * 1000,
        source: meta.source, datasets: meta.datasets, issued: meta.issued, synthetic: !!meta.synthetic };
    }
    return { meta, at, point, cellOf, idxTime, timeRangeMs: [meta.times[0] * 1000, meta.times[meta.times.length - 1] * 1000] };
  }
  return { load };
});
