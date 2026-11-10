import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { type Dataset, formatRs, karachiNow, parseRs } from "@marqum/core";
import type { AccountId, Category } from "@marqum/schema";
import { type FormEvent, useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { RecurringForm } from "./recurring-form.tsx";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented } from "./ui/controls.tsx";
import { Input, MoneyInput } from "./ui/input.tsx";
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
        <VStack gap={5} data-testid="add-to-category">
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
        </VStack>
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
    <VStack
      as="form"
      gap={4}
      onSubmit={(e: FormEvent) => {
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
      <Grid columns={2} gap={3} align="end">
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
      </Grid>
      <TextInput label="Reason" value={reason} onChange={setReason} placeholder="What for?" isOptional />
      {subs.length > 0 ? (
        <HStack as="fieldset" gap={2} wrap="wrap" aria-label="Subcategory">
          <Chip selected={sub === category.id} onClick={() => setSub(category.id)}>
            {category.name}
          </Chip>
          {subs.map((s) => (
            <Chip key={s.id} selected={sub === s.id} onClick={() => setSub(s.id)}>
              {s.name}
            </Chip>
          ))}
        </HStack>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!paisa}>
        {paisa ? `Add ${formatRs(Math.abs(paisa))}` : "Add transaction"}
      </Button>
    </VStack>
  );
}
