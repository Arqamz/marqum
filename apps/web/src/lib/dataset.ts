import { applyMutations, type Dataset, emptyDataset, execute, karachiNow, seedMutations } from "@marqum/core";
import { TABLE_NAMES } from "@marqum/schema";
import { db, type OutboxEntry } from "./db.ts";

/** Reads the replica (minus tombstones). A never-synced device shows the seed so the UI isn't empty. */
export async function loadBase(now: string): Promise<Dataset> {
  let ds = emptyDataset();
  const tables = await Promise.all(TABLE_NAMES.map((t) => db.table(t).toArray()));
  const record = ds as unknown as Record<string, unknown[]>;
  TABLE_NAMES.forEach((t, i) => {
    record[t] = (tables[i] as { deleted?: boolean }[]).filter((r) => r.deleted !== true);
  });
  if (ds.accounts.length === 0) ds = applyMutations(ds, seedMutations(now));
  return ds;
}

/**
 * Optimistic view: replay queued commands on top of the replica with the same handlers the server runs.
 * Ids for rows a command creates are derived from the command id, so they stay stable across re-renders.
 */
export function preview(base: Dataset, outbox: OutboxEntry[]): Dataset {
  let ds = base;
  for (const entry of outbox) {
    let n = 0;
    try {
      const outcome = execute(ds, entry.command, {
        now: entry.command.at,
        steppedUp: true,
        newId: () => `${entry.id}-${(n++).toString(36)}`,
      });
      if (outcome.ok) ds = applyMutations(ds, outcome.mutations);
    } catch (e) {
      console.warn("preview failed for", entry.command.name, e);
    }
  }
  return ds;
}

export async function loadDataset(): Promise<{ dataset: Dataset; outbox: OutboxEntry[] }> {
  const now = karachiNow();
  const [base, outbox] = await Promise.all([loadBase(now), db.outbox.orderBy("seq").toArray()]);
  return { dataset: preview(base, outbox), outbox };
}
