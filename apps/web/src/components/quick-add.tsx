import { HStack } from "@astryxdesign/core/HStack";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { classify, type Dataset, formatRs, karachiNow, parseRs } from "@marqum/core";
import type { AccountId } from "@marqum/schema";
import { useEffect, useMemo, useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { createStore, useStore } from "../lib/store.ts";
import { CategoryPicker } from "./category-picker.tsx";
import { useDataset } from "./dataset-provider.tsx";
import { Button } from "./ui/button.tsx";
import { Segmented } from "./ui/controls.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

export interface QuickAddPreset {
  amount?: number; // signed paisa
  account_id?: AccountId;
  reason?: string;
}
export const quickAdd = createStore<QuickAddPreset | null>(null);
export const openQuickAdd = (preset: QuickAddPreset = {}) => quickAdd.set(preset);

/** Manual entry → provisional ("warm") transaction until a statement verifies it. */
export function QuickAddHost() {
  const preset = useStore(quickAdd);
  const ds = useDataset();
  return (
    <Sheet open={preset !== null} onOpenChange={(o) => !o && quickAdd.set(null)} title="Add a transaction">
      {preset && ds ? <QuickAddForm ds={ds} preset={preset} onDone={() => quickAdd.set(null)} /> : null}
    </Sheet>
  );
}

function QuickAddForm({ ds, preset, onDone }: { ds: Dataset; preset: QuickAddPreset; onDone: () => void }) {
  const [direction, setDirection] = useState<"out" | "in">((preset.amount ?? -1) > 0 ? "in" : "out");
  const [amount, setAmount] = useState(preset.amount ? String(Math.abs(preset.amount) / 100) : "");
  const [account, setAccount] = useState<AccountId>(preset.account_id ?? "nayapay");
  const [reason, setReason] = useState(preset.reason ?? "");
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const paisa = parseRs(amount);
  const signed = paisa === null ? 0 : direction === "out" ? -Math.abs(paisa) : Math.abs(paisa);
  const suggestion = useMemo(
    () =>
      classify(ds, {
        account_id: account,
        amount: signed || -1,
        description: "",
        reason: reason || null,
        bank_type: null,
      }),
    [ds, account, signed, reason],
  );
  useEffect(() => {
    if (!picked) setCategory(suggestion.category_id);
  }, [picked, suggestion.category_id]);

  return (
    <VStack
      as="form"
      gap={6}
      onSubmit={(e) => {
        e.preventDefault();
        if (!signed) return;
        void enqueue("addProvisional", {
          txn_id: newId(),
          account_id: account,
          occurred_at: karachiNow(),
          amount: signed,
          reason: reason.trim() || null,
          category_id: direction === "out" ? category : null,
          flow:
            direction === "out"
              ? suggestion.flow === "spend" || suggestion.flow === "fee"
                ? suggestion.flow
                : "spend"
              : null,
          counterparty_name: null,
        });
        onDone();
      }}
    >
      <VStack gap={3}>
        <MoneyInput label="Amount" value={amount} onChange={setAmount} autoFocus />
        <HStack gap={2} wrap="wrap">
          <Segmented
            label="Direction"
            value={direction}
            onValueChange={setDirection}
            options={[
              { value: "out", label: "Spent" },
              { value: "in", label: "Received" },
            ]}
          />
          <Segmented
            label="Wallet"
            value={account}
            onValueChange={setAccount}
            options={ds.accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </HStack>
      </VStack>
      <TextInput label="Reason" value={reason} onChange={setReason} placeholder="Petrol, lunch with Ali…" />
      {direction === "out" ? (
        <CategoryPicker
          ds={ds}
          value={category}
          suggested={suggestion.category_id}
          onChange={(id) => {
            setPicked(true);
            setCategory(id);
          }}
        />
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!signed}>
        {signed ? `Add ${formatRs(Math.abs(signed))}` : "Add transaction"}
      </Button>
    </VStack>
  );
}
