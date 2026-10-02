import type { BurdenOptions, HoleResult } from "../geom/burden";
import type { Bounds } from "../io/mesh";
import { CLASS_COLORS, escapeXml, fmt, holeClass } from "./format";

export interface PlanBackground {
  /** Data-URL för en bild som täcker bounds sedd uppifrån, norr uppåt. */
  dataUrl: string;
}

/**
 * Översikt av hela salvan uppifrån. Enheten i viewBox är meter, så linjebredder
 * och textstorlekar anges i meter.
 */
export function renderPlanSvg(
  results: HoleResult[],
  opts: BurdenOptions,
  bounds: Bounds,
  bg: PlanBackground | null,
  selectedId: string | null,
): string {
  const pad = 3;
  const minE = bounds.min[0] - pad;
  const maxE = bounds.max[0] + pad;
  const minN = bounds.min[1] - pad;
  const maxN = bounds.max[1] + pad;
  const w = maxE - minE;
  const h = maxN - minN;
  const X = (e: number) => e - minE;
  const Y = (n: number) => maxN - n;
  const f = (v: number) => v.toFixed(2);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(w)} ${f(h)}" width="100%" style="max-height:calc(100vh - 140px)" font-family="Segoe UI, Arial, sans-serif">`,
  );
  parts.push(`<rect width="${f(w)}" height="${f(h)}" fill="#f1f1ee"/>`);
  if (bg) {
    parts.push(
      `<image href="${bg.dataUrl}" x="${f(X(bounds.min[0]))}" y="${f(Y(bounds.max[1]))}" width="${f(bounds.max[0] - bounds.min[0])}" height="${f(bounds.max[1] - bounds.min[1])}" preserveAspectRatio="none"/>`,
    );
  } else {
    parts.push(
      `<rect x="${f(X(bounds.min[0]))}" y="${f(Y(bounds.max[1]))}" width="${f(bounds.max[0] - bounds.min[0])}" height="${f(bounds.max[1] - bounds.min[1])}" fill="none" stroke="#999" stroke-width="0.15" stroke-dasharray="0.6 0.4"/>`,
    );
  }

  for (const r of results) {
    const cls = holeClass(r, opts);
    const color = CLASS_COLORS[cls];
    const sel = r.id === selectedId;
    parts.push(`<g class="plan-hole" data-id="${escapeXml(r.id)}" style="cursor:pointer">`);
    parts.push(
      `<polyline points="${r.path.points.map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(" ")}" fill="none" stroke="#141414" stroke-width="0.14"/>`,
    );
    const minRow = r.rows.find((x) => x.depth === r.minBurdenDepth);
    if (minRow && minRow.closest) {
      parts.push(
        `<line x1="${f(X(minRow.point[0]))}" y1="${f(Y(minRow.point[1]))}" x2="${f(X(minRow.closest[0]))}" y2="${f(Y(minRow.closest[1]))}" stroke="${color}" stroke-width="0.14"/>`,
      );
    }
    if (sel) parts.push(`<circle cx="${f(X(r.path.collar[0]))}" cy="${f(Y(r.path.collar[1]))}" r="1.1" fill="none" stroke="#f0a500" stroke-width="0.25"/>`);
    parts.push(
      `<circle cx="${f(X(r.path.collar[0]))}" cy="${f(Y(r.path.collar[1]))}" r="0.55" fill="${color}" stroke="#fff" stroke-width="0.12"/>`,
    );
    parts.push(
      `<text x="${f(X(r.path.collar[0]) - 0.8)}" y="${f(Y(r.path.collar[1]) + 0.45)}" font-size="1.3" font-weight="700" text-anchor="end" fill="#111" stroke="#fff" stroke-width="0.25" paint-order="stroke">${escapeXml(r.id)}</text>`,
    );
    parts.push(
      `<text x="${f(X(r.path.collar[0]) + 0.9)}" y="${f(Y(r.path.collar[1]) + 0.45)}" font-size="1.1" fill="${color}" stroke="#fff" stroke-width="0.25" paint-order="stroke">${fmt(r.minBurden, 2)}</text>`,
    );
    parts.push(`</g>`);
  }

  // Norrpil och skalstock
  parts.push(`<g transform="translate(${f(w - 3)},${f(3)})">`);
  parts.push(`<line x1="0" y1="2.2" x2="0" y2="-1.6" stroke="#222" stroke-width="0.25"/>`);
  parts.push(`<polygon points="0,-2.4 -0.7,-0.9 0.7,-0.9" fill="#222"/>`);
  parts.push(`<text x="1" y="0.4" font-size="1.4" font-weight="700" fill="#222">N</text>`);
  parts.push(`</g>`);
  parts.push(`<g transform="translate(2,${f(h - 2)})">`);
  parts.push(`<line x1="0" y1="0" x2="10" y2="0" stroke="#222" stroke-width="0.3"/>`);
  parts.push(`<line x1="0" y1="-0.5" x2="0" y2="0.5" stroke="#222" stroke-width="0.2"/>`);
  parts.push(`<line x1="10" y1="-0.5" x2="10" y2="0.5" stroke="#222" stroke-width="0.2"/>`);
  parts.push(`<text x="5" y="-0.8" font-size="1.2" text-anchor="middle" fill="#222">10 m</text>`);
  parts.push(`</g>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}
