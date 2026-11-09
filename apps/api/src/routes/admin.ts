import { karachiNow } from "@marqum/core";
import { LocalDate } from "@marqum/schema";
import { Hono } from "hono";
import { ulid } from "ulidx";
import { z } from "zod";
import type { AppEnv } from "../env.ts";
import { runCommand } from "../lib/execute.ts";
import { body, fail } from "../lib/http.ts";
import { ensureSeeded, getEpoch, loadDataset } from "../lib/store.ts";

export const admin = new Hono<AppEnv>();

/** POST /api/admin/reset { tracking_start, confirm: "RESET" } + X-Step-Up → runs resetLedger. */
admin.post("/reset", async (c) => {
  const req = await body(c, z.object({ tracking_start: LocalDate, confirm: z.literal("RESET") }));
  if (!c.get("steppedUp")) fail(403, "step_up_required", "Confirm it's you first.");
  await ensureSeeded(c.env.DB, karachiNow());
  const run = await runCommand(
    c.env,
    await loadDataset(c.env.DB),
    { id: ulid(), name: "resetLedger", at: karachiNow(), args: req },
    { deviceId: c.get("device").id, steppedUp: true },
  );
  if (!run.result.ok)
    return c.json({ error: run.result.error ?? "invalid", message: run.result.message ?? "" }, 400);
  return c.json({ ...run.result, epoch: await getEpoch(c.env.DB) });
});
