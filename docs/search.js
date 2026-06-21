/* Arkivsøk – klientside fulltekstsøk over per-side-tekstene i search-index.json.
 *
 * Søkemåter (styres av input + avkryssinger, ingen dropdown):
 *   - Standard          : alle ord må finnes på siden, uansett rekkefølge
 *   - "Eksakt frase"     : sett uttrykket i anførselstegn → ordene i nøyaktig rekkefølge
 *   - Fuzzy (avkryssing) : tillat små skrivefeil (redigeringsavstand mot sidens ord)
 *   - Regex (avkryssing) : tolk søkeordet som et regulært uttrykk
 *
 * Søket kan skille mellom store/små bokstaver og begrenses til valgte år.
 * Hvert treff lenker til utgaven (Google Drive) og til en tekstversjon på
 * GitHub med #L-anker rett til linja der treffet står.
 */

// ---------------------------------------------------------------------------
// Lenker til PDF-ene:
//  - Som standard brukes pdf-links.json (Google Drive-lenker fra foreningens
//    nettside). Drive åpner riktig utgave, men kan IKKE hoppe til en bestemt
//    side – sidetallet vises i treffet så man kan bla dit selv.
//  - Setter du BASE_URL (der PDF-ene self-hostes), lenkes det i stedet til
//    <BASE_URL>/<file>#page=<page> som hopper rett til riktig side.
//    Eksempel: "https://eksempel.no/tg-arkiv"
const BASE_URL = "";

// Tekstversjon: hvert treff lenker også til txt-fila på GitHub, med et
// #L<linje>-anker til linja der treffet står. #L virker kun på GitHub blob-
// visning. Sett til riktig repo/branch der txt/ er committet (uten skråstrek
// til slutt). Tom streng skjuler tekst-lenken.
const TXT_BASE = "https://github.com/verahk/TG-arkivsok/blob/main/data/txt";
// ---------------------------------------------------------------------------

const qEl = document.getElementById("q");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const modeEl = document.getElementById("searchMode");
const fuzzyEl = document.getElementById("fuzzy");
const caseEl = document.getElementById("caseSensitive");
const searchBtn = document.getElementById("searchBtn");
const yearFilterEl = document.getElementById("yearFilter");
const yearToggleEl = document.getElementById("yearToggle");
const yearToggleLabelEl = document.getElementById("yearToggleLabel");
const yearPanelEl = document.getElementById("yearPanel");

let docs = []; // alle sidedokumenter fra indeksen
let pdfLinks = {}; // filnavn -> Google Drive-URL (fra pdf-links.json)
const selectedYears = new Set(); // tom = alle år
const decadeToYears = new Map(); // tiår -> sorterte år som finnes

// Returnerer lenke-URL for en side, eller null hvis vi ikke har noen lenke.
function pdfUrl(file, page) {
  if (BASE_URL) {
    return `${BASE_URL.replace(/\/+$/, "")}/${file}#page=${page}`;
  }
  return pdfLinks[file] || null; // Drive-lenke (uten side-hopp)
}

