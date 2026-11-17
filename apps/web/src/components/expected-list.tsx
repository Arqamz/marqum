import { Badge } from "@astryxdesign/core/Badge";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { type Dataset, dayLabel, type ExpectedCharge, formatRs } from "@marqum/core";
import type { Recurring } from "@marqum/schema";
import { Check, Repeat, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { cadenceLabel } from "../lib/recurring.ts";
import { RecurringForm } from "./recurring-form.tsx";
import { Sheet } from "./ui/sheet.tsx";

/**
 * Fixed charges expected in a month: dashed until paid; paid rows open the matching transaction, the rest open
 * the charge itself (edit or stop tracking it).
 */
export function ExpectedRows({
  charges,
  onOpenTxn,
  onOpenCharge,
}: {
  charges: ExpectedCharge[];
  onOpenTxn?: ((txnId: string) => void) | undefined;
  onOpenCharge?: ((r: Recurring) => void) | undefined;
}) {
  if (charges.length === 0) return null;
  return (
    <List edge="flush" data-testid="expected-rows">
      {charges.map((c) => {
        const paid = c.status === "paid" && c.matched_txn_id;
        const missed = c.status === "missed";
        const when =
          c.status === "paid"
            ? "Paid"
            : missed
              ? `Was due ${dayLabel(c.due_date)}`
              : `Expected · due ${dayLabel(c.due_date)}`;
        const open =
          paid && onOpenTxn
            ? () => onOpenTxn(c.matched_txn_id ?? "")
            : !paid && onOpenCharge
              ? () => onOpenCharge(c.recurring)
              : undefined;
        return (
          <ListItem
            key={`${c.recurring.id}-${c.due_date}`}
            data-testid="expected-row"
            data-status={c.status}
            className={cn(!paid && (missed ? "warm-outline" : "expected-outline"))}
            startContent={
              paid ? (
                <Check className="text-pos" aria-hidden />
              ) : missed ? (
                <TriangleAlert className="text-warn" aria-hidden />
              ) : (
                <Repeat className="text-fg-muted" aria-hidden />
              )
            }
            label={c.recurring.name}
            description={`${when} · ${cadenceLabel(c.recurring)}`}
            endContent={
              <HStack gap={2} vAlign="center">
                {missed ? <Badge variant="warning" label="Missed" /> : null}
                <Text hasTabularNumbers weight="medium" {...(paid ? {} : { color: "secondary" as const })}>
                  {formatRs(-c.amount)}
                </Text>
              </HStack>
            }
            {...(open ? { onClick: open } : {})}
          />
        );
      })}
    </List>
  );
}

/** Edit or stop tracking one fixed charge, from wherever its expected row shows. */
export function ChargeSheet({
  ds,
  charge,
  onClose,
}: {
  ds: Dataset;
  charge: Recurring | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={charge !== null}
      onOpenChange={(o) => !o && onClose()}
      title={charge?.name ?? ""}
      description="A fixed charge you track. Delete it to stop expecting it."
      purpose="form"
    >
      {charge ? <RecurringForm key={charge.id} ds={ds} recurring={charge} onDone={onClose} /> : null}
    </Sheet>
  );
}
