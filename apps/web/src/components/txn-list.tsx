import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { dayLabel, formatRs } from "@marqum/core";
import type { Transaction } from "@marqum/schema";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CornerDownRight,
  CornerUpRight,
  Lock,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import { cn } from "../lib/cn.ts";
import { opt } from "../lib/opt.ts";
import { categoryPath, dayHeading, type Lookup, timeOf, topCategoryOf, txnTitle } from "../lib/view.ts";
import { WalletLogo } from "./brand-logo.tsx";
import { CategoryIcon, categoryTint } from "./category-icon.tsx";
import { Money } from "./money.tsx";

const EASE = [0.22, 1, 0.36, 1] as const;

/** The wallet as a small brand-coloured logo on the tile's corner, so rows don't spell it out. */
function WalletDot({ id }: { id: Transaction["account_id"] }) {
  return (
    <span
      className={cn(
        "absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full ring-2 ring-bg",
        id === "sadapay"
          ? "bg-[var(--brand-sadapay)] text-[var(--brand-sadapay-ink)]"
          : "bg-[var(--brand-nayapay)] text-[var(--brand-nayapay-ink)]",
      )}
    >
      <WalletLogo id={id} size={10} />
    </span>
  );
}

/** Direction at a glance, in front of the description line: in (green ↙), out (↗), between own wallets (⇄). */
function Direction({ t }: { t: Transaction }) {
  const internal = t.flow === "internal";
  const inflow = !internal && t.amount > 0;
  const Icon = internal ? ArrowLeftRight : inflow ? ArrowDownLeft : ArrowUpRight;
  return (
    <Icon
      size={12}
      strokeWidth={2.25}
      className={cn("shrink-0", inflow ? "text-pos" : "text-fg-subtle")}
      aria-label={internal ? "Between wallets" : inflow ? "In" : "Out"}
    />
  );
}

/** The amount, unsigned: direction is the arrow on the left; money in is green. */
function Amount({ t }: { t: Transaction }) {
  const internal = t.flow === "internal";
  const inflow = !internal && t.amount > 0;
  return (
    <Money
      value={Math.abs(t.amount)}
      className="font-medium"
      {...opt({ tone: inflow ? ("pos" as const) : internal ? ("muted" as const) : undefined })}
    />
  );
}

/**
 * Bookkeeping rows (flow "carry"): every month opens with "Balance brought forward" and, once closed, ends with
 * "Balance carried forward", so each month runs from 0 to 0. Muted, not spending, not taggable.
 */
export function LedgerRow({ t }: { t: Transaction }) {
  const forward = t.amount >= 0 && !/carried/i.test(t.description);
  const Icon = forward ? CornerDownRight : CornerUpRight;
  const m = /(?:brought|carried) forward\s+(from|to)\s+(.+)$/i.exec(t.description);
  const title = forward ? "Balance brought forward" : "Balance carried forward";
  const where = m ? `${m[1]?.toLowerCase()} ${m[2]}` : null;
  return (
    <ListItem
      data-testid="ledger-row"
      label={title}
      {...opt({ description: where ?? undefined })}
      startContent={
        <span className="relative grid size-10 place-items-center text-fg-muted">
          <Icon aria-hidden />
          <WalletDot id={t.account_id} />
        </span>
      }
      endContent={<Money value={t.amount} sign={t.amount > 0} tone="muted" />}
    />
  );
}

type RowProps = {
  t: Transaction;
  l: Lookup;
  onOpen: (t: Transaction) => void;
  closed?: boolean | undefined;
  /** "Paid back" / "Pays back" when the other half of a reimbursement isn't in view. */
  link?: string | undefined;
  /** Replaces the time (e.g. a payback grouped under an expense from another day). */
  stamp?: string | undefined;
};

export function TxnRow(props: RowProps) {
  if (props.t.flow === "carry") return <LedgerRow t={props.t} />;
  return <EntryRow {...props} />;
}

