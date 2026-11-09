import type {
  Account,
  AccountId,
  BalanceEntry,
  Category,
  Command,
  Counterparty,
  Goal,
  GoalMove,
  Loan,
  MonthRecord,
  Notification,
  Recurring,
  Rule,
  Setting,
  Statement,
  TableName,
  Transaction,
} from "@marqum/schema";

/** Everything the analytics need, as plain arrays (from Dexie on clients, from D1 on the server). Tombstoned rows excluded. */
export interface Dataset {
  accounts: Account[];
  transactions: Transaction[];
  statements: Statement[];
  balances: BalanceEntry[];
  categories: Category[];
  counterparties: Counterparty[];
  rules: Rule[];
  recurring: Recurring[];
  loans: Loan[];
  goals: Goal[];
  goal_moves: GoalMove[];
  months: MonthRecord[];
  notifications: Notification[];
  settings: Setting[];
}

/** A row write produced by a command. `row.deleted = true` means delete (tombstone). */
export interface Mutation {
  table: TableName;
  row: Record<string, unknown> & { id: string };
}

export interface CommandOutcome {
  ok: boolean;
  mutations: Mutation[];
  error?: "closed_month" | "step_up_required" | "invalid" | "not_found" | "conflict";
  message?: string;
  result?: Record<string, unknown>;
}

export interface ExecContext {
  /** current local time, Asia/Karachi, `YYYY-MM-DDTHH:mm` */
  now: string;
  /** request carried a valid step-up token */
  steppedUp: boolean;
  /** new ids for created rows (ULIDs) */
  newId: () => string;
}

export type { Command };

export interface WalletPosition {
  account_id: AccountId;
  name: string;
  role: "vault" | "pocket";
  /** best-known current balance: last anchor (statement closing or manual entry) + transactions after it */
  balance: number;
  /** date the balance is verified up to (last statement period_to), or null */
  verified_until: string | null;
  /** sum of provisional (warm) transactions included in `balance` */
  provisional_delta: number;
  /** last manual balance entry minus computed balance at that time (0 if none / consistent) */
  unaccounted: number;
  /** vault only: money reserved for goals + next month's fixed bills; balance should stay above */
  floor: number | null;
}

export interface LoanStatus {
  loan: Loan;
  repaid: number;
  outstanding: number;
  /** month the loan is expected to be cleared at the planned installment, YYYY-MM */
  payoff_month: string | null;
  progress: number; // 0..1
}

export interface NetPosition {
  wallets: WalletPosition[];
  wallet_total: number;
  debt: number; // Σ outstanding loans, positive
  net: number; // wallet_total − debt (can be negative)
  in_debt: boolean; // any outstanding loan
  loans: LoanStatus[];
  /** earliest month all loans are cleared at planned installments */
  debt_free_month: string | null;
}

export interface CategoryCard {
  category: Category;
  /** this month's spend (positive paisa), incl. subcategories, net of linked reimbursements */
  spent: number;
  /** mean monthly spend over the last `window` complete months that have data; null if no history */
  average: number | null;
  months_in_average: number;
  over_average: boolean;
  /** same-day-of-month pace: average × (day / daysInMonth) */
  pace: number | null;
  children: { category: Category; spent: number; average: number | null }[];
}

export interface SeriesPoint {
  month: string; // YYYY-MM
  value: number; // positive paisa
  /** robust z-score |x − median| / (1.4826·MAD); null when not enough data */
  z: number | null;
  outlier: boolean; // z > 3 (MAD = 0 falls back to mean absolute deviation; see FORMULAS.md)
}

export interface CounterpartyStats {
  counterparty: Counterparty;
  series: { month: string; sent: number; received: number }[];
  total_sent: number;
  total_received: number;
  count: number;
  typical_amount: number; // median outflow
  avg_interval_days: number | null;
  weekday: number[]; // 7 buckets Mon..Sun, counts
  hour: number[]; // 24 buckets, counts
  categories: { category_id: string | null; total: number }[];
  outliers: SeriesPoint[];
}

export interface RecurringCandidate {
  counterparty_id: string | null;
  key: string; // merchant/counterparty key
  name: string;
  account_id: AccountId;
  amount: number; // median, positive
  day_of_month: number;
  occurrences: number;
  last_seen: string;
  category_id: string | null;
}

export interface BudgetModel {
  income: number; // monthly into wallets
  committed: number; // Σ active recurring + Σ loan installments (open loans)
  variable: number; // Σ averages of variable categories
  goal_contributions: number; // Σ goal.monthly for unachieved goals
  surplus: number; // income − committed − variable − goal_contributions
  floor: number; // Σ goal envelopes + next month's fixed bills
  free_savings: number; // SadaPay balance − floor (can be negative)
  lines: { label: string; amount: number; kind: "income" | "committed" | "variable" | "goals" | "surplus" }[];
  /** planned monthly spend per top-level category and where the number came from */
  categories: PlannedCategory[];
}

export interface PlannedCategory {
  category_id: string;
  name: string;
  nature: "fixed" | "variable";
  /** positive paisa, after levers/adjustments */
  planned: number;
  /** budget = Category.budget; average = history average; none = neither (0); recurring = fixed category covered by Recurring rows (not added again) */
  source: "budget" | "average" | "none" | "recurring";
}

export interface WhatIfInput {
  price: number;
  mode: "save" | "loan";
  loan_months?: number;
  /** loan mode: monthly installment instead of loan_months (months = ⌈price / installment⌉) */
  installment?: number;
  /** loan mode: custom uneven repayments; overrides installment/loan_months */
  schedule?: { month: string; amount: number }[];
  /** e.g. [{category_id:"food", pct:-20}] reduces Food's planned spend by 20% */
  levers?: { category_id: string; pct: number }[];
  /** per-call overrides of the forecast assumptions (defaults: defaultAssumptions) */
  assumptions?: Partial<ForecastAssumptions>;
  /** save: earliest month to buy; loan: first repayment month (default next month) */
  start_month?: string;
}

