import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addDays,
  availableMonths,
  type Dataset,
  expectedCharges,
  formatRs,
  isClosed,
  monthLabel,
  monthLedger,
  monthOf,
} from "@marqum/core";
import type { Transaction } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { ExpectedRows } from "../components/expected-list.tsx";
import { openQuickAdd } from "../components/quick-add.tsx";
import { Headline, Screen } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Chip, Skeleton } from "../components/ui/controls.tsx";
import { enqueue } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import type { ActivitySearch } from "../lib/search.ts";
import { categoryPath, lookup, needsTag, txnTitle } from "../lib/view.ts";
import { carryRows } from "./wallet.tsx";

const DEFAULT_MONTH = "default";

export function ActivityScreen({ search }: { search: ActivitySearch }) {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen
      actions={
        <Button
          size="icon"
          variant="ghost"
          aria-label="Add a transaction"
          onClick={() => openQuickAdd()}
          data-testid="quick-add"
        >
          <Plus aria-hidden />
        </Button>
      }
    >
      {ds ? (
        <ActivityContent ds={ds} now={now} search={search} />
      ) : (
        <VStack gap={3}>
          <Skeleton height={32} width="75%" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} height={56} index={i} />
          ))}
        </VStack>
      )}
    </Screen>
  );
}

function matches(t: Transaction, s: ActivitySearch, ds: Dataset, month: string | null): boolean {
  if (month && monthOf(t.occurred_at) !== month) return false;
  if (s.wallet && t.account_id !== s.wallet) return false;
  if (s.category && t.category_id !== s.category && !t.category_id?.startsWith(`${s.category}.`))
    return false;
  if (s.filter === "untagged" && !needsTag(t)) return false;
  if (s.filter === "unverified" && t.status === "verified") return false;
  if (s.filter === "noreason" && (t.reason !== null || (t.flow !== "spend" && t.flow !== "fee")))
    return false;
  if (s.cp && t.counterparty_id !== s.cp) return false;
  if (s.q) {
    const l = lookup(ds);
    const hay =
      `${txnTitle(t, l)} ${t.description} ${t.reason ?? ""} ${categoryPath(t.category_id, l) ?? ""}`.toLowerCase();
    if (!hay.includes(s.q.toLowerCase())) return false;
  }
  return true;
}

