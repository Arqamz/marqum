import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addMonths,
  type Dataset,
  dayLabel,
  describeRule,
  formatRs,
  karachiNow,
  monthLabel,
  monthLedger,
  monthOf,
  netPosition,
  openingInfo,
  parseRs,
  setting,
} from "@marqum/core";
import type { AccountId, NotificationIngest } from "@marqum/schema";
import { API } from "@marqum/schema";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Trash2, TriangleAlert } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { BalanceSheet } from "../components/balance-sheet.tsx";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { openQuickAdd } from "../components/quick-add.tsx";
import { Headline, Screen } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton, Switch } from "../components/ui/controls.tsx";
import { Field, Input, MoneyInput } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { api } from "../lib/api.ts";
import { auth } from "../lib/auth.ts";
import { enqueue, newId } from "../lib/commands.ts";
import { opt } from "../lib/opt.ts";
import { isNative } from "../lib/platform.ts";
import { biometricEnrolled, enrolBiometric, registerPasskey, stepUp } from "../lib/stepup.ts";
import { reloadFromServer, resetLocalData } from "../lib/sync.ts";
import { toast } from "../lib/toast.ts";
import { firstTrackedMonth, testRunNote } from "../lib/tracking.ts";
import { lookup } from "../lib/view.ts";
import { MarqumNative } from "../native/marqum-native.ts";

declare const __APP_VERSION__: string;

export function SettingsScreen() {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen>
      <Headline>Settings</Headline>
      {ds ? <SettingsContent ds={ds} now={now} /> : <Skeleton height={256} />}
    </Screen>
  );
}

/** A settings group: heading, then a card of divided rows. */
function Group({ title, children, after }: { title: string; children: ReactNode; after?: ReactNode }) {
  return (
    <VStack as="section" gap={3}>
      <Heading level={2}>{title}</Heading>
      <Card>
        <List hasDividers edge="bleed">
          {children}
        </List>
      </Card>
      {after}
    </VStack>
  );
}

const chevron = <Icon icon="chevronRight" color="secondary" size="sm" />;
const on = <Badge label="On" variant="success" />;

const OPENING_LABEL = {
  statement: "From statement",
  you: "Set by you",
  none: "Not set",
} as const;

function SettingsContent({ ds, now }: { ds: Dataset; now: string }) {
  const navigate = useNavigate();
  const np = useMemo(() => netPosition(ds, now), [ds, now]);
  const [balanceFor, setBalanceFor] = useState<AccountId | null>(null);
  const [rules, setRules] = useState(false);
  const [openingFor, setOpeningFor] = useState<AccountId | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const firstMonth = firstTrackedMonth(ds);
  const testRun = testRunNote(ds);
  const openings = useMemo(() => {
    const out: Partial<Record<AccountId, number>> = {};
    for (const a of ds.accounts) out[a.id] = monthLedger(ds, a.id, firstMonth, now).brought_forward;
    return out;
  }, [ds, firstMonth, now]);
  const windowSetting = setting(ds, "avg_window") === "3" ? "3" : "6";

  return (
    <>
      <VStack as="section" gap={3}>
        <Heading level={2}>Averages</Heading>
        <Segmented
          label="Average over"
          value={windowSetting}
          onValueChange={(v) => void enqueue("setSetting", { key: "avg_window", value: v })}
          options={[
            { value: "6", label: "6 months" },
            { value: "3", label: "3 months" },
          ]}
        />
      </VStack>

      <Group title="Wallets">
        {np.wallets.flatMap((w) => {
          const source = openingInfo(ds, w.account_id).source;
          const rows = [
            <ListItem
              key={`${w.account_id}-balance`}
              label={w.name}
              description={
                w.verified_until ? `Verified to ${dayLabel(w.verified_until)}` : "No statement yet"
              }
              endContent={<Money value={w.balance} className="font-medium" />}
              onClick={() => setBalanceFor(w.account_id)}
            />,
            <ListItem
              key={`${w.account_id}-opening`}
              label={
                <Text type="supporting" maxLines={1}>
                  Opening balance, 1 {monthLabel(firstMonth)}
                </Text>
              }
              description={OPENING_LABEL[source]}
              endContent={
                <HStack gap={1} vAlign="center">
                  <Money value={openings[w.account_id] ?? 0} className="text-sm text-fg-muted" />
                  {source === "statement" ? null : chevron}
                </HStack>
              }
              {...opt({ onClick: source === "statement" ? undefined : () => setOpeningFor(w.account_id) })}
            />,
          ];
          if (w.unaccounted !== 0)
            rows.push(
              <ListItem
                key={`${w.account_id}-unaccounted`}
                label={
                  <Text weight="medium" className="text-warn">
                    {formatRs(Math.abs(w.unaccounted))} unaccounted
                  </Text>
                }
                startContent={<Icon icon={TriangleAlert} color="warning" size="sm" />}
                endContent={<Text color="accent">Add</Text>}
                onClick={() => openQuickAdd({ amount: w.unaccounted, account_id: w.account_id })}
              />,
            );
          return rows;
        })}
      </Group>

      <Group title="Categories">
        <ListItem
          label="Categories and rules"
          description={`${ds.categories.filter((c) => c.parent_id === null && !c.hidden).length} categories · ${ds.rules.length} rules`}
          endContent={chevron}
          onClick={() => setRules(true)}
        />
      </Group>

      <SecuritySection />
      {isNative() ? <PermissionsSection /> : null}
      <DevicesSection />

      <Group
        title="Data"
        after={
          <VStack gap={1}>
            <AppVersion />
            {testRun ? <Text type="supporting">{testRun}</Text> : null}
          </VStack>
        }
      >
        <ListItem label="Export as JSON" endContent={chevron} onClick={() => void exportAll()} />
        <ListItem
          label="Statements and imports"
          endContent={chevron}
          onClick={() => void navigate({ to: "/import" })}
        />
        <ListItem
          label="Reload from the server"
          description="Unsent changes are kept"
          onClick={async () => {
            await reloadFromServer();
            toast({ tone: "neutral", title: "Reloaded from the server" });
          }}
        />
        <ListItem
          label="Sign out of this device"
          onClick={async () => {
            await auth.logout();
            await resetLocalData();
          }}
        />
      </Group>

      <Group title="Danger zone">
        <ListItem
          label={<Text className="text-neg">Reset ledger…</Text>}
          description="Start tracking from a new date"
          endContent={chevron}
          onClick={() => setResetOpen(true)}
        />
      </Group>

      <BalanceSheet ds={ds} account={balanceFor} onClose={() => setBalanceFor(null)} />
      <OpeningSheet ds={ds} account={openingFor} month={firstMonth} onClose={() => setOpeningFor(null)} />
      <ResetSheet now={now} open={resetOpen} onOpenChange={setResetOpen} />
      <RulesSheet ds={ds} open={rules} onOpenChange={setRules} />
    </>
  );
}

