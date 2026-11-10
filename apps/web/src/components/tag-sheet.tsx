import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addDays,
  classify,
  type Dataset,
  dayLabel,
  formatRs,
  isClosed,
  monthLabel,
  monthOf,
  parseRs,
  rememberRule,
} from "@marqum/core";
import type { Flow, Transaction } from "@marqum/schema";
import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import { activeSubscriptions, kindFor } from "../lib/recurring.ts";
import { stepUp } from "../lib/stepup.ts";
import { escapeRegex, FLOW_LABEL, IN_FLOWS, lookup, OUT_FLOWS, timeOf, txnTitle } from "../lib/view.ts";
import { CategoryPicker } from "./category-picker.tsx";
import { useDataset } from "./dataset-provider.tsx";
import { Money } from "./money.tsx";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented, Switch } from "./ui/controls.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Tag a transaction: reason (suggests a category as you type), category, flow, links, "always". */
export function TagSheet({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  const ds = useDataset();
  // Tapping a linked transaction switches the sheet to it.
  // remembers which opened transaction the jump belongs to, so opening another one starts fresh
  const [jump, setJumpState] = useState<{ from: string; to: string } | null>(null);
  const setJump = (to: string) => txn && setJumpState({ from: txn.id, to });
  const target = jump && jump.from === txn?.id ? jump.to : null;
  const shown = (target && ds?.transactions.find((t) => t.id === target)) || txn;
  return (
    <Sheet
      purpose="form"
      open={txn !== null}
      onOpenChange={(o) => !o && onClose()}
      title={
        shown && ds
          ? `${formatRs(shown.amount, { sign: shown.amount > 0 })} · ${txnTitle(shown, lookup(ds))}`
          : ""
      }
      description={
        shown && ds
          ? `${dayLabel(shown.occurred_at.slice(0, 10))}, ${timeOf(shown.occurred_at)} · ${ds.accounts.find((a) => a.id === shown.account_id)?.name ?? ""}`
          : undefined
      }
    >
      {shown && ds ? <TagForm key={shown.id} ds={ds} txn={shown} onDone={onClose} onJump={setJump} /> : null}
    </Sheet>
  );
}

/** The other side of a payback link: the expense a payback is for, or the paybacks an expense got. */
function LinkedTxns({
  ds,
  txn,
  linked,
  onJump,
}: {
  ds: Dataset;
  txn: Transaction;
  linked: string | null;
  onJump: (id: string) => void;
}) {
  const l = lookup(ds);
  const rows = [
    ...(linked ? ds.transactions.filter((t) => t.id === linked && !t.deleted) : []),
    ...ds.transactions.filter((t) => !t.deleted && t.flow === "reimbursement" && t.linked_txn_id === txn.id),
  ];
  if (rows.length === 0) return null;
  return (
    <VStack gap={1} data-testid="linked-txns">
      <Text type="label">{txn.flow === "reimbursement" ? "Pays back" : "Paid back by"}</Text>
      <Card variant="muted" padding={0}>
        <List hasDividers density="compact">
          {rows.map((t) => (
            <ListItem
              key={t.id}
              onClick={() => onJump(t.id)}
              label={txnTitle(t, l)}
              description={dayLabel(t.occurred_at.slice(0, 10))}
              endContent={
                <HStack gap={1} vAlign="center">
                  <Money value={Math.abs(t.amount)} {...(t.amount > 0 ? { tone: "pos" as const } : {})} />
                  <ChevronRight size={16} aria-hidden />
                </HStack>
              }
            />
          ))}
        </List>
      </Card>
    </VStack>
  );
}

function TagForm({
  ds,
  txn,
  onDone,
  onJump,
}: {
  ds: Dataset;
  txn: Transaction;
  onDone: () => void;
  onJump: (id: string) => void;
}) {
  const [reason, setReason] = useState(txn.reason ?? "");
  const [category, setCategory] = useState<string | null>(txn.category_id);
  const [picked, setPicked] = useState(txn.category_id !== null);
  const [flow, setFlow] = useState<Flow>(txn.flow);
  const [loanId, setLoanId] = useState<string | null>(txn.loan_id);
  const [linked, setLinked] = useState<string | null>(txn.linked_txn_id);
  const [remember, setRemember] = useState(false);
  const [counterparty, setCounterparty] = useState<string | null>(txn.counterparty_id);
  const subscriptions = activeSubscriptions(ds);
  const pickedSub = subscriptions.find(
    (r) => r.category_id === category && (r.counterparty_id === null || r.counterparty_id === counterparty),
  );
  const [saving, setSaving] = useState(false);
  const closed = isClosed(ds, monthOf(txn.occurred_at));
  const backing = ds.recurring.find((r) => r.source_txn_id === txn.id && r.active);
  const [repeats, setRepeats] = useState<"no" | "monthly" | "yearly">(backing?.cadence ?? "no");
  const [repeatAmount, setRepeatAmount] = useState(String((backing?.amount ?? Math.abs(txn.amount)) / 100));

  const suggestion = useMemo(
    () =>
      classify(ds, {
        account_id: txn.account_id,
        amount: txn.amount,
        description: txn.description,
        reason: reason || null,
        bank_type: txn.bank_type,
      }),
    [ds, txn, reason],
  );
  // Reason auto-suggests a category until you pick one yourself.
  useEffect(() => {
    if (!picked && suggestion.category_id) setCategory(suggestion.category_id);
  }, [picked, suggestion.category_id]);

  // A transfer's rule includes the bank/wallet and direction, so "From Arqam · Meezan" (income) and
  // "From Arqam · NayaPay" (between wallets) never share a rule.
  const rule =
    rememberRule(txn.description) ??
    (reason.trim()
      ? { pattern: escapeRegex(reason.trim().toLowerCase()), label: `“${reason.trim()}”` }
      : null);
  const pattern = rule?.pattern ?? null;
  const flows = txn.amount < 0 ? OUT_FLOWS : IN_FLOWS;
  const loans = ds.loans.filter((l) => l.closed_on === null || l.id === loanId);
  // A payback rarely matches to the rupee and usually comes from someone other than the merchant: offer recent
  // spends (60 days up to the payback) whose amount is closest, then the newest.
  const candidates = useMemo(() => {
    const from = addDays(txn.occurred_at.slice(0, 10), -60);
    const gap = (t: Transaction) => Math.abs(txn.amount + t.amount);
    const near = ds.transactions
      .filter(
        (t) =>
          t.id !== txn.id &&
          t.amount < 0 &&
          t.flow === "spend" &&
          t.occurred_at <= txn.occurred_at &&
          t.occurred_at.slice(0, 10) >= from,
      )
      .sort((a, b) => gap(a) - gap(b) || b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 10);
    const current = linked ? ds.transactions.find((t) => t.id === linked) : undefined;
    return current && !near.some((t) => t.id === current.id) ? [current, ...near] : near;
  }, [ds, txn, linked]);
  /** "+Rs 300 extra" / "Rs 200 short" / "exact": the payback against the expense. */
  const diff = (t: Transaction) => {
    const d = txn.amount + t.amount;
    return d === 0 ? "exact" : d > 0 ? `${formatRs(d, { sign: true })} extra` : `${formatRs(-d)} short`;
  };
  const l = lookup(ds);
  const showCategory = flow === "spend" || flow === "fee" || flow === "reimbursement";

  /** "Repeats" turns this transaction into (or out of) a fixed charge. */
  async function saveRepeat() {
    if (txn.amount >= 0) return;
    if (repeats === "no") {
      if (backing) await enqueue("deleteRecurring", { recurring_id: backing.id });
      return;
    }
    const amount = parseRs(repeatAmount) ?? Math.abs(txn.amount);
    const cat = showCategory ? category : txn.category_id;
    await enqueue("upsertRecurring", {
      recurring_id: backing?.id ?? newId(),
      name: backing?.name ?? (reason.trim() || txnTitle(txn, lookup(ds))),
      account_id: txn.account_id,
      category_id: cat,
      counterparty_id: txn.counterparty_id,
      amount: Math.abs(amount),
      day_of_month: Number(txn.occurred_at.slice(8, 10)),
      active: true,
      cadence: repeats,
      month_of_year: repeats === "yearly" ? Number(txn.occurred_at.slice(5, 7)) : null,
      kind: backing?.kind ?? kindFor(ds, cat),
      source_txn_id: txn.id,
    });
  }

  async function save() {
    setSaving(true);
    try {
      if (closed) {
        const ok = await stepUp(`${monthName(monthOf(txn.occurred_at))} is closed`);
        if (!ok) return;
      }
      await saveRepeat();
      const linkedTxn =
        flow === "reimbursement" && linked ? ds.transactions.find((t) => t.id === linked) : undefined;
      const finalReason = linkedTxn
        ? `Payback for “${txnTitle(linkedTxn, lookup(ds))}”`
        : reason.trim() || null;
      await enqueue("tagTransaction", {
        txn_id: txn.id,
        reason: finalReason,
        category_id: showCategory ? category : null,
        ...(counterparty !== txn.counterparty_id ? { counterparty_id: counterparty } : {}),
        ...(closed
          ? {}
          : {
              flow,
              loan_id: flow === "loan_repay" || flow === "loan_in" ? loanId : null,
              linked_txn_id: flow === "reimbursement" ? linked : null,
              ...(remember && pattern ? { remember: { pattern } } : {}),
            }),
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <VStack
      as="form"
      gap={5}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {closed ? (
        <Banner
          status="info"
          title={`${monthName(monthOf(txn.occurred_at))} is closed`}
          description="Saving asks for your fingerprint."
        />
      ) : null}
      {txn.source === "notification" && txn.status !== "verified" ? (
        <Text type="supporting" data-testid="from-notification">
          From notification · amount may change
        </Text>
      ) : null}
      {txn.description ? (
        <Text type="code" color="secondary" wordBreak="break-word">
          {txn.description}
        </Text>
      ) : null}

      <LinkedTxns ds={ds} txn={txn} linked={flow === "reimbursement" ? linked : null} onJump={onJump} />

      {flow === "reimbursement" ? null : (
        <TextInput
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="What was it for?"
          enterKeyHint="done"
        />
      )}

      {!closed ? (
        <HStack gap={2} wrap="wrap" role="radiogroup" aria-label="Kind">
          {flows.map((f) => (
            <Chip key={f} selected={flow === f} onClick={() => setFlow(f)}>
              {FLOW_LABEL[f]}
            </Chip>
          ))}
        </HStack>
      ) : null}

      {showCategory && txn.amount < 0 && subscriptions.length > 0 ? (
        <VStack gap={2} data-testid="subscription-pick">
          <Text type="label">Subscription</Text>
          <HStack gap={2} wrap="wrap">
            {subscriptions.map((r) => (
              <Chip
                key={r.id}
                selected={pickedSub?.id === r.id}
                onClick={() => {
                  setPicked(true);
                  setCategory(r.category_id);
                  if (r.counterparty_id) setCounterparty(r.counterparty_id);
                  if (!reason.trim()) setReason(r.name);
                }}
              >
                {r.name}
              </Chip>
            ))}
          </HStack>
        </VStack>
      ) : null}

      {showCategory ? (
        <CategoryPicker
          ds={ds}
          value={category}
          suggested={suggestion.category_id}
          onChange={(id) => {
            setPicked(true);
            setCategory(id);
          }}
        />
      ) : null}

      {!closed && (flow === "loan_repay" || flow === "loan_in") ? (
        <Selector
          label={flow === "loan_repay" ? "Repays" : "Loan"}
          value={loanId ?? ""}
          onChange={(v) => setLoanId(v || null)}
          presentation="adaptive"
          width="100%"
          options={[
            { value: "", label: "Not linked" },
            ...loans.map((x) => ({
              value: x.id,
              label: `${x.lender} · ${x.purpose} · ${formatRs(x.principal)}`,
            })),
          ]}
        />
      ) : null}

      {!closed && flow === "reimbursement" ? (
        <Selector
          label="Pays back"
          value={linked ?? ""}
          onChange={(v) => setLinked(v || null)}
          presentation="adaptive"
          width="100%"
          options={[
            { value: "", label: "Not linked" },
            ...candidates.map((t) => ({
              value: t.id,
              label: `${formatRs(-t.amount)} · ${txnTitle(t, l)} · ${dayLabel(t.occurred_at.slice(0, 10))} · ${diff(t)}`,
            })),
          ]}
        />
      ) : null}

      {txn.amount < 0 && (flow === "spend" || flow === "fee") ? (
        <VStack gap={2} data-testid="repeats">
          <Text type="label">
            Repeats
            {backing ? ` · tracked ${backing.cadence}` : ""}
          </Text>
          <Segmented
            label="Repeats"
            value={repeats}
            onValueChange={setRepeats}
            options={[
              { value: "no", label: "Once" },
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
          {repeats !== "no" ? (
            <MoneyInput
              label="Expected amount"
              value={repeatAmount}
              onChange={setRepeatAmount}
              description={`${repeats === "yearly" ? `Every ${monthLabel(monthOf(txn.occurred_at)).slice(0, 3)}` : "Every month"} · day ${Number(txn.occurred_at.slice(8, 10))}`}
            />
          ) : null}
        </VStack>
      ) : null}

      {!closed && pattern ? (
        <Switch
          id="remember-rule"
          checked={remember}
          onCheckedChange={setRemember}
          label="Always tag like this"
          text={`Always tag ${rule?.label ?? ""} like this`}
        />
      ) : null}

      <VStack gap={2}>
        <Button type="submit" variant="primary" size="lg" loading={saving} width="full">
          Save
        </Button>
        {txn.status !== "verified" ? (
          <Button
            variant="danger"
            width="full"
            onClick={() => {
              void enqueue("deleteProvisional", { txn_id: txn.id });
              onDone();
            }}
          >
            Delete this unverified row
          </Button>
        ) : null}
      </VStack>
    </VStack>
  );
}
