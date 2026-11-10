import { Card } from "@astryxdesign/core/Card";
import { CheckboxList, CheckboxListItem } from "@astryxdesign/core/CheckboxList";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { counterpartyStats, type Dataset, formatRs, isClosed } from "@marqum/core";
import type { Counterparty } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { Pencil, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { CategoryPicker } from "../components/category-picker.tsx";
import { PatternStrip, SentReceived } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton } from "../components/ui/controls.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { enqueue } from "../lib/commands.ts";
import { opt } from "../lib/opt.ts";
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
        <Headline>Merged or removed</Headline>
      ) : (
        <Skeleton height={192} />
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
  const navigate = useNavigate();
  const stats = useMemo(() => counterpartyStats(ds, cp.id, now), [ds, cp.id, now]);
  const l = useMemo(() => lookup(ds), [ds]);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const txns = useMemo(() => ds.transactions.filter((t) => t.counterparty_id === cp.id), [ds, cp.id]);
  const often = cadence(stats.avg_interval_days);
  const day = peak(stats.weekday, WEEKDAYS);
  const hour = peak(stats.hour, HOURS);

  const sentMore = stats.total_sent >= stats.total_received;
  const sub = [
    `${stats.count} payments`,
    stats.typical_amount ? `usually ${formatRs(stats.typical_amount)}` : null,
    often,
    day && hour ? `${day} ~${hour}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Headline sub={sub}>
        {formatRs(sentMore ? stats.total_sent : stats.total_received)} {sentMore ? "sent" : "received"}
      </Headline>

      <Grid columns={2} gap={3}>
        <Card padding={4}>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Sent
            </Text>
            <Money value={stats.total_sent} className="text-xl font-medium" />
          </VStack>
        </Card>
        <Card padding={4}>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Received
            </Text>
            <Money
              value={stats.total_received}
              className="text-xl font-medium"
              {...opt({ tone: stats.total_received > 0 ? ("pos" as const) : undefined })}
            />
          </VStack>
        </Card>
      </Grid>

      <Section title="By month">
        <SentReceived data={stats.series} />
      </Section>

      <Section title="When">
        <PatternStrip values={stats.weekday} labels={WEEKDAYS} label="Payments by weekday" />
        <PatternStrip values={stats.hour} labels={HOURS} label="Payments by hour" />
      </Section>

      {stats.categories.length > 0 ? (
        <Section title="Tagged as">
          <List edge="flush" density="compact">
            {stats.categories.map((c) => {
              const top = c.category_id ? (c.category_id.split(".")[0] ?? c.category_id) : null;
              return (
                <ListItem
                  key={c.category_id ?? "none"}
                  label={c.category_id ? (categoryPath(c.category_id, l) ?? c.category_id) : "Untagged"}
                  endContent={<Money value={c.total} />}
                  {...opt({
                    onClick: top
                      ? () => void navigate({ to: "/category/$id", params: { id: top } })
                      : undefined,
                  })}
                />
              );
            })}
          </List>
        </Section>
      ) : null}

      <HStack>
        <Button variant="secondary" icon={<Pencil aria-hidden />} onClick={() => setEdit(true)}>
          Edit
        </Button>
      </HStack>

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
      <VStack
        as="form"
        gap={5}
        onSubmit={(e: FormEvent) => {
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
        <TextInput label="Name" value={name} onChange={setName} />
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
        <VStack gap={2}>
          <Text type="label">Default category</Text>
          <CategoryPicker ds={ds} value={category} onChange={setCategory} />
        </VStack>
        <VStack gap={2}>
          <TextInput
            type="search"
            label={`Merge into ${cp.name}`}
            placeholder="Find"
            startIcon={Search}
            value={q}
            onChange={setQ}
          />
          {others.length > 0 ? (
            <CheckboxList label="Merge" isLabelHidden value={merge} onChange={setMerge}>
              {others.map((o) => (
                <CheckboxListItem key={o.id} value={o.id} label={o.name} />
              ))}
            </CheckboxList>
          ) : null}
        </VStack>
        <Button type="submit" variant="primary" size="lg">
          {merge.length > 0 ? `Save and merge ${merge.length}` : "Save"}
        </Button>
      </VStack>
    </Sheet>
  );
}
