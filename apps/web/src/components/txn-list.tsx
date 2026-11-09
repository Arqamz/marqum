import { formatRs } from "@marqum/core";
import type { Transaction } from "@marqum/schema";
import { CornerDownRight, CornerUpRight, Lock, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { cn } from "../lib/cn.ts";
import { categoryPath, dayHeading, type Lookup, timeOf, topCategoryOf, txnTitle } from "../lib/view.ts";
import { CategoryIcon } from "./category-icon.tsx";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Bookkeeping rows (flow "carry"): every month opens with "Balance brought forward" and, once closed, ends with
 * "Balance carried forward", so each month runs from 0 to 0. Muted, not spending, not taggable.
 */
export function LedgerRow({ t, l }: { t: Transaction; l: Lookup }) {
  const forward = t.amount >= 0 && !/carried/i.test(t.description);
  const Icon = forward ? CornerDownRight : CornerUpRight;
  const wallet = l.account.get(t.account_id) ?? t.account_id;
  const m = /(?:brought|carried) forward\s+(from|to)\s+(.+)$/i.exec(t.description);
  const title = forward ? "Balance brought forward" : "Balance carried forward";
  const where = m ? `${m[1]?.toLowerCase()} ${m[2]}` : null;
  return (
    <li className="flex list-none items-center gap-3 px-3 py-3 text-fg-muted" data-testid="ledger-row">
      <span className="grid size-10 shrink-0 place-items-center">
        <Icon aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate">{title}</span>
        <span className="truncate text-sm">{[where, wallet].filter(Boolean).join(" · ")}</span>
      </span>
      <span className="num shrink-0 text-right">{formatRs(t.amount, { sign: t.amount > 0 })}</span>
    </li>
  );
}

export function TxnRow({
  t,
  l,
  onOpen,
  closed,
}: {
  t: Transaction;
  l: Lookup;
  onOpen: (t: Transaction) => void;
  closed?: boolean | undefined;
}) {
  if (t.flow === "carry") return <LedgerRow t={t} l={l} />;
  return <EntryRow t={t} l={l} onOpen={onOpen} closed={closed} />;
}

function EntryRow({
  t,
  l,
  onOpen,
  closed,
}: {
  t: Transaction;
  l: Lookup;
  onOpen: (t: Transaction) => void;
  closed?: boolean | undefined;
}) {
  const reduce = useReducedMotion();
  const top = topCategoryOf(t.category_id, l);
  const path = categoryPath(t.category_id, l);
  const warm = t.status === "provisional";
  const disputed = t.status === "disputed";
  const wallet = l.account.get(t.account_id) ?? t.account_id;
  const sub = [
    t.reason && t.reason !== txnTitle(t, l) ? t.reason : null,
    path ?? (t.flow === "spend" ? "Untagged" : null),
    wallet,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <motion.li
      layout={reduce ? false : "position"}
      transition={{ duration: 0.22, ease: EASE }}
      className="list-none"
    >
      <button
        type="button"
        onClick={() => onOpen(t)}
        data-testid="txn-row"
        data-status={t.status}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-surface-2",
          disputed && "bg-warn-soft hover:bg-warn-soft",
        )}
      >
        <AnimatePresence initial={false}>
          {warm ? (
            <motion.span
              key="warm"
              aria-hidden
              className="warm-outline pointer-events-none absolute inset-0 rounded-control"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            />
          ) : null}
        </AnimatePresence>
        <span
          className={cn(
            "relative grid size-10 shrink-0 place-items-center rounded-full",
            top ? "bg-surface-2 text-fg" : "bg-surface-2 text-fg-subtle",
          )}
        >
          <motion.span
            key={top?.id ?? "none"}
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="grid place-items-center"
          >
            <CategoryIcon name={top?.icon ?? (t.amount > 0 ? "banknote" : "circle")} />
          </motion.span>
          {warm || disputed ? (
            <span
              className="absolute -top-px -right-px size-3 rounded-full border-2 border-surface bg-warn"
              aria-hidden
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1 truncate font-medium">
            <span className="truncate">{txnTitle(t, l)}</span>
            {closed ? <Lock className="shrink-0 text-fg-subtle" aria-label="Closed month" /> : null}
          </span>
          <span className="truncate text-sm text-fg-muted">
            {disputed ? (
              <span className="inline-flex items-center gap-1 text-warn">
                <TriangleAlert aria-hidden />
                Not on the statement
              </span>
            ) : warm ? (
              <span className="text-warn">Unverified · {sub}</span>
            ) : (
              sub
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="num font-medium">{formatRs(t.amount, { sign: t.amount > 0 })}</span>
          <span className="num text-sm text-fg-muted">{timeOf(t.occurred_at)}</span>
        </span>
      </button>
    </motion.li>
  );
}

/** Rows grouped by day, newest first, each day with its net total. */
export function TxnList({
  txns,
  l,
  onOpen,
  isClosedMonth,
  now,
}: {
  txns: Transaction[];
  l: Lookup;
  onOpen: (t: Transaction) => void;
  isClosedMonth?: (month: string) => boolean;
  now: string;
}) {
  const days = useMemo(() => {
    const sorted = [...txns].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const map = new Map<string, Transaction[]>();
    for (const t of sorted) {
      const d = t.occurred_at.slice(0, 10);
      map.set(d, [...(map.get(d) ?? []), t]);
    }
    return [...map.entries()];
  }, [txns]);
  return (
    <div className="flex flex-col gap-6" data-testid="txn-list">
      {days.map(([day, rows]) => {
        const out = rows.reduce(
          (s, t) => s + (t.amount < 0 && (t.flow === "spend" || t.flow === "fee") ? t.amount : 0),
          0,
        );
        return (
          <section key={day} className="flex flex-col gap-1">
            <h3 className="flex items-baseline justify-between text-sm text-fg-muted">
              <span>{dayHeading(day, now)}</span>
              {out !== 0 ? <span className="num">{formatRs(-out)} spent</span> : null}
            </h3>
            <ul className="-mx-3 flex flex-col">
              {rows.map((t) => (
                <TxnRow
                  key={t.id}
                  t={t}
                  l={l}
                  onOpen={onOpen}
                  closed={isClosedMonth?.(t.occurred_at.slice(0, 7))}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** A brought-forward row that isn't stored yet (open month): shown from monthLedger's virtual b/f. */
export function virtualBroughtForward(
  account_id: Transaction["account_id"],
  month: string,
  amount: number,
  fromLabel: string,
): Transaction {
  return {
    id: `virtual-bf-${account_id}-${month}`,
    account_id,
    occurred_at: `${month}-01T00:00`,
    amount,
    status: "verified",
    source: "system",
    flow: "carry",
    description: `Balance brought forward from ${fromLabel}`,
    bank_type: null,
    reason: null,
    counterparty_id: null,
    category_id: null,
    external_id: null,
    statement_id: null,
    loan_id: null,
    linked_txn_id: null,
    fee: 0,
    balance_after: null,
    notification_id: null,
    created_at: `${month}-01T00:00`,
    updated_at: `${month}-01T00:00`,
    version: 0,
    deleted: false,
  };
}
