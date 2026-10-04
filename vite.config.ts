import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";
import { emptyCatalog, removeEntry, upsertEntry, type Catalog, type CatalogEntry } from "./src/core/catalog";

/**
 * Dev-serverns motsvarighet till Vercel-funktionerna, så att hela flödet går att köra lokalt:
 *   POST /api/share           tar emot ett paket (JSON) och sparar det i out/share/<id>.json
 *   GET  /api/share/<id>      lämnar ut paketet
 *   GET/POST /api/m/login     inloggning: alla koder godtas lokalt, kakan heter som i produktion
 *   GET  /api/m/catalog       registret ur out/share/register.json
 *   POST /api/m/publish       lägger in eller tar bort en inmätning i registret
 *   /m och /m/<id>            serverar mobil.html som omskrivningen på Vercel
 */
function sharePlugin(): Plugin {
  const dir = path.resolve("out/share");
  const registerFile = path.join(dir, "register.json");
  const bundleFile = (id: string) => path.join(dir, `${id}.json`);
  const ensureDir = () => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };
  const readBody = (req: Connect.IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer | string) => chunks.push(Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  const readRegister = (): Catalog => (existsSync(registerFile) ? (JSON.parse(readFileSync(registerFile, "utf8")) as Catalog) : emptyCatalog());
  const writeRegister = (c: Catalog) => {
    ensureDir();
    writeFileSync(registerFile, JSON.stringify(c, null, 1), "utf8");
  };
  const removeBundle = (id: string) => {
    if (existsSync(bundleFile(id))) unlinkSync(bundleFile(id));
  };
  const loggedIn = (req: Connect.IncomingMessage) => /(?:^|;\s*)sond_access=/.test(req.headers.cookie ?? "");

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (/^\/m(\/[A-Za-z0-9_-]+)?(\?.*)?$/.test(url)) {
      req.url = "/mobil.html";
      return next();
    }
    const route = url.startsWith("/api/share")
      ? "share"
      : url.startsWith("/api/m/login")
        ? "login"
        : url.startsWith("/api/m/catalog")
          ? "catalog"
          : url.startsWith("/api/m/publish")
            ? "publish"
            : null;
    if (!route) return next();
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.end(JSON.stringify(body));
    };
    void (async () => {
      try {
        if (route === "share") {
          if (req.method === "POST") {
            const text = await readBody(req);
            JSON.parse(text);
            ensureDir();
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            writeFileSync(bundleFile(id), text, "utf8");
            const host = req.headers.host ?? "localhost:5173";
            const port = host.includes(":") ? host.split(":").pop() : "80";
            const urls = [`http://localhost:${port}/m/${id}`];
            for (const list of Object.values(networkInterfaces())) {
              for (const a of list ?? []) {
                if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}/m/${id}`);
              }
            }
            return send(200, { id, urls });
          }
          const m = /^\/api\/share\/([A-Za-z0-9_-]+)/.exec(url);
          if (!m) {
            const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "register.json").map((f) => f.slice(0, -5)) : [];
            return send(200, { ids });
          }
          if (!existsSync(bundleFile(m[1]))) return send(404, { error: "Paketet finns inte." });
          res.statusCode = 200;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          res.end(readFileSync(bundleFile(m[1])));
          return;
        }
        if (route === "login") {
          if (req.method === "POST") {
            const { code } = JSON.parse((await readBody(req)) || "{}") as { code?: string };
            if (!code) return send(401, { error: "Fel kod." });
            return send(200, { ok: true }, { "set-cookie": "sond_access=dev; Path=/; Max-Age=2592000; SameSite=Lax" });
          }
          return send(200, { loggedIn: loggedIn(req) });
        }
        if (route === "catalog") {
          if (!loggedIn(req)) return send(401, { error: "Inte inloggad." });
          return send(200, readRegister());
        }
        if (req.method !== "POST") return send(405, { error: "Bara POST." });
        const body = JSON.parse((await readBody(req)) || "{}") as { entry?: Partial<CatalogEntry>; remove?: string };
        const catalog = readRegister();
        if (body.remove) {
          const { entries, removed } = removeEntry(catalog.entries, body.remove);
          writeRegister({ version: 1, entries });
          if (removed) removeBundle(removed.id);
          return send(200, { ok: true, removed: removed?.id ?? null, entries });
        }
        const e = body.entry;
        if (!e?.id || !e.site || !e.date) return send(400, { error: "Ofullständig publicering: id, plats och datum krävs." });
        const entry: CatalogEntry = { id: e.id, site: e.site, date: e.date, note: e.note ?? "", holes: Number(e.holes) || 0, published: new Date().toISOString() };
        const { entries, replaced } = upsertEntry(catalog.entries, entry);
        writeRegister({ version: 1, entries });
        for (const r of replaced) if (r.id !== entry.id) removeBundle(r.id);
        return send(200, { ok: true, entry, replaced: replaced.map((r) => r.id), entries });
      } catch (err) {
        send(400, { error: err instanceof Error ? err.message : String(err) });
      }
    })();
  };
  return {
    name: "sond-share",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [sharePlugin()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      input: {
        main: path.resolve("index.html"),
        mobil: path.resolve("mobil.html"),
      },
    },
  },
  server: {
    // Lyssna på alla nätverkskort så att telefoner på samma Wi-Fi når sidan.
    host: true,
    fs: {
      // Tillåter demoläget (?demo=/@fs/...) att hämta exempelfiler utanför projektet under utveckling.
      allow: [".", "C:/Users/oscar/Desktop/filer till claude/sond appen"],
    },
  },
});
