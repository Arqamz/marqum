import { karachiNow } from "@marqum/core";
import type { Env } from "../env.ts";
import { currentVersion, type RowRecord, recordToRow } from "./store.ts";

/** Full dump: every row (incl. tombstones) per table, plus the command log. */
export async function exportAll(db: D1Database): Promise<{
  exported_at: string;
  version: number;
  tables: Record<string, Record<string, unknown>[]>;
  commands: Record<string, unknown>[];
}> {
  const [version, rows, commands] = await Promise.all([
    currentVersion(db),
    db.prepare("SELECT tbl, id, version, deleted, data FROM rows ORDER BY tbl, version").all<RowRecord>(),
    db.prepare("SELECT * FROM commands ORDER BY received_at").all<Record<string, unknown>>(),
  ]);
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const r of rows.results) {
    tables[r.tbl] ??= [];
    tables[r.tbl]?.push(recordToRow(r));
  }
  return { exported_at: karachiNow(), version, tables, commands: commands.results };
}

/** Cron: `nightly/YYYY-MM-DD.json` (Karachi date). The bucket's lock rule keeps these 90 days. */
export async function nightlyBackup(env: Env): Promise<string> {
  const dump = await exportAll(env.DB);
  const key = `nightly/${dump.exported_at.slice(0, 10)}.json`;
  await env.BACKUPS.put(key, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
  return key;
}
