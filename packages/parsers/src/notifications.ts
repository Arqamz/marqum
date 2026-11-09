/**
 * Heuristic parser for NayaPay / SadaPay payment notifications (Android NotificationListenerService).
 * Real formats are still being collected, so this is deliberately tolerant; add real samples to
 * test/notifications.test.ts as they arrive.
 */
import { type AccountId, BANK_PACKAGES } from "@marqum/schema";
import { parseAmount } from "./util.ts";

export interface ParsedNotification {
  account_id: AccountId;
  /** signed paisa: + money in, − money out */
  amount: number;
  counterparty_name: string | null;
  reason: string | null;
  description: string;
  occurred_at: string;
  /** "Your available balance is PKR X" → paisa, when the bank states it */
  balance_after: number | null;
}

/** OTPs, logins, security and marketing messages — never transactions. */
const IGNORE = [
  /\b(otp|one[- ]time (?:password|pin|code)|verification code|security code|passcode)\b/i,
  /\b(log(?:ged)? ?in|sign(?:ed)? ?in|new device|password|pin (?:changed|reset|set))\b/i,
  /\b(offer|promo(?:tion)?|discount|% off|limited time|hurry|win(?: up to)?|chance to|get up to|upgrade now|update (?:the|your) app|new feature|invite|refer(?:ral)?)\b/i,
  /\b(request(?:ed|s)? (?:rs|pkr|money|payment)|payment request|has requested|requesting)\b/i,
  /\b(failed|declined|unsuccessful|reversed? pending|insufficient)\b/i,
  // approval prompts and card authorisations — the real spend arrives as its own notification
  /\b(tap to (?:confirm|approve|verify|authori[sz]e)|verify (?:online |your |this )?(?:payment|transaction|purchase)|confirm (?:your |the |this )?(?:payment|transaction|purchase)|approve (?:your |the |this )?(?:payment|transaction)|awaiting (?:your )?approval|authori[sz](?:e|ed|es|ation|ing))\b/i,
];

