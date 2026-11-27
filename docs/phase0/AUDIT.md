# SIGAP LAUT — Fase 0: Audit Sistem & Rancangan

Tanggal audit: 27 Nov 2026. Repo: `renjak/sigaplaut`, branch `claude/sigap-laut-cloud-setup-ih8s4x` (commit `7ffbecf`).
Dokumen ini tidak mengubah kode, basis data, atau infrastruktur. Semua angka di bawah berasal dari pemeriksaan langsung, kecuali yang ditandai *perkiraan*.

---

## 0. Ringkasan

- **Yang ada sekarang** adalah prototipe satu halaman yang bekerja dan teruji: perencana rute berbasis waypoint, prakiraan cuaca-laut per jam pada jam tiba kapal, penyaring kedangkalan, peringatan dini BMKG, dan briefing komandan. Logikanya konservatif dan diuji (36 unit test, 86 pemeriksaan browser).
- **Yang diminta master prompt** adalah platform multi-modul dengan basis data, autentikasi, peran, peringatan persisten dan teraudit, pemantauan kapal, dan data navigasi resmi. Hampir semua bagian infrastruktur itu belum ada. Jaraknya besar, terutama di persistensi, akses, dan data resmi.
- **Rekomendasi:** bangun aplikasi baru (Next.js + TypeScript + MapLibre + PostgreSQL/PostGIS) secara bertahap di repo yang sama. Logika yang sudah teruji (`lib/route.js`, `lib/depth.js`) dipindahkan ke TypeScript beserta ujinya sebagai acuan. Prototipe tetap berjalan sampai versi baru setara.
- **Tiga hal yang menentukan arsitektur dan harus diputuskan pemilik** (bagian 8):
  1. Di mana data operasional (rute, posisi kapal) boleh disimpan.
  2. Sumber ENC resmi.
  3. Sumber AIS dan GPS yang sah.

---

## 1. Kondisi saat ini (fakta)

### 1.1 Isi repo
| Bagian | File | Keterangan |
|---|---|---|
| Antarmuka | `index.html` (583 baris) | HTML + JS tanpa framework, Leaflet 1.9.4 dari unpkg, peta OSM. State di `localStorage` |
| Logika rute | `lib/route.js` (185) | Titik bantu tiap 20 NM, ETA, status per titik, kualitas data, jendela berangkat, pelabuhan terdekat. Dipakai browser & Node |
| Logika kedalaman | `lib/depth.js` (107) | Pemeriksaan tiap 0,25 NM terhadap grid kedalaman; batas = sarat + UKC kapal + 1,5 m surut |
| API | `api/forecast.js`, `api/bmkg-warnings.js`, `api/route-check.js` | Fungsi Vercel (Node, CommonJS) |
| Data statis | `data/depth-30s.bin.gz` (2 MB), `data/bmkg-ports.json` (664 pelabuhan) | ETOPO 2022 (domain publik); daftar pelabuhan dari halaman publik BMKG |
| Skrip | `scripts/` | Bangun grid kedalaman, perbarui daftar pelabuhan, server lokal |
| Uji | `tests/` (36 uji, `node:test`), `e2e/e2e.js` (Playwright) | Termasuk pencocokan angka tabel dengan data mentah API per waypoint |
| Dependensi npm | tidak ada | `package.json` tanpa dependensi; tidak ada lockfile |
| Referensi ALNAV DMS | 0 | Repo sudah mandiri |

### 1.2 Fitur yang berfungsi
- Input waypoint manual (desimal atau derajat-menit), maksimal 100 WP, tap peta, contoh rute (termasuk Batam → Pondok Dayung).
- Jarak haversine (bola, R = 3.440,065 NM), ETA = jarak / kecepatan, jam berangkat dalam WIB.
- Prakiraan per jam pada jam tiba di setiap titik:
  - gelombang dari 3 model + best match;
  - angin dan hembusan dari 3 model;
  - arus (SMOC, termasuk pasut);
  - nilai yang dipakai = tertinggi antarmodel.
