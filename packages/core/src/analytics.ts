import type { AccountId, Category, Transaction } from "@marqum/schema";
import { counterpartyKey, normalizeKey } from "./classify.ts";
import {
  categoryAverage,
  categoryMonthlySpend,
  firstDataMonth,
  liveTxns,
  loanStatuses,
  median,
  walletPositions,
} from "./ledger.ts";
import { daysBetween, daysInMonth, monthOf, monthsBetween, weekdayIndex } from "./time.ts";
import type {
  CategoryCard,
  CounterpartyStats,
  Dataset,
  NetPosition,
  RecurringCandidate,
  SeriesPoint,
  UnverifiedSummary,
} from "./types.ts";

export { spendOf } from "./ledger.ts";

/** Consistency constants: MAD and mean absolute deviation → σ for normal data. */
const MAD_SCALE = 1.4826;
const MEAN_AD_SCALE = 1.2533;
export const OUTLIER_Z = 3;

/** Robust z of `x` against `baseline`; null when the baseline has fewer than 3 values or no spread to measure against. */
export function zAgainst(baseline: number[], x: number): number | null {
  if (baseline.length < 3) return null;
  const m = median(baseline);
  const devs = baseline.map((v) => Math.abs(v - m));
  const mad = median(devs);
  if (mad > 0) return Math.abs(x - m) / (MAD_SCALE * mad);
  const meanAd = devs.reduce((s, d) => s + d, 0) / devs.length;
  if (meanAd > 0) return Math.abs(x - m) / (MEAN_AD_SCALE * meanAd);
  return x === m ? 0 : null;
}

/**
 * Robust z-scores: |x − median| / (1.4826·MAD). When MAD = 0, falls back to |x − median| / (1.2533·meanAD);
 * when every value is identical, z = 0. Fewer than 3 values → all null.
 */
export function robustZ(values: number[]): (number | null)[] {
  return values.map((v) => zAgainst(values, v));
}

export const isOutlier = (z: number | null): boolean => z !== null && z > OUTLIER_Z;

export function netPosition(ds: Dataset, now: string): NetPosition {
  const wallets = walletPositions(ds);
  const loans = loanStatuses(ds, now);
  const wallet_total = wallets.reduce((s, w) => s + w.balance, 0);
  const open = loans.filter((l) => l.outstanding > 0);
  const debt = open.reduce((s, l) => s + l.outstanding, 0);
  let debt_free_month: string | null = null;
  if (open.length > 0) {
    if (open.every((l) => l.payoff_month !== null))
      debt_free_month =
        open
          .map((l) => l.payoff_month as string)
          .sort()
          .at(-1) ?? null;
  }
  return { wallets, wallet_total, debt, net: wallet_total - debt, in_debt: debt > 0, loans, debt_free_month };
}

const isVisible = (c: Category, spent: number, average: number | null) =>
  !c.hidden || spent > 0 || (average !== null && average > 0);

export function categoryCards(ds: Dataset, month: string, now: string): CategoryCard[] {
  const current = monthOf(now);
  const dayFrac = month === current ? Number(now.slice(8, 10)) / daysInMonth(month) : month < current ? 1 : 0;
  const cats = ds.categories.filter((c) => !c.deleted);
  const cards: CategoryCard[] = [];
  for (const cat of cats.filter((c) => c.parent_id === null)) {
    const monthly = categoryMonthlySpend(ds, cat.id);
    const spent = monthly.get(month) ?? 0;
    const { average, months_in_average } = categoryAverage(ds, cat.id, month, monthly);
    if (!isVisible(cat, spent, average)) continue;
    const children = cats
      .filter((c) => c.parent_id === cat.id)
      .sort((a, b) => a.sort - b.sort)
      .map((child) => {
        const cm = categoryMonthlySpend(ds, child.id);
        const cs = cm.get(month) ?? 0;
        return { category: child, spent: cs, average: categoryAverage(ds, child.id, month, cm).average };
      })
      .filter((c) => isVisible(c.category, c.spent, c.average));
    cards.push({
      category: cat,
      spent,
      average,
      months_in_average,
      over_average: average !== null && spent > average,
      pace: average === null ? null : Math.round(average * dayFrac),
      children,
    });
  }
  return cards.sort((a, b) => b.spent - a.spent || a.category.sort - b.category.sort);
}

