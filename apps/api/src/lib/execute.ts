// Runs commands authoritatively: idempotency, core.execute, versioned writes, the command log and month seals.
import {
  applyMutations,
  buildSnapshot,
  type CommandOutcome,
  type Dataset,
  execute,
  karachiNow,
  type Mutation,
} from "@marqum/core";
import type { Command } from "@marqum/schema";
import { ulid } from "ulidx";
import type { Env } from "../env.ts";
import { isoNow } from "./http.ts";
import { writeMutations } from "./store.ts";

export interface CommandResult {
  id: string;
  ok: boolean;
  error?: string;
  message?: string;
  result?: Record<string, unknown>;
}

interface LoggedCommand {
  ok: number;
  error: string | null;
  result: string | null;
}

/** Stored outcome of an already-applied command (successes only — failures may be retried). */
export async function loggedResult(db: D1Database, id: string): Promise<CommandResult | null> {
  const row = await db
    .prepare("SELECT ok, error, result FROM commands WHERE id = ? AND ok = 1")
    .bind(id)
    .first<LoggedCommand>();
  if (!row) return null;
  const stored = row.result ? (JSON.parse(row.result) as Omit<CommandResult, "id" | "ok">) : {};
  return { id, ok: true, ...stored };
}

const toResult = (id: string, o: CommandOutcome): CommandResult => ({
  id,
  ok: o.ok,
  ...(o.error ? { error: o.error } : {}),
  ...(o.message ? { message: o.message } : {}),
  ...(o.result ? { result: o.result } : {}),
});

function logStatement(
  db: D1Database,
  cmd: Command,
  deviceId: string | null,
  r: CommandResult,
): D1PreparedStatement {
  const { id: _id, ok: _ok, ...rest } = r;
  return db
    .prepare(
      `INSERT INTO commands (id, name, device_id, at, received_at, ok, error, result, args)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET device_id = excluded.device_id, received_at = excluded.received_at,
         ok = excluded.ok, error = excluded.error, result = excluded.result, args = excluded.args
       WHERE commands.ok = 0`,
    )
    .bind(
      cmd.id,
      cmd.name,
      deviceId,
      cmd.at,
      isoNow(),
      r.ok ? 1 : 0,
      r.error ?? null,
      JSON.stringify(rest),
      JSON.stringify(cmd.args),
    );
}

export interface RunOptions {
  deviceId: string | null;
  steppedUp: boolean;
  /** adjust mutations before they are written (e.g. mark a transaction as notification-sourced) */
  transform?: (mutations: Mutation[]) => Mutation[];
  now?: string;
}

/**
 * Execute one command against `ds` and persist it. Returns the result and the updated dataset.
 * Already-applied command ids return their stored result without re-running (idempotent push).
 */
export async function runCommand(
  env: Env,
  ds: Dataset,
  cmd: Command,
  opts: RunOptions,
): Promise<{ result: CommandResult; ds: Dataset; version: number | null }> {
  const prior = await loggedResult(env.DB, cmd.id);
  if (prior) return { result: prior, ds, version: null };

  let outcome: CommandOutcome;
  try {
    outcome = execute(ds, cmd, {
      now: opts.now ?? karachiNow(),
      steppedUp: opts.steppedUp,
      newId: () => ulid(),
    });
  } catch (e) {
    outcome = { ok: false, mutations: [], error: "invalid", message: (e as Error).message };
  }
  if (!outcome.ok) {
    const result = toResult(cmd.id, outcome);
    await logStatement(env.DB, cmd, opts.deviceId, result).run();
    return { result, ds, version: null };
  }

  let mutations = opts.transform ? opts.transform(outcome.mutations) : outcome.mutations;
  if (cmd.name === "closeMonth") {
    try {
      mutations = await sealMonth(env, applyMutations(ds, mutations), cmd.args.month, mutations);
    } catch (e) {
      const result = toResult(cmd.id, {
        ok: false,
        mutations: [],
        error: "conflict",
        message: `Couldn't write the month snapshot: ${(e as Error).message}`,
      });
      await logStatement(env.DB, cmd, opts.deviceId, result).run();
      return { result, ds, version: null };
    }
  }
  const result = toResult(cmd.id, outcome);
  const { version, written } = await writeMutations(env.DB, mutations, [
    logStatement(env.DB, cmd, opts.deviceId, result),
  ]);
  return { result, ds: applyMutations(ds, written), version };
}

/** Write the immutable snapshot to R2 (`sealed/` is bucket-locked) and record its key + hash on the month row. */
async function sealMonth(
  env: Env,
  after: Dataset,
  month: string,
  mutations: Mutation[],
): Promise<Mutation[]> {
  const snap = await buildSnapshot(after, month);
  const key = `sealed/${month}/${snap.sha256}.json`;
  await env.BACKUPS.put(key, snap.json, {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { sha256: snap.sha256, month },
  });
  const current = after.months.find((m) => m.id === month);
  if (!current) throw new Error(`month ${month} missing after close`);
  const sealed: Mutation = {
    table: "months",
    row: { ...current, snapshot_key: key, snapshot_sha256: snap.sha256 },
  };
  return [...mutations.filter((m) => !(m.table === "months" && m.row.id === month)), sealed];
}