- Status AMAN / WASPADA / TIDAK DISARANKAN / TANPA DATA. Status AMAN tidak pernah keluar bila data kosong, usang (lebih dari 6 jam), atau model angin gagal.
- Peringatan kualitas data:
  - titik di sel grid yang sama;
  - titik dekat pantai;
  - hanya 1 model tersedia;
  - angin dari sumber cadangan (MET Norway);
  - Stormglass opsional.
- Kedangkalan dan lintasan daratan dari grid ETOPO (±925 m), alur pelabuhan 3 NM ditandai "tidak dinilai", diberi label "bukan untuk navigasi".
- Peringatan dini BMKG (CAP) di peta, dan tanda bila berada ±10 NM dari rute.
- Briefing komandan siap salin; tautan ke prakiraan pelabuhan BMKG terdekat.

### 1.3 Deployment & lingkungan
| Hal | Temuan |
|---|---|
| Produksi | `sigap-laut.vercel.app`, tim Vercel `644warship-2118`. **Masih versi lama** (tanpa `/api/route-check`: HTTP 404) |
| Integrasi Git | Proyek Vercel **terhubung ke GitHub `sigaplaut`**. Setiap push ke branch membuat deployment *preview* (6 preview hari ini, semua READY). Preview dilindungi login Vercel |
| Branch produksi | `main`. **Merge ke `main` = deploy produksi otomatis, tanpa gerbang uji** |
| Runtime | Node 26.x di proyek; `package.json` menulis `engines: node >=20` (Node 20 sudah usang di Vercel) |
| Lingkungan | Hanya satu (produksi + preview). Tidak ada staging, tidak ada pemisahan konfigurasi |
| Rahasia | Tidak ada rahasia di repo. Kunci opsional (`STORMGLASS_API_KEY`) dibaca dari variabel server |

### 1.4 Sumber data (status terverifikasi)
| Sumber | Status | Catatan |
|---|---|---|
| Open-Meteo Marine & Weather | Dipakai | CC BY 4.0, **gratis hanya non-komersial**, ±10.000 panggilan/hari, setiap titik dihitung. IP kontainer pengujian sempat ditolak (429) |
| MET Norway | Cadangan angin | CC BY 4.0; tanpa hembusan; setelah ±60 jam data per 6 jam |
| BMKG CAP (peringatan dini) | Dipakai | Publik |
| BMKG API maritim (InaWAVES/InaFLOWS) | **Terblokir** | Cloudflare challenge (HTTP 403, dicek 27 Nov 2026). Perlu izin resmi |
| ETOPO 2022 | Dipakai | Domain publik, bukan data navigasi |
| Stormglass | Opsional, mati | Berbayar per titik |
| Copernicus Marine | Tidak langsung | Lewat Open-Meteo; akses langsung perlu akun |
| ENC Pushidrosal | **Belum ada** | Diperlukan untuk hazard navigasi resmi (master prompt §14) |
| AIS, GPS kapal | **Belum ada** | Perlu sumber sah |

---

## 2. Matriks kesenjangan terhadap master prompt

Status: ✅ ada · 🟡 sebagian · ❌ belum ada · ⛔ terhambat pihak luar

