import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { CloudOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../lib/store.ts";
import { syncNow, syncState } from "../lib/sync.ts";
import { usePendingCount } from "./dataset-provider.tsx";
import { Button } from "./ui/button.tsx";

/** Sync state, shown only when it matters: offline, failed, or syncing for over 2 s. Healthy shows nothing. */
export function SyncDot() {
  const s = useStore(syncState);
  const pending = usePendingCount();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (s.status !== "syncing") {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 2000);
    return () => clearTimeout(t);
  }, [s.status]);

  const waiting = pending > 0 ? ` · ${pending} unsynced` : "";
  let dot: { label: string; variant: "neutral" | "warning" | "accent"; icon: typeof CloudOff } | null = null;
  if (s.status === "offline") dot = { label: `Offline${waiting}`, variant: "neutral", icon: CloudOff };
  else if (s.status === "error")
    dot = {
      label: `Sync failed${s.message ? `: ${s.message}` : ""} — tap to retry`,
      variant: "warning",
      icon: RefreshCw,
    };
  else if (s.status === "syncing" && slow) dot = { label: "Syncing", variant: "accent", icon: LoaderCircle };

  return (
    <HStack data-testid="sync-state" data-status={s.status} vAlign="center">
      {dot ? (
        <Button variant="ghost" size="icon" label={dot.label} onClick={() => void syncNow()}>
          <StatusDot
            variant={dot.variant}
            label={dot.label}
            isPulsing={s.status === "syncing"}
            icon={<dot.icon aria-hidden />}
          />
        </Button>
      ) : null}
    </HStack>
  );
}
