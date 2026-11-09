import {
  addMonths,
  availableMonths,
  categoryMonthDetail,
  categorySeries,
  type Dataset,
  daysInMonth,
  formatRs,
  isClosed,
  monthLabel,
  monthOf,
} from "@marqum/core";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AddToCategorySheet } from "../components/add-to-category.tsx";
import { DailyBars, MonthlyBars } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { ExpectedRows } from "../components/expected-list.tsx";
import { Money } from "../components/money.tsx";
import { MonthPager } from "../components/month-pager.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { cn } from "../lib/cn.ts";
import { monthName } from "../lib/months.ts";
import { lookup } from "../lib/view.ts";

export function CategoryScreen({ id, month }: { id: string; month?: string | undefined }) {
  const ds = useDataset();
  const now = useNow();
  const name = ds?.categories.find((c) => c.id === id)?.name;
  const [adding, setAdding] = useState(false);
  const category = ds?.categories.find((c) => c.id === id);
  return (
    <Screen
      back
      {...(name ? { title: name } : {})}
      actions={
        category ? (
          <Button variant="primary" size="sm" onClick={() => setAdding(true)} data-testid="category-add">
            <Plus aria-hidden />
            Add
          </Button>
        ) : null
      }
    >
      {ds && category ? (
        <AddToCategorySheet ds={ds} category={category} open={adding} onOpenChange={setAdding} />
      ) : null}
      {ds ? (
        <CategoryContent ds={ds} now={now} id={id} month={month ?? monthOf(now)} />
      ) : (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      )}
    </Screen>
  );
}

/** Screen Time for a category: the month's total, its days, its year, its parts, its rows. */
function CategoryContent({ ds, now, id, month }: { ds: Dataset; now: string; id: string; month: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const l = useMemo(() => lookup(ds), [ds]);
  const category = l.category.get(id);
  const months = useMemo(() => {
    const list = availableMonths(ds, now);
    return list.includes(month) ? list : [...list, month].sort();
  }, [ds, now, month]);
  const detail = useMemo(() => categoryMonthDetail(ds, id, month, now), [ds, id, month, now]);
  const series = useMemo(() => categorySeries(ds, id, 12, now), [ds, id, now]);
  const subtree = useMemo(
    () => new Set([id, ...ds.categories.filter((c) => c.parent_id === id).map((c) => c.id)]),
    [ds, id],
  );
  const txns = useMemo(
    () =>
      ds.transactions.filter(
        (t) => t.category_id !== null && subtree.has(t.category_id) && monthOf(t.occurred_at) === month,
      ),
    [ds, subtree, month],
  );
  const go = (m: string) =>
    void navigate({ to: "/category/$id", params: { id }, search: { month: m }, replace: true });

  if (!category) return <p className="text-fg-muted">That category no longer exists.</p>;
  const current = month === monthOf(now);
  const avg = detail.average;
  const over = avg !== null && detail.total > avg;
  const dailyAvg = avg ? Math.round(avg / daysInMonth(month)) : null;
  const outliers = series.filter((p) => p.outlier && p.month !== monthOf(now));

  return (
    <>
      <MonthPager months={months} month={month} onChange={go}>
        <div className="flex flex-col gap-2" data-testid="category-total">
          <Money
            value={detail.total}
            className="font-display text-hero font-medium"
            {...(avg === null ? {} : { tone: over ? ("neg" as const) : ("pos" as const) })}
          />
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            <span className="num">{avg === null ? "no average yet" : `avg ${formatRs(avg)}`}</span>
            {detail.change_pct !== null ? (
              <span className="num inline-flex items-center gap-1">
                {Math.round(detail.change_pct) === 0 ? null : detail.change_pct > 0 ? (
                  <ArrowUp aria-hidden />
                ) : (
                  <ArrowDown aria-hidden />
                )}
                {Math.round(detail.change_pct) === 0
                  ? `same as ${monthLabel(addMonths(month, -1)).slice(0, 3)}`
                  : `${Math.abs(detail.change_pct).toFixed(0)}% from ${monthLabel(addMonths(month, -1)).slice(0, 3)}`}
              </span>
            ) : null}
            {current ? <span>so far this month</span> : null}
          </p>
        </div>
        <DailyBars data={detail.daily} average={dailyAvg} />
      </MonthPager>

      <Section
        title="Last 12 months"
        aside={
          outliers.length > 0 ? (
            <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
              <span className="size-2 rounded-full bg-[var(--warn-line)]" aria-hidden />
              {outliers.length === 1 ? "1 unusual month" : `${outliers.length} unusual months`}
            </span>
          ) : null
        }
      >
        <MonthlyBars
          average={avg}
          onSelect={go}
          data={series.map((p) => ({
            month: p.month,
            value: p.value,
            outlier: p.outlier && p.month !== monthOf(now),
            current: p.month === month,
          }))}
        />
      </Section>

      {detail.parts.length > 0 ? (
        <Section title={`${category.name} in ${monthName(month)}`}>
          <ul className="flex flex-col gap-4" data-testid="parts">
            {detail.parts
              .filter((p) => p.spent > 0 || (p.average ?? 0) > 0)
              .map((p) => (
                <li key={p.id} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="flex items-baseline gap-3">
                      <span className="num text-fg-muted">{Math.round(p.share * 100)}%</span>
                      <Money value={p.spent} className="font-medium" />
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-surface-2">
                    <div
                      className={cn("h-1.5 rounded-full bg-[var(--chart-bar-current)]")}
                      style={{ width: `${Math.max(p.spent > 0 ? 2 : 0, p.share * 100)}%` }}
                    />
                  </div>
                  {p.average ? (
                    <span className="num text-sm text-fg-muted">avg {formatRs(p.average)}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Transactions">
        <ExpectedRows charges={detail.expected} onOpenTxn={(id) => setOpen(id)} />
        {txns.length > 0 ? (
          <TxnList
            txns={txns}
            l={l}
            now={now}
            onOpen={(t) => setOpen(t.id)}
            isClosedMonth={(m) => isClosed(ds, m)}
          />
        ) : detail.expected.length === 0 ? (
          <p className="text-fg-muted">
            Nothing on {category.name.toLowerCase()} in {monthName(month)}. Add a transaction or a
            subscription with Add.
          </p>
        ) : null}
      </Section>
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
