import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addMonths,
  availableMonths,
  type Dataset,
  formatRs,
  isClosed,
  monthLabel,
  monthOf,
  netPosition,
  openingInfo,
  trackingStartMonth,
  walletMonthDetail,
} from "@marqum/core";
import type { AccountId, Transaction } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BalanceSheet } from "../components/balance-sheet.tsx";
import { WalletLogo } from "../components/brand-logo.tsx";
import { BalanceLine } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { MonthPager } from "../components/month-pager.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList, virtualBroughtForward } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
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
        <Skeleton height={160} />
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
  const [matching, setMatching] = useState(false);
  const opening = openingInfo(ds, id);
  const firstMonth = month === trackingStartMonth(ds);
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
  const pos = useMemo(() => netPosition(ds, now).wallets.find((w) => w.account_id === id), [ds, now, id]);
  const below = current && pos && pos.floor !== null && pos.balance < pos.floor ? pos.floor - pos.balance : 0;
  const unverified = current && pos ? pos.provisional_delta : 0;
  const ledger: { label: string; value: string; total?: boolean }[] = [
    {
      label: firstMonth
        ? `Opening · ${opening.source === "statement" ? "statement" : opening.source === "you" ? "set by you" : "not set"}`
        : `Brought forward from ${monthLabel(addMonths(month, -1))}`,
      value: formatRs(d.brought_forward),
    },
    { label: "Money in", value: formatRs(d.inflow, { sign: d.inflow > 0 }) },
    { label: "Money out", value: formatRs(-d.outflow) },
    {
      label: d.carried_forward !== null ? `Carried forward to ${monthLabel(addMonths(month, 1))}` : "Closing",
      value: formatRs(d.closing),
      total: true,
    },
  ];

  return (
    <>
      <MonthPager months={months} month={month} onChange={go}>
        <Card
          {...(id === "sadapay" || id === "nayapay" ? { variant: id } : {})}
          padding={5}
          data-testid="wallet-closing"
        >
          <VStack gap={3}>
            <HStack gap={2} vAlign="center" justify="between">
              <Text type="label" color="inherit">
                {current ? "Now" : `Closing · ${monthLabel(month)}`}
              </Text>
              {id === "sadapay" || id === "nayapay" ? <WalletLogo id={id} size={28} /> : null}
            </HStack>
            <Text type="display-2" color="inherit" hasTabularNumbers>
              {formatRs(d.closing)}
            </Text>
            {below || unverified ? (
              <HStack gap={2} wrap="wrap">
                {below ? <Badge variant="warning" label={`${formatRs(below)} under your minimum`} /> : null}
                {unverified ? (
                  <Badge variant="neutral" label={`${formatRs(unverified, { sign: true })} unverified`} />
                ) : null}
              </HStack>
            ) : null}
          </VStack>
        </Card>
        {current ? (
          <HStack>
            <Button variant="text" size="sm" onClick={() => setMatching(true)}>
              Check against the bank app
            </Button>
          </HStack>
        ) : null}
        <List density="compact" edge="flush" data-testid="wallet-ledger">
          {ledger.map((r) => (
            <ListItem
              key={r.label}
              label={
                <Text {...(r.total ? { weight: "semibold" as const } : { color: "secondary" as const })}>
                  {r.label}
                </Text>
              }
              endContent={
                <Text hasTabularNumbers {...(r.total ? { weight: "semibold" as const } : {})}>
                  {r.value}
                </Text>
              }
            />
          ))}
        </List>
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
      <BalanceSheet ds={ds} account={matching ? id : null} onClose={() => setMatching(false)} />
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
