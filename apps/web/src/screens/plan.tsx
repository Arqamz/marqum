import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  budgetModel,
  type Dataset,
  dayLabel,
  detectRecurring,
  expectedCharges,
  formatRs,
  goalStatus,
  karachiNow,
  loanStatus,
  monthLabel,
  monthlyIncome,
  monthOf,
  parseRs,
  plannedCategories,
  type RecurringCandidate,
  suggestedSplit,
} from "@marqum/core";
import type { AccountId, Category, Goal, Loan, Recurring } from "@marqum/schema";
import { ChevronRight, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { RecurringForm } from "../components/recurring-form.tsx";
import { Screen } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { Field, Input, MoneyInput } from "../components/ui/input.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { enqueue, newId } from "../lib/commands.ts";
import { opt } from "../lib/opt.ts";
import {
  cadenceLabel,
  KIND_LABEL,
  kindFor,
  monthlyEquivalent,
  type RecurringKind,
} from "../lib/recurring.ts";

const STATUS = {
  paid: { label: "Paid", variant: "success" },
  due: { label: "Due", variant: "warning" },
  missed: { label: "Missed", variant: "error" },
} as const;

export function PlanScreen() {
  const ds = useDataset();
  const now = useNow();
  return (
    <Screen>
      {ds ? (
        <PlanContent ds={ds} now={now} />
      ) : (
        <VStack gap={4}>
          <Skeleton height={32} width="75%" />
          <Skeleton height={128} />
          <Skeleton height={128} />
        </VStack>
      )}
    </Screen>
  );
}

/** Heading level 2 with an optional action on the right. */
function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <VStack as="section" gap={3}>
      <HStack justify="between" vAlign="center" gap={4}>
        <Heading level={2}>{title}</Heading>
        {aside}
      </HStack>
      {children}
    </VStack>
  );
}

type Edit =
  | { kind: "income" }
  | { kind: "loan"; loan?: Loan }
  | { kind: "goal"; goal?: Goal }
  | { kind: "move"; goal: Goal; dir: "in" | "out" }
  | { kind: "fixed"; recurring?: Recurring; candidate?: RecurringCandidate }
  | { kind: "budget"; category: Category; basis: Basis | null };

/** What a category would plan without a budget: its average, or (no complete month yet) the daily-rate estimate. */
type Basis = { amount: number; source: "average" | "estimate" };

const basisText = (b: Basis) =>
  b.source === "average" ? `avg ${formatRs(b.amount)}` : `~${formatRs(b.amount)} est.`;

