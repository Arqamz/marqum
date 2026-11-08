import {
  addMonths,
  type ChecklistItem,
  type CloseChecklist,
  closeChecklist,
  type Dataset,
  dayLabel,
  isClosed,
  monthLabel,
  monthOf,
} from "@marqum/core";
import { API } from "@marqum/schema";
import { useRouter } from "@tanstack/react-router";
import { Check, ChevronRight, CircleAlert, Lock, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Chip, Skeleton } from "../components/ui/controls.tsx";
import { Field, Input } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import { reminderMonth } from "../lib/reminders.ts";
import { stepUp } from "../lib/stepup.ts";

export function CloseScreen({ month }: { month?: string }) {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen>
      {ds ? (
        <CloseContent ds={ds} now={now} month={month ?? defaultMonth(ds, now)} />
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/3" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      )}
    </Screen>
  );
}

function defaultMonth(ds: Dataset, now: string): string {
  const r = reminderMonth(ds, now);
  if (r) return r;
  const prev = addMonths(monthOf(now), -1);
  return isClosed(ds, prev) ? monthOf(now) : prev;
}

/** Core routes → this app's routes. */
function routeFor(action: string): string {
  if (action.startsWith("/statements")) return action.replace("/statements", "/import");
  if (action.startsWith("/plan/")) return "/plan";
  return action;
}

function useServerChecklist(month: string, closed: boolean): CloseChecklist | null {
  const [server, setServer] = useState<CloseChecklist | null>(null);
  useEffect(() => {
    let live = true;
    setServer(null);
    if (closed) return;
    api<CloseChecklist>(API.closeCheck.replace(":month", month))
      .then((c) => live && setServer(c))
      .catch(() => undefined); // offline: the local checklist stands in
    return () => {
      live = false;
    };
  }, [month, closed]);
  return server;
}

function CloseContent({ ds, now, month }: { ds: Dataset; now: string; month: string }) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const closed = isClosed(ds, month);
  const local = useMemo(() => closeChecklist(ds, month, now), [ds, month, now]);
  const server = useServerChecklist(month, closed);
  // Local first (instant, reflects queued fixes); the server's verdict wins when it is stricter.
  const checklist = server && !server.can_close ? server : local;
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [reopen, setReopen] = useState(false);
  const [closing, setClosing] = useState(false);
  const record = ds.months.find((m) => m.id === month);
  const months = [
    addMonths(monthOf(now), -3),
    addMonths(monthOf(now), -2),
    addMonths(monthOf(now), -1),
    monthOf(now),
  ];
  const blocking = checklist.items.filter((i) => !i.ok && i.severity === "block");

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {months.map((m) => (
          <Chip
            key={m}
            selected={m === month}
            onClick={() => void router.navigate({ to: "/close", search: { month: m } })}
          >
            {isClosed(ds, m) ? <Lock aria-hidden /> : null}
            {monthLabel(m)}
          </Chip>
        ))}
      </div>

      {closed ? (
        <section className="flex flex-col items-center gap-4 py-8 text-center" data-testid="sealed">
          <motion.span
            initial={reduce ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="grid size-16 place-items-center rounded-full bg-pos-soft text-pos"
          >
            <Check aria-hidden />
          </motion.span>
          <Headline
            sub={
              record?.closed_at
                ? `Sealed ${dayLabel(record.closed_at.slice(0, 10))} · read-only; retagging asks for your fingerprint`
                : "Sealing — the snapshot is written when this syncs"
            }
          >
            {monthName(month)} is closed
          </Headline>
          {record?.snapshot_sha256 ? (
            <p className="font-mono text-xs break-all text-fg-muted">sha256 {record.snapshot_sha256}</p>
          ) : null}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={!record?.snapshot_key}
              onClick={async () => {
                const json = await api<unknown>(API.snapshot.replace(":month", month));
                setSnapshot(JSON.stringify(json, null, 2));
              }}
            >
              View snapshot
            </Button>
            <Button variant="danger" onClick={() => setReopen(true)}>
              Reopen
            </Button>
          </div>
        </section>
      ) : (
        <>
          <Headline
            sub={
              checklist.can_close
                ? "Everything checks out. Closing seals a snapshot you can't change."
                : `Close from ${dayLabel(checklist.closable_from)} once these are done.`
            }
          >
            {checklist.can_close
              ? `${monthName(month)} is ready to close`
              : `${blocking.length} ${blocking.length === 1 ? "thing" : "things"} before ${monthName(month)} can close`}
          </Headline>
          <Section>
            <ul className="-mx-3 flex flex-col" data-testid="checklist">
              {checklist.items.map((item) => (
                <ChecklistRow key={item.id} item={item} onFix={(a) => router.history.push(routeFor(a))} />
              ))}
            </ul>
          </Section>
          <div className="sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+var(--spacing)*4)] lg:bottom-6">
            <Button
              className="w-full"
              variant="primary"
              size="lg"
              disabled={!checklist.can_close}
              loading={closing}
              onClick={async () => {
                setClosing(true);
                try {
                  await enqueue("closeMonth", { month });
                } finally {
                  setClosing(false);
                }
              }}
            >
              Close {monthName(month)}
            </Button>
          </div>
        </>
      )}

      <Sheet
        open={snapshot !== null}
        onOpenChange={(o) => !o && setSnapshot(null)}
        title={`${monthLabel(month)} snapshot`}
      >
        <pre className="overflow-x-auto rounded-inner bg-surface-2 p-3 font-mono text-xs">{snapshot}</pre>
      </Sheet>
      <ReopenSheet month={month} open={reopen} onOpenChange={setReopen} />
    </>
  );
}

/** Never break "Rs" from its figure. */
const keepRs = (s: string): string => s.replace(/Rs /g, "Rs\u00a0");

function ChecklistRow({ item, onFix }: { item: ChecklistItem; onFix: (action: string) => void }) {
  const Icon = item.ok ? Check : item.severity === "warn" ? CircleAlert : X;
  const tone = item.ok ? "text-pos" : item.severity === "warn" ? "text-warn" : "text-neg";
  const body = (
    <>
      <Icon
        className={cn("mt-0.5 shrink-0", tone)}
        aria-label={item.ok ? "Done" : item.severity === "warn" ? "Warning" : "To do"}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={cn(item.ok && "text-fg-muted")}>{keepRs(item.label)}</span>
        {item.detail ? <span className="text-sm text-fg-muted">{item.detail}</span> : null}
      </span>
      {!item.ok && item.action ? (
        <ChevronRight className="mt-0.5 shrink-0 text-fg-subtle" aria-hidden />
      ) : null}
    </>
  );
  return (
    <li>
      {!item.ok && item.action ? (
        <button
          type="button"
          onClick={() => item.action && onFix(item.action)}
          className="flex w-full items-start gap-3 rounded-control px-3 py-3 text-left hover:bg-surface-2"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-3 py-3">{body}</div>
      )}
    </li>
  );
}

function ReopenSheet({
  month,
  open,
  onOpenChange,
}: {
  month: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Reopen ${monthName(month)}?`}
      description="Reopening is logged and the next close writes a new snapshot version."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return;
          const token = await stepUp(`Reopen ${monthName(month)}`);
          if (!token) return;
          await enqueue("reopenMonth", { month, reason: reason.trim() });
          onOpenChange(false);
        }}
      >
        <Field label="Why">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Re-issued statement"
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={reason.trim().length < 3}>
          Confirm and reopen
        </Button>
      </form>
    </Sheet>
  );
}
