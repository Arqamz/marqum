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

/** Card networks and words after which a merchant line carries no more name. */
const MERCHANT_STOP = new Set(["VISA", "MASTERCARD", "UNIONPAY", "PAYPAK", "CARD", "POS"]);
/** Country codes banks append to a merchant line ("… Islamabad PK", "… Stockholm SWE"). */
const COUNTRY = new Set([
  "PK",
  "PAK",
  "PAKISTAN",
  "US",
  "USA",
  "GB",
  "GBR",
  "UK",
  "SE",
  "SWE",
  "AE",
  "ARE",
  "IE",
  "IRL",
  "NL",
  "NLD",
  "SG",
  "SGP",
]);

/** "GrocIslamabad" → "Groc Islamabad"; "DWatson" stays (a capital run is part of the name). */
const splitGlued = (w: string): string => w.replace(/([a-z])([A-Z][a-z])/g, "$1 $2");

/**
 * Merchant name from a card/purchase line: every word up to where the address, terminal id, card details or
 * country code start. Glued words are split and the city is kept, because it often tells branches apart.
 * "Food Panda 18th Floor, Office # 1-4, Karachi Si Pak" → "Food Panda"; "Spotify*p48f8f2310 …" → "Spotify";
 * "F-11 (CRUMBLE - ISD-RWP) KARACHI PK" → "CRUMBLE"; "DWatson Pharmacy And GrocIslamabad PK Visa x0000"
 * → "DWatson Pharmacy And Groc Islamabad".
 */
export function merchantName(raw: string): string {
  const line = raw.split(/[|\n\r]/)[0] ?? "";
  const bracket = /\(([^)]*[A-Za-z]{3,}[^)]*)\)/.exec(line)?.[1] ?? "";
  let head = line.split("(")[0] ?? "";
  if (head.includes("*")) head = head.split("*")[0] ?? "";
  const out: string[] = [];
  for (const tok of splitGlued(head).split(/\s+/)) {
    if (!tok) continue;
    if (/\d/.test(tok)) {
      if (out.length) break; // an address ("18th Floor") or reference starts here
      continue; // a leading code ("F-11", "19")
    }
    let w = tok.replace(/\.(com|pk|net|org|io)$/i, "");
    const bare = w.toUpperCase().replace(/[^A-Z]/g, "");
    if (MERCHANT_STOP.has(bare)) break;
    if (COUNTRY.has(bare) && out.length) break;
    const comma = w.endsWith(",");
    w = w.replace(/[,;:]+$/, "");
    if (w) out.push(w);
    if (comma) break; // "Name, address…"
  }
  const name = out.join(" ");
  if (normalizeKey(name)) return name;
  return (bracket.split(/\s+-\s+/)[0] ?? "").trim();
}

/** Title-case words that are all caps or all lower; keep deliberate mixed case ("DWatson", "iCloud"). */
export function displayName(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) =>
      w === w.toUpperCase() || w === w.toLowerCase()
        ? (w[0]?.toUpperCase() ?? "") + w.slice(1).toLowerCase()
        : w,
    )
    .join(" ");
}

