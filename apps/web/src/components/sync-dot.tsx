import { CloudOff, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../lib/store.ts";
import { syncNow, syncState } from "../lib/sync.ts";
import { usePendingCount } from "./dataset-provider.tsx";

/**
 * Sync state, shown only when it matters: offline, failed, or syncing for longer than 2 s.
 * A healthy, synced app shows nothing.
 */
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

  const waiting = pending > 0 ? ` · ${pending} change${pending === 1 ? "" : "s"} saved on this device` : "";
  let content: { label: string; icon: typeof CloudOff; tone: string; spin?: boolean } | null = null;
  if (s.status === "offline") content = { label: `Offline${waiting}`, icon: CloudOff, tone: "text-fg-muted" };
  else if (s.status === "error")
    content = {
      label: `Sync failed${s.message ? `: ${s.message}` : ""} — tap to retry`,
      icon: RefreshCw,
      tone: "text-warn",
    };
  else if (s.status === "syncing" && slow)
    content = { label: "Syncing", icon: LoaderCircle, tone: "text-fg-subtle", spin: true };

  return (
    <span data-testid="sync-state" data-status={s.status} className="contents">
      {content ? (
        <button
          type="button"
          onClick={() => void syncNow()}
          title={content.label}
          aria-label={content.label}
          className={`grid size-10 place-items-center rounded-full hover:bg-surface-2 ${content.tone}`}
        >
          <content.icon className={content.spin ? "motion-safe:animate-spin" : undefined} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
