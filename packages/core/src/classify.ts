import type { AccountId, Counterparty, Flow } from "@marqum/schema";
import type { Dataset } from "./types.ts";

/** Words that are never part of a counterparty key: banks, wallets, cities, transfer jargon. */
const NOISE = new Set([
  "BANK",
  "LIMITED",
  "LTD",
  "PVT",
  "MEEZAN",
  "MBL",
  "HBL",
  "UBL",
  "MCB",
  "ABL",
  "BAFL",
  "ALFALAH",
  "ALLIED",
  "ASKARI",
  "FAYSAL",
  "JAZZCASH",
  "EASYPAISA",
  "SADAPAY",
  "NAYAPAY",
  "RAAST",
  "IBFT",
  "KARACHI",
  "LAHORE",
  "ISLAMABAD",
  "RAWALPINDI",
  "PESHAWAR",
  "PAK",
  "PK",
  "PAKISTAN",
  "TRANSACTION",
  "ID",
  "REF",
]);

/** Bank fees and taxes (incl. the international transaction tax / FED SadaPay adds to foreign card spends). */
export const FEE_TEXT =
  /\b(service charges?|fees?|tax|taxes|tax deducted|withholding|excise duty|fed|international transaction (tax|fee|charges?))\b/i;

export interface ExtractedCounterparty {
  key: string;
  name: string;
  /** true when the description is a fund transfer to/from a person (vs a merchant purchase) */
  person: boolean;
}

const titleCase = (s: string): string =>
  s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(" ");

/** Uppercase, strip digits/refs/punctuation and noise words, keep at most 4 words. */
export function normalizeKey(raw: string): string {
  const words = raw
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE.has(w));
  return words.slice(0, 4).join(" ");
}

function clean(raw: string, merchant: boolean): string {
  let s = raw.split(/[|\n\r]/)[0] ?? "";
  s = s.split("(")[0] ?? "";
  if (merchant && s.includes("*")) s = s.split("*")[0] ?? "";
  // drop any token containing a digit (account numbers, refs, terminal ids)
  return s
    .split(/\s+/)
    .filter((w) => !/\d/.test(w))
    .join(" ");
}

const PATTERNS: { re: RegExp; person: boolean }[] = [
  // "Outgoing fund transfer to Danish Ahmed …", "Incoming fund transfer from X", "IBFT transfer to X"
  { re: /\b(?:fund|funds|money|ibft|raast)?\s*transfer(?:red)?\s+(?:to|from)\s+(.+)/i, person: true },
  // SadaPay: "To DANISH (SadaPay)", "From X (Meezan Bank (MBL))"
  { re: /^(?:sent\s+)?(?:to|from|received from)\s+(.+)$/i, person: true },
  // "POS Purchase FOODPANDA*123 KARACHI", "Card payment at MERCHANT"
  {
    re: /\b(?:pos|card|debit card|online)\s*(?:purchase|payment|transaction)?\s*(?:at|to|on|-)?\s*(.+)/i,
    person: false,
  },
  { re: /\bbill payment\s*(?:to|for|of|-)?\s*(.+)/i, person: false },
];

/** Extract the person/merchant from a bank description. */
export function extractCounterparty(description: string): ExtractedCounterparty | null {
  const d = description.replace(/\s+/g, " ").trim();
  if (!d) return null;
  const firstLine = description.split(/[\n\r]/)[0]?.trim() ?? d;
  let raw: string | null = null;
  let person = false;
  for (const p of PATTERNS) {
    const m = p.re.exec(firstLine);
    if (m) {
      raw = m[1] ?? null;
      person = p.person;
      break;
    }
  }
  if (raw === null && !FEE_TEXT.test(d)) raw = firstLine;
  if (!raw) return null;
  const key = normalizeKey(clean(raw, !person));
  if (!key) return null;
  return { key, name: titleCase(key), person };
}

/** Normalised counterparty key from a bank description, or null when none can be extracted. */
export function counterpartyKey(description: string): string | null {
  return extractCounterparty(description)?.key ?? null;
}

/** Find the counterparty whose aliases (or normalised name) contain `key`. */
export function findCounterpartyByKey(ds: Dataset, key: string): Counterparty | null {
  return (
    ds.counterparties.find((c) => c.aliases.some((a) => normalizeKey(a) === key)) ??
    ds.counterparties.find((c) => normalizeKey(c.name) === key) ??
    null
  );
}

