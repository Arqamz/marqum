import {
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
import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { enqueue, newId } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import { kindFor } from "../lib/recurring.ts";
import { stepUp } from "../lib/stepup.ts";
import { escapeRegex, FLOW_LABEL, IN_FLOWS, lookup, OUT_FLOWS, timeOf, txnTitle } from "../lib/view.ts";
import { CategoryPicker } from "./category-picker.tsx";
import { useDataset } from "./dataset-provider.tsx";
import { Button } from "./ui/button.tsx";
import { Chip, Segmented, Switch } from "./ui/controls.tsx";
import { Field, Input, MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

/** Tag a transaction: reason (suggests a category as you type), category, flow, links, "always". */
export function TagSheet({ txn, onClose }: { txn: Transaction | null; onClose: () => void }) {
  const ds = useDataset();
  return (
    <Sheet
      open={txn !== null}
      onOpenChange={(o) => !o && onClose()}
      title={
        txn && ds ? `${formatRs(txn.amount, { sign: txn.amount > 0 })} · ${txnTitle(txn, lookup(ds))}` : ""
      }
      description={
        txn && ds
          ? `${dayLabel(txn.occurred_at.slice(0, 10))}, ${timeOf(txn.occurred_at)} · ${ds.accounts.find((a) => a.id === txn.account_id)?.name ?? ""}`
          : undefined
      }
    >
      {txn && ds ? <TagForm key={txn.id} ds={ds} txn={txn} onDone={onClose} /> : null}
    </Sheet>
  );
}

function TagForm({ ds, txn, onDone }: { ds: Dataset; txn: Transaction; onDone: () => void }) {
  const [reason, setReason] = useState(txn.reason ?? "");
  const [category, setCategory] = useState<string | null>(txn.category_id);
  const [picked, setPicked] = useState(txn.category_id !== null);
  const [flow, setFlow] = useState<Flow>(txn.flow);
  const [loanId, setLoanId] = useState<string | null>(txn.loan_id);
  const [linked, setLinked] = useState<string | null>(txn.linked_txn_id);
  const [remember, setRemember] = useState(false);
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
  const candidates = useMemo(
    () =>
      ds.transactions
        .filter((t) => t.amount < 0 && t.flow === "spend" && t.occurred_at <= txn.occurred_at)
        .filter((t) => !txn.counterparty_id || t.counterparty_id === txn.counterparty_id || t.id === linked)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
        .slice(0, 8),
    [ds, txn, linked],
  );
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
      await enqueue("tagTransaction", {
        txn_id: txn.id,
        reason: reason.trim() || null,
        category_id: showCategory ? category : null,
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
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {closed ? (
        <p className="flex items-center gap-2 rounded-control bg-surface-2 px-4 py-3 text-sm text-fg-muted">
          <Lock className="shrink-0" aria-hidden />
          {monthName(monthOf(txn.occurred_at))} is closed — saving asks for your fingerprint.
        </p>
      ) : null}
      {txn.source === "notification" && txn.status !== "verified" ? (
        <p className="-mt-2 text-sm text-warn" data-testid="from-notification">
          From notification · amount may change (fees/tax)
        </p>
      ) : null}
      {txn.description ? (
        <p className="-mt-2 font-mono text-sm break-words text-fg-muted">{txn.description}</p>
      ) : null}

      <Field label="Reason">
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="What was it for?"
          aria-label="Reason"
          enterKeyHint="done"
        />
      </Field>

      {!closed ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
          {flows.map((f) => (
            <Chip key={f} selected={flow === f} onClick={() => setFlow(f)}>
              {FLOW_LABEL[f]}
            </Chip>
          ))}
        </div>
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
        <Field label={flow === "loan_repay" ? "Repays" : "Loan"}>
          <select
            className="h-12 rounded-control border border-border bg-surface px-4"
            value={loanId ?? ""}
            onChange={(e) => setLoanId(e.target.value || null)}
          >
            <option value="">Not linked</option>
            {loans.map((x) => (
              <option key={x.id} value={x.id}>
                {x.lender} · {x.purpose} · {formatRs(x.principal)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {!closed && flow === "reimbursement" ? (
        <Field label="Pays back">
          <select
            className="h-12 rounded-control border border-border bg-surface px-4"
            value={linked ?? ""}
            onChange={(e) => setLinked(e.target.value || null)}
          >
            <option value="">Not linked</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {formatRs(t.amount)} · {txnTitle(t, l)} · {dayLabel(t.occurred_at.slice(0, 10))}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {txn.amount < 0 && (flow === "spend" || flow === "fee") ? (
        <div className="flex flex-col gap-2" data-testid="repeats">
          <span className="text-sm text-fg-muted">
            Repeats
            {backing
              ? ` — tracked as a ${backing.cadence} ${backing.kind === "other" ? "charge" : backing.kind}`
              : ""}
          </span>
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
            <div className="flex flex-col gap-1">
              <MoneyInput label="Expected amount" value={repeatAmount} onChange={setRepeatAmount} />
              <span className="text-sm text-fg-muted">
                Expected{" "}
                {repeats === "yearly"
                  ? `every ${monthLabel(monthOf(txn.occurred_at)).slice(0, 3)}`
                  : "every month"}{" "}
                on day {Number(txn.occurred_at.slice(8, 10))}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {!closed && pattern ? (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="remember-rule" className="min-w-0 text-sm">
            Always tag <span className="font-medium">{rule?.label}</span> like this
          </label>
          <Switch
            id="remember-rule"
            checked={remember}
            onCheckedChange={setRemember}
            label="Always tag like this"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" variant="primary" size="lg" loading={saving}>
          Save
        </Button>
        {txn.status !== "verified" ? (
          <Button
            variant="danger"
            onClick={() => {
              void enqueue("deleteProvisional", { txn_id: txn.id });
              onDone();
            }}
          >
            Delete this unverified row
          </Button>
        ) : null}
      </div>
    </form>
  );
}
