# Formulas

Every number Marqūm shows comes from `packages/core`. This page defines each one precisely, with a worked
example. The examples are the same synthetic numbers used in `packages/core/test/`.

Conventions:

- Money is integer **paisa** (Rs 1 = 100). Negative = money left the wallet. Examples below are in rupees.
- Times are Asia/Karachi local strings. "This month" is the month of `now`.
- Only `spend` and `fee` flows count as spending. `funding`, `internal`, `income`, `loan_in`, `loan_repay`,
  `reimbursement` and `carry` never do.
- Deleted (tombstoned) rows are ignored everywhere.
- **Tracking start** (setting `tracking_start`, default 1 Nov 2026, always the 1st of a month): nothing dated before
  it exists. Analytics, balances, averages, month lists and the close checklist all ignore it. `trackedMonths` /
  `availableMonths` run from the tracking-start month to this month; `monthsToClose` lists the ended, unclosed
  ones among them.

## Classification

`classify(ds, txn)` fills category, flow and counterparty for a new row. Your own choice (an explicit category or
flow on quick-add, or an existing tag) always wins over all of this.

1. **Rules**, highest `priority` first. A rule matches when its pattern (a case-insensitive regex) matches
   `` `${description} ${reason}` ``. An invalid regex is skipped. Category, flow and counterparty are each taken
   from the first matching rule that sets them. Seed rules have priorities 1–16 in listed order; rules created
   with "always do this" start at 1000 and go up, so they beat the seeds.
2. **Counterparty defaults** fill whatever the rules left empty.
3. **Flow inference**, if still no flow:

   | Direction | Text                                                                | Flow       |
   | --------- | ------------------------------------------------------------------- | ---------- |
   | either    | names the other wallet, and the counterparty is unknown or yourself | `internal` |
   | in        | mentions Meezan / MBL / own account / top-up                        | `funding`  |
   | in        | anything else                                                       | `income`   |
   | out       | service charge / fee / tax deducted / withholding                   | `fee`      |
   | out       | anything else                                                       | `spend`    |

A rule or counterparty flow only applies when it fits the direction: `income`, `reimbursement`, `loan_in` and
`funding` only on money in; `spend`, `fee` and `loan_repay` only on money out. This stops the seed rule
`meezan → funding` from hiding a payment _to_ a friend's Meezan account. `funding` and `internal` rows never carry
a category.

**Counterparty key.** The person or merchant is extracted from the bank text, then upper-cased with digits,
punctuation, bank and city words removed (at most four words):

| Description                                | Key            | Kind     |
| ------------------------------------------ | -------------- | -------- |
| `Outgoing fund transfer to Danish Ahmed …` | `DANISH AHMED` | person   |
| `Incoming fund transfer from Ali Khan`     | `ALI KHAN`     | person   |
| `To DANISH (SadaPay)`                      | `DANISH`       | person   |
| `From TEST USER (Meezan Bank (MBL))`       | `TEST USER`    | person   |
| `POS Purchase FOODPANDA*123 KARACHI`       | `FOODPANDA`    | merchant |
| `Card payment 0000 KFC GULBERG`            | `KFC GULBERG`  | merchant |
| `Service charges`                          | none           |          |

A statement import creates a counterparty for each new key. If that row is an internal transfer or funding, the
new counterparty is `self` (it is your own name on the other wallet or bank), so later transfers to it stay
internal.

## Reconciliation

A statement row matches a provisional (or disputed) transaction when it is the same wallet, has exactly the same
amount, and is within ±36 hours. Matching is one-to-one, best first: smallest time gap, then most shared
description words, then by id (so the result is deterministic).

**Importing a statement** for wallet W and period [from 00:00, to 23:59]:

1. Rows whose `external_id` already exists are updated in place. Bank fields (time, amount, description, type,
   fee, balance) come from the statement. Your category, reason, flow, counterparty, loan and link are kept.
