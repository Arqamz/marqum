// Notification → provisional transaction (+ stated balance), shared by /api/ingest and /api/admin/reingest.
import { type Dataset, karachiNow, type Mutation, trackingStart } from "@marqum/core";
import { isNonTransaction, type ParsedNotification, parseNotification } from "@marqum/parsers";
import type { Command, NotificationIngest } from "@marqum/schema";
import { ulid } from "ulidx";
import type { Env } from "../env.ts";
import { sha256Hex } from "./crypto.ts";
import { runCommand } from "./execute.ts";
import { ensureSeeded, getEpoch, loadDataset, writeMutations } from "./store.ts";

export type IngestStatus = "parsed" | "ignored" | "unparsed";
export interface IngestResult {
  id: string;
  status: IngestStatus;
  transaction_id: string | null;
  duplicate?: boolean;
  duplicate_of?: string;
  reason?: string;
  error?: string | null;
  message?: string | null;
}

/** Payment-ish words: a notification with these that we couldn't parse is "unparsed" (worth a look), else "ignored". */
const LOOKS_FINANCIAL = /\b(rs\.?|pkr|₨|received|sent|paid|credited|debited|transfer|payment|purchase)\b/i;
/** Banks sometimes post the same spend twice (e.g. two apps / retries) — treat as one within this window. */
export const DUPLICATE_WINDOW_MIN = 2;

const minutes = (dt: string) => Date.parse(`${dt}:00Z`) / 60_000;
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** An already-parsed notification for the same account, amount and merchant within ±2 minutes. */
export function findDuplicate(ds: Dataset, n: NotificationIngest, p: ParsedNotification): string | null {
  for (const other of ds.notifications) {
    if (other.deleted || other.status !== "parsed" || other.id === n.id) continue;
    if (Math.abs(minutes(other.posted_at) - minutes(n.posted_at)) > DUPLICATE_WINDOW_MIN) continue;
    const q = parseNotification(other.package, other.title, other.text, other.posted_at);
    if (
      q &&
      q.account_id === p.account_id &&
      q.amount === p.amount &&
      norm(q.counterparty_name) === norm(p.counterparty_name)
    )
      return other.id;
  }
  return null;
}

export const notificationCommandId = async (epoch: string, notificationId: string): Promise<string> =>
  `notif:${(await sha256Hex(`${epoch}|${notificationId}`)).slice(0, 40)}`;

export async function ingestNotification(
  env: Env,
  deviceId: string | null,
  n: NotificationIngest,
): Promise<IngestResult> {
  const existing = await env.DB.prepare(
    "SELECT data FROM rows WHERE tbl = 'notifications' AND id = ? AND deleted = 0",
  )
    .bind(n.id)
    .first<{ data: string }>();
  if (existing) {
    const row = JSON.parse(existing.data) as { status: IngestStatus; transaction_id: string | null };
    return { id: n.id, status: row.status, transaction_id: row.transaction_id, duplicate: true };
  }

  await ensureSeeded(env.DB, karachiNow());
  const record = (status: IngestStatus, transaction_id: string | null): Mutation => ({
    table: "notifications",
    row: { ...n, status, transaction_id },
  });
  const ignore = async (status: IngestStatus, extra: Partial<IngestResult> = {}): Promise<IngestResult> => {
    await writeMutations(env.DB, [record(status, null)]);
    return { id: n.id, status, transaction_id: null, ...extra };
  };

  const parsed = parseNotification(n.package, n.title, n.text, n.posted_at);
  if (!parsed)
    return ignore(
      !isNonTransaction(n.title, n.text) && LOOKS_FINANCIAL.test(`${n.title} ${n.text}`)
        ? "unparsed"
        : "ignored",
    );

  const ds = await loadDataset(env.DB);
  if (n.posted_at < `${trackingStart(ds)}T00:00`)
    return ignore("ignored", { reason: "before_tracking_start" });
  const dup = findDuplicate(ds, n, parsed);
  if (dup) return ignore("ignored", { reason: "duplicate", duplicate_of: dup });

  const txnId = ulid();
  const cmd: Command = {
    // System command id: deterministic per notification *and ledger epoch*. The command log survives
    // resetLedger, so without the epoch a notification re-ingested after a reset would hit the logged
    // command and be "replayed" without writing anything. (Id max length is 64.)
    id: await notificationCommandId(await getEpoch(env.DB), n.id),
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
  const balance: Mutation[] =
    parsed.balance_after === null
      ? []
      : [
          {
            table: "balances",
            row: {
              id: ulid(),
              account_id: parsed.account_id,
              as_of: n.posted_at,
              balance: parsed.balance_after,
              source: "notification",
              statement_id: null,
              version: 0,
              deleted: false,
            },
          },
        ];
  const run = await runCommand(env, ds, cmd, {
    deviceId,
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
      ...balance,
      record("parsed", txnId),
    ],
  });
  if (!run.result.ok)
    return ignore("unparsed", { error: run.result.error ?? null, message: run.result.message ?? null });
  if (run.version === null) {
    // the command was already in the log (replayed, nothing written): never report a transaction we didn't write
    const prior = ds.transactions.find((t) => !t.deleted && t.notification_id === n.id);
    if (prior) {
      await writeMutations(env.DB, [record("parsed", prior.id)]);
      return { id: n.id, status: "parsed", transaction_id: prior.id };
    }
    return ignore("unparsed", { error: "conflict", message: "notification command already applied" });
  }
  return { id: n.id, status: "parsed", transaction_id: txnId };
}
