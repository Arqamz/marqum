import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { StackItem } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import {
  type CategoryCard,
  categoryCards,
  type Dataset,
  dayLabel,
  debtStatus,
  formatRs,
  monthLabel,
  monthLedger,
  monthOf,
  monthPulse,
  netPosition,
  suggestOpeningBalance,
  unverifiedSummary,
  type WalletPosition,
} from "@marqum/core";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, Plus } from "lucide-react";
import { useMemo } from "react";
import { WalletLogo } from "../components/brand-logo.tsx";
import { CategoryTile } from "../components/category-icon.tsx";
import { CloseBanner } from "../components/close-banner.tsx";
import { useDataset, useNow } from "../components/dataset-provider.tsx";
import { Glance, useGlance } from "../components/glance.tsx";
import { HeroAmount, TweenMoney } from "../components/money.tsx";
import { openQuickAdd } from "../components/quick-add.tsx";
import { Screen } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { Skeleton } from "../components/ui/controls.tsx";
import { WhatIfCard } from "../components/what-if.tsx";
import { cn } from "../lib/cn.ts";
import { enqueue } from "../lib/commands.ts";
import { isNative } from "../lib/platform.ts";
import { firstTrackedMonth } from "../lib/tracking.ts";

export function HomeScreen() {
  const ds = useDataset();
  const now = useNow();
  const np = useMemo(() => (ds ? netPosition(ds, now) : null), [ds, now]);
  const debt = useMemo(() => (ds ? debtStatus(ds, now) : null), [ds, now]);
  const [glance, closeGlance] = useGlance();
  return (
    <Screen
      actions={
        <Button size="icon" variant="ghost" label="Add a transaction" onClick={() => openQuickAdd()}>
          <Plus aria-hidden />
        </Button>
      }
    >
      {ds ? <HomeContent ds={ds} now={now} /> : <HomeSkeleton />}
      {glance ? (
        <Glance
          net={np ? np.net : null}
          wallets={np ? np.wallets : []}
          alarm={!!debt && debt.in_debt && !debt.affordable}
          onDone={closeGlance}
        />
      ) : null}
    </Screen>
  );
}

function HomeSkeleton() {
  return (
    <VStack gap={6} aria-busy>
      <VStack gap={3} hAlign="center" paddingBlock={8}>
        <Skeleton width={96} height={14} />
        <Skeleton width={224} height={56} />
      </VStack>
      <Grid columns={2} gap={3}>
        <Skeleton height={128} index={1} />
        <Skeleton height={128} index={2} />
      </Grid>
      <Grid columns={2} gap={3}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={112} index={i + 3} />
        ))}
      </Grid>
    </VStack>
  );
}

