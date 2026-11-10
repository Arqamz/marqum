import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { formatRs } from "@marqum/core";
import type { ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { monthShort } from "../lib/months.ts";

/*
 * Chart marks follow the dataviz rules: thin bars with 4px rounded data-ends on the baseline, a 2px surface
 * gap between adjacent bars, recessive axes, hover tooltips, no dual axes. Colours are Astryx tokens only:
 * spending / current in accent, income in success, over-budget in error.
 */

const C = {
  accent: "var(--color-accent)",
  soft: "var(--color-accent-muted)",
  income: "var(--color-text-success)",
  over: "var(--color-text-error)",
  warn: "var(--color-warning)",
  warnSoft: "var(--color-warning-muted)",
  muted: "var(--color-text-secondary)",
  cursor: "var(--color-background-muted)",
  rule: "var(--color-border-emphasized)",
} as const;

const AXIS = { fontSize: 12, fill: C.muted } as const;
const compact = (paisa: number): string => {
  const sign = paisa < 0 ? "−" : "";
  const rs = Math.abs(paisa) / 100;
  return sign + compactAbs(rs);
};
const compactAbs = (rs: number): string => {
  if (rs >= 100_000) return `${Number((rs / 100_000).toFixed(rs >= 1_000_000 ? 0 : 1))}L`;
  if (rs >= 1000) return `${Math.round(rs / 1000)}k`;
  return String(Math.round(rs));
};

function TipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding={2} elevation="med">
      <VStack gap={0.5}>
        <Text type="supporting" hasTabularNumbers>
          {title}
        </Text>
        {children}
      </VStack>
    </Card>
  );
}

/** One tooltip line. */
function Tip({ children, strong, className }: { children: ReactNode; strong?: boolean; className?: string }) {
  return (
    <Text
      hasTabularNumbers
      {...(strong ? { weight: "medium" as const } : {})}
      {...(className ? { className } : {})}
    >
      {children}
    </Text>
  );
}

/** Legend key: a dot, a line or a band in a token colour. */
function Key({
  color,
  shape = "dot",
  children,
}: {
  color: string;
  shape?: "dot" | "line" | "band";
  children: string;
}) {
  return (
    <HStack gap={2} vAlign="center">
      <svg width="16" height="8" viewBox="0 0 16 8" aria-hidden>
        {shape === "dot" ? (
          <circle cx="4" cy="4" r="4" fill={color} />
        ) : shape === "line" ? (
          <rect y="3" width="16" height="2" rx="1" fill={color} />
        ) : (
          <rect width="16" height="8" rx="2" fill={color} />
        )}
      </svg>
      <Text type="supporting">{children}</Text>
    </HStack>
  );
}

const monthTitle = (m: string): string => `${monthShort(m)} ${m.slice(0, 4)}`;
const dayTitle = (d: string): string => `${Number(d.slice(8, 10))} ${monthShort(d.slice(0, 7))}`;

export interface MonthBar {
  month: string;
  value: number;
  outlier?: boolean;
  current?: boolean;
}

/**
 * One bar per month; the current month in accent, the others soft accent, unusual months amber. With 6 or fewer
 * bars the axis shows "Nov", otherwise "N".
 */
export function MonthlyBars({
  data,
  average,
  onSelect,
}: {
  data: MonthBar[];
  average?: number | null;
  onSelect?: (month: string) => void;
}) {
  const short = data.length <= 6;
  return (
    <VStack className="h-44 w-full" data-testid="monthly-bars">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => (short ? monthShort(m) : monthShort(m).slice(0, 1))}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ fill: C.cursor }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as MonthBar | undefined;
              if (!active || !p) return null;
              return (
                <TipBox title={monthTitle(p.month)}>
                  <Tip strong>{formatRs(p.value)}</Tip>
                  {p.outlier ? <Tip className="text-warn">Unusual month</Tip> : null}
                </TipBox>
              );
            }}
          />
          {average ? (
            <ReferenceLine y={average} stroke={C.muted} strokeDasharray="4 4" ifOverflow="extendDomain" />
          ) : null}
          <Bar
            dataKey="value"
            radius={[4, 4, 0, 0]}
            maxBarSize={short ? 40 : 28}
            isAnimationActive={false}
            {...(onSelect
              ? {
                  onClick: (d: { payload?: MonthBar }) => d.payload && onSelect(d.payload.month),
                  cursor: "pointer",
                }
              : {})}
          >
            {data.map((d) => (
              <Cell key={d.month} fill={d.outlier ? C.warn : d.current ? C.accent : C.soft} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </VStack>
  );
}

/** Sent vs received per month: two series, legend + direct identity, one axis. */
export function SentReceived({ data }: { data: { month: string; sent: number; received: number }[] }) {
  return (
    <VStack gap={2}>
      <HStack gap={4} aria-hidden>
        <Key color={C.accent}>Sent</Key>
        <Key color={C.income}>Received</Key>
      </HStack>
      <VStack className="h-48 w-full">
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
              cursor={{ fill: C.cursor }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as
                  | { month: string; sent: number; received: number }
                  | undefined;
                if (!active || !p) return null;
                return (
                  <TipBox title={monthTitle(p.month)}>
                    <Tip>Sent {formatRs(p.sent)}</Tip>
                    <Tip>Received {formatRs(p.received)}</Tip>
                  </TipBox>
                );
              }}
            />
            <Bar
              dataKey="sent"
              name="Sent"
              fill={C.accent}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
            <Bar
              dataKey="received"
              name="Received"
              fill={C.income}
              radius={[4, 4, 0, 0]}
              maxBarSize={14}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </VStack>
    </VStack>
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
  return (
    <VStack className="h-56 w-full" data-testid="waterfall">
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
          <ReferenceLine y={0} stroke={C.rule} />
          <Tooltip
            cursor={{ fill: C.cursor }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <TipBox title={p.label}>
                  <Tip strong>{formatRs(p.amount, { sign: !p.total })}</Tip>
                </TipBox>
              );
            }}
          />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="w" radius={[4, 4, 4, 4]} maxBarSize={32} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.amount < 0 ? (d.total ? C.over : C.accent) : C.income} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </VStack>
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
  const w = 100 / Math.max(1, values.length);
  return (
    <VStack gap={1} role="img" aria-label={label}>
      <svg className="h-8 w-full" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden>
        {values.map((v, i) => (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed buckets
            key={i}
            x={i * w + 0.25}
            width={w - 0.5}
            height={32}
            rx={1}
            fill={C.accent}
            fillOpacity={v === 0 ? 0.08 : 0.15 + 0.85 * (v / max)}
          >
            <title>{`${labels[i]}: ${v}`}</title>
          </rect>
        ))}
      </svg>
      <HStack justify="between">
        <Text type="supporting" size="xsm">
          {labels[0]}
        </Text>
        <Text type="supporting" size="xsm">
          {labels[Math.floor(labels.length / 2)]}
        </Text>
        <Text type="supporting" size="xsm">
          {labels.at(-1)}
        </Text>
      </HStack>
    </VStack>
  );
}