// Lenke til tekstversjonen på GitHub, med #L-anker til linja `line` (1-basert).
function txtUrl(file, line) {
  if (!TXT_BASE) return null;
  return `${TXT_BASE.replace(/\/+$/, "")}/${file.replace(/\.pdf$/i, ".txt")}#L${line}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Del en fritekst-spørring i enkeltord (kun bokstaver/tall, inkl. æøå).
function splitTerms(query) {
  return (query.match(/[A-Za-z0-9ÆØÅæøå]+/g) || []).filter(Boolean);
}

// Hvor mange skrivefeil vi tillater for et ord av gitt lengde.
function fuzzyDist(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// Levenshtein-avstand med tidlig avbrudd når den overstiger `max`.
function editDistance(a, b, max) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // ingen vei tilbake under terskelen
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

// Sant hvis et ord i `wordSet` ligger innenfor tillatt skrivefeil fra `term`.
function fuzzyTermInDoc(term, wordSet) {
  const max = fuzzyDist(term.length);
  if (max === 0) return wordSet.has(term);
  for (const w of wordSet) {
    if (editDistance(term, w, max) <= max) return true;
  }
  return false;
}

// Hvor mange skrivefeil vi tillater i en hel frase av gitt lengde.
function phraseFuzzyK(len) {
  return Math.min(6, Math.max(1, Math.round(len / 6)));
}

// Tilnærmet delstreng-søk (Sellers): finner posisjonen der `pat` slutter i
// `text` med færrest mulig skrivefeil. Returnerer sluttindeksen hvis beste
// match ligger innenfor `k` feil, ellers -1. Lar matchen starte hvor som helst.
function approxSubstringEnd(text, pat, k) {
  const n = text.length;
  const m = pat.length;
  if (m === 0) return -1;
  let prev = new Array(n + 1).fill(0); // rad 0: nuller → start hvor som helst
  let cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const cp = pat.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = cp === text.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  let bestEnd = -1;
  let bestDist = k + 1;
  for (let j = 1; j <= n; j++) {
    if (prev[j] < bestDist) { bestDist = prev[j]; bestEnd = j; }
  }
  return bestDist <= k ? bestEnd : -1;
}

// Sann hvis `doc` matcher spørringen under gjeldende innstillinger.
function docMatches(doc, ctx) {
  const { mode, query, caseSensitive, regex, terms } = ctx;
  if (mode === "regex") return regex.test(doc.text);

  const hay = caseSensitive ? doc.text : doc.text.toLowerCase();
  if (mode === "phrase") {
    if (ctx.fuzzy) return approxSubstringEnd(hay, ctx.needle, ctx.k) !== -1;
    return hay.includes(ctx.needle);
  }
  // all_terms: hvert ord må finnes (delstreng), evt. med fuzzy som ekstra mulighet.
  if (!terms.length) return false;
  return terms.every((t) => {
    const needle = caseSensitive ? t : t.toLowerCase();
    if (hay.includes(needle)) return true;
    if (ctx.fuzzy) return fuzzyTermInDoc(t.toLowerCase(), doc._words);
    return false;
  });
}

// Bygg et utdrag rundt første treff, med <mark> rundt det som matcher.
function buildSnippet(doc, ctx) {
  const { mode, query, caseSensitive, regex, terms } = ctx;
  const text = doc.text;
  let idx = -1;
  let matchLen = 0;

  if (mode === "regex") {
    const m = text.match(regex);
    if (m) { idx = m.index; matchLen = m[0].length; }
  } else if (mode === "phrase") {
    const hay = caseSensitive ? text : text.toLowerCase();
    if (ctx.fuzzy) {
      const endPos = approxSubstringEnd(hay, ctx.needle, ctx.k);
      if (endPos !== -1) {
        idx = Math.max(0, endPos - ctx.needle.length - ctx.k);
        matchLen = ctx.needle.length + ctx.k;
      }
    } else {
      idx = hay.indexOf(ctx.needle);
      matchLen = ctx.needle.length;
    }
  } else {
    const hay = caseSensitive ? text : text.toLowerCase();
    for (const term of terms) {
      const t = caseSensitive ? term : term.toLowerCase();
      const i = hay.indexOf(t);
      if (i !== -1 && (idx === -1 || i < idx)) { idx = i; matchLen = t.length; }
    }
  }

  if (idx === -1) idx = 0;
  const start = Math.max(0, idx - 80);
  const end = Math.min(text.length, idx + matchLen + 160);
  let frag = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) frag = "… " + frag;
  if (end < text.length) frag = frag + " …";

  let out = escapeHtml(frag);
  const flags = caseSensitive ? "g" : "gi";
  const mark = (pattern, fl) => {
    if (!pattern) return;
    try { out = out.replace(new RegExp(`(${pattern})`, fl), "<mark>$1</mark>"); } catch (_) {}
  };

  if (mode === "regex") {
    mark(regex.source, flags);
  } else if (mode === "phrase") {
    if (ctx.fuzzy) {
      // Marker hele den tilnærmet matchede frasen som én enhet, ikke
      // enkeltord – ellers ville frittstående ord (f.eks. «gang») også
      // bli uthevet utenfor selve frasetreffet.
      const hayFrag = caseSensitive ? frag : frag.toLowerCase();
      const endPos = approxSubstringEnd(hayFrag, ctx.needle, ctx.k);
      if (endPos !== -1) {
        const startPos = Math.max(0, endPos - ctx.needle.length);
        out =
          escapeHtml(frag.slice(0, startPos)) +
          "<mark>" + escapeHtml(frag.slice(startPos, endPos)) + "</mark>" +
          escapeHtml(frag.slice(endPos));
      }
    } else {
      mark(escapeRegExp(query), flags);
    }
  } else {
    // all_terms: marker hvert søkeord, og ord som bare traff via fuzzy.
    for (const t of terms) mark(escapeRegExp(t), flags);
    if (ctx.fuzzy) {
      const seen = new Set();
      for (const w of splitTerms(frag)) {
        const lw = w.toLowerCase();
        if (seen.has(lw)) continue;
        seen.add(lw);
        if (terms.some((t) => fuzzyTermInDoc(t.toLowerCase(), new Set([lw])))) {
          mark(escapeRegExp(w), "gi");
        }
      }
    }
  }
  return out;
}

// Finn 0-basert indeks til første linje på siden som matcher spørringen, slik
// at tekst-lenken kan peke på riktig linje. Returnerer -1 hvis ingen enkeltlinje
// matcher (f.eks. frase brutt over linjeskift) – da brukes sidens startlinje.
function firstHitLine(doc, ctx) {
  const lines = doc.lines;
  if (!lines) return -1;
  const { mode, caseSensitive, regex, terms, needle } = ctx;
  for (let i = 0; i < lines.length; i++) {
    const collapsed = lines[i].replace(/\s+/g, " ");
    if (mode === "regex") {
      if (regex.test(collapsed)) return i; // ctx.regex er ikke-global → ingen lastIndex
      continue;
    }
    const hay = caseSensitive ? collapsed : collapsed.toLowerCase();
    if (mode === "phrase") {
      if (ctx.fuzzy ? approxSubstringEnd(hay, needle, ctx.k) !== -1 : hay.includes(needle)) {
        return i;
      }
      continue;
    }
    // all_terms: første linje som inneholder (eller fuzzy-matcher) et søkeord.
    for (const t of terms) {
      const nt = caseSensitive ? t : t.toLowerCase();
      if (hay.includes(nt)) return i;
      if (ctx.fuzzy && fuzzyTermInDoc(t.toLowerCase(), new Set(splitTerms(hay)))) return i;
    }
  }
  return -1;
}

// Kort beskrivelse av valgte år til knappen og statuslinja.
function describeYearSelection() {
  if (selectedYears.size === 0) return "Alle år";
  const fullDecades = [];
  const looseYears = [];
  for (const [dec, years] of decadeToYears) {
    const chosen = years.filter((y) => selectedYears.has(y));
    if (chosen.length === 0) continue;
    if (chosen.length === years.length) fullDecades.push(dec);
    else looseYears.push(...chosen);
  }
  const parts = [
    ...fullDecades.sort((a, b) => a - b).map((d) => `${d}-tallet`),
    ...looseYears.sort((a, b) => a - b).map(String),
  ];
  if (parts.length <= 4) return parts.join(", ");
  return `${selectedYears.size} år valgt`;
}

function updateYearToggleLabel() {
  yearToggleLabelEl.textContent = describeYearSelection();
}

// Sett tiår-avkryssingen til av/på/delvis ut fra hvilke år som er valgt.
function refreshDecadeBoxes() {
  for (const [dec, years] of decadeToYears) {
    const box = yearPanelEl.querySelector(`input[data-decade="${dec}"]`);
    if (!box) continue;
    const chosen = years.filter((y) => selectedYears.has(y)).length;
    box.checked = chosen === years.length;
    box.indeterminate = chosen > 0 && chosen < years.length;
  }
}

function buildYearFilter(allDocs) {
  decadeToYears.clear();
  for (const d of allDocs) {
    if (!decadeToYears.has(d.decade)) decadeToYears.set(d.decade, new Set());
    decadeToYears.get(d.decade).add(d.year);
  }
  // Gjør verdiene om til sorterte arrays.
  const sorted = new Map(
    [...decadeToYears.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dec, set]) => [dec, [...set].sort((a, b) => a - b)])
  );
  decadeToYears.clear();
  for (const [dec, years] of sorted) decadeToYears.set(dec, years);

  // Snarveier: velg alle / nullstill.
  const actions = document.createElement("div");
  actions.className = "panel-actions";
  const allLink = document.createElement("a");
  allLink.textContent = "Velg alle";
  const clearLink = document.createElement("a");
  clearLink.textContent = "Nullstill";
  actions.append(allLink, clearLink);
  yearPanelEl.appendChild(actions);

  allLink.addEventListener("click", () => {
    for (const years of decadeToYears.values()) for (const y of years) selectedYears.add(y);
    syncCheckboxesFromState();
    runSearch();
  });
  clearLink.addEventListener("click", () => {
    selectedYears.clear();
    syncCheckboxesFromState();
    runSearch();
  });

  for (const [dec, years] of decadeToYears) {
    const group = document.createElement("div");
    group.className = "decade-group";

    const head = document.createElement("div");
    head.className = "decade-head";
    const decLabel = document.createElement("label");
    decLabel.innerHTML = `<input type="checkbox" data-decade="${dec}">${dec}-tallet`;
    head.appendChild(decLabel);
    group.appendChild(head);

    const list = document.createElement("div");
    list.className = "year-list";
    for (const y of years) {
      const yl = document.createElement("label");
      yl.innerHTML = `<input type="checkbox" data-year="${y}">${y}`;
      list.appendChild(yl);
    }
    group.appendChild(list);
    yearPanelEl.appendChild(group);

    // Tiår-avkryssing: velg/fjern alle år i tiåret.
    decLabel.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) years.forEach((y) => selectedYears.add(y));
      else years.forEach((y) => selectedYears.delete(y));
      syncCheckboxesFromState();
      runSearch();
    });
  }

  // År-avkryssinger.
  yearPanelEl.querySelectorAll("input[data-year]").forEach((box) => {
    box.addEventListener("change", (e) => {
      const y = Number(e.target.dataset.year);
      if (e.target.checked) selectedYears.add(y);
      else selectedYears.delete(y);
      refreshDecadeBoxes();
      updateYearToggleLabel();
      runSearch();
    });
  });

  updateYearToggleLabel();
}

// Sett alle avkryssinger ut fra selectedYears, og oppdater knappeteksten.
function syncCheckboxesFromState() {
  yearPanelEl.querySelectorAll("input[data-year]").forEach((box) => {
    box.checked = selectedYears.has(Number(box.dataset.year));
  });
  refreshDecadeBoxes();
  updateYearToggleLabel();
}

function runSearch() {
  const raw = qEl.value.trim();
  const caseSensitive = caseEl.checked;
  const mode = modeEl.value; // "all_terms" | "phrase" | "regex"
  const query = raw;
  resultsEl.innerHTML = "";

  if (!docs.length) {
    statusEl.textContent = "Laster indeks...";
    return;
  }
  if (!raw) {
    statusEl.textContent = `Klar – ${docs.length} sider indeksert. Skriv inn et søkeord.`;
    return;
  }

  let regex = null;
  if (mode === "regex") {
    try {
      regex = new RegExp(raw, caseSensitive ? "" : "i");
    } catch (err) {
      statusEl.textContent = `Ugyldig regex: ${err.message}`;
      return;
    }
  }

  const fuzzy = fuzzyEl.checked && (mode === "all_terms" || mode === "phrase");
  const needle = caseSensitive ? query : query.toLowerCase();
  const ctx = {
    mode,
    query,
    caseSensitive,
    regex,
    fuzzy,
    needle,
    k: phraseFuzzyK(needle.length),
    terms: mode === "all_terms" ? splitTerms(query) : [],
  };

  const useYears = selectedYears.size > 0;
  const hits = [];
  for (const doc of docs) {
    if (useYears && !selectedYears.has(doc.year)) continue;
    if (docMatches(doc, ctx)) hits.push(doc);
  }

  const yearTxt = useYears ? ` (begrenset til ${describeYearSelection()})` : "";
  statusEl.textContent = `${hits.length} treff${yearTxt}`;

  if (!hits.length) {
    resultsEl.innerHTML = '<div class="empty">Ingen treff funnet.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  for (const doc of hits) {
    const div = document.createElement("div");
    div.className = "result";
    const stem = doc.file.replace(/\.pdf$/i, "");

    // Linja der treffet står (absolutt linjenummer i txt-fila); fallback til
    // sidens startlinje når treffet ikke kan festes til én linje.
    const hl = doc.txt_line != null ? firstHitLine(doc, ctx) : -1;
    const line = doc.txt_line != null ? doc.txt_line + (hl >= 0 ? hl : 0) : null;
    const lineTxt = line != null ? `, linje ${line}` : "";

    // .txt-lenke (GitHub) med #L-anker til linja 
    const turl = line != null ? txtUrl(doc.file, line) : null;
    const txtLink = turl
      ? `<a href="${turl}" target="_blank" rel="noopener"><strong>${stem}.txt</strong></a> (linje ${line})`
      : line != null ? `<strong>${stem}.txt</strong> (linje ${line})` : "";

    // .pdf-lenke (Google Drive fra foreningens nettside) med side og linjetreff.
    const purl = pdfUrl(doc.file, doc.page);
    const pdfLink = purl
      ? `<a href="${purl}" target="_blank" rel="noopener"><strong>${escapeHtml(doc.file)}</strong></a> (side ${doc.page}${lineTxt})`
      : `<strong>${escapeHtml(doc.file)}</strong> (side ${doc.page}${lineTxt})`;

    const links = [txtLink, pdfLink].filter(Boolean).join(" | ");

    div.innerHTML =
      `<div class="meta">${links}</div>` +
      `<div class="snippet">${buildSnippet(doc, ctx)}</div>`;
    frag.appendChild(div);
  }
  resultsEl.appendChild(frag);
}

async function init() {
  // Last PDF-lenkene (valgfritt – feiler stille hvis fila mangler).
  try {
    const r = await fetch("pdf-links.json", { cache: "no-cache" });
    if (r.ok) pdfLinks = await r.json();
  } catch (_) {
    /* ingen lenkefil – treff vises uten lenke (med mindre BASE_URL er satt) */
  }

  try {
    const resp = await fetch("search-index.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    docs = await resp.json();
    for (const d of docs) {
      // `text` lagres med linjeskift. Behold linjene for å plassere tekst-lenkas
      // #L-anker, og kollaps til mellomrom for selve søket/utdraget.
      d.lines = d.text.split("\n");
      d.text = d.text.replace(/\s+/g, " ").trim();
      // Forhåndsberegn unike, små-bokstaverte ord per side for fuzzy-søk.
      d._words = new Set(splitTerms(d.text.toLowerCase()));
    }
    buildYearFilter(docs);
    statusEl.textContent = `Klar – ${docs.length} sider indeksert. Skriv inn et søkeord.`;
  } catch (err) {
    statusEl.textContent = `Klarte ikke laste indeksen: ${err.message}`;
  }
}

// Lett debounce så fuzzy-søk ikke henger ved rask skriving.
let debounceId = null;
function scheduleSearch() {
  clearTimeout(debounceId);
  debounceId = setTimeout(runSearch, 150);
}

qEl.addEventListener("input", scheduleSearch);
qEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { clearTimeout(debounceId); runSearch(); }
});
modeEl.addEventListener("change", () => {
  // Fuzzy gir ikke mening sammen med regex.
  fuzzyEl.disabled = modeEl.value === "regex";
  runSearch();
});
fuzzyEl.addEventListener("change", runSearch);
caseEl.addEventListener("change", runSearch);
searchBtn.addEventListener("click", runSearch);

// Åpne/lukke nedtrekksmenyen for år, og lukk ved klikk utenfor.
yearToggleEl.addEventListener("click", () => {
  const open = yearPanelEl.hasAttribute("hidden");
  if (open) yearPanelEl.removeAttribute("hidden");
  else yearPanelEl.setAttribute("hidden", "");
  yearToggleEl.setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", (e) => {
  if (!yearFilterEl.contains(e.target)) {
    yearPanelEl.setAttribute("hidden", "");
    yearToggleEl.setAttribute("aria-expanded", "false");
  }
});

init();
