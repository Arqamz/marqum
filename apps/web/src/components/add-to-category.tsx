import { type Dataset, formatRs, karachiNow, parseRs } from "@marqum/core";
import type { AccountId, Category } from "@marqum/schema";
import { useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { RecurringForm } from "./recurring-form.tsx";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented } from "./ui/controls.tsx";
import { Field, Input, MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Category › Add: a one-off transaction, or a subscription/bill that repeats. */
export function AddToCategorySheet({
  ds,
  category,
  open,
  onOpenChange,
}: {
  ds: Dataset;
  category: Category;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [what, setWhat] = useState<"txn" | "recurring">("txn");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Add to ${category.name}`}>
      {open ? (
        <div className="flex flex-col gap-6" data-testid="add-to-category">
          <Segmented
            label="What to add"
            value={what}
            onValueChange={setWhat}
            options={[
              { value: "txn", label: "Transaction" },
              { value: "recurring", label: "Subscription or bill" },
            ]}
          />
          {what === "txn" ? (
            <TxnForm ds={ds} category={category} onDone={() => onOpenChange(false)} />
          ) : (
            <RecurringForm ds={ds} parentCategory={category.id} onDone={() => onOpenChange(false)} />
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

function TxnForm({ ds, category, onDone }: { ds: Dataset; category: Category; onDone: () => void }) {
  const now = karachiNow();
  const [amount, setAmount] = useState("");
  const [wallet, setWallet] = useState<AccountId>(category.wallet_hint ?? "nayapay");
  const [date, setDate] = useState(now.slice(0, 10));
  const [reason, setReason] = useState("");
  const [sub, setSub] = useState(category.id);
  const subs = ds.categories.filter((c) => c.parent_id === category.id).sort((a, b) => a.sort - b.sort);
  const paisa = parseRs(amount);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!paisa) return;
        void enqueue("addProvisional", {
          txn_id: newId(),
          account_id: wallet,
          occurred_at: date === now.slice(0, 10) ? now : `${date}T12:00`,
          amount: -Math.abs(paisa),
          reason: reason.trim() || null,
          category_id: sub,
          flow: "spend",
          counterparty_name: null,
        });
        onDone();
      }}
    >
      <MoneyInput label="Amount" value={amount} onChange={setAmount} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <Segmented
          label="Wallet"
          value={wallet}
          onValueChange={setWallet}
          options={ds.accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
        <Input
          type="date"
          aria-label="Date"
          value={date}
          max={now.slice(0, 10)}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      <Field label="Reason">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What was it for?" />
      </Field>
      {subs.length > 0 ? (
        <fieldset className="flex flex-wrap gap-2" aria-label="Subcategory">
          <Chip selected={sub === category.id} onClick={() => setSub(category.id)}>
            {category.name}
          </Chip>
          {subs.map((s) => (
            <Chip key={s.id} selected={sub === s.id} onClick={() => setSub(s.id)}>
              {s.name}
            </Chip>
          ))}
        </fieldset>
      ) : null}
      <p className="text-sm text-fg-muted">Stays unverified until a statement shows it.</p>
      <Button type="submit" variant="primary" size="lg" disabled={!paisa}>
        {paisa ? `Add ${formatRs(Math.abs(paisa))}` : "Add transaction"}
      </Button>
    </form>
  );
}
