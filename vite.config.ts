import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { defineConfig, type Connect, type Plugin } from "vite";

/**
 * Delnings-API för mobilsidan under utveckling och förhandsvisning.
 *   POST /api/share        tar emot ett paket (JSON) och sparar det i out/share/<id>.json
 *   GET  /api/share/<id>   lämnar ut paketet
 *   GET  /api/share        listar id:n
 * På Vercel ersätts detta av en serverless-funktion med samma gränssnitt.
 */
function sharePlugin(): Plugin {
  const dir = path.resolve("out/share");
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/share")) return next();
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(body));
    };
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer | string) => chunks.push(Buffer.from(c)));
      req.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          JSON.parse(text);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          writeFileSync(path.join(dir, `${id}.json`), text, "utf8");
          const host = req.headers.host ?? "localhost:5173";
          const port = host.includes(":") ? host.split(":").pop() : "80";
          const urls = [`http://localhost:${port}/mobil.html?s=${id}`];
          for (const list of Object.values(networkInterfaces())) {
            for (const a of list ?? []) {
              if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}/mobil.html?s=${id}`);
            }
          }
          send(200, { id, urls });
        } catch (err) {
          send(400, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }
    if (req.method === "GET") {
      const m = /^\/api\/share\/([A-Za-z0-9_-]+)/.exec(url);
      if (!m) {
        const ids = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
        return send(200, { ids });
      }
      const file = path.join(dir, `${m[1]}.json`);
      if (!existsSync(file)) return send(404, { error: "Paketet finns inte." });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.end(readFileSync(file));
      return;
    }
    next();
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