/** ▲ 12% / ▼ 8% against a pace; red when ahead of it (spending faster), green when behind. */
export function Ticker({ value, label, suffix }: { value: number | null; label: string; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return null;
  const pct = Math.round(value * 100);
  if (Math.abs(pct) < 3)
    return <Badge variant="neutral" label="● usual" aria-label={`About the same as ${label}`} />;
  const up = pct > 0;
  return (
    <Badge
      variant={up ? "error" : "success"}
      label={`${up ? "▲" : "▼"} ${Math.abs(pct)}%${suffix ? ` ${suffix}` : ""}`}
      aria-label={`${Math.abs(pct)}% ${up ? "above" : "below"} ${label}`}
      data-testid="ticker"
    />
  );
}

function HomeContent({ ds, now }: { ds: Dataset; now: string }) {
  const month = monthOf(now);
  const np = useMemo(() => netPosition(ds, now), [ds, now]);
  const cards = useMemo(() => categoryCards(ds, month, now), [ds, month, now]);
  const pulse = useMemo(() => monthPulse(ds, month, now), [ds, month, now]);
  const debt = useMemo(() => debtStatus(ds, now), [ds, now]);
  const alarm = debt.in_debt && !debt.affordable;
  const unverified = useMemo(() => unverifiedSummary(ds), [ds]);

  const debtLine = useMemo(() => {
    if (!np.in_debt) return null;
    const open = np.loans.filter((l) => l.outstanding > 0);
    if (open.length === 1 && open[0]) {
      const l = open[0];
      return `owe ${l.loan.lender} ${formatRs(l.outstanding)}${
        l.payoff_month
          ? ` · clear by ${monthLabel(l.payoff_month)} at ${formatRs(l.loan.installment)}/month`
          : ""
      }`;
    }
    return `owe ${formatRs(np.debt)} across ${open.length} loans${np.debt_free_month ? ` · clear by ${monthLabel(np.debt_free_month)}` : ""}`;
  }, [np]);

  return (
    <VStack gap={6}>
      <CloseBanner ds={ds} now={now} />
      <VStack as="section" gap={2} hAlign="center" paddingBlockStart={4} data-testid="hero">
        <Text type="label" color="secondary">
          {alarm ? "Net position · debt you can't cover" : "Net position"}
        </Text>
        <span data-glance-target="net" className="inline-block">
          <HeroAmount
            value={np.net}
            className={cn(
              "text-hero font-semibold transition-colors",
              alarm || np.net < 0 ? "text-neg" : "text-fg",
            )}
          />
        </span>
        <HStack gap={2} hAlign="center" wrap="wrap" vAlign="center">
          <Text type="supporting" hasTabularNumbers>
            {formatRs(pulse.spent)} spent · {formatRs(pulse.per_day)}/day
          </Text>
          <Ticker value={pulse.vs_pace} label="your usual month by this day" suffix="vs usual" />
        </HStack>
        {debtLine ? (
          alarm ? (
            <Text type="large" weight="semibold" justify="center" textWrap="balance" data-testid="debt-line">
              <span className="text-neg">In debt · {debtLine}</span>
            </Text>
          ) : (
            <Text type="supporting" justify="center" textWrap="balance" data-testid="debt-line">
              Loan · {debtLine}
            </Text>
          )
        ) : null}
      </VStack>

      <Grid columns={2} gap={3} role="group" aria-label="Wallets">
        {np.wallets.map((w) => (
          <WalletCard key={w.account_id} ds={ds} w={w} month={month} now={now} />
        ))}
      </Grid>

      <OpeningSuggestions ds={ds} />

      {unverified.count > 0 ? (
        <Link
          to={isNative() ? "/activity" : "/import"}
          search={isNative() ? { filter: "unverified" } : {}}
          data-testid="unverified-banner"
        >
          <Banner
            status="warning"
            title={`${unverified.count} unverified · ${formatRs(Math.abs(unverified.total))}`}
            description={
              unverified.disputed > 0
                ? `${unverified.disputed} not on the statement — resolve`
                : unverified.since
                  ? `Since ${dayLabel(unverified.since.slice(0, 10))} · get statements`
                  : "Get statements"
            }
          />
        </Link>
      ) : null}

      {ds.transactions.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description={isNative() ? "Generate a statement; it lands here." : "Import a statement to start."}
          actions={<ImportButton />}
        />
      ) : null}

      <VStack as="section" gap={3} aria-label={`Spending in ${monthLabel(month)}`}>
        <Text type="label">{monthLabel(month)}</Text>
        <Grid columns={2} gap={3}>
          {cards
            .filter((c) => c.spent > 0)
            .sort((a, b) => b.spent - a.spent)
            .map((c) => (
              <CategoryTileCard key={c.category.id} c={c} month={month} />
            ))}
        </Grid>
      </VStack>

      <WhatIfCard ds={ds} now={now} />
    </VStack>
  );
}

function ImportButton() {
  const navigate = useNavigate();
  return (
    <Button variant="primary" onClick={() => void navigate({ to: "/import" })}>
      Import statements
    </Button>
  );
}