const WALLET: Record<AccountId, string> = { sadapay: "SadaPay", nayapay: "NayaPay" };

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
  const status = useMemo(
    () => new Map(expectedCharges(ds, monthOf(now), now).map((c) => [c.recurring.id, c])),
    [ds, now],
  );
  const tops = ds.categories
    .filter((c) => c.parent_id === null && (!c.hidden || c.budget))
    .sort((a, b) => a.sort - b.sort);
  const planned = new Map(model.categories.map((c) => [c.category_id, c]));
  const baseline = useMemo(() => {
    const unbudgeted = { ...ds, categories: ds.categories.map((c) => ({ ...c, budget: null })) };
    const out = new Map<string, Basis>();
    for (const c of plannedCategories(unbudgeted, now))
      if ((c.source === "average" || c.source === "estimate") && c.planned > 0)
        out.set(c.category_id, { amount: c.planned, source: c.source });
    return out;
  }, [ds, now]);
  const budgetTotal = tops.reduce((sum, c) => sum + (planned.get(c.id)?.planned ?? 0), 0);
  const kinds = (Object.keys(KIND_LABEL) as RecurringKind[]).filter((k) => fixed.some((r) => r.kind === k));

  return (
    <>
      <VStack gap={2}>
        <Heading level={1} type="display-3">
          {model.surplus >= 0
            ? `${formatRs(model.surplus)} a month to spare`
            : `${formatRs(-model.surplus)} a month short`}
        </Heading>
        <Text color="secondary" hasTabularNumbers>
          {formatRs(model.income)} in · {formatRs(model.committed)} fixed · {formatRs(model.variable)}{" "}
          spending · {formatRs(model.goal_contributions)} goals
        </Text>
      </VStack>

      <MoneySection ds={ds} now={now} onIncome={() => setEdit({ kind: "income" })} />

      <Block
        title="Fixed charges"
        aside={
          <Text type="supporting" hasTabularNumbers>
            {formatRs(fixedTotal)}/mo
          </Text>
        }
      >
        <Card>
          <VStack gap={4}>
            {fixed.length === 0 ? (
              <EmptyState isCompact headingLevel={3} title="No fixed charges" />
            ) : (
              <VStack gap={4} data-testid="fixed-charges">
                {kinds.map((k) => (
                  <List key={k} edge="outset" hasDividers header={KIND_LABEL[k]}>
                    {fixed
                      .filter((r) => r.kind === k)
                      .map((r) => {
                        const st = status.get(r.id)?.status;
                        const badge = st && st !== "upcoming" ? STATUS[st] : null;
                        return (
                          <ListItem
                            key={r.id}
                            label={r.name}
                            description={`${cadenceLabel(r)} · day ${r.day_of_month} · ${WALLET[r.account_id]}`}
                            endContent={
                              <HStack gap={2} vAlign="center">
                                {badge ? <Badge label={badge.label} variant={badge.variant} /> : null}
                                <Money value={r.amount} className="font-medium" />
                              </HStack>
                            }
                            onClick={() => setEdit({ kind: "fixed", recurring: r })}
                          />
                        );
                      })}
                  </List>
                ))}
              </VStack>
            )}
            <HStack>
              <Button
                variant="secondary"
                icon={<Plus aria-hidden />}
                onClick={() => setEdit({ kind: "fixed" })}
              >
                Add subscription or bill
              </Button>
            </HStack>
          </VStack>
        </Card>
        {candidates.length > 0 ? (
          <Card variant="muted">
            <List edge="outset" header="Looks recurring" density="compact">
              {candidates.map((c) => (
                <ListItem
                  key={c.key}
                  label={c.name}
                  description={`${c.cadence === "yearly" ? "Yearly · " : ""}${c.occurrences}× · day ${c.day_of_month}`}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      <Money value={c.amount} />
                      <Button
                        variant="text"
                        size="sm"
                        onClick={() => setEdit({ kind: "fixed", candidate: c })}
                      >
                        Add
                      </Button>
                    </HStack>
                  }
                />
              ))}
            </List>
          </Card>
        ) : null}
      </Block>

      <Block
        title="Goals"
        aside={
          <Button
            variant="text"
            size="sm"
            icon={<Plus aria-hidden />}
            onClick={() => setEdit({ kind: "goal" })}
          >
            New goal
          </Button>
        }
      >
        {goals.length === 0 ? (
          <EmptyState isCompact headingLevel={3} title="No goals" />
        ) : (
          goals.map((g) => {
            const done = g.progress >= 1;
            return (
              <Card key={g.goal.id}>
                <VStack gap={3}>
                  <List edge="outset">
                    <ListItem
                      startContent={<CategoryIcon name={g.goal.icon} className="text-fg-muted" />}
                      label={g.goal.name}
                      description={`${formatRs(g.saved)} of ${formatRs(g.goal.target)}`}
                      endContent={<ChevronRight className="shrink-0 text-fg-subtle" aria-hidden />}
                      onClick={() => setEdit({ kind: "goal", goal: g.goal })}
                    />
                  </List>
                  <ProgressBar
                    label={`${g.goal.name} progress`}
                    isLabelHidden
                    value={Math.min(1, Math.max(0, g.progress)) * 100}
                    variant={done ? "success" : "accent"}
                  />
                  <HStack justify="between" vAlign="center" gap={4}>
                    <StackItem size="fill">
                      {done ? (
                        <Badge label="Reached" variant="success" />
                      ) : (
                        <Text type="supporting" hasTabularNumbers>
                          {formatRs(g.goal.monthly)}/month
                          {g.eta_month ? ` · ready by ${monthLabel(g.eta_month)}` : ""}
                        </Text>
                      )}
                    </StackItem>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Plus aria-hidden />}
                      onClick={() => setEdit({ kind: "move", goal: g.goal, dir: "in" })}
                    >
                      Add money
                    </Button>
                  </HStack>
                </VStack>
              </Card>
            );
          })
        )}
      </Block>

      <Block
        title="Loans"
        aside={
          <Button
            variant="text"
            size="sm"
            icon={<Plus aria-hidden />}
            onClick={() => setEdit({ kind: "loan" })}
          >
            New loan
          </Button>
        }
      >
        {loans.length === 0 ? (
          <EmptyState isCompact headingLevel={3} title="No loans" />
        ) : (
          loans.map((x) => {
            const open = x.outstanding > 0;
            const name = `${x.loan.lender} · ${x.loan.purpose}`;
            return (
              <ClickableCard
                key={x.loan.id}
                label={name}
                onClick={() => setEdit({ kind: "loan", loan: x.loan })}
              >
                <VStack gap={3}>
                  <HStack justify="between" vAlign="center" gap={4}>
                    <Text weight="medium" maxLines={1}>
                      {name}
                    </Text>
                    <Money value={x.outstanding} tone={open ? "neg" : "pos"} className="font-medium" />
                  </HStack>
                  <ProgressBar
                    label={`${name} repaid`}
                    isLabelHidden
                    value={Math.min(1, Math.max(0, x.progress)) * 100}
                    variant={open ? "accent" : "success"}
                  />
                  <HStack justify="between" vAlign="center" gap={4}>
                    <Text type="supporting" hasTabularNumbers>
                      {formatRs(x.repaid)} / {formatRs(x.loan.principal)}
                    </Text>
                    {open ? (
                      x.payoff_month ? (
                        <Text type="supporting" hasTabularNumbers>
                          {formatRs(x.loan.installment)}/mo · {monthLabel(x.payoff_month)}
                        </Text>
                      ) : null
                    ) : (
                      <Badge label="Cleared" variant="success" />
                    )}
                  </HStack>
                </VStack>
              </ClickableCard>
            );
          })
        )}
      </Block>

      <Card data-testid="budgets">
        <Collapsible
          defaultIsOpen={false}
          trigger={
            <HStack gap={3} vAlign="center" wrap="wrap">
              <Heading level={2}>Monthly budgets</Heading>
              <Text type="supporting" hasTabularNumbers>
                {tops.length} categories · {formatRs(budgetTotal)}/mo
              </Text>
            </HStack>
          }
        >
          <List edge="outset" hasDividers>
            {tops.map((c) => {
              const pc = planned.get(c.id);
              const basis = baseline.get(c.id) ?? null;
              return (
                <ListItem
                  key={c.id}
                  startContent={<CategoryIcon name={c.icon} className="shrink-0 text-fg-muted" />}
                  label={c.name}
                  description={
                    pc?.source === "recurring" ? "Fixed charges" : basis ? basisText(basis) : "No history"
                  }
                  endContent={
                    <HStack gap={2} vAlign="center">
                      {c.budget ? (
                        <Money value={c.budget} className="font-medium" />
                      ) : (
                        <Text type="supporting">Set</Text>
                      )}
                      <ChevronRight className="shrink-0 text-fg-subtle" aria-hidden />
                    </HStack>
                  }
                  onClick={() => setEdit({ kind: "budget", category: c, basis })}
                />
              );
            })}
          </List>
        </Collapsible>
      </Card>

      <PlanSheets ds={ds} now={now} edit={edit} onEdit={setEdit} onClose={() => setEdit(null)} />
    </>
  );
}

