import { classify, counterpartyKey, type Dataset, dayLabel, formatRs, isClosed, monthOf } from "@marqum/core";
import type { Flow, Transaction } from "@marqum/schema";
import { Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { enqueue } from "../lib/commands.ts";
import { monthName } from "../lib/months.ts";
import { stepUp } from "../lib/stepup.ts";
import { escapeRegex, FLOW_LABEL, IN_FLOWS, lookup, OUT_FLOWS, timeOf, txnTitle } from "../lib/view.ts";
import { CategoryPicker } from "./category-picker.tsx";
import { useDataset } from "./dataset-provider.tsx";
import { Button } from "./ui/button.tsx";
import { Chip, Switch } from "./ui/controls.tsx";
import { Field, Input } from "./ui/input.tsx";
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

  const pattern =
    counterpartyKey(txn.description) ?? (reason.trim() ? escapeRegex(reason.trim().toLowerCase()) : null);
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

  async function save() {
    setSaving(true);
    try {
      if (closed) {
        const ok = await stepUp(`${monthName(monthOf(txn.occurred_at))} is closed`);
        if (!ok) return;
      }
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

      {!closed && pattern ? (
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="remember-rule" className="min-w-0 text-sm">
            Always tag <span className="font-mono">{pattern}</span> like this
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
