import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Selector } from "@astryxdesign/core/Selector";
import { StackItem } from "@astryxdesign/core/Stack";
import { proportional, Table, type TableColumn } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addMonths,
  type Dataset,
  defaultAssumptions,
  type ForecastAssumptions,
  formatRs,
  monthLabel,
  monthlyIncome,
  monthOf,
  parseRs,
  type SavingsHistory,
  savingsHistory,
  type WhatIfInput,
  type WhatIfResult,
  whatIf,
} from "@marqum/core";
import { ChevronRight, Plus, X } from "lucide-react";
import { type Dispatch, type ReactNode, type SetStateAction, useMemo, useState } from "react";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { opt } from "../lib/opt.ts";
import { toast } from "../lib/toast.ts";
import { CategoryIcon } from "./category-icon.tsx";
import { ProjectionChart } from "./charts.tsx";
import { Money } from "./money.tsx";
import { Button } from "./ui/button.tsx";
import { Segmented, Slider } from "./ui/controls.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

const CONFIDENCE: Record<
  WhatIfResult["confidence"],
  { label: string; tone: string; badge: "success" | "info" | "warning" | "error" }
> = {
  solid: { label: "Solid", tone: "text-pos", badge: "success" },
  likely: { label: "Likely", tone: "text-fg", badge: "info" },
  risky: { label: "Risky", tone: "text-warn", badge: "warning" },
  no: { label: "Not affordable", tone: "text-neg", badge: "error" },
};