/** The wallet in its bank's colours: logo, balance, this month's in/out; badges only when something's off. */
function WalletCard({ ds, w, month, now }: { ds: Dataset; w: WalletPosition; month: string; now: string }) {
  const ledger = monthLedger(ds, w.account_id, month, now);
  const below = w.floor !== null && w.balance < w.floor;
  const id = w.account_id;
  return (
    <Link
      to="/wallet/$id"
      params={{ id }}
      data-testid={`wallet-${id}`}
      className="block min-w-0 rounded-container"
    >
      <Card variant={id} height="100%" padding={4}>
        <VStack gap={3} height="100%">
          <HStack gap={2} vAlign="center">
            <WalletLogo id={id} size={20} />
            <Text type="label" color="inherit" weight="semibold">
              {w.name}
            </Text>
          </HStack>
          <span data-glance-target={id} className="self-start">
            <TweenMoney value={w.balance} className="text-2xl font-semibold" />
          </span>
          <StackItem size="fill">
            <HStack gap={3} wrap="wrap" className="text-sm">
              <span className="num inline-flex items-center gap-0.5" title="In this month">
                <ArrowDownLeft size={14} aria-label="In" />
                {formatRs(ledger.inflow, { compact: true })}
              </span>
              <span className="num inline-flex items-center gap-0.5" title="Out this month">
                <ArrowUpRight size={14} aria-label="Out" />
                {formatRs(ledger.outflow, { compact: true })}
              </span>
            </HStack>
          </StackItem>
          {below && w.floor !== null ? (
            <Badge variant="warning" label={`Under your ${formatRs(w.floor, { compact: true })} minimum`} />
          ) : null}
          {w.provisional_delta !== 0 ? (
            <Badge
              variant="warning"
              label={`${formatRs(w.provisional_delta, { sign: true, compact: true })} unverified`}
            />
          ) : null}
        </VStack>
      </Card>
    </Link>
  );
}

/**
 * One glance: icon and a ▲/▼ in the corner (vs the 3 months before; empty months count as 0), the name, the amount
 * as big as the card allows, and a tiny month-end estimate. Red card = spending more than before, green = less.
 */
function CategoryTileCard({ c, month }: { c: CategoryCard; month: string }) {
  const up = c.trend === "up";
  const Arrow = up ? ArrowUp : ArrowDown;
  const digits = formatRs(c.spent).replace(/^Rs\s?/, "");
  return (
    <Link
      to="/category/$id"
      params={{ id: c.category.id }}
      search={{ month }}
      data-testid="category-card"
      data-trend={c.trend}
      className="block min-w-0 rounded-container transition-transform active:scale-[0.98]"
    >
      <Card height="100%" padding={3} variant={up ? "red" : "green"}>
        <VStack gap={1} className="@container">
          <HStack justify="between" vAlign="start">
            <CategoryTile id={c.category.id} name={c.category.icon} size="sm" />
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full",
                up ? "bg-error text-on-error" : "bg-success text-on-success",
              )}
            >
              <Arrow
                size={16}
                strokeWidth={3}
                aria-label={`${up ? "More" : "Less"} than the last 3 months' average (${formatRs(c.avg3)})`}
              />
            </span>
          </HStack>
          <Text type="label" maxLines={1} hasTruncateTooltip={false}>
            {c.category.name}
          </Text>
          <span className="num flex items-baseline gap-1 leading-none font-semibold">
            <span className="sr-only">{formatRs(c.spent)}</span>
            <span aria-hidden className="text-sm font-medium opacity-70">
              Rs
            </span>
            <span aria-hidden className="text-[clamp(1.75rem,19cqi,3.5rem)] tracking-tight">
              {digits}
            </span>
          </span>
          {c.projected > c.spent ? (
            <Text type="supporting" size="3xs" hasTabularNumbers>
              ~{formatRs(c.projected, { compact: true })} by month end
            </Text>
          ) : null}
        </VStack>
      </Card>
    </Link>
  );
}

/**
 * One-tap fix for an unset opening balance: a stated balance (typed, or from a SadaPay notification) implies what
 * the first tracked month must have opened with. Shown only until the opening is set.
 */
function OpeningSuggestions({ ds }: { ds: Dataset }) {
  const start = firstTrackedMonth(ds);
  const items = ds.accounts
    .map((a) => {
      const s = suggestOpeningBalance(ds, a.id);
      return s ? { account: a, suggestion: s } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (items.length === 0) return null;
  return (
    <VStack as="section" gap={3} aria-label="Opening balances">
      {items.map(({ account, suggestion }) => (
        <Banner
          key={account.id}
          status="info"
          data-testid="opening-suggestion"
          title={`${account.name} opened ${monthLabel(start)} at ${formatRs(suggestion.amount, { decimals: true })}?`}
          endContent={
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void enqueue("setOpeningBalance", { account_id: account.id, amount: suggestion.amount })
              }
            >
              Set
            </Button>
          }
        />
      ))}
    </VStack>
  );
}
