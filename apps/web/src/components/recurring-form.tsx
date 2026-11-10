import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { type Dataset, formatRs, parseRs } from "@marqum/core";
import type { AccountId, Recurring } from "@marqum/schema";
import { useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import {
  fillPreset,
  kindFor,
  type RecurringKind,
  SUBSCRIPTION_PRESETS,
  type SubscriptionPreset,
} from "../lib/recurring.ts";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented } from "./ui/controls.tsx";
import { MoneyInput } from "./ui/input.tsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface RecurringDraft {
  name?: string;
  amount?: number;
  day_of_month?: number;
  account_id?: AccountId;
  category_id?: string | null;
  counterparty_id?: string | null;
  cadence?: Recurring["cadence"];
  month_of_year?: number | null;
  kind?: RecurringKind;
}

/**
 * Add or edit a fixed charge (subscription, bill, anything recurring). Used from a category, from Plan and for
 * detected candidates. `parentCategory` limits the category choice to that category and its subcategories.
 * New subscriptions start from a quick pick (Spotify, Netflix…) filled in from your last matching charge.
 */
export function RecurringForm({
  ds,
  recurring,
  draft,
  parentCategory,
  onDone,
}: {
  ds: Dataset;
  recurring?: Recurring | undefined;
  draft?: RecurringDraft | undefined;
  parentCategory?: string | undefined;
  onDone: () => void;
}) {
  const init = { ...draft, ...recurring };
  const [name, setName] = useState(init.name ?? "");
  const [amount, setAmount] = useState(init.amount ? String(Math.abs(init.amount) / 100) : "");
  const [cadence, setCadence] = useState<Recurring["cadence"]>(init.cadence ?? "monthly");
  const [month, setMonth] = useState(init.month_of_year ?? Number(new Date().getMonth() + 1));
  const [day, setDay] = useState(String(init.day_of_month ?? 1));
  const parent = parentCategory ? ds.categories.find((c) => c.id === parentCategory) : undefined;
  const [wallet, setWallet] = useState<AccountId>(init.account_id ?? parent?.wallet_hint ?? "sadapay");
  const [category, setCategory] = useState<string | null>(init.category_id ?? parentCategory ?? null);
  const [counterparty, setCounterparty] = useState<string | null>(init.counterparty_id ?? null);
  const [kind, setKind] = useState<RecurringKind>(
    init.kind ?? kindFor(ds, init.category_id ?? parentCategory ?? null),
  );
  const [preset, setPreset] = useState<string | null>(null);
  const a = parseRs(amount);
  const d = Math.min(31, Math.max(1, Number.parseInt(day, 10) || 1));
  const ok = Boolean(name.trim() && a);
  const subs = parent
    ? ds.categories.filter((c) => c.parent_id === parent.id && !c.hidden).sort((x, y) => x.sort - y.sort)
    : [];
  const cats = [...ds.categories]
    .filter((c) => !c.deleted && (!c.hidden || c.id === category))
    .sort((x, y) => (x.parent_id ?? x.id).localeCompare(y.parent_id ?? y.id) || x.sort - y.sort);
  const names = new Map(ds.categories.map((c) => [c.id, c.name]));

  // quick picks: only for a new charge, not ones you already track
  const tracked = new Set(
    ds.recurring.filter((r) => !r.deleted && r.active).map((r) => r.name.toLowerCase()),
  );
  const showPresets = !recurring && (!parent || parent.id === "subscriptions" || kind === "subscription");
  const presets = SUBSCRIPTION_PRESETS.filter((p) => !tracked.has(p.name.toLowerCase()));

  function pick(p: SubscriptionPreset) {
    const f = fillPreset(ds, p);
    setPreset(p.name);
    setName(f.name);
    setCategory(f.category_id);
    setKind("subscription");
    setCadence(f.cadence);
    if (f.amount) setAmount(String(f.amount / 100));
    if (f.day_of_month) setDay(String(f.day_of_month));
    if (f.month_of_year) setMonth(f.month_of_year);
    if (f.account_id) setWallet(f.account_id);
    setCounterparty(f.counterparty_id ?? null);
  }

  return (
    <VStack
      as="form"
      gap={4}
      data-testid="recurring-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || !a) return;
        void enqueue("upsertRecurring", {
          recurring_id: recurring?.id ?? newId(),
          name: name.trim(),
          account_id: wallet,
          category_id: category,
          counterparty_id: counterparty,
          amount: Math.abs(a),
          day_of_month: d,
          active: true,
          cadence,
          month_of_year: cadence === "yearly" ? month : null,
          kind,
        });
        onDone();
      }}
    >
      {showPresets && presets.length > 0 ? (
        <VStack gap={2} data-testid="subscription-presets">
          <Text type="label">Quick pick</Text>
          <HStack gap={2} wrap="wrap">
            {presets.map((p) => (
              <Chip key={p.name} selected={preset === p.name} onClick={() => pick(p)}>
                {p.name}
              </Chip>
            ))}
          </HStack>
          {preset && a ? (
            <Text type="supporting">
              From your last charge: {formatRs(a)} on day {d}
            </Text>
          ) : null}
        </VStack>
      ) : null}
      <TextInput label="Name" value={name} onChange={setName} placeholder="Spotify, electricity…" />
      <MoneyInput label="Amount" value={amount} onChange={setAmount} />
      <Segmented
        label="How often"
        value={cadence}
        onValueChange={setCadence}
        options={[
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
        ]}
      />
      <HStack gap={3}>
        {cadence === "yearly" ? (
          <StackItem size="fill">
            <Selector
              label="Month"
              value={String(month)}
              onChange={(v) => setMonth(Number(v))}
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              presentation="adaptive"
              width="100%"
            />
          </StackItem>
        ) : null}
        <StackItem size="fill">
          <TextInput
            label="Day of month"
            inputMode="numeric"
            value={day}
            onChange={(v) => setDay(v.replace(/\D/g, ""))}
            width="100%"
          />
        </StackItem>
      </HStack>
      <Segmented
        label="Wallet"
        value={wallet}
        onValueChange={setWallet}
        options={[
          { value: "sadapay", label: "SadaPay" },
          { value: "nayapay", label: "NayaPay" },
        ]}
      />
      <Segmented
        label="Kind"
        value={kind}
        onValueChange={setKind}
        options={[
          { value: "subscription", label: "Subscription" },
          { value: "bill", label: "Bill" },
          { value: "other", label: "Other" },
        ]}
      />
      {parent ? (
        subs.length > 0 ? (
          <VStack gap={2}>
            <Text type="label">Type</Text>
            <HStack as="fieldset" gap={2} wrap="wrap" aria-label="Subcategory">
              <Chip selected={category === parent.id} onClick={() => setCategory(parent.id)}>
                {parent.name}
              </Chip>
              {subs.map((s) => (
                <Chip key={s.id} selected={category === s.id} onClick={() => setCategory(s.id)}>
                  {s.name}
                </Chip>
              ))}
            </HStack>
          </VStack>
        ) : null
      ) : (
        <Selector
          label="Category"
          value={category ?? ""}
          hasSearch
          presentation="adaptive"
          onChange={(v) => {
            const id = v || null;
            setCategory(id);
            if (!recurring) setKind(kindFor(ds, id));
          }}
          options={[
            { value: "", label: "None" },
            ...cats.map((c) => ({
              value: c.id,
              label: c.parent_id ? `${names.get(c.parent_id) ?? ""} › ${c.name}` : c.name,
            })),
          ]}
          width="100%"
        />
      )}
      <Button type="submit" variant="primary" size="lg" disabled={!ok} width="full">
        {recurring
          ? "Save"
          : `Add ${kind === "subscription" ? "subscription" : kind === "bill" ? "bill" : "fixed charge"}`}
      </Button>
      {recurring ? (
        <Button
          variant="danger"
          width="full"
          onClick={() => {
            void enqueue("deleteRecurring", { recurring_id: recurring.id });
            onDone();
          }}
        >
          Delete
        </Button>
      ) : null}
    </VStack>
  );
}
