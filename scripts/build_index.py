#!/usr/bin/env python3
"""Bygg søkeindeks (JSON) + tekstfiler fra de OCR-behandlede PDF-ene i data/ocr/.

Produserer:
  - docs/search-index.json : ett dokument per side (for klientsøket)
  - data/txt/<år>-<nr>.txt  : hele utgaven som ren tekst, én fil per utgave,
                              med én blank linje mellom sider (ingen injisert
                              overskrift – trofast mot OCR-teksten).

Hvert sidedokument i indeksen:

    {"id": "1984-1#3", "file": "1984-1.pdf", "year": 1984, "decade": 1980,
     "issue": 1, "page": 3, "text": "<sidetekst med linjeskift>", "txt_line": 57}

`text` lagres med linjeskift (rå sidetekst) slik at klienten kan finne hvilken
linje et treff står på. `txt_line` er linjenummeret (1-basert) der siden starter
i txt-fila; rå linje j (0-basert) ligger da på fillinje `txt_line + j`. Det lar
et søketreff dyplenke til riktig linje via GitHubs #L<linje>-anker, f.eks.
<TXT_BASE>/1984-1.txt#L57 — noe Drive-visningen av PDF-en ikke kan.

Tekst hentes per side med `pdftotext`. Orddeling ved linjeskift fjernes (se
`dehyphenate`). Filnavnet (<år>-<utgave>.pdf) gir metadata for år/utgave/tiår.

Bruk:  python3 scripts/build_index.py
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / "data" / "ocr"
OUT_FILE = ROOT / "docs" / "search-index.json"
TXT_DIR = ROOT / "data" / "txt"

# <år>-<utgave>.pdf, f.eks. 1984-1.pdf
NAME_RE = re.compile(r"^(\d{4})-(\d+)$")

# Sider med færre tegn enn dette regnes som tomme/mislykket OCR og logges.
MIN_CHARS = 20

# Orddeling ved linjeskift: bokstav + bindestrek + linjeskift + liten bokstav.
# Slår sammen "statis-\ntikk" -> "statistikk". Krav om liten forbokstav på
# fortsettelsen bevarer ekte sammensetninger som "Nord-\nNorge".
HYPHEN_RE = re.compile(r"([A-Za-zÀ-ÿ])-[ \t]*\n[ \t]*([a-zà-ÿ])")


def dehyphenate(text: str) -> str:
    """Fjern orddeling ved linjeskift (enkel heuristikk)."""
    return HYPHEN_RE.sub(r"\1\2", text)


def page_count(pdf: Path) -> int:
    out = subprocess.run(
        ["pdfinfo", str(pdf)], capture_output=True, text=True, check=True
    ).stdout
    for line in out.splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    return 0


def page_text_raw(pdf: Path, page: int) -> str:
    """Rå tekst (med linjeskift) for én side, brukt i txt-fila."""
    return subprocess.run(
        ["pdftotext", "-f", str(page), "-l", str(page), str(pdf), "-"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def main() -> int:
    if not OCR_DIR.is_dir():
        print(f"Finner ikke {OCR_DIR}. Kjør scripts/ocr.sh først.", file=sys.stderr)
        return 1

    pdfs = sorted(OCR_DIR.glob("*.pdf"))
    if not pdfs:
        print(f"Ingen PDF-er i {OCR_DIR}.", file=sys.stderr)
        return 1

    TXT_DIR.mkdir(parents=True, exist_ok=True)

    docs: list[dict] = []
    empty_pages: list[str] = []

    for pdf in pdfs:
        stem = pdf.stem
        m = NAME_RE.match(stem)
        if not m:
            print(f"  ADVARSEL: hopper over uventet filnavn: {pdf.name}", file=sys.stderr)
            continue
        year = int(m.group(1))
        issue = int(m.group(2))
        decade = year - year % 10

        n = page_count(pdf)
        print(f"{pdf.name}: {n} sider")

        txt_lines: list[str] = []  # akkumulerer hele utgavens tekst
        for page in range(1, n + 1):
            raw = dehyphenate(page_text_raw(pdf, page))
            page_lines = raw.splitlines()

            # 1-basert linjenummer der sidens innhold starter i txt-fila.
            txt_line = len(txt_lines) + 1
            txt_lines.extend(page_lines)
            txt_lines.append("")  # blank linje mellom sider

            # Lagre teksten med linjeskift slik at klienten kan finne treff-linja.
            if len(" ".join(raw.split())) < MIN_CHARS:
                empty_pages.append(f"{stem}#{page}")
            docs.append(
                {
                    "id": f"{stem}#{page}",
                    "file": pdf.name,
                    "year": year,
                    "decade": decade,
                    "issue": issue,
                    "page": page,
                    "text": "\n".join(page_lines),
                    "txt_line": txt_line,
                }
            )

        (TXT_DIR / f"{stem}.txt").write_text("\n".join(txt_lines) + "\n", encoding="utf-8")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open("w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = OUT_FILE.stat().st_size / 1_000_000
    print(f"\nSkrev {len(docs)} sidedokumenter til {OUT_FILE} ({size_mb:.1f} MB)")
    print(f"Skrev tekstfiler til {TXT_DIR}/")
    if empty_pages:
        print(
            f"ADVARSEL: {len(empty_pages)} sider har lite/ingen tekst "
            f"(mulig OCR-feil), f.eks.: {', '.join(empty_pages[:10])}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