/** Last Home card: type a price, see the verdict live; tap for the full, adjustable plan. */
export function WhatIfCard({ ds, now }: { ds: Dataset; now: string }) {
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const paisa = parseRs(price) ?? 0;
  const savings = useMemo(() => savingsHistory(ds, now), [ds, now]);
  const result = useMemo(
    () => (paisa > 0 ? whatIf(ds, { price: paisa, mode: "save" }, now) : null),
    [ds, paisa, now],
  );
  const c = result ? CONFIDENCE[result.confidence] : null;
  return (
    <Card padding={4} data-testid="what-if-card">
      <VStack gap={3}>
        <HStack justify="between" vAlign="center">
          <Heading level={2}>What if I buy…</Heading>
          {c ? <Badge variant={c.badge} label={c.label} data-testid="what-if-verdict" /> : null}
        </HStack>
        <MoneyInput label="Price" hideLabel value={price} onChange={setPrice} />
        <SavingsBasis savings={savings} />
        {result ? (
          <Button
            variant="secondary"
            width="full"
            onClick={() => setOpen(true)}
            icon={<ChevronRight aria-hidden />}
          >
            {tidy(result.headline, c?.label ?? "")}
          </Button>
        ) : null}
      </VStack>
      <WhatIfSheet ds={ds} now={now} initialPrice={paisa} open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/**
 * What the verdict stands on, as plain arithmetic: your monthly saving across both wallets. Complete months are
 * listed with what each kept; the first month shows income − spending at your daily rate.
 */
export function SavingsBasis({ savings }: { savings: SavingsHistory; surplus?: number | null }) {
  if (savings.basis === "none" || savings.average === null) return null;
  const k = (v: number) => formatRs(v, { compact: true });
  return (
    <Card variant="muted" padding={3} data-testid="savings-basis">
      <VStack gap={1}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Text type="label">
            {savings.basis === "estimate" ? "You'll save this month" : "You save a month"}
          </Text>
          <Money
            value={savings.average}
            tone={savings.average < 0 ? "neg" : "pos"}
            className="font-semibold"
          />
        </HStack>
        {savings.basis === "estimate" ? (
          <Text type="supporting" hasTabularNumbers>
            {k(savings.income ?? 0)} in − {k(savings.spend ?? 0)} spent ({k(savings.per_day ?? 0)}/day ×
            month)
          </Text>
        ) : (
          <Text type="supporting" hasTabularNumbers>
            {savings.months.map((m) => `${monthLabel(m.month).slice(0, 3)} ${k(m.saved)}`).join(" · ")}
          </Text>
        )}
      </VStack>
    </Card>
  );
}

type LoanBy = "months" | "installment" | "schedule";

function WhatIfSheet({
  ds,
  now,
  initialPrice,
  open,
  onOpenChange,
}: {
  ds: Dataset;
  now: string;
  initialPrice: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="What if I buy it?">
      {open ? <WhatIfPlanner ds={ds} now={now} initialPrice={initialPrice} /> : null}
    </Sheet>
  );
}

function WhatIfPlanner({ ds, now, initialPrice }: { ds: Dataset; now: string; initialPrice: number }) {
  const current = monthOf(now);
  const defaults = useMemo(() => defaultAssumptions(ds, now), [ds, now]);
  const [price, setPrice] = useState(initialPrice ? String(initialPrice / 100) : "");
  const [mode, setMode] = useState<WhatIfInput["mode"]>("save");
  const [loanBy, setLoanBy] = useState<LoanBy>("months");
  const [months, setMonths] = useState(6);
  const [installment, setInstallment] = useState("");
  const [schedule, setSchedule] = useState<{ month: string; amount: string }[]>([
    { month: addMonths(current, 1), amount: "" },
  ]);
  const [start, setStart] = useState(addMonths(current, mode === "save" ? 0 : 1));
  const [a, setA] = useState<ForecastAssumptions>(defaults);

  const paisa = parseRs(price) ?? 0;
  const result = useMemo(() => {
    if (paisa <= 0) return null;
    const input: WhatIfInput = { price: paisa, mode, assumptions: a, start_month: start };
    if (mode === "loan") {
      if (loanBy === "months") input.loan_months = months;
      if (loanBy === "installment") {
        const i = parseRs(installment);
        if (i && i > 0) input.installment = i;
        else input.loan_months = months;
      }
      if (loanBy === "schedule") {
        const rows = schedule
          .map((r) => ({ month: r.month, amount: parseRs(r.amount) ?? 0 }))
          .filter((r) => r.amount > 0);
        if (rows.length > 0) input.schedule = rows;
        else input.loan_months = months;
      }
    }
    return whatIf(ds, input, now);
  }, [ds, now, paisa, mode, loanBy, months, installment, schedule, start, a]);

  const nextMonths = Array.from({ length: 24 }, (_, i) => addMonths(current, i));
  const c = result ? CONFIDENCE[result.confidence] : null;
  const delays = result?.goal_delays.filter((g) => g.months > 0) ?? [];
  const chart = useMemo(
    () => bandForChart(result, paisa, new Set(result?.risk_months ?? [])),
    [result, paisa],
  );

  return (
    <VStack gap={5} data-testid="what-if-sheet">
      <VStack gap={4}>
        <MoneyInput label="Price" value={price} onChange={setPrice} />
        <Segmented
          label="Pay by"
          value={mode}
          onValueChange={(m) => {
            setMode(m);
            setStart(addMonths(current, m === "save" ? 0 : 1));
          }}
          options={[
            { value: "save", label: "Saving first" },
            { value: "loan", label: "A loan" },
          ]}
        />
        {mode === "loan" ? (
          <VStack gap={3}>
            <Segmented
              label="Repay by"
              value={loanBy}
              onValueChange={setLoanBy}
              options={[
                { value: "months", label: "Months" },
                { value: "installment", label: "Installment" },
                { value: "schedule", label: "Custom" },
              ]}
            />
            {loanBy === "months" ? (
              <VStack gap={1}>
                <HStack justify="between" vAlign="center" gap={2}>
                  <Text type="label">Repay over</Text>
                  <Text weight="medium" hasTabularNumbers>
                    {months} mo{result?.installment ? ` · ${formatRs(result.installment)}/mo` : ""}
                  </Text>
                </HStack>
                <Slider label="Months" value={months} onValueChange={setMonths} min={2} max={24} />
              </VStack>
            ) : null}
            {loanBy === "installment" ? (
              <MoneyInput label="Each month" value={installment} onChange={setInstallment} />
            ) : null}
            {loanBy === "schedule" ? (
              <VStack gap={2}>
                {schedule.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
                  <HStack key={`${r.month}-${i}`} gap={2} vAlign="end">
                    <MonthSelect
                      label="Month"
                      value={r.month}
                      months={nextMonths}
                      onChange={(m) =>
                        setSchedule((s) => s.map((x, j) => (j === i ? { ...x, month: m } : x)))
                      }
                    />
                    <StackItem size="fill">
                      <MoneyInput
                        label="Repayment"
                        size="md"
                        value={r.amount}
                        onChange={(v) =>
                          setSchedule((s) => s.map((x, j) => (j === i ? { ...x, amount: v } : x)))
                        }
                      />
                    </StackItem>
                    <RemoveButton onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))} />
                  </HStack>
                ))}
                <AddButton
                  onClick={() =>
                    setSchedule((s) => [
                      ...s,
                      { month: addMonths(s.at(-1)?.month ?? current, 1), amount: "" },
                    ])
                  }
                >
                  Add a repayment
                </AddButton>
              </VStack>
            ) : null}
          </VStack>
        ) : null}
        <MonthSelect
          label={mode === "save" ? "Buy from" : "First repayment"}
          value={start}
          months={nextMonths}
          onChange={setStart}
          width="100%"
        />
      </VStack>

      {result && c ? (
        <>
          <SavingsBasis savings={result.savings} />
          <VStack gap={2} data-testid="what-if-outcome">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <StackItem className={cn("transition-colors", c.tone)}>
                <Heading level={3} type="display-3" color="inherit">
                  {c.label}
                </Heading>
              </StackItem>
              <Text>{tidy(result.headline, c.label)}</Text>
            </HStack>
            {result.risk_months.length > 0 ? (
              <HStack gap={1} vAlign="center" wrap="wrap">
                <Text type="supporting">Tight</Text>
                {result.risk_months.map((m) => (
                  <Badge key={m} variant="warning" label={shortMonth(m)} />
                ))}
              </HStack>
            ) : null}
          </VStack>

          <VStack gap={3}>
            <Heading level={3}>Savings · next {result.projection.length} months</Heading>
            <ProjectionChart showDebt={mode === "loan"} data={chart.points} />
            {chart.clamped ? <Text type="supporting">Range capped: little history yet.</Text> : null}
          </VStack>

          {delays.length > 0 ? (
            <VStack gap={1}>
              <Heading level={3}>Goals that slip</Heading>
              <List hasDividers density="compact">
                {delays.map((g) => (
                  <ListItem
                    key={g.goal_id}
                    label={g.name}
                    endContent={
                      <Badge variant="warning" label={g.months >= 600 ? "Never" : `+${g.months} mo`} />
                    }
                  />
                ))}
              </List>
            </VStack>
          ) : null}

          <Collapsible trigger={<Text weight="medium">Month by month</Text>} defaultIsOpen={false}>
            <ProjectionTable projection={result.projection} risk={result.risk_months} />
          </Collapsible>
        </>
      ) : (
        <Text color="secondary">Type a price.</Text>
      )}

      <AssumptionsEditor
        ds={ds}
        current={current}
        months={nextMonths}
        a={a}
        setA={setA}
        defaults={defaults}
      />
    </VStack>
  );
}

