import { formatRs } from "@marqum/core";
import type { ReactNode } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthShort } from "../lib/months.ts";

/*
 * Chart marks follow the dataviz rules: thin bars with 4px rounded data-ends on the baseline, a 2px surface
 * gap between adjacent bars, recessive axes, hover tooltips, no dual axes. Colours come from tokens.
 */

const AXIS = { fontSize: 12, fill: "var(--fg-muted)" } as const;
const compact = (paisa: number): string => {
  const sign = paisa < 0 ? "−" : "";
  const rs = Math.abs(paisa) / 100;
  return sign + compactAbs(rs);
};
const compactAbs = (rs: number): string => {
  if (rs >= 100_000) return `${(rs / 100_000).toFixed(rs >= 1_000_000 ? 0 : 1)}L`;
  if (rs >= 1000) return `${Math.round(rs / 1000)}k`;
  return String(Math.round(rs));
};

function TipBox({ children }: { children: ReactNode }) {
  return <div className="num rounded-control bg-surface px-3 py-2 text-sm shadow-float">{children}</div>;
}

export interface MonthBar {
  month: string;
  value: number;
  outlier?: boolean;
  current?: boolean;
}

/** 12-month bars; the current month is the darker neutral, unusual months amber with a label in the tooltip. */
export function MonthlyBars({ data, average }: { data: MonthBar[]; average?: number | null }) {
  return (
    <div className="h-48 w-full" data-testid="monthly-bars">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthShort(m).slice(0, 1)}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as MonthBar | undefined;
              if (!active || !p) return null;
              return (
                <TipBox>
                  <div className="text-fg-muted">
                    {monthShort(p.month)} {p.month.slice(0, 4)}
                  </div>
                  <div className="font-medium">{formatRs(p.value)}</div>
                  {p.outlier ? <div className="text-warn">Unusual month</div> : null}
                </TipBox>
              );
            }}
          />
          {average ? (
            <ReferenceLine
              y={average}
              stroke="var(--fg-muted)"
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />
          ) : null}
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
            {data.map((d) => (
              <Cell
                key={d.month}
                fill={
                  d.outlier ? "var(--warn-line)" : d.current ? "var(--chart-bar-current)" : "var(--chart-bar)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sent vs received per month: two series, legend + direct identity, one axis. */
export function SentReceived({ data }: { data: { month: string; sent: number; received: number }[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-4 text-sm text-fg-muted" aria-hidden>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--chart-out)]" />
          Sent
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--chart-in)]" />
          Received
        </span>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap={6}
          >
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => monthShort(m).slice(0, 1)}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as
                  | { month: string; sent: number; received: number }
                  | undefined;
                if (!active || !p) return null;
                return (
                  <TipBox>
                    <div className="text-fg-muted">
                      {monthShort(p.month)} {p.month.slice(0, 4)}
                    </div>
                    <div>Sent {formatRs(p.sent)}</div>
                    <div>Received {formatRs(p.received)}</div>
                  </TipBox>
                );
              }}
            />
            <Bar
              dataKey="sent"
              name="Sent"
              fill="var(--chart-out)"
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <Bar
              dataKey="received"
              name="Received"
              fill="var(--chart-in)"
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const TOTALS = new Set(["Income", "Surplus", "Left"]);
/** Axis labels short enough for a phone; the tooltip carries the full label. */
const SHORT: Record<string, string> = {
  Income: "In",
  Committed: "Fixed",
  "Variable spending": "Usual",
  Goals: "Goals",
  Surplus: "Surplus",
  "Saving for this": "Plan",
  "Loan installment": "Plan",
  Left: "Left",
};

/** Income → committed → variable → goals → surplus → plan → left. Totals are solid, steps float. */
export function Waterfall({ steps }: { steps: { label: string; amount: number }[] }) {
  let running = 0;
  const data = steps.map((s) => {
    if (TOTALS.has(s.label)) {
      running = s.amount;
      return {
        label: s.label,
        base: Math.min(0, s.amount),
        span: Math.abs(s.amount),
        amount: s.amount,
        total: true,
      };
    }
    const from = running;
    running += s.amount;
    return {
      label: s.label,
      base: Math.min(from, running),
      span: Math.abs(s.amount),
      amount: s.amount,
      total: false,
    };
  });
  const left = steps.at(-1)?.amount ?? 0;
  return (
    <div className="h-56 w-full" data-testid="waterfall">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis
            dataKey="label"
            tick={{ ...AXIS, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            tickFormatter={(l: string) => SHORT[l] ?? l}
          />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} tickFormatter={compact} />
          <ReferenceLine y={0} stroke="var(--border-strong)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <TipBox>
                  <div className="text-fg-muted">{p.label}</div>
                  <div className="font-medium">{formatRs(p.amount, { sign: !p.total })}</div>
                </TipBox>
              );
            }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="w" radius={[4, 4, 4, 4]} maxBarSize={32} isAnimationActive={false}>
            {data.map((d) => (
              <Cell
                key={d.label}
                fill={
                  d.label === "Left"
                    ? left < 0
                      ? "var(--neg)"
                      : "var(--pos)"
                    : d.total
                      ? "var(--chart-bar-current)"
                      : "var(--chart-bar)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Small sequential strip (one hue, light→dark) for weekday / hour patterns. */
export function PatternStrip({
  values,
  labels,
  label,
}: {
  values: number[];
  labels: string[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex flex-col gap-1" role="img" aria-label={label}>
      <div className="flex gap-0.5">
        {values.map((v, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed buckets
            key={i}
            title={`${labels[i]}: ${v}`}
            className="h-8 flex-1 rounded-chip bg-fg"
            style={{ opacity: v === 0 ? 0.06 : 0.15 + 0.85 * (v / max) }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels.at(-1)}</span>
      </div>
    </div>
  );
}
