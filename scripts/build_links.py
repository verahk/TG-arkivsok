#!/usr/bin/env python3
"""Bygg docs/pdf-links.json: kobling fra utgave (<år>-<nr>.pdf) til Google
Drive-lenken på foreningens nettside.

Nettsiden lister utgavene gruppert per år (nyeste først). Innen hvert år er
lenkene sekvensielle: første lenke = utgave 1, andre = utgave 2, osv. (måneden
i lenketeksten er kun til informasjon).

Bruk:  python3 scripts/build_links.py
"""
from __future__ import annotations

import json
import re
import subprocess
from collections import defaultdict
from pathlib import Path

URL = "https://sites.google.com/site/statistiskforening/tilfeldig-gang"
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "pdf-links.json"

YEAR_RE = re.compile(r'<span class="C9DxTc[^"]*"[^>]*>\s*((?:19|20)\d{2})\s*</span>')
ANCHOR_RE = re.compile(
    r'<a [^>]*href="[^"]*drive\.google\.com/file/d/([A-Za-z0-9_-]+)[^"]*"[^>]*>(.*?)</a>',
    re.S,
)


def fetch(url: str) -> str:
    # Hentes via curl (mer robust mht. nettverk/sandkasse enn urllib).
    out = subprocess.run(
        ["curl", "-sL", "-A", "Mozilla/5.0", url],
        capture_output=True,
        check=True,
    )
    return out.stdout.decode("utf-8", errors="replace")


def main() -> int:
    html = fetch(URL)
    years = [(m.start(), int(m.group(1))) for m in YEAR_RE.finditer(html)]
    anchors = [(m.start(), m.group(1)) for m in ANCHOR_RE.finditer(html)]
    print(f"Fant {len(years)} årstall og {len(anchors)} Drive-lenker.")

    def year_before(pos: int):
        best = None
        for yp, yr in years:
            if yp < pos:
                best = yr
            else:
                break
        return best

    # Grupper lenker per år i kilde-rekkefølge.
    by_year: dict[int, list[str]] = defaultdict(list)
    for pos, fid in anchors:
        yr = year_before(pos)
        if yr is not None:
            by_year[yr].append(fid)

    # Sekvensiell nummerering innen hvert år.
    mapping: dict[str, str] = {}
    for yr, ids in by_year.items():
        for i, fid in enumerate(ids, start=1):
            mapping[f"{yr}-{i}.pdf"] = f"https://drive.google.com/file/d/{fid}/view"

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=0)
    print(f"Skrev {len(mapping)} koblinger til {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