interface ProjectionRow extends Record<string, unknown> {
  month: string;
  risk: boolean;
  income: string;
  fixed: string;
  spending: string;
  goals: string;
  loans: string;
  oneOffs: string;
  left: string;
  short: boolean;
  savings: string;
}

const num = (key: keyof ProjectionRow & string, header: string): TableColumn<ProjectionRow> => ({
  key,
  header,
  align: "end",
});

const PROJECTION_COLUMNS: TableColumn<ProjectionRow>[] = [
  {
    key: "month",
    header: "Month",
    width: proportional(1, { minWidth: 76 }),
    renderCell: (r) =>
      r.risk ? <Badge variant="warning" label={shortMonth(r.month)} /> : <Text>{shortMonth(r.month)}</Text>,
  },
  num("income", "In"),
  num("fixed", "Fixed"),
  num("spending", "Spend"),
  num("goals", "Goals"),
  num("loans", "Loans"),
  num("oneOffs", "One-offs"),
  {
    ...num("left", "Left"),
    renderCell: (r) => <Text className={cn(r.short && "text-neg")}>{r.left}</Text>,
  },
  num("savings", "Savings"),
];

function ProjectionTable({ projection, risk }: { projection: WhatIfResult["projection"]; risk: string[] }) {
  const tight = new Set(risk);
  const data: ProjectionRow[] = projection.map((p) => ({
    month: p.month,
    risk: tight.has(p.month),
    income: short(p.income),
    fixed: short(p.fixed),
    spending: short(p.variable.expected),
    goals: short(p.goals),
    loans: short(p.loans),
    oneOffs: p.one_offs ? short(p.one_offs) : "—",
    left: short(p.surplus.expected),
    short: p.surplus.expected < 0,
    savings: short(p.savings.expected),
  }));
  return (
    <Table
      data={data}
      columns={PROJECTION_COLUMNS}
      idKey="month"
      density="compact"
      className="num"
      data-testid="projection-table"
    />
  );
}

