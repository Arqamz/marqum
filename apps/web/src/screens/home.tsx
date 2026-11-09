import {
  categoryCards,
  type Dataset,
  dayLabel,
  formatRs,
  goalStatus,
  monthLabel,
  monthLedger,
  monthOf,
  netPosition,
  suggestOpeningBalance,
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
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { WhatIfCard } from "../components/what-if.tsx";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { isNative } from "../lib/platform.ts";
import { firstTrackedMonth } from "../lib/tracking.ts";

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
      return `owe ${l.loan.lender} ${formatRs(l.outstanding)}${
        l.payoff_month
          ? ` · clear by ${monthLabel(l.payoff_month)} at ${formatRs(l.loan.installment)}/month`
          : ""
      }`;
    }
    return `owe ${formatRs(np.debt)} across ${open.length} loans${np.debt_free_month ? ` · clear by ${monthLabel(np.debt_free_month)}` : ""}`;
  }, [np]);

  const verifiedTo = np.wallets
    .map((w) => w.verified_until)
    .filter((d): d is string => d !== null)
    .sort()[0];

  return (
    <>
      <section className="flex flex-col items-center gap-2 pt-6 pb-2 text-center" data-testid="hero">
        <span className="text-sm font-medium text-fg-muted">Net position</span>
        <HeroAmount
          value={np.net}
          className={cn("text-hero font-medium transition-colors", np.net < 0 ? "text-neg" : "text-fg")}
        />
        {debtLine ? (
          <p
            className="mt-1 max-w-sm rounded-card bg-neg-soft px-4 py-2 text-sm text-balance text-neg"
            data-testid="debt-line"
          >
            <span className="font-medium">In debt</span> · {debtLine}
          </p>
        ) : (
          <p className="max-w-xs text-sm text-balance text-fg-muted">
            Across SadaPay and NayaPay{verifiedTo ? ` · verified to ${dayLabel(verifiedTo)}` : ""}
          </p>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3" aria-label="Wallets">
        {np.wallets.map((w) => {
          const below = w.floor !== null && w.balance < w.floor;
          const ledger = monthLedger(ds, w.account_id, month, now);
          return (
            <Link
              key={w.account_id}
              to="/wallet/$id"
              params={{ id: w.account_id }}
              className="flex flex-col gap-2 rounded-card bg-surface p-4 transition-colors hover:bg-surface-2"
              data-testid={`wallet-${w.account_id}`}
            >
              <span className="text-sm text-fg-muted">{w.name}</span>
              <TweenMoney value={w.balance} className="text-xl font-medium" />
              <span className="flex flex-col gap-1 text-sm text-fg-muted">
                <span className="num">{formatRs(ledger.inflow, { sign: ledger.inflow > 0 })} in</span>
                <span className="num">{formatRs(-ledger.outflow)} out</span>
                {w.role === "vault" && setAside > 0 ? (
                  <span className="num">{formatRs(setAside)} set aside</span>
                ) : null}
                {below && w.floor !== null ? (
                  <span className="num text-warn">{formatRs(w.floor - w.balance)} below floor</span>
                ) : null}
                {w.unaccounted_hint && !suggestOpeningBalance(ds, w.account_id) ? (
                  <span className="text-fg-muted">{w.unaccounted_hint}</span>
                ) : null}
                {w.provisional_delta !== 0 ? (
                  <span className="num text-warn">
                    {formatRs(w.provisional_delta, { sign: true })} unverified
                  </span>
                ) : (
                  <span>
                    {w.verified_until ? `verified to ${dayLabel(w.verified_until)}` : "no statement yet"}
                  </span>
                )}
              </span>
            </Link>
          );
        })}
      </section>

      <OpeningSuggestions ds={ds} />

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
            search={{ month }}
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

/**
 * One-tap fix for an unset opening balance: a stated balance (typed, or from a SadaPay notification) implies what
 * the first tracked month must have opened with. Shown only until the opening is set.
 */
function OpeningSuggestions({ ds }: { ds: Dataset }) {
  const start = firstTrackedMonth(ds);
  const items = ds.accounts
    .map((a) => {
      const s = suggestOpeningBalance(ds, a.id);
      if (!s) return null;
      const stated = ds.balances
        .filter((b) => b.account_id === a.id && (b.source === "manual" || b.source === "notification"))
        .sort((x, y) => x.as_of.localeCompare(y.as_of))
        .at(-1);
      return { account: a, suggestion: s, stated };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label="Opening balances">
      {items.map(({ account, suggestion, stated }) => (
        <div
          key={account.id}
          className="flex flex-col gap-3 rounded-card bg-surface p-4"
          data-testid="opening-suggestion"
        >
          <p className="num text-sm">
            {stated
              ? `${account.name}'s balance on ${dayLabel(stated.as_of.slice(0, 10))} was ${formatRs(stated.balance, { decimals: true })}`
              : `${account.name}'s stated balance`}{" "}
            → your 1 {monthLabel(start)} opening was {formatRs(suggestion.amount, { decimals: true })}. Set
            it?
          </p>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              void enqueue("setOpeningBalance", { account_id: account.id, amount: suggestion.amount })
            }
          >
            Set {account.name} opening to {formatRs(suggestion.amount, { decimals: true })}
          </Button>
        </div>
      ))}
    </section>
  );
}
