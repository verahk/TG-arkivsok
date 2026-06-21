#!/usr/bin/env bash
#
# OCR-batch: legger til et skjult tekstlag på alle PDF-er i data/raw/ og skriver
# søkbare kopier til data/ocr/. Originalene i data/raw/ røres ikke.
#
# Digitalt fødte PDF-er som allerede har et tekstlag trenger ikke OCR (og
# ocrmypdf feiler ofte på dem). Slike oppdages og kopieres rett til data/ocr/.
#
# Idempotent: filer som allerede finnes i pdf_ocr/ hoppes over, så skriptet
# kan trygt kjøres på nytt etter en avbrytelse.
#
# Bruk:  scripts/ocr.sh
set -uo pipefail

# Rotmappe = mappa over dette skriptet
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT/data/raw"
OUT_DIR="$ROOT/data/ocr"
LOG="$OUT_DIR/ocr.log"

mkdir -p "$OUT_DIR"

shopt -s nullglob
pdfs=("$SRC_DIR"/*.pdf)
total=${#pdfs[@]}
if (( total == 0 )); then
  echo "Ingen PDF-er funnet i $SRC_DIR" >&2
  exit 1
fi

echo "=== OCR-kjøring startet ($(date)) — $total filer ===" | tee -a "$LOG"

i=0
ok=0
copied=0
skipped=0
failed=0
for src in "${pdfs[@]}"; do
  i=$((i + 1))
  name="$(basename "$src")"
  out="$OUT_DIR/$name"

  if [[ -f "$out" ]]; then
    printf "[%d/%d] HOPP OVER (finnes alt): %s\n" "$i" "$total" "$name"
    skipped=$((skipped + 1))
    continue
  fi

  # Har PDF-en allerede et rikelig tekstlag (digitalt født)? Da trengs ikke OCR
  # — kopier den rett inn. Terskel: i snitt minst 100 tegn (uten whitespace)
  # per side. Skannede sider uten tekstlag gir ~0 tegn.
  chars=$(pdftotext "$src" - 2>/dev/null | tr -d '[:space:]' | wc -c | tr -d ' ')
  pages=$(pdfinfo "$src" 2>/dev/null | awk '/^Pages/{print $2; exit}')
  if [[ -n "$pages" && "$pages" -gt 0 ]] && (( chars >= pages * 100 )); then
    cp "$src" "$out"
    printf "[%d/%d] KOPIERT (har tekstlag): %s\n" "$i" "$total" "$name"
    echo "[$i/$total] KOPIERT (tekstlag: $chars tegn / $pages sider): $name" >>"$LOG"
    copied=$((copied + 1))
    continue
  fi

  printf "[%d/%d] OCR: %s ... " "$i" "$total" "$name"
  # Skriv til midlertidig fil så en avbrutt kjøring ikke etterlater en halv PDF
  # som «finnes alt» ved neste kjøring.
  tmp="$out.partial"
  if ocrmypdf \
        --skip-text \
        -l nor+eng \
        --output-type pdf \
        --jobs 4 \
        --rotate-pages \
        --deskew \
        "$src" "$tmp" >>"$LOG" 2>&1; then
    mv "$tmp" "$out"
    echo "OK"
    echo "[$i/$total] OK: $name" >>"$LOG"
    ok=$((ok + 1))
  else
    rc=$?
    rm -f "$tmp"
    echo "FEIL (rc=$rc) — se $LOG"
    echo "[$i/$total] FEIL (rc=$rc): $name" >>"$LOG"
    failed=$((failed + 1))
  fi
done

echo "=== Ferdig ($(date)) — OK: $ok, kopiert: $copied, hoppet over: $skipped, feil: $failed ===" | tee -a "$LOG"
