import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { type Dataset, dayLabel } from "@marqum/core";
import { type DeletedRow, restoreRow } from "../lib/restore.ts";
import { lookup, timeOf, txnTitle } from "../lib/view.ts";
import { Money } from "./money.tsx";
import { Button } from "./ui/button.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Deleted unverified rows with Restore. A row that has since turned up on a statement says so instead. */
export function DeletedList({ ds, rows, inset }: { ds: Dataset; rows: DeletedRow[]; inset?: boolean }) {
  const l = lookup(ds);
  return (
    <List
      hasDividers
      {...(inset ? { density: "compact" as const } : { edge: "outset" as const })}
      data-testid="deleted-list"
    >
      {rows.map(({ txn, twin }) => (
        <ListItem
          key={txn.id}
          label={txnTitle(txn, l)}
          description={
            twin
              ? `${dayLabel(txn.occurred_at.slice(0, 10))} · on the statement ${dayLabel(twin.occurred_at.slice(0, 10))}`
              : `${dayLabel(txn.occurred_at.slice(0, 10))}, ${timeOf(txn.occurred_at)} · ${l.account.get(txn.account_id) ?? ""}`
          }
          endContent={
            <HStack gap={3} vAlign="center">
              <Money value={Math.abs(txn.amount)} {...(txn.amount > 0 ? { tone: "pos" as const } : {})} />
              {twin ? null : (
                <Button variant="secondary" size="sm" onClick={() => void restoreRow(txn)}>
                  Restore
                </Button>
              )}
            </HStack>
          }
        />
      ))}
    </List>
  );
}

export function DeletedSheet({
  ds,
  rows,
  open,
  onClose,
}: {
  ds: Dataset;
  rows: DeletedRow[];
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={rows.length === 1 ? "1 deleted row" : `${rows.length} deleted rows`}
      description="Unverified rows you deleted. Restored rows wait for the next statement to verify them."
    >
      {rows.length === 0 ? (
        <Text color="secondary">Nothing deleted.</Text>
      ) : (
        <VStack gap={2}>
          <DeletedList ds={ds} rows={rows} />
        </VStack>
      )}
    </Sheet>
  );
}
