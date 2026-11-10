# Architecture

Marqūm (مرقوم, "inscribed") is a local-first personal finance app for two Pakistani wallets: **SadaPay** and **NayaPay**.
It runs as a sideloaded Android app and as a website. Both use the same UI and talk to one Cloudflare backend.

Design goals, in priority order:

1. **The bank is the source of truth.** Statement rows are facts. Everything else is either provisional
   (waiting to be matched to a statement) or interpretation (categories, reasons).
2. **Never lose data.** Every change is logged, and month-end snapshots are immutable.
3. **Hands-free.** Statements are picked up from the phone's storage, bank notifications become provisional
   transactions, and reminders drive the month-end close.
4. **Free to run.** Uses only Cloudflare free tiers, with no paid services.
5. **Forkable.** Accounts, categories and rules are data, not code, and bank formats are plugins.

## Money model

```
Salary → Meezan (not tracked: long-term savings/investments)
           │  ~85,000/month
           ├─→ SadaPay   "the vault": goal savings, bills, utilities, subscriptions, recurring.
           │             Must never reach zero; it has a floor (see Formulas).
           └─→ NayaPay   "the pocket": quick everyday spending. May reach zero.

Loans (e.g. from Mom) finance big purchases; they are repaid in installments.
Net position = SadaPay + NayaPay − outstanding loans (can be negative → "debt mode").
```

## Stack

| Layer        | Choice                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI           | React, Vite, TanStack Router, Tailwind, shadcn/ui, Recharts                                                                                                           |
| Android      | Capacitor shell plus small Kotlin plugins (statement inbox, notification capture, biometrics). Runs on Android System WebView, so no Google Play services are needed. |
| Local store  | IndexedDB via Dexie, holding a full replica (the data is small, so analytics run on the device)                                                                       |
| Backend      | Cloudflare Worker (Hono) + D1 (SQLite) + R2 (backups) + Cron Triggers                                                                                                 |
| Shared logic | TypeScript packages: domain, commands, formulas, statement parsers                                                                                                    |
| Tooling      | pnpm workspaces, Turborepo, Biome, Vitest, Playwright, Lefthook, commitlint                                                                                           |
| Distribution | A GitHub Release with a signed APK on every `v*` tag. Obtainium on the phone auto-updates from it.                                                                    |

## Repository layout

```
apps/
  web/        React app: the website and the UI inside the APK
  android/    Capacitor project + Kotlin plugins + signing config
  api/        Cloudflare Worker: auth, sync, ingest, backups, D1 migrations
packages/
  schema/     zod schemas for entities, commands, sync protocol (shared contract)
  core/       pure domain logic: money, ledger rules, reconciliation, month close,
              analytics (averages, outliers, recurring detection), what-if formulas
  parsers/    bank statement + notification parsers (registry; synthetic fixtures only)
  config/     shared tsconfig
docs/         ARCHITECTURE.md (this), FORMULAS.md, ADDING_A_BANK.md
scripts/      repo tooling (personal-data guard)
statements/   your real statements, local only, gitignored
```

## Data flow

```
 ┌───────────── Phone (APK) ─────────────┐      ┌──── Browser ────┐
 │ Kotlin: StatementInbox (Download/ scan)│      │                 │
 │ Kotlin: NotificationCapture ───────────┼──┐   │                 │
 │ React UI ── packages/core + parsers    │  │   │  same React UI  │
 │ Dexie replica ⇄ sync engine            │  │   │  Dexie replica  │
 └───────────────┬────────────────────────┘  │   └───────┬─────────┘
                 │ push commands / pull       │ raw text  │
           ┌─────▼─────────────────────────────▼──────────▼────┐
           │ Worker: auth · /sync · /ingest/notification ·      │
           │ same command handlers as the client (packages/core)│
           │ D1: entities + append-only command log             │
           │ Cron: nightly export → R2 · month-close snapshot   │
           └────────────────────────────────────────────────────┘
```

### Sync

- Every change is a named **command**, such as `importStatement`, `addProvisional`, `setReason`,
  `recategorize`, `recordBalance`, `createLoan` or `closeMonth`.
- The client applies a command optimistically to Dexie and queues it.
- **Push:** the server validates the command, runs the same handler, and appends it to the command log.
  It also bumps a global version on every row it touches.
- **Pull:** the client asks for "everything newer than version N", including tombstones for deletes.
- Sync runs on app open, on resume, after every command, when connectivity returns, and periodically in the background.
- If two devices edit the same row, the last write wins. That is fine for a single user.
- The server is authoritative for the rules that matter: period replacement, closed months and step-up auth.

### Auth

