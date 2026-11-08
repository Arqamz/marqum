import { addMonths, type Dataset, formatRs, isClosed, monthLabel, monthOf } from "@marqum/core";
import type { Transaction } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
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

export function ActivityScreen({ search }: { search: ActivitySearch }) {
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
          data-testid="quick-add"
        >
          <Plus aria-hidden />
        </button>
      }
    >
      {ds ? (
        <ActivityContent ds={ds} now={now} search={search} />
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-3/4" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
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
  const current = monthOf(now);
  // Unverified/untagged/search look across all months unless a month is picked.
  const month = search.month ?? (search.filter || search.q || search.cp ? null : current);
  const set = (patch: { [K in keyof ActivitySearch]?: ActivitySearch[K] | undefined }) =>
    void navigate({ to: "/activity", search: (prev: ActivitySearch) => clean({ ...prev, ...patch }) });

  const l = useMemo(() => lookup(ds), [ds]);
  const rows = useMemo(
    () => ds.transactions.filter((t) => matches(t, search, ds, month)),
    [ds, search, month],
  );
  const spent = rows.reduce((s, t) => s + (t.flow === "spend" || t.flow === "fee" ? -t.amount : 0), 0);
  const untagged = rows.filter(needsTag).length;
  const disputed = rows.filter((t) => t.status === "disputed");
  const months = useMemo(() => {
    let first = now;
    for (const t of ds.transactions) if (t.occurred_at < first) first = t.occurred_at;
    first = first.slice(0, 7);
    const list: string[] = [];
    for (let m = current; m >= first && list.length < 24; m = addMonths(m, -1)) list.push(m);
    return list;
  }, [ds, now, current]);
  const txn = open ? (ds.transactions.find((t) => t.id === open) ?? null) : null;
  const cpName = search.cp ? l.counterparty.get(search.cp)?.name : undefined;
  const catName = search.category ? categoryPath(search.category, l) : null;

  const headline =
    rows.length === 0
      ? "Nothing here yet"
      : `${formatRs(spent)} spent${month ? ` in ${month === current ? monthName(month) : monthLabel(month)}` : ""}${
          untagged > 0 ? ` · ${untagged} untagged` : ""
        }`;

  return (
    <>
      <Headline>{headline}</Headline>

      <div className="flex flex-col gap-3">
        <label className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search people, reasons, categories"
            aria-label="Search"
            defaultValue={search.q ?? ""}
            onChange={(e) => set({ q: e.target.value || undefined })}
            className="h-12 w-full rounded-control bg-surface pr-4 pl-12 text-base outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <select
            aria-label="Month"
            value={search.month ?? ""}
            onChange={(e) => set({ month: e.target.value || undefined })}
            className="h-8 shrink-0 rounded-full border border-border bg-surface px-3 text-sm"
          >
            <option value="">
              {search.filter || search.q || search.cp ? "All months" : monthName(current)}
            </option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
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
            <Chip selected onClick={() => set({ category: undefined })}>
              {catName}
              <X aria-label="Remove" />
            </Chip>
          ) : null}
          {cpName ? (
            <Chip selected onClick={() => set({ cp: undefined })}>
              {cpName}
              <X aria-label="Remove" />
            </Chip>
          ) : null}
        </div>
      </div>

      {disputed.length > 0 ? (
        <section
          className="flex flex-col gap-3 rounded-card bg-warn-soft p-4"
          aria-label="Not on the statement"
        >
          <p className="text-sm">
            <span className="font-medium">
              {disputed.length} {disputed.length === 1 ? "entry isn't" : "entries aren't"} on the statement.
            </span>{" "}
            <span className="text-fg-muted">Delete it, or keep it if it went through the other wallet.</span>
          </p>
          {disputed.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm" data-testid="disputed-row">
              <span className="num min-w-0 flex-1 truncate">
                {formatRs(t.amount)} · {txnTitle(t, l)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void enqueue("resolveDisputed", { txn_id: t.id, action: "keep_provisional" })}
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
            </div>
          ))}
        </section>
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
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="text-fg-muted">
        {filtered
          ? "No transactions match these filters."
          : "Generate a NayaPay or SadaPay statement — it'll appear here automatically. Or add one by hand."}
      </p>
      <Button variant="primary" onClick={() => openQuickAdd()}>
        Add a transaction
      </Button>
    </div>
  );
}

function clean(s: { [K in keyof ActivitySearch]?: ActivitySearch[K] | undefined }): ActivitySearch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== "") out[k] = v;
  return out as ActivitySearch;
}
