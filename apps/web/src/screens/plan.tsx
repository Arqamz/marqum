import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { IconButton } from "@astryxdesign/core/IconButton";
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
  isClosed,
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
import { ChevronRight, Plus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { CategoryIcon } from "../components/category-icon.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Money } from "../components/money.tsx";
import { RecurringForm } from "../components/recurring-form.tsx";
import { Screen } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmButton } from "../components/ui/confirm-button.tsx";
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
import { toast } from "../lib/toast.ts";
import { lookup, txnTitle } from "../lib/view.ts";

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
  | { kind: "loanEdit"; loan: Loan }
  | { kind: "loanPay"; loan: Loan }
  | { kind: "goal"; goal?: Goal }
  | { kind: "goalEdit"; goal: Goal }
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
  const [txnId, setTxnId] = useState<string | null>(null);
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
                      {g.goal.achieved_on ? (
                        <Badge label={`Bought ${dayLabel(g.goal.achieved_on)}`} variant="success" />
                      ) : done ? (
                        <Badge label="Reached" variant="success" />
                      ) : (
                        <Text type="supporting" hasTabularNumbers>
                          {formatRs(g.goal.monthly)}/month
                          {g.eta_month ? ` · ready by ${monthLabel(g.eta_month)}` : ""}
                        </Text>
                      )}
                    </StackItem>
                    {g.goal.achieved_on ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Plus aria-hidden />}
                        onClick={() => setEdit({ kind: "move", goal: g.goal, dir: "in" })}
                      >
                        Add money
                      </Button>
                    )}
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

      <PlanSheets
        ds={ds}
        now={now}
        edit={edit}
        onEdit={setEdit}
        onClose={() => setEdit(null)}
        onOpenTxn={(id) => {
          setEdit(null);
          setTxnId(id);
        }}
      />
      <TagSheet txn={ds.transactions.find((t) => t.id === txnId) ?? null} onClose={() => setTxnId(null)} />
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
  onOpenTxn,
}: {
  ds: Dataset;
  now: string;
  edit: Edit | null;
  onEdit: (e: Edit) => void;
  onClose: () => void;
  onOpenTxn: (id: string) => void;
}) {
  // the sheet shows the live row, so it reflects saves made from it
  const loan =
    edit && "loan" in edit && edit.loan ? (ds.loans.find((x) => x.id === edit.loan?.id) ?? null) : null;
  const goal =
    edit && "goal" in edit && edit.goal ? (ds.goals.find((x) => x.id === edit.goal?.id) ?? null) : null;
  const title =
    edit?.kind === "income"
      ? "Income from Arqam (Meezan)"
      : edit?.kind === "loan" || edit?.kind === "loanEdit"
        ? loan
          ? `${loan.lender} · ${loan.purpose}`
          : "New loan"
        : edit?.kind === "loanPay"
          ? `Record a payment · ${edit.loan.lender}`
          : edit?.kind === "goal" || edit?.kind === "goalEdit"
            ? (goal?.name ?? "New goal")
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
      {edit?.kind === "loan" && loan ? (
        <LoanDetail ds={ds} now={now} loan={loan} onEdit={onEdit} onDone={onClose} onOpenTxn={onOpenTxn} />
      ) : null}
      {(edit?.kind === "loan" && !edit.loan) || edit?.kind === "loanEdit" ? (
        <LoanForm
          ds={ds}
          loan={loan ?? undefined}
          onDone={() => (loan ? onEdit({ kind: "loan", loan }) : onClose())}
        />
      ) : null}
      {edit?.kind === "loanPay" && loan ? (
        <LoanPayForm ds={ds} loan={loan} onDone={() => onEdit({ kind: "loan", loan })} />
      ) : null}
      {edit?.kind === "goal" && goal ? (
        <GoalDetail ds={ds} now={now} goal={goal} onEdit={onEdit} onDone={onClose} />
      ) : null}
      {(edit?.kind === "goal" && !edit.goal) || edit?.kind === "goalEdit" ? (
        <GoalForm
          goal={goal ?? undefined}
          count={ds.goals.length}
          onDone={() => (goal ? onEdit({ kind: "goal", goal }) : onClose())}
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

/** Repayments of a loan: transactions tagged "Loan payment" to it, newest first. */
const loanPayments = (ds: Dataset, loan: Loan) =>
  ds.transactions
    .filter((t) => !t.deleted && t.loan_id === loan.id && t.flow === "loan_repay")
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

function LoanDetail({
  ds,
  now,
  loan,
  onEdit,
  onDone,
  onOpenTxn,
}: {
  ds: Dataset;
  now: string;
  loan: Loan;
  onEdit: (e: Edit) => void;
  onDone: () => void;
  onOpenTxn: (id: string) => void;
}) {
  const st = loanStatus(ds, now).find((x) => x.loan.id === loan.id);
  const payments = loanPayments(ds, loan);
  const l = lookup(ds);
  if (!st) return null;
  const open = st.outstanding > 0;
  const today = karachiNow().slice(0, 10);
  const save = (patch: Partial<Loan>) =>
    void enqueue("upsertLoan", {
      loan_id: loan.id,
      lender: loan.lender,
      counterparty_id: loan.counterparty_id,
      principal: loan.principal,
      started_on: loan.started_on,
      purpose: loan.purpose,
      installment: loan.installment,
      note: loan.note,
      manual_repaid: loan.manual_repaid,
      closed_on: loan.closed_on,
      ...patch,
    });
  return (
    <VStack gap={5} data-testid="loan-detail">
      <VStack gap={2}>
        <Money
          value={st.outstanding}
          tone={open ? "neg" : "pos"}
          className="font-display text-4xl font-medium"
        />
        <Text color="secondary" hasTabularNumbers>
          {open
            ? `left of ${formatRs(loan.principal)} · ${formatRs(loan.installment)}/mo${st.payoff_month ? ` · clear by ${monthLabel(st.payoff_month)}` : ""}`
            : loan.closed_on
              ? `Marked paid off ${dayLabel(loan.closed_on)}`
              : `Repaid ${formatRs(st.repaid)} of ${formatRs(loan.principal)}`}
        </Text>
        <ProgressBar
          label="Repaid"
          isLabelHidden
          value={st.progress * 100}
          variant={open ? "accent" : "success"}
        />
      </VStack>

      {open ? (
        <Button variant="primary" size="lg" onClick={() => onEdit({ kind: "loanPay", loan })}>
          Record a payment
        </Button>
      ) : null}

      <VStack gap={2}>
        <Text type="label">Payments</Text>
        {payments.length === 0 && loan.manual_repaid === 0 ? (
          <Text type="supporting">
            None yet. Tag a transfer as “Loan payment” and pick this loan, or record one here.
          </Text>
        ) : (
          <Card variant="muted" padding={0}>
            <List hasDividers density="compact">
              {payments.map((t) => (
                <ListItem
                  key={t.id}
                  label={dayLabel(t.occurred_at.slice(0, 10))}
                  description={`${l.account.get(t.account_id) ?? ""} · ${txnTitle(t, l)}${t.status === "verified" ? "" : " · unverified"}`}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      <Money value={Math.abs(t.amount)} />
                      <ChevronRight size={16} aria-hidden />
                    </HStack>
                  }
                  onClick={() => onOpenTxn(t.id)}
                />
              ))}
              {loan.manual_repaid > 0 ? (
                <ListItem
                  label="Outside the wallets"
                  description="Cash or another account"
                  endContent={<Money value={loan.manual_repaid} />}
                  onClick={() => onEdit({ kind: "loanEdit", loan })}
                />
              ) : null}
            </List>
          </Card>
        )}
      </VStack>

      <VStack gap={2}>
        <Button variant="secondary" width="full" onClick={() => onEdit({ kind: "loanEdit", loan })}>
          Edit details
        </Button>
        {loan.closed_on ? (
          <Button variant="secondary" width="full" onClick={() => save({ closed_on: null })}>
            Not paid off yet
          </Button>
        ) : (
          <ConfirmButton
            variant="secondary"
            label="Mark paid off"
            confirm={
              open
                ? `Tap again: clear it, ${formatRs(st.outstanding)} stops counting as debt`
                : "Tap again: mark paid off"
            }
            onConfirm={() => save({ closed_on: today })}
          />
        )}
        <ConfirmButton
          label="Delete loan"
          confirm={`Tap again: delete ${loan.lender} · ${loan.purpose}`}
          onConfirm={() => {
            void enqueue("deleteLoan", { loan_id: loan.id });
            onDone();
          }}
        />
        {payments.length > 0 ? (
          <Text type="supporting">Deleting keeps its payments as loan payments, just unlinked.</Text>
        ) : null}
      </VStack>
    </VStack>
  );
}

/** The lender as a counterparty: the loan's own, else one whose name matches. */
function lenderId(ds: Dataset, loan: Pick<Loan, "counterparty_id" | "lender">): string | null {
  if (loan.counterparty_id) return loan.counterparty_id;
  const name = loan.lender.trim().toLowerCase();
  return ds.counterparties.find((c) => !c.deleted && c.name.toLowerCase() === name)?.id ?? null;
}

/** Pick the transfer that repaid the loan (to the lender first, then newest), or add a cash payment. */
function LoanPayForm({ ds, loan, onDone }: { ds: Dataset; loan: Loan; onDone: () => void }) {
  const [cash, setCash] = useState("");
  const c = parseRs(cash);
  const lender = lenderId(ds, loan);
  const l = lookup(ds);
  const options = ds.transactions
    .filter(
      (t) =>
        !t.deleted &&
        t.amount < 0 &&
        t.occurred_at.slice(0, 10) >= loan.started_on &&
        (t.flow === "spend" || (t.flow === "loan_repay" && t.loan_id === null)) &&
        // repayments are transfers to people, not card spends at merchants
        l.counterparty.get(t.counterparty_id ?? "")?.kind !== "merchant" &&
        t.bank_type?.toLowerCase().includes("card") !== true &&
        !isClosed(ds, monthOf(t.occurred_at)),
    )
    .sort(
      (a, b) =>
        Number(b.counterparty_id === lender && lender !== null) -
          Number(a.counterparty_id === lender && lender !== null) ||
        b.occurred_at.localeCompare(a.occurred_at),
    )
    .slice(0, 10);
  const link = (txnId: string) => {
    void enqueue("tagTransaction", {
      txn_id: txnId,
      flow: "loan_repay",
      loan_id: loan.id,
      category_id: null,
    });
    onDone();
  };
  return (
    <VStack gap={5}>
      <VStack gap={2}>
        <Text type="label">Which transfer paid it?</Text>
        {options.length === 0 ? (
          <Text type="supporting">No outgoing transfers since {dayLabel(loan.started_on)}.</Text>
        ) : (
          <Card variant="muted" padding={0}>
            <List hasDividers density="compact">
              {options.map((t) => (
                <ListItem
                  key={t.id}
                  label={txnTitle(t, l)}
                  description={`${dayLabel(t.occurred_at.slice(0, 10))} · ${l.account.get(t.account_id) ?? ""}`}
                  endContent={<Money value={Math.abs(t.amount)} />}
                  onClick={() => link(t.id)}
                />
              ))}
            </List>
          </Card>
        )}
      </VStack>
      <Form
        onSubmit={() => {
          if (!c) return;
          void enqueue("upsertLoan", {
            loan_id: loan.id,
            lender: loan.lender,
            counterparty_id: loan.counterparty_id,
            principal: loan.principal,
            started_on: loan.started_on,
            purpose: loan.purpose,
            installment: loan.installment,
            note: loan.note,
            manual_repaid: loan.manual_repaid + c,
            closed_on: loan.closed_on,
          });
          onDone();
        }}
      >
        <MoneyInput
          label="Paid in cash or from another account"
          value={cash}
          onChange={setCash}
          description="Not from SadaPay or NayaPay"
        />
        <Button type="submit" variant="secondary" disabled={!c}>
          {c ? `Add ${formatRs(c)} paid outside` : "Add payment"}
        </Button>
      </Form>
    </VStack>
  );
}

function GoalDetail({
  ds,
  now,
  goal,
  onEdit,
  onDone,
}: {
  ds: Dataset;
  now: string;
  goal: Goal;
  onEdit: (e: Edit) => void;
  onDone: () => void;
}) {
  const st = goalStatus(ds, now).find((x) => x.goal.id === goal.id);
  const moves = ds.goal_moves
    .filter((m) => !m.deleted && m.goal_id === goal.id)
    .sort((a, b) => b.on.localeCompare(a.on) || b.id.localeCompare(a.id));
  if (!st) return null;
  const today = karachiNow().slice(0, 10);
  const save = (achieved_on: string | null) =>
    enqueue("upsertGoal", {
      goal_id: goal.id,
      name: goal.name,
      icon: goal.icon,
      target: goal.target,
      monthly: goal.monthly,
      priority: goal.priority,
      achieved_on,
    });
  const removeMove = (m: (typeof moves)[number]) => {
    void enqueue("deleteGoalMove", { move_id: m.id });
    toast({
      tone: "neutral",
      title: `Removed ${formatRs(Math.abs(m.amount))} ${m.amount > 0 ? "added" : "taken out"}`,
      action: {
        label: "Undo",
        run: () =>
          void enqueue("moveGoal", {
            move_id: m.id,
            goal_id: m.goal_id,
            amount: m.amount,
            on: m.on,
            note: m.note,
          }),
      },
    });
  };
  // a withdrawal can't be undone below zero: only offer removing a move the envelope can lose
  const canRemove = (m: (typeof moves)[number]) => st.saved - m.amount >= 0;
  return (
    <VStack gap={5} data-testid="goal-detail">
      <VStack gap={2}>
        <Money value={st.saved} className="font-display text-4xl font-medium" />
        <Text color="secondary" hasTabularNumbers>
          {goal.achieved_on
            ? `of ${formatRs(goal.target)} · bought ${dayLabel(goal.achieved_on)}`
            : `of ${formatRs(goal.target)} · ${formatRs(goal.monthly)}/month${st.eta_month ? ` · ready by ${monthLabel(st.eta_month)}` : ""}`}
        </Text>
        <ProgressBar
          label="Saved"
          isLabelHidden
          value={st.progress * 100}
          variant={st.progress >= 1 ? "success" : "accent"}
        />
      </VStack>

      {goal.achieved_on ? null : (
        <HStack gap={2}>
          <StackItem size="fill">
            <Button variant="primary" width="full" onClick={() => onEdit({ kind: "move", goal, dir: "in" })}>
              Add money
            </Button>
          </StackItem>
          {st.saved > 0 ? (
            <StackItem size="fill">
              <Button
                variant="secondary"
                width="full"
                onClick={() => onEdit({ kind: "move", goal, dir: "out" })}
              >
                Take money out
              </Button>
            </StackItem>
          ) : null}
        </HStack>
      )}

      <VStack gap={2}>
        <Text type="label">Set aside</Text>
        {moves.length === 0 ? (
          <Text type="supporting">Nothing yet. “Add money” sets SadaPay money aside for this goal.</Text>
        ) : (
          <Card variant="muted" padding={0}>
            <List hasDividers density="compact">
              {moves.map((m) => (
                <ListItem
                  key={m.id}
                  label={dayLabel(m.on)}
                  description={m.note ?? (m.amount > 0 ? "Added" : "Taken out")}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      <Money value={m.amount} {...(m.amount > 0 ? { tone: "pos" as const } : {})} />
                      {canRemove(m) ? (
                        <IconButton
                          label="Remove"
                          size="sm"
                          variant="ghost"
                          icon={<X aria-hidden />}
                          onClick={() => removeMove(m)}
                        />
                      ) : null}
                    </HStack>
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </VStack>

      <VStack gap={2}>
        {goal.achieved_on ? (
          <Button variant="secondary" width="full" onClick={() => void save(null)}>
            Not bought yet
          </Button>
        ) : (
          <ConfirmButton
            variant="secondary"
            label={st.saved > 0 ? `Bought it · spend the ${formatRs(st.saved)}` : "Bought it"}
            confirm={
              st.saved > 0
                ? `Tap again: ${formatRs(st.saved)} leaves the envelope, goal done`
                : "Tap again: mark it done"
            }
            onConfirm={() => {
              void (async () => {
                if (st.saved > 0)
                  await enqueue("moveGoal", {
                    move_id: newId(),
                    goal_id: goal.id,
                    amount: -st.saved,
                    on: today,
                    note: `Spent on ${goal.name}`,
                  });
                await save(today);
              })();
            }}
          />
        )}
        <Button variant="secondary" width="full" onClick={() => onEdit({ kind: "goalEdit", goal })}>
          Edit details
        </Button>
        <ConfirmButton
          label="Delete goal"
          confirm={`Tap again: delete ${goal.name}${st.saved > 0 ? `, free ${formatRs(st.saved)}` : ""}`}
          onConfirm={() => {
            void enqueue("deleteGoal", { goal_id: goal.id });
            onDone();
          }}
        />
        {st.saved > 0 ? (
          <Text type="supporting">Deleting frees the {formatRs(st.saved)} set aside back into SadaPay.</Text>
        ) : null}
      </VStack>
    </VStack>
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

function LoanForm({ ds, loan, onDone }: { ds: Dataset; loan: Loan | undefined; onDone: () => void }) {
  const [lender, setLender] = useState(loan?.lender ?? "Mom");
  const [purpose, setPurpose] = useState(loan?.purpose ?? "");
  const [principal, setPrincipal] = useState(rs(loan?.principal));
  const [installment, setInstallment] = useState(rs(loan?.installment));
  const [outside, setOutside] = useState(rs(loan?.manual_repaid));
  const [started, setStarted] = useState(loan?.started_on ?? karachiNow().slice(0, 10));
  const p = parseRs(principal);
  const i = parseRs(installment);
  const m = outside.trim() === "" ? 0 : parseRs(outside);
  const ok = lender.trim() && purpose.trim() && p && i && m !== null;
  return (
    <Form
      onSubmit={() => {
        if (!ok || !p || !i || m === null) return;
        // a lender you also send money to (a counterparty with that name) lets payments to them be found first
        const name = lender.trim();
        const cp =
          loan && loan.lender === name
            ? loan.counterparty_id
            : lenderId(ds, { counterparty_id: null, lender: name });
        void enqueue("upsertLoan", {
          loan_id: loan?.id ?? newId(),
          lender: name,
          counterparty_id: cp ?? null,
          principal: p,
          started_on: started,
          purpose: purpose.trim(),
          installment: i,
          note: loan?.note ?? null,
          manual_repaid: m,
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
      {loan ? (
        <MoneyInput
          label="Repaid outside the wallets"
          value={outside}
          onChange={setOutside}
          description="Cash or another account. Wallet payments count on their own."
        />
      ) : null}
      <Button type="submit" variant="primary" size="lg" disabled={!ok}>
        {loan ? "Save loan" : "Add loan"}
      </Button>
      {loan ? null : (
        <Text type="supporting">
          Repayments: tag each transfer as “Loan payment” and pick this loan, or open the loan and record one.
        </Text>
      )}
    </Form>
  );
}

function GoalForm({ goal, count, onDone }: { goal: Goal | undefined; count: number; onDone: () => void }) {
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
