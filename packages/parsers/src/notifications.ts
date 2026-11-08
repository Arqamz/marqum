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
}

/** OTPs, logins, security and marketing messages — never transactions. */
const IGNORE = [
  /\b(otp|one[- ]time (?:password|pin|code)|verification code|security code|passcode)\b/i,
  /\b(log(?:ged)? ?in|sign(?:ed)? ?in|new device|password|pin (?:changed|reset|set))\b/i,
  /\b(offer|promo(?:tion)?|discount|% off|limited time|hurry|win(?: up to)?|chance to|get up to|upgrade now|update (?:the|your) app|new feature|invite|refer(?:ral)?)\b/i,
  /\b(request(?:ed|s)? (?:rs|pkr|money|payment)|payment request|has requested|requesting)\b/i,
  /\b(failed|declined|unsuccessful|reversed? pending|insufficient)\b/i,
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
        new RegExp(`\\bat\\s+${NAME}${STOP}`, "i"),
        new RegExp(`\\b(?:paid|payment to|purchase at)\\s+${NAME}${STOP}`, "i"),
      ];
  for (const re of tries) {
    for (const sentence of text.split(/(?<=[.!])\s+|\n/)) {
      const name = cleanName(sentence.trim().match(re)?.[1]);
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
  };
}
