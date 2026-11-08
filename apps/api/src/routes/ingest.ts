import { karachiNow, type Mutation } from "@marqum/core";
import { parseNotification } from "@marqum/parsers";
import { type Command, NotificationIngest } from "@marqum/schema";
import { Hono } from "hono";
import { ulid } from "ulidx";
import type { AppEnv } from "../env.ts";
import { sha256Hex } from "../lib/crypto.ts";
import { runCommand } from "../lib/execute.ts";
import { body } from "../lib/http.ts";
import { ensureSeeded, loadDataset, writeMutations } from "../lib/store.ts";

type Status = "parsed" | "ignored" | "unparsed";

/** Payment-ish words: a notification with these that we couldn't parse is "unparsed" (worth a look), else "ignored". */
const LOOKS_FINANCIAL = /\b(rs\.?|pkr|₨|received|sent|paid|credited|debited|transfer|payment|purchase)\b/i;

export const ingest = new Hono<AppEnv>();

ingest.post("/notification", async (c) => {
  const n = await body(c, NotificationIngest);
  const existing = await c.env.DB.prepare("SELECT data FROM rows WHERE tbl = 'notifications' AND id = ?")
    .bind(n.id)
    .first<{ data: string }>();
  if (existing) {
    const row = JSON.parse(existing.data) as { status: Status; transaction_id: string | null };
    return c.json({ id: n.id, status: row.status, transaction_id: row.transaction_id, duplicate: true });
  }

  await ensureSeeded(c.env.DB, karachiNow());
  const parsed = parseNotification(n.package, n.title, n.text, n.posted_at);
  const record = (status: Status, transaction_id: string | null): Mutation => ({
    table: "notifications",
    row: { ...n, status, transaction_id },
  });

  if (!parsed) {
    const status: Status = LOOKS_FINANCIAL.test(`${n.title} ${n.text}`) ? "unparsed" : "ignored";
    await writeMutations(c.env.DB, [record(status, null)]);
    return c.json({ id: n.id, status, transaction_id: null });
  }

  const txnId = ulid();
  const cmd: Command = {
    // system command id, deterministic per notification (Id max length is 64)
    id: `notif:${(await sha256Hex(n.id)).slice(0, 40)}`,
    name: "addProvisional",
    at: karachiNow(),
    args: {
      txn_id: txnId,
      account_id: parsed.account_id,
      occurred_at: parsed.occurred_at,
      amount: parsed.amount,
      reason: parsed.reason,
      category_id: null,
      flow: null,
      counterparty_name: parsed.counterparty_name,
    },
  };
  const ds = await loadDataset(c.env.DB);
  const run = await runCommand(c.env, ds, cmd, {
    deviceId: c.get("device").id,
    steppedUp: false,
    transform: (ms) => [
      ...ms.map((m) =>
        m.table === "transactions" && m.row.id === txnId
          ? {
              ...m,
              row: {
                ...m.row,
                source: "notification",
                notification_id: n.id,
                description: (m.row.description as string | undefined) || parsed.description,
              },
            }
          : m,
      ),
      record("parsed", txnId),
    ],
  });
  if (!run.result.ok) {
    await writeMutations(c.env.DB, [record("unparsed", null)]);
    return c.json({
      id: n.id,
      status: "unparsed",
      transaction_id: null,
      error: run.result.error ?? null,
      message: run.result.message ?? null,
    });
  }
  return c.json({ id: n.id, status: "parsed", transaction_id: txnId });
});
