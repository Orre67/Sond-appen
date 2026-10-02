import type { MeshData } from "../io/mesh";
import type { ParseResponse } from "../workers/parse.worker";

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (m: MeshData) => void; reject: (e: Error) => void }>();

/** Läser och tolkar en ytmodell i en Web Worker så att sidan inte fryser. */
export function parseMeshInWorker(file: File, kind: "obj" | "landxml"): Promise<MeshData> {
  if (!worker) {
    worker = new Worker(new URL("../workers/parse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.mesh);
      else p.reject(new Error(ev.data.error));
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.reject(new Error(ev.message || "Fel i inläsningen"));
      pending.clear();
    };
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, file, kind });
  });
}

export type FileKind = "obj" | "landxml" | "mtl" | "image" | "dm4" | "points" | "unknown";

export function classifyFile(name: string): FileKind {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "obj":
      return "obj";
    case "xml":
    case "landxml":
      return "landxml";
    case "mtl":
      return "mtl";
    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      return "image";
    case "dm4":
      return "dm4";
    case "txt":
    case "csv":
    case "pts":
    case "koo":
      return "points";
    default:
      return "unknown";
  }
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
