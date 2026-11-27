# Sumber data SIGAP LAUT

Status per 27 Nov 2026. Prinsip: nilai tertinggi antarmodel, data kosong ≠ aman, setiap angka menyebut sumber dan jam ambil.

| Sumber | Dipakai untuk | Cara akses | Status |
|---|---|---|---|
| BMKG – peringatan dini cuaca (CAP) | Peringatan aktif ±10 NM dari rute | `www.bmkg.go.id/alerts/nowcast` (publik) | Aktif (`api/bmkg-warnings.js`) |
| BMKG – prakiraan pelabuhan | Tautan pelabuhan terdekat (664 pelabuhan) | Halaman publik `bmkg.go.id/cuaca/maritim/pelabuhan` | Aktif (`data/bmkg-ports.json`, `scripts/update-bmkg-ports.js`) |
| BMKG – API maritim (InaWAVES/InaFLOWS, `maritim.bmkg.go.id/pusmar/api23`) | Gelombang, arus, pasut resmi | Diproteksi Cloudflare (dicek 27 Nov 2026: HTTP 403 `cf-mitigated: challenge`) | **Menunggu izin resmi.** Jangan diakali. Lihat draf permohonan di bawah |
| Open-Meteo Marine | Gelombang (ECMWF WAM, NOAA GFS-Wave, Météo-France MFWAM), swell, arus (SMOC, termasuk pasut) | API, CC BY 4.0, gratis non-komersial (±10.000 panggilan/hari; tiap titik dihitung) | Aktif |
| Open-Meteo Weather | Angin & hembusan (ECMWF IFS, NOAA GFS, DWD ICON) | Idem | Aktif |
| MET Norway Locationforecast | Angin cadangan bila Open-Meteo gagal (mis. kuota habis) | API, CC BY 4.0, User-Agent aplikasi | Aktif sebagai cadangan. Tanpa hembusan; setelah ±60 jam per 6 jam (diambil nilai terbesar) |
| Stormglass | Pembanding gelombang/angin/arus di sebagian titik | API berbayar per titik (gratis 10/hari non-komersial; €19/€49/€129 per bulan untuk 500/5.000/25.000 per hari) | **Opsional, mati bawaan.** Aktif bila `STORMGLASS_API_KEY` diisi |
| NOAA NCEI ETOPO 2022 | Penyaring kedangkalan & lintasan daratan | ERDDAP CoastWatch, domain publik | Aktif (`data/depth-30s.bin.gz`, `scripts/build-depth-grid.js`). Bukan untuk navigasi |
| ECMWF Open Data, NCEP GFS | Model angin/gelombang | Sudah masuk lewat Open-Meteo | Akses langsung (GRIB) untuk server internal nanti |
| Copernicus Marine | MFWAM & SMOC resolusi penuh | Akun gratis (kredensial) | Sudah masuk lewat Open-Meteo; akses langsung menunggu akun |
| NASA POWER | Radiasi matahari, data harian kasar | – | Tidak dipakai (tidak relevan untuk keselamatan pelayaran) |

## Konfigurasi server (Vercel → Project → Settings → Environment Variables)

| Variabel | Arti | Bawaan |
|---|---|---|
| `STORMGLASS_API_KEY` | Kunci API Stormglass. Kosong = Stormglass tidak dipanggil | kosong |
| `STORMGLASS_MAX_POINTS` | Jumlah titik pembanding per perhitungan (tersebar rata, selalu termasuk awal & akhir), maks. 50 | 10 |

Jangan simpan kunci di repo. Stormglass mengirim koordinat titik ke layanan luar: matikan (kosongkan kunci) untuk rute operasional.

Kuota Stormglass: satu titik = satu permintaan. Dengan 10 titik per perhitungan, paket 500/hari ≈ 50 perhitungan rute per hari.

## Draf permohonan akses data maritim BMKG

> Kepada Yth. Direktur Meteorologi Maritim, BMKG
> u.p. PPID BMKG (ppid.bmkg.go.id)
>
> Perihal: Permohonan akses API data maritim (InaWAVES/InaFLOWS) untuk perencanaan keselamatan pelayaran
>
> Kami sedang mengembangkan SIGAP LAUT, alat bantu perencanaan pelayaran untuk kapal [TNI AL / instansi], yang menilai rute terhadap batas gelombang, angin, dan arus kapal serta menautkan prakiraan pelabuhan dan peringatan dini BMKG. Saat ini aplikasi memakai model global terbuka. Kami memohon akses resmi ke data InaWAVES dan InaFLOWS agar penilaian memakai data nasional resmi BMKG.
>
> Kebutuhan:
> 1. Parameter: tinggi gelombang signifikan, swell & periode, angin 10 m, arus permukaan, pasang surut; prakiraan per jam hingga 7 hari.
> 2. Wilayah: perairan Indonesia. Akses per titik koordinat atau per area.
> 3. Frekuensi: mengikuti jadwal model BMKG; data disimpan sementara (cache) di server kami.
> 4. Cara akses: kunci API atau whitelist IP server, sesuai ketentuan BMKG (termasuk ketentuan PNBP bila berlaku).
> 5. Atribusi: setiap angka ditampilkan dengan sumber "BMKG" dan jam pengambilan; aplikasi tetap merujuk pengguna ke informasi resmi BMKG.
>
> Kontak teknis: [nama, jabatan, email/telepon instansi].