/** Credit phrases are checked first: "X sent you Rs 500" contains "sent" but is money in. */
const CREDIT =
  /\b(sent you|you(?:'ve| have)? (?:received|got)|received|credited|incoming|added to your|has been added|deposited|refund(?:ed)?|cashback|transferred to you|top[- ]?up (?:of .*)?successful(?:ly)? (?:in|to) your)\b/i;
const NOT_CREDIT = /\b(received by|has received|have received your)\b/i;
const DEBIT =
  /\b(sent|paid|spent|debited|transferred|purchase[d]?|payment|withdrawn|withdrawal|charged|deducted|used your card|transaction of)\b/i;

const AMOUNT_RE =
  /(?:\b(?:rs|pkr)\.?|₨)\s*([+-]?\s*\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\b(?:rs|pkr)\b|₨)/gi;
const NOT_AMOUNT_CONTEXT = /(balance|bal\.?|available|avl\.?|limit|fee|charges?|tax|fed)\W*(?:is|of|:)?\W*$/i;

function findAmount(text: string): number | null {
  for (const m of text.matchAll(AMOUNT_RE)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index);
    if (NOT_AMOUNT_CONTEXT.test(before)) continue;
    const v = parseAmount((m[1] ?? m[2] ?? "").replace(/\s+/g, ""));
    if (v !== null && v !== 0) return Math.abs(v);
  }
  return null;
}

const STOP =
  "(?=\\s+(?:on|via|for|from|to|at|has|have|had|was|is|with|using|through|successful(?:ly)?|done|completed|ref(?:erence)?|trx|txn|tid|id|account|a\\/c|iban|and|your)\\b|\\s*[,!;:(|\\n]|\\.(?:\\s|$)|\\s+-\\s|\\s+\\d|$)";
const NAME = "([A-Za-z][A-Za-z0-9.&'*/_ -]{0,48}?)";
const JUNK =
  /^(you|your|yours|me|my|the|a|an|account|wallet|card|nayapay|sadapay|bank|rs|pkr|it|this)(\s+(account|wallet|card))?$/i;

const BALANCE_RE =
  /\b(?:available|new|current|remaining|updated)\s+(?:wallet\s+|account\s+)?balance\s*(?:is|of|:)?\s*(?:rs\.?|pkr|₨)\s*([+-]?\d[\d,]*(?:\.\d{1,2})?)/i;

function findBalance(text: string): number | null {
  const m = text.match(BALANCE_RE);
  return m?.[1] ? parseAmount(m[1].replace(/\s+/g, "")) : null;
}

/** ISO-ish country codes card networks append to merchant names ("… Stockholm SWE", "… Karachi Pk"). */
const COUNTRY =
  /^(pk|pak|us|usa|gb|gbr|uk|ie|irl|nl|nld|se|swe|sg|sgp|ae|are|de|deu|fr|fra|ca|can|au|aus|lu|lux|hk|hkg|in|ind|cn|chn|tr|tur|sa|sau|qa|qat|ch|che|es|esp|it|ita|my|mys)$/i;

/**
 * Card-network merchant strings → a readable name:
 * "NetflixX12AB34CD56     Amsterdam     NLD" → "Netflix"; "G-9 (Test Bakery - Isd-rwp) Karachi Pk" → "Test Bakery".
 */
export function cleanMerchant(raw: string): string {
  let s = raw.trim();
  // "<branch code> (<Merchant> - <area>) …" → Merchant
  const branch = s.match(/^([A-Za-z0-9][\w-]{0,7})\s*\(([^()]+)\)/);
  if (branch?.[1] && branch[2] && /[\d-]/.test(branch[1])) s = branch[2].split(/\s+-\s+/)[0] ?? s;
  // padded columns: "<merchant>     <city>     <country>"
  s = s.split(/\s{2,}/)[0] ?? s;
  // trailing country (+ the city before it)
  const words = s.split(" ");
  if (words.length >= 3 && COUNTRY.test(words.at(-1) ?? "")) s = words.slice(0, -2).join(" ");
  // trailing reference glued to the name: "NetflixX12AB34CD56" → "Netflix"
  s = s.replace(/^(.*?[a-z])[A-Z]?\d[0-9A-Z]{4,}$/, "$1");
  return s.replace(/\s+/g, " ").trim() || raw.trim();
}

/** "at <merchant>" up to the end of the clause; allows parentheses and dots inside names (Apple.com/bill). */
const AT_MERCHANT =
  /\bat\s+((?:[^.!;\n]|\.(?![\s]|$)){1,90}?)(?=\s+(?:on|via|using|with|for|was|is|has|through|successful(?:ly)?|done|completed)\b|[.!;](?:\s|$)|\n|$)/i;

function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const name = raw
    .replace(/\s+/g, " ")
    .replace(/[\s'*-]+$/, "")
    .trim();
  if (!name || JUNK.test(name) || /^\d/.test(name)) return null;
  return name;
}

function findCounterparty(text: string, credit: boolean): string | null {
  const tries: RegExp[] = credit
    ? [
        new RegExp(`\\bfrom\\s+${NAME}${STOP}`, "i"),
        new RegExp(`^${NAME}\\s+(?:has\\s+)?sent you\\b`, "i"),
        new RegExp(`\\bby\\s+${NAME}${STOP}`, "i"),
      ]
    : [
        new RegExp(`\\bto\\s+${NAME}${STOP}`, "i"),
        AT_MERCHANT,
        new RegExp(`\\b(?:paid|payment to|purchase at)\\s+${NAME}${STOP}`, "i"),
      ];
  for (const re of tries) {
    for (const sentence of text.split(/(?<=[.!])\s+|\n/)) {
      const hit = sentence.trim().match(re)?.[1];
      const name = cleanName(re === AT_MERCHANT && hit ? cleanMerchant(hit) : hit);
      if (name) return name;
    }
  }
  return null;
}

function findReason(text: string): string | null {
  const labelled = text.match(
    /\b(?:purpose|message|note|remarks?|reason|description)\s*[:=-]\s*["“'‘]?(.+?)["”'’]?\s*(?:$|\n|\.(?:\s|$)|\|)/i,
  );
  if (labelled?.[1]) return labelled[1].trim();
  const quoted = text.match(/\b(?:with (?:the )?(?:message|note)|saying|for)\s*["“'‘](.+?)["”'’]/i);
  if (quoted?.[1]) return quoted[1].trim();
  return null;
}

/** True for OTPs, logins, promotions, payment requests/prompts and authorisations — never a transaction. */
export function isNonTransaction(title: string, text: string): boolean {
  const all = [title, text].filter(Boolean).join("\n");
  return IGNORE.some((re) => re.test(all));
}

export function parseNotification(
  pkg: string,
  title: string,
  text: string,
  posted_at: string,
): ParsedNotification | null {
  const account_id = (BANK_PACKAGES as Record<string, AccountId>)[pkg];
  if (!account_id) return null;
  const t = (title ?? "").trim();
  const b = (text ?? "").trim();
  const all = [t, b].filter(Boolean).join("\n");
  if (!all || IGNORE.some((re) => re.test(all))) return null;

  const amount = findAmount(all);
  if (amount === null) return null;

  const credit = CREDIT.test(all) && !NOT_CREDIT.test(all);
  const debit = !credit && DEBIT.test(all);
  if (!credit && !debit) return null;

  const body = b || t;
  return {
    account_id,
    amount: credit ? amount : -amount,
    counterparty_name: findCounterparty(body, credit) ?? (b ? findCounterparty(t, credit) : null),
    reason: findReason(all),
    description: body.replace(/\s+/g, " ").trim(),
    occurred_at: posted_at,
    balance_after: findBalance(all),
  };
}