function AssumptionsEditor({
  ds,
  current,
  months,
  a,
  setA,
  defaults,
}: {
  ds: Dataset;
  current: string;
  months: string[];
  a: ForecastAssumptions;
  setA: Dispatch<SetStateAction<ForecastAssumptions>>;
  defaults: ForecastAssumptions;
}) {
  const [open, setOpen] = useState(false);
  const variable = ds.categories
    .filter((x) => x.parent_id === null && x.nature === "variable" && !x.hidden)
    .sort((x, y) => x.sort - y.sort);
  const catPct = (id: string) => a.category_adjust.find((x) => x.category_id === id)?.pct ?? 0;
  const setOneOff = (
    i: number,
    f: (o: ForecastAssumptions["one_offs"][number]) => ForecastAssumptions["one_offs"][number],
  ) => setA((x) => ({ ...x, one_offs: x.one_offs.map((y, j) => (j === i ? f(y) : y)) }));

  return (
    <Collapsible
      isOpen={open}
      onOpenChange={setOpen}
      trigger={
        <VStack gap={0.5}>
          <Text weight="medium">Assumptions</Text>
          {open ? null : (
            <Text type="supporting" hasTabularNumbers>
              {formatRs(incomeNow(ds, a, current), { compact: true })} in · spend {pct(a.spend_adjust_pct)} ·{" "}
              {a.uncertainty}
            </Text>
          )}
        </VStack>
      }
    >
      <VStack gap={6}>
        <VStack gap={2}>
          <Text type="label">Income changes</Text>
          {a.income.map((step, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
            <HStack key={`${step.from}-${i}`} gap={2} vAlign="end">
              <MonthSelect
                label="From"
                value={step.from}
                months={months}
                onChange={(m) =>
                  setA((x) => ({ ...x, income: x.income.map((s, j) => (j === i ? { ...s, from: m } : s)) }))
                }
              />
              <StackItem size="fill">
                <MoneyInput
                  label="Income"
                  size="md"
                  value={String(step.amount / 100)}
                  onChange={(v) =>
                    setA((x) => ({
                      ...x,
                      income: x.income.map((s, j) => (j === i ? { ...s, amount: parseRs(v) ?? 0 } : s)),
                    }))
                  }
                />
              </StackItem>
              <RemoveButton
                onClick={() => setA((x) => ({ ...x, income: x.income.filter((_, j) => j !== i) }))}
              />
            </HStack>
          ))}
          <AddButton
            onClick={() =>
              setA((x) => ({
                ...x,
                income: [...x.income, { from: addMonths(current, 6), amount: incomeNow(ds, x, current) }],
              }))
            }
          >
            Add an income change
          </AddButton>
        </VStack>

        <PctSlider
          label="All spending"
          value={a.spend_adjust_pct}
          onChange={(v) => setA((x) => ({ ...x, spend_adjust_pct: v }))}
        />

        <VStack gap={4}>
          <Text type="label">By category</Text>
          {variable.map((cat) => (
            <PctSlider
              key={cat.id}
              label={cat.name}
              icon={<CategoryIcon name={cat.icon} className="text-fg-muted" />}
              value={catPct(cat.id)}
              onChange={(v) =>
                setA((x) => ({
                  ...x,
                  category_adjust: [
                    ...x.category_adjust.filter((y) => y.category_id !== cat.id),
                    ...(v === 0 ? [] : [{ category_id: cat.id, pct: v }]),
                  ],
                }))
              }
            />
          ))}
        </VStack>

        <VStack gap={2}>
          <Text type="label">One-offs</Text>
          {a.one_offs.map((o, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
            <Card key={`${o.month}-${i}`} variant="muted" padding={3}>
              <VStack gap={3}>
                <HStack gap={2} vAlign="end">
                  <StackItem size="fill">
                    <TextInput
                      label="What"
                      value={o.label}
                      placeholder="Eid"
                      onChange={(v) => setOneOff(i, (y) => ({ ...y, label: v }))}
                    />
                  </StackItem>
                  <RemoveButton
                    onClick={() => setA((x) => ({ ...x, one_offs: x.one_offs.filter((_, j) => j !== i) }))}
                  />
                </HStack>
                <HStack gap={2} vAlign="end">
                  <MonthSelect
                    label="Month"
                    value={o.month}
                    months={months}
                    onChange={(m) => setOneOff(i, (y) => ({ ...y, month: m }))}
                  />
                  <StackItem size="fill">
                    <Segmented
                      label="Direction"
                      value={o.amount >= 0 ? "in" : "out"}
                      onValueChange={(d) =>
                        setOneOff(i, (y) => ({
                          ...y,
                          amount: d === "in" ? Math.abs(y.amount) : -Math.abs(y.amount),
                        }))
                      }
                      options={[
                        { value: "out", label: "Cost" },
                        { value: "in", label: "Income" },
                      ]}
                    />
                  </StackItem>
                </HStack>
                <MoneyInput
                  label="Amount"
                  size="md"
                  value={o.amount ? String(Math.abs(o.amount) / 100) : ""}
                  onChange={(v) =>
                    setOneOff(i, (y) => ({
                      ...y,
                      amount: (y.amount >= 0 && y.amount !== 0 ? 1 : -1) * (parseRs(v) ?? 0),
                    }))
                  }
                />
              </VStack>
            </Card>
          ))}
          <AddButton
            onClick={() =>
              setA((x) => ({
                ...x,
                one_offs: [...x.one_offs, { month: addMonths(current, 3), amount: -2_000_000, label: "" }],
              }))
            }
          >
            Add a one-off
          </AddButton>
        </VStack>

        <Segmented
          label="Uncertainty"
          value={a.uncertainty}
          onValueChange={(u) => setA((x) => ({ ...x, uncertainty: u }))}
          options={[
            { value: "low", label: "Steady" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "Bumpy" },
          ]}
        />
        <Segmented
          label="Horizon"
          value={String(a.horizon_months) as "6" | "12" | "24"}
          onValueChange={(h) => setA((x) => ({ ...x, horizon_months: Number(h) }))}
          options={[
            { value: "6", label: "6 months" },
            { value: "12", label: "1 year" },
            { value: "24", label: "2 years" },
          ]}
        />

        <HStack gap={2} wrap="wrap">
          <Button
            variant="secondary"
            onClick={() => {
              void enqueue("setSetting", { key: "forecast", value: JSON.stringify(a) });
              toast({ tone: "success", title: "Saved as your defaults" });
            }}
          >
            Save as my defaults
          </Button>
          <Button variant="ghost" onClick={() => setA(defaults)}>
            Reset
          </Button>
        </HStack>
      </VStack>
    </Collapsible>
  );
}

