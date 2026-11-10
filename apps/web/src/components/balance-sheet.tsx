import {
  balanceAt,
  type Dataset,
  dayLabel,
  formatRs,
  karachiNow,
  openingInfo,
  openingToMatch,
  parseRs,
  trackingStart,
} from "@marqum/core";
import type { AccountId } from "@marqum/schema";
import { useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { Button } from "./ui/button.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/**
 * "What does the bank app show right now?" Records the balance and, when the opening wasn't taken from a
 * statement, offers to correct the opening so Marqūm matches the bank exactly. With a statement opening the
 * gap can only be missing transactions, so it's recorded and shown as unaccounted instead.
 */
export function BalanceSheet({
  ds,
  account,
  onClose,
}: {
  ds: Dataset;
  account: AccountId | null;
  onClose: () => void;
}) {
  const name = ds.accounts.find((a) => a.id === account)?.name ?? "";
  const [v, setV] = useState("");
  const paisa = parseRs(v);
  const at = karachiNow();
  const ours = account ? balanceAt(ds, account, at) : 0;
  const opening = account ? openingInfo(ds, account) : { amount: 0, source: "none" as const };
  const gap = paisa === null ? 0 : paisa - ours;
  const nextOpening = account && paisa !== null ? openingToMatch(ds, account, paisa, at) : null;
  const canCorrect = opening.source !== "statement" && gap !== 0 && nextOpening !== null;
  const startLabel = dayLabel(trackingStart(ds));

  const record = () => {
    if (!account || paisa === null) return;
    void enqueue("recordBalance", { entry_id: newId(), account_id: account, balance: paisa, as_of: at });
  };
  const done = () => {
    setV("");
    onClose();
  };

  return (
    <Sheet
      open={account !== null}
      onOpenChange={(o) => !o && done()}
      title={`${name} balance right now`}
      description={`Open ${name} and type the balance it shows. Marqūm has ${formatRs(ours, { decimals: true })}.`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (paisa === null) return;
          record();
          if (canCorrect && account && nextOpening !== null)
            void enqueue("setOpeningBalance", { account_id: account, amount: nextOpening });
          done();
        }}
      >
        <MoneyInput label="Balance in the bank app" value={v} onChange={setV} autoFocus />
        {paisa !== null ? (
          <p className="num text-sm text-fg-muted" data-testid="balance-gap">
            {gap === 0
              ? "Matches Marqūm exactly."
              : canCorrect
                ? `Off by ${formatRs(Math.abs(gap), { decimals: true })}. The ${startLabel} opening becomes ${formatRs(nextOpening ?? 0, { decimals: true })} (now ${formatRs(opening.amount, { decimals: true })}); every transaction stays as it is.`
                : `Off by ${formatRs(Math.abs(gap), { decimals: true })}. ${name}'s opening comes from its statement, so the gap is ${gap < 0 ? "spending" : "money in"} that isn't recorded yet — it shows as unaccounted until a statement or entry covers it.`}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
          {canCorrect
            ? `Match — set opening to ${formatRs(nextOpening ?? 0, { decimals: true })}`
            : "Save balance"}
        </Button>
        {canCorrect ? (
          <Button
            variant="ghost"
            onClick={() => {
              record();
              done();
            }}
          >
            Only save the balance
          </Button>
        ) : null}
      </form>
    </Sheet>
  );
}
