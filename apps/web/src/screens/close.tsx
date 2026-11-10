import { Badge } from "@astryxdesign/core/Badge";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type ChecklistItem,
  type CloseChecklist,
  closeChecklist,
  type Dataset,
  dayLabel,
  isClosed,
  monthLabel,
  monthOf,
  monthsToClose,
} from "@marqum/core";
import { API } from "@marqum/schema";
import { useRouter } from "@tanstack/react-router";
import { Check, ChevronRight, CircleAlert, Lock, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Chip, Skeleton } from "../components/ui/controls.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { api } from "../lib/api.ts";
import { enqueue } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import { reminderMonth } from "../lib/reminders.ts";
import { stepUp } from "../lib/stepup.ts";
import { isTracked, trackedMonthsUpTo } from "../lib/tracking.ts";

export function CloseScreen({ month }: { month?: string }) {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen>
      {ds ? (
        <CloseContent
          ds={ds}
          now={now}
          month={month && isTracked(ds, month) ? month : defaultMonth(ds, now)}
        />
      ) : (
        <VStack gap={3}>
          <Skeleton width="66%" height={32} />
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={48} index={i} />
          ))}
        </VStack>
      )}
    </Screen>
  );
}

function defaultMonth(ds: Dataset, now: string): string {
  return monthsToClose(ds, now)[0] ?? reminderMonth(ds, now) ?? monthOf(now);
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
  const months = trackedMonthsUpTo(ds, now).slice(-6);
  const blocking = checklist.items.filter((i) => !i.ok && i.severity === "block");

  return (
    <>
      {months.length > 1 ? (
        <HStack gap={2} wrap="wrap">
          {months.map((m) => (
            <Chip
              key={m}
              selected={m === month}
              onClick={() => void router.navigate({ to: "/close", search: { month: m } })}
              {...(isClosed(ds, m) ? { icon: <Lock aria-hidden /> } : {})}
            >
              {monthLabel(m)}
            </Chip>
          ))}
        </HStack>
      ) : null}

      {closed ? (
        <VStack gap={4} hAlign="center" data-testid="sealed">
          <motion.span
            initial={reduce ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="grid size-16 place-items-center rounded-full bg-pos-soft text-pos"
          >
            <Check aria-hidden />
          </motion.span>
          <VStack gap={2} hAlign="center">
            <Heading level={1} textWrap="balance" justify="center">
              {monthName(month)} is closed
            </Heading>
            <Badge
              variant={record?.closed_at ? "success" : "info"}
              label={record?.closed_at ? `Sealed ${dayLabel(record.closed_at.slice(0, 10))}` : "Sealing"}
              icon={<Lock aria-hidden />}
            />
          </VStack>
          {record?.snapshot_sha256 ? (
            <Text type="code" color="secondary" maxLines={1}>
              sha256 {record.snapshot_sha256}
            </Text>
          ) : null}
          <HStack gap={2}>
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
          </HStack>
        </VStack>
      ) : (
        <>
          <VStack gap={2} hAlign="start">
            <Heading level={1} textWrap="balance">
              {checklist.can_close
                ? `${monthName(month)} is ready to close`
                : `${blocking.length} ${blocking.length === 1 ? "thing" : "things"} before ${monthName(month)} can close`}
            </Heading>
            {checklist.can_close ? (
              <Text type="supporting">Closing seals a snapshot you can't change.</Text>
            ) : (
              <Badge variant="neutral" label={`Closable from ${dayLabel(checklist.closable_from)}`} />
            )}
          </VStack>
          <Section>
            <List hasDividers edge="flush" data-testid="checklist">
              {checklist.items.map((item) => (
                <ChecklistRow key={item.id} item={item} onFix={(a) => router.history.push(routeFor(a))} />
              ))}
            </List>
          </Section>
          <VStack className="sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)] lg:bottom-6">
            <Button
              width="full"
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
          </VStack>
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
  const fix = !item.ok && item.action ? item.action : null;
  return (
    <ListItem
      align="first-line"
      startContent={
        <Icon
          className={tone}
          aria-label={item.ok ? "Done" : item.severity === "warn" ? "Warning" : "To do"}
        />
      }
      label={<Text {...(item.ok ? { color: "secondary" as const } : {})}>{keepRs(item.label)}</Text>}
      {...(item.detail ? { description: <Text type="supporting">{item.detail}</Text> } : {})}
      {...(fix
        ? { endContent: <ChevronRight className="text-fg-subtle" aria-hidden />, onClick: () => onFix(fix) }
        : {})}
    />
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
      description="Logged; the next close writes a new snapshot."
    >
      <VStack
        as="form"
        gap={4}
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 3) return;
          const token = await stepUp(`Reopen ${monthName(month)}`);
          if (!token) return;
          await enqueue("reopenMonth", { month, reason: reason.trim() });
          onOpenChange(false);
        }}
      >
        <TextInput label="Why" value={reason} onChange={setReason} placeholder="Re-issued statement" />
        <Button type="submit" variant="primary" size="lg" disabled={reason.trim().length < 3}>
          Confirm and reopen
        </Button>
      </VStack>
    </Sheet>
  );
}
