import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  addMonths,
  categoryMonthDetail,
  categorySeries,
  type Dataset,
  daysInMonth,
  formatRs,
  isClosed,
  monthOf,
  trackingStartMonth,
} from "@marqum/core";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { AddToCategorySheet } from "../components/add-to-category.tsx";
import { DailyBars, MonthlyBars } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { ExpectedRows } from "../components/expected-list.tsx";
import { Money } from "../components/money.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Segmented, Skeleton } from "../components/ui/controls.tsx";
import { monthShort } from "../lib/months.ts";
import { opt } from "../lib/opt.ts";
import {
  type PeriodMode,
  periodLabel,
  periodLength,
  periodMonths,
  periodNeighbours,
} from "../lib/periods.ts";
import { lookup } from "../lib/view.ts";

const MODES: { value: PeriodMode; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "6m", label: "6 months" },
  { value: "year", label: "Year" },
];
const UNIT: Record<PeriodMode, string> = { month: "month", "6m": "6 months", year: "year" };

export function CategoryScreen({ id, month }: { id: string; month?: string | undefined }) {
  const ds = useDataset();
  const now = useNow();
  const name = ds?.categories.find((c) => c.id === id)?.name;
  const [adding, setAdding] = useState(false);
  const category = ds?.categories.find((c) => c.id === id);
  return (
    <Screen
      back
      {...(name ? { title: name } : {})}
      actions={
        category ? (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus aria-hidden />}
            onClick={() => setAdding(true)}
            data-testid="category-add"
          >
            Add
          </Button>
        ) : null
      }
    >
      {ds && category ? (
        <AddToCategorySheet ds={ds} category={category} open={adding} onOpenChange={setAdding} />
      ) : null}
      {ds ? (
        <CategoryContent key={id} ds={ds} now={now} id={id} month={month ?? monthOf(now)} />
      ) : (
        <VStack gap={4}>
          <Skeleton height={32} width="75%" />
          <Skeleton height={176} />
        </VStack>
      )}
    </Screen>
  );
}

const pct = (a: number, b: number): number => Math.round(((a - b) / b) * 100);

/** ▲ 12% (red: spent more) / ▼ 8% (green: spent less). Nothing for 0% or no baseline. */
function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0 || !Number.isFinite(value)) return null;
  return (
    <Badge label={`${value > 0 ? "▲" : "▼"} ${Math.abs(value)}%`} variant={value > 0 ? "error" : "success"} />
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <StackItem size="fill">
      <VStack gap={0.5}>
        <Text type="supporting">{label}</Text>
        {children}
      </VStack>
    </StackItem>
  );
}

