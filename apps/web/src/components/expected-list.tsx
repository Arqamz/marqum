import { dayLabel, type ExpectedCharge, formatRs } from "@marqum/core";
import { Check, Repeat, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn.ts";
import { cadenceLabel } from "../lib/recurring.ts";

/**
 * Fixed charges expected in a month, drawn like warm rows (dashed) until a transaction pays them.
 * Paid → small check, tap opens the matched transaction. Missed → amber.
 */
export function ExpectedRows({
  charges,
  onOpenTxn,
}: {
  charges: ExpectedCharge[];
  onOpenTxn?: ((txnId: string) => void) | undefined;
}) {
  if (charges.length === 0) return null;
  return (
    <ul className="-mx-3 flex flex-col gap-1" data-testid="expected-rows">
      {charges.map((c) => {
        const paid = c.status === "paid" && c.matched_txn_id;
        const missed = c.status === "missed";
        const label =
          c.status === "paid"
            ? "Paid"
            : missed
              ? `Missed · was due ${dayLabel(c.due_date)}`
              : `Expected · due ${dayLabel(c.due_date)}`;
        const body = (
          <>
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-full bg-surface-2",
                paid ? "text-pos" : missed ? "text-warn" : "text-fg-muted",
              )}
            >
              {paid ? <Check aria-hidden /> : missed ? <TriangleAlert aria-hidden /> : <Repeat aria-hidden />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{c.recurring.name}</span>
              <span className={cn("truncate text-sm", missed ? "text-warn" : "text-fg-muted")}>
                {label} · {cadenceLabel(c.recurring)}
              </span>
            </span>
            <span className={cn("num shrink-0 font-medium", !paid && "text-fg-muted")}>
              {formatRs(-c.amount)}
            </span>
          </>
        );
        const cls = cn(
          "relative flex w-full items-center gap-3 rounded-control px-3 py-3 text-left",
          !paid && (missed ? "warm-outline" : "expected-outline"),
        );
        return (
          <li key={`${c.recurring.id}-${c.due_date}`} data-testid="expected-row" data-status={c.status}>
            {paid && onOpenTxn ? (
              <button
                type="button"
                className={cn(cls, "hover:bg-surface-2")}
                onClick={() => onOpenTxn(c.matched_txn_id ?? "")}
              >
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
