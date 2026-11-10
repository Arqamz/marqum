import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
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
 * "What does the bank app show right now?" Records the balance; when the opening isn't from a statement, offers
 * to move the opening so Marqūm matches exactly. Otherwise the gap is missing transactions (shown as unaccounted).
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

  const off = formatRs(Math.abs(gap), { decimals: true });
  return (
    <Sheet
      open={account !== null}
      onOpenChange={(o) => !o && done()}
      title={`${name} balance`}
      description={`Marqūm: ${formatRs(ours, { decimals: true })}`}
    >
      <VStack
        as="form"
        gap={4}
        onSubmit={(e) => {
          e.preventDefault();
          if (paisa === null) return;
          record();
          if (canCorrect && account && nextOpening !== null)
            void enqueue("setOpeningBalance", { account_id: account, amount: nextOpening });
          done();
        }}
      >
        <MoneyInput label={`${name} app shows`} value={v} onChange={setV} autoFocus />
        {paisa !== null ? (
          <HStack gap={2} vAlign="center" wrap="wrap" data-testid="balance-gap">
            {gap === 0 ? (
              <Badge variant="success" label="Matches" />
            ) : (
              <>
                <Badge variant="warning" label={`Off by ${off}`} />
                <Text type="supporting" hasTabularNumbers>
                  {canCorrect
                    ? `${startLabel} opening ${formatRs(opening.amount, { decimals: true })} → ${formatRs(nextOpening ?? 0, { decimals: true })}`
                    : `Unrecorded ${gap < 0 ? "spending" : "money in"}`}
                </Text>
              </>
            )}
          </HStack>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
          {canCorrect ? "Match the bank" : "Save balance"}
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
      </VStack>
    </Sheet>
  );
}
