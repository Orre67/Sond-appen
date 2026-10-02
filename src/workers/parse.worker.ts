import { parseLandXml } from "../io/landxml";
import type { MeshData } from "../io/mesh";
import { parseObj } from "../io/obj";

export interface ParseRequest {
  id: number;
  file: File;
  kind: "obj" | "landxml";
}

export type ParseResponse =
  | { id: number; ok: true; mesh: MeshData }
  | { id: number; ok: false; error: string };

addEventListener("message", async (ev: MessageEvent<ParseRequest>) => {
  const { id, file, kind } = ev.data;
  try {
    const text = await file.text();
    const mesh = kind === "obj" ? parseObj(text) : parseLandXml(text);
    const transfer: Transferable[] = [mesh.positions.buffer, mesh.indices.buffer];
    if (mesh.uvs) transfer.push(mesh.uvs.buffer);
    if (mesh.uvIndices) transfer.push(mesh.uvIndices.buffer);
    const msg: ParseResponse = { id, ok: true, mesh };
    postMessage(msg, { transfer });
  } catch (err) {
    const msg: ParseResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    postMessage(msg);
  }
});