/** Every day of a month as thin bars, with the usual daily level as a dashed line (Screen Time style). */
export function DailyBars({
  data,
  average,
}: {
  data: { date: string; value: number }[];
  average?: number | null;
}) {
  return (
    <VStack className="h-44 w-full" data-testid="daily-bars">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => String(Number(d.slice(8, 10)))}
            ticks={data
              .filter((d) => [1, 8, 15, 22, 29].includes(Number(d.date.slice(8, 10))))
              .map((d) => d.date)}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={[0, "dataMax"]} />
          <Tooltip
            cursor={{ fill: C.cursor }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { date: string; value: number } | undefined;
              if (!active || !p) return null;
              return (
                <TipBox title={dayTitle(p.date)}>
                  <Tip strong>{formatRs(p.value)}</Tip>
                </TipBox>
              );
            }}
          />
          {average ? (
            <ReferenceLine y={average} stroke={C.muted} strokeDasharray="4 4" ifOverflow="extendDomain" />
          ) : null}
          <Bar
            dataKey="value"
            fill={C.accent}
            radius={[2, 2, 0, 0]}
            maxBarSize={10}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </VStack>
  );
}

/** Closing balance at the end of each day. */
export function BalanceLine({ data }: { data: { date: string; closing: number }[] }) {
  return (
    <VStack className="h-40 w-full" data-testid="balance-line">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => String(Number(d.slice(8, 10)))}
            ticks={data
              .filter((d) => [1, 8, 15, 22, 29].includes(Number(d.date.slice(8, 10))))
              .map((d) => d.date)}
            tick={AXIS}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            width={36}
            tickFormatter={compact}
            domain={["auto", "auto"]}
          />
          <Tooltip
            cursor={{ stroke: C.rule }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as { date: string; closing: number } | undefined;
              if (!active || !p) return null;
              return (
                <TipBox title={dayTitle(p.date)}>
                  <Tip strong>{formatRs(p.closing)}</Tip>
                </TipBox>
              );
            }}
          />
          <Line
            type="stepAfter"
            dataKey="closing"
            stroke={C.accent}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </VStack>
  );
}

export interface ProjectionPoint {
  month: string;
  expected: number;
  low: number;
  high: number;
  debt?: number;
  risk?: boolean;
}

/** Expected savings with a best/worst band; debt as a second line in loan mode (same axis, both in rupees). */
export function ProjectionChart({ data, showDebt }: { data: ProjectionPoint[]; showDebt?: boolean }) {
  const rows = data.map((d) => ({ ...d, band: [d.low, d.high] as [number, number] }));
  return (
    <VStack gap={2}>
      <HStack gap={4} wrap="wrap" aria-hidden>
        <Key color={C.accent} shape="line">
          Savings
        </Key>
        <Key color={C.soft} shape="band">
          Best–worst
        </Key>
        {showDebt ? (
          <Key color={C.over} shape="line">
            Debt
          </Key>
        ) : null}
      </HStack>
      <VStack className="h-56 w-full" data-testid="projection-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => monthShort(m).slice(0, 1)}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} tickFormatter={compact} />
            <ReferenceLine y={0} stroke={C.rule} />
            {data
              .filter((d) => d.risk)
              .map((d) => (
                <ReferenceArea
                  key={d.month}
                  x1={d.month}
                  x2={d.month}
                  fill={C.warnSoft}
                  fillOpacity={1}
                  ifOverflow="visible"
                />
              ))}
            <Tooltip
              cursor={{ stroke: C.rule }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as ProjectionPoint | undefined;
                if (!active || !p) return null;
                return (
                  <TipBox title={monthTitle(p.month)}>
                    <Tip strong>Savings {formatRs(p.expected)}</Tip>
                    <Tip className="text-fg-muted">
                      {formatRs(p.low)} – {formatRs(p.high)}
                    </Tip>
                    {showDebt && p.debt ? <Tip>Debt {formatRs(p.debt)}</Tip> : null}
                    {p.risk ? <Tip className="text-warn">Tight month</Tip> : null}
                  </TipBox>
                );
              }}
            />
            <Area dataKey="band" stroke="none" fill={C.soft} fillOpacity={1} isAnimationActive={false} />
            <Line
              dataKey="expected"
              stroke={C.accent}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {showDebt ? (
              <Line dataKey="debt" stroke={C.over} strokeWidth={2} dot={false} isAnimationActive={false} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </VStack>
    </VStack>
  );
}
