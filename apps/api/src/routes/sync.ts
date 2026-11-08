import { karachiNow } from "@marqum/core";
import { PushRequest } from "@marqum/schema";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { type CommandResult, runCommand } from "../lib/execute.ts";
import { body, fail } from "../lib/http.ts";
import { currentVersion, ensureSeeded, loadDataset, pull } from "../lib/store.ts";

export const sync = new Hono<AppEnv>();

sync.post("/push", async (c) => {
  const req = await body(c, PushRequest);
  await ensureSeeded(c.env.DB, karachiNow());
  let ds = await loadDataset(c.env.DB);
  const results: CommandResult[] = [];
  let version: number | null = null;
  for (const cmd of req.commands) {
    const r = await runCommand(c.env, ds, cmd, {
      deviceId: c.get("device").id,
      steppedUp: c.get("steppedUp"),
    });
    results.push(r.result);
    ds = r.ds;
    if (r.version !== null) version = r.version;
  }
  return c.json({ results, version: version ?? (await currentVersion(c.env.DB)) });
});

sync.get("/pull", async (c) => {
  const raw = c.req.query("since") ?? "0";
  if (!/^\d+$/.test(raw)) fail(400, "invalid", "since must be a non-negative integer.");
  await ensureSeeded(c.env.DB, karachiNow());
  return c.json(await pull(c.env.DB, Number(raw)));
});
