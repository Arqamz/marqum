import {
  addMonths,
  availableMonths,
  type Dataset,
  formatRs,
  isClosed,
  monthLabel,
  monthOf,
  walletMonthDetail,
} from "@marqum/core";
import type { AccountId, Transaction } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BalanceLine } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { MonthPager } from "../components/month-pager.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList, virtualBroughtForward } from "../components/txn-list.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { lookup } from "../lib/view.ts";

export function WalletScreen({ id, month }: { id: AccountId; month?: string | undefined }) {
  const ds = useDataset();
  const now = useNow();
  const name = ds?.accounts.find((a) => a.id === id)?.name;
  return (
    <Screen back {...(name ? { title: name } : {})}>
      {ds ? (
        <WalletContent ds={ds} now={now} id={id} month={month ?? monthOf(now)} />
      ) : (
        <Skeleton className="h-40 rounded-card" />
      )}
    </Screen>
  );
}

/** Carry rows for a wallet's month: the stored b/f (or the virtual one while open) and the c/f once closed. */
export function carryRows(
  ds: Dataset,
  account: AccountId,
  month: string,
  bf: number,
  virtual: boolean,
): Transaction[] {
  const stored = ds.transactions.filter(
    (t) => t.flow === "carry" && t.account_id === account && monthOf(t.occurred_at) === month,
  );
  if (virtual && !stored.some((t) => t.amount >= 0 && !/carried/i.test(t.description)))
    stored.push(virtualBroughtForward(account, month, bf, monthLabel(addMonths(month, -1))));
  return stored;
}

function WalletContent({ ds, now, id, month }: { ds: Dataset; now: string; id: AccountId; month: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const l = useMemo(() => lookup(ds), [ds]);
  const months = useMemo(() => {
    const list = availableMonths(ds, now);
    return list.includes(month) ? list : [...list, month].sort();
  }, [ds, now, month]);
  const d = useMemo(() => walletMonthDetail(ds, id, month, now), [ds, id, month, now]);
  const rows = useMemo(
    () => [...d.transactions, ...carryRows(ds, id, month, d.brought_forward, d.brought_forward_virtual)],
    [ds, d, id, month],
  );
  const go = (m: string) =>
    void navigate({ to: "/wallet/$id", params: { id }, search: { month: m }, replace: true });
  const current = month === monthOf(now);

  return (
    <>
      <MonthPager months={months} month={month} onChange={go}>
        <div className="flex flex-col gap-2" data-testid="wallet-closing">
          <Money value={d.closing} className="font-display text-hero font-medium" />
          <p className="text-sm text-fg-muted">
            {current ? "balance now" : `closing balance, ${monthLabel(month)}`}
          </p>
        </div>
        <dl className="flex flex-col gap-2 text-sm" data-testid="wallet-ledger">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Brought forward from {monthLabel(addMonths(month, -1))}</dt>
            <dd className="num">{formatRs(d.brought_forward)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Money in</dt>
            <dd className="num">{formatRs(d.inflow, { sign: d.inflow > 0 })}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Money out</dt>
            <dd className="num">{formatRs(-d.outflow)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-border border-t pt-2 font-medium">
            <dt>
              {d.carried_forward !== null
                ? `Carried forward to ${monthLabel(addMonths(month, 1))}`
                : "Closing"}
            </dt>
            <dd className="num">{formatRs(d.closing)}</dd>
          </div>
        </dl>
        <BalanceLine data={current ? d.daily.filter((x) => x.date <= now.slice(0, 10)) : d.daily} />
      </MonthPager>

      <Section title="Ledger">
        <TxnList
          txns={rows}
          l={l}
          now={now}
          onOpen={(t) => setOpen(t.id)}
          isClosedMonth={(m) => isClosed(ds, m)}
        />
      </Section>
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
