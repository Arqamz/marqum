// Generic versioned row store over D1: every synced table lives in `rows(tbl, id, version, deleted, data)`.
import { type Dataset, emptyDataset, type Mutation, seedMutations } from "@marqum/core";
import { TABLE_NAMES, type TableName } from "@marqum/schema";

export interface RowRecord {
  tbl: string;
  id: string;
  version: number;
  deleted: number;
  data: string;
}

/** Max statements per D1 batch (keeps each transaction small). */
export const CHUNK = 400;
export const PULL_LIMIT = 2000;

const isTable = (t: string): t is TableName => (TABLE_NAMES as string[]).includes(t);

/** Mutation → what goes into `rows` (version/deleted are columns, not part of `data`). */
export function mutationToRecord(m: Mutation): Omit<RowRecord, "version"> {
  const { version: _v, deleted, ...data } = m.row as Record<string, unknown> & { id: string };
  return { tbl: m.table, id: m.row.id, deleted: deleted === true ? 1 : 0, data: JSON.stringify(data) };
}

/** `rows` record → the synced row shape (data + version + deleted). */
export function recordToRow(r: RowRecord): Record<string, unknown> {
  return { ...(JSON.parse(r.data) as Record<string, unknown>), version: r.version, deleted: r.deleted === 1 };
}

/** Build a Dataset from live (non-deleted) records. Unknown tables are ignored. */
export function datasetFromRecords(records: RowRecord[]): Dataset {
  const ds = emptyDataset() as unknown as Record<TableName, unknown[]>;
  for (const r of records) if (r.deleted !== 1 && isTable(r.tbl)) ds[r.tbl].push(recordToRow(r));
  return ds as unknown as Dataset;
}

export interface PullPage {
  version: number;
  changes: Record<string, Record<string, unknown>[]>;
  more: boolean;
}

/** Shape a pull page from up to `limit + 1` records ordered by version. */
export function pullPage(records: RowRecord[], since: number, limit = PULL_LIMIT): PullPage {
  const more = records.length > limit;
  const page = more ? records.slice(0, limit) : records;
  const changes: Record<string, Record<string, unknown>[]> = {};
  for (const r of page) {
    changes[r.tbl] ??= [];
    changes[r.tbl]?.push(recordToRow(r));
  }
  return { version: page.at(-1)?.version ?? since, changes, more };
}

export async function currentVersion(db: D1Database): Promise<number> {
  const v = await db.prepare("SELECT value FROM meta WHERE key = 'version'").first<{ value: string }>();
  return Number(v?.value ?? 0);
}

export async function loadDataset(db: D1Database): Promise<Dataset> {
  const { results } = await db
    .prepare("SELECT tbl, id, version, deleted, data FROM rows WHERE deleted = 0")
    .all<RowRecord>();
  return datasetFromRecords(results);
}

export async function pull(db: D1Database, since: number): Promise<PullPage> {
  const global = await currentVersion(db);
  const from = since > global ? 0 : since; // server was reset/restored → resend everything
  const { results } = await db
    .prepare("SELECT tbl, id, version, deleted, data FROM rows WHERE version > ? ORDER BY version LIMIT ?")
    .bind(from, PULL_LIMIT + 1)
    .all<RowRecord>();
  return pullPage(results, from);
}

const UPSERT = `INSERT INTO rows (tbl, id, version, deleted, data)
  VALUES (?, ?, (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'version') + ?, ?, ?)
  ON CONFLICT (tbl, id) DO UPDATE SET version = excluded.version, deleted = excluded.deleted, data = excluded.data`;

/**
 * Write mutations with fresh global versions. Each chunk is one D1 batch (a transaction) that reads the
 * counter, writes rows at counter+1…counter+n, then bumps the counter — so concurrent writers never interleave.
 * `extra` statements (e.g. the command log row) run in the last batch. Returns the mutations with their
 * assigned versions and the new global version.
 */
export async function writeMutations(
  db: D1Database,
  mutations: Mutation[],
  extra: D1PreparedStatement[] = [],
): Promise<{ version: number; written: Mutation[] }> {
  const written: Mutation[] = [];
  let version = 0;
  const chunks: Mutation[][] = [];
  for (let i = 0; i < mutations.length; i += CHUNK) chunks.push(mutations.slice(i, i + CHUNK));
  if (chunks.length === 0) chunks.push([]);
  for (const [ci, chunk] of chunks.entries()) {
    const stmts = chunk.map((m, i) => {
      const r = mutationToRecord(m);
      return db.prepare(UPSERT).bind(r.tbl, r.id, i + 1, r.deleted, r.data);
    });
    stmts.push(
      db
        .prepare("UPDATE meta SET value = CAST(value AS INTEGER) + ? WHERE key = 'version'")
        .bind(chunk.length),
    );
    if (ci === chunks.length - 1) stmts.push(...extra);
    stmts.push(db.prepare("SELECT value FROM meta WHERE key = 'version'"));
    const res = await db.batch<{ value: string }>(stmts);
    version = Number(res.at(-1)?.results[0]?.value ?? 0);
    const base = version - chunk.length;
    chunk.forEach((m, i) => {
      written.push({
        table: m.table,
        row: { ...m.row, version: base + i + 1, deleted: m.row.deleted === true },
      });
    });
  }
  return { version, written };
}

let seeded = false;

/** On a fresh database, write the seed data (accounts, categories, rules, settings) once. */
export async function ensureSeeded(db: D1Database, now: string): Promise<void> {
  if (seeded) return;
  const marker = await db.prepare("SELECT value FROM meta WHERE key = 'seeded'").first();
  if (!marker) {
    const any = await db.prepare("SELECT 1 FROM rows LIMIT 1").first();
    const mark = db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', ?)").bind(now);
    if (any) await mark.run();
    else await writeMutations(db, seedMutations(now), [mark]);
  }
  seeded = true;
}
