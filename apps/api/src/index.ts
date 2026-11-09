/**
 * Marqūm API — Cloudflare Worker (Hono). Serves /api/*; everything else falls through to the web app assets.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv, Env } from "./env.ts";
import { requireDevice } from "./lib/auth.ts";
import { exportAll, nightlyBackup } from "./lib/backup.ts";
import { ApiError } from "./lib/http.ts";
import { currentVersion } from "./lib/store.ts";
import { admin } from "./routes/admin.ts";
import { auth, login } from "./routes/auth.ts";
import { ingest } from "./routes/ingest.ts";
import { months } from "./routes/months.ts";
import { sync } from "./routes/sync.ts";

/** Capacitor's Android WebView origins, plus local dev. Same-origin requests carry no CORS. */
export const ALLOWED_ORIGINS = new Set(["https://localhost", "capacitor://localhost", "http://localhost"]);

export const app = new Hono<AppEnv>().basePath("/api");

app.use(
  "*",
  cors({
    origin: (origin, c) =>
      ALLOWED_ORIGINS.has(origin) ||
      origin === new URL(c.req.url).origin ||
      /^http:\/\/localhost:\d+$/.test(origin)
        ? origin
        : null,
    allowHeaders: ["Authorization", "X-Step-Up", "Content-Type"],
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Snapshot-Key", "X-Snapshot-Sha256"],
    maxAge: 86400,
  }),
);

app.get("/health", async (c) => c.json({ ok: true, version: await currentVersion(c.env.DB) }));
app.route("/auth/login", login);
app.route("/auth", auth);

for (const path of ["/sync/*", "/ingest/*", "/months/*", "/export", "/admin/*"]) app.use(path, requireDevice);
app.route("/sync", sync);
app.route("/ingest", ingest);
app.route("/months", months);
app.route("/admin", admin);
app.get("/export", async (c) => {
  c.header("Content-Disposition", `attachment; filename="marqum-export.json"`);
  return c.json(await exportAll(c.env.DB));
});

app.notFound((c) =>
  c.json({ error: "not_found", message: `No route for ${c.req.method} ${c.req.path}` }, 404),
);
app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status);
  console.error(err);
  return c.json({ error: "internal", message: "Something went wrong on the server." }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(nightlyBackup(env));
  },
} satisfies ExportedHandler<Env>;
