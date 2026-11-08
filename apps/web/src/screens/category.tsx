import {
  categoryCards,
  categorySeries,
  type Dataset,
  formatRs,
  isClosed,
  monthOf,
  spendOf,
} from "@marqum/core";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { MonthlyBars } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { monthName } from "../lib/months.ts";
import { lookup } from "../lib/view.ts";

export function CategoryScreen({ id }: { id: string }) {
  const ds = useDataset();
  const now = useNow();
  const name = ds?.categories.find((c) => c.id === id)?.name;
  return (
    <Screen back {...(name ? { title: name } : {})}>
      {ds ? (
        <CategoryContent ds={ds} now={now} id={id} />
      ) : (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-48 rounded-card" />
        </div>
      )}
    </Screen>
  );
}

function CategoryContent({ ds, now, id }: { ds: Dataset; now: string; id: string }) {
  const month = monthOf(now);
  const [open, setOpen] = useState<string | null>(null);
  const l = useMemo(() => lookup(ds), [ds]);
  const category = l.category.get(id);
  const card = useMemo(
    () => categoryCards(ds, month, now).find((c) => c.category.id === id),
    [ds, month, now, id],
  );
  const series = useMemo(() => categorySeries(ds, id, 12, now), [ds, id, now]);
  const subtree = useMemo(
    () => new Set([id, ...ds.categories.filter((c) => c.parent_id === id).map((c) => c.id)]),
    [ds, id],
  );
  const inCat = useMemo(
    () => ds.transactions.filter((t) => t.category_id !== null && subtree.has(t.category_id)),
    [ds, subtree],
  );
  const thisMonth = inCat.filter((t) => monthOf(t.occurred_at) === month);
  const top = useMemo(() => {
    const since = series[0]?.month ?? month;
    const by = new Map<string, { total: number; count: number }>();
    for (const t of inCat) {
      if (!t.counterparty_id || monthOf(t.occurred_at) < since) continue;
      const cur = by.get(t.counterparty_id) ?? { total: 0, count: 0 };
      by.set(t.counterparty_id, { total: cur.total + spendOf(t), count: cur.count + 1 });
    }
    return [...by.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  }, [inCat, series, month]);

  if (!category) return <Headline>That category no longer exists.</Headline>;
  const spent = card?.spent ?? thisMonth.reduce((s, t) => s + spendOf(t), 0);
  const avg = card?.average ?? null;
  const diff = avg === null ? null : spent - avg;
  const headline = `${formatRs(spent)} on ${category.name.toLowerCase()} in ${monthName(month)}`;
  const sub =
    diff === null
      ? "Not enough history for an average yet."
      : diff > 0
        ? `${formatRs(diff)} over your ${card?.months_in_average ?? ""}-month average of ${formatRs(avg ?? 0)}`
        : `${formatRs(-diff)} under your ${card?.months_in_average ?? ""}-month average of ${formatRs(avg ?? 0)}`;
  // The running month is partial, so it is never "unusual".
  const outliers = series.filter((p) => p.outlier && p.month !== month);
  const childMax = Math.max(1, ...(card?.children.map((c) => c.spent) ?? [0]));

  return (
    <>
      <Headline
        sub={<span className={diff === null ? undefined : diff > 0 ? "text-neg" : "text-pos"}>{sub}</span>}
      >
        {headline}
      </Headline>

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
          data={series.map((p) => ({
            month: p.month,
            value: p.value,
            outlier: p.outlier && p.month !== month,
            current: p.month === month,
          }))}
        />
      </Section>

      {card && card.children.length > 0 ? (
        <Section title="Breakdown">
          <ul className="flex flex-col gap-3">
            {card.children
              .filter((c) => c.spent > 0 || c.average)
              .sort((a, b) => b.spent - a.spent)
              .map((c) => (
                <li key={c.category.id} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-4 text-sm">
                    <span>{c.category.name}</span>
                    <span className="flex items-baseline gap-2">
                      {c.average ? (
                        <span className="num text-fg-muted">avg {formatRs(c.average)}</span>
                      ) : null}
                      <Money value={c.spent} className="font-medium" />
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-surface-2">
                    <div
                      className="h-1 rounded-full bg-fg-muted"
                      style={{ width: `${(c.spent / childMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
          </ul>
        </Section>
      ) : null}

      {top.length > 0 ? (
        <Section title="Most paid to">
          <ul className="-mx-3 flex flex-col">
            {top.map(([cpId, v]) => (
              <li key={cpId}>
                <Link
                  to="/counterparty/$id"
                  params={{ id: cpId }}
                  className="flex items-baseline justify-between gap-4 rounded-control px-3 py-2 hover:bg-surface-2"
                >
                  <span className="truncate">{l.counterparty.get(cpId)?.name ?? "Unknown"}</span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-sm text-fg-muted">{v.count}×</span>
                    <Money value={v.total} className="font-medium" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={`${monthName(month)} transactions`}>
        {thisMonth.length > 0 ? (
          <TxnList
            txns={thisMonth}
            l={l}
            now={now}
            onOpen={(t) => setOpen(t.id)}
            isClosedMonth={(m) => isClosed(ds, m)}
          />
        ) : (
          <p className="text-fg-muted">Nothing on {category.name.toLowerCase()} this month.</p>
        )}
      </Section>
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
