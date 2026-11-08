import { counterpartyStats, type Dataset, formatRs, isClosed } from "@marqum/core";
import type { Counterparty } from "@marqum/schema";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CategoryPicker } from "../components/category-picker.tsx";
import { PatternStrip, SentReceived } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton } from "../components/ui/controls.tsx";
import { Field, Input } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { enqueue } from "../lib/commands.ts";
import { categoryPath, lookup } from "../lib/view.ts";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

export function CounterpartyScreen({ id }: { id: string }) {
  const ds = useDataset();
  const now = useNow();
  const cp = ds?.counterparties.find((c) => c.id === id);
  return (
    <Screen back {...(cp ? { title: cp.name } : {})}>
      {ds && cp ? (
        <CounterpartyContent ds={ds} now={now} cp={cp} />
      ) : ds ? (
        <Headline>That person or merchant was merged or removed.</Headline>
      ) : (
        <Skeleton className="h-48 rounded-card" />
      )}
    </Screen>
  );
}

function cadence(days: number | null): string | null {
  if (days === null) return null;
  if (days <= 1.5) return "almost daily";
  if (days < 10) return `every ${Math.round(days)} days`;
  if (days < 20) return "every couple of weeks";
  if (days < 40) return "about monthly";
  return `every ${Math.round(days / 30)} months`;
}

function peak(values: number[], labels: string[]): string | null {
  const max = Math.max(...values);
  if (max <= 0) return null;
  return labels[values.indexOf(max)] ?? null;
}

function CounterpartyContent({ ds, now, cp }: { ds: Dataset; now: string; cp: Counterparty }) {
  const stats = useMemo(() => counterpartyStats(ds, cp.id, now), [ds, cp.id, now]);
  const l = useMemo(() => lookup(ds), [ds]);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const txns = useMemo(() => ds.transactions.filter((t) => t.counterparty_id === cp.id), [ds, cp.id]);
  const often = cadence(stats.avg_interval_days);
  const day = peak(stats.weekday, WEEKDAYS);
  const hour = peak(stats.hour, HOURS);

  const headline =
    stats.total_sent >= stats.total_received
      ? `${formatRs(stats.total_sent)} sent to ${cp.name} over ${stats.count} payments`
      : `${formatRs(stats.total_received)} received from ${cp.name} over ${stats.count} payments`;
  const sub = [
    stats.typical_amount ? `usually ${formatRs(stats.typical_amount)}` : null,
    often,
    day && hour ? `mostly ${day}s around ${hour}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Headline sub={sub || undefined}>{headline}</Headline>

      <dl className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-fg-muted">Sent</dt>
          <dd>
            <Money value={stats.total_sent} className="text-xl font-medium" />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-fg-muted">Received</dt>
          <dd>
            <Money value={stats.total_received} className="text-xl font-medium" />
          </dd>
        </div>
      </dl>

      <Section title="By month">
        <SentReceived data={stats.series} />
      </Section>

      <Section title="When">
        <PatternStrip values={stats.weekday} labels={WEEKDAYS} label="Payments by weekday" />
        <PatternStrip values={stats.hour} labels={HOURS} label="Payments by hour" />
      </Section>

      {stats.categories.length > 0 ? (
        <Section title="Tagged as">
          <ul className="flex flex-col gap-2">
            {stats.categories.map((c) => (
              <li key={c.category_id ?? "none"} className="flex justify-between text-sm">
                {c.category_id ? (
                  <Link
                    to="/category/$id"
                    params={{ id: c.category_id.split(".")[0] ?? c.category_id }}
                    className="hover:underline"
                  >
                    {categoryPath(c.category_id, l)}
                  </Link>
                ) : (
                  <span className="text-fg-muted">Untagged</span>
                )}
                <Money value={c.total} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEdit(true)}>
          Rename, merge or set a default
        </Button>
      </div>

      <Section title="Transactions">
        <TxnList
          txns={txns}
          l={l}
          now={now}
          onOpen={(t) => setOpen(t.id)}
          isClosedMonth={(m) => isClosed(ds, m)}
        />
      </Section>

      <TagSheet txn={open ? (txns.find((t) => t.id === open) ?? null) : null} onClose={() => setOpen(null)} />
      <EditCounterparty ds={ds} cp={cp} open={edit} onOpenChange={setEdit} />
    </>
  );
}

function EditCounterparty({
  ds,
  cp,
  open,
  onOpenChange,
}: {
  ds: Dataset;
  cp: Counterparty;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(cp.name);
  const [kind, setKind] = useState(cp.kind);
  const [category, setCategory] = useState<string | null>(cp.default_category_id);
  const [merge, setMerge] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const others = ds.counterparties
    .filter((c) => c.id !== cp.id && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 8);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Edit ${cp.name}`}>
      <form
        className="flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void enqueue("upsertCounterparty", {
            counterparty_id: cp.id,
            name: name.trim() || cp.name,
            kind,
            aliases: cp.aliases,
            default_category_id: category,
            default_flow: cp.default_flow,
          });
          if (merge.length > 0) void enqueue("mergeCounterparties", { into_id: cp.id, from_ids: merge });
          onOpenChange(false);
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Segmented
          label="Kind"
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "person", label: "Person" },
            { value: "merchant", label: "Merchant" },
            { value: "family", label: "Family" },
            { value: "self", label: "Me" },
          ]}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Default category for new payments</span>
          <CategoryPicker ds={ds} value={category} onChange={setCategory} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Same person, different spelling? Merge into {cp.name}</span>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find"
            aria-label="Find to merge"
          />
          <ul className="flex flex-col">
            {others.map((o) => (
              <li key={o.id}>
                <label className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--accent)]"
                    checked={merge.includes(o.id)}
                    onChange={(e) =>
                      setMerge((m) => (e.target.checked ? [...m, o.id] : m.filter((x) => x !== o.id)))
                    }
                  />
                  {o.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <Button type="submit" variant="primary" size="lg">
          {merge.length > 0 ? `Save and merge ${merge.length}` : "Save"}
        </Button>
      </form>
    </Sheet>
  );
}