| Modul / kriteria | Status | Keterangan |
|---|---|---|
| 1 Overview Dashboard | ❌ | Tidak ada basis data untuk dihitung |
| 2 Maritime Map | 🟡 | Leaflet + OSM; belum MapLibre, belum panel layer dengan sumber/waktu/validitas, belum PMTiles |
| 3 Route Planner | 🟡 | Input manual, validasi format, hapus. Belum ada: nama WP, urut ulang, impor CSV/GeoJSON, draft tersimpan, versi, review, ekspor |
| 4 Route Analysis | 🟡 | Analisis temporal per titik + jendela berangkat. Belum ada koridor yang bisa diatur dan belum tersimpan |
| 5 Weather & Ocean Intelligence | 🟡 | Gelombang, swell, periode, arus, angin, hembusan. Belum: arah, tekanan, hujan, jarak pandang, SST, muka air. Nilai per model belum dikirim ke klien (hanya maks/min) |
| 6 Hazard Detection | 🟡 / ⛔ | Kedangkalan kasar (ETOPO) & daratan; peringatan BMKG. Rintangan, rambu, zona terlarang, berita pelaut: perlu ENC/sumber resmi |
| 7 Early Warning Center | ❌ | Tidak ada peringatan persisten maupun siklus hidup |
| 8 Vessel Monitoring | ⛔ | Belum ada sumber GPS/AIS |
| 9 Data Sources | 🟡 | Didokumentasikan (`docs/SUMBER-DATA.md`); belum ada dasbor status langsung |
| 10 Analysis History | ❌ | |
| 11 Reports | 🟡 | Briefing teks; belum PDF/CSV |
| 12 System Configuration | ❌ | Ambang ada di kode, bukan konfigurasi yang disetujui |
| Autentikasi & peran (§20) | ❌ | Semua API publik tanpa login |
| Basis data (§19) | ❌ | |
| Simulasi terpisah (§23) | 🟡 | Data uji tiruan di unit test; belum ada lingkungan simulasi |
| Kriteria penerimaan 1–4 (rute, peta, jarak, ETA) | 🟡 | Ada & teruji. Jarak memakai bola (haversine), belum elipsoid WGS84 |
| Kriteria 5 (prakiraan pada ETA) | ✅ | Diuji: angka tabel = data mentah API pada jam tiba |
| Kriteria 6–7 (hazard spasial-temporal, sumber terlacak) | 🟡 | Sumber & jam ambil disebut; provenance per model belum disimpan |
| Kriteria 8–9 (validitas terlihat, data kosong ≠ normal) | ✅ | Diuji |
| Kriteria 10–13 (alert persisten, akses, laporan, simulasi) | ❌ | |
| Kriteria 14 (responsif) | ✅ | Diuji di 390×844 dan 1440×900 |

---

## 3. Temuan & risiko

| # | Tingkat | Temuan | Dampak | Tindakan |
|---|---|---|---|---|
| T1 | Kritis | Tidak ada autentikasi; `/api/forecast`, `/api/route-check` terbuka untuk siapa pun | Kuota Open-Meteo bisa dihabiskan pihak lain; tidak ada jejak siapa memakai | Fase 1: login wajib + rate limit per pengguna |
| T2 | Kritis | Koordinat rute dikirim ke layanan luar (Open-Meteo, MET Norway, Stormglass) dan diproses di Vercel (luar negeri) | Bertentangan dengan prinsip "rute operasional tidak keluar" | Keputusan K1; arsitektur ingestion grid (bagian 4.4) menghilangkan pengiriman rute |
| T3 | Kritis | Merge ke `main` langsung men-deploy produksi tanpa uji | Perubahan yang belum diuji bisa sampai ke pengguna | Lindungi `main` (wajib PR + CI hijau); pisahkan proyek staging |
| T4 | Tinggi | Lisensi Open-Meteo: gratis hanya non-komersial | Status pemakaian instansi perlu dipastikan; kuota rendah | Konfirmasi ke Open-Meteo atau self-host / ingestion langsung (ECMWF, NOAA, Copernicus) |
| T5 | Tinggi | Kedalaman dari grid global ±925 m | Alarm palsu di selat sempit; beting kecil bisa terlewat | Sudah dilabeli; perlu ENC/BATNAS (K2) |
| T6 | Tinggi | Peringatan & analisis tidak tersimpan (hanya di browser) | Tidak bisa diaudit; tidak ada riwayat | Fase 1–5 |
| T7 | Sedang | Jarak memakai bola (haversine), bukan elipsoid WGS84 | Selisih hingga ±0,5% pada jarak panjang | Fase 2: Vincenty/Karney (geographiclib) dengan uji acuan |
| T8 | Sedang | Hanya nilai maks/min antarmodel yang dikirim ke klien | Tidak bisa menampilkan perbedaan per model (§12) | Fase 3: simpan nilai per model |
| T9 | Sedang | API maritim BMKG terblokir | Data nasional resmi belum dipakai | Permohonan resmi (draf di `docs/SUMBER-DATA.md`) |
| T10 | Rendah | `engines: node >=20`, tanpa lockfile | Build tidak terkunci | Fase 1: pin Node 24/26 & lockfile |
| T11 | Rendah | Leaflet & font dimuat dari CDN | Tidak jalan offline; ketergantungan pihak ketiga | Fase 1: bundel lokal + PMTiles |

