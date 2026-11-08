import { cn } from "../lib/cn.ts";
import { useStore } from "../lib/store.ts";
import { syncNow, syncState } from "../lib/sync.ts";
import { usePendingCount } from "./dataset-provider.tsx";

/** Quiet status: green synced, pulsing neutral while syncing, amber offline (changes kept), red on error. */
export function SyncDot() {
  const s = useStore(syncState);
  const pending = usePendingCount();
  const label =
    s.status === "syncing"
      ? "Syncing"
      : s.status === "offline"
        ? `Offline${pending ? ` · ${pending} change${pending === 1 ? "" : "s"} waiting` : ""}`
        : s.status === "error"
          ? `Sync failed${s.message ? `: ${s.message}` : ""} — tap to retry`
          : pending > 0
            ? `${pending} change${pending === 1 ? "" : "s"} waiting`
            : "Synced";
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={label}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full"
      data-testid="sync-dot"
      data-status={s.status}
    >
      <span
        className={cn(
          "size-2 rounded-full",
          s.status === "synced" && pending === 0 && "bg-pos",
          (s.status === "syncing" || s.status === "idle" || (s.status === "synced" && pending > 0)) &&
            "bg-fg-subtle motion-safe:animate-pulse",
          s.status === "offline" && "bg-warn",
          s.status === "error" && "bg-neg",
        )}
      />
    </button>
  );
}