/** Label, current ± %, and a centred −50…+50 slider. */
function PctSlider({
  label,
  value,
  onChange,
  icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  icon?: ReactNode;
}) {
  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center">
        {icon}
        <StackItem size="fill">
          <Text type="label">{label}</Text>
        </StackItem>
        <Text
          hasTabularNumbers
          {...(value === 0 ? { color: "secondary" as const } : { weight: "medium" as const })}
        >
          {pct(value)}
        </Text>
      </HStack>
      <Slider
        label={`Adjust ${label}`}
        value={value}
        onValueChange={onChange}
        min={-50}
        max={50}
        step={5}
        centered
      />
    </VStack>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <HStack>
      <Button variant="secondary" icon={<Plus aria-hidden />} onClick={onClick}>
        {children}
      </Button>
    </HStack>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Remove" onClick={onClick}>
      <X aria-hidden />
    </Button>
  );
}

/** Drop a leading restatement of the verdict ("Not affordable — …") and keep "Rs" with its figure. */
function tidy(text: string, verdict: string): string {
  let t = text;
  for (const lead of [verdict, "Affordable now", "Not affordable"]) {
    if (t.startsWith(lead) && t.length > lead.length + 3) {
      t = t.slice(lead.length).replace(/^\s*[—–-]\s*/, "");
      t = (t[0]?.toUpperCase() ?? "") + t.slice(1);
      break;
    }
  }
  return t.replace(/Rs /g, "Rs ");
}

