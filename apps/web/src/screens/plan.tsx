import {
  allocation,
  budgetModel,
  type Dataset,
  detectRecurring,
  expectedCharges,
  formatRs,
  goalStatus,
  karachiNow,
  loanStatus,
  monthLabel,
  monthOf,
  parseRs,
  type RecurringCandidate,
  setting,
} from "@marqum/core";
import type { AccountId, Category, Goal, Loan, Recurring } from "@marqum/schema";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { RecurringForm } from "../components/recurring-form.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton, Slider } from "../components/ui/controls.tsx";
import { Field, Input, MoneyInput } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { cn } from "../lib/cn.ts";
import { cadenceLabel, KIND_LABEL, kindFor, monthlyEquivalent } from "../lib/recurring.ts";

const STATUS_LABEL = {
  paid: "paid this month",
  due: "due now",
  upcoming: "upcoming",
  missed: "missed",
} as const;

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
      className="h-1.5 rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-1.5 rounded-full",
          tone === "pos" ? "bg-pos" : tone === "neg" ? "bg-neg" : "bg-[var(--chart-bar-current)]",
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
  | { kind: "move"; goal: Goal }
  | { kind: "fixed"; recurring?: Recurring; candidate?: RecurringCandidate }
  | { kind: "budget"; category: Category; average: number | null };

const WALLET: Record<AccountId, string> = { sadapay: "SadaPay", nayapay: "NayaPay" };
const card = "flex flex-col gap-4 rounded-card bg-surface p-4";

