import { closeChecklist, karachiNow } from "@marqum/core";
import { Month } from "@marqum/schema";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { fail } from "../lib/http.ts";
import { ensureSeeded, loadDataset } from "../lib/store.ts";

export const months = new Hono<AppEnv>();

const monthParam = (raw: string | undefined): string => {
  const p = Month.safeParse(raw);
  return p.success ? p.data : fail(400, "invalid", "Month must be YYYY-MM.");
};

months.get("/:month/check", async (c) => {
  const month = monthParam(c.req.param("month"));
  await ensureSeeded(c.env.DB, karachiNow());
  return c.json(closeChecklist(await loadDataset(c.env.DB), month, karachiNow()));
});

months.get("/:month/snapshot", async (c) => {
  const month = monthParam(c.req.param("month"));
  const ds = await loadDataset(c.env.DB);
  const rec = ds.months.find((m) => m.id === month);
  if (!rec?.snapshot_key) return fail(404, "not_found", `${month} has no sealed snapshot.`);
  const obj = await c.env.BACKUPS.get(rec.snapshot_key);
  if (!obj) return fail(404, "not_found", "Snapshot object is missing from storage.");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      "X-Snapshot-Key": rec.snapshot_key,
      "X-Snapshot-Sha256": rec.snapshot_sha256 ?? "",
    },
  });
});
