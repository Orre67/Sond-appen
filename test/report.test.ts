import { describe, expect, it } from "vitest";
import { buildReport, fitSvg, reportFileName, type ReportData, type ReportHole } from "../src/core/report";

const hole = (id: string, min: number | null, cls: ReportHole["cls"]): ReportHole => ({
  id,
  length: 12.34,
  minBurden: min,
  minBurdenDepth: min === null ? null : 6,
  cls,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" data-hole="${id}"></svg>`,
});

const data = (holes: ReportHole[], extra: Partial<ReportData> = {}): ReportData => ({
  site: "Torphyttan",
  date: "2026-10-01",
  note: "",
  created: "2026-10-21",
  rule: "Rött < 2,0 m, blått > 3,5 m, från 1,0 m djup",
  settings: ["Måttsticka 1,0 m, sämsta värde per sticka"],
  planSvgs: [],
  snapshots: [],
  holes,
  ...extra,
});

const pageCount = (html: string) => (html.match(/<section class="page/g) ?? []).length;

describe("rapporten", () => {
  it("försättsblad med tabell, översikt, 3D-bild och ett hål per sida, med sidnummer", () => {
    const html = buildReport(
      data([hole("1", 2.4, "ok"), hole("2", 1.1, "low"), hole("3", null, "none")], {
        note: "Test <b>",
        planSvgs: [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100%" style="max-height:1px"><rect/></svg>`],
        snapshots: ["data:image/jpeg;base64,AAAA"],
      }),
    );
    expect(html).toContain("<h1>Torphyttan</h1>");
    expect(html).toContain("inmätt 1 okt 2026");
    expect(html).toContain("Test &lt;b&gt;");
    expect(html).toContain("Skapad</dt><dd>21 okt 2026");
    expect(pageCount(html)).toBe(6);
    expect(html).toContain("Sida 6 av 6");
    expect(html).toContain("Under min");
    expect(html).toContain("Ingen yta");
    expect(html).toContain(">12,3<");
    expect(html).toContain('data-hole="2"');
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
    // Översiktens SVG har gjorts skalbar: bredd i procent och inline-stil är borta
    expect(html).not.toContain('width="100%"');
    expect(html).not.toContain("max-height:1px");
    expect(html).toContain('viewBox="0 0 100 50" width="1600" height="800"');
    expect(html).toContain('download="rapport-torphyttan-2026-10-01.html"');
  });

  it("en lång tabell fortsätter på egna sidor", () => {
    const holes = Array.from({ length: 80 }, (_, i) => hole(String(i + 1), 2.5, "ok"));
    const html = buildReport(data(holes));
    // 28 rader på försättsbladet, resten på två fortsättningssidor om högst 40, sedan ett hål per sida
    expect(pageCount(html)).toBe(3 + 80);
    expect(html).toContain("fortsätter på nästa sida");
    expect(html).toContain("Hålen, fortsättning");
  });

  it("utan översikt och bilder: bara försättsblad och hål", () => {
    const html = buildReport(data([hole("7", 3.9, "high")]));
    expect(pageCount(html)).toBe(2);
    expect(html).toContain("Över max");
    expect(html).not.toContain("<h2>Översikt</h2>");
  });
});

describe("fitSvg", () => {
  it("sätter viewBox och proportionerlig bredd och höjd, tar bort stilen", () => {
    const out = fitSvg(`<svg xmlns="x" viewBox="0 0 100 50" width="100%" style="max-height:1px"><rect/></svg>`, 1000, { x: 10, y: 5, w: 40, h: 10 });
    expect(out).toBe(`<svg xmlns="x" viewBox="10 5 40 10" width="1000" height="250"><rect/></svg>`);
  });

  it("behåller befintlig viewBox och lämnar en SVG utan viewBox orörd", () => {
    expect(fitSvg(`<svg viewBox="0 0 200 100" width="200" height="100"></svg>`, 400)).toBe(`<svg viewBox="0 0 200 100" width="400" height="200"></svg>`);
    expect(fitSvg(`<svg width="200" height="100"></svg>`, 400)).toBe(`<svg width="200" height="100"></svg>`);
  });
});

it("filnamnet bygger på plats och datum", () => {
  expect(reportFileName(" Torphyttan Ö2 ", "2026-10-01")).toBe("rapport-torphyttan-ö2-2026-10-01.html");
  expect(reportFileName("", "2026-10-01")).toBe("rapport-salva-2026-10-01.html");
});
