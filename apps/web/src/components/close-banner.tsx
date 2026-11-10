import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/VStack";
import { closeChecklist, type Dataset, isClosed, monthOf, monthsToClose, numericSetting } from "@marqum/core";
import { useMemo, useState } from "react";
import { monthName } from "../lib/months.ts";
import { isTracked } from "../lib/tracking.ts";
import { CloseSheet } from "../screens/close.tsx";
import { Button } from "./ui/button.tsx";

/** The month that needs closing now, if any: an older unclosed month (overdue), else this one from the 25th. */
export function closeTarget(ds: Dataset, now: string): { month: string; overdue: boolean } | null {
  const overdue = monthsToClose(ds, now)[0];
  if (overdue) return { month: overdue, overdue: true };
  const month = monthOf(now);
  const from = numericSetting(ds, "close_reminder_day") || 25;
  if (Number(now.slice(8, 10)) >= from && isTracked(ds, month) && !isClosed(ds, month))
    return { month, overdue: false };
  return null;
}

/** Compact "Close <month>" banner; opens the close flow in a sheet. Renders nothing when nothing needs closing. */
export function CloseBanner({ ds, now }: { ds: Dataset | undefined; now: string }) {
  const target = useMemo(() => (ds ? closeTarget(ds, now) : null), [ds, now]);
  // The month the sheet was opened for: keeps it up (sealed state) after the banner itself goes away.
  const [opened, setOpened] = useState<string | null>(null);
  const toCheck = useMemo(
    () => (ds && target ? closeChecklist(ds, target.month, now).items.filter((i) => !i.ok).length : 0),
    [ds, target, now],
  );
  if (!ds) return null;
  return (
    <>
      {target ? (
        <VStack data-testid="close-banner">
          <Banner
            status={target.overdue ? "warning" : "info"}
            title={`Close ${monthName(target.month)}`}
            description={toCheck > 0 ? `${toCheck} to check` : "Ready to seal"}
            endContent={
              <Button size="sm" variant="secondary" onClick={() => setOpened(target.month)}>
                Close
              </Button>
            }
          />
        </VStack>
      ) : null}
      {opened ? (
        <CloseSheet
          ds={ds}
          now={now}
          month={opened}
          open
          onOpenChange={(o) => {
            if (!o) setOpened(null);
          }}
        />
      ) : null}
    </>
  );
}