function PlanContent({ ds, now }: { ds: Dataset; now: string }) {
  const model = useMemo(() => budgetModel(ds, now), [ds, now]);
  const loans = useMemo(() => loanStatus(ds, now), [ds, now]);
  const goals = useMemo(() => goalStatus(ds, now), [ds, now]);
  const fixed = useMemo(
    () => ds.recurring.filter((r) => r.active).sort((a, b) => a.day_of_month - b.day_of_month),
    [ds],
  );
  const candidates = useMemo(() => {
    const tracked = new Set(ds.recurring.map((r) => r.counterparty_id).filter(Boolean));
    return detectRecurring(ds).filter((c) => !c.counterparty_id || !tracked.has(c.counterparty_id));
  }, [ds]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const fixedTotal = fixed.reduce((sum, r) => sum + monthlyEquivalent(r), 0);
  const yearly = fixed.filter((r) => r.cadence === "yearly");
  const yearlyNote =
    yearly.length > 0
      ? `incl. ${yearly.map((r) => `${r.name} yearly as ${formatRs(monthlyEquivalent(r))}/month`).join(", ")}`
      : null;
  const status = useMemo(
    () => new Map(expectedCharges(ds, monthOf(now), now).map((c) => [c.recurring.id, c])),
    [ds, now],
  );
  const tops = ds.categories
    .filter((c) => c.parent_id === null && (!c.hidden || c.budget))
    .sort((a, b) => a.sort - b.sort);
  const planned = new Map(model.categories.map((c) => [c.category_id, c]));

  return (
    <>
      <Headline
        sub={`${formatRs(model.income)} in · ${formatRs(model.committed)} committed · ${formatRs(model.variable)} usual spending · ${formatRs(model.goal_contributions)} to goals`}
      >
        {model.surplus >= 0
          ? `${formatRs(model.surplus)} a month to spare`
          : `${formatRs(-model.surplus)} a month short`}
      </Headline>

      <MoneySection ds={ds} now={now} onEditIncome={() => setEdit({ kind: "income" })} />

      <Section
        title="Fixed charges"
        aside={<span className="num text-sm text-fg-muted">{formatRs(fixedTotal)} a month</span>}
      >
        {yearlyNote ? <p className="-mt-1 num text-sm text-fg-muted">{yearlyNote}</p> : null}
        <div className={card}>
          {fixed.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Subscriptions, bills and anything else that leaves every month or year. Add them so the plan
              knows.
            </p>
          ) : (
            <div className="flex flex-col gap-4" data-testid="fixed-charges">
              {(["subscription", "bill", "other"] as const)
                .filter((k) => fixed.some((r) => r.kind === k))
                .map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <span className="text-sm text-fg-muted">{KIND_LABEL[k]}</span>
                    <ul className="-mx-2 flex flex-col">
                      {fixed
                        .filter((r) => r.kind === k)
                        .map((r) => {
                          const st = status.get(r.id);
                          return (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => setEdit({ kind: "fixed", recurring: r })}
                                className="flex w-full items-center gap-3 rounded-inner px-2 py-2 text-left hover:bg-surface-2"
                              >
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className="truncate">{r.name}</span>
                                  <span className="text-sm text-fg-muted">
                                    {cadenceLabel(r)} · day {r.day_of_month} · {WALLET[r.account_id]}
                                    {st ? (
                                      <>
                                        {" · "}
                                        <span
                                          className={cn(
                                            st.status === "paid" && "text-pos",
                                            (st.status === "missed" || st.status === "due") && "text-warn",
                                          )}
                                        >
                                          {STATUS_LABEL[st.status]}
                                        </span>
                                      </>
                                    ) : null}
                                  </span>
                                </span>
                                <Money value={r.amount} className="font-medium" />
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
            </div>
          )}
          <Button variant="secondary" className="self-start" onClick={() => setEdit({ kind: "fixed" })}>
            <Plus aria-hidden />
            Add subscription or bill
          </Button>
        </div>
        {candidates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">Looks recurring — add?</span>
            <ul className="flex flex-col gap-1">
              {candidates.map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    {c.name}
                    <span className="text-fg-muted">
                      {" "}
                      · {c.cadence === "yearly" ? "yearly · " : ""}
                      {c.occurrences}× · around day {c.day_of_month}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Money value={c.amount} />
                    <Button variant="text" size="sm" onClick={() => setEdit({ kind: "fixed", candidate: c })}>
                      Add
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      <Section title="Monthly budgets">
        <p className="-mt-1 text-sm text-fg-muted">
          Used for planning while a category has little history. Leave empty to use the average.
        </p>
        <ul className={cn(card, "gap-0 px-2 py-2")} data-testid="budgets">
          {tops.map((c) => {
            const pc = planned.get(c.id);
            const avg = pc?.source === "average" && pc.planned > 0 ? pc.planned : null;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setEdit({ kind: "budget", category: c, average: avg })}
                  className="flex w-full items-center gap-3 rounded-inner px-2 py-2 text-left hover:bg-surface-2"
                >
                  <CategoryIcon name={c.icon} className="shrink-0 text-fg-muted" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{c.name}</span>
                    <span className="num text-sm text-fg-muted">
                      {pc?.source === "recurring"
                        ? "covered by fixed charges"
                        : avg !== null
                          ? `avg ${formatRs(avg)}`
                          : "no history yet"}
                    </span>
                  </span>
                  {c.budget ? (
                    <Money value={c.budget} className="font-medium" />
                  ) : (
                    <span className="text-sm text-fg-muted">Set</span>
                  )}
                  <ChevronRight className="shrink-0 text-fg-subtle" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
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
          goals.map((g) => (
            <div key={g.goal.id} className={card}>
              <button
                type="button"
                className="flex items-center gap-3 text-left"
                onClick={() => setEdit({ kind: "goal", goal: g.goal })}
              >
                <CategoryIcon name={g.goal.icon} className="text-fg-muted" />
                <span className="flex-1 font-medium">{g.goal.name}</span>
                <span className="num text-sm">
                  {formatRs(g.saved)} <span className="text-fg-muted">of {formatRs(g.goal.target)}</span>
                </span>
              </button>
              <Progress value={g.progress} tone={g.progress >= 1 ? "pos" : "fg"} />
              <div className="flex items-baseline justify-between gap-4 text-sm">
                <span className="num text-fg-muted">
                  {g.progress >= 1
                    ? "Reached"
                    : `${formatRs(g.goal.monthly)}/month${g.eta_month ? ` · ready ${monthLabel(g.eta_month)}` : " · no date at this rate"}`}
                </span>
                <Button variant="text" size="sm" onClick={() => setEdit({ kind: "move", goal: g.goal })}>
                  Move money
                </Button>
              </div>
            </div>
          ))
        )}
      </Section>

      <Section
        title="Loans"
        aside={
          <Button variant="text" size="sm" onClick={() => setEdit({ kind: "loan" })}>
            New loan
          </Button>
        }
      >
        {loans.length === 0 ? (
          <p className="text-sm text-fg-muted">
            No loans. Big purchase coming? Record a loan and repay it monthly.
          </p>
        ) : (
          loans.map((x) => (
            <button
              key={x.loan.id}
              type="button"
              className={cn(card, "text-left")}
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
          ))
        )}
        <p className="text-sm text-fg-muted">
          Tag a transfer as “Loan repayment” in Activity to count it here.
        </p>
      </Section>

      <PlanSheets ds={ds} edit={edit} onClose={() => setEdit(null)} />
    </>
  );
}

/** Income and the one control that splits it between the two wallets. */
function MoneySection({ ds, now, onEditIncome }: { ds: Dataset; now: string; onEditIncome: () => void }) {
  const alloc = useMemo(() => allocation(ds, now), [ds, now]);
  const [sada, setSada] = useState(alloc.sadapay);
  useEffect(() => setSada(alloc.sadapay), [alloc.sadapay]);
  const naya = Math.max(0, alloc.income - sada);
  const dirty = sada !== alloc.sadapay;
  const step = 50_000; // Rs 500
  const suggested = alloc.suggested;
  return (
    <Section
      title="This month's money"
      aside={
        <Button variant="text" size="sm" onClick={onEditIncome}>
          Income {formatRs(alloc.income)}
        </Button>
      }
    >
      <div className={card} data-testid="allocation">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-fg-muted">SadaPay</span>
            <Money value={sada} className="text-xl font-medium" />
          </div>
          <div className="flex flex-col gap-1 text-right">
            <span className="text-sm text-fg-muted">NayaPay</span>
            <Money value={naya} className="text-xl font-medium" />
          </div>
        </div>
        <Slider
          label="SadaPay share"
          value={sada}
          onValueChange={(v) => setSada(Math.round(v / step) * step)}
          min={0}
          max={alloc.income}
          step={step}
        />
        <div className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between gap-4">
            <span>Suggested for SadaPay{alloc.source === "user" ? "" : " (in use)"}</span>
            <Money value={suggested.sadapay} className="font-medium" />
          </span>
          <ul className="flex flex-col gap-1">
            {suggested.lines
              .filter((l) => l.account_id === "sadapay")
              .map((l) => (
                <li key={l.label} className="flex justify-between gap-4 text-fg-muted">
                  <span>{l.label}</span>
                  <Money value={l.amount} />
                </li>
              ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <Button
              variant="primary"
              onClick={() => void enqueue("setSetting", { key: "allocation_sadapay", value: String(sada) })}
            >
              Save split
            </Button>
          ) : null}
          {sada !== suggested.sadapay ? (
            <Button variant="ghost" onClick={() => setSada(suggested.sadapay)}>
              Use suggestion
            </Button>
          ) : null}
          {alloc.source === "user" && !dirty ? (
            <Button
              variant="ghost"
              onClick={() => void enqueue("setSetting", { key: "allocation_sadapay", value: "" })}
            >
              Follow the suggestion automatically
            </Button>
          ) : null}
        </div>
      </div>
    </Section>
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
            : edit?.kind === "fixed"
              ? (edit.recurring?.name ?? "Add a subscription or bill")
              : edit?.kind === "budget"
                ? `${edit.category.name} budget`
                : "";
  return (
    <Sheet open={edit !== null} onOpenChange={(o) => !o && onClose()} title={title}>
      {edit?.kind === "income" ? <IncomeForm ds={ds} onDone={onClose} /> : null}
      {edit?.kind === "loan" ? <LoanForm loan={edit.loan} onDone={onClose} /> : null}
      {edit?.kind === "goal" ? <GoalForm goal={edit.goal} count={ds.goals.length} onDone={onClose} /> : null}
      {edit?.kind === "move" ? <MoveForm goal={edit.goal} onDone={onClose} /> : null}
      {edit?.kind === "fixed" ? (
        <RecurringForm
          ds={ds}
          recurring={edit.recurring}
          draft={
            edit.candidate
              ? {
                  name: edit.candidate.name,
                  amount: edit.candidate.amount,
                  day_of_month: edit.candidate.day_of_month,
                  account_id: edit.candidate.account_id,
                  category_id: edit.candidate.category_id,
                  counterparty_id: edit.candidate.counterparty_id,
                  cadence: edit.candidate.cadence,
                  month_of_year: edit.candidate.month_of_year,
                  kind: kindFor(ds, edit.candidate.category_id),
                }
              : undefined
          }
          onDone={onClose}
        />
      ) : null}
      {edit?.kind === "budget" ? (
        <BudgetForm category={edit.category} average={edit.average} onDone={onClose} />
      ) : null}
    </Sheet>
  );
}

function BudgetForm({
  category,
  average,
  onDone,
}: {
  category: Category;
  average: number | null;
  onDone: () => void;
}) {
  const [v, setV] = useState(rs(category.budget ?? undefined));
  const paisa = v.trim() === "" ? null : parseRs(v);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void enqueue("upsertCategory", {
          category_id: category.id,
          parent_id: category.parent_id,
          name: category.name,
          icon: category.icon,
          wallet_hint: category.wallet_hint,
          nature: category.nature,
          hidden: category.hidden,
          sort: category.sort,
          budget: paisa && paisa > 0 ? paisa : null,
        });
        onDone();
      }}
    >
      <MoneyInput label="Budget" value={v} onChange={setV} autoFocus />
      <p className="num text-sm text-fg-muted">
        {average !== null
          ? `Your average is ${formatRs(average)} a month.`
          : "No history yet — a budget fills the gap."}{" "}
        Leave it empty to plan with the average.
      </p>
      <Button type="submit" variant="primary" size="lg">
        {paisa ? `Budget ${formatRs(paisa)} a month` : "Use the average"}
      </Button>
    </form>
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