2. New rows that match a provisional row turn that row into the verified one. It keeps its id, reason, category
   and flow; the statement row is not inserted separately.
3. Other new rows are inserted as `verified` and classified.
4. Verified rows of W inside the period that are not on the statement are deleted.
5. Unmatched provisional rows of W inside the period become `disputed`.
6. The statement's opening is stored as a balance **assertion** at the day before `from`, 23:59, and its closing
   at `to` 23:59. Re-importing the same period replaces that statement's assertions. An assertion identical to an
   existing one (same wallet, time, kind and balance) is not duplicated.
7. Rows dated before tracking start are ignored, and the replace range starts at tracking start.
8. System rows (b/f, c/f) are never deleted or changed by an import.
9. If the statement spans tracking start and has an opening, the first month's b/f becomes opening + Σ statement
   rows before tracking start, unless you set it with `setOpeningBalance`.

Re-importing an identical statement writes nothing. The result reports
`{ added, updated, unchanged, removed, matched, disputed, ignored }`.

## Accounting model (b/f → c/f)

Balances are **derived from the ledger**. A balance entry, whether a statement opening or closing or a balance you
typed, is an **assertion**: it is checked against the ledger, but it never sets the balance.

- **balance(wallet, at)** = Σ amounts of tracked transactions of that wallet with occurred_at ≤ at. A c/f row
  dated exactly at `at` is left out, so the balance at a month's last 23:59 is that month's closing.
- Every month of every wallet is an account that runs from 0 to 0 through two system rows (flow `carry`, source
  `system`, status `verified`, no category, deterministic id = external_id):
  - **b/f** `carry:bf:<wallet>:<YYYY-MM>` on the 1st at 00:00: "Balance brought forward from Oct 2026", +opening;
  - **c/f** `carry:cf:<wallet>:<YYYY-MM>` on the last day at 23:59: "Balance carried forward to Dec 2026", −closing.
- **First tracked month.** Its b/f always exists for both wallets; any command adds it if it is missing. Its
  amount comes from:
  - the opening of a statement that spans tracking start (+ its rows before tracking start);
  - else 0, recorded as "unknown";
  - `setOpeningBalance` overrides it ("Opening balance set by you"), and later imports don't change it.

  It can't be changed once that month is closed.
- **closeMonth(M)** writes c/f(M) = −closing(M) and b/f(M+1) = +closing(M) for each wallet. They are part of M's
  sealed snapshot. **reopenMonth(M)** deletes both, and is refused while M+1 is closed.
- An **open** month has no b/f row, unless it is the first month. Views then show a **virtual b/f** = the previous
  month's computed closing.
- `monthLedger(ds, wallet, M)` = { brought_forward, brought_forward_virtual, inflow, outflow (positive), closing =
  b/f + in − out, carried_forward (the c/f amount as booked, or null), transactions (non-carry) }.
  `walletMonthDetail` adds each day's net flow and 23:59 closing.
- Because c/f(M) and b/f(M+1) cancel, the running balance is unchanged by closing a month.

**Worked example, Nov → Dec 2026** (tracking starts 1 Nov):

| NayaPay                                         | Amount | Running |
| ----------------------------------------------- | ------ | ------- |
| 1 Nov 00:00 b/f (statement opening)             | +5,000 | 5,000   |
| 3 Nov Shell                                     | −3,000 | 2,000   |
| 4 Nov transfer from SadaPay                     | +1,000 | 3,000   |
| **Closing 30 Nov** (= statement closing ✓)      |        | 3,000   |
| 30 Nov 23:59 c/f "carried forward to Dec 2026"  | −3,000 | 0       |
| 1 Dec 00:00 b/f "brought forward from Nov 2026" | +3,000 | 3,000   |

SadaPay has no statement balances. You set its opening to Rs 2,000; it then pays −1,000 to NayaPay and −900 to
iCloud, so its closing is Rs 100, booked as c/f −100 and b/f(Dec) +100. Before November is closed, December shows
a virtual b/f of 3,000 (NayaPay) and 100 (SadaPay).

