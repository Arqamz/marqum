import {
  budgetModel,
  type Dataset,
  detectRecurring,
  formatRs,
  goalStatus,
  karachiNow,
  loanStatus,
  monthLabel,
  parseRs,
  setting,
  suggestedSplit,
} from "@marqum/core";
import type { AccountId, Goal, Loan } from "@marqum/schema";
import { useMemo, useState } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton } from "../components/ui/controls.tsx";
import { Field, Input, MoneyInput } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { cn } from "../lib/cn.ts";
import { enqueue, newId } from "../lib/commands.ts";

export function PlanScreen() {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen>
      {ds ? (
        <PlanContent ds={ds} now={now} />
      ) : (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-32 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      )}
    </Screen>
  );
}

function Progress({ value, tone = "fg" }: { value: number; tone?: "fg" | "pos" | "neg" }) {
  return (
    <div
      className="h-1 rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-1 rounded-full",
          tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-fg-muted",
        )}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </div>
  );
}

type Edit =
  | { kind: "income" }
  | { kind: "loan"; loan?: Loan }
  | { kind: "goal"; goal?: Goal }
  | { kind: "move"; goal: Goal };

function PlanContent({ ds, now }: { ds: Dataset; now: string }) {
  const model = useMemo(() => budgetModel(ds, now), [ds, now]);
  const split = useMemo(() => suggestedSplit(ds, now), [ds, now]);
  const loans = useMemo(() => loanStatus(ds, now), [ds, now]);
  const goals = useMemo(() => goalStatus(ds, now), [ds, now]);
  const candidates = useMemo(() => {
    const tracked = new Set(ds.recurring.map((r) => r.counterparty_id).filter(Boolean));
    return detectRecurring(ds).filter((c) => !c.counterparty_id || !tracked.has(c.counterparty_id));
  }, [ds]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const recurring = ds.recurring.filter((r) => r.active);

  return (
    <>
      <Headline
        sub={`${formatRs(model.income)} in · ${formatRs(model.committed)} committed · ${formatRs(model.variable)} usual spending · ${formatRs(model.goal_contributions)} to goals`}
      >
        {model.surplus >= 0
          ? `${formatRs(model.surplus)} a month left after the usual`
          : `${formatRs(-model.surplus)} a month short of the usual`}
      </Headline>

      <Section
        title="Split each month"
        aside={
          <Button variant="text" size="sm" onClick={() => setEdit({ kind: "income" })}>
            Income {formatRs(model.income)}
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          {(["sadapay", "nayapay"] as AccountId[]).map((a) => (
            <div key={a} className="flex flex-col gap-1">
              <span className="text-sm text-fg-muted">{a === "sadapay" ? "SadaPay" : "NayaPay"}</span>
              <Money value={split[a]} className="text-xl font-medium" />
            </div>
          ))}
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {split.lines.map((line) => (
            <li key={`${line.account_id}-${line.label}`} className="flex justify-between gap-4">
              <span className="text-fg-muted">
                {line.account_id === "sadapay" ? "SadaPay" : "NayaPay"} · {line.label}
              </span>
              <Money value={line.amount} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={loans.some((x) => x.outstanding > 0) ? "Loans" : "Loans"}
        aside={
          <Button variant="text" size="sm" onClick={() => setEdit({ kind: "loan" })}>
            New loan
          </Button>
        }
      >
        {loans.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No loans. Big purchase coming? Record a loan from Mom and repay it monthly.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {loans.map((x) => (
              <li key={x.loan.id}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-2 text-left"
                  onClick={() => setEdit({ kind: "loan", loan: x.loan })}
                >
                  <span className="flex items-baseline justify-between gap-4">
                    <span className="font-medium">
                      {x.loan.lender} · {x.loan.purpose}
                    </span>
                    <Money
                      value={x.outstanding}
                      tone={x.outstanding > 0 ? "neg" : "pos"}
                      className="font-medium"
                    />
                  </span>
                  <Progress value={x.progress} tone={x.outstanding > 0 ? "fg" : "pos"} />
                  <span className="num text-sm text-fg-muted">
                    {formatRs(x.repaid)} of {formatRs(x.loan.principal)} repaid
                    {x.outstanding > 0 && x.payoff_month
                      ? ` · ${formatRs(x.loan.installment)}/month · clear by ${monthLabel(x.payoff_month)}`
                      : x.outstanding <= 0
                        ? " · cleared"
                        : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-fg-muted">
          Link repayments by tagging a transfer as “Loan repayment” in Activity.
        </p>
      </Section>

      <Section
        title="Goals"
        aside={
          <Button variant="text" size="sm" onClick={() => setEdit({ kind: "goal" })}>
            New goal
          </Button>
        }
      >
        {goals.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No goals yet. A goal sets money aside inside SadaPay each month.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {goals.map((g) => (
              <li key={g.goal.id} className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <CategoryIcon name={g.goal.icon} className="text-fg-muted" />
                  <button
                    type="button"
                    className="flex-1 text-left font-medium"
                    onClick={() => setEdit({ kind: "goal", goal: g.goal })}
                  >
                    {g.goal.name}
                  </button>
                  <span className="num text-sm">
                    {formatRs(g.saved)} <span className="text-fg-muted">/ {formatRs(g.goal.target)}</span>
                  </span>
                </div>
                <Progress value={g.progress} tone={g.progress >= 1 ? "pos" : "fg"} />
                <div className="flex items-baseline justify-between text-sm">
                  <span className="num text-fg-muted">
                    {g.progress >= 1
                      ? "Reached"
                      : `${formatRs(g.goal.monthly)}/month${g.eta_month ? ` · ready ${monthLabel(g.eta_month)}` : " · no ETA at this rate"}`}
                  </span>
                  <Button variant="text" size="sm" onClick={() => setEdit({ kind: "move", goal: g.goal })}>
                    Move money
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recurring">
        {recurring.length === 0 && candidates.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nothing recurring yet. Payments to the same person for a similar amount every month show up here.
          </p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {recurring.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-4 text-sm">
              <span>
                {r.name}
                <span className="text-fg-muted">
                  {" "}
                  · {r.account_id === "sadapay" ? "SadaPay" : "NayaPay"} · day {r.day_of_month}
                </span>
              </span>
              <span className="flex items-baseline gap-3">
                <Money value={r.amount} />
                <Button
                  variant="text"
                  size="sm"
                  onClick={() =>
                    void enqueue("upsertRecurring", {
                      recurring_id: r.id,
                      name: r.name,
                      account_id: r.account_id,
                      category_id: r.category_id,
                      counterparty_id: r.counterparty_id,
                      amount: r.amount,
                      day_of_month: r.day_of_month,
                      active: false,
                    })
                  }
                >
                  Stop
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">Looks recurring</span>
            <ul className="flex flex-col gap-2">
              {candidates.map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-4 text-sm">
                  <span>
                    {c.name}
                    <span className="text-fg-muted">
                      {" "}
                      · {c.occurrences}× · around day {c.day_of_month}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3">
                    <Money value={c.amount} />
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() =>
                        void enqueue("upsertRecurring", {
                          recurring_id: newId(),
                          name: c.name,
                          account_id: c.account_id,
                          category_id: c.category_id,
                          counterparty_id: c.counterparty_id,
                          amount: c.amount,
                          day_of_month: c.day_of_month,
                          active: true,
                        })
                      }
                    >
                      Track
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <PlanSheets ds={ds} edit={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function PlanSheets({ ds, edit, onClose }: { ds: Dataset; edit: Edit | null; onClose: () => void }) {
  const title =
    edit?.kind === "income"
      ? "Monthly income into the wallets"
      : edit?.kind === "loan"
        ? edit.loan
          ? `${edit.loan.lender} · ${edit.loan.purpose}`
          : "New loan"
        : edit?.kind === "goal"
          ? (edit.goal?.name ?? "New goal")
          : edit?.kind === "move"
            ? `Move money for ${edit.goal.name}`
            : "";
  return (
    <Sheet open={edit !== null} onOpenChange={(o) => !o && onClose()} title={title}>
      {edit?.kind === "income" ? <IncomeForm ds={ds} onDone={onClose} /> : null}
      {edit?.kind === "loan" ? <LoanForm loan={edit.loan} onDone={onClose} /> : null}
      {edit?.kind === "goal" ? <GoalForm goal={edit.goal} count={ds.goals.length} onDone={onClose} /> : null}
      {edit?.kind === "move" ? <MoveForm goal={edit.goal} onDone={onClose} /> : null}
    </Sheet>
  );
}

const rs = (paisa: number | undefined): string => (paisa ? String(paisa / 100) : "");

function IncomeForm({ ds, onDone }: { ds: Dataset; onDone: () => void }) {
  const [v, setV] = useState(rs(Number(setting(ds, "income_monthly"))));
  const paisa = parseRs(v);
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (paisa === null) return;
        void enqueue("setSetting", { key: "income_monthly", value: String(paisa) });
        onDone();
      }}
    >
      <MoneyInput label="Monthly income" value={v} onChange={setV} autoFocus />
      <p className="text-sm text-fg-muted">
        What reaches SadaPay and NayaPay from Meezan each month. Not counted as spending or income.
      </p>
      <Button type="submit" variant="primary" size="lg" disabled={paisa === null}>
        Save
      </Button>
    </form>
  );
}

function LoanForm({ loan, onDone }: { loan: Loan | undefined; onDone: () => void }) {
  const [lender, setLender] = useState(loan?.lender ?? "Mom");
  const [purpose, setPurpose] = useState(loan?.purpose ?? "");
  const [principal, setPrincipal] = useState(rs(loan?.principal));
  const [installment, setInstallment] = useState(rs(loan?.installment));
  const [started, setStarted] = useState(loan?.started_on ?? karachiNow().slice(0, 10));
  const p = parseRs(principal);
  const i = parseRs(installment);
  const ok = lender.trim() && purpose.trim() && p && i;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || !p || !i) return;
        void enqueue("upsertLoan", {
          loan_id: loan?.id ?? newId(),
          lender: lender.trim(),
          counterparty_id: loan?.counterparty_id ?? null,
          principal: p,
          started_on: started,
          purpose: purpose.trim(),
          installment: i,
          note: loan?.note ?? null,
          manual_repaid: loan?.manual_repaid ?? 0,
          closed_on: loan?.closed_on ?? null,
        });
        onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <Input value={lender} onChange={(e) => setLender(e.target.value)} />
        </Field>
        <Field label="For">
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Bicycle" />
        </Field>
      </div>
      <Field label="Borrowed">
        <MoneyInput label="Borrowed" value={principal} onChange={setPrincipal} />
      </Field>
      <Field label="Repay each month">
        <MoneyInput label="Repay each month" value={installment} onChange={setInstallment} />
      </Field>
      <Field label="Started">
        <Input type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
      </Field>
      {p && i ? (
        <p className="num text-sm text-fg-muted">
          {Math.ceil(p / i)} installments of {formatRs(i)}
        </p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        {loan ? "Save loan" : "Add loan"}
      </Button>
    </form>
  );
}

function GoalForm({ goal, count, onDone }: { goal: Goal | undefined; count: number; onDone: () => void }) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(rs(goal?.target));
  const [monthly, setMonthly] = useState(rs(goal?.monthly));
  const t = parseRs(target);
  const m = parseRs(monthly);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !t || m === null) return;
        void enqueue("upsertGoal", {
          goal_id: goal?.id ?? newId(),
          name: name.trim(),
          icon: goal?.icon ?? "piggy-bank",
          target: t,
          monthly: m,
          priority: goal?.priority ?? count + 1,
          achieved_on: goal?.achieved_on ?? null,
        });
        onDone();
      }}
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New laptop" />
      </Field>
      <Field label="Target">
        <MoneyInput label="Target" value={target} onChange={setTarget} />
      </Field>
      <Field label="Set aside each month">
        <MoneyInput label="Set aside each month" value={monthly} onChange={setMonthly} />
      </Field>
      {t && m ? (
        <p className="num text-sm text-fg-muted">Reached in about {Math.ceil(t / m)} months</p>
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!name.trim() || !t || m === null}>
        {goal ? "Save goal" : "Add goal"}
      </Button>
      {goal ? (
        <Button
          variant="danger"
          onClick={() => {
            void enqueue("deleteGoal", { goal_id: goal.id });
            onDone();
          }}
        >
          Delete goal
        </Button>
      ) : null}
    </form>
  );
}

function MoveForm({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [dir, setDir] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState(rs(goal.monthly));
  const a = parseRs(amount);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!a) return;
        void enqueue("moveGoal", {
          move_id: newId(),
          goal_id: goal.id,
          amount: dir === "in" ? a : -a,
          on: karachiNow().slice(0, 10),
          note: null,
        });
        onDone();
      }}
    >
      <Segmented
        label="Direction"
        value={dir}
        onValueChange={setDir}
        options={[
          { value: "in", label: "Set aside" },
          { value: "out", label: "Release" },
        ]}
      />
      <MoneyInput label="Amount" value={amount} onChange={setAmount} autoFocus />
      <p className="text-sm text-fg-muted">
        The money stays in SadaPay; this only changes what's reserved for {goal.name}.
      </p>
      <Button type="submit" variant="primary" size="lg" disabled={!a}>
        {dir === "in" ? `Set aside ${a ? formatRs(a) : ""}` : `Release ${a ? formatRs(a) : ""}`}
      </Button>
    </form>
  );
}
