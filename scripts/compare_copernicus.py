#!/usr/bin/env python3
# Bandingkan grid Copernicus (hasil ingest) dengan Open-Meteo di titik-titik rute, pada jam yang sama.
# Tujuan: memastikan data Copernicus masuk akal sebelum dipakai. TIDAK mengubah aplikasi.
#   python3 scripts/compare_copernicus.py                 # rute Batam->Jakarta, +12 jam dari sekarang
#   python3 scripts/compare_copernicus.py --hours 24 --grid data
import argparse, gzip, json, math, os, struct, sys, urllib.request, datetime as dt

# WP uji (sama dengan contoh rute di aplikasi), dijarangkan agar ringan.
ROUTE = [[1.125, 103.925], [0.8, 103.6], [0.25, 103.95], [-1.0, 104.95], [-2.1, 105.02],
         [-2.9, 106.0], [-3.17, 106.5], [-4.5, 106.7], [-5.7, 106.85], [-6.0958, 106.8861]]


def load_grid(d):
    meta = json.load(open(os.path.join(d, 'cmgrid.json')))
    raw = gzip.open(os.path.join(d, 'cmgrid.bin.gz'), 'rb').read()
    buf = struct.unpack('<%df' % (len(raw) // 4), raw)
    b = meta['bbox']; cells = b['nlat'] * b['nlon']; nt = len(meta['times']); V = meta['vars']
    vi = {v: i for i, v in enumerate(V)}

    def at(var, lat, lon, ts):
        if var not in vi:
            return None
        i = round((lat - b['lat0']) / b['res']); j = round((lon - b['lon0']) / b['res'])
        if not (0 <= i < b['nlat'] and 0 <= j < b['nlon']):
            return None
        T = meta['times']
        if ts < T[0] - 5400 or ts > T[-1] + 5400:
            return None
        k = min(range(nt), key=lambda x: abs(T[x] - ts))
        v = buf[vi[var] * nt * cells + k * cells + i * b['nlon'] + j]
        return None if v != v else v   # NaN -> None
    return meta, at


def openmeteo(lats, lons, ts):
    # hs & arus dari Open-Meteo (data terbuka; sama sumbernya dgn Copernicus via passthrough)
    la = ','.join('%.3f' % x for x in lats); lo = ','.join('%.3f' % x for x in lons)
    url = ('https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s'
           '&hourly=wave_height,ocean_current_velocity&timeformat=unixtime&forecast_days=3' % (la, lo))
    try:
        j = json.load(urllib.request.urlopen(url, timeout=30))
    except Exception as e:
        print('Open-Meteo tidak tersedia (%s) — hanya menampilkan kolom Copernicus.' % str(e)[:80]); return None
    if not isinstance(j, list):
        j = [j]
    out = []
    for p in j:
        h = p['hourly']; tarr = h['time']
        k = min(range(len(tarr)), key=lambda x: abs(tarr[x] - ts))
        cur = h.get('ocean_current_velocity', [])
        out.append((h['wave_height'][k], (cur[k] / 1.852 if k < len(cur) and cur[k] is not None else None)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--grid', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
    ap.add_argument('--hours', type=int, default=12)
    args = ap.parse_args()
    if not os.path.exists(os.path.join(args.grid, 'cmgrid.json')):
        print('Belum ada grid Copernicus di %s. Jalankan dulu: python3 scripts/ingest_copernicus.py' % args.grid); sys.exit(1)
    meta, at = load_grid(args.grid)
    if meta.get('synthetic'):
        print('PERINGATAN: grid ini TIRUAN (uji), bukan prakiraan nyata.\n')
    ts = int(dt.datetime.now(dt.timezone.utc).timestamp()) + args.hours * 3600
    lats = [w[0] for w in ROUTE]; lons = [w[1] for w in ROUTE]
    om = openmeteo(lats, lons, ts)
    print('Perbandingan pada %s UTC (±%d jam dari sekarang). Sumber gelombang & arus.' %
          (dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime('%Y-%m-%d %H:%M'), args.hours))
    print('Jam terbit model Copernicus: %s\n' % meta.get('issued', '–'))
    print('%-4s %9s %9s | %8s(CM) %8s(OM) | %8s(CM) %8s(OM)' % ('WP', 'lat', 'lon', 'gel', 'gel', 'arus', 'arus'))
    dh = []; dc = []
    for i, w in enumerate(ROUTE):
        cmh = at('hs', w[0], w[1], ts); cmc = at('cur_spd', w[0], w[1], ts)
        omh, omc = (om[i] if om else (None, None))
        f = lambda v: '   –  ' if v is None else '%6.2f' % v
        if cmh is not None and omh is not None:
            dh.append(abs(cmh - omh))
        if cmc is not None and omc is not None:
            dc.append(abs(cmc - omc))
        print('%-4s %9.4f %9.4f | %12s %12s | %12s %12s' % ('WP%d' % (i + 1), w[0], w[1], f(cmh), f(omh), f(cmc), f(omc)))
    if dh:
        print('\nSelisih rata-rata gelombang CM vs OM: %.2f m (%d titik dibandingkan)' % (sum(dh) / len(dh), len(dh)))
    if dc:
        print('Selisih rata-rata arus CM vs OM:      %.2f kn (%d titik dibandingkan)' % (sum(dc) / len(dc), len(dc)))
    print('\nCatatan: keduanya PRAKIRAAN model, bukan observasi. Copernicus ~9 km resmi; Open-Meteo gabungan beberapa model.')


if __name__ == '__main__':
    main()