## Wallet position

- **balance** = the ledger balance now (all tracked transactions, provisional and disputed included; carries
  cancel).
- **provisional_delta** = Σ provisional/disputed amounts.
- **verified_until** = the latest `period_to` among the wallet's statements.
- **unaccounted** = the latest manual balance (on or after tracking start) − the ledger balance at that moment.

Example (NayaPay, b/f Rs 5,000): −Rs 200 on 8 Nov. On 9 Nov you type Rs 4,700, but the ledger says 4,800, so
**unaccounted = −Rs 100**. A provisional −Rs 50 follows on 10 Nov: balance **Rs 4,750**, provisional_delta −Rs 50. A
statement closing assertion doesn't change any of this; the close checklist compares it.

**SadaPay floor** = Σ goal envelopes (Σ goal moves per goal, each floored at 0) + Σ active recurring payments on
SadaPay (next month's bills). **Free savings** = SadaPay balance − floor (can be negative).

Example: envelopes Rs 500 + Rs 300, iCloud Rs 900 recurring on SadaPay → floor **Rs 1,700**. An inactive
recurring row, or one on NayaPay, doesn't count.

## Loans

- **repaid** = Σ |amount| of transactions with flow `loan_repay` and this `loan_id`, + `manual_repaid`.
- **outstanding** = max(0, principal − repaid), or 0 once `closed_on` is set.
- **progress** = repaid / principal (0–1).
- **payoff_month**: let the next payment month be this month, unless a repayment was already made this month or
  the loan started this month, in which case it is next month. Then payoff = next payment month +
  ⌈outstanding / installment⌉ − 1. A paid-off loan reports its closing month (or the month of its last repayment).
- **debt** = Σ outstanding. **net** = wallet total − debt. **debt_free_month** (home screen) = the latest payoff
  month among open loans, each paid at its own installment.

Example: Rs 90,000 borrowed in Aug at Rs 9,000/month, with repayments in Sep and Oct. Repaid = 18,000,
outstanding = 72,000, progress = 0.2. On 15 Nov nothing has been paid yet this month, so payments start in Nov
and run for ⌈72,000 / 9,000⌉ = 8 months: payoff **Jun 2027**.

## Category spend and averages

**Spend of category C in month M** = Σ spendOf(t) over transactions in M whose category is C or a subcategory of
C, − Σ reimbursements in M whose `linked_txn_id` points to an expense in C's subtree. The result is floored at 0.
spendOf(t) = −amount for `spend`/`fee` outflows, else 0. A reimbursement offsets the category in the month the
money comes back, not the month of the expense.

**Average.** Take the `avg_window` (6, or 3) complete months before M, and drop any that are before tracking start
or earlier than the first month with any (non-carry) transaction. That count is `months_in_average`. The average is the Σ spend over those
months divided by that count (a month with data but no spend in C counts as 0), or `null` when the count is 0.

- `over_average` = spent > average. This colours the home card: red if over, green otherwise.
- `pace` = average × (day of month / days in month) for the current month; the full average for past months.

Example (Food): May–Jul Rs 100/month, Aug–Oct Rs 400/month, 15 Nov so far Rs 300.

- Window 6: (3×100 + 3×400) / 6 = **Rs 250**, so Nov is over average. Pace on 15 Nov = 250 × 15/30 = Rs 125.
- Window 3: (400 × 3) / 3 = **Rs 400**, so Nov is under average.
- If data only starts in Sep (Rs 0 in Sep, Rs 600 in Oct), a 6-month window averages just Sep–Oct: Rs 300 over
  2 months.

A hidden (suggested) category shows on the home screen once it has spend this month or a non-zero average.

**Breakdown.** `categoryBreakdown(C, M)` splits C's total into each visible subcategory plus **"Other C"** (id
`C.__other`). "Other C" is the spend tagged directly with C itself, and appears only when non-zero and C has
subcategories. Parts are sorted by spend, and share = part / total. The home card's `children` carry the same
parts.