- A passcode issues a long-lived bearer token per device; devices are listed and revocable.
- Edits to a closed month need a **step-up** proof, enforced on the server:
  - in the app: a fingerprint unlocks an Android Keystore key, which signs a server challenge;
  - on the web: a WebAuthn passkey.

## Getting data in, from most to least hands-free

1. **Notification capture (Android).**
   - A `NotificationListenerService` reads NayaPay and SadaPay payment notifications and posts the raw text to `/ingest/notification`.
   - The Worker parses the text into a **provisional** transaction, which syncs everywhere within seconds.
   - Raw text is queued on the phone while offline.
   - This depends on those apps' notifications reaching the phone (the target phone runs LineageOS with Google services, so they do).
2. **Statement inbox (Android), for NayaPay.**
   - NayaPay writes statements to shared storage at `Android/media/com.nayapay.app/NayaPay/Other/m-MM-YYYY.{pdf,csv}`
     (verified on LineageOS 23.2 / Android 16).
   - With "All files access" granted once, the app scans that folder plus `Download/` for the known filenames
     (NayaPay `m-MM-YYYY.pdf|csv`, SadaPay `sadapay_account_statement_DD-MM-YYYY_DD-MM-YYYY.pdf`).
   - Scans happen on open and resume, and via a FileObserver while the app runs.
   - New files are parsed on the device. If all statement checks pass they are imported automatically, with no button to press.
   - Files are de-duplicated by SHA-256.
   - The banks have no API, so you still tap "generate statement" in their app; the rest is automatic.
3. **Share sheet, for SadaPay.** SadaPay keeps generated statements inside its own app storage, so the flow is
   generate → **Share → Marqūm**. The share target accepts `application/pdf` and `text/csv` and imports straight away,
   with no upload screen. It works from any other app or file manager too.
4. **Manual quick-add.** Amount, wallet and reason, entered as a **provisional** transaction.
5. **Balance entry.** You type a wallet's current balance. Any gap against the ledger shows as
   "Rs X unaccounted — add it?", which turns into a quick-add.

## Transaction lifecycle

```
           notification / manual
                   │
                   ▼
            ┌─────────────┐   statement row matches  ┌──────────┐
            │ provisional │ ───────────────────────▶ │ verified │
            └─────────────┘                          └──────────┘
                   │ statement covers its date, no match
                   ▼
            ┌─────────────┐  you resolve: delete it, or it was a different wallet
            │  disputed   │
            └─────────────┘
```

- **Verified** rows come only from statements. Their amount, date and description are immutable.
- **Matching** on import:
  - candidates must be the same wallet and the same amount, within ±36 hours;
  - a counterparty or description similarity breaks ties;
  - matches are one-to-one, best match first.
- The provisional row's reason and category move onto the verified row.
- **Replace semantics:** importing a statement for `[from, to]` replaces that wallet's verified rows in that range:
  - rows are matched by bank transaction ID, or by a stable hash when the bank gives none;
  - your tags and reasons are kept;
  - rows no longer on the statement are removed.
- While any provisional rows exist, the UI shows a banner such as "3 unverified · Rs 2,450 since 7 Nov — generate statements".
- **Cross-statement continuity:** each statement's opening balance must equal the previous statement's closing balance. A gap is flagged.

## Month-end close

From the **25th**, a daily local notification (no push server needed) starts the close checklist:

1. Tag anything that has no reason or category. Do this before month end, while you still remember.
2. Statements cover the whole month for both wallets. SadaPay statements exclude today, so the close becomes possible from the 1st.
3. Every statement check passes, and the openings and closings chain across statements.
4. No provisional or disputed transactions remain in the month.
5. Closing balances are confirmed.
6. Recurring payments and loan installments that were due are present. This item only warns.

**Close** does the following:

- It writes an immutable **snapshot** of the month to R2 under a bucket lock: transactions, balances, categories and a SHA-256 manifest.
- It marks the month closed.

**Closed months** are read-only on the server:

- The only edits allowed are `recategorize` and `setReason`. They change analytics only, and each needs step-up auth.
- A re-imported statement that is identical is a no-op.
- A statement that differs needs an explicit, step-up-authorised **reopen**, which is logged and creates a new snapshot version.

## Data safety

| Layer                                                       | Protects against                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Append-only command log in D1                               | bad edits: per-command undo for open months, replay to any point  |
| D1 Time Travel (point-in-time restore, 7 days on free tier) | a broken migration or bug                                         |
| Nightly full export to R2 (Cron Trigger)                    | losing the database                                               |
| Month-close snapshots in R2 under bucket lock               | accidental or malicious deletion; locked objects can't be deleted |
| Full replica on each device + "export to phone"             | losing the Cloudflare account                                     |