const short = (m: string) => monthLabel(m).split(" ")[0];

/** Income (what you sent yourself from Meezan) and the suggested split between the wallets. Read-only. */
function MoneySection({ ds, now, onIncome }: { ds: Dataset; now: string; onIncome: () => void }) {
  const income = useMemo(() => monthlyIncome(ds, now), [ds, now]);
  const split = useMemo(() => suggestedSplit(ds, now), [ds, now]);
  const first = income.months[0]?.month;
  const last = income.months.at(-1)?.month;
  const basis =
    income.basis === "average" && first && last
      ? `avg of ${first === last ? short(first) : `${short(first)}–${short(last)}`}`
      : income.basis === "this_month"
        ? "this month"
        : "no transfers yet";
  return (
    <Block title="This month's money">
      <Card>
        <VStack gap={4} data-testid="allocation">
          <List edge="outset">
            <ListItem
              label="Income"
              description={`From Arqam (Meezan) · ${basis}`}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Money value={income.amount} className="font-medium" />
                  {income.months.length > 0 ? (
                    <ChevronRight className="shrink-0 text-fg-subtle" aria-hidden />
                  ) : null}
                </HStack>
              }
              {...opt({ onClick: income.months.length > 0 ? onIncome : undefined })}
            />
          </List>
          <HStack justify="between" gap={4}>
            <VStack gap={1}>
              <HStack gap={2} vAlign="center">
                <Text type="supporting">SadaPay</Text>
                <Badge label="Suggested" variant="teal" />
              </HStack>
              <Money value={split.sadapay} className="text-xl font-medium" />
            </VStack>
            <VStack gap={1} hAlign="end">
              <Text type="supporting">NayaPay</Text>
              <Money value={split.nayapay} className="text-xl font-medium" />
            </VStack>
          </HStack>
          <List edge="outset" density="compact" hasDividers>
            {split.lines.map((l) => (
              <ListItem
                key={`${l.account_id}-${l.label}-${l.amount}`}
                label={l.label}
                description={WALLET[l.account_id]}
                endContent={<Money value={l.amount} tone="muted" />}
              />
            ))}
          </List>
        </VStack>
      </Card>
    </Block>
  );
}