/** One category over a month, 6 months or a year: total, one chart (swipe to page), four stats, the rows. */
function CategoryContent({ ds, now, id, month }: { ds: Dataset; now: string; id: string; month: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<PeriodMode>("month");
  const l = useMemo(() => lookup(ds), [ds]);
  const category = l.category.get(id);
  const current = monthOf(now);
  const first = useMemo(() => {
    const start = trackingStartMonth(ds);
    return month < start ? month : start;
  }, [ds, month]);
  const { prev, next } = periodNeighbours(mode, month, first, current);

  const detail = useMemo(() => categoryMonthDetail(ds, id, month, now), [ds, id, month, now]);
  const monthly = useMemo(
    () => new Map(categorySeries(ds, id, 1200, now).map((p) => [p.month, p] as const)),
    [ds, id, now],
  );
  const months = useMemo(() => periodMonths(mode, month), [mode, month]);
  const subtree = useMemo(
    () => new Set([id, ...ds.categories.filter((c) => c.parent_id === id).map((c) => c.id)]),
    [ds, id],
  );
  const txns = useMemo(() => {
    const inPeriod = new Set(months);
    return ds.transactions.filter(
      (t) => t.category_id !== null && subtree.has(t.category_id) && inPeriod.has(monthOf(t.occurred_at)),
    );
  }, [ds, subtree, months]);

  // Paging: swipe the chart left = earlier, right = later (as asked), or ←/→ on the focused chart.
  const go = (m: string | null) => {
    if (!m) return;
    void navigate({ to: "/category/$id", params: { id }, search: { month: m }, replace: true });
  };
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const dir = useRef(0);
  const page = (to: "prev" | "next") => {
    const m = to === "prev" ? prev : next;
    if (!m) return;
    dir.current = to === "prev" ? -1 : 1;
    go(m);
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - s.y) * 1.5) return;
    page(dx < 0 ? "prev" : "next");
  };

  // A short slide-in when the period or mode changes; skipped under reduced motion.
  const chart = useRef<HTMLElement | null>(null);
  const shown = `${mode}:${month}`;
  const last = useRef(shown);
  useEffect(() => {
    if (last.current === shown) return;
    last.current = shown;
    const el = chart.current;
    if (!el || typeof el.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        { opacity: 0, transform: `translateX(${dir.current * 16}px)` },
        { opacity: 1, transform: "translateX(0)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    dir.current = 0;
  }, [shown]);

  if (!category) return <Text color="secondary">That category no longer exists.</Text>;

  const spentIn = (m: string) => monthly.get(m)?.value ?? 0;
  const counted = (ms: string[]) => ms.filter((m) => m >= first && m <= current);
  const isMonth = mode === "month";
  const total = isMonth ? detail.total : months.reduce((s, m) => s + spentIn(m), 0);
  const avg = detail.average;
  const vsAvg = isMonth && avg ? pct(detail.total, avg) : null;

  // Stats for the selected mode and period.
  const days = month === current ? Number(now.slice(8, 10)) : daysInMonth(month);
  const span = isMonth ? days : counted(months).length;
  const perUnit = span > 0 ? Math.round(total / span) : 0;
  const top = isMonth
    ? detail.daily.reduce((b, d) => (d.value > b.value ? d : b), { date: "", value: 0 })
    : months.reduce((b, m) => (spentIn(m) > b.value ? { date: m, value: spentIn(m) } : b), {
        date: "",
        value: 0,
      });
  const prevAnchor = addMonths(month, -periodLength(mode));
  const prevTotal = isMonth
    ? detail.prev_month_total
    : periodMonths(mode, prevAnchor).reduce((s, m) => s + spentIn(m), 0);
  // only compare against a period that was tracked in full
  const prevTracked = periodMonths(mode, prevAnchor)[0] ?? prevAnchor;
  const vsPrev = prevTotal > 0 && prevTracked >= trackingStartMonth(ds) ? pct(total, prevTotal) : null;

  return (
    <>
      <Card data-testid="category-total">
        <VStack gap={2}>
          <HStack justify="between" vAlign="center" gap={2}>
            <Button
              variant="ghost"
              size="icon"
              label={prev ? `Previous ${UNIT[mode]}, ${periodLabel(mode, prev)}` : "No earlier period"}
              disabled={!prev}
              onClick={() => page("prev")}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Text type="supporting" weight="medium" data-testid="pager-month">
              {periodLabel(mode, month)}
            </Text>
            <Button
              variant="ghost"
              size="icon"
              label={next ? `Next ${UNIT[mode]}, ${periodLabel(mode, next)}` : "No later period"}
              disabled={!next}
              onClick={() => page("next")}
            >
              <ChevronRight aria-hidden />
            </Button>
          </HStack>
          <HStack justify="center" vAlign="center" gap={3}>
            <Money
              value={total}
              className="font-display text-hero font-medium"
              {...opt({
                tone: category.budget && isMonth && total > category.budget ? ("neg" as const) : undefined,
              })}
            />
            <Delta value={vsAvg} />
          </HStack>
          {isMonth ? (
            <HStack justify="center" gap={3} wrap="wrap">
              <Text type="supporting" hasTabularNumbers>
                {avg === null ? "no average yet" : `avg ${formatRs(avg)}`}
              </Text>
              {category.budget ? (
                <Text type="supporting" hasTabularNumbers>
                  budget {formatRs(category.budget)}
                </Text>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
      </Card>

      <HStack hAlign="center">
        <Segmented label="Period" value={mode} onValueChange={setMode} options={MODES} size="sm" />
      </HStack>

      <VStack
        ref={chart}
        tabIndex={0}
        role="group"
        aria-label={`${periodLabel(mode, month)} chart. Swipe or use arrow keys to change period.`}
        aria-roledescription="pager"
        data-testid="category-chart"
        className="touch-pan-y select-none rounded-md focus-visible:outline-2 focus-visible:outline-accent"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") page("prev");
          else if (e.key === "ArrowRight") page("next");
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {isMonth ? (
          <DailyBars data={detail.daily} average={avg ? Math.round(avg / daysInMonth(month)) : null} />
        ) : (
          <MonthlyBars
            average={avg}
            onSelect={(m) => {
              setMode("month");
              go(m);
            }}
            data={months.map((m) => ({
              month: m,
              value: spentIn(m),
              outlier: (monthly.get(m)?.outlier ?? false) && m !== current,
              current: m === current,
            }))}
          />
        )}
      </VStack>

      <HStack gap={3} data-testid="category-stats">
        <Stat label={isMonth ? "Per day" : "Per month"}>
          <Money value={perUnit} className="font-medium" />
        </Stat>
        <Stat label={isMonth ? "Top day" : "Top month"}>
          <Money value={top.value} className="font-medium" />
        </Stat>
        <Stat label="Txns">
          <Text weight="medium" hasTabularNumbers>
            {txns.length}
          </Text>
        </Stat>
        <Stat label={isMonth ? `vs ${monthShort(prevAnchor)}` : "vs before"}>
          {vsPrev === null ? (
            <Text color="secondary">—</Text>
          ) : vsPrev === 0 ? (
            <Text weight="medium">0%</Text>
          ) : (
            <Text weight="medium" hasTabularNumbers className={vsPrev > 0 ? "text-neg" : "text-pos"}>
              {`${vsPrev > 0 ? "▲" : "▼"} ${Math.abs(vsPrev)}%`}
            </Text>
          )}
        </Stat>
      </HStack>

      <Section title="Transactions">
        {isMonth ? <ExpectedRows charges={detail.expected} onOpenTxn={(id) => setOpen(id)} /> : null}
        {txns.length > 0 ? (
          <TxnList
            txns={txns}
            l={l}
            now={now}
            onOpen={(t) => setOpen(t.id)}
            isClosedMonth={(m) => isClosed(ds, m)}
          />
        ) : !isMonth || detail.expected.length === 0 ? (
          <Text color="secondary">Nothing yet.</Text>
        ) : null}
      </Section>
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