/**
 * Monthly spend for the last `months` months ending with the current month (never before the first data month).
 * z-scores are computed against the complete months of the series (the current month is scored, not used).
 */
export function categorySeries(ds: Dataset, categoryId: string, months: number, now: string): SeriesPoint[] {
  const current = monthOf(now);
  const first = firstDataMonth(ds);
  if (first === null) return [];
  let start = monthsBetween(first, current).slice(-Math.max(1, months))[0] ?? current;
  if (start < first) start = first;
  const list = monthsBetween(start, current);
  const monthly = categoryMonthlySpend(ds, categoryId);
  const values = list.map((m) => monthly.get(m) ?? 0);
  const baseline = values.filter((_, i) => list[i] !== current);
  return list.map((month, i) => {
    const value = values[i] ?? 0;
    const z = zAgainst(baseline, value);
    return { month, value, z, outlier: isOutlier(z) };
  });
}

export function counterpartyStats(ds: Dataset, counterpartyId: string, now: string): CounterpartyStats {
  const counterparty = ds.counterparties.find((c) => c.id === counterpartyId);
  if (!counterparty) throw new Error(`counterparty not found: ${counterpartyId}`);
  const txns = liveTxns(ds)
    .filter((t) => t.counterparty_id === counterpartyId)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const current = monthOf(now);
  const first = txns[0] ? monthOf(txns[0].occurred_at) : current;
  const months = monthsBetween(first, current);
  const series = months.map((month) => ({ month, sent: 0, received: 0 }));
  const idx = new Map(months.map((m, i) => [m, i]));
  const weekday = Array<number>(7).fill(0);
  const hour = Array<number>(24).fill(0);
  const cats = new Map<string | null, number>();
  let total_sent = 0;
  let total_received = 0;
  const outflows: number[] = [];
  for (const t of txns) {
    const p = series[idx.get(monthOf(t.occurred_at)) ?? -1];
    if (t.amount < 0) {
      total_sent += -t.amount;
      outflows.push(-t.amount);
      if (p) p.sent += -t.amount;
    } else {
      total_received += t.amount;
      if (p) p.received += t.amount;
    }
    weekday[weekdayIndex(t.occurred_at)] = (weekday[weekdayIndex(t.occurred_at)] ?? 0) + 1;
    const h = Number(t.occurred_at.slice(11, 13));
    hour[h] = (hour[h] ?? 0) + 1;
    cats.set(t.category_id, (cats.get(t.category_id) ?? 0) + Math.abs(t.amount));
  }
  let avg_interval_days: number | null = null;
  if (txns.length >= 2) {
    const firstT = txns[0] as Transaction;
    const lastT = txns.at(-1) as Transaction;
    avg_interval_days =
      Math.round((daysBetween(firstT.occurred_at, lastT.occurred_at) / (txns.length - 1)) * 10) / 10;
  }
  const sentValues = series.map((s) => s.sent);
  const outliers = series
    .map((s, i) => {
      const z = zAgainst(sentValues, sentValues[i] ?? 0);
      return { month: s.month, value: s.sent, z, outlier: isOutlier(z) };
    })
    .filter((p) => p.outlier);
  return {
    counterparty,
    series,
    total_sent,
    total_received,
    count: txns.length,
    typical_amount: Math.round(median(outflows)),
    avg_interval_days,
    weekday,
    hour,
    categories: [...cats.entries()]
      .map(([category_id, total]) => ({ category_id, total }))
      .sort((a, b) => b.total - a.total || String(a.category_id).localeCompare(String(b.category_id))),
    outliers,
  };
}

