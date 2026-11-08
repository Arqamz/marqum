import {
  categoryCards,
  type Dataset,
  dayLabel,
  formatRs,
  goalStatus,
  monthLabel,
  monthOf,
  netPosition,
  unverifiedSummary,
} from "@marqum/core";
import { Link } from "@tanstack/react-router";
import { Plus, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { HeroAmount, Money, TweenMoney } from "../components/money.tsx";
import { openQuickAdd } from "../components/quick-add.tsx";
import { Screen } from "../components/shell.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { WhatIfCard } from "../components/what-if.tsx";
import { cn } from "../lib/cn.ts";
import { isNative } from "../lib/platform.ts";

export function HomeScreen() {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen
      actions={
        <button
          type="button"
          aria-label="Add a transaction"
          onClick={() => openQuickAdd()}
          className="grid size-10 place-items-center rounded-full hover:bg-surface-2"
        >
          <Plus aria-hidden />
        </button>
      }
    >
      {ds ? <HomeContent ds={ds} now={now} /> : <HomeSkeleton />}
    </Screen>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy>
      <div className="flex flex-col items-center gap-3 py-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-14 w-56" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
    </div>
  );
}

function HomeContent({ ds, now }: { ds: Dataset; now: string }) {
  const month = monthOf(now);
  const np = useMemo(() => netPosition(ds, now), [ds, now]);
  const cards = useMemo(() => categoryCards(ds, month, now), [ds, month, now]);
  const unverified = useMemo(() => unverifiedSummary(ds), [ds]);
  const setAside = useMemo(() => goalStatus(ds, now).reduce((s, g) => s + g.saved, 0), [ds, now]);

  const debtLine = useMemo(() => {
    if (!np.in_debt) return null;
    const open = np.loans.filter((l) => l.outstanding > 0);
    if (open.length === 1 && open[0]) {
      const l = open[0];
      return `Owe ${l.loan.lender} ${formatRs(l.outstanding)}${
        l.payoff_month
          ? ` · clear by ${monthLabel(l.payoff_month)} at ${formatRs(l.loan.installment)}/month`
          : ""
      }`;
    }
    return `Owe ${formatRs(np.debt)} across ${open.length} loans${np.debt_free_month ? ` · clear by ${monthLabel(np.debt_free_month)}` : ""}`;
  }, [np]);

  const verifiedTo = np.wallets
    .map((w) => w.verified_until)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-6 pb-2 text-center" data-testid="hero">
        <span className={cn("text-sm font-medium", np.in_debt ? "text-neg" : "text-fg-muted")}>
          {np.in_debt ? "In debt" : "Net position"}
        </span>
        <HeroAmount
          value={np.net}
          className={cn(
            "text-hero font-medium transition-colors",
            np.in_debt || np.net < 0 ? "text-neg" : np.net > 0 ? "text-pos" : "text-fg",
          )}
        />
        <p className="max-w-xs text-sm text-balance text-fg-muted">
          {debtLine ??
            `Across SadaPay and NayaPay${verifiedTo ? ` · verified to ${dayLabel(verifiedTo)}` : ""}`}
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4" aria-label="Wallets">
        {np.wallets.map((w) => {
          const below = w.floor !== null && w.balance < w.floor;
          return (
            <div key={w.account_id} className="flex flex-col gap-1" data-testid={`wallet-${w.account_id}`}>
              <span className="text-sm text-fg-muted">{w.name}</span>
              <TweenMoney value={w.balance} className="text-xl font-medium" />
              <span className="flex flex-col text-sm text-fg-muted">
                {w.role === "vault" && setAside > 0 ? (
                  <span className="num">{formatRs(setAside)} set aside</span>
                ) : null}
                {below && w.floor !== null ? (
                  <span className="num text-warn">{formatRs(w.floor - w.balance)} below floor</span>
                ) : null}
                <span>
                  {w.verified_until ? `verified to ${dayLabel(w.verified_until)}` : "no statement yet"}
                </span>
                {w.provisional_delta !== 0 ? (
                  <span className="num text-warn">
                    {formatRs(w.provisional_delta, { sign: true })} unverified
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </section>

      {unverified.count > 0 ? (
        <Link
          to={isNative() ? "/activity" : "/import"}
          search={isNative() ? { filter: "unverified" } : {}}
          className="flex items-center gap-3 rounded-card bg-warn-soft px-4 py-3 text-sm"
          data-testid="unverified-banner"
        >
          <TriangleAlert className="shrink-0 text-warn" aria-hidden />
          <span className="flex-1">
            <span className="num font-medium">
              {unverified.count} unverified · {formatRs(Math.abs(unverified.total))}
              {unverified.since ? ` since ${dayLabel(unverified.since.slice(0, 10))}` : ""}
            </span>
            <span className="text-fg-muted">
              {unverified.disputed > 0
                ? ` — ${unverified.disputed} not on the statement, resolve them`
                : " — generate statements"}
            </span>
          </span>
        </Link>
      ) : null}

      {ds.transactions.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-card bg-surface p-4">
          <p className="text-fg-muted">
            {isNative()
              ? "Generate a NayaPay statement — it'll appear here automatically. For SadaPay, generate one and share it to Marqūm."
              : "Import a NayaPay or SadaPay statement to see where your money goes."}
          </p>
          <Link
            to="/import"
            className="inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Import statements
          </Link>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3" aria-label={`Spending in ${monthLabel(month)}`}>
        {cards.map((c) => (
          <Link
            key={c.category.id}
            to="/category/$id"
            params={{ id: c.category.id }}
            className="flex flex-col gap-3 rounded-card bg-surface p-4 transition-colors hover:bg-surface-2"
            data-testid="category-card"
          >
            <span className="flex items-center gap-2 text-sm text-fg-muted">
              <CategoryIcon name={c.category.icon} />
              <span className="truncate">{c.category.name}</span>
            </span>
            <span className="flex flex-col gap-1">
              <Money
                value={c.spent}
                className="text-xl font-medium"
                {...(c.average === null || (c.average === 0 && c.spent === 0)
                  ? {}
                  : { tone: c.over_average ? ("neg" as const) : ("pos" as const) })}
              />
              <span className="num text-sm text-fg-muted">
                {c.average === null ? "no history yet" : `avg ${formatRs(c.average)}`}
              </span>
            </span>
          </Link>
        ))}
        <WhatIfCard ds={ds} now={now} />
      </section>
    </>
  );
}
