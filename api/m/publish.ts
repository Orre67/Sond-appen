import { removeEntry, upsertEntry, type CatalogEntry } from "../../src/core/catalog";
import { deleteBundle, readRegister, writeRegister } from "../../src/server/blob";

interface PublishBody {
  key?: string;
  entry?: Partial<CatalogEntry>;
  remove?: string;
}

/**
 * Skrivbordets publicering, skyddad av delningsnyckeln. { entry } lägger in eller ersätter en
 * inmätning i registret, { remove: id } tar bort den och dess paket.
 */
export async function POST(request: Request): Promise<Response> {
  let body: PublishBody;
  try {
    body = (await request.json()) as PublishBody;
  } catch {
    return Response.json({ error: "Ogiltig förfrågan." }, { status: 400 });
  }
  const expected = process.env.SHARE_KEY;
  if (!expected || body.key !== expected) return Response.json({ error: "Fel delningsnyckel." }, { status: 401 });

  const catalog = await readRegister();
  if (body.remove) {
    const { entries, removed } = removeEntry(catalog.entries, String(body.remove));
    if (removed) {
      await writeRegister({ version: 1, entries });
      try {
        await deleteBundle(removed.id);
      } catch {
        // Paketet kan redan vara rensat
      }
    }
    return Response.json({ ok: true, removed: removed?.id ?? null, entries });
  }

  const e = body.entry;
  if (
    !e ||
    typeof e.id !== "string" ||
    !/^[a-z0-9]{8,24}$/i.test(e.id) ||
    typeof e.site !== "string" ||
    e.site.trim().length === 0 ||
    typeof e.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(e.date)
  ) {
    return Response.json({ error: "Ofullständig publicering: id, plats och datum krävs." }, { status: 400 });
  }
  const entry: CatalogEntry = {
    id: e.id.toLowerCase(),
    site: e.site.trim().slice(0, 80),
    date: e.date,
    note: String(e.note ?? "").trim().slice(0, 200),
    holes: Number(e.holes) || 0,
    published: new Date().toISOString(),
  };
  const { entries, replaced } = upsertEntry(catalog.entries, entry);
  await writeRegister({ version: 1, entries });
  // Ersatta publiceringars paket tas bort så att lagringen inte växer
  for (const r of replaced) {
    if (r.id === entry.id) continue;
    try {
      await deleteBundle(r.id);
    } catch {
      // Paketet kan redan vara borta
    }
  }
  return Response.json({ ok: true, entry, replaced: replaced.map((r) => r.id), entries });
}