function clean(raw: string, merchant: boolean): string {
  if (merchant) return merchantName(raw);
  let s = raw.split(/[|\n\r]/)[0] ?? "";
  s = s.split("(")[0] ?? "";
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
  // NayaPay card spends: "Paid to F-11 (CRUMBLE - ISD-RWP) KARACHI PK Visa x1234"
  { re: /^paid\s+(?:to|at)\s+(.+)$/i, person: false },
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
  const cleaned = clean(raw, !person);
  const key = normalizeKey(cleaned);
  if (!key) return null;
  // the name keeps every word of the cleaned text (cities too); the key is the short form used for matching
  const name = person ? titleCase(key) : displayName(cleaned.replace(/[^A-Za-z0-9&'.\s-]/g, " "));
  return { key, name: name || titleCase(key), person };
}

/** Normalised counterparty key from a bank description, or null when none can be extracted. */
export function counterpartyKey(description: string): string | null {
  return extractCounterparty(description)?.key ?? null;
}

/** Find the counterparty whose aliases (or normalised name) contain `key`. */
export function findCounterpartyByKey(ds: Dataset, key: string): Counterparty | null {
  const live = ds.counterparties.filter((c) => !c.deleted);
  const exact =
    live.find((c) => c.aliases.some((a) => normalizeKey(a) === key)) ??
    live.find((c) => normalizeKey(c.name) === key);
  if (exact) return exact;
  // The same merchant read with more or fewer words ("DWATSON PHARMACY AND" vs "DWATSON PHARMACY AND GROC"):
  // one key starts with the other, word by word, sharing at least two words.
  const words = key.split(" ");
  const prefixOf = (a: string[], b: string[]) =>
    a.length >= 2 && a.length <= b.length && a.every((w, i) => b[i] === w);
  return (
    live.find((c) =>
      c.aliases.some((a) => {
        const aw = normalizeKey(a).split(" ");
        return prefixOf(aw, words) || prefixOf(words, aw);
      }),
    ) ?? null
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

/**
 * Flow from the text alone (step 3 of classify).
 * - A transfer naming the other wallet is internal unless it involves a known non-self counterparty.
 * - Bank text (Meezan…) is funding only when the money comes from *you*: your self counterparty, or no named
 *   sender at all. A named person who isn't you (someone who also banks with Meezan) is income.
 */
export function inferFlow(
  t: ClassifyInput,
  cp: Counterparty | null,
  extracted?: ExtractedCounterparty | null,
): Flow {
  const text = `${t.description} ${t.bank_type ?? ""} ${t.reason ?? ""}`;
  const mentionsOtherWallet = OTHER_WALLET[t.account_id].test(text);
  const internal = mentionsOtherWallet && (cp === null || cp.kind === "self");
  const fromYou = cp ? cp.kind === "self" : !extracted?.person;
  if (t.amount > 0) {
    if (internal) return "internal";
    if (FUNDING_TEXT.test(text) && fromYou) return "funding";
    return "income";
  }
  if (internal) return "internal";
  if (FEE_TEXT.test(text)) return "fee";
  return "spend";
}

/** True when a counterparty key is (part of) the statement holder's name: "ARQAM" ⊂ "Arqam Zia". */
export function isHolder(key: string, holder: string | null | undefined): boolean {
  if (!holder) return false;
  const mine = new Set(normalizeKey(holder).split(" ").filter(Boolean));
  const words = key.split(" ").filter(Boolean);
  return words.length > 0 && words.every((w) => mine.has(w));
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
  if (flow === null) flow = inferFlow(t, cp, extracted);
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

/** Banks and wallets a transfer can come from or go to: [label, regex source]. */
const INSTITUTIONS: [string, string][] = [
  ["Meezan", "meezan|mbl"],
  ["NayaPay", "naya ?pay"],
  ["SadaPay", "sada ?pay"],
  ["Easypaisa", "easy ?paisa"],
  ["JazzCash", "jazz ?cash"],
  ["HBL", "hbl|habib bank"],
  ["UBL", "ubl|united bank"],
  ["MCB", "mcb"],
  ["Alfalah", "alfalah|bafl"],
  ["Allied", "allied|abl"],
  ["Askari", "askari"],
  ["Faysal", "faysal"],
  ["Bank Islami", "bank ?islami"],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The rule "Always tag … like this" creates for a transaction. Names alone are ambiguous ("ARQAM" is both your
 * Meezan account and your NayaPay wallet), so a transfer's rule also requires the same bank/wallet and the same
 * direction: "From Arqam · Meezan" won't match "From Arqam · NayaPay". A merchant's rule is its name.
 * The pattern is matched (case-insensitively) against `${description} ${reason}`.
 */
export function rememberRule(description: string): { pattern: string; label: string } | null {
  const ex = extractCounterparty(description);
  if (!ex) return null;
  const words = ex.key.toLowerCase().split(" ").filter(Boolean);
  const name = `\\b${words.map(escapeRe).join("\\W*")}\\b`;
  if (!ex.person) return { pattern: name, label: ex.name };
  const text = description.replace(/\s+/g, " ");
  const incoming = /\b(from|incoming|received)\b/i.test(text);
  const outgoing = !incoming && /\b(to|outgoing|sent|paid)\b/i.test(text);
  const dir = incoming ? "(?:from|incoming|received)" : outgoing ? "(?:to|outgoing|sent|paid)" : null;
  // the institution named after the counterparty (the sender's/receiver's bank), else anywhere
  const after = text.slice(Math.max(0, text.toUpperCase().indexOf(words[0]?.toUpperCase() ?? "")));
  const inst =
    INSTITUTIONS.find(([, re]) => new RegExp(`\\b(?:${re})\\b`, "i").test(after)) ??
    INSTITUTIONS.find(([, re]) => new RegExp(`\\b(?:${re})\\b`, "i").test(text));
  const parts = [dir ? `\\b${dir}\\b` : null, name, inst ? `\\b(?:${inst[1]})\\b` : null].filter(
    (p): p is string => p !== null,
  );
  const pattern = parts.map((p) => `(?=[\\s\\S]*${p})`).join("");
  const label = [incoming ? `From ${ex.name}` : outgoing ? `To ${ex.name}` : ex.name, inst?.[0]]
    .filter(Boolean)
    .join(" · ");
  return { pattern, label };
}

/** Human-readable form of a rule pattern made by rememberRule ("From Arqam · Meezan"); other patterns as is. */
export function describeRule(pattern: string): string {
  const parts = [...pattern.matchAll(/\(\?=\[\\s\\S\]\*(.+?)\)(?=\(\?=|$)/g)].map((m) => m[1] ?? "");
  if (parts.length === 0) {
    const plain = /^\\b(.+)\\b$/.exec(pattern)?.[1];
    return plain && !/[()|?*+[\]]/.test(plain.replace(/\\W\*/g, " "))
      ? titleCase(plain.replace(/\\W\*/g, " "))
      : pattern;
  }
  let dir = "";
  let inst = "";
  let name = "";
  for (const p of parts) {
    const inner = p.replace(/^\\b/, "").replace(/\\b$/, "");
    if (inner.startsWith("(?:from")) dir = "From";
    else if (inner.startsWith("(?:to")) dir = "To";
    else if (inner.startsWith("(?:"))
      inst = INSTITUTIONS.find(([, re]) => inner === `(?:${re})`)?.[0] ?? inner;
    else name = titleCase(inner.replace(/\\W\*/g, " "));
  }
  return [dir ? `${dir} ${name}` : name, inst].filter(Boolean).join(" · ");
}
