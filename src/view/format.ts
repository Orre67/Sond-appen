import type { BurdenClass, BurdenOptions, HoleResult } from "../geom/burden";

/** Tal med decimalkomma, tom sträng för saknat värde. */
export function fmt(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return v.toFixed(decimals).replace(".", ",");
}

export const CLASS_COLORS: Record<BurdenClass, string> = {
  collar: "#8a8a8a",
  skipped: "#c4c4c4",
  low: "#d7263d",
  ok: "#2e9e44",
  high: "#2b6cd4",
  none: "#999999",
};

export const CLASS_LABELS: Record<BurdenClass, string> = {
  collar: "Påhugg",
  skipped: "Ovanför startdjup",
  low: "Under min",
  ok: "OK",
  high: "Över max",
  none: "Ingen yta",
};

/** Sammanfattande klass för ett hål utifrån dess minsta försättning. */
export function holeClass(r: HoleResult, opts: BurdenOptions): BurdenClass {
  if (r.minBurden === null) return "none";
  if (r.minBurden < opts.minBurden) return "low";
  if (r.minBurden > opts.maxBurden) return "high";
  return "ok";
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
