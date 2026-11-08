import { type Dataset, formatRs, monthLabel, parseRs, type WhatIfInput, whatIf } from "@marqum/core";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/cn.ts";
import { CategoryIcon } from "./category-icon.tsx";
import { Waterfall } from "./charts.tsx";
import { Button } from "./ui/button.tsx";
import { Segmented, Slider } from "./ui/controls.tsx";
import { MoneyInput } from "./ui/input.tsx";
import { Sheet } from "./ui/sheet.tsx";

const VERDICT = {
  now: { label: "Affordable now", tone: "text-pos" },
  easy: { label: "Easy", tone: "text-pos" },
  stretch: { label: "Stretch", tone: "text-warn" },
  no: { label: "Not affordable", tone: "text-neg" },
} as const;

/** The headline often repeats the verdict ("Affordable now — leaves …"); show only the specific part under it. */
function withoutVerdict(headline: string, label: string): string {
  const rest = headline.startsWith(label)
    ? headline.slice(label.length).replace(/^\s*[—–-]\s*/, "")
    : headline;
  return rest ? rest[0]?.toUpperCase() + rest.slice(1) : headline;
}

/** Last Home card: type a price, see the verdict live; tap for the full plan. */
export function WhatIfCard({ ds, now }: { ds: Dataset; now: string }) {
  const [price, setPrice] = useState("");
  const [open, setOpen] = useState(false);
  const paisa = parseRs(price) ?? 0;
  const result = useMemo(
    () => (paisa > 0 ? whatIf(ds, { price: paisa, mode: "save" }, now) : null),
    [ds, paisa, now],
  );
  return (
    <div className="col-span-2 flex flex-col gap-3 rounded-card bg-surface p-4" data-testid="what-if-card">
      <div className="flex items-baseline justify-between">
        <h2 className="font-medium">What if I buy…</h2>
        {result ? (
          <span
            className={cn("text-sm font-medium transition-colors", VERDICT[result.verdict].tone)}
            data-testid="what-if-verdict"
          >
            {VERDICT[result.verdict].label}
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
          <span className="flex-1">{result.headline}</span>
          <ChevronRight className="shrink-0" aria-hidden />
        </button>
      ) : (
        <p className="text-sm text-fg-muted">
          Type a price to see if it fits this month, after saving, or on a loan.
        </p>
      )}
      <WhatIfSheet ds={ds} now={now} price={paisa} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function WhatIfSheet({
  ds,
  now,
  price,
  open,
  onOpenChange,
}: {
  ds: Dataset;
  now: string;
  price: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [mode, setMode] = useState<WhatIfInput["mode"]>("save");
  const [months, setMonths] = useState(6);
  const [levers, setLevers] = useState<Record<string, number>>({});
  const variable = useMemo(
    () =>
      ds.categories
        .filter((c) => c.parent_id === null && c.nature === "variable" && !c.hidden)
        .sort((a, b) => a.sort - b.sort),
    [ds],
  );
  const result = useMemo(() => {
    if (price <= 0) return null;
    const input: WhatIfInput = {
      price,
      mode,
      ...(mode === "loan" ? { loan_months: months } : {}),
      levers: Object.entries(levers)
        .filter(([, pct]) => pct !== 0)
        .map(([category_id, pct]) => ({ category_id, pct })),
    };
    return whatIf(ds, input, now);
  }, [ds, now, price, mode, months, levers]);
  const v = result ? VERDICT[result.verdict] : null;
  const delays = result?.goal_delays.filter((g) => g.months > 0) ?? [];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`What if I buy something for ${formatRs(price)}?`}>
      {result && v ? (
        <div className="flex flex-col gap-8" data-testid="what-if-sheet">
          <div className="flex flex-col gap-2">
            <span className={cn("font-display text-headline font-medium transition-colors", v.tone)}>
              {v.label}
            </span>
            <p className="text-fg-muted">{withoutVerdict(result.headline, v.label)}</p>
          </div>

          <div className="flex flex-col gap-3">
            <Segmented
              label="Plan"
              value={mode}
              onValueChange={setMode}
              options={[
                { value: "save", label: "Save first" },
                { value: "loan", label: "On a loan" },
              ]}
            />
            {mode === "loan" ? (
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span className="text-fg-muted">Repay over</span>
                  <span className="num font-medium">
                    {months} months · {formatRs(result.installment ?? 0)}/month
                  </span>
                </div>
                <Slider label="Months" value={months} onValueChange={setMonths} min={2} max={24} />
                {result.debt_free_month ? (
                  <p className="text-sm text-fg-muted">Debt-free by {monthLabel(result.debt_free_month)}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="font-medium">Where the {formatRs(result.model.income)} goes</h3>
            <Waterfall steps={result.waterfall} />
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between">
              <h3 className="font-medium">Spend less on</h3>
              {Object.values(levers).some((x) => x !== 0) ? (
                <Button variant="text" size="sm" onClick={() => setLevers({})}>
                  Reset
                </Button>
              ) : null}
            </div>
            {variable.map((c) => {
              const pct = levers[c.id] ?? 0;
              return (
                <div key={c.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm">
                    <CategoryIcon name={c.icon} className="text-fg-muted" />
                    <span className="flex-1">{c.name}</span>
                    <span className={cn("num", pct === 0 ? "text-fg-muted" : "font-medium")}>
                      {pct === 0 ? "as usual" : `${pct}%`}
                    </span>
                  </div>
                  <Slider
                    label={`Cut ${c.name}`}
                    value={-pct}
                    onValueChange={(x) => setLevers((l) => ({ ...l, [c.id]: -x }))}
                    min={0}
                    max={50}
                    step={5}
                  />
                </div>
              );
            })}
          </section>

          {delays.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">Goals that slip</h3>
              {delays.map((g) => (
                <p key={g.goal_id} className="flex justify-between text-sm">
                  <span>{g.name}</span>
                  <span className="num text-warn">
                    {g.months >= 600 ? "never reached" : `${g.months} months later`}
                  </span>
                </p>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
