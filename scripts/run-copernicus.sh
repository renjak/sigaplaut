#!/usr/bin/env bash
# Jalankan unduhan grid Copernicus + bandingkan dengan Open-Meteo, dalam satu perintah.
# Perlu sesi yang membawa COPERNICUSMARINE_SERVICE_USERNAME & _PASSWORD (gunakan email login Anda sebagai USERNAME).
#   bash scripts/run-copernicus.sh            # bbox rute Batam–Jakarta, 3 hari
#   BBOX="-15 10 92 142" DAYS=7 bash scripts/run-copernicus.sh   # seluruh Indonesia
set -euo pipefail
cd "$(dirname "$0")/.."
VENV=".cmenv"
: "${BBOX:=-7 2 103 108}"; : "${DAYS:=3}"

if [ -z "${COPERNICUSMARINE_SERVICE_USERNAME:-}" ] || [ -z "${COPERNICUSMARINE_SERVICE_PASSWORD:-}" ]; then
  echo "Kredensial Copernicus belum ada di sesi ini."
  echo "Tambahkan COPERNICUSMARINE_SERVICE_USERNAME (= email login Anda) & COPERNICUSMARINE_SERVICE_PASSWORD"
  echo "di pengaturan environment, lalu mulai SESI BARU dan jalankan lagi."
  exit 2
fi

if [ ! -x "$VENV/bin/copernicusmarine" ]; then
  echo "Memasang Copernicus Marine Toolbox (sekali)…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --disable-pip-version-check copernicusmarine
fi

echo "== Unduh grid Copernicus (bbox: $BBOX, $DAYS hari)…"
"$VENV/bin/python" scripts/ingest_copernicus.py --bbox $BBOX --days "$DAYS"
echo
echo "== Bandingkan dengan Open-Meteo…"
"$VENV/bin/python" scripts/compare_copernicus.py --hours 12
