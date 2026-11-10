import { z } from "zod";
import { AccountId, Flow, Id, LocalDate, LocalDateTime, Month, Paisa, StatementCheck } from "./entities.ts";

/**
 * Commands are the only way data changes. Clients queue them (offline-safe, idempotent by `id`),
 * apply an optimistic preview locally, and push them to the server, which validates and executes
 * them authoritatively, appends them to the command log, and bumps row versions.
 *
 * Commands touching a closed month are rejected unless listed in STEP_UP_ALLOWED *and* the request
 * carries a valid step-up token (fingerprint on Android, passkey on web).
 */

/** A statement as parsed on the device (packages/parsers output). */
export const ParsedStatementRow = z.object({
  occurred_at: LocalDateTime,
  type: z.string(),
  description: z.string(),
  reason: z.string().nullable(),
  amount: Paisa,
  fee: Paisa,
  balance_after: Paisa.nullable(),
  external_id: z.string(),
});
export type ParsedStatementRow = z.infer<typeof ParsedStatementRow>;

export const ParsedStatement = z.object({
  bank: AccountId,
  from: LocalDate,
  to: LocalDate,
  opening: Paisa.nullable(),
  closing: Paisa.nullable(),
  totalIn: Paisa,
  totalOut: Paisa,
  rows: z.array(ParsedStatementRow),
  checks: z.array(StatementCheck),
  /** account holder's name as printed on the statement ("Arqam Zia") — identifies transfers from yourself */
  holder: z.string().nullable().optional(),
});
export type ParsedStatement = z.infer<typeof ParsedStatement>;

const cmd = <N extends string, A extends z.ZodTypeAny>(name: N, args: A) =>
  z.object({ id: Id, name: z.literal(name), at: z.string(), args });

export const Command = z.discriminatedUnion("name", [
  cmd(
    "importStatement",
    z.object({ statement: ParsedStatement, file_name: z.string(), file_sha256: z.string() }),
  ),
  cmd(
    "addProvisional",
    z.object({
      txn_id: Id,
      account_id: AccountId,
      occurred_at: LocalDateTime,
      amount: Paisa,
      reason: z.string().nullable(),
      category_id: Id.nullable(),
      flow: Flow.nullable(),
      counterparty_name: z.string().nullable(),
    }),
  ),
  cmd("deleteProvisional", z.object({ txn_id: Id })),
  cmd(
    "tagTransaction",
    z.object({
      txn_id: Id,
      category_id: Id.nullable().optional(),
      reason: z.string().nullable().optional(),
      flow: Flow.optional(),
      counterparty_id: Id.nullable().optional(),
      loan_id: Id.nullable().optional(),
      linked_txn_id: Id.nullable().optional(),
      /** create a rule so future matching transactions get the same category/flow */
      remember: z.object({ pattern: z.string() }).optional(),
    }),
  ),
  cmd("resolveDisputed", z.object({ txn_id: Id, action: z.enum(["delete", "keep_provisional"]) })),
  cmd(
    "recordBalance",
    z.object({ entry_id: Id, account_id: AccountId, balance: Paisa, as_of: LocalDateTime }),
  ),
  cmd(
    "upsertCategory",
    z.object({
      category_id: Id,
      parent_id: Id.nullable(),
      name: z.string(),
      icon: z.string(),
      wallet_hint: AccountId.nullable(),
      nature: z.enum(["fixed", "variable"]),
      hidden: z.boolean(),
      sort: z.number().int(),
      budget: Paisa.nullable().optional(),
    }),
  ),
  cmd(
    "upsertRule",
    z.object({
      rule_id: Id,
      pattern: z.string(),
      category_id: Id.nullable(),
      flow: Flow.nullable(),
      counterparty_id: Id.nullable(),
      priority: z.number().int(),
    }),
  ),
  cmd("deleteRule", z.object({ rule_id: Id })),
  cmd(
    "upsertCounterparty",
    z.object({
      counterparty_id: Id,
      name: z.string(),
      kind: z.enum(["person", "merchant", "self", "family"]),
      aliases: z.array(z.string()),
      default_category_id: Id.nullable(),
      default_flow: Flow.nullable(),
    }),
  ),
  cmd("mergeCounterparties", z.object({ into_id: Id, from_ids: z.array(Id).min(1) })),
  cmd(
    "upsertRecurring",
    z.object({
      recurring_id: Id,
      name: z.string(),
      account_id: AccountId,
      category_id: Id.nullable(),
      counterparty_id: Id.nullable(),
      amount: Paisa,
      day_of_month: z.number().int().min(1).max(31),
      active: z.boolean(),
      cadence: z.enum(["monthly", "yearly"]).optional(),
      month_of_year: z.number().int().min(1).max(12).nullable().optional(),
      kind: z.enum(["subscription", "bill", "other"]).optional(),
      source_txn_id: Id.nullable().optional(),
    }),
  ),
  cmd("deleteRecurring", z.object({ recurring_id: Id })),
  cmd(
    "upsertLoan",
    z.object({
      loan_id: Id,
      lender: z.string(),
      counterparty_id: Id.nullable(),
      principal: Paisa,
      started_on: LocalDate,
      purpose: z.string(),
      installment: Paisa,
      note: z.string().nullable(),
      manual_repaid: Paisa,
      closed_on: LocalDate.nullable(),
    }),
  ),
  cmd(
    "upsertGoal",
    z.object({
      goal_id: Id,
      name: z.string(),
      icon: z.string(),
      target: Paisa,
      monthly: Paisa,
      priority: z.number().int(),
      achieved_on: LocalDate.nullable(),
    }),
  ),
  cmd("deleteGoal", z.object({ goal_id: Id })),
  cmd(
    "moveGoal",
    z.object({ move_id: Id, goal_id: Id, amount: Paisa, on: LocalDate, note: z.string().nullable() }),
  ),
  cmd("setSetting", z.object({ key: z.string(), value: z.string() })),
  cmd("closeMonth", z.object({ month: Month })),
  cmd("reopenMonth", z.object({ month: Month, reason: z.string().min(3) })),
  /**
   * Wipes ledger data (transactions, statements, balances, months, notifications, goal_moves) and restarts
   * tracking at `tracking_start` (first of a month). Keeps configuration (categories, rules, counterparties,
   * recurring, loans, goals, settings). Requires step-up. The server bumps the ledger epoch so every
   * client discards its local replica and re-pulls.
   */
  cmd("resetLedger", z.object({ tracking_start: LocalDate, confirm: z.literal("RESET") })),
  /** Sets the opening balance brought forward for the first tracked month of an account (b/f entry). */
  cmd("setOpeningBalance", z.object({ account_id: AccountId, amount: Paisa })),
]);
export type Command = z.infer<typeof Command>;
export type CommandName = Command["name"];
export type CommandArgs<N extends CommandName> = Extract<Command, { name: N }>["args"];

/** Commands allowed on a closed month (with step-up auth). Everything else is rejected. */
export const STEP_UP_ALLOWED: readonly CommandName[] = ["tagTransaction", "reopenMonth"];
/** Commands that always require step-up, regardless of month. */
export const STEP_UP_REQUIRED: readonly CommandName[] = ["resetLedger", "reopenMonth"];
