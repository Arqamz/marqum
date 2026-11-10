import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { formatRs } from "@marqum/core";
import type { Transaction } from "@marqum/schema";
import { CornerDownRight, CornerUpRight, Lock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";
import { cn } from "../lib/cn.ts";
import { opt } from "../lib/opt.ts";
import { categoryPath, dayHeading, type Lookup, timeOf, topCategoryOf, txnTitle } from "../lib/view.ts";
import { CategoryIcon, categoryTint } from "./category-icon.tsx";
import { Money } from "./money.tsx";

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
    <ListItem
      data-testid="ledger-row"
      label={title}
      description={[where, wallet].filter(Boolean).join(" · ")}
      startContent={
        <span className="grid size-10 place-items-center text-fg-muted">
          <Icon aria-hidden />
        </span>
      }
      endContent={<Money value={t.amount} sign={t.amount > 0} tone="muted" />}
    />
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
  const title = txnTitle(t, l);
  const sub = [
    t.reason && t.reason !== title ? t.reason : null,
    path ?? (t.flow === "spend" ? "Untagged" : null),
    wallet,
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
      description={sub}
      startContent={
        <span
          className={cn(
            "grid size-10 place-items-center rounded-full",
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
        </span>
      }
      endContent={
        <VStack gap={0.5} hAlign="end">
          <Money
            value={t.amount}
            sign={t.amount > 0}
            className="font-medium"
            {...opt({ tone: t.amount > 0 ? ("pos" as const) : undefined })}
          />
          {disputed ? (
            <Badge label="Not on statement" variant="error" />
          ) : warm ? (
            <Badge label="Unverified" variant="warning" />
          ) : (
            <Text type="supporting" hasTabularNumbers>
              {timeOf(t.occurred_at)}
            </Text>
          )}
        </VStack>
      }
    />
  );
}

/** Rows grouped by day, newest first, each day with its spend. */
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
    <VStack gap={6} data-testid="txn-list">
      {days.map(([day, rows]) => {
        const out = rows.reduce(
          (s, t) => s + (t.amount < 0 && (t.flow === "spend" || t.flow === "fee") ? t.amount : 0),
          0,
        );
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
            <List>
              {rows.map((t) => (
                <TxnRow
                  key={t.id}
                  t={t}
                  l={l}
                  onOpen={onOpen}
                  closed={isClosedMonth?.(t.occurred_at.slice(0, 7))}
                />
              ))}
            </List>
          </VStack>
        );
      })}
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
