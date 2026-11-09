import { SEED_ACCOUNTS, SEED_CATEGORIES, SEED_RULES, SETTINGS, type TableName } from "@marqum/schema";
import { carryRow } from "./carry.ts";
import type { Dataset, Mutation } from "./types.ts";

const TABLE_KEYS: TableName[] = [
  "accounts",
  "transactions",
  "statements",
  "balances",
  "categories",
  "counterparties",
  "rules",
  "recurring",
  "loans",
  "goals",
  "goal_moves",
  "months",
  "notifications",
  "settings",
];

export function emptyDataset(): Dataset {
  return {
    accounts: [],
    transactions: [],
    statements: [],
    balances: [],
    categories: [],
    counterparties: [],
    rules: [],
    recurring: [],
    loans: [],
    goals: [],
    goal_moves: [],
    months: [],
    notifications: [],
    settings: [],
  };
}

/**
 * Apply row writes immutably. A row with `deleted: true` removes the row (tombstone); otherwise the row
 * replaces the existing one with the same id, or is appended. Untouched tables keep their array identity.
 */
export function applyMutations(ds: Dataset, mutations: Mutation[]): Dataset {
  if (mutations.length === 0) return ds;
  const next: Dataset = { ...ds };
  const touched = new Map<TableName, Map<string, Record<string, unknown> | null>>();
  for (const m of mutations) {
    if (!TABLE_KEYS.includes(m.table)) continue;
    let t = touched.get(m.table);
    if (!t) {
      t = new Map();
      touched.set(m.table, t);
    }
    t.set(m.row.id, m.row.deleted === true ? null : m.row);
  }
  for (const [table, writes] of touched) {
    const rows = ds[table] as unknown as { id: string }[];
    const out: unknown[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (writes.has(row.id)) {
        seen.add(row.id);
        const w = writes.get(row.id);
        if (w) out.push(w);
      } else out.push(row);
    }
    for (const [id, w] of writes) if (!seen.has(id) && w) out.push(w);
    (next as unknown as Record<string, unknown[]>)[table] = out;
  }
  return next;
}

export function isClosed(ds: Dataset, month: string): boolean {
  return ds.months.some((m) => m.id === month && m.status === "closed");
}

/** Setting value, falling back to SETTINGS defaults ("" for unknown keys). */
export function setting(ds: Dataset, key: string): string {
  const row = ds.settings.find((s) => s.id === key);
  if (row) return row.value;
  return (SETTINGS as Record<string, string>)[key] ?? "";
}

/** Numeric setting with a fallback when the stored value is not a finite number. */
export function numericSetting(ds: Dataset, key: string): number {
  const v = Number(setting(ds, key));
  if (Number.isFinite(v)) return v;
  return Number((SETTINGS as Record<string, string>)[key] ?? 0);
}

const DATE = /^\d{4}-\d{2}-01$/;

/** First tracked day (`YYYY-MM-01`). Nothing before it exists for analytics, balances or closing. */
export function trackingStart(ds: Dataset): string {
  const v = setting(ds, "tracking_start");
  return DATE.test(v) ? v : ((SETTINGS as Record<string, string>).tracking_start ?? "2026-11-01");
}

/** First tracked month, `YYYY-MM`. */
export const trackingStartMonth = (ds: Dataset): string => trackingStart(ds).slice(0, 7);

/** true for datetimes/dates on or after tracking start */
export const isTracked = (ds: Dataset, dt: string): boolean => dt.slice(0, 10) >= trackingStart(ds);

/** Priority of the lowest seed rule is 1, highest is SEED_RULES.length; user rules start at USER_RULE_PRIORITY. */
export const USER_RULE_PRIORITY = 1000;

/** Rows for a fresh database. Ids are deterministic so two devices seeding offline converge. */
export function seedMutations(now: string): Mutation[] {
  const base = { version: 0, deleted: false };
  const out: Mutation[] = [];
  for (const a of SEED_ACCOUNTS) out.push({ table: "accounts", row: { ...a, ...base } });
  SEED_CATEGORIES.forEach((c, i) => {
    out.push({
      table: "categories",
      row: {
        id: c.id,
        parent_id: c.parent_id,
        name: c.name,
        icon: c.icon,
        wallet_hint: c.wallet_hint,
        nature: c.nature,
        sort: i,
        hidden: c.hidden ?? false,
        budget: null,
        ...base,
      },
    });
  });
  SEED_RULES.forEach((r, i) => {
    out.push({
      table: "rules",
      row: {
        id: `seed-rule-${String(i + 1).padStart(2, "0")}`,
        pattern: r.pattern,
        category_id: r.category_id,
        flow: r.flow,
        counterparty_id: null,
        priority: SEED_RULES.length - i,
        ...base,
      },
    });
  });
  for (const [id, value] of Object.entries(SETTINGS))
    out.push({ table: "settings", row: { id, value, ...base } });
  // opening balance (b/f) of the first tracked month: 0 until a statement or setOpeningBalance says otherwise
  const start = (SETTINGS as Record<string, string>).tracking_start ?? "2026-11-01";
  for (const a of SEED_ACCOUNTS)
    out.push({ table: "transactions", row: { ...carryRow("bf", a.id, start.slice(0, 7), 0, now) } });
  return out;
}