Kekuatan yang perlu dipertahankan: aturan konservatif yang diuji, label keterbatasan data, uji ketepatan data per waypoint, dan uji di layar HP.

---

## 4. Rancangan arsitektur

### 4.1 Prinsip
- Satu repo, aplikasi baru di `app/` (Next.js), prototipe lama tetap di root sampai setara lalu diarsipkan.
- Semua perhitungan keselamatan di **server**. Klien hanya menampilkan; status tidak pernah dihitung ulang di browser.
- **Adapter per penyedia** dengan antarmuka yang sama. Kegagalan satu penyedia → status `degraded`/`unavailable` yang terlihat, tidak pernah diganti diam-diam.
- Data simulasi ditandai `realm = 'simulation'` di setiap tabel dan tidak pernah tampil di tampilan produksi.

### 4.2 Komponen
```
 Browser (Next.js, React, TS, Tailwind, MapLibre + PMTiles)
   │  HTTPS, sesi login
   ▼
 Next.js server (Route Handlers / Server Actions)  ← validasi, otorisasi, rate limit
   │                         │
   ▼                         ▼
 PostgreSQL + PostGIS     Object storage (grid prakiraan Zarr/COG, PMTiles, laporan PDF)
 (Supabase: Auth, RLS,      ▲
  Realtime untuk alert)     │
   ▲                        │
   └──── Worker terjadwal ──┘  ingest per model run: ECMWF/NOAA/Copernicus/BMKG (setelah izin)
         + mesin peringatan (antrean), + adapter GPS/AIS (setelah sumber tersedia)
```

### 4.3 Pemetaan teknologi master prompt
| Master prompt | Rekomendasi | Alasan |
|---|---|---|
| Next.js + React + TS + Tailwind | **Ya** | 12 modul, login, peran: struktur halaman & tipe dibutuhkan |
| MapLibre GL + GeoJSON + PMTiles | **Ya** | Layer vektor, gaya peta laut gelap, peta offline |
| PostgreSQL + PostGIS | **Ya** | Koridor, jarak ke rute, indeks GiST (§11) |
| Supabase (Auth, RLS, Realtime, Storage) | **Ya, dengan catatan K1** | Supabase bisa di-host sendiri (Docker); untuk data operasional sebaiknya di infrastruktur sendiri |
| Edge Functions | Terbatas | Perhitungan berat (sampling grid) lebih cocok di worker Node/Python |
| Antrean & penjadwalan | Worker + tabel antrean di Postgres (mis. pg-boss) atau penjadwal platform | Tanpa ketergantungan layanan tambahan |

### 4.4 Data prakiraan: dari "per titik" ke "grid sekali ingest"
Saat ini setiap perhitungan rute memanggil Open-Meteo untuk setiap titik. Akibatnya kuota cepat habis dan rute keluar ke pihak ketiga. Rancangan:
1. **Worker mengunduh grid area Indonesia** per model run (2–4 kali sehari) langsung dari sumber terbuka: ECMWF Open Data, NOAA GFS/GFS-Wave, Copernicus Marine (akun), BMKG (setelah izin).
2. Grid disimpan di object storage (Zarr/COG), dicatat di `forecast_runs` (jam terbit, jam berlaku, checksum).
3. Analisis rute mengambil nilai dari grid **di server sendiri** pada posisi & jam tiba. Rute tidak dikirim ke mana pun.
4. Nilai per model disimpan terpisah (provenance), selisih antarmodel ditampilkan.
Tahap antara: adapter Open-Meteo per titik tetap dipakai di balik antarmuka yang sama, dengan cache.

