/**
 * Register över publicerade inmätningar: det telefonerna väljer bland. Ren logik utan
 * lagring, så att skrivbordet, dev-servern och Vercel-funktionerna delar samma regler.
 */
export interface CatalogEntry {
  /** Paketets id, samma som i länken /m/<id>. */
  id: string;
  /** Plats, t.ex. "Torphyttan". */
  site: string;
  /** Inmätningsdatum, ÅÅÅÅ-MM-DD. */
  date: string;
  note: string;
  holes: number;
  /** Publiceringstid, ISO 8601. */
  published: string;
}

export interface Catalog {
  version: 1;
  entries: CatalogEntry[];
}

export function emptyCatalog(): Catalog {
  return { version: 1, entries: [] };
}

const sameSalva = (a: CatalogEntry, b: CatalogEntry) => a.site.trim().toLowerCase() === b.site.trim().toLowerCase() && a.date === b.date;

/** Nyast publicerad först. */
export function sortEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((a, b) => b.published.localeCompare(a.published));
}

/**
 * Lägger till en publicering. Samma plats och inmätningsdatum ersätter den gamla, så listan
 * alltid visar senaste versionen av en salva. Returnerar även det som ersattes.
 */
export function upsertEntry(entries: CatalogEntry[], entry: CatalogEntry): { entries: CatalogEntry[]; replaced: CatalogEntry[] } {
  const replaced = entries.filter((e) => e.id === entry.id || sameSalva(e, entry));
  const kept = entries.filter((e) => !replaced.includes(e));
  return { entries: sortEntries([entry, ...kept]), replaced };
}

export function removeEntry(entries: CatalogEntry[], id: string): { entries: CatalogEntry[]; removed: CatalogEntry | null } {
  const removed = entries.find((e) => e.id === id) ?? null;
  return { entries: entries.filter((e) => e !== removed), removed };
}

/** Inmätningsdatum ur ett filnamn som 261001-torphyttan-993.dm4: ÅÅMMDD som egen siffergrupp. */
export function dateFromFileName(name: string): string | null {
  const m = /(?:^|\D)(\d{2})(\d{2})(\d{2})(?!\d)/.exec(name);
  if (!m) return null;
  const [, yy, mm, dd] = m;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `20${yy}-${mm}-${dd}`;
}

/** Platsnamn ur ett filnamn som 261001-torphyttan-993.dm4: textdelarna, med stor bokstav. */
export function siteFromFileName(name: string): string | null {
  const base = name.replace(/\.[^.]+$/, "");
  const parts = base.split(/[-_ ]+/).filter((p) => p.length > 0 && !/^\d+$/.test(p));
  if (parts.length === 0) return null;
  const s = parts.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function localDate(d = new Date()): string {
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Förslag till plats och datum för publiceringsrutan: ur sonderingsfilernas namn, annars ytmodellens namn och dagens datum. */
export function suggestSalva(dm4Names: string[], meshName: string, today = new Date()): { site: string; date: string } {
  const site = dm4Names.map(siteFromFileName).find((s): s is string => !!s) ?? meshName.replace(/\.[^.]+$/, "");
  const date = dm4Names.map(dateFromFileName).find((d): d is string => !!d) ?? localDate(today);
  return { site, date };
}

const MONTHS = ["jan", "feb", "mars", "apr", "maj", "juni", "juli", "aug", "sep", "okt", "nov", "dec"];

/** "1 okt 2026" ur ÅÅÅÅ-MM-DD. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** "nyss", "för 5 min sedan", "i går", "3 okt" för korten. */
export function timeAgo(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "nyss";
  if (s < 3600) return `för ${Math.round(s / 60)} min sedan`;
  if (s < 86400) return `för ${Math.round(s / 3600)} tim sedan`;
  const d = Math.round(s / 86400);
  if (d <= 1) return "i går";
  if (d < 7) return `för ${d} dagar sedan`;
  const date = new Date(t);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}