/**
 * Recurring payments not yet tracked: outflows (spend/fee) grouped by counterparty (or description key) and
 * wallet; amounts within ±10% of the group median; the most recent run of ≥3 payments whose consecutive gaps
 * are all 25–35 days. Groups already covered by a Recurring row (same wallet and counterparty/name) are excluded.
 */
export function detectRecurring(ds: Dataset): RecurringCandidate[] {
  const groups = new Map<
    string,
    { account: AccountId; cpId: string | null; key: string; txns: Transaction[] }
  >();
  for (const t of liveTxns(ds)) {
    if (t.amount >= 0 || (t.flow !== "spend" && t.flow !== "fee")) continue;
    const key = t.counterparty_id
      ? normalizeKey(ds.counterparties.find((c) => c.id === t.counterparty_id)?.name ?? t.counterparty_id)
      : counterpartyKey(t.description);
    if (!key && !t.counterparty_id) continue;
    const gk = `${t.account_id}|${t.counterparty_id ?? `k:${key}`}`;
    let g = groups.get(gk);
    if (!g) {
      g = { account: t.account_id, cpId: t.counterparty_id, key: key ?? "", txns: [] };
      groups.set(gk, g);
    }
    g.txns.push(t);
  }
  const out: RecurringCandidate[] = [];
  for (const g of groups.values()) {
    const med = median(g.txns.map((t) => -t.amount));
    const members = g.txns
      .filter((t) => Math.abs(-t.amount - med) <= med * 0.1)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    if (members.length < 3) continue;
    const run: Transaction[] = [members.at(-1) as Transaction];
    for (let i = members.length - 2; i >= 0; i--) {
      const gap = daysBetween((members[i] as Transaction).occurred_at, (run[0] as Transaction).occurred_at);
      if (gap < 25 || gap > 35) break;
      run.unshift(members[i] as Transaction);
    }
    if (run.length < 3) continue;
    const cp = g.cpId ? ds.counterparties.find((c) => c.id === g.cpId) : undefined;
    const name = cp?.name ?? g.key;
    const covered = ds.recurring.some(
      (r) =>
        !r.deleted &&
        r.account_id === g.account &&
        ((g.cpId !== null && r.counterparty_id === g.cpId) || normalizeKey(r.name) === normalizeKey(name)),
    );
    if (covered) continue;
    const catCount = new Map<string | null, number>();
    for (const t of run) catCount.set(t.category_id, (catCount.get(t.category_id) ?? 0) + 1);
    const category_id =
      [...catCount.entries()].sort(
        (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
      )[0]?.[0] ?? null;
    out.push({
      counterparty_id: g.cpId,
      key: g.key,
      name: cp?.name ?? g.key.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
      account_id: g.account,
      amount: Math.round(median(run.map((t) => -t.amount))),
      day_of_month: Math.round(median(run.map((t) => Number(t.occurred_at.slice(8, 10))))),
      occurrences: run.length,
      last_seen: (run.at(-1) as Transaction).occurred_at,
      category_id,
    });
  }
  return out.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

export function unverifiedSummary(ds: Dataset): UnverifiedSummary {
  const rows = liveTxns(ds).filter((t) => t.status !== "verified");
  const by_account: UnverifiedSummary["by_account"] = {
    sadapay: { count: 0, since: null },
    nayapay: { count: 0, since: null },
  };
  let since: string | null = null;
  let total = 0;
  let disputed = 0;
  for (const t of rows) {
    total += t.amount;
    if (t.status === "disputed") disputed++;
    if (since === null || t.occurred_at < since) since = t.occurred_at;
    const b = by_account[t.account_id];
    b.count++;
    if (b.since === null || t.occurred_at < b.since) b.since = t.occurred_at;
  }
  return { count: rows.length, total, since, disputed, by_account };
}