### 4.5 Mesin peringatan
- Aturan dalam `rule_sets` (JSON berversi). Hanya set yang **disetujui** (`approved_by`, `approved_at`) yang dipakai di produksi.
- Setiap temuan menyimpan nilai, ambang, satuan, jenis nilai (prakiraan/interpolasi/kosong), sumber, dan jam terbit.
- Kategori: NORMAL (tidak ada ambang terlampaui, **bukan** sertifikasi aman), ADVISORY, WARNING, CRITICAL.
- Pemetaan dari status sekarang (disarankan): AMAN → NORMAL, WASPADA → ADVISORY/WARNING sesuai aturan, TIDAK DISARANKAN → WARNING/CRITICAL, TANPA DATA → ADVISORY "data tidak cukup" (tidak pernah NORMAL).
- `dedupe_key` mencegah peringatan ganda; status berubah hanya lewat fungsi server yang menulis `alert_events`. Peringatan tidak pernah dihapus, dan tidak otomatis selesai karena sumber data mati.

---

## 5. Rancangan basis data

Draf DDL lengkap: [`schema-draft.sql`](schema-draft.sql) (belum diterapkan). Ringkasan:

| Kelompok | Tabel | Catatan penting |
|---|---|---|
| Identitas | `organizations`, `user_profiles` | Peran per pengguna; terkait Supabase Auth |
| Kapal | `vessels`, `vessel_positions` | Posisi menyimpan `observed_at`, sumber, validitas, `realm` |
| Rute | `routes`, `route_versions`, `route_waypoints`, `route_segments` | Versi tidak bisa diubah setelah diajukan; teks koordinat asli disimpan; geography(4326) + GiST |
| Sumber | `data_sources`, `forecast_runs` | Status, lisensi, kuota, cakupan; ingestion idempoten (`unique source+model+issued_at`) |
| Hazard | `hazard_zones`, `hazard_observations` | Atribut asli sumber (mis. S-57) di JSONB |
| Aturan | `rule_sets` | Berversi, wajib disetujui |
| Analisis | `route_analyses`, `route_analysis_results` | Input yang dipakai (run prakiraan, versi kode) tercatat |
| Peringatan | `alerts`, `alert_events` | Siklus DETECTED → ACTIVE → ACKNOWLEDGED → RESOLVED, append-only |
| Sistem | `system_settings`, `audit_logs` | Audit append-only |

---

## 6. Tinjauan keamanan

| Area | Rancangan |
|---|---|
| Klasifikasi data | Rute, posisi kapal, dan jadwal berangkat = **rahasia operasional**. Data cuaca & peringatan publik = terbuka |
| Autentikasi | Supabase Auth (email + MFA wajib untuk admin & safety officer); sesi pendek; tanpa pendaftaran publik (akun dibuat admin) |
| Otorisasi | Diperiksa di server **dan** RLS. Peran: super_admin, admin, operator, safety_officer, viewer; dibatasi per organisasi |
| Kredensial | Kunci layanan (service role, API penyedia) hanya di server/secret store; tidak pernah ke browser; tidak di repo |
| Pengiriman data keluar | Mode operasional: rute tidak dikirim ke penyedia luar (grid ingest, bagian 4.4). Penyedia per titik (Open-Meteo, Stormglass) hanya di lingkungan dev/simulasi |
| Input | Validasi koordinat (rentang, format, duplikat berurutan, presisi), batas WP, ukuran impor CSV/GeoJSON |
| Penyalahgunaan | Rate limit per pengguna & per IP; batas ukuran permintaan; timeout & backoff ke penyedia |
| Audit | `audit_logs` dan `alert_events` append-only; operasi istimewa dicatat |
| Lingkungan | Proyek terpisah untuk dev, staging, produksi; data produksi tidak pernah disalin ke dev |
| Rilis | `main` dilindungi: PR + review + CI (unit, integrasi, e2e) wajib hijau sebelum deploy |
| AIS | AIS kapal perang sering dimatikan; tidak adanya target AIS ≠ tidak ada lalu lintas (dinyatakan di UI) |
| Cadangan | Backup harian terenkripsi + uji pemulihan berkala |

---

## 7. Peta jalan bertahap

Setiap fase selesai hanya bila ujinya lulus dan hasilnya dilaporkan.