**Replica integrity.** The last page of every pull carries a digest (count and version-sum of the server's live
rows). A device whose replica doesn't match it, or whose stored ledger epoch differs (or is missing on a replica
that has synced before), drops its replica and pulls again from 0, keeping commands not yet sent. Settings ›
Reload from the server does the same on demand.

The local replica alone is **not** a backup: clearing app data or uninstalling the app wipes it. The cloud layers are what make data loss unlikely.

## Categories

Categories are two levels deep: a category and its subcategories. They are stored as data, so they can grow over time.

| Category         | Subcategories                                                                                                           | Usual wallet                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Car              | Petrol, Car wash, _Maintenance_, _Parking & tolls_                                                                      | NayaPay                           |
| Food             | Friends, Family, _Solo_                                                                                                 | NayaPay                           |
| Enjoyments       | Friends, Family                                                                                                         | NayaPay                           |
| Self             | Routine (gym, creatine, haircuts, grooming, clothing, maintenance), Indulgences (spa, mani-pedi, shaving kits, bicycle) | NayaPay / SadaPay for large items |
| Bills            | Electricity, Guard, Phone, Brother's pocket money                                                                       | SadaPay                           |
| Subscriptions    | iCloud, VPS, Domain, Foodpanda Pro                                                                                      | SadaPay                           |
| Charity          | —                                                                                                                       | SadaPay                           |
| Miscellaneous    | petty cash, small one-offs                                                                                              | NayaPay                           |
| _Health_         | _Doctor, Pharmacy_                                                                                                      | either                            |
| _Gifts_          | _Friends, Family_                                                                                                       | either                            |
| _Fees & charges_ | _bank/transfer fees (auto-tagged)_                                                                                      | either                            |

Items in _italics_ are suggestions; they are hidden until used.

**Not spending.** These are excluded from spend analytics:

- **Funding:** Meezan → wallet.
- **Internal transfer:** SadaPay ↔ NayaPay.
- **Loan received** and **Loan repayment.**
- **Reimbursement:** for example, a friend pays back their share. It offsets the category of the linked expense.

**Auto-categorisation order:**

1. Your manual choice.
2. A rule matching the reason or description, e.g. `petrol|fuel|pso|shell` → Car › Petrol.
3. The counterparty's default category, e.g. the guard's account → Bills › Guard.
4. Untagged.

After you tag something, the app offers "always do this".

## Counterparties

People and merchants are extracted from transaction descriptions, and different spellings can be merged into one counterparty.

Each counterparty page shows:

- a month-by-month chart;
- money sent vs received;
- the typical amount;
- how often you pay them, and on which weekdays and times;
- the categories involved.

## Formulas

These are implemented in `packages/core`; full definitions are in `docs/FORMULAS.md`.

| Quantity           | Definition                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Category average   | mean over the last **6** complete months (switchable to 3); months before the first data are ignored |
| Home card colour   | red if this month > average, green otherwise                                                         |
| Outlier month      | robust z-score `                                                                                     | x − median | / (1.4826·MAD) > 3` |
| Committed **C**    | recurring + loan installments                                                                        |
| Variable **V**     | Σ average over non-recurring categories                                                              |
| Surplus **S**      | income (85,000) − C − V − goal contributions                                                         |
| SadaPay floor      | Σ goal envelopes + next month's bills                                                                |
| Free savings **F** | SadaPay − floor                                                                                      |

**What-if (price P):**

- **Now:** affordable if F ≥ P.
- **Save first:** m = ⌈(P − F)/S⌉ months.
  - m ≤ 1 → Easy
  - m from 2 to 6 → Stretch
  - otherwise → Not affordable
- **On loan over n months:** installment = P/n.
  - It's feasible if the installment ≤ S.
  - The result shows the debt-free date and how many months each goal slips.
- **Levers:** for example "cut Food 20%" recomputes V live.

**Suggested split:**

- SadaPay = C + bills + goal contributions.
- NayaPay = 85,000 − SadaPay share.

Recurring payments are detected when the same counterparty is paid a similar amount (±10%) at an interval of 25–35 days, at least 3 times.

## Conventions

- Money is stored in integer **paisa**. A negative amount means money left the wallet.
- Times are local Asia/Karachi strings (`YYYY-MM-DDTHH:mm`).
- IDs are ULIDs. Statement rows keep a stable `external_id` (`naya:<txn id>` or `sada:h<hash>`).
- Commits follow Conventional Commits with a scope from `commitlint.config.mjs`.