/** Compile a rule pattern (case-insensitive); null if invalid. */
export function compileRule(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

const OTHER_WALLET: Record<AccountId, RegExp> = { sadapay: /\bnaya ?pay\b/i, nayapay: /\bsada ?pay\b/i };
const FUNDING_TEXT = /\bmeezan\b|\bMBL\b|own[- ]account|\btop[- ]?up\b/i;

export interface ClassifyInput {
  account_id: AccountId;
  amount: number;
  description: string;
  reason: string | null;
  bank_type: string | null;
}

export interface ClassifyResult {
  category_id: string | null;
  flow: Flow;
  counterparty_id: string | null;
  counterparty_key: string | null;
  counterparty_name: string | null;
}

/** Flow from the text alone (step 3 of classify). */
export function inferFlow(t: ClassifyInput, cp: Counterparty | null): Flow {
  const text = `${t.description} ${t.bank_type ?? ""} ${t.reason ?? ""}`;
  const mentionsOtherWallet = OTHER_WALLET[t.account_id].test(text);
  // A transfer naming the other wallet is internal unless it goes to a known non-self counterparty.
  const internal = mentionsOtherWallet && (cp === null || cp.kind === "self");
  if (t.amount > 0) {
    if (internal) return "internal";
    if (FUNDING_TEXT.test(text)) return "funding";
    return "income";
  }
  if (internal) return "internal";
  if (FEE_TEXT.test(text)) return "fee";
  return "spend";
}

const INFLOW_ONLY: ReadonlySet<Flow> = new Set<Flow>(["income", "reimbursement", "loan_in", "funding"]);
const OUTFLOW_ONLY: ReadonlySet<Flow> = new Set<Flow>(["spend", "fee", "loan_repay"]);

/** A flow from a rule or counterparty default only applies when it fits the money's direction. */
export function flowFitsDirection(flow: Flow, amount: number): boolean {
  if (amount > 0) return !OUTFLOW_ONLY.has(flow);
  if (amount < 0) return !INFLOW_ONLY.has(flow);
  return true;
}

/**
 * Category, flow and counterparty for a transaction-like row.
 * Order: rules (priority desc; each of category/flow/counterparty taken from the first rule that sets it)
 * → counterparty defaults → flow inference. Funding/internal rows never carry a category.
 */
export function classify(ds: Dataset, t: ClassifyInput, cpOverride?: Counterparty | null): ClassifyResult {
  const text = `${t.description} ${t.reason ?? ""}`;
  let category_id: string | null = null;
  let flow: Flow | null = null;
  let counterparty_id: string | null = null;
  const rules = [...ds.rules].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const r of rules) {
    const re = compileRule(r.pattern);
    if (!re?.test(text)) continue;
    if (category_id === null && r.category_id) category_id = r.category_id;
    if (flow === null && r.flow && flowFitsDirection(r.flow, t.amount)) flow = r.flow;
    if (counterparty_id === null && r.counterparty_id) counterparty_id = r.counterparty_id;
  }
  const extracted = extractCounterparty(t.description);
  let cp: Counterparty | null = null;
  if (cpOverride) cp = cpOverride;
  else if (counterparty_id) cp = ds.counterparties.find((c) => c.id === counterparty_id) ?? null;
  else if (extracted) cp = findCounterpartyByKey(ds, extracted.key);
  if (cp) {
    counterparty_id = cp.id;
    if (category_id === null && cp.default_category_id) category_id = cp.default_category_id;
    if (flow === null && cp.default_flow && flowFitsDirection(cp.default_flow, t.amount))
      flow = cp.default_flow;
  }
  if (flow === null) flow = inferFlow(t, cp);
  if (flow === "funding" || flow === "internal") category_id = null;
  if (flow === "fee" && category_id === null && ds.categories.some((c) => c.id === "fees" && !c.deleted))
    category_id = "fees";
  return {
    category_id,
    flow,
    counterparty_id,
    counterparty_key: extracted?.key ?? null,
    counterparty_name: cp?.name ?? extracted?.name ?? null,
  };
}
