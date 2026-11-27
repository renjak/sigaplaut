#!/usr/bin/env python3
# SIGAP LAUT - ingest grid prakiraan resmi Copernicus Marine (gratis, lisensi CC/atribusi) untuk area Indonesia.
# Sumber (model di balik InaWAVES, akses langsung & sah; bukan via domain BMKG yang diproteksi):
#   Gelombang: cmems_mod_glo_wav_anfc_0.083deg_PT3H-i  -> VHM0, VTPK, VMDR, VHM0_SW1  (~9 km, 3 jam)
#   Arus+pasut: cmems_mod_glo_phy_anfc_merged-uv_PT1H-i -> utotal, vtotal (arus total termasuk pasang surut)
# Keluaran: data/cmgrid.bin.gz (Float32 [var][time][lat][lon], NaN=kosong) + data/cmgrid.json (metadata & provenance).
# Koordinat area Indonesia saja yang dikirim ke Copernicus (bukan rute operasional). Jalankan di worker, bukan per permintaan.
#
# Login: butuh akun Copernicus Marine gratis. Toolbox membaca COPERNICUSMARINE_SERVICE_USERNAME & _PASSWORD,
# atau berkas kredensial dari `copernicusmarine login`. Jangan menaruh kata sandi di repo.
#
# Pemakaian:
#   python3 scripts/ingest_copernicus.py --bbox -7 2 103 108 --days 3           # unduh asli (perlu login)
#   python3 scripts/ingest_copernicus.py --synthetic --bbox -7 2 103 108 --days 2  # grid tiruan (tanpa login, untuk uji)
import argparse, gzip, json, math, os, struct, sys, datetime as dt

VARS = ['hs', 'tp', 'dir', 'swell', 'cur_spd', 'cur_dir']   # urutan di berkas biner
UNITS = {'hs': 'm', 'tp': 's', 'dir': 'deg', 'swell': 'm', 'cur_spd': 'kn', 'cur_dir': 'deg'}
WAV_DS = 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i'
CUR_DS = 'cmems_mod_glo_phy_anfc_merged-uv_PT1H-i'
RES = 0.083333333   # 1/12 derajat


