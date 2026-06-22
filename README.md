# TG-arkivsøk

Rutiner for å lage et søkegrensesnitt for tekstsøk i arkivet til *Tilfeldig Gang*, medlemsbladet fra Norsk Statistisk Forening. 

Grensesnittet er tilgjengelig på [denne nettsiden](https://verahk.github.io/TG-arkivsok/)
Hvert søketreff lenker til **PDF-utgaven** (i Google Drive arkivet på [Norsk statistisk forenings nettsider](https://sites.google.com/site/statistiskforening/tilfeldig-gang)) og en ren **tekstversjon** lagret i dette git-repoet.

For å gjøre arkivet søkbart fra en statisk nettside med javascript leses tekst fra de originale pdf-filene til en søke-indeks (en .json-fil). 
Dette gjøres i tre steg, som kjøres i rekkefølge fra prosjektroten:
```bash
scripts/ocr.sh                  # 1. OCR ved behov  (data/raw → data/ocr)
python3 scripts/build_index.py  # 2. søkeindeks + tekstfiler
python3 scripts/build_links.py  # 3. PDF-lenker til arkivet i Google Drive 
```


## Steg 1 – OCR (`scripts/ocr.sh`)

Legger et tekstlag på de skannede PDF-ene i `data/raw/` og skriver søkbare
kopier til `data/ocr/` med `ocrmypdf` (norsk + engelsk). Originalene i
`data/raw/` røres ikke.

- **Digitalt fødte PDF-er** som allerede har et tekstlag (≥ 100 tegn per side)
  oppdages automatisk og kopieres rett inn – de trenger ikke OCR.
- **Skannede PDF-er** OCR-behandles. Dette er tregere og kan gi lesefeil, så
  treff fra disse kan inneholde feil.

Skriptet er idempotent: filer som allerede finnes i `data/ocr/` hoppes over, så
det kan trygt kjøres på nytt etter en avbrytelse.

## Steg 2 – Søkeindeks og tekstfiler (`scripts/build_index.py`)

Leser `data/ocr/` og produserer:

- `docs/search-index.json` – ett dokument per side (`file`, `year`, `decade`,
  `issue`, `page`, `text`, `txt_line`). `text` lagres med linjeskift, og
  `txt_line` peker på sidens startlinje i tekstfila slik at et treff kan
  dyplenkes til riktig linje.
- `data/txt/<år>-<nr>.txt` – hele utgaven som ren tekst, én fil per utgave.

Orddeling ved linjeskift fjernes (f.eks. `statis-\ntikk` → `statistikk`).

## Steg 3 – PDF-lenker (`scripts/build_links.py`)

Henter lenker fra foreningens arkivside (Google Sites) og skriver `docs/pdf-links.json`,
som kobler hver utgave til sin Google Drive-lenke.

## Søkesiden (`docs/`)

Statisk nettside (ingen byggesteg) som kan serveres lokalt med
`cd docs && python3 -m http.server 8000` eller publiseres via GitHub Pages.

- `index.html` – søkegrensesnitt
- `search.js` – klientside-søk
- `search-index.json` – søkeindeksen (fra steg 2)
- `pdf-links.json` – PDF-lenker (fra steg 3)
- `tg-logo.png` – logo

Søkemuligheter: **alle ord**, **eksakt frase** eller **regex**; **fuzzy**
(tillat skrivefeil); skille mellom **store/små bokstaver**; og **årsfilter**.
Hvert treff lenker til `.txt` (GitHub, med `#L`-anker rett til treff-linja) og
til `.pdf` (Google Drive, med side og linje).

### Konfigurasjon (øverst i `docs/search.js`)

- `TXT_BASE` – GitHub blob-URL der `data/txt/` er committet, f.eks.
  `https://github.com/<bruker>/<repo>/blob/main/data/txt`. `#L`-ankeret virker
  kun på GitHubs blob-visning (ikke `raw.githubusercontent` eller vanlig
  statisk host). Tom streng skjuler tekst-lenken.
- `BASE_URL` – valgfri. Settes hvis PDF-ene self-hostes (gir `#page`-hopp rett
  til siden); ellers brukes Drive-lenkene fra `pdf-links.json`.

## Krav

- Python 3.x
- `ocrmypdf`
- poppler (`pdftotext`, `pdfinfo`)
- `curl`

På macOS:

```bash
brew install ocrmypdf poppler
```

## Filstruktur

- `data/raw/` – original-PDF-ene
- `data/ocr/` – OCR-behandlede / kopierte PDF-er (kilde for steg 2)
- `data/txt/` – genererte tekstfiler
- `docs/` – den statiske søkesiden
- `scripts/` – `ocr.sh`, `build_index.py`, `build_links.py`

## Publisering (GitHub Pages)

1. Sett kilde til `docs/`-mappa.
2. Commit `data/txt/` slik at `#L`-lenkene til tekstversjonene virker.
3. Sett `TXT_BASE` i `docs/search.js` til repoets sti, f.eks.
   `https://github.com/<bruker>/<repo>/blob/main/data/txt`.

## Merknader

- `1985-6` finnes ikke på foreningens nettside og får derfor ingen Drive-lenke.
- Treff fra skannede utgaver kan inneholde OCR-lesefeil.
- Søkeindeksen er ~8–9 MB (komprimeres godt; host bør levere gzip).

