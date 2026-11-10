import { Badge } from "@astryxdesign/core/Badge";
import { Card } from "@astryxdesign/core/Card";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  availableMonths,
  categoryMonthDetail,
  categorySeries,
  type Dataset,
  daysInMonth,
  formatRs,
  isClosed,
  monthOf,
} from "@marqum/core";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { AddToCategorySheet } from "../components/add-to-category.tsx";
import { DailyBars, MonthlyBars } from "../components/charts.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { ExpectedRows } from "../components/expected-list.tsx";
import { Money } from "../components/money.tsx";
import { MonthPager } from "../components/month-pager.tsx";
import { Screen, Section } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { TxnList } from "../components/txn-list.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { monthName } from "../lib/months.ts";
import { opt } from "../lib/opt.ts";
import { lookup } from "../lib/view.ts";

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
        <CategoryContent ds={ds} now={now} id={id} month={month ?? monthOf(now)} />
      ) : (
        <VStack gap={4}>
          <Skeleton height={32} width="75%" />
          <Skeleton height={160} />
        </VStack>
      )}
    </Screen>
  );
}

/** Screen Time for a category: the month's total, its days, its year, its parts, its rows. */
function CategoryContent({ ds, now, id, month }: { ds: Dataset; now: string; id: string; month: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const l = useMemo(() => lookup(ds), [ds]);
  const category = l.category.get(id);
  const months = useMemo(() => {
    const list = availableMonths(ds, now);
    return list.includes(month) ? list : [...list, month].sort();
  }, [ds, now, month]);
  const detail = useMemo(() => categoryMonthDetail(ds, id, month, now), [ds, id, month, now]);
  const series = useMemo(() => categorySeries(ds, id, 12, now), [ds, id, now]);
  const subtree = useMemo(
    () => new Set([id, ...ds.categories.filter((c) => c.parent_id === id).map((c) => c.id)]),
    [ds, id],
  );
  const txns = useMemo(
    () =>
      ds.transactions.filter(
        (t) => t.category_id !== null && subtree.has(t.category_id) && monthOf(t.occurred_at) === month,
      ),
    [ds, subtree, month],
  );
  const go = (m: string) =>
    void navigate({ to: "/category/$id", params: { id }, search: { month: m }, replace: true });

  if (!category) return <Text color="secondary">That category no longer exists.</Text>;
  const avg = detail.average;
  const target = category.budget ?? avg;
  const outliers = series.filter((p) => p.outlier && p.month !== monthOf(now));
  const dailyAvg = avg ? Math.round(avg / daysInMonth(month)) : null;
  // Pace: how much of the target should be gone by today (all of it for a past month).
  const elapsed = month === monthOf(now) ? Number(now.slice(8, 10)) / daysInMonth(month) : 1;
  const pace: "success" | "warning" | "error" | null =
    target === null || target <= 0
      ? null
      : detail.total > target
        ? "error"
        : detail.total > target * elapsed
          ? "warning"
          : "success";
  const vsAvg = avg ? Math.round(((detail.total - avg) / avg) * 100) : null;

  return (
    <>
      <MonthPager months={months} month={month} onChange={go}>
        <Card data-testid="category-total">
          <VStack gap={3}>
            <HStack justify="between" vAlign="center" gap={3}>
              <Money
                value={detail.total}
                className="font-display text-hero font-medium"
                {...opt({ tone: pace === "error" ? ("neg" as const) : undefined })}
              />
              {vsAvg !== null && vsAvg !== 0 ? (
                <Badge
                  label={`${vsAvg > 0 ? "▲" : "▼"} ${Math.abs(vsAvg)}%`}
                  variant={vsAvg > 0 ? "error" : "success"}
                />
              ) : null}
            </HStack>
            {target !== null && pace !== null ? (
              <ProgressBar
                label={category.budget ? "Spent of budget" : "Spent of average"}
                isLabelHidden
                value={Math.min(detail.total, target)}
                max={target}
                variant={pace}
              />
            ) : null}
            <HStack gap={3} wrap="wrap">
              <Text type="supporting" hasTabularNumbers>
                {avg === null ? "no average yet" : `avg ${formatRs(avg)}`}
              </Text>
              {category.budget ? (
                <Text type="supporting" hasTabularNumbers>
                  budget {formatRs(category.budget)}
                </Text>
              ) : null}
            </HStack>
          </VStack>
        </Card>
        <DailyBars data={detail.daily} average={dailyAvg} />
      </MonthPager>

      <Section
        title="Last 12 months"
        aside={outliers.length > 0 ? <Badge label={`${outliers.length} unusual`} variant="warning" /> : null}
      >
        <MonthlyBars
          average={avg}
          onSelect={go}
          data={series.map((p) => ({
            month: p.month,
            value: p.value,
            outlier: p.outlier && p.month !== monthOf(now),
            current: p.month === month,
          }))}
        />
      </Section>

      {detail.parts.length > 0 ? (
        <Section title={`${category.name} in ${monthName(month)}`}>
          <List data-testid="parts" edge="flush">
            {detail.parts
              .filter((p) => p.spent > 0 || (p.average ?? 0) > 0)
              .map((p) => (
                <ListItem
                  key={p.id}
                  label={p.name}
                  description={
                    <VStack gap={1}>
                      <ProgressBar
                        label={p.name}
                        isLabelHidden
                        value={Math.round(p.share * 100)}
                        variant="accent"
                      />
                      {p.average ? (
                        <Text type="supporting" hasTabularNumbers>
                          avg {formatRs(p.average)}
                        </Text>
                      ) : null}
                    </VStack>
                  }
                  endContent={
                    <HStack gap={3} vAlign="center">
                      <Text type="supporting" hasTabularNumbers>
                        {Math.round(p.share * 100)}%
                      </Text>
                      <Money value={p.spent} className="font-medium" />
                    </HStack>
                  }
                />
              ))}
          </List>
        </Section>
      ) : null}

      <Section title="Transactions">
        <ExpectedRows charges={detail.expected} onOpenTxn={(id) => setOpen(id)} />
        {txns.length > 0 ? (
          <TxnList
            txns={txns}
            l={l}
            now={now}
            onOpen={(t) => setOpen(t.id)}
            isClosedMonth={(m) => isClosed(ds, m)}
          />
        ) : detail.expected.length === 0 ? (
          <Text color="secondary">Nothing in {monthName(month)}.</Text>
        ) : null}
      </Section>
      <TagSheet
        txn={open ? (ds.transactions.find((t) => t.id === open) ?? null) : null}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
