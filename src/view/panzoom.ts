/**
 * Dra och zooma en SVG genom att flytta dess viewBox: hjul och dubbelklick med mus, ett finger
 * drar och två fingrar nyper på pekskärm. Ett tryck utan rörelse rapporteras som onTap.
 */
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanZoomLimits {
  /** Minsta viewBox-bredd som andel av hela ytan (zoom in). */
  minScale: number;
  /** Största viewBox-bredd som andel av hela ytan (zoom ut). */
  maxScale: number;
}

export const DEFAULT_LIMITS: PanZoomLimits = { minScale: 1 / 60, maxScale: 2 };

/** Ny viewBox som är `factor` gånger så bred, med punkten (px, py) i viewBox-koordinater stilla. */
export function zoomAround(v: ViewBox, px: number, py: number, factor: number, fit: ViewBox, limits = DEFAULT_LIMITS): ViewBox {
  const w = Math.min(fit.w * limits.maxScale, Math.max(fit.w * limits.minScale, v.w * factor));
  const s = w / v.w;
  return { x: px - (px - v.x) * s, y: py - (py - v.y) * s, w, h: v.h * s };
}

export function pan(v: ViewBox, dx: number, dy: number): ViewBox {
  return { x: v.x + dx, y: v.y + dy, w: v.w, h: v.h };
}

export interface PanZoomOptions {
  fit: ViewBox;
  initial?: ViewBox | null;
  limits?: PanZoomLimits;
  /** Tryck utan rörelse: läget i viewBox-koordinater och på skärmen. */
  onTap?: (view: [number, number], client: [number, number]) => void;
  /** Efter en avslutad gest, hjulzoom eller återställning. */
  onChange?: (v: ViewBox) => void;
}

export interface PanZoomHandle {
  view(): ViewBox;
  set(v: ViewBox | null): void;
}

export function attachPanZoom(svg: SVGSVGElement, o: PanZoomOptions): PanZoomHandle {
  const limits = o.limits ?? DEFAULT_LIMITS;
  let view: ViewBox = o.initial ?? o.fit;
  const apply = (v: ViewBox) => {
    view = v;
    svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  };
  apply(view);
  const toView = (clientX: number, clientY: number): [number, number] | null => {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  /** Meter (viewBox-enheter) per skärmpixel för den viewBox som är satt just nu. */
  const unitsPerPixel = () => {
    const m = svg.getScreenCTM();
    return m && m.a !== 0 ? 1 / m.a : 0;
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    start: { x: number; y: number };
    last: { x: number; y: number };
    t: number;
    moved: boolean;
    prevDist?: number;
    prevMid?: { x: number; y: number };
  } | null = null;
  let changeTimer = 0;
  const changed = () => o.onChange?.(view);

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { start: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY }, t: Date.now(), moved: false };
    } else if (gesture) {
      gesture.moved = true;
      gesture.prevDist = undefined;
      gesture.prevMid = undefined;
    }
    e.preventDefault();
  });

  svg.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (gesture.prevDist && gesture.prevMid) {
        const m = toView(mid.x, mid.y);
        if (m) apply(zoomAround(view, m[0], m[1], gesture.prevDist / dist, o.fit, limits));
        const upp = unitsPerPixel();
        apply(pan(view, -(mid.x - gesture.prevMid.x) * upp, -(mid.y - gesture.prevMid.y) * upp));
      }
      gesture.prevDist = dist;
      gesture.prevMid = mid;
      return;
    }
    const dx = e.clientX - gesture.last.x;
    const dy = e.clientY - gesture.last.y;
    gesture.last = { x: e.clientX, y: e.clientY };
    if (!gesture.moved && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) < 6) return;
    gesture.moved = true;
    const upp = unitsPerPixel();
    apply(pan(view, -dx * upp, -dy * upp));
  });

  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (pointers.size === 1) {
      // Ett finger kvar efter en nypning: fortsätt som drag därifrån
      const rest = [...pointers.values()][0];
      gesture.last = { x: rest.x, y: rest.y };
      gesture.prevDist = undefined;
      gesture.prevMid = undefined;
      return;
    }
    if (pointers.size === 0) {
      if (!gesture.moved && Date.now() - gesture.t < 500 && o.onTap) {
        const v = toView(e.clientX, e.clientY);
        if (v) o.onTap(v, [e.clientX, e.clientY]);
      } else {
        changed();
      }
      gesture = null;
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = toView(e.clientX, e.clientY);
      if (!p) return;
      apply(zoomAround(view, p[0], p[1], e.deltaY > 0 ? 1.2 : 1 / 1.2, o.fit, limits));
      window.clearTimeout(changeTimer);
      changeTimer = window.setTimeout(changed, 150);
    },
    { passive: false },
  );
  svg.addEventListener("dblclick", () => {
    apply(o.fit);
    changed();
  });

  return {
    view: () => view,
    set: (v) => apply(v ?? o.fit),
  };
}