async function exportAll(): Promise<void> {
  try {
    const data = await api<unknown>(API.exportAll);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `marqum-export-${karachiNow().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  } catch (e) {
    toast({ tone: "error", title: "Export failed", detail: e instanceof Error ? e.message : String(e) });
  }
}

function AppVersion() {
  const [version, setVersion] = useState(typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "");
  useEffect(() => {
    if (isNative())
      void MarqumNative.getAppInfo()
        .then((i) => setVersion(`${i.versionName} (${i.versionCode})`))
        .catch(() => undefined);
  }, []);
  return (
    <Text type="supporting" hasTabularNumbers>
      Marqūm {version}
    </Text>
  );
}

function SecuritySection() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  useEffect(() => {
    void biometricEnrolled().then(setEnrolled);
  }, []);
  return (
    <Group title="Security">
      {isNative() ? (
        <ListItem
          label="Fingerprint"
          description="Confirms closed-month edits"
          endContent={enrolled ? on : chevron}
          onClick={async () => {
            try {
              if (await enrolBiometric()) setEnrolled(true);
            } catch (e) {
              toast({
                tone: "error",
                title: "Fingerprint setup failed",
                detail: e instanceof Error ? e.message : "",
              });
            }
          }}
        />
      ) : (
        <ListItem
          label="Add a passkey"
          description="Confirms closed-month edits"
          endContent={chevron}
          onClick={async () => {
            try {
              if (await registerPasskey()) toast({ tone: "success", title: "Passkey added" });
            } catch (e) {
              toast({
                tone: "error",
                title: "Passkey setup failed",
                detail: e instanceof Error ? e.message : "",
              });
            }
          }}
        />
      )}
    </Group>
  );
}

function PermissionsSection() {
  const [files, setFiles] = useState<boolean | null>(null);
  const [notifs, setNotifs] = useState<boolean | null>(null);
  const [heard, setHeard] = useState<(NotificationIngest & { sent: boolean })[]>([]);
  const [showHeard, setShowHeard] = useState(false);
  const refresh = () => {
    void MarqumNative.checkFileAccess()
      .then((r) => setFiles(r.granted))
      .catch(() => setFiles(false));
    void MarqumNative.checkNotificationAccess()
      .then((r) => setNotifs(r.granted))
      .catch(() => setNotifs(false));
  };
  useEffect(refresh, []);
  return (
    <Group title="Hands-free">
      <ListItem
        label="Statement inbox"
        description={files ? "Downloads import themselves" : "Needs file access"}
        endContent={files ? on : chevron}
        {...opt({ onClick: files ? undefined : () => void MarqumNative.requestFileAccess().then(refresh) })}
      />
      <ListItem
        label="Bank notifications"
        description={notifs ? "Payments log within seconds" : "Needs notification access"}
        endContent={notifs ? on : chevron}
        {...opt({
          onClick: notifs ? undefined : () => void MarqumNative.requestNotificationAccess().then(refresh),
        })}
      />
      <ListItem
        label="Notifications the app heard"
        endContent={chevron}
        onClick={() => {
          setShowHeard(true);
          void MarqumNative.getCapturedNotifications({ limit: 50 }).then((r) => setHeard(r.items));
        }}
      />
      <Sheet open={showHeard} onOpenChange={setShowHeard} title="Notifications the app heard">
        {heard.length === 0 ? (
          <EmptyState title="Nothing yet" icon={<Bell aria-hidden />} isCompact />
        ) : (
          <List hasDividers>
            {heard.map((n) => (
              <ListItem
                key={n.id}
                label={n.title}
                description={
                  <VStack gap={0.5}>
                    <Text type="supporting" hasTabularNumbers>
                      {n.package.includes("nayapay") ? "NayaPay" : "SadaPay"} ·{" "}
                      {dayLabel(n.posted_at.slice(0, 10))} {n.posted_at.slice(11)}
                    </Text>
                    <Text type="code" color="secondary">
                      {n.text}
                    </Text>
                  </VStack>
                }
                align="start"
                endContent={
                  <Badge label={n.sent ? "sent" : "queued"} variant={n.sent ? "neutral" : "warning"} />
                }
              />
            ))}
          </List>
        )}
      </Sheet>
    </Group>
  );
}

type Device = { id: string; name: string; last_seen: string | null; current?: boolean };

const isTemporary = (d: Device) => /temporary/i.test(d.name);

const fetchDevices = () => api<Device[]>(API.devices).catch((): Device[] => []);

function DevicesSection() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => void fetchDevices().then(setDevices);
  useEffect(load, []);
  const me = auth.get();
  const myId = me.status === "signed-in" ? me.session.device_id : "";
  const mine = (d: Device) => d.id === myId || d.current === true;
  const remove = async (key: string, list: Device[]) => {
    setBusy(key);
    try {
      for (const d of list) await api(`${API.devices}/${d.id}`, { method: "DELETE" });
      setDevices((cur) => cur?.filter((d) => !list.some((x) => x.id === d.id)) ?? cur);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't remove", detail: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(null);
      load();
    }
  };
  if (devices === null)
    return (
      <VStack as="section" gap={3}>
        <Heading level={2}>Devices</Heading>
        <Skeleton height={48} />
      </VStack>
    );
  if (devices.length === 0)
    return (
      <VStack as="section" gap={3}>
        <Heading level={2}>Devices</Heading>
        <Text type="supporting">Unavailable offline</Text>
      </VStack>
    );
  const temporary = devices.filter((d) => isTemporary(d) && !mine(d));
  return (
    <Group
      title="Devices"
      {...opt({
        after:
          temporary.length > 1 ? (
            <HStack>
              <Button
                variant="secondary"
                loading={busy === "temporary"}
                onClick={() => void remove("temporary", temporary)}
              >
                Remove {temporary.length} temporary
              </Button>
            </HStack>
          ) : undefined,
      })}
    >
      {devices.map((d) => (
        <ListItem
          key={d.id}
          label={d.name}
          {...opt({
            description:
              !mine(d) && d.last_seen ? `Last seen ${dayLabel(d.last_seen.slice(0, 10))}` : undefined,
          })}
          endContent={
            mine(d) ? (
              <Badge label="This device" variant="info" />
            ) : (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Sign out ${d.name}`}
                loading={busy === d.id}
                onClick={() => void remove(d.id, [d])}
              >
                <Trash2 aria-hidden />
              </Button>
            )
          }
        />
      ))}
    </Group>
  );
}

