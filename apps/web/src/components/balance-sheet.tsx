import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
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
import { openQuickAdd } from "./quick-add.tsx";
import { Button } from "./ui/button.tsx";
import { ConfirmButton } from "./ui/confirm-button.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/**
 * "What does the bank app show right now?" Records the balance. A gap is missing transactions: "Save and add the
 * missing Rs X" opens quick-add with it. Moving the opening instead (only when it isn't from a statement) is a
 * separate, confirmed action, so a forgotten lunch never disappears into the opening.
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
  const typed = ds.balances
    .filter((b) => !b.deleted && b.account_id === account && b.source === "manual")
    .sort((a, b) => b.as_of.localeCompare(a.as_of))
    .slice(0, 5);
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
                  {`Unrecorded ${gap < 0 ? "spending" : "money in"}`}
                </Text>
              </>
            )}
          </HStack>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
          {paisa === null ? "Save balance" : `Save ${formatRs(paisa, { decimals: true })}`}
        </Button>
        {paisa !== null && gap !== 0 && account ? (
          <Button
            variant="secondary"
            onClick={() => {
              record();
              done();
              openQuickAdd({ amount: gap, account_id: account });
            }}
          >
            {`Save and add the missing ${off}`}
          </Button>
        ) : null}
        {canCorrect ? (
          <ConfirmButton
            label={`Change the ${startLabel} opening instead`}
            confirm={`Tap again: opening ${formatRs(opening.amount, { decimals: true })} → ${formatRs(nextOpening ?? 0, { decimals: true })}`}
            onConfirm={() => {
              record();
              if (account && nextOpening !== null)
                void enqueue("setOpeningBalance", { account_id: account, amount: nextOpening });
              done();
            }}
          />
        ) : null}
        {typed.length > 0 ? (
          <VStack gap={2} data-testid="typed-balances">
            <Text type="label">Balances you entered</Text>
            <List hasDividers density="compact" edge="outset">
              {typed.map((b) => (
                <ListItem
                  key={b.id}
                  label={formatRs(b.balance, { decimals: true })}
                  description={`${dayLabel(b.as_of.slice(0, 10))}, ${b.as_of.slice(11)}`}
                  endContent={
                    <ConfirmButton
                      size="sm"
                      width={null}
                      label="Remove"
                      confirm="Tap again"
                      onConfirm={() => void enqueue("deleteBalance", { entry_id: b.id })}
                    />
                  }
                />
              ))}
            </List>
          </VStack>
        ) : null}
      </VStack>
    </Sheet>
  );
}