/** The bank → wallet transfers behind the income figure, by month. */
function IncomeList({ ds, now }: { ds: Dataset; now: string }) {
  const income = monthlyIncome(ds, now);
  return (
    <VStack gap={5}>
      {income.months.map((m) => {
        const rows = ds.transactions
          .filter(
            (t) => !t.deleted && t.flow === "funding" && t.amount > 0 && monthOf(t.occurred_at) === m.month,
          )
          .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
        return (
          <List
            key={m.month}
            hasDividers
            density="compact"
            header={
              <HStack justify="between" vAlign="center" gap={4}>
                <Text weight="medium">{monthLabel(m.month)}</Text>
                <Money value={m.amount} className="font-medium" />
              </HStack>
            }
          >
            {rows.map((t) => (
              <ListItem
                key={t.id}
                label={dayLabel(t.occurred_at.slice(0, 10))}
                description={WALLET[t.account_id]}
                endContent={<Money value={t.amount} />}
              />
            ))}
          </List>
        );
      })}
    </VStack>
  );
}

function PlanSheets({
  ds,
  now,
  edit,
  onEdit,
  onClose,
}: {
  ds: Dataset;
  now: string;
  edit: Edit | null;
  onEdit: (e: Edit) => void;
  onClose: () => void;
}) {
  const title =
    edit?.kind === "income"
      ? "Income from Arqam (Meezan)"
      : edit?.kind === "loan"
        ? edit.loan
          ? `${edit.loan.lender} · ${edit.loan.purpose}`
          : "New loan"
        : edit?.kind === "goal"
          ? (edit.goal?.name ?? "New goal")
          : edit?.kind === "move"
            ? `${edit.dir === "in" ? "Add money" : "Take money out"} · ${edit.goal.name}`
            : edit?.kind === "fixed"
              ? (edit.recurring?.name ?? "Add a subscription or bill")
              : edit?.kind === "budget"
                ? `${edit.category.name} budget`
                : "";
  return (
    <Sheet open={edit !== null} onOpenChange={(o) => !o && onClose()} title={title} purpose="form">
      {edit?.kind === "income" ? <IncomeList ds={ds} now={now} /> : null}
      {edit?.kind === "loan" ? <LoanForm loan={edit.loan} onDone={onClose} /> : null}
      {edit?.kind === "goal" ? (
        <GoalForm
          goal={edit.goal}
          count={ds.goals.length}
          onDone={onClose}
          onTakeOut={(goal) => onEdit({ kind: "move", goal, dir: "out" })}
        />
      ) : null}
      {edit?.kind === "move" ? (
        <MoveForm key={edit.dir} goal={edit.goal} dir={edit.dir} onDone={onClose} />
      ) : null}
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
        <BudgetForm category={edit.category} basis={edit.basis} onDone={onClose} />
      ) : null}
    </Sheet>
  );
}