function RulesSheet({
  ds,
  open,
  onOpenChange,
}: {
  ds: Dataset;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const l = lookup(ds);
  const [pattern, setPattern] = useState("");
  const [category, setCategory] = useState("");
  const tops = ds.categories.filter((c) => c.parent_id === null).sort((a, b) => a.sort - b.sort);
  const options = ds.categories
    .slice()
    .sort((a, b) => (a.parent_id ?? a.id).localeCompare(b.parent_id ?? b.id) || a.sort - b.sort)
    .map((c) => ({
      value: c.id,
      label: c.parent_id ? `${l.category.get(c.parent_id)?.name} › ${c.name}` : c.name,
    }));
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Categories and rules">
      <VStack gap={8}>
        <VStack as="section" gap={2}>
          <Heading level={3}>Categories</Heading>
          <Text type="supporting">Off = hidden from Home until used</Text>
          <List hasDividers density="compact">
            {tops.map((c) => (
              <ListItem
                key={c.id}
                label={c.name}
                startContent={<CategoryIcon name={c.icon} className="text-fg-muted" />}
                endContent={
                  <Switch
                    label={`Show ${c.name}`}
                    checked={!c.hidden}
                    onCheckedChange={(show) =>
                      void enqueue("upsertCategory", {
                        category_id: c.id,
                        parent_id: c.parent_id,
                        name: c.name,
                        icon: c.icon,
                        wallet_hint: c.wallet_hint,
                        nature: c.nature,
                        hidden: !show,
                        sort: c.sort,
                      })
                    }
                  />
                }
              />
            ))}
          </List>
        </VStack>
        <VStack as="section" gap={2}>
          <Heading level={3}>Rules</Heading>
          <VStack
            as="form"
            gap={2}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!pattern.trim() || !category) return;
              void enqueue("upsertRule", {
                rule_id: newId(),
                pattern: pattern.trim(),
                category_id: category,
                flow: null,
                counterparty_id: null,
                priority: 1000,
              });
              setPattern("");
            }}
          >
            <HStack gap={2} vAlign="end">
              <StackItem size="fill">
                <TextInput
                  label="Text matches"
                  value={pattern}
                  onChange={setPattern}
                  placeholder="gym|creatine"
                  controlClassName="font-mono"
                  width="100%"
                />
              </StackItem>
              <StackItem size="fill">
                <Selector
                  label="Tag as"
                  placeholder="Category"
                  options={options}
                  value={category}
                  onChange={(v) => setCategory(v)}
                  hasSearch
                  presentation="adaptive"
                  width="100%"
                />
              </StackItem>
            </HStack>
            <Button type="submit" variant="secondary" disabled={!pattern.trim() || !category}>
              Add rule
            </Button>
          </VStack>
          <List hasDividers density="compact">
            {[...ds.rules]
              .sort((a, b) => b.priority - a.priority)
              .map((r) => (
                <ListItem
                  key={r.id}
                  label={describeRule(r.pattern)}
                  {...opt({
                    description: r.category_id
                      ? (l.category.get(r.category_id)?.name ?? r.category_id)
                      : (r.flow ?? undefined),
                  })}
                  endContent={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete rule"
                      onClick={() => void enqueue("deleteRule", { rule_id: r.id })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  }
                />
              ))}
          </List>
        </VStack>
      </VStack>
    </Sheet>
  );
}

