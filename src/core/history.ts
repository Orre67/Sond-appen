/**
 * Ångra-motor, oberoende av gränssnittet.
 *
 * Allt användaren bestämmer i appen (numrering, borttagna hål, skjutriktning, inställningar,
 * visningsval) samlas i ett enda serialiserbart beslutsobjekt S som appen lämnar via getState
 * och tar emot via setState. Varje ändring görs inom apply(): motorn tar en kopia före och efter
 * och sparar paret. Ångra återställer "före", gör om återställer "efter". En ny funktion behöver
 * bara lägga sina beslut i S och göra sina ändringar inom apply() för att bli ångringsbar.
 *
 * Ändringar som inte ändrar något (före == efter) sparas inte. Små snabba ändringar i samma
 * fält kan slås ihop till ett steg med en coalesce-nyckel.
 */
export interface HistoryEntry<S> {
  label: string;
  before: S;
  after: S;
  coalesce: string | null;
  at: number;
}

export interface HistoryOptions {
  /** Högsta antal steg som sparas. */
  limit?: number;
  /** Ändringar med samma coalesce-nyckel inom så här många millisekunder slås ihop till ett steg. */
  coalesceWithin?: number;
  /** Klocka, för tester. */
  now?: () => number;
}

export class History<S> {
  private undoStack: HistoryEntry<S>[] = [];
  private redoStack: HistoryEntry<S>[] = [];
  private readonly limit: number;
  private readonly coalesceWithin: number;
  private readonly now: () => number;
  /** Anropas när stackarna ändrats, så att knappar kan uppdateras. */
  onChange: (() => void) | null = null;

  constructor(
    private readonly getState: () => S,
    private readonly setState: (s: S) => void,
    options: HistoryOptions = {},
  ) {
    this.limit = options.limit ?? 200;
    this.coalesceWithin = options.coalesceWithin ?? 1500;
    this.now = options.now ?? (() => Date.now());
  }

  private snapshot(): S {
    return structuredClone(this.getState());
  }

  /**
   * Gör en ändring ångringsbar: tar en kopia av beslutet, kör ändringen, tar en kopia igen.
   * Returnerar falskt när ändringen inte ändrade något.
   */
  apply(label: string, mutate: () => void, coalesce: string | null = null): boolean {
    const before = this.snapshot();
    mutate();
    const after = this.snapshot();
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const at = this.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (coalesce !== null && last && last.coalesce === coalesce && at - last.at <= this.coalesceWithin) {
      last.after = after;
      last.label = label;
      last.at = at;
    } else {
      this.undoStack.push({ label, before, after, coalesce, at });
      if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
    this.redoStack = [];
    this.onChange?.();
    return true;
  }

  /** Ångrar senaste steget och returnerar dess etikett, eller null om inget finns att ångra. */
  undo(): string | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    this.setState(structuredClone(e.before));
    this.onChange?.();
    return e.label;
  }

  /** Gör om senast ångrade steget och returnerar dess etikett, eller null. */
  redo(): string | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(e);
    this.setState(structuredClone(e.after));
    this.onChange?.();
    return e.label;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  get length(): number {
    return this.undoStack.length;
  }

  /** Tömmer historiken, till exempel när nya filer läses in och gamla beslut inte längre gäller. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange?.();
  }
}
