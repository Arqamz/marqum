# Formulas

Every number Marqūm shows comes from `packages/core`. This page defines each one precisely, with a worked
example. The examples are the same synthetic numbers used in `packages/core/test/`.

Conventions:

- Money is integer **paisa** (Rs 1 = 100). Negative = money left the wallet. Examples below are in rupees.
- Times are Asia/Karachi local strings. "This month" is the month of `now`.
- Only `spend` and `fee` flows count as spending. `funding`, `internal`, `income`, `loan_in`, `loan_repay` and
  `reimbursement` never do.
- Deleted (tombstoned) rows are ignored everywhere.

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

A statement import creates a counterparty for each new key.

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
6. The statement's opening becomes a balance anchor at the day before `from`, 23:59; its closing becomes an
   anchor at `to` 23:59. Re-importing the same period replaces that statement's anchors. An anchor identical to an
   existing one (same wallet, time, kind and balance) is not duplicated.

Re-importing an identical statement writes nothing. The result reports
`{ added, updated, unchanged, removed, matched, disputed }`.

## Wallet balance

For each wallet:

- **Anchor** = the latest balance entry by `as_of`. Statement closings, statement openings and manual entries
  are all anchors. On a tie, a statement closing beats an opening, which beats a manual entry.
- **balance** = anchor + Σ amounts of transactions strictly after the anchor's `as_of`. Provisional and disputed
  rows are included.
- **provisional_delta** = Σ of the provisional/disputed amounts included above.
- **verified_until** = the latest `period_to` among the wallet's statements.
- **unaccounted** applies only when the latest anchor is a manual entry E. It equals E − (previous anchor + Σ
  transactions after that anchor up to E). It is 0 when there is no earlier anchor.

Example (NayaPay): the statement closes 7 Nov at Rs 1,000. On 8 Nov there's a verified −Rs 200. On 9 Nov you
type a balance of Rs 700, so the computed balance at that moment is 1,000 − 200 = 800 and **unaccounted = −Rs
100**. Then a provisional −Rs 50 is added on 10 Nov: balance = 700 − 50 = **Rs 650**, provisional_delta = −Rs 50.

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

**Average.** Take the `avg_window` (6, or 3) complete months before M, and drop any that are earlier than the
first month with any transaction at all. That count is `months_in_average`. The average is the Σ spend over those
months divided by that count (a month with data but no spend in C counts as 0), or `null` when the count is 0.

- `over_average` = spent > average. This colours the home card: red if over, green otherwise.
- `pace` = average × (day of month / days in month) for the current month; the full average for past months.

Example (Food): May–Jul Rs 100/month, Aug–Oct Rs 400/month, 15 Nov so far Rs 300.

- Window 6: (3×100 + 3×400) / 6 = **Rs 250**, so Nov is over average. Pace on 15 Nov = 250 × 15/30 = Rs 125.
- Window 3: (400 × 3) / 3 = **Rs 400**, so Nov is under average.
- If data only starts in Sep (Rs 0 in Sep, Rs 600 in Oct), a 6-month window averages just Sep–Oct: Rs 300 over
  2 months.

A hidden (suggested) category shows on the home screen once it has spend this month or a non-zero average.

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

