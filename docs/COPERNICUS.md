# Adapter Copernicus Marine (gelombang & arus pasang surut resmi)

Sumber gratis dan sah yang sama di balik InaWAVES — diambil langsung dari Copernicus Marine, **tanpa menyentuh
domain BMKG yang diproteksi**. Lisensi Copernicus Marine (gratis, termasuk komersial, wajib atribusi).

## Data yang diambil (area Indonesia saja, bukan rute operasional)
| Dataset | Variabel | Resolusi |
|---|---|---|
| `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` (gelombang) | VHM0 (tinggi signifikan), VTPK (periode), VMDR (arah), VHM0_SW1 (swell) | ~9 km, 3 jam |
| `cmems_mod_glo_phy_anfc_merged-uv_PT1H-i` (fisika) | `utotal`,`vtotal` → arus total **termasuk pasang surut** | ~9 km, per jam |

## Berkas keluaran
- `data/cmgrid.bin.gz` — Float32 `[var][time][lat][lon]`, NaN = kosong (sel daratan/di luar). (git-ignore: diperbarui tiap run)
- `data/cmgrid.json` — metadata & provenance: dataset, jam terbit model, jam fetch, bbox, daftar waktu (UTC).

## Alur (arsitektur ingestion, bukan per permintaan)
```
 worker terjadwal  →  python3 scripts/ingest_copernicus.py --bbox -15 10 92 142 --days 7
   → data/cmgrid.*  (atau object storage di produksi)
 lib/cmgrid.js (server)  →  nilai sel+jam terdekat untuk tiap titik rute, + provenance
```
Rute dihitung di server dari grid; koordinat rute tidak dikirim ke luar. Nilai di luar grid/jangkauan waktu = null (bukan "aman").

## Login (akun gratis, kredensial milik instansi)
1. Buat akun gratis di <https://data.marine.copernicus.eu/register> (atas nama instansi).
2. Simpan kredensial sebagai variabel lingkungan (bukan di repo): `COPERNICUSMARINE_SERVICE_USERNAME`, `COPERNICUSMARINE_SERVICE_PASSWORD`.
   Keduanya dibaca otomatis oleh toolbox. Kata sandi terlihat oleh siapa pun yang memakai lingkungan ini — pakai akun data-only.
3. Pasang toolbox: `pip install copernicusmarine` (v2.5+).

## Status
- Skrip ingest: siap. Mode `--synthetic` menghasilkan grid tiruan untuk uji tanpa login.
- Pembaca `lib/cmgrid.js`: teruji unit (sel/jam terdekat, sel kosong→null, di luar grid/waktu→null, provenance).
- **Belum dijalankan dengan data asli** (menunggu akun Copernicus). Setelah kredensial ada, jalankan ingest lalu bandingkan dengan Open-Meteo.
- Integrasi ke `/api/forecast` sebagai sumber pembanding/utama: langkah berikut, bergantung keputusan penyimpanan (K1 di audit Fase 0).
