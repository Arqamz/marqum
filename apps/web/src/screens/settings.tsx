import {
  addMonths,
  type Dataset,
  dayLabel,
  formatRs,
  karachiNow,
  monthLabel,
  monthLedger,
  monthOf,
  netPosition,
  parseRs,
  setting,
} from "@marqum/core";
import type { AccountId, NotificationIngest } from "@marqum/schema";
import { API } from "@marqum/schema";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { openQuickAdd } from "../components/quick-add.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton, Switch } from "../components/ui/controls.tsx";
import { Field, Input, MoneyInput } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { api } from "../lib/api.ts";
import { auth } from "../lib/auth.ts";
import { enqueue, newId } from "../lib/commands.ts";
import { isNative } from "../lib/platform.ts";
import { biometricEnrolled, enrolBiometric, registerPasskey, stepUp } from "../lib/stepup.ts";
import { resetLocalData } from "../lib/sync.ts";
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
      {ds ? <SettingsContent ds={ds} now={now} /> : <Skeleton className="h-64 rounded-card" />}
    </Screen>
  );
}

function Row({ children, onClick }: { children: ReactNode; onClick?: (() => void) | undefined }) {
  const cls = "flex min-h-12 w-full items-center justify-between gap-4 rounded-control px-3 py-2 text-left";
  return onClick ? (
    <button type="button" className={`${cls} hover:bg-surface-2`} onClick={onClick}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

function SettingsContent({ ds, now }: { ds: Dataset; now: string }) {
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
      <Section title="Averages">
        <Segmented
          label="Average over"
          value={windowSetting}
          onValueChange={(v) => void enqueue("setSetting", { key: "avg_window", value: v })}
          options={[
            { value: "6", label: "Last 6 months" },
            { value: "3", label: "Last 3 months" },
          ]}
        />
      </Section>

      <Section title="Wallet balances">
        <div className="-mx-3 flex flex-col">
          {np.wallets.map((w) => (
            <div key={w.account_id} className="flex flex-col">
              <Row onClick={() => setBalanceFor(w.account_id)}>
                <span className="flex flex-col">
                  <span>{w.name}</span>
                  <span className="text-sm text-fg-muted">
                    {w.verified_until ? `verified to ${dayLabel(w.verified_until)}` : "no statement yet"}
                  </span>
                </span>
                <Money value={w.balance} className="font-medium" />
              </Row>
              <Row onClick={() => setOpeningFor(w.account_id)}>
                <span className="text-sm text-fg-muted">Opening balance, 1 {monthLabel(firstMonth)}</span>
                <span className="flex items-center gap-2 text-sm text-fg-muted">
                  <Money value={openings[w.account_id] ?? 0} />
                  <ChevronRight className="text-fg-subtle" aria-label="Set opening balance" />
                </span>
              </Row>
              {w.unaccounted !== 0 ? (
                <button
                  type="button"
                  className="mx-3 mb-2 self-start text-sm text-warn"
                  onClick={() => openQuickAdd({ amount: w.unaccounted, account_id: w.account_id })}
                >
                  {formatRs(Math.abs(w.unaccounted))} unaccounted — add it?
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Categories and rules">
        <div className="-mx-3 flex flex-col">
          <Row onClick={() => setRules(true)}>
            <span>
              {ds.categories.filter((c) => c.parent_id === null && !c.hidden).length} categories ·{" "}
              {ds.rules.length} rules
            </span>
            <ChevronRight className="text-fg-subtle" aria-hidden />
          </Row>
        </div>
      </Section>

      <SecuritySection />
      {isNative() ? <PermissionsSection /> : null}
      <DevicesSection />

      <Section title="Data">
        <div className="-mx-3 flex flex-col">
          <Row onClick={() => void exportAll()}>
            <span>Export everything as JSON</span>
            <ChevronRight className="text-fg-subtle" aria-hidden />
          </Row>
          <Row>
            <Link to="/import" className="flex w-full items-center justify-between">
              <span>Statements and imports</span>
              <ChevronRight className="text-fg-subtle" aria-hidden />
            </Link>
          </Row>
          <Row
            onClick={async () => {
              await auth.logout();
              await resetLocalData();
            }}
          >
            <span>Sign out of this device</span>
          </Row>
        </div>
        <AppVersion />
        {testRun ? <p className="text-sm text-fg-muted">{testRun}</p> : null}
      </Section>

      <Section title="Danger zone">
        <div className="-mx-3 flex flex-col">
          <Row onClick={() => setResetOpen(true)}>
            <span className="flex flex-col">
              <span>Reset ledger…</span>
              <span className="text-sm text-fg-muted">
                Start tracking again from a new date. Categories, fixed charges, loans and goals stay.
              </span>
            </span>
            <ChevronRight className="text-fg-subtle" aria-hidden />
          </Row>
        </div>
      </Section>

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
  return <p className="px-0 text-sm text-fg-muted">Marqūm {version}</p>;
}

function SecuritySection() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  useEffect(() => {
    void biometricEnrolled().then(setEnrolled);
  }, []);
  return (
    <Section title="Closed-month edits">
      <div className="-mx-3 flex flex-col">
        {isNative() ? (
          <Row
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
          >
            <span className="flex flex-col">
              <span>Fingerprint</span>
              <span className="text-sm text-fg-muted">
                {enrolled ? "On — one touch to edit a closed month" : "Set up so you don't need the passcode"}
              </span>
            </span>
            <ChevronRight className="text-fg-subtle" aria-hidden />
          </Row>
        ) : (
          <Row
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
          >
            <span className="flex flex-col">
              <span>Add a passkey</span>
              <span className="text-sm text-fg-muted">
                Confirm closed-month edits with your device instead of the passcode
              </span>
            </span>
            <ChevronRight className="text-fg-subtle" aria-hidden />
          </Row>
        )}
      </div>
    </Section>
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
    <Section title="Hands-free">
      <div className="-mx-3 flex flex-col">
        <Row onClick={files ? undefined : () => void MarqumNative.requestFileAccess().then(refresh)}>
          <span className="flex flex-col">
            <span>Statement inbox</span>
            <span className="text-sm text-fg-muted">
              {files
                ? "On — new statements in Downloads import themselves"
                : "Allow file access to pick up statements"}
            </span>
          </span>
          {files ? (
            <span className="text-sm text-pos">On</span>
          ) : (
            <ChevronRight className="text-fg-subtle" aria-hidden />
          )}
        </Row>
        <Row onClick={notifs ? undefined : () => void MarqumNative.requestNotificationAccess().then(refresh)}>
          <span className="flex flex-col">
            <span>Bank notifications</span>
            <span className="text-sm text-fg-muted">
              {notifs
                ? "On — payments appear within seconds"
                : "Allow notification access to log payments as they happen"}
            </span>
          </span>
          {notifs ? (
            <span className="text-sm text-pos">On</span>
          ) : (
            <ChevronRight className="text-fg-subtle" aria-hidden />
          )}
        </Row>
        <Row
          onClick={() => {
            setShowHeard(true);
            void MarqumNative.getCapturedNotifications({ limit: 50 }).then((r) => setHeard(r.items));
          }}
        >
          <span>Notifications the app heard</span>
          <ChevronRight className="text-fg-subtle" aria-hidden />
        </Row>
      </div>
      <Sheet open={showHeard} onOpenChange={setShowHeard} title="Notifications the app heard">
        {heard.length === 0 ? (
          <p className="text-fg-muted">
            Nothing yet. Make a payment in NayaPay or SadaPay and it shows up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {heard.map((n) => (
              <li key={n.id} className="flex flex-col gap-1">
                <span className="flex justify-between text-sm text-fg-muted">
                  <span>
                    {n.package.includes("nayapay") ? "NayaPay" : "SadaPay"} ·{" "}
                    {dayLabel(n.posted_at.slice(0, 10))} {n.posted_at.slice(11)}
                  </span>
                  <span className={n.sent ? "" : "text-warn"}>{n.sent ? "sent" : "queued"}</span>
                </span>
                <span className="font-medium">{n.title}</span>
                <span className="font-mono text-sm text-fg-muted">{n.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    </Section>
  );
}

function DevicesSection() {
  const [devices, setDevices] = useState<
    { id: string; name: string; last_seen_at?: string; current?: boolean }[] | null
  >(null);
  const load = () =>
    void api<{ id: string; name: string; last_seen_at?: string; current?: boolean }[]>(API.devices)
      .then(setDevices)
      .catch(() => setDevices([]));
  useEffect(load, []);
  const me = auth.get();
  const myId = me.status === "signed-in" ? me.session.device_id : "";
  return (
    <Section title="Devices">
      {devices === null ? (
        <Skeleton className="h-12" />
      ) : devices.length === 0 ? (
        <p className="text-sm text-fg-muted">Device list is unavailable offline.</p>
      ) : (
        <ul className="-mx-3 flex flex-col">
          {devices.map((d) => (
            <li key={d.id}>
              <Row>
                <span className="flex flex-col">
                  <span>{d.name}</span>
                  <span className="text-sm text-fg-muted">
                    {d.id === myId || d.current
                      ? "This device"
                      : d.last_seen_at
                        ? `last seen ${dayLabel(d.last_seen_at.slice(0, 10))}`
                        : ""}
                  </span>
                </span>
                {d.id === myId || d.current ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Sign out ${d.name}`}
                    onClick={async () => {
                      await api(`${API.devices}/${d.id}`, { method: "DELETE" });
                      load();
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </Row>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function BalanceSheet({
  ds,
  account,
  onClose,
}: {
  ds: Dataset;
  account: AccountId | null;
  onClose: () => void;
}) {
  const name = ds.accounts.find((a) => a.id === account)?.name ?? "";
  const [v, setV] = useState("");
  const paisa = parseRs(v);
  return (
    <Sheet
      open={account !== null}
      onOpenChange={(o) => !o && onClose()}
      title={`${name} balance right now`}
      description="Open the bank app and type what it shows. Any gap shows up as unaccounted."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!account || paisa === null) return;
          void enqueue("recordBalance", {
            entry_id: newId(),
            account_id: account,
            balance: paisa,
            as_of: karachiNow(),
          });
          setV("");
          onClose();
        }}
      >
        <MoneyInput label="Balance" value={v} onChange={setV} autoFocus />
        <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
          Save balance
        </Button>
      </form>
    </Sheet>
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Categories and rules">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Categories</h3>
          <p className="text-sm text-fg-muted">
            Hidden categories stay out of Home until something is tagged with them.
          </p>
          <ul className="flex flex-col">
            {tops.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <CategoryIcon name={c.icon} className="text-fg-muted" />
                <span className="flex-1">{c.name}</span>
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
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Rules</h3>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
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
            <div className="grid grid-cols-2 gap-2">
              <Field label="Text matches">
                <Input
                  className="font-mono"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="gym|creatine"
                />
              </Field>
              <Field label="Tag as">
                <select
                  className="h-12 rounded-control border border-border bg-surface px-3"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Category</option>
                  {ds.categories
                    .slice()
                    .sort(
                      (a, b) => (a.parent_id ?? a.id).localeCompare(b.parent_id ?? b.id) || a.sort - b.sort,
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? `  ${l.category.get(c.parent_id)?.name} › ${c.name}` : c.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={!pattern.trim() || !category}>
              Add rule
            </Button>
          </form>
          <ul className="flex flex-col">
            {[...ds.rules]
              .sort((a, b) => b.priority - a.priority)
              .map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm">{r.pattern}</span>
                    <span className="text-sm text-fg-muted">
                      {r.category_id ? (l.category.get(r.category_id)?.name ?? r.category_id) : r.flow}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete rule"
                    onClick={() => void enqueue("deleteRule", { rule_id: r.id })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      </div>
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
      description={`What ${name} held when tracking started on 1 ${monthLabel(month)}. It opens ${monthLabel(month)} as "Balance brought forward".`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!account || paisa === null) return;
          void enqueue("setOpeningBalance", { account_id: account, amount: paisa });
          setV("");
          onClose();
        }}
      >
        <MoneyInput label="Opening balance" value={v} onChange={setV} autoFocus />
        <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
          Set opening balance
        </Button>
      </form>
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
      description="Transactions, statements, balances and closed months are deleted on every device. Categories, rules, fixed charges, loans, goals and settings are kept."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
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
        <Field label="Track from (first day of a month)">
          <Input
            type="month"
            value={start.slice(0, 7)}
            onChange={(e) => e.target.value && setStart(`${e.target.value}-01`)}
          />
        </Field>
        <Field label="Type RESET to confirm">
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value.trim())}
            autoCapitalize="characters"
            autoComplete="off"
            className="font-mono"
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={!valid} loading={busy}>
          Reset and track from {dayLabel(start)} {start.slice(0, 4)}
        </Button>
      </form>
    </Sheet>
  );
}
