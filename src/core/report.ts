import type { BurdenClass } from "../geom/burden";
import { CLASS_COLORS, CLASS_LABELS, escapeXml, fmt } from "../view/format";
import { formatDate } from "./catalog";

/**
 * Rapporten: ett fristående HTML-dokument för A4 liggande med försättsblad, översikt, bilder ur
 * 3D-vyn och ett profilkort per hål. Allt är inbakat (SVG och data-URL:er), så filen kan sparas,
 * mejlas och skrivas ut till PDF från vilken webbläsare som helst. Ingen DOM och ingen modell här:
 * bara färdiga strängar och tal, så att bygget kan testas och köras från kommandoraden.
 */

/** Ett hål i rapporten: raden i tabellen och profilkortet som SVG. */
export interface ReportHole {
  id: string;
  /** Hålets längd, m. */
  length: number;
  minBurden: number | null;
  minBurdenDepth: number | null;
  cls: BurdenClass;
  /** Profilkortet med snittet och väggen framifrån, färdig SVG. */
  svg: string;
}

export interface ReportData {
  site: string;
  /** Inmätningsdatum, ÅÅÅÅ-MM-DD. */
  date: string;
  note: string;
  /** Dagen rapporten skapades, ÅÅÅÅ-MM-DD. */
  created: string;
  /** Färgregeln i klartext, t.ex. "Rött < 2,0 m, blått > 3,5 m, från 1,0 m djup". */
  rule: string;
  /** Övriga inställningar i klartext, en post per rad. */
  settings: string[];
  /** Översikterna som SVG, en sida var: de fönster användaren tagit bilder av, annars ett kring hålen. Tom utan yta. */
  planSvgs: string[];
  /** Bilder ur 3D-vyn, data-URL:er, i den ordning de togs. */
  snapshots: string[];
  holes: ReportHole[];
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bildytan på en sida med rubrik, mm: sidans 277 mm minus 2 × 10 mm vaddering, och höjden under rubriken. */
export const FIGURE_MM = { w: 257, h: 150 };
/** Samma yta i CSS-pixlar (96 dpi), för markörer som ritas i skärmpixlar. */
export const FIGURE_PX = { w: Math.round((FIGURE_MM.w * 96) / 25.4), h: Math.round((FIGURE_MM.h * 96) / 25.4) };

/** Tabellkolumner per sida (tre ryms inte i bredd) och högst så många rader per kolumn: försättsbladet har mindre plats än en fortsättningssida. */
const TABLE_COLUMNS = 2;
const ROWS_COVER = 14;
const ROWS_PAGE = 20;

/**
 * Gör en SVG skalbar i rapporten: tar bort bredd, höjd och inline-stil ur rottaggen och sätter
 * viewBox (den angivna eller den befintliga) samt bredd och höjd i samma proportion, så att bilden
 * skalas som en vanlig bild av max-width och max-height. Utan användbar viewBox lämnas SVG:n orörd.
 */
export function fitSvg(svg: string, widthPx: number, viewBox?: ViewBox): string {
  const m = /<svg\b([^>]*)>/.exec(svg);
  if (!m) return svg;
  let vb = viewBox;
  if (!vb) {
    const v = /\sviewBox="([^"]*)"/.exec(m[1]);
    const n = v ? v[1].trim().split(/[\s,]+/).map(Number) : [];
    if (n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0) vb = { x: n[0], y: n[1], w: n[2], h: n[3] };
  }
  if (!vb) return svg;
  const attrs = m[1].replace(/\s(viewBox|width|height|style)="[^"]*"/g, "");
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const w = Math.round(widthPx);
  const h = Math.round((widthPx * vb.h) / vb.w);
  const tag = `<svg${attrs} viewBox="${f(vb.x)} ${f(vb.y)} ${f(vb.w)} ${f(vb.h)}" width="${w}" height="${h}">`;
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

/** Filnamn för rapporten: rapport-<plats>-<datum>.html, platsen med små bokstäver och bindestreck. */
export function reportFileName(site: string, date: string): string {
  const slug = site
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `rapport-${slug || "salva"}-${date}.html`;
}

