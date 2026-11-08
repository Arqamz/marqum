/**
 * @marqum/core — pure domain logic shared by the web/Android client and the Worker.
 * No I/O. Every function here is deterministic given (Dataset, now).
 *
 * CONTRACT: the signatures below are fixed; implementations live in the modules re-exported here.
 * See docs/FORMULAS.md for the definitions.
 */

export * from "./analytics.ts"; // netPosition, categoryCards, categorySeries, counterpartyStats, detectRecurring, unverifiedSummary, robustZ
export * from "./classify.ts"; // classify(ds, txnLike) → { category_id, flow, counterparty_id, counterparty_key }; counterpartyKey(description)
export * from "./close.ts"; // closeChecklist, buildSnapshot
export * from "./commands.ts"; // execute(ds, command, ctx) → CommandOutcome  (server authoritative; client uses it for optimistic preview)
export * from "./dataset.ts"; // emptyDataset, applyMutations(ds, mutations) → ds, isClosed(ds, month)
export * from "./money.ts"; // formatRs, formatRsSigned, parseRs, toPaisa
export * from "./planning.ts"; // budgetModel, whatIf, suggestedSplit, loanStatus, goalStatus
export * from "./reconcile.ts"; // matchProvisional(statementRows, provisional) → pairs; used by importStatement
export * from "./time.ts"; // karachiNow, monthOf, addMonths, monthRange, daysInMonth, completeMonthsBefore
export * from "./types.ts";