function OpeningSheet({
  ds,
  account,
  month,
  onClose,
}: {
  ds: Dataset;
  account: AccountId | null;
  month: string;
  onClose: () => void;
}) {
  const name = ds.accounts.find((a) => a.id === account)?.name ?? "";
  const [v, setV] = useState("");
  const paisa = parseRs(v);
  return (
    <Sheet
      open={account !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`${name} opening balance`}
      description={`Held on 1 ${monthLabel(month)}, when tracking started.`}
      purpose="form"
    >
      <VStack
        as="form"
        gap={5}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!account || paisa === null) return;
          void enqueue("setOpeningBalance", { account_id: account, amount: paisa });
          setV("");
          onClose();
        }}
      >
        <MoneyInput label="Opening balance" value={v} onChange={setV} autoFocus />
        <Button type="submit" variant="primary" size="lg" width="full" disabled={paisa === null}>
          Set opening balance
        </Button>
      </VStack>
    </Sheet>
  );
}

function ResetSheet({
  now,
  open,
  onOpenChange,
}: {
  now: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [start, setStart] = useState(`${addMonths(monthOf(now), 1)}-01`);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^\d{4}-\d{2}-01$/.test(start) && typed === "RESET";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Reset the ledger?"
      description="Deletes transactions, statements, balances and closed months on every device. Categories, rules, fixed charges, loans, goals and settings stay."
      purpose="form"
    >
      <VStack
        as="form"
        gap={5}
        onSubmit={async (e: FormEvent) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          try {
            const token = await stepUp("Reset the ledger");
            if (!token) return;
            await enqueue("resetLedger", { tracking_start: start, confirm: "RESET" });
            onOpenChange(false);
            setTyped("");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Track from">
          <Input
            type="month"
            value={start.slice(0, 7)}
            onChange={(e) => e.target.value && setStart(`${e.target.value}-01`)}
          />
        </Field>
        <TextInput
          label="Type RESET to confirm"
          value={typed}
          onChange={(v) => setTyped(v.trim())}
          autoCapitalize="characters"
          autoComplete="off"
          controlClassName="font-mono"
          width="100%"
        />
        <Button type="submit" variant="danger" size="lg" width="full" disabled={!valid} loading={busy}>
          Reset and track from {dayLabel(start)} {start.slice(0, 4)}
        </Button>
      </VStack>
    </Sheet>
  );
}