Example: Car = Petrol 6,500 + Car wash 1,000 + 2,500 tagged "Car" → Petrol 65%, Other Car 25%, Car wash 10%.

`categoryMonthDetail` adds every day's spend, last month's total and change % ((total − prev) / prev, one
decimal; null when prev is 0).

## Outliers

Robust z-score of x against a set of values X (at least 3 of them):

- median m = median(X); MAD = median(|xᵢ − m|).
- If MAD > 0: **z = |x − m| / (1.4826 · MAD)**.
- If MAD = 0 (most months identical), use the mean absolute deviation instead: z = |x − m| / (1.2533 · mean|xᵢ − m|).
  1.2533 = √(π/2) makes it comparable to σ, as 1.4826 does for MAD.
- If every value is identical, z = 0 for that value. A new value against an identical baseline has z = `null`,
  because there is no spread to measure against.
- Fewer than 3 values: z = `null`.

**Outlier ⇔ z > 3.** There is no separate threshold for a tiny MAD.

In a category series, complete months are scored against all the complete months. The current, partial month is
scored against them but never included in the baseline.

Examples:

- [10, 12, 11, 13, 50]: m = 12, MAD = 1, so z(50) = 38/1.4826 = 25.6 (an outlier) and z(10) = 1.35.
- [10, 10, 10, 10, 30]: MAD = 0, mean deviation = 4, so z(30) = 20 / (1.2533 · 4) = 3.99 (an outlier).

## Recurring detection

Group outflows (spend or fee) by wallet and counterparty, or by description key when there is no counterparty.
Within a group, keep payments within ±10% of the group's median amount. Walking back from the newest, take the
longest run where every gap between consecutive payments is 25–35 days. It is a candidate if the run has **≥ 3**
payments and no Recurring row already exists for the same wallet and counterparty (or name). The candidate's
amount is the median of the run, and its day is the median day of month.

Example: 3 Jul Rs 900, 2 Aug Rs 900, 3 Sep Rs 920, 3 Oct Rs 890 (plus an unrelated Rs 3,000 on 15 Oct) → one
candidate: Rs 900 on day 3, 4 occurrences.

## Budget model

**Planned spend** per top-level category = `budget` ?? average ?? 0, and the source is reported (`budget`,
`average` or `none`). A fixed category covered by an active fixed charge (Recurring row) in its subtree is
reported as `recurring` and not counted again.

