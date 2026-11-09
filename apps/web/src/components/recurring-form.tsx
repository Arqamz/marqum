import { type Dataset, parseRs } from "@marqum/core";
import type { AccountId, Recurring } from "@marqum/schema";
import { useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { kindFor, type RecurringKind } from "../lib/recurring.ts";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented } from "./ui/controls.tsx";
import { Field, Input, MoneyInput } from "./ui/input.tsx";

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
  const [kind, setKind] = useState<RecurringKind>(
    init.kind ?? kindFor(ds, init.category_id ?? parentCategory ?? null),
  );
  const a = parseRs(amount);
  const d = Math.min(31, Math.max(1, Number.parseInt(day, 10) || 1));
  const ok = Boolean(name.trim() && a);
  const subs = parent
    ? ds.categories.filter((c) => c.parent_id === parent.id).sort((x, y) => x.sort - y.sort)
    : [];
  const cats = [...ds.categories].sort(
    (x, y) => (x.parent_id ?? x.id).localeCompare(y.parent_id ?? y.id) || x.sort - y.sort,
  );

  return (
    <form
      className="flex flex-col gap-4"
      data-testid="recurring-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || !a) return;
        void enqueue("upsertRecurring", {
          recurring_id: recurring?.id ?? newId(),
          name: name.trim(),
          account_id: wallet,
          category_id: category,
          counterparty_id: recurring?.counterparty_id ?? draft?.counterparty_id ?? null,
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
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="iCloud, electricity…" />
      </Field>
      <Field label="Amount">
        <MoneyInput label="Amount" value={amount} onChange={setAmount} />
      </Field>
      <Segmented
        label="How often"
        value={cadence}
        onValueChange={setCadence}
        options={[
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
        ]}
      />
      <div className={cadence === "yearly" ? "grid grid-cols-2 gap-3" : "flex flex-col"}>
        {cadence === "yearly" ? (
          <Field label="Month">
            <select
              className="h-12 rounded-control border border-border bg-surface px-3"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Day of month">
          <Input
            inputMode="numeric"
            value={day}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
      </div>
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
          <fieldset className="flex flex-wrap gap-2" aria-label="Subcategory">
            <Chip selected={category === parent.id} onClick={() => setCategory(parent.id)}>
              {parent.name}
            </Chip>
            {subs.map((s) => (
              <Chip key={s.id} selected={category === s.id} onClick={() => setCategory(s.id)}>
                {s.name}
              </Chip>
            ))}
          </fieldset>
        ) : null
      ) : (
        <Field label="Category">
          <select
            className="h-12 rounded-control border border-border bg-surface px-3"
            value={category ?? ""}
            onChange={(e) => {
              setCategory(e.target.value || null);
              if (!recurring) setKind(kindFor(ds, e.target.value || null));
            }}
          >
            <option value="">None</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parent_id
                  ? `${ds.categories.find((p) => p.id === c.parent_id)?.name} › ${c.name}`
                  : c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="text-sm text-fg-muted">
        It shows as expected each {cadence === "yearly" ? "year" : "month"} and stays unverified until a
        statement shows the charge.
      </p>
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        {recurring
          ? "Save"
          : `Add ${kind === "subscription" ? "subscription" : kind === "bill" ? "bill" : "fixed charge"}`}
      </Button>
      {recurring ? (
        <Button
          variant="danger"
          onClick={() => {
            void enqueue("deleteRecurring", { recurring_id: recurring.id });
            onDone();
          }}
        >
          Delete
        </Button>
      ) : null}
    </form>
  );
}