| Fase | Isi | Uji penerimaan | Bergantung pada |
|---|---|---|---|
| **1 Fondasi** | Next.js + TS + Tailwind, identitas visual "Dark Maritime Command", login & peran, skema DB awal + RLS, peta MapLibre + basemap PMTiles, CI, proteksi `main`, lingkungan dev/staging | Typecheck, lint, uji RLS per peran, render peta, layout HP | K1 (lokasi DB) |
| **2 Route Planner** | Port `lib/route.js` ke TS (uji lama sebagai acuan), geodesik WGS84 (Karney), bearing, ETA per segmen & per kecepatan, nama/urut ulang WP, impor/ekspor CSV & GeoJSON (lon,lat), draft, versi, review | Uji jarak/bearing terhadap nilai acuan; uji impor; uji validasi tanpa mengubah koordinat diam-diam | Fase 1 |
| **3 Cuaca & Laut** | Adapter penyedia (antarmuka sama), normalisasi satuan, nilai per model tersimpan, parameter tambahan (arah, tekanan, hujan, jarak pandang, SST), ingestion grid terjadwal, dasbor sumber data | Uji temporal (nilai = jam tiba), uji kegagalan penyedia, uji data usang | Akun Copernicus; izin BMKG (opsional di awal) |
| **4 Hazard Navigasi** | Kedangkalan (UKC, koreksi pasut), rintangan, rambu, zona terlarang, berita pelaut dari ENC; koridor PostGIS | Uji spasial terhadap kasus ENC uji; label sumber & mutu survei | **K2 (ENC resmi)** |
| **5 Peringatan Dini** | Rule set yang disetujui, mesin peringatan, pusat peringatan, siklus hidup, notifikasi, riwayat, laporan PDF/CSV | Uji dedupe, uji siklus hidup, uji "data kosong ≠ normal" | Fase 3–4; persetujuan ambang oleh personel berwenang |
| **6 Pemantauan Langsung** | GPS kapal, penyimpangan rute, ETA dinamis, analisis ulang; AIS bila tersedia | Uji dengan data simulasi berlabel; uji posisi tidak valid/terlambat | **K3 (sumber GPS/AIS)** |
| **7 Validasi** | Uji integrasi & keamanan, evaluasi alarm palsu/terlewat terhadap data historis, tinjauan operasional | Laporan validasi | Semua fase |

Prototipe saat ini tetap tersedia selama Fase 1–3, dan dihentikan setelah fitur setara di versi baru lulus uji yang sama.

---

## 8. Keputusan yang dibutuhkan sebelum Fase 1

| # | Keputusan | Pilihan | Rekomendasi |
|---|---|---|---|
| K1 | Lokasi data operasional (rute, posisi kapal) | (a) Supabase Cloud (region Singapura) · (b) Supabase self-host di server instansi · (c) dev/staging di cloud dengan data simulasi, produksi di server instansi | **(c)** |
| K2 | Sumber ENC / batimetri resmi | ENC Pushidrosal (S-57, ke depan S-101/S-102) dengan lisensi; BATNAS BIG (6") sebagai pelengkap | Ajukan ke Pushidrosal; tanpa ENC, Fase 4 hanya bisa memakai grid kasar berlabel |
| K3 | Sumber posisi kapal & AIS | GPS kapal (perangkat/sistem yang ada), penerima AIS sendiri, data instansi (mis. Bakamla/Kemenhub), penyedia komersial berlisensi | Tentukan perangkat GPS dulu; AIS menyusul |
| K4 | Lisensi data prakiraan | Konfirmasi status Open-Meteo untuk instansi, atau pindah ke ingestion langsung (ECMWF/NOAA/Copernicus) | Ingestion langsung (bagian 4.4) |
| K5 | Proteksi rilis | Lindungi branch `main` di GitHub, proyek Vercel terpisah untuk staging | Segera, sebelum merge apa pun |
| K6 | Pemilik ambang | Siapa yang menyetujui rule set (batas gelombang/angin/arus/UKC per kelas kapal) | Perwira keselamatan yang ditunjuk |
| K7 | Akun Copernicus Marine & izin BMKG | Pendaftaran atas nama instansi | Ajukan paralel dengan Fase 1 |

## 9. Yang tidak dilakukan pada Fase 0
- Tidak ada perubahan kode aplikasi, basis data, atau infrastruktur produksi.
- Tidak ada deploy ke produksi; `sigap-laut.vercel.app` tetap versi lama.
- Tidak ada akses ke sumber yang diproteksi (API maritim BMKG).