| Quantity             | Definition                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| income I             | setting `income_monthly` (default Rs 85,000)                                                                                             |
| committed C          | Σ active fixed charges + Σ installments of open loans (capped at what's left) + planned spend of fixed categories without a fixed charge |
| variable V           | Σ planned spend of top-level **variable** categories (hidden ones included)                                                              |
| goal contributions G | Σ `monthly` of goals not achieved and not yet fully saved                                                                                |
| surplus S            | I − C − V − G                                                                                                                            |
| floor                | as above                                                                                                                                 |
| free savings F       | SadaPay balance − floor                                                                                                                  |

**Levers** `{category_id, pct}` adjust planned spend before anything else: plan(top) + plan(target) × pct/100 for
each lever whose target is the top-level category or one of its subcategories.

Worked example (used throughout the tests). Aug–Oct history: Food Rs 30,000/mo, Car › Petrol Rs 10,000/mo,
Bills › Electricity Rs 4,000/mo, Subscriptions › VPS Rs 2,000/mo. A Guard fixed charge (Rs 5,000, Bills) sits on
SadaPay. The loan is Rs 90,000 at Rs 9,000/month, next payment this month. Goal Bicycle: Rs 10,000/mo, Rs 10,000
of Rs 50,000 saved. SadaPay ledger balance Rs 25,000.

- C = 5,000 (Guard) + 9,000 (loan) + 2,000 (Subscriptions, no fixed charge) = **16,000**. Bills is covered by
  Guard, so Electricity is not added.
- V = 30,000 + 10,000 = **40,000**. G = **10,000**.
- S = 85,000 − 16,000 − 40,000 − 10,000 = **Rs 19,000**.
- floor = 10,000 (envelope) + 5,000 (Guard) = 15,000. F = 25,000 − 15,000 = **Rs 10,000**.
- Lever "Food −50%" → V = 25,000, S = 34,000. A Food budget of Rs 25,000 does the same, with source `budget`.

## Projection

`project(ds, now, assumptions?)` runs month by month from **next month** for `horizon_months`. This month's
installment and goal contribution, if still due, are taken from this month's money.

Assumptions (`ForecastAssumptions`) come from setting `forecast` (JSON, read leniently: a malformed part falls back
to its default), and each call may override them:

- `horizon_months` (12);
- `income` step changes `{from, amount}`;
- `spend_adjust_pct` (0);
- `category_adjust` (`{category_id, pct}`);
- `one_offs` `{month, amount (+ in / − out), label}`;
- `uncertainty` (low / normal / high).

Per month:

- income = the latest step with from ≤ month, else `income_monthly`;
- fixed = fixed charges + planned fixed categories without a fixed charge;
- variable.expected = Σ variable planned spend (after `category_adjust`) × (1 + spend_adjust_pct/100);
- **spread**:
  - with ≥ 3 complete tracked months of history: the standard deviation of their monthly variable totals (at
    least 5% of expected), × 0.5 / 1 / 1.5 for low / normal / high uncertainty;
  - otherwise 5% / 15% / 30% of expected;
- variable.low = expected − spread (floored at 0), variable.high = expected + spread;
- goals = each unachieved goal's monthly until it is reached; loans = installments due until each loan is repaid;
- surplus = income − fixed − variable − goals − loans + one_offs. `surplus.low` uses variable.high (a bad month);
  `surplus.high` uses variable.low;
- savings = today's free savings + Σ surplus so far (per band); debt = outstanding at month end.

Example (fixture above, flat history → spread = 5% = 2,000): Dec 2026 surplus 19,000 (17,000–21,000), savings
29,000, debt 72,000. From Mar 2027 Bicycle is complete, so the surplus becomes 29,000. The Aug 2027 installment clears
the loan.

## What-if (price P)

`whatIf` is projection-based. It still returns the legacy `verdict`. It adds `projection` (with the purchase
applied), `ready_month_range`, `risk_months` and `confidence`:

- solid = works in the bad case;
- likely = works in the expected case;
- risky = works only in the good case;
- no = doesn't work.

"Works" means ready within **6 months** in save mode, and the surplus covering every repayment in loan mode.

**Save mode.**

- F ≥ P (and no later `start_month`) → **now**, solid: "Affordable now — leaves Rs (F − P) free in SadaPay".
- Otherwise ready = the first projected month whose savings reach P, for savings.high / expected / low → best /
  expected / worst.
- verdict from m = months to the expected ready month: **easy** if m ≤ 1, **stretch** if m ≤ 6, else **no**.
  plan = ⌈(P − max(F, 0)) / m⌉ to the rupee.
- Headline:
  - all three months equal: "Ready by Feb 2027 — save Rs 16,667/month";
  - a range: "Ready between Jan and Mar 2027 (most likely Feb)";
  - beyond 6 months: "Not within 6 months — ready between Jul and Aug 2027 (most likely Jul)";
  - never and S ≤ 0: "Not affordable — your monthly surplus is −Rs …".

Examples (S = 19,000, F = 10,000):

| P                                        | Result                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| 8,000                                    | now, solid: "Affordable now — leaves Rs 2,000 free in SadaPay"               |
| 25,000                                   | easy, solid: "Ready by Dec 2026 — save Rs 15,000/month"                      |
| 60,000                                   | stretch, solid: "Ready by Feb 2027 — save Rs 16,667/month"                   |
| 200,000                                  | no: "Not within 6 months — ready between Jul and Aug 2027 (most likely Jul)" |
| 60,000 with Food 20k/30k/40k (σ ≈ 8,165) | stretch, solid: "Ready between Jan and Mar 2027 (most likely Feb)"           |

**Loan mode.** You give one of:

- `loan_months` n → installment = ⌈P / n⌉ to the rupee;
- `installment` → n = ⌈P / installment⌉;
- a custom `schedule` of `{month, amount}`.

Repayments start at `start_month` or next month. They are added to the projection as a loan, and the purchase
itself doesn't touch savings.

- **risk_months** = repayment months whose bad-case surplus is negative.
- **confidence** = solid if every repayment month's bad-case surplus is ≥ 0, likely if the expected case is,
  risky if only the good case is, else no. A schedule that sums to less than P → no: "Your schedule repays only
  Rs X of Rs P".
- Legacy **verdict**: S ≤ 0 → no; installment ≤ 50% of S → easy; ≤ S → stretch; else no.
- **debt_free_month** = the first month with no debt, every loan paid at its own installment from its next
  payment month.
- **goal_delays**: shortfall = max(0, installment − max(S, 0)). For the repayment months it is taken out of goal
  contributions, lowest-priority goal first. Each goal's ETA is recomputed, and the delay is the number of months
  it slips.

Examples (an existing Rs 90,000 loan at Rs 9,000/month):

- P = 90,000 over 10: "Rs 9,000/month over 10 months works even in a bad month — debt-free by Sep 2027". The
  existing loan clears in Aug and the new one in Sep.
- P = 190,000 over 10, with Food 20k/30k/40k: "Rs 19,000/month over 10 months works in a normal month; 3 bad months
  would be tight — debt-free by Sep 2027". The risk months are Dec–Feb; once Bicycle completes in Mar there is
  room again.
- P = 300,000 over 10 → "Not affordable — Rs 30,000/month is more than your Rs 19,000 monthly surplus". Bicycle
  slips **10 months**.

**Waterfall:** income → −C → −V → −G → surplus → −(monthly plan or installment) → left. For the P = 90,000 loan
that's 85,000 → −16,000 → −40,000 → −10,000 → 19,000 → −9,000 → **10,000 left**.

## Goals

- saved = Σ goal moves. remaining = max(0, target − saved). progress = saved / target.
- **ETA.** Contributions start this month, unless a positive move was already made this month, in which case they
  start next month. ETA = start + ⌈remaining / monthly⌉ − 1. An achieved goal reports its `achieved_on` month; a
  goal with monthly 0 and money still remaining has no ETA.

Example: Bicycle, Rs 40,000 remaining at Rs 10,000/month, nothing moved yet in Nov → Nov + 3 = **Feb 2027**.

## Allocation (income split)

`allocation(ds, now)` returns the user's split when setting `allocation_sadapay` is set (NayaPay gets the rest),
otherwise the suggestion:

- **SadaPay** = SadaPay fixed charges + loan installments + goal contributions + planned spend (budget ?? average)
  of categories whose wallet hint is SadaPay and that aren't covered by a fixed charge.
- **NayaPay** = income − SadaPay (≥ 0).
- If all of that is 0 (nothing entered yet), the suggestion is **50/50** with the line "Add your fixed charges to
  get a real suggestion". It is never a silent 0 / 85,000.

Example: 5,000 + 9,000 + 10,000 + 2,000 (Subscriptions) = **Rs 26,000** to SadaPay, **Rs 59,000** to NayaPay.
On an empty ledger, Rs 42,500 / Rs 42,500. With only a Bills budget of Rs 12,000, it is Rs 12,000 / Rs 73,000.

## Month close checklist

**Block items** (all must pass):

| Item                        | Passes when                                                                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| previous month closed       | the month before is closed (when it is tracked); months close in order                                                                                                                                                                               |
| month ended                 | today ≥ the 1st of next month (SadaPay statements exclude today), which is `closable_from`                                                                                                                                                           |
| statements, per wallet      | the union of statement periods covers every day of the month; otherwise the gaps are listed, e.g. "NayaPay statement missing for 16–31 Oct"                                                                                                          |
| statement checks            | every check on statements overlapping the month passes, and for each pair of back-to-back statements (next.from = prev.to + 1 day) with both values known, \|prev.closing − next.opening\| ≤ Rs 1                                                    |
| unverified                  | no provisional or disputed transactions in the month                                                                                                                                                                                                 |
| uncategorised               | every `spend`/`fee` transaction in the month has a category                                                                                                                                                                                          |
| closing balance, per wallet | the ledger closing (b/f + transactions) is trustworthy: the first month's b/f came from a statement or was set by you, or some balance assertion exists for that wallet. SadaPay statements carry no balances, so a balance you type is enough there |
| reconciles, per wallet      | for every statement of the wallet ending in the month with a closing: \|ledger at period_to 23:59 − closing\| ≤ Rs 1, e.g. "SadaPay ledger Rs 799 ≠ statement closing Rs 800 on 31 Oct (off by Rs 2)"                                                |

A month before tracking start gets a single blocking item ("Oct 2026 is before tracking started (1 Nov 2026) —
nothing to close"), so it can never be closed or nagged about.

**Warn items:**

- the latest balance you typed in the month differs from the ledger at that moment by more than Rs 1;
- a `spend` transfer to a person (by description) with no reason;
- an active recurring payment with no outflow in the month on its wallet within ±10% of its amount and matching
  its counterparty or category;
- a loan started before the month, still outstanding, with no `loan_repay` in the month.

Labels carry counts and amounts, e.g. "Categorise 2 transactions (Rs 800)", and each item links to a route that
fixes it, e.g. `/activity?month=2026-10&filter=untagged`.

`closeMonth` refuses with every blocking label when `can_close` is false; otherwise it writes the c/f and next b/f
(see Accounting model).

## Closed months

- Commands are checked after they run. A command is blocked when it changes a transaction or a balance anchor
  dated in a closed month. A statement opening anchor at 23:59 belongs to the next day's month. Bookkeeping fields
  (`updated_at`, `statement_id`) don't count as changes.
- `tagTransaction` may change only `category_id` and `reason`, and needs step-up. `reopenMonth` always needs
  step-up. Everything else is refused with `closed_month`.
- `mergeCounterparties` is the one exception. It may re-point closed-month rows to the surviving counterparty,
  because a merge only renames who the money went to; it doesn't change it.
- A statement import that overlaps a closed month succeeds only if it changes nothing there. An identical
  re-import is a no-op.
- b/f and c/f rows can't be edited by any command. Only `closeMonth`, `reopenMonth`, `setOpeningBalance` (first
  month, while open), imports (first month's b/f) and `resetLedger` write them.
- **resetLedger** (step-up, `confirm: "RESET"`, start = 1st of a month) deletes every transaction, statement,
  balance entry, month record, notification and goal move. It sets `tracking_start` and re-creates the first
  month's b/f at 0. Configuration is kept. `tracking_start` can't be changed with `setSetting`.

## Snapshot

`buildSnapshot(ds, month)` writes canonical JSON:

- what it contains:
  - the month's transactions, including its b/f and (once closed) c/f rows;
  - statements overlapping the month;
  - balance entries from the previous month's last 23:59 to this month's last 23:59;
  - the categories referenced, with their parents;
  - the counterparties referenced;
  - the month record's id, status and closed_at;
- object keys are sorted recursively, rows are sorted (transactions by time then id, the rest by id), and
  `version` is omitted.

`sha256` is the hex SHA-256 of that JSON via WebCrypto, so the same month content always produces the same hash.
