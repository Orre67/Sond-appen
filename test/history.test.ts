import { describe, expect, it } from "vitest";
import { History } from "../src/core/history";

interface S {
  renames: [string, string | null][];
  removed: string[];
  bearing: number | null;
}

function setup(opts: { now?: () => number; limit?: number } = {}) {
  let state: S = { renames: [], removed: [], bearing: null };
  const applied: S[] = [];
  const h = new History<S>(
    () => state,
    (s) => {
      state = s;
      applied.push(s);
    },
    { coalesceWithin: 1000, ...opts },
  );
  return { h, get state() { return state; }, set: (s: S) => (state = s), applied };
}

describe("ångra-motorn", () => {
  it("ångrar och gör om i rätt ordning med etiketter", () => {
    const t = setup();
    t.h.apply("ta bort hål 240", () => t.set({ ...t.state, removed: ["240"] }));
    t.h.apply("skjutriktning 45°", () => t.set({ ...t.state, bearing: 45 }));
    expect(t.h.length).toBe(2);
    expect(t.h.undoLabel).toBe("skjutriktning 45°");
    expect(t.h.undo()).toBe("skjutriktning 45°");
    expect(t.state).toEqual({ renames: [], removed: ["240"], bearing: null });
    expect(t.h.redoLabel).toBe("skjutriktning 45°");
    expect(t.h.undo()).toBe("ta bort hål 240");
    expect(t.state).toEqual({ renames: [], removed: [], bearing: null });
    expect(t.h.undo()).toBeNull();
    expect(t.h.redo()).toBe("ta bort hål 240");
    expect(t.state.removed).toEqual(["240"]);
    expect(t.h.redo()).toBe("skjutriktning 45°");
    expect(t.state.bearing).toBe(45);
    expect(t.h.redo()).toBeNull();
  });

  it("sparar inte ändringar som inte ändrar något, och ny ändring tömmer gör om", () => {
    const t = setup();
    expect(t.h.apply("ingenting", () => undefined)).toBe(false);
    expect(t.h.canUndo).toBe(false);
    t.h.apply("a", () => t.set({ ...t.state, bearing: 10 }));
    t.h.apply("b", () => t.set({ ...t.state, bearing: 20 }));
    t.h.undo();
    expect(t.h.canRedo).toBe(true);
    t.h.apply("c", () => t.set({ ...t.state, bearing: 30 }));
    expect(t.h.canRedo).toBe(false);
    expect(t.h.undoLabel).toBe("c");
  });

  it("kopiorna är fristående: senare ändringar i objektet påverkar inte historiken", () => {
    const t = setup();
    const live: S = { renames: [], removed: [], bearing: null };
    t.set(live);
    t.h.apply("ta bort", () => live.removed.push("5"));
    live.removed.push("6");
    t.h.undo();
    expect(t.state.removed).toEqual([]);
    t.h.redo();
    expect(t.state.removed).toEqual(["5"]);
  });

  it("slår ihop snabba ändringar i samma fält till ett steg", () => {
    let clock = 0;
    const t = setup({ now: () => clock });
    t.h.apply("skjutriktning 4°", () => t.set({ ...t.state, bearing: 4 }), "blast");
    clock = 500;
    t.h.apply("skjutriktning 45°", () => t.set({ ...t.state, bearing: 45 }), "blast");
    expect(t.h.length).toBe(1);
    expect(t.h.undoLabel).toBe("skjutriktning 45°");
    clock = 5000;
    t.h.apply("skjutriktning 90°", () => t.set({ ...t.state, bearing: 90 }), "blast");
    expect(t.h.length).toBe(2);
    t.h.undo();
    expect(t.state.bearing).toBe(45);
    t.h.undo();
    expect(t.state.bearing).toBeNull();
  });

  it("håller högst limit steg och kan tömmas", () => {
    const t = setup({ limit: 3 });
    for (let i = 1; i <= 5; i++) t.h.apply(`steg ${i}`, () => t.set({ ...t.state, bearing: i }));
    expect(t.h.length).toBe(3);
    expect(t.h.undo()).toBe("steg 5");
    expect(t.h.undo()).toBe("steg 4");
    expect(t.h.undo()).toBe("steg 3");
    expect(t.h.undo()).toBeNull();
    t.h.redo();
    t.h.clear();
    expect(t.h.canUndo).toBe(false);
    expect(t.h.canRedo).toBe(false);
  });
});