def pack(path_dir, lat0, lon0, nlat, nlon, times, grids, issued, synthetic):
    # grids: dict var -> list(time) of nlat*nlon floats (NaN=kosong)
    buf = bytearray()
    for v in VARS:
        for ti in range(len(times)):
            buf += struct.pack('<%df' % (nlat * nlon), *grids[v][ti])
    os.makedirs(path_dir, exist_ok=True)
    with gzip.open(os.path.join(path_dir, 'cmgrid.bin.gz'), 'wb', compresslevel=6) as f:
        f.write(buf)
    meta = {
        'source': 'Copernicus Marine Service (E.U. Copernicus Marine Service Information)',
        'license': 'Copernicus Marine licence (free, incl. commercial, attribution required)',
        'datasets': {'waves': WAV_DS, 'currents': CUR_DS},
        'note': 'Gelombang 3 jam-an & arus total (termasuk pasang surut) ~9 km; arus diambil per jam pada jam gelombang.',
        'synthetic': bool(synthetic),
        'issued': issued, 'fetched': dt.datetime.now(dt.timezone.utc).isoformat(),
        'bbox': {'lat0': lat0, 'lon0': lon0, 'res': RES, 'nlat': nlat, 'nlon': nlon},
        'times': times, 'vars': VARS, 'units': UNITS,
    }
    with open(os.path.join(path_dir, 'cmgrid.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    size = os.path.getsize(os.path.join(path_dir, 'cmgrid.bin.gz'))
    print('tulis cmgrid.bin.gz (%d KB) + cmgrid.json: %dx%d sel, %d jam, %s' % (size // 1024, nlat, nlon, len(times), 'SINTETIS' if synthetic else 'Copernicus'))


def axis(a, b):
    n = int(round((b - a) / RES)) + 1
    return n, [a + i * RES for i in range(n)]


def synthetic(args):
    lat0, lat1, lon0, lon1 = args.bbox
    nlat, lats = axis(lat0, lat1)
    nlon, lons = axis(lon0, lon1)
    t0 = int(dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0).timestamp()) // 10800 * 10800
    times = [t0 + k * 10800 for k in range(args.days * 8)]   # 3 jam-an
    grids = {v: [] for v in VARS}
    for ti, tt in enumerate(times):
        for v in VARS:
            row = []
            for i in range(nlat):
                for j in range(nlon):
                    la, lo = lats[i], lons[j]
                    if (round(la) % 3 == 0) and (round(lo) % 4 == 0):
                        row.append(float('nan'))        # tiruan sel daratan
                    elif v == 'hs':
                        row.append(round(0.5 + 0.4 * math.sin(la) + 0.3 * (ti % 8) / 8, 3))
                    elif v == 'tp':
                        row.append(round(6 + 2 * math.cos(lo), 2))
                    elif v == 'dir':
                        row.append(round((180 + 30 * math.sin(la)) % 360, 1))
                    elif v == 'swell':
                        row.append(round(0.3 + 0.2 * math.sin(lo), 3))
                    elif v == 'cur_spd':
                        row.append(round(0.4 + 1.5 * abs(math.sin(2 * math.pi * ti / 8)), 3))   # pasut
                    else:
                        row.append(round((90 + 60 * math.sin(2 * math.pi * ti / 8)) % 360, 1))
            grids[v].append(row)
    pack(args.out, lat0, lon0, nlat, nlon, times, grids, dt.datetime.now(dt.timezone.utc).isoformat(), True)


def real(args):
    import numpy as np, copernicusmarine as cm
    lat0, lat1, lon0, lon1 = args.bbox
    start = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    end = start + dt.timedelta(days=args.days)
    sub = dict(minimum_longitude=lon0, maximum_longitude=lon1, minimum_latitude=lat0, maximum_latitude=lat1,
               start_datetime=start, end_datetime=end)
    wav = cm.open_dataset(dataset_id=WAV_DS, variables=['VHM0', 'VTPK', 'VMDR', 'VHM0_SW1'], **sub).load()
    cur = cm.open_dataset(dataset_id=CUR_DS, variables=['utotal', 'vtotal'], **sub).load()
    # Buang dimensi kedalaman tunggal (arus permukaan) agar tiap langkah waktu = [lintang, bujur].
    def squeeze(ds):
        d = next((x for x in ('depth', 'deptht', 'elevation') if x in ds.dims), None)
        return ds.isel({d: 0}, drop=True) if d else ds
    wav = squeeze(wav)
    cur = squeeze(cur)
    # Samakan arus ke grid gelombang (keduanya 1/12°; jamin bentuk array cocok).
    cur = cur.reindex(latitude=wav.latitude, longitude=wav.longitude, method='nearest')
    lats = [float(x) for x in wav.latitude.values]
    lons = [float(x) for x in wav.longitude.values]
    nlat, nlon = len(lats), len(lons)
    times = [int(np.datetime64(t, 's').astype('int64')) for t in wav.time.values]
    # arus per jam -> ambil langkah terdekat untuk tiap jam gelombang
    cur_t = [int(np.datetime64(t, 's').astype('int64')) for t in cur.time.values]
    uu, vv = cur['utotal'].values, cur['vtotal'].values            # [waktu, lintang, bujur]
    ispd = np.hypot(uu, vv) * 1.94384
    idir = (np.degrees(np.arctan2(uu, vv)) + 360) % 360            # arah menuju
    grids = {v: [] for v in VARS}

    def flat(a):
        a = np.asarray(a)
        return [float('nan') if np.isnan(a[i, j]) else round(float(a[i, j]), 3) for i in range(nlat) for j in range(nlon)]

    for ti, tt in enumerate(times):
        grids['hs'].append(flat(wav['VHM0'].values[ti]))
        grids['tp'].append(flat(wav['VTPK'].values[ti]))
        grids['dir'].append(flat(wav['VMDR'].values[ti]))
        grids['swell'].append(flat(wav['VHM0_SW1'].values[ti]))
        k = min(range(len(cur_t)), key=lambda c: abs(cur_t[c] - tt))
        grids['cur_spd'].append(flat(ispd[k]))
        grids['cur_dir'].append(flat(idir[k]))
    issued = str(wav.attrs.get('forecast_reference_time') or start.isoformat())
    pack(args.out, lats[0], lons[0], nlat, nlon, times, grids, issued, False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', nargs=4, type=float, metavar=('LAT0', 'LAT1', 'LON0', 'LON1'), default=[-15, 10, 92, 142])
    ap.add_argument('--days', type=int, default=3)
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
    ap.add_argument('--synthetic', action='store_true')
    args = ap.parse_args()
    (synthetic if args.synthetic else real)(args)


if __name__ == '__main__':
    main()
