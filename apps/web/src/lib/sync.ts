import type { Command } from "@marqum/schema";
import { API, TABLE_NAMES, type TableName } from "@marqum/schema";
import { api, OfflineError } from "./api.ts";
import { auth } from "./auth.ts";
import { db, getMeta, type OutboxEntry, setMeta } from "./db.ts";
import { describeCommand } from "./describe.ts";
import { stepUp, validStepUp } from "./stepup.ts";
import { createStore } from "./store.ts";
import { toast } from "./toast.ts";
import type {
  CommandResultT as CommandResult,
  PullResponseT as PullResponse,
  PushResponseT as PushResponse,
} from "./wire.ts";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";
export const syncState = createStore<{
  status: SyncStatus;
  lastSyncedAt: number | null;
  message: string | null;
}>({
  status: "idle",
  lastSyncedAt: null,
  message: null,
});

const BATCH = 200;
const syncedListeners = new Set<() => void>();
/** Called after every successful sync (reminders reschedule here). */
export function onSynced(l: () => void): () => void {
  syncedListeners.add(l);
  return () => syncedListeners.delete(l);
}

let running: Promise<void> | null = null;
let again = false;

/** Push the outbox, then pull until up to date. Concurrent calls coalesce into one extra run. */
export function syncNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce();
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

let debounce: ReturnType<typeof setTimeout> | null = null;
/** Debounced sync after enqueuing a command. */
export function scheduleSync(ms = 300): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, ms);
}

async function runOnce(): Promise<void> {
  if (!auth.token()) return;
  syncState.set((s) => ({ ...s, status: "syncing", message: null }));
  try {
    await push();
    await pull();
    syncState.set({ status: "synced", lastSyncedAt: Date.now(), message: null });
    for (const l of syncedListeners) l();
  } catch (e) {
    if (e instanceof OfflineError) {
      syncState.set((s) => ({
        ...s,
        status: "offline",
        message: "Offline — changes are saved on this device",
      }));
    } else {
      const message = e instanceof Error ? e.message : String(e);
      syncState.set((s) => ({ ...s, status: "error", message }));
    }
  }
}

async function pending(): Promise<OutboxEntry[]> {
  return (await db.outbox.orderBy("seq").toArray()).filter((e) => !e.acked);
}

async function push(): Promise<void> {
  // Each pass acks, drops or steps up every command it sends; a command is stepped up at most once.
  const steppedUp = new Set<string>();
  for (let pass = 0; pass < 50; pass++) {
    const entries = (await pending()).slice(0, BATCH);
    if (entries.length === 0) return;
    const token = validStepUp();
    const res = await api<PushResponse>(API.push, {
      body: { commands: entries.map((e) => e.command) },
      ...(token ? { headers: { "x-step-up": token } } : {}),
    });
    const byId = new Map<string, CommandResult>(res.results.map((r) => [r.id, r]));
    const needStepUp: OutboxEntry[] = [];
    await db.transaction("rw", db.outbox, async () => {
      for (const e of entries) {
        const r = byId.get(e.id);
        if (!r || r.ok) {
          if (e.seq !== undefined) await db.outbox.update(e.seq, { acked: true });
          if (r?.result) reportResult(e.command, r.result);
        } else if (r.error === "step_up_required") {
          needStepUp.push(e);
        } else if (e.seq !== undefined) {
          await db.outbox.delete(e.seq);
          failed(e.command, r.message ?? r.error ?? "rejected");
        }
      }
    });
    if (needStepUp.length > 0) {
      const again = needStepUp.filter((e) => steppedUp.has(e.id));
      for (const e of needStepUp) steppedUp.add(e.id);
      const ok =
        again.length > 0
          ? null
          : await stepUp(`${describeCommand(needStepUp[0]?.command)} is in a closed month`).catch(() => null);
      if (!ok) {
        await db.outbox.bulkDelete(needStepUp.map((e) => e.seq).filter((s): s is number => s !== undefined));
        toast({
          tone: "error",
          title: "Not saved — that month is closed",
          detail: "Confirm with your fingerprint or passcode to edit a closed month.",
        });
      }
    }
  }
}

function failed(command: Command, message: string): void {
  toast({ tone: "error", title: `${describeCommand(command)} didn't save`, detail: message });
}

const resultListeners = new Set<(c: Command, r: Record<string, unknown>) => void>();
export function onCommandResult(l: (c: Command, r: Record<string, unknown>) => void): () => void {
  resultListeners.add(l);
  return () => resultListeners.delete(l);
}
function reportResult(c: Command, r: Record<string, unknown>): void {
  for (const l of resultListeners) l(c, r);
}

async function pull(): Promise<void> {
  for (let page = 0; page < 1000; page++) {
    const since = await getMeta<number>("version", 0);
    const res = await api<PullResponse>(`${API.pull}?since=${since}`);
    const tables = TABLE_NAMES.filter((t) => (res.changes[t]?.length ?? 0) > 0);
    await db.transaction("rw", [db.meta, db.outbox, ...tables.map((t) => db.table(t))], async () => {
      for (const t of tables) {
        const rows = (res.changes[t] ?? []) as { id: string }[];
        await db.table(t as TableName).bulkPut(rows);
      }
      await setMeta("version", res.version);
      // Server state now includes the acknowledged commands, so their optimistic preview can go.
      if (!res.more) await db.outbox.filter((e) => e.acked === true).delete();
    });
    if (!res.more) return;
  }
}

/** For tests and logout. */
export async function resetLocalData(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