/** Low/expected/high value. For spending, low is the good case; for surplus/savings, low is the bad case. */
export interface Band {
  expected: number;
  low: number;
  high: number;
}

export interface ForecastAssumptions {
  /** months projected after the current month (default 12) */
  horizon_months: number;
  /** step changes to monthly income from a month on; base = setting income_monthly */
  income: { from: string; amount: number }[];
  /** % applied to all variable planned spend (−10 = spend 10% less) */
  spend_adjust_pct: number;
  /** % per category (applied before spend_adjust_pct) */
  category_adjust: { category_id: string; pct: number }[];
  /** known future items: + income, − expense */
  one_offs: { month: string; amount: number; label: string }[];
  /** width of the variable-spend band: low ×0.5, normal ×1, high ×1.5 */
  uncertainty: "low" | "normal" | "high";
}

export interface ProjectionMonth {
  month: string;
  income: number;
  /** recurring fixed charges + planned fixed categories not covered by recurring */
  fixed: number;
  variable: Band;
  goals: number;
  /** loan installments due this month */
  loans: number;
  one_offs: number;
  /** income − fixed − variable − goals − loans + one_offs; low = bad month (high spend) */
  surplus: Band;
  /** cumulative free SadaPay savings at month end (starts from today's free savings) */
  savings: Band;
  /** outstanding debt at month end */
  debt: number;
}

export interface WhatIfResult {
  verdict: "now" | "easy" | "stretch" | "no";
  headline: string; // specific, e.g. "Affordable in 3 months at Rs 14,200/month"
  model: BudgetModel; // after levers
  months_to_save: number | null; // null = never at current surplus
  ready_month: string | null;
  installment: number | null; // loan mode
  debt_free_month: string | null; // loan mode
  goal_delays: { goal_id: string; name: string; months: number }[];
  /** waterfall from income to what's left after the purchase plan */
  waterfall: { label: string; amount: number }[];
  /** month-by-month projection with the purchase applied */
  projection: ProjectionMonth[];
  /** save mode: month the price is reached in the good / expected / bad scenario (null = not within horizon) */
  ready_month_range: { best: string | null; expected: string | null; worst: string | null };
  /** loan mode: months where the bad-case surplus can't cover the repayment */
  risk_months: string[];
  /** solid = works in the bad case; likely = in the expected case; risky = only in the good case; no = never */
  confidence: "solid" | "likely" | "risky" | "no";
}

export interface SplitSuggestion {
  sadapay: number;
  nayapay: number;
  lines: { account_id: AccountId; label: string; amount: number }[];
}

export interface GoalStatus {
  goal: Goal;
  saved: number;
  remaining: number;
  eta_month: string | null;
  progress: number;
}

export interface ChecklistItem {
  id: string;
  label: string; // specific, e.g. "Tag 4 transactions without a reason (Rs 3,250)"
  ok: boolean;
  severity: "block" | "warn";
  detail?: string;
  /** route the UI should open to fix it, e.g. "/activity?filter=untagged&month=2026-11" */
  action?: string;
}

export interface CloseChecklist {
  month: string;
  items: ChecklistItem[];
  can_close: boolean;
  /** first day the month can be closed (statements exclude today) */
  closable_from: string;
}

export interface UnverifiedSummary {
  count: number;
  total: number; // signed sum
  since: string | null; // earliest provisional occurred_at
  disputed: number;
  by_account: Record<AccountId, { count: number; since: string | null }>;
}

/** One wallet's month as an account: b/f → in → out → closing (→ c/f once the month is closed). */
export interface MonthLedger {
  month: string;
  /** b/f row amount, or (open month without one) the previous month's computed closing */
  brought_forward: number;
  brought_forward_virtual: boolean;
  /** Σ positive non-carry amounts */
  inflow: number;
  /** Σ |negative non-carry amounts| (positive number) */
  outflow: number;
  /** brought_forward + inflow − outflow */
  closing: number;
  /** c/f row amount as booked (= −closing), or null while the month is open */
  carried_forward: number | null;
  /** non-carry transactions of the month, oldest first */
  transactions: Transaction[];
}

export interface WalletMonthDetail extends MonthLedger {
  account_id: AccountId;
  /** every day of the month: net flow (non-carry) and closing balance at 23:59 */
  daily: { date: string; net: number; closing: number }[];
}

export interface BreakdownPart {
  /** child category id, or `${parent}.__other` for spend tagged directly with the parent */
  id: string;
  /** child name, or "Other <Parent>" */
  name: string;
  spent: number;
  average: number | null;
  /** spent / total (0..1; 0 when total is 0) */
  share: number;
}

export interface CategoryBreakdown {
  category: Category;
  total: number;
  average: number | null;
  budget: number | null;
  parts: BreakdownPart[];
}

export interface CategoryMonthDetail {
  month: string;
  total: number;
  average: number | null;
  /** every day of the month (spend net of reimbursements that day) */
  daily: { date: string; value: number }[];
  prev_month_total: number;
  /** (total − prev) / prev × 100, one decimal; null when prev is 0 */
  change_pct: number | null;
  parts: BreakdownPart[];
}

export interface Allocation {
  income: number;
  sadapay: number;
  nayapay: number;
  /** user = setting allocation_sadapay; suggested = computed */
  source: "user" | "suggested";
  suggested: SplitSuggestion;
}
