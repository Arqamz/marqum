import {
  addMonths,
  type Dataset,
  defaultAssumptions,
  type ForecastAssumptions,
  formatRs,
  monthLabel,
  monthOf,
  parseRs,
  type WhatIfInput,
  type WhatIfResult,
  whatIf,
} from "@marqum/core";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { toast } from "../lib/toast.ts";
import { CategoryIcon } from "./category-icon.tsx";
import { ProjectionChart } from "./charts.tsx";
import { Button } from "./ui/button.tsx";
import { Segmented, Slider } from "./ui/controls.tsx";
import { Field, Input, MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

const CONFIDENCE: Record<WhatIfResult["confidence"], { label: string; tone: string }> = {
  solid: { label: "Solid", tone: "text-pos" },
  likely: { label: "Likely", tone: "text-fg" },
  risky: { label: "Risky", tone: "text-warn" },
  no: { label: "Not affordable", tone: "text-neg" },
};

/** Last Home card: type a price, see the verdict live; tap for the full, adjustable plan. */
export function WhatIfCard({ ds, now }: { ds: Dataset; now: string }) {
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const paisa = parseRs(price) ?? 0;
  const result = useMemo(
    () => (paisa > 0 ? whatIf(ds, { price: paisa, mode: "save" }, now) : null),
    [ds, paisa, now],
  );
  const c = result ? CONFIDENCE[result.confidence] : null;
  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-card bg-surface p-4" data-testid="what-if-card">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">What if I buy…</h2>
        {c ? (
          <span className={cn("text-sm font-medium transition-colors", c.tone)} data-testid="what-if-verdict">
            {c.label}
          </span>
        ) : null}
      </div>
      <MoneyInput label="Price" value={price} onChange={setPrice} />
      {result ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="-mx-2 flex items-center gap-2 rounded-inner px-2 py-1 text-left text-sm text-fg-muted hover:bg-surface-2"
        >
          <span className="flex-1">{tidy(result.headline, c?.label ?? "")}</span>
          <ChevronRight className="shrink-0" aria-hidden />
        </button>
      ) : (
        <p className="text-sm text-fg-muted">Type a price to see when it fits — saving first or on a loan.</p>
      )}
      <WhatIfSheet ds={ds} now={now} initialPrice={paisa} open={open} onOpenChange={setOpen} />
    </div>
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
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showTable, setShowTable] = useState(false);

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
  const risk = new Set(result?.risk_months ?? []);
  const chart = useMemo(
    () => bandForChart(result, paisa, new Set(result?.risk_months ?? [])),
    [result, paisa],
  );
  const variable = ds.categories
    .filter((x) => x.parent_id === null && x.nature === "variable" && !x.hidden)
    .sort((x, y) => x.sort - y.sort);
  const catPct = (id: string) => a.category_adjust.find((x) => x.category_id === id)?.pct ?? 0;

  return (
    <div className="flex flex-col gap-8" data-testid="what-if-sheet">
      <div className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-3">
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
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Repay over</span>
                  <span className="num font-medium">
                    {months} months{result?.installment ? ` · ${formatRs(result.installment)}/month` : ""}
                  </span>
                </div>
                <Slider label="Months" value={months} onValueChange={setMonths} min={2} max={24} />
              </div>
            ) : null}
            {loanBy === "installment" ? (
              <Field label="Each month">
                <MoneyInput label="Installment" value={installment} onChange={setInstallment} />
              </Field>
            ) : null}
            {loanBy === "schedule" ? (
              <div className="flex flex-col gap-2">
                {schedule.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
                  <div key={`${r.month}-${i}`} className="flex items-center gap-2">
                    <MonthSelect
                      value={r.month}
                      months={nextMonths}
                      onChange={(m) =>
                        setSchedule((s) => s.map((x, j) => (j === i ? { ...x, month: m } : x)))
                      }
                    />
                    <MoneyInput
                      className="flex-1"
                      label="Repayment"
                      value={r.amount}
                      onChange={(v) =>
                        setSchedule((s) => s.map((x, j) => (j === i ? { ...x, amount: v } : x)))
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))}
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  className="self-start"
                  onClick={() =>
                    setSchedule((s) => [
                      ...s,
                      { month: addMonths(s.at(-1)?.month ?? current, 1), amount: "" },
                    ])
                  }
                >
                  <Plus aria-hidden />
                  Add a repayment
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        <Field label={mode === "save" ? "Buy no earlier than" : "First repayment"}>
          <MonthSelect value={start} months={nextMonths} onChange={setStart} />
        </Field>
      </div>

      {result && c ? (
        <>
          <div className="flex flex-col gap-2" data-testid="what-if-outcome">
            <span className={cn("font-display text-headline font-medium transition-colors", c.tone)}>
              {c.label}
            </span>
            <p>{tidy(result.headline, c.label)}</p>
            {result.risk_months.length > 0 ? (
              <p className="text-sm text-warn">
                Tight months: {result.risk_months.map((m) => monthLabel(m).slice(0, 3)).join(", ")}
              </p>
            ) : null}
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Free savings over the next {result.projection.length} months</h3>
            <ProjectionChart showDebt={mode === "loan"} data={chart.points} />
            {chart.clamped ? (
              <p className="text-sm text-fg-muted">
                Wide range — little history yet, so the best and worst cases are cut off.
              </p>
            ) : null}
          </section>

          {delays.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">Goals that slip</h3>
              {delays.map((g) => (
                <p key={g.goal_id} className="flex justify-between text-sm">
                  <span>{g.name}</span>
                  <span className="num text-warn">
                    {g.months >= 600
                      ? "never reached"
                      : `${g.months} ${g.months === 1 ? "month" : "months"} later`}
                  </span>
                </p>
              ))}
            </section>
          ) : null}

          <Disclosure open={showTable} onToggle={() => setShowTable((v) => !v)} label="Month by month">
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="num w-full min-w-[34rem] text-right text-sm" data-testid="projection-table">
                <thead className="text-fg-muted">
                  <tr>
                    <th className="py-1 text-left font-normal">Month</th>
                    <th className="font-normal">In</th>
                    <th className="font-normal">Fixed</th>
                    <th className="font-normal">Spending</th>
                    <th className="font-normal">Goals</th>
                    <th className="font-normal">Loans</th>
                    <th className="font-normal">One-offs</th>
                    <th className="font-normal">Left</th>
                    <th className="font-normal">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {result.projection.map((p) => (
                    <tr key={p.month} className={cn(risk.has(p.month) && "bg-warn-soft")}>
                      <td className="py-1 text-left">{monthLabel(p.month)}</td>
                      <td>{short(p.income)}</td>
                      <td>{short(p.fixed)}</td>
                      <td>{short(p.variable.expected)}</td>
                      <td>{short(p.goals)}</td>
                      <td>{short(p.loans)}</td>
                      <td>{p.one_offs ? short(p.one_offs) : "—"}</td>
                      <td className={cn(p.surplus.expected < 0 && "text-neg")}>
                        {short(p.surplus.expected)}
                      </td>
                      <td>{short(p.savings.expected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Disclosure>
        </>
      ) : (
        <p className="text-fg-muted">Type a price to see the plan.</p>
      )}

      <Disclosure
        open={showAssumptions}
        onToggle={() => setShowAssumptions((v) => !v)}
        label="Assumptions"
        hint={`${formatRs(incomeNow(ds, a))} income · spending ${pct(a.spend_adjust_pct)} · ${a.uncertainty} uncertainty`}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">Income changes</span>
            {a.income.map((step, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
              <div key={`${step.from}-${i}`} className="flex items-center gap-2">
                <span className="text-sm">From</span>
                <MonthSelect
                  value={step.from}
                  months={nextMonths}
                  onChange={(m) =>
                    setA((x) => ({ ...x, income: x.income.map((s, j) => (j === i ? { ...s, from: m } : s)) }))
                  }
                />
                <MoneyInput
                  className="flex-1"
                  label="Monthly income"
                  value={String(step.amount / 100)}
                  onChange={(v) =>
                    setA((x) => ({
                      ...x,
                      income: x.income.map((s, j) => (j === i ? { ...s, amount: parseRs(v) ?? 0 } : s)),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove"
                  onClick={() => setA((x) => ({ ...x, income: x.income.filter((_, j) => j !== i) }))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                setA((x) => ({
                  ...x,
                  income: [...x.income, { from: addMonths(current, 6), amount: incomeNow(ds, x) }],
                }))
              }
            >
              <Plus aria-hidden />
              Add an income change
            </Button>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-sm">
              <span className="text-fg-muted">All spending</span>
              <span className="num font-medium">{pct(a.spend_adjust_pct)}</span>
            </div>
            <Slider
              label="Adjust all spending"
              value={a.spend_adjust_pct}
              onValueChange={(v) => setA((x) => ({ ...x, spend_adjust_pct: v }))}
              min={-50}
              max={50}
              step={5}
              centered
            />
          </div>

          <div className="flex flex-col gap-4">
            <span className="text-sm text-fg-muted">By category</span>
            {variable.map((cat) => (
              <div key={cat.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <CategoryIcon name={cat.icon} className="text-fg-muted" />
                  <span className="flex-1">{cat.name}</span>
                  <span className={cn("num", catPct(cat.id) === 0 ? "text-fg-muted" : "font-medium")}>
                    {pct(catPct(cat.id))}
                  </span>
                </div>
                <Slider
                  label={`Adjust ${cat.name}`}
                  value={catPct(cat.id)}
                  onValueChange={(v) =>
                    setA((x) => ({
                      ...x,
                      category_adjust: [
                        ...x.category_adjust.filter((y) => y.category_id !== cat.id),
                        ...(v === 0 ? [] : [{ category_id: cat.id, pct: v }]),
                      ],
                    }))
                  }
                  min={-50}
                  max={50}
                  step={5}
                  centered
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm text-fg-muted">Known one-offs (Eid, a wedding, a bonus)</span>
            {a.one_offs.map((o, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: editable rows have no identity of their own
              <div key={`${o.month}-${i}`} className="flex flex-col gap-2 rounded-control bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-10 flex-1"
                    aria-label="What"
                    value={o.label}
                    placeholder="Eid"
                    onChange={(e) =>
                      setA((x) => ({
                        ...x,
                        one_offs: x.one_offs.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)),
                      }))
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove"
                    onClick={() => setA((x) => ({ ...x, one_offs: x.one_offs.filter((_, j) => j !== i) }))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <MonthSelect
                    value={o.month}
                    months={nextMonths}
                    onChange={(m) =>
                      setA((x) => ({
                        ...x,
                        one_offs: x.one_offs.map((y, j) => (j === i ? { ...y, month: m } : y)),
                      }))
                    }
                  />
                  <Segmented
                    className="flex-1"
                    label="Direction"
                    value={o.amount >= 0 ? "in" : "out"}
                    onValueChange={(d) =>
                      setA((x) => ({
                        ...x,
                        one_offs: x.one_offs.map((y, j) =>
                          j === i
                            ? { ...y, amount: d === "in" ? Math.abs(y.amount) : -Math.abs(y.amount) }
                            : y,
                        ),
                      }))
                    }
                    options={[
                      { value: "out", label: "Cost" },
                      { value: "in", label: "Income" },
                    ]}
                  />
                </div>
                <MoneyInput
                  label="Amount"
                  value={o.amount ? String(Math.abs(o.amount) / 100) : ""}
                  onChange={(v) =>
                    setA((x) => ({
                      ...x,
                      one_offs: x.one_offs.map((y, j) =>
                        j === i
                          ? { ...y, amount: (y.amount >= 0 && y.amount !== 0 ? 1 : -1) * (parseRs(v) ?? 0) }
                          : y,
                      ),
                    }))
                  }
                />
              </div>
            ))}
            <Button
              variant="secondary"
              className="self-start"
              onClick={() =>
                setA((x) => ({
                  ...x,
                  one_offs: [...x.one_offs, { month: addMonths(current, 3), amount: -2_000_000, label: "" }],
                }))
              }
            >
              <Plus aria-hidden />
              Add a one-off
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3">
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
          </div>

          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>
      </Disclosure>
    </div>
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
  return t.replace(/Rs /g, "Rs\u00a0");
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

function incomeNow(ds: Dataset, a: ForecastAssumptions): number {
  const base = Number(ds.settings.find((s) => s.id === "income_monthly")?.value ?? "8500000");
  return a.income.length > 0 ? (a.income.at(-1)?.amount ?? base) : base;
}

function MonthSelect({
  value,
  months,
  onChange,
}: {
  value: string;
  months: string[];
  onChange: (m: string) => void;
}) {
  const list = months.includes(value) ? months : [value, ...months];
  return (
    <select
      aria-label="Month"
      className="h-12 rounded-control border border-border bg-surface px-3"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {list.map((m) => (
        <option key={m} value={m}>
          {monthLabel(m)}
        </option>
      ))}
    </select>
  );
}

function Disclosure({
  open,
  onToggle,
  label,
  hint,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 text-left"
      >
        <span className="flex flex-1 flex-col">
          <span className="font-medium">{label}</span>
          {hint && !open ? <span className="num text-sm text-fg-muted">{hint}</span> : null}
        </span>
        <ChevronDown className={cn("shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? children : null}
    </section>
  );
}
