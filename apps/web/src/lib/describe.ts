import type { Command } from "@marqum/schema";

const NAMES: Record<Command["name"], string> = {
  importStatement: "Statement import",
  addProvisional: "Quick-add",
  deleteProvisional: "Delete",
  tagTransaction: "Tag",
  resolveDisputed: "Resolve",
  recordBalance: "Balance",
  upsertCategory: "Category change",
  upsertRule: "Rule",
  deleteRule: "Rule delete",
  upsertCounterparty: "Counterparty change",
  mergeCounterparties: "Merge",
  upsertRecurring: "Recurring change",
  deleteRecurring: "Recurring delete",
  upsertLoan: "Loan change",
  upsertGoal: "Goal change",
  deleteGoal: "Goal delete",
  moveGoal: "Goal move",
  setSetting: "Setting",
  closeMonth: "Close",
  reopenMonth: "Reopen",
};

export function describeCommand(c: Command | undefined): string {
  if (!c) return "A change";
  return NAMES[c.name] ?? "A change";
}