/**
 * Chart points. With little history the best/worst band can dwarf the price; clamp it to ±3× the price around
 * the expected line so the chart stays readable, and say so.
 */
function bandForChart(result: WhatIfResult | null, price: number, risk: Set<string>) {
  if (!result) return { points: [], clamped: false };
  const cap = Math.max(price, 1) * 3;
  let clamped = false;
  const points = result.projection.map((p) => {
    const e = p.savings.expected;
    const low = Math.max(p.savings.low, e - cap);
    const high = Math.min(p.savings.high, e + cap);
    if (low !== p.savings.low || high !== p.savings.high) clamped = true;
    return { month: p.month, expected: e, low, high, debt: p.debt, risk: risk.has(p.month) };
  });
  return { points, clamped };
}

const short = (paisa: number): string => formatRs(paisa).replace(/^(−?)Rs\s/, "$1");
const pct = (v: number): string => (v === 0 ? "as usual" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`);
/** "Nov 26" */
const shortMonth = (m: string): string => `${monthLabel(m).slice(0, 3)} ${m.slice(2, 4)}`;

function incomeNow(ds: Dataset, a: ForecastAssumptions, month: string): number {
  // only the month matters to monthlyIncome
  const base = monthlyIncome(ds, `${month}-01T12:00`).amount;
  return a.income.length > 0 ? (a.income.at(-1)?.amount ?? base) : base;
}

function MonthSelect({
  label,
  value,
  months,
  onChange,
  width,
}: {
  label: string;
  value: string;
  months: string[];
  onChange: (m: string) => void;
  width?: string;
}) {
  const list = months.includes(value) ? months : [value, ...months];
  return (
    <Selector
      label={label}
      value={value}
      onChange={(m) => {
        if (m) onChange(m);
      }}
      options={list.map((m) => ({ value: m, label: monthLabel(m) }))}
      presentation="adaptive"
      {...opt({ width })}
    />
  );
}