/** A sheet form: stacked fields, submit handled once. */
function Form({ onSubmit, children }: { onSubmit: () => void; children: ReactNode }) {
  return (
    <VStack
      as="form"
      gap={5}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </VStack>
  );
}

function BudgetForm({
  category,
  basis,
  onDone,
}: {
  category: Category;
  basis: Basis | null;
  onDone: () => void;
}) {
  const [v, setV] = useState(rs(category.budget ?? undefined));
  const paisa = v.trim() === "" ? null : parseRs(v);
  return (
    <Form
      onSubmit={() => {
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
      <MoneyInput
        label="Budget"
        value={v}
        onChange={setV}
        autoFocus
        description={basis ? `${basisText(basis)} · empty = that` : "Empty = no budget"}
      />
      <Button type="submit" variant="primary" size="lg">
        {paisa
          ? `Budget ${formatRs(paisa)} a month`
          : basis?.source === "estimate"
            ? "Use the estimate"
            : "Use the average"}
      </Button>
    </Form>
  );
}

const rs = (paisa: number | undefined): string => (paisa ? String(paisa / 100) : "");

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
    <Form
      onSubmit={() => {
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
      <HStack gap={3}>
        <StackItem size="fill">
          <TextInput label="From" value={lender} onChange={setLender} width="100%" />
        </StackItem>
        <StackItem size="fill">
          <TextInput label="For" value={purpose} onChange={setPurpose} placeholder="Bicycle" width="100%" />
        </StackItem>
      </HStack>
      <MoneyInput label="Borrowed" value={principal} onChange={setPrincipal} />
      <MoneyInput
        label="Repay each month"
        value={installment}
        onChange={setInstallment}
        {...(p && i ? { description: `${Math.ceil(p / i)} installments` } : {})}
      />
      <Field label="Started">
        <Input type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
      </Field>
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        {loan ? "Save loan" : "Add loan"}
      </Button>
    </Form>
  );
}

function GoalForm({
  goal,
  count,
  onDone,
  onTakeOut,
}: {
  goal: Goal | undefined;
  count: number;
  onDone: () => void;
  onTakeOut: (goal: Goal) => void;
}) {
  const [name, setName] = useState(goal?.name ?? "");
  const [target, setTarget] = useState(rs(goal?.target));
  const [monthly, setMonthly] = useState(rs(goal?.monthly));
  const t = parseRs(target);
  const m = parseRs(monthly);
  return (
    <Form
      onSubmit={() => {
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
      <TextInput label="Name" value={name} onChange={setName} placeholder="New laptop" width="100%" />
      <MoneyInput label="Target" value={target} onChange={setTarget} />
      <MoneyInput
        label="Each month"
        value={monthly}
        onChange={setMonthly}
        {...(t && m ? { description: `About ${Math.ceil(t / m)} months` } : {})}
      />
      <Button type="submit" variant="primary" size="lg" disabled={!name.trim() || !t || m === null}>
        {goal ? "Save goal" : "Add goal"}
      </Button>
      {goal ? <Button onClick={() => onTakeOut(goal)}>Take money out</Button> : null}
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
    </Form>
  );
}

function MoveForm({ goal, dir, onDone }: { goal: Goal; dir: "in" | "out"; onDone: () => void }) {
  const [amount, setAmount] = useState(dir === "in" ? rs(goal.monthly) : "");
  const a = parseRs(amount);
  return (
    <Form
      onSubmit={() => {
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
      <MoneyInput label="Amount" value={amount} onChange={setAmount} autoFocus />
      <Button type="submit" variant="primary" size="lg" disabled={!a}>
        {`${dir === "in" ? "Add" : "Take out"} ${a ? formatRs(a) : ""}`.trim()}
      </Button>
    </Form>
  );
}
