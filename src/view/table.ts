import { rowType } from "../core/csv";
import type { HoleResult } from "../geom/burden";
import { CLASS_LABELS, escapeXml, fmt } from "./format";

/** HTML-tabell med påhugg och alla stickor/punkter för ett eller alla hål. */
export function renderTable(results: HoleResult[], selectedId: string | null, showAll: boolean): string {
  const list = showAll ? results : results.filter((r) => r.id === selectedId);
  if (list.length === 0) return `<p class="empty">Inga resultat att visa.</p>`;
  const head = [
    "Hål", "Sticka [m]", "Djup [m]", "Typ", "Försättning [m]", "Klass", "Bäring till yta", "Höjdvinkel", "Fritt 3D-min [m]",
    "E", "N", "Z", "Närmaste Z",
  ];
  const rows: string[] = [];
  for (const r of list) {
    for (const row of r.rows) {
      const stick = row.stickEnd - row.stickStart > 1e-9 ? `${fmt(row.stickStart, 1)}–${fmt(row.stickEnd, 1)}` : "";
      rows.push(
        `<tr class="${row.cls}">` +
          `<td>${escapeXml(r.id)}</td><td>${stick}</td><td>${fmt(row.depth, 2)}</td><td class="cls">${rowType(row)}</td>` +
          `<td><b>${fmt(row.burden, 2)}</b></td><td class="cls">${CLASS_LABELS[row.cls]}</td>` +
          `<td>${fmt(row.bearingTo, 0)}°</td><td>${fmt(row.elevationTo, 0)}°</td><td>${fmt(row.free3d, 2)}</td>` +
          `<td>${fmt(row.point[0], 2)}</td><td>${fmt(row.point[1], 2)}</td><td>${fmt(row.point[2], 2)}</td>` +
          `<td>${fmt(row.closest ? row.closest[2] : null, 2)}</td>` +
          `</tr>`,
      );
    }
  }
  return (
    `<table><thead><tr>${head.map((h, i) => `<th${i === 3 || i === 5 ? ' class="cls"' : ""}>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table>`
  );
}
