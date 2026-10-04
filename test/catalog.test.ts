import { describe, expect, it } from "vitest";
import {
  dateFromFileName,
  formatDate,
  removeEntry,
  siteFromFileName,
  suggestSalva,
  timeAgo,
  upsertEntry,
  type CatalogEntry,
} from "../src/core/catalog";

const entry = (id: string, site: string, date: string, published: string): CatalogEntry => ({ id, site, date, note: "", holes: 24, published });

describe("register över inmätningar", () => {
  it("samma plats och datum ersätter, annars läggs till, nyast först", () => {
    const a = entry("aaaaaaaaaa", "Torphyttan", "2026-10-01", "2026-10-02T08:00:00Z");
    const b = entry("bbbbbbbbbb", "Hovgården", "2026-09-21", "2026-10-03T08:00:00Z");
    let entries = upsertEntry([], a).entries;
    entries = upsertEntry(entries, b).entries;
    expect(entries.map((e) => e.id)).toEqual(["bbbbbbbbbb", "aaaaaaaaaa"]);
    const again = upsertEntry(entries, entry("cccccccccc", "torphyttan ", "2026-10-01", "2026-10-04T08:00:00Z"));
    expect(again.replaced.map((e) => e.id)).toEqual(["aaaaaaaaaa"]);
    expect(again.entries.map((e) => e.id)).toEqual(["cccccccccc", "bbbbbbbbbb"]);
    const removed = removeEntry(again.entries, "bbbbbbbbbb");
    expect(removed.removed?.site).toBe("Hovgården");
    expect(removed.entries).toHaveLength(1);
  });

  it("föreslår plats och datum ur sonderingsfilernas namn", () => {
    expect(dateFromFileName("261001-torphyttan-993.dm4")).toBe("2026-10-01");
    expect(dateFromFileName("Hovgården260921.txt")).toBe("2026-09-21");
    expect(dateFromFileName("test1.obj")).toBeNull();
    expect(dateFromFileName("991399-x.dm4")).toBeNull();
    expect(siteFromFileName("261001-torphyttan-993.dm4")).toBe("Torphyttan");
    expect(siteFromFileName("993.dm4")).toBeNull();
    expect(suggestSalva(["261001-torphyttan-993.dm4"], "test1.obj")).toEqual({ site: "Torphyttan", date: "2026-10-01" });
    const fallback = suggestSalva([], "test1.obj", new Date(2026, 9, 4));
    expect(fallback).toEqual({ site: "test1", date: "2026-10-04" });
  });

  it("formaterar datum och tid sedan publicering", () => {
    expect(formatDate("2026-10-01")).toBe("1 okt 2026");
    const now = new Date("2026-10-04T12:00:00Z");
    expect(timeAgo("2026-10-04T11:59:40Z", now)).toBe("nyss");
    expect(timeAgo("2026-10-04T11:30:00Z", now)).toBe("för 30 min sedan");
    expect(timeAgo("2026-10-04T07:00:00Z", now)).toBe("för 5 tim sedan");
    expect(timeAgo("2026-10-03T10:00:00Z", now)).toBe("i går");
    expect(timeAgo("2026-10-01T10:00:00Z", now)).toBe("för 3 dagar sedan");
    expect(timeAgo("2026-09-10T10:00:00Z", now)).toBe("10 sep");
  });
});
