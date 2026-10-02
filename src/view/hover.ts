import { hoverMarkup, type HoverSample } from "./profile";

export interface HoverOptions {
  /** Låt markeringen stå kvar när fingret lyfts (telefon). */
  sticky?: boolean;
  /** Anropas vid ett horisontellt svep: +1 åt höger, -1 åt vänster. */
  onSwipe?: (direction: 1 | -1) => void;
}

/**
 * Avläsning på en profilbild: dra med mus eller finger längs hålet så visas måttet vid
 * närmaste täta provpunkt. Med onSwipe skiljs horisontella svep från avläsning: den första
 * tydliga rörelsen avgör vilket det är.
 */
export function attachHover(svg: SVGSVGElement, samples: HoverSample[], options: HoverOptions = {}): void {
  const layer = svg.querySelector("g.hover-layer");
  if (!layer) return;
  let mode: "idle" | "undecided" | "read" | "swipe" = "idle";
  let start: { x: number; y: number } | null = null;
  let last: { x: number; y: number } | null = null;

  const toSvg = (e: PointerEvent): DOMPoint | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  };
  const show = (e: PointerEvent, maxDist: number) => {
    const p = toSvg(e);
    if (!p || samples.length === 0) return;
    let best: HoverSample | null = null;
    let bd = Infinity;
    for (const s of samples) {
      const d = Math.hypot(s.hx - p.x, s.hy - p.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    layer.innerHTML = best && bd <= maxDist ? hoverMarkup(best) : "";
  };

  svg.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY };
    last = start;
    mode = options.onSwipe ? "undecided" : "read";
    svg.setPointerCapture(e.pointerId);
    if (mode === "read") show(e, Infinity);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (mode === "idle") {
      if (e.pointerType === "mouse") show(e, 90);
      return;
    }
    last = { x: e.clientX, y: e.clientY };
    if (mode === "undecided" && start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) >= 12) mode = Math.abs(dx) > Math.abs(dy) * 1.2 ? "swipe" : "read";
    }
    if (mode === "read") show(e, Infinity);
  });
  const end = (e: PointerEvent) => {
    if (mode === "swipe" && start && last && options.onSwipe) {
      const dx = last.x - start.x;
      if (Math.abs(dx) >= 60) options.onSwipe(dx > 0 ? 1 : -1);
    } else if (mode === "undecided") {
      // Ett tryck utan rörelse: läs av där fingret satt
      show(e, Infinity);
    }
    mode = "idle";
    start = null;
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => {
    if (mode === "idle" && !options.sticky) layer.innerHTML = "";
  });
}