/** Bygger rapporten som ett komplett HTML-dokument. */
export function buildReport(d: ReportData): string {
  const esc = escapeXml;
  const dateText = formatDate(d.date);
  const pages: ((n: number, total: number) => string)[] = [];
  const footer = (n: number, total: number) =>
    `<footer><span>${esc(d.site)}</span><span>Inmätt ${esc(dateText)}</span><span>Sida ${n} av ${total}</span></footer>`;

  // Försättsbladet tar de första tabellraderna, resten fortsätter på egna sidor.
  const perCover = TABLE_COLUMNS * ROWS_COVER;
  const perPage = TABLE_COLUMNS * ROWS_PAGE;
  const coverRows = d.holes.slice(0, perCover);
  const rest = d.holes.slice(perCover);
  pages.push(
    (n, total) =>
      `<section class="page cover">` +
      `<header><h1>${esc(d.site)}</h1><p class="sub">Försättning mot fri bergyta · inmätt ${esc(dateText)}</p>` +
      (d.note ? `<p class="note">${esc(d.note)}</p>` : "") +
      `</header>` +
      `<dl class="meta">` +
      `<div><dt>Hål</dt><dd>${d.holes.length}</dd></div>` +
      `<div><dt>Regel</dt><dd>${esc(d.rule)}</dd></div>` +
      `<div><dt>Inställningar</dt><dd>${d.settings.map(esc).join(" · ") || "–"}</dd></div>` +
      `<div><dt>Skapad</dt><dd>${esc(formatDate(d.created))}</dd></div>` +
      `</dl>` +
      summaryTables(coverRows, ROWS_COVER) +
      (rest.length > 0 ? `<p class="more">Tabellen fortsätter på nästa sida.</p>` : "") +
      footer(n, total) +
      `</section>`,
  );
  for (let i = 0; i < rest.length; i += perPage) {
    const rows = rest.slice(i, i + perPage);
    pages.push((n, total) => `<section class="page"><h2>Hålen, fortsättning</h2>${summaryTables(rows, ROWS_PAGE)}${footer(n, total)}</section>`);
  }
  d.planSvgs.forEach((plan, i) => {
    const title = d.planSvgs.length > 1 ? `Översikt ${i + 1}` : "Översikt";
    const svg = fitSvg(plan, 1600);
    pages.push((n, total) => `<section class="page"><h2>${title}</h2><div class="figure">${svg}</div>${footer(n, total)}</section>`);
  });
  d.snapshots.forEach((src, i) => {
    const title = d.snapshots.length > 1 ? `3D-vy ${i + 1}` : "3D-vy";
    pages.push((n, total) => `<section class="page"><h2>${title}</h2><div class="figure"><img src="${src}" alt="${title}"></div>${footer(n, total)}</section>`);
  });
  for (const h of d.holes) {
    pages.push((n, total) => `<section class="page hole"><div class="figure">${h.svg}</div>${footer(n, total)}</section>`);
  }

  const total = pages.length;
  const body = pages.map((p, i) => p(i + 1, total)).join("\n");
  const title = `${d.site} ${d.date} – försättning`;
  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="bar">
<button type="button" onclick="window.print()">Skriv ut / spara som PDF</button>
<a href="" download="${esc(reportFileName(d.site, d.date))}">Spara som HTML-fil</a>
<span class="hint">A4 liggande. Stäng av sidhuvud och sidfot i utskriftsrutan.</span>
</div>
${body}
</body>
</html>
`;
}

/** Tabellen över hålen i kolumner sida vid sida: så få kolumner som behövs med högst maxRows rader, jämnt fördelade. */
function summaryTables(rows: ReportHole[], maxRows: number): string {
  if (rows.length === 0) return "";
  const count = Math.ceil(rows.length / maxRows);
  const per = Math.ceil(rows.length / count);
  const columns: ReportHole[][] = [];
  for (let i = 0; i < rows.length; i += per) columns.push(rows.slice(i, i + per));
  const head = `<thead><tr><th>Hål</th><th class="num">Längd [m]</th><th class="num">Min förs. [m]</th><th class="num">På djup [m]</th><th>Bedömning</th></tr></thead>`;
  return `<div class="tables">${columns.map((c) => `<table class="summary">${head}<tbody>${c.map(summaryRow).join("")}</tbody></table>`).join("")}</div>`;
}

function summaryRow(h: ReportHole): string {
  const dash = "–";
  return (
    `<tr><td>${escapeXml(h.id)}</td>` +
    `<td class="num">${fmt(h.length, 1)}</td>` +
    `<td class="num">${h.minBurden === null ? dash : fmt(h.minBurden, 2)}</td>` +
    `<td class="num">${h.minBurdenDepth === null ? dash : fmt(h.minBurdenDepth, 1)}</td>` +
    `<td><span class="dot" style="background:${CLASS_COLORS[h.cls]}"></span>${CLASS_LABELS[h.cls]}</td></tr>`
  );
}

/** Sidorna är 277 × 188 mm: A4 liggande med 10 mm marginal, något lägre än sidan så att avrundning inte ger tomma blad. */
const STYLE = `
:root { --text: #1c1f23; --muted: #667085; --border: #dde1e6; --accent: #1f6feb; }
* { box-sizing: border-box; }
html, body { margin: 0; background: #e6e8ec; color: var(--text); font-family: "Segoe UI", system-ui, Arial, sans-serif; font-size: 11pt; }
.bar { position: sticky; top: 0; z-index: 1; display: flex; gap: 14px; align-items: center; padding: 8px 16px; background: #fff; border-bottom: 1px solid var(--border); font-size: 13px; }
.bar button { font: inherit; padding: 6px 12px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: #fff; cursor: pointer; }
.bar a { color: var(--accent); }
.bar .hint { margin-left: auto; color: var(--muted); }
.page { width: 277mm; height: 188mm; margin: 10mm auto; padding: 8mm 10mm; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.15); display: flex; flex-direction: column; overflow: hidden; }
h1 { margin: 0; font-size: 26pt; font-weight: 700; }
h2 { margin: 0 0 4mm; font-size: 14pt; font-weight: 600; }
.sub { margin: 2mm 0 0; font-size: 12pt; color: var(--muted); }
.note { margin: 2mm 0 0; }
.meta { display: grid; grid-template-columns: auto auto 1fr auto; gap: 4mm 10mm; margin: 6mm 0; padding: 4mm 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); font-size: 10pt; }
.meta dt { color: var(--muted); font-size: 8.5pt; }
.meta dd { margin: 0; }
.tables { display: flex; gap: 8mm; align-items: flex-start; }
table.summary { flex: 1; border-collapse: collapse; font-size: 9.5pt; }
.summary th, .summary td { padding: 1mm 2.5mm; text-align: left; border-bottom: 1px solid #eceef1; white-space: nowrap; }
.summary th { color: var(--muted); font-weight: 600; font-size: 8.5pt; }
.summary .num { text-align: right; font-variant-numeric: tabular-nums; }
.dot { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 50%; margin-right: 1.5mm; vertical-align: -0.3mm; }
.more { margin: 2mm 0 0; font-size: 9pt; color: var(--muted); }
.figure { height: ${FIGURE_MM.h}mm; display: flex; align-items: center; justify-content: center; }
.hole .figure { height: 160mm; }
.figure svg, .figure img { max-width: 100%; max-height: 100%; width: auto; height: auto; }
footer { display: flex; justify-content: space-between; margin-top: auto; padding-top: 2mm; border-top: 1px solid var(--border); font-size: 8.5pt; color: var(--muted); }
@page { size: A4 landscape; margin: 10mm; }
@media print {
  html, body { background: #fff; }
  .bar { display: none; }
  .page { width: auto; margin: 0; box-shadow: none; break-after: page; }
  .page:last-of-type { break-after: auto; }
}
`;