function EntryRow({ t, l, onOpen, closed, link, stamp }: RowProps) {
  const reduce = useReducedMotion();
  const top = topCategoryOf(t.category_id, l);
  const path = categoryPath(t.category_id, l);
  const warm = t.status === "provisional";
  const disputed = t.status === "disputed";
  const title = txnTitle(t, l);
  const sub = [
    t.reason && t.reason !== title ? t.reason : null,
    path ?? (t.flow === "spend" ? "Untagged" : null),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ListItem
      data-testid="txn-row"
      data-status={t.status}
      onClick={() => onOpen(t)}
      {...opt({ className: disputed ? "bg-warn-soft" : undefined })}
      label={
        closed ? (
          <HStack gap={1} vAlign="center">
            <Text weight="medium" maxLines={1}>
              {title}
            </Text>
            <Lock className="shrink-0 text-fg-subtle" aria-label="Closed month" />
          </HStack>
        ) : (
          title
        )
      }
      description={
        <HStack gap={1} vAlign="center">
          <Direction t={t} />
          <Text type="supporting" maxLines={1} hasTruncateTooltip={false}>
            {sub || (t.amount > 0 ? "In" : "Out")}
          </Text>
        </HStack>
      }
      startContent={
        <span
          className={cn(
            "relative grid size-10 place-items-center rounded-full",
            top
              ? categoryTint(top.id)
              : t.amount > 0
                ? "bg-green-subtle text-green-vivid"
                : "bg-surface-2 text-fg-subtle",
            warm && "warm-outline",
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
          <WalletDot id={t.account_id} />
        </span>
      }
      endContent={
        <VStack gap={0.5} hAlign="end">
          <Amount t={t} />
          {disputed ? (
            <Badge label="Not on statement" variant="error" />
          ) : warm ? (
            <Badge label="Unverified" variant="warning" />
          ) : link ? (
            <Badge label={link} variant="neutral" />
          ) : (
            <Text type="supporting" hasTabularNumbers>
              {stamp ?? timeOf(t.occurred_at)}
            </Text>
          )}
        </VStack>
      }
    />
  );
}

/** A reimbursement pointing back at an expense. */
const paysBack = (t: Transaction): t is Transaction & { linked_txn_id: string } =>
  t.flow === "reimbursement" && t.linked_txn_id !== null;

type Segment =
  | { kind: "rows"; rows: Transaction[] }
  | { kind: "pair"; expense: Transaction; paybacks: Transaction[] };

/**
 * Rows grouped by day, newest first, each day with its spend. With `links` (every transaction), a payback and the
 * expense it repays share one outlined box at the expense's position; a half whose partner is out of view gets a
 * "Paid back" / "Pays back" badge instead.
 */
export function TxnList({
  txns,
  l,
  onOpen,
  isClosedMonth,
  now,
  links,
}: {
  txns: Transaction[];
  l: Lookup;
  onOpen: (t: Transaction) => void;
  isClosedMonth?: (month: string) => boolean;
  now: string;
  links?: Transaction[];
}) {
  const { days, pairs, repaid } = useMemo(() => {
    const visible = new Set(txns.map((t) => t.id));
    const pairs = new Map<string, Transaction[]>();
    const tucked = new Set<string>();
    if (links)
      for (const t of txns)
        if (paysBack(t) && visible.has(t.linked_txn_id)) {
          pairs.set(t.linked_txn_id, [...(pairs.get(t.linked_txn_id) ?? []), t]);
          tucked.add(t.id);
        }
    const repaid = new Set((links ?? []).filter(paysBack).map((t) => t.linked_txn_id));
    const sorted = txns
      .filter((t) => !tucked.has(t.id))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const map = new Map<string, Transaction[]>();
    for (const t of sorted) {
      const d = t.occurred_at.slice(0, 10);
      map.set(d, [...(map.get(d) ?? []), t]);
    }
    return { days: [...map.entries()], pairs, repaid };
  }, [txns, links]);

  const row = (t: Transaction, extra: { link?: string | undefined; stamp?: string | undefined } = {}) => (
    <TxnRow
      key={t.id}
      t={t}
      l={l}
      onOpen={onOpen}
      closed={isClosedMonth?.(t.occurred_at.slice(0, 7))}
      {...extra}
    />
  );
  const linkOf = (t: Transaction): string | undefined =>
    !links || pairs.has(t.id)
      ? undefined
      : paysBack(t)
        ? "Pays back"
        : repaid.has(t.id)
          ? "Paid back"
          : undefined;

  return (
    <VStack gap={6} data-testid="txn-list">
      {days.map(([day, rows]) => {
        const out = rows.reduce(
          (s, t) => s + (t.amount < 0 && (t.flow === "spend" || t.flow === "fee") ? t.amount : 0),
          0,
        );
        const segments: Segment[] = [];
        for (const t of rows) {
          const paybacks = pairs.get(t.id);
          if (paybacks) segments.push({ kind: "pair", expense: t, paybacks });
          else {
            const last = segments.at(-1);
            if (last?.kind === "rows") last.rows.push(t);
            else segments.push({ kind: "rows", rows: [t] });
          }
        }
        return (
          <VStack as="section" key={day} gap={1}>
            <HStack justify="between" vAlign="center">
              <Text type="label" color="secondary">
                {dayHeading(day, now)}
              </Text>
              {out !== 0 ? (
                <Text type="label" color="secondary" hasTabularNumbers>
                  {formatRs(-out)}
                </Text>
              ) : null}
            </HStack>
            {segments.map(
              (seg): ReactNode =>
                seg.kind === "rows" ? (
                  <List key={seg.rows[0]?.id}>{seg.rows.map((t) => row(t, { link: linkOf(t) }))}</List>
                ) : (
                  <PairBox key={seg.expense.id} expense={seg.expense} paybacks={seg.paybacks}>
                    {row(seg.expense)}
                    {seg.paybacks.map((p) =>
                      row(p, {
                        stamp:
                          p.occurred_at.slice(0, 10) === day
                            ? undefined
                            : dayLabel(p.occurred_at.slice(0, 10)),
                      }),
                    )}
                  </PairBox>
                ),
            )}
          </VStack>
        );
      })}
    </VStack>
  );
}

/** An expense and the payback(s) for it, boxed together with what it cost in the end. */
function PairBox({
  expense,
  paybacks,
  children,
}: {
  expense: Transaction;
  paybacks: Transaction[];
  children: ReactNode;
}) {
  const net = expense.amount + paybacks.reduce((s, p) => s + p.amount, 0);
  return (
    <VStack
      gap={0}
      paddingBlockEnd={2}
      className="rounded-container border border-border"
      data-testid="txn-pair"
    >
      <List>{children}</List>
      <HStack justify="end" paddingInline={4}>
        <Text type="supporting" hasTabularNumbers>
          Net {formatRs(net, { sign: true })}
        </Text>
      </HStack>
    </VStack>
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