function ActivityContent({ ds, now, search }: { ds: Dataset; now: string; search: ActivitySearch }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState(search.q ?? "");
  const current = monthOf(now);
  // Unverified/untagged/search look across all months unless a month is picked.
  const month = search.month ?? (search.filter || search.q || search.cp ? null : current);
  const set = (patch: { [K in keyof ActivitySearch]?: ActivitySearch[K] | undefined }) =>
    void navigate({ to: "/activity", search: (prev: ActivitySearch) => clean({ ...prev, ...patch }) });

  const l = useMemo(() => lookup(ds), [ds]);
  const rows = useMemo(() => {
    const list = ds.transactions.filter((t) => matches(t, search, ds, month));
    // A plain month view opens each wallet with its brought-forward line (virtual while the month is open).
    if (month && !search.filter && !search.q && !search.cp && !search.category) {
      const have = new Set(list.map((t) => t.id));
      for (const a of ds.accounts) {
        if (search.wallet && search.wallet !== a.id) continue;
        const led = monthLedger(ds, a.id, month, now);
        for (const t of carryRows(ds, a.id, month, led.brought_forward, led.brought_forward_virtual))
          if (!have.has(t.id)) list.push(t);
      }
    }
    return list;
  }, [ds, search, month, now]);
  const spent = rows.reduce((s, t) => s + (t.flow === "spend" || t.flow === "fee" ? -t.amount : 0), 0);
  const untagged = rows.filter(needsTag).length;
  const disputed = rows.filter((t) => t.status === "disputed");
  // Fixed charges due now or within the week, on the plain current-month view.
  const soon = useMemo(() => {
    if (month !== current || search.filter || search.q || search.cp || search.category) return [];
    const weekOut = addDays(now.slice(0, 10), 7);
    return expectedCharges(ds, current, now).filter(
      (c) =>
        (!search.wallet || c.recurring.account_id === search.wallet) &&
        (c.status === "due" || (c.status === "upcoming" && c.due_date <= weekOut)),
    );
  }, [ds, now, month, current, search]);
  const months = useMemo(() => [...availableMonths(ds, now)].reverse(), [ds, now]);
  const txn = open ? (ds.transactions.find((t) => t.id === open) ?? null) : null;
  const cpName = search.cp ? l.counterparty.get(search.cp)?.name : undefined;
  const catName = search.category ? categoryPath(search.category, l) : null;

  const total = rows.every((t) => t.flow === "carry") ? null : formatRs(spent);
  const when = month ? (month === current ? monthName(month) : monthLabel(month)) : "All months";

  return (
    <>
      <Headline
        sub={
          total ? (
            <HStack as="span" gap={2} vAlign="center" wrap="wrap">
              <Text color="secondary">{when}</Text>
              {untagged > 0 ? <Badge label={`${untagged} untagged`} variant="warning" /> : null}
            </HStack>
          ) : undefined
        }
      >
        {total ? `${total} spent` : "Nothing here yet"}
      </Headline>

      <VStack gap={3}>
        <TextInput
          type="search"
          label="Search"
          isLabelHidden
          placeholder="Search"
          startIcon={Search}
          hasClear
          value={q}
          onChange={(v) => {
            setQ(v);
            set({ q: v || undefined });
          }}
        />
        <HStack gap={2} wrap="wrap" vAlign="center">
          <Selector
            label="Month"
            isLabelHidden
            size="sm"
            variant="secondary"
            presentation="adaptive"
            value={search.month ?? DEFAULT_MONTH}
            onChange={(v) => set({ month: v === DEFAULT_MONTH ? undefined : v })}
            options={[
              {
                value: DEFAULT_MONTH,
                label: search.filter || search.q || search.cp ? "All months" : monthName(current),
              },
              ...months.map((m) => ({ value: m, label: monthLabel(m) })),
            ]}
          />
          {ds.accounts.map((a) => (
            <Chip
              key={a.id}
              selected={search.wallet === a.id}
              onClick={() => set({ wallet: search.wallet === a.id ? undefined : a.id })}
            >
              {a.name}
            </Chip>
          ))}
          <Chip
            selected={search.filter === "untagged"}
            onClick={() => set({ filter: search.filter === "untagged" ? undefined : "untagged" })}
          >
            Untagged
          </Chip>
          <Chip
            selected={search.filter === "unverified"}
            onClick={() => set({ filter: search.filter === "unverified" ? undefined : "unverified" })}
          >
            Unverified
          </Chip>
          {catName ? (
            <Chip
              selected
              label={`${catName}, remove`}
              icon={<X aria-hidden />}
              onClick={() => set({ category: undefined })}
            >
              {catName}
            </Chip>
          ) : null}
          {cpName ? (
            <Chip
              selected
              label={`${cpName}, remove`}
              icon={<X aria-hidden />}
              onClick={() => set({ cp: undefined })}
            >
              {cpName}
            </Chip>
          ) : null}
        </HStack>
      </VStack>

      {soon.length > 0 ? (
        <VStack as="section" gap={1} aria-label="Expected this week">
          <Text type="label" color="secondary">
            This week
          </Text>
          <ExpectedRows charges={soon} />
        </VStack>
      ) : null}

      {disputed.length > 0 ? (
        <Banner
          status="warning"
          title={`${disputed.length} not on the statement`}
          description="Keep if it went through the other wallet."
          collapsible={false}
        >
          <VStack gap={2}>
            {disputed.map((t) => (
              <HStack key={t.id} gap={2} vAlign="center" data-testid="disputed-row">
                <StackItem size="fill">
                  <Text maxLines={1} hasTabularNumbers>
                    {formatRs(t.amount)} · {txnTitle(t, l)}
                  </Text>
                </StackItem>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void enqueue("resolveDisputed", { txn_id: t.id, action: "keep_provisional" })
                  }
                >
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void enqueue("resolveDisputed", { txn_id: t.id, action: "delete" })}
                >
                  Delete
                </Button>
              </HStack>
            ))}
          </VStack>
        </Banner>
      ) : null}

      {rows.length > 0 ? (
        <TxnList
          txns={rows}
          l={l}
          now={now}
          onOpen={(t) => setOpen(t.id)}
          isClosedMonth={(m) => isClosed(ds, m)}
        />
      ) : (
        <EmptyActivity filtered={Object.keys(search).length > 0} />
      )}
      <TagSheet txn={txn} onClose={() => setOpen(null)} />
    </>
  );
}

function EmptyActivity({ filtered }: { filtered: boolean }) {
  return (
    <EmptyState
      title={filtered ? "No matches" : "No transactions yet"}
      description={filtered ? "Try fewer filters." : "Statements land here automatically."}
      actions={
        <Button variant="primary" onClick={() => openQuickAdd()}>
          Add a transaction
        </Button>
      }
    />
  );
}

function clean(s: { [K in keyof ActivitySearch]?: ActivitySearch[K] | undefined }): ActivitySearch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== "") out[k] = v;
  return out as ActivitySearch;
}