| Quantity             | Definition                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| income I             | setting `income_monthly` (default Rs 85,000)                                                                                                                              |
| committed C          | Σ active recurring + Σ installments of open loans (capped at what's left) + averages of top-level **fixed** categories that have no active recurring row in their subtree |
| variable V           | Σ averages of top-level **variable** categories (hidden ones included)                                                                                                    |
| goal contributions G | Σ `monthly` of goals not achieved and not yet fully saved                                                                                                                 |
| surplus S            | I − C − V − G                                                                                                                                                             |
| floor                | as above                                                                                                                                                                  |
| free savings F       | SadaPay balance − floor                                                                                                                                                   |

A fixed category that has a recurring row is left out of the average, because the recurring row already counts
it.

**Levers** `{category_id, pct}` change the average before anything else: avg(top) + avg(target) × pct/100 for each
lever whose target is the top-level category or one of its subcategories.

Worked example (used throughout the tests). Aug–Oct history: Food Rs 30,000/mo, Car › Petrol Rs 10,000/mo,
Bills › Electricity Rs 4,000/mo, Subscriptions › VPS Rs 2,000/mo. A Guard recurring row (Rs 5,000, Bills) sits on
SadaPay. Loan installment Rs 9,000. Goal Bicycle: Rs 10,000/mo, Rs 10,000 of Rs 50,000 saved. SadaPay balance
Rs 25,000.

- C = 5,000 (Guard) + 9,000 (loan) + 2,000 (Subscriptions, no recurring row) = **16,000**. Bills is covered by
  Guard, so Electricity's average is not added.
- V = 30,000 + 10,000 = **40,000**. G = **10,000**.
- S = 85,000 − 16,000 − 40,000 − 10,000 = **Rs 19,000**.
- floor = 10,000 (envelope) + 5,000 (Guard) = 15,000. F = 25,000 − 15,000 = **Rs 10,000**.
- Lever "Food −50%" → V = 25,000, S = 34,000.

## What-if (price P)

**Save mode.**

- F ≥ P → **now**: "Affordable now — leaves Rs (F − P) free in SadaPay".
- Otherwise need = P − max(F, 0).
  - S ≤ 0 → **no**: "Not affordable — your monthly surplus is −Rs …".
  - Otherwise m = ⌈need / S⌉ months, plan = ⌈need / m⌉ rounded up to a whole rupee, ready = this month + m.
    The verdict is **easy** if m ≤ 1, **stretch** if 2 ≤ m ≤ 6, **no** if m > 6.
  - Goals don't slip, because plan ≤ S.

With the example (S = 19,000, F = 10,000):

| P       | Result                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| 8,000   | now: "Affordable now — leaves Rs 2,000 free in SadaPay"                                                              |
| 25,000  | need 15,000, m = 1, easy: "Save Rs 15,000/month for 1 month — ready Dec 2026"                                        |
| 60,000  | need 50,000, m = 3, stretch: "Save Rs 16,667/month for 3 months — ready Feb 2027"                                    |
| 200,000 | need 190,000, m = 10, no: "Not affordable within 6 months — saving Rs 19,000/month takes 10 months (ready Sep 2027)" |

**Loan mode** (n months).

- installment = ⌈P / n⌉, rounded up to a whole rupee. Existing installments are already in C, so the new one is
  compared with S.
- Verdict: S ≤ 0 → **no**. Otherwise installment ≤ 50% of S → **easy**; ≤ S → **stretch**; else **no**.
- **debt_free_month** simulates month by month from this month:
  - each existing loan pays from its next payment month, and the new loan from next month;
  - the monthly debt budget is the sum of the installments of loans that have started;
  - the budget pays the oldest loan first, so a cleared loan's installment rolls onto the next one.
- **goal_delays**: shortfall = max(0, installment − max(S, 0)). For n months it is taken out of goal contributions,
  lowest-priority goal first. Each goal's ETA is recomputed, and the delay is the number of months it slips.

Examples (S = 19,000; an existing Rs 90,000 loan at Rs 9,000/month):

- P = 90,000 over 10 → installment 9,000 ≤ 9,500 → **easy**. Both loans clear by **Sep 2027**: "Rs 9,000/month
  over 10 months — debt-free by Sep 2027".
- P = 150,000 over 10 → 15,000 ≤ 19,000 → **stretch**.
- P = 300,000 over 10 → 30,000 > 19,000 → **no**. The shortfall of 11,000/month takes Bicycle's whole Rs 10,000 for
  10 months, so its ETA moves from Feb 2027 to Dec 2027 (**10 months**).

**Waterfall:** income → −C → −V → −G → surplus → −(monthly plan or installment) → left. For the P = 90,000 loan
that's 85,000 → −16,000 → −40,000 → −10,000 → 19,000 → −9,000 → **10,000 left**.

## Goals

- saved = Σ goal moves. remaining = max(0, target − saved). progress = saved / target.
- **ETA.** Contributions start this month, unless a positive move was already made this month, in which case they
  start next month. ETA = start + ⌈remaining / monthly⌉ − 1. An achieved goal reports its `achieved_on` month; a
  goal with monthly 0 and money still remaining has no ETA.

Example: Bicycle, Rs 40,000 remaining at Rs 10,000/month, nothing moved yet in Nov → Nov + 3 = **Feb 2027**.

## Suggested split

- **SadaPay** = active recurring on SadaPay + loan installments + averages of fixed categories with no recurring
  row + goal contributions.
- **NayaPay** = max(0, income − SadaPay).

Example: 5,000 + 9,000 + 2,000 + 10,000 = **Rs 26,000** to SadaPay, and **Rs 59,000** to NayaPay.

## Month close checklist

**Block items** (all must pass):

| Item                        | Passes when                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| month ended                 | today ≥ the 1st of next month (SadaPay statements exclude today), which is `closable_from`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| statements, per wallet      | the union of statement periods covers every day of the month; otherwise the gaps are listed, e.g. "NayaPay statement missing for 16–31 Oct"                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| statement checks            | every check on statements overlapping the month passes, and for each pair of back-to-back statements (next.from = prev.to + 1 day) with both values known, \|prev.closing − next.opening\| ≤ Rs 1                                                                                                                                                                                                                                                                                                                                                                                                                         |
| unverified                  | no provisional or disputed transactions in the month                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| uncategorised               | every `spend`/`fee` transaction in the month has a category                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| closing balance, per wallet | derivable at the last day 23:59, trying in order: (1) a statement covering that day with a known closing (closing − Σ transactions after month end up to the statement's end); (2) the opening of a statement starting the next day; (3) if statements cover the whole month, any balance anchor (statement or manual): the latest one at/before month end + Σ transactions up to month end (statements must also cover from its day), else the earliest one after month end − Σ transactions between month end and it. SadaPay statements carry no balances, so a manual balance entered after month end is enough there |

**Warn items:**

- a `spend` transfer to a person (by description) with no reason;
- an active recurring payment with no outflow in the month on its wallet within ±10% of its amount and matching
  its counterparty or category;
- a loan started before the month, still outstanding, with no `loan_repay` in the month.

Labels carry counts and amounts, e.g. "Categorise 2 transactions (Rs 800)", and each item links to a route that
fixes it, e.g. `/activity?month=2026-10&filter=untagged`.

`closeMonth` refuses with every blocking label when `can_close` is false.

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

## Snapshot

`buildSnapshot(ds, month)` writes canonical JSON:

- what it contains:
  - the month's transactions;
  - statements overlapping the month;
  - balance entries from the previous month's last 23:59 to this month's last 23:59;
  - the categories referenced, with their parents;
  - the counterparties referenced;
  - the month record's id, status and closed_at;
- object keys are sorted recursively, rows are sorted (transactions by time then id, the rest by id), and
  `version` is omitted.

`sha256` is the hex SHA-256 of that JSON via WebCrypto, so the same month content always produces the same hash.
