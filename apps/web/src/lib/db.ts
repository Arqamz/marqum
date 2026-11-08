import type { Command, ParsedStatement, Row, StatementCheck, TableName } from "@marqum/schema";
import { TABLE_NAMES } from "@marqum/schema";
import Dexie, { type Table } from "dexie";

export interface OutboxEntry {
  seq?: number;
  id: string; // = command.id
  command: Command;
  queued_at: number;
  /** set once the server has acknowledged it; removed after the next pull lands */
  acked?: boolean;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

/** A statement file seen by intake (scan, share or upload), keyed by content hash. */
export interface IntakeEntry {
  sha256: string;
  name: string;
  status: "imported" | "needs_look" | "discarded" | "needs_password" | "unreadable";
  statement: ParsedStatement | null;
  failed: { label: string }[];
  error: string | null;
  seen_at: number;
  /** kept only while a password is needed or the file is waiting for a look */
  base64: string | null;
}

export class MarqumDb extends Dexie {
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;
  intake!: Table<IntakeEntry, string>;

  constructor(name = "marqum") {
    super(name);
    const stores: Record<string, string> = {};
    for (const t of TABLE_NAMES) stores[t] = "id, version";
    stores.outbox = "++seq, &id";
    stores.meta = "key";
    stores.intake = "sha256, status";
    this.version(1).stores(stores);
  }
}

export function tbl<T extends TableName>(name: T): Table<Row<T>, string> {
  return db.table(name) as Table<Row<T>, string>;
}

export let db = new MarqumDb();

/** Tests swap in a fresh database. */
export function setDatabase(next: MarqumDb): void {
  db = next;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export type { StatementCheck };
