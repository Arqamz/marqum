/**
 * Statement readers for NayaPay (CSV + PDF) and SadaPay (PDF).
 * Pure functions over text/lines, so they run in the browser, the Worker and Node tests.
 * Detection is by content, never by file name.
 */
import type { AccountId, ParsedStatement, ParsedStatementRow } from "@marqum/schema";
import { parseCsv } from "./csv.ts";
import type { Line } from "./pdf-lines.ts";
import { parseAmount, parseDate, sha256Hex } from "./util.ts";

export class StatementError extends Error {
  override name = "StatementError";
}

/** Row under construction; `hashText` is the description as the original algorithm hashed it (keeps ids stable). */
interface WorkRow extends ParsedStatementRow {
  hashText: string;
}

type Check = ParsedStatement["checks"][number];

const dateOnly = (s: string | null | undefined) => (s ? s.slice(0, 10) : null);

// ---------------------------------------------------------------------------------------------
// Entry points

export async function readCsvStatement(text: string): Promise<ParsedStatement> {
  if (/nayapay/i.test(text)) return nayapayCsv(text);
  throw new StatementError("Unrecognised CSV — only NayaPay CSV statements are supported so far.");
}

export async function readPdfStatement(lines: Line[]): Promise<ParsedStatement> {
  const all = lines.map((l) => l.text).join("\n");
  if (/nayapay/i.test(all)) return nayapayPdf(lines);
  if (/\bSADA\b|sadapay|Account transactions from/i.test(all)) return sadapayPdf(lines);
  throw new StatementError("Unrecognised PDF — expected a NayaPay or SadaPay account statement.");
}

// ---------------------------------------------------------------------------------------------
// Reasons: a transfer purpose or message the bank printed with the row

const LABELLED =
  /^(?:purpose(?: of (?:payment|transfer))?|message|note|remarks?|reason|comments?|narration)\s*[:\-–]\s*(.+)$/i;
const INLINE = /\s*[|,;-]?\s*\b(?:purpose(?: of (?:payment|transfer))?|message|remarks?)\s*:\s*(.+)$/i;
const QUOTED = /^["“'‘](.+)["”'’]$/;

/** Splits description parts into the bank's text and an optional reason. */
export function extractReason(
  parts: string[],
  allowQuoted = false,
): { text: string[]; reason: string | null } {
  const text: string[] = [];
  const reasons: string[] = [];
  for (const p of parts) {
    const labelled = p.match(LABELLED);
    const quoted = allowQuoted ? p.match(QUOTED) : null;
    const inline = p.match(INLINE);
    if (labelled?.[1]) reasons.push(labelled[1].trim());
    else if (quoted?.[1]) reasons.push(quoted[1].trim());
    else if (inline?.[1] && inline.index !== undefined && inline.index > 0) {
      text.push(p.slice(0, inline.index).trim());
      reasons.push(inline[1].trim());
    } else text.push(p);
  }
  const reason = reasons.filter(Boolean).join(" · ");
  return { text, reason: reason || null };
}

// ---------------------------------------------------------------------------------------------
// NayaPay

/** "Incoming fund transfer from X\nMeezan-0000|Transaction ID 900001|Service Charges Rs. 0" → parts */
function splitNayapayDescription(raw: string) {
  const parts = raw
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  let txnId: string | null = null;
  let fee: number | null = null;
  const text: string[] = [];
  for (const p of parts) {
    const id = p.match(/^Transaction ID\s*:?\s*(\S+)/i);
    const fe = p.match(/^Service Charges?\s*:?\s*(.+)$/i);
    if (id?.[1]) txnId = id[1];
    else if (fe?.[1]) fee = parseAmount(fe[1]);
    else text.push(p);
  }
  const r = extractReason(text);
  return { description: r.text.join(" "), hashText: text.join(" "), reason: r.reason, txnId, fee: fee || 0 };
}

function nayapayRow(
  at: string,
  type: string,
  rawDescription: string,
  amount: number,
  balance: number | null,
): WorkRow {
  const d = splitNayapayDescription(rawDescription);
  return {
    occurred_at: at,
    type,
    description: d.description,
    reason: d.reason,
    amount,
    fee: d.fee,
    balance_after: balance,
    external_id: d.txnId ? `naya:${d.txnId}` : "",
    hashText: d.hashText,
  };
}

async function nayapayCsv(text: string): Promise<ParsedStatement> {
  const rows = parseCsv(text);
  const find = (re: RegExp) => rows.find((r) => re.test(r[0] ?? ""));
  const period = find(/^Account Statement for/i)
    ?.slice(1)
    .join(" ")
    .match(/from (.+?) to (.+)$/i);
  const bal = find(/^Opening Balance/i);
  const headerIdx = rows.findIndex(
    (r) => /^TIMESTAMP$/i.test(r[0] ?? "") && r.some((c) => /^AMOUNT$/i.test(c)),
  );
  const header = rows[headerIdx];
  if (!header) throw new StatementError("NayaPay CSV: transaction table header not found.");
  const h = header.map((c) => c.toUpperCase());
  const cell = (r: string[], name: string) => {
    const i = h.indexOf(name);
    return i >= 0 ? r[i] : undefined;
  };

  const out: WorkRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const at = parseDate(cell(r, "TIMESTAMP"));
    const amount = parseAmount(cell(r, "AMOUNT"));
    if (!at || amount === null) continue;
    const balance = h.includes("BALANCE") ? parseAmount(cell(r, "BALANCE")) : null;
    out.push(nayapayRow(at, cell(r, "TYPE") ?? "", cell(r, "DESCRIPTION") ?? "", amount, balance));
  }
  return finish("nayapay", out, {
    from: dateOnly(parseDate(period?.[1])),
    to: dateOnly(parseDate(period?.[2])),
    opening: bal ? parseAmount(bal[1]) : null,
    closing: bal ? parseAmount(bal[3]) : null,
    holder: find(/^Customer Name$/i)?.[1] ?? null,
  });
}

async function nayapayPdf(lines: Line[]): Promise<ParsedStatement> {
  const all = lines.map((l) => l.text).join("\n");
  const period = all.match(/(\d{1,2} \w{3,9} \d{4})\s*-\s*(\d{1,2} \w{3,9} \d{4})/);

  // "Opening Balance  Total Spent  Closing Balance" label line, values on a following line
  let opening: number | null = null;
  let closing: number | null = null;
  const li = lines.findIndex((l) => /Opening Balance/i.test(l.text) && /Closing Balance/i.test(l.text));
  if (li >= 0) {
    const vals = lines
      .slice(li + 1, li + 4)
      .find((l) => (l.text.match(/Rs\.?\s*[\d,.]+/g) ?? []).length >= 2);
    const amounts = vals?.text.match(/-?Rs\.?\s*-?[\d,]+(?:\.\d+)?/g)?.map((a) => parseAmount(a)) ?? [];
    opening = amounts[0] ?? null;
    closing = amounts.at(-1) ?? null;
  }

  const table = extractTable(lines, {
    header: (l) => /^TIME$/i.test(l.cells[0]?.text ?? "") && /AMOUNT/i.test(l.text),
    stop: (l) => /DISCLAIMER|auto-generated statement/i.test(l.text),
    dateCol: "TIME",
  });
  const out: WorkRow[] = [];
  for (const r of table) {
    const [dateText, timeText] = r.TIME ?? [];
    const at = parseDate(`${dateText ?? ""} ${timeText ?? ""}`);
    const amount = parseAmount((r.AMOUNT ?? []).join(""));
    if (!at || amount === null) continue;
    const balance = r.BALANCE ? parseAmount(r.BALANCE.join("")) : null;
    out.push(nayapayRow(at, (r.TYPE ?? []).join(" "), (r.DESCRIPTION ?? []).join("\n"), amount, balance));
  }
  return finish("nayapay", out, {
    from: dateOnly(parseDate(period?.[1])),
    to: dateOnly(parseDate(period?.[2])),
    opening,
    closing,
    // the holder's name is the line just above their email address in the header
    holder: (() => {
      const i = lines.findIndex((l) => l.page === 1 && /^\S+@\S+\.\S+$/.test(l.text.trim()));
      const name = i > 0 ? lines[i - 1]?.text.trim() : undefined;
      return name && /^[A-Za-z][A-Za-z .'-]{1,60}$/.test(name) ? name : null;
    })(),
  });
}

// ---------------------------------------------------------------------------------------------
// SadaPay

async function sadapayPdf(lines: Line[]): Promise<ParsedStatement> {
  const all = lines.map((l) => l.text).join("\n");
  const period = all.match(/transactions from\s+(\d{1,2} \w+,? \d{4})\s*-\s*(\d{1,2} \w+,? \d{4})/i);

  const table = extractTable(lines, {
    header: (l) => /^Date$/i.test(l.cells[0]?.text ?? "") && /Debit\/Credit|Amount/i.test(l.text),
    stop: (l) => /^Note:|system generated statement|Generated on:/i.test(l.text),
    dateCol: "DATE",
    group: "nearest",
  });
  const out: WorkRow[] = [];
  for (const r of table) {
    const [dateText, timeText] = r.DATE ?? [];
    const at = parseDate(`${dateText ?? ""} ${timeText ?? ""}`);
    const amountCol = Object.keys(r).find((k) => /DEBIT|CREDIT|AMOUNT/.test(k));
    const amount = amountCol ? parseAmount((r[amountCol] ?? []).join("")) : null;
    if (!at || amount === null) continue;
    const parts = (r.DESCRIPTION ?? []).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
    let hashText = parts.join(" ").replace(/\s+/g, " ").trim();
    let type = "";
    const t = hashText.match(/\s*\(([^()]+)\)$/); // trailing "(Incoming transfer)"
    if (t?.[1] && hashText.length > t[0].length) {
      type = t[1];
      hashText = hashText.slice(0, -t[0].length).trim();
      if (parts.at(-1) === `(${type})`) parts.pop();
    }
    // the first line names the counterparty; later lines may carry a labelled or quoted message
    const [head = "", ...tail] = parts;
    const r2 = extractReason(tail, true);
    const headReason = extractReason([head]);
    const description = [...headReason.text, ...r2.text].join(" ").trim();
    const reason = [headReason.reason, r2.reason].filter(Boolean).join(" · ") || null;
    out.push({
      occurred_at: at,
      type,
      description,
      reason,
      amount,
      fee: 0,
      balance_after: null,
      external_id: "",
      hashText,
    });
  }

  const totals = all.match(/Total debit\s+Total credit\s*\n\s*([\d,.]+)\s+([\d,.]+)/i);
  const st = await finish("sadapay", out, {
    from: dateOnly(parseDate(period?.[1])),
    to: dateOnly(parseDate(period?.[2])),
    opening: null,
    closing: null,
    holder: all.match(/^Name:\s*(.+)$/m)?.[1] ?? null,
  });
  if (totals) {
    const debit = parseAmount(totals[1]) ?? 0;
    const credit = parseAmount(totals[2]) ?? 0;
    st.checks.push({
      ok: debit === st.totalOut && credit === st.totalIn,
      label: `Totals match the statement (out ${fmt(debit)}, in ${fmt(credit)})`,
    });
  }
  return st;
}

// ---------------------------------------------------------------------------------------------
// Shared helpers

/**
 * Column-aware table reader. Finds the header line on each page, assigns every cell below it to
 * the nearest header column (by midpoint), and starts a new row whenever the date column holds a date.
 */
/**
 * Table rows from positioned lines. `group: "date"` (default) starts a row at each date line and appends the
 * lines below it. `group: "nearest"` is for layouts that vertically centre each row's cells (SadaPay): a
 * description's first line can sit *above* its date, so every line joins the row whose amount (the centre of
 * the row) is vertically nearest on the same page.
 */
function extractTable(
  lines: Line[],
  o: {
    header: (l: Line) => boolean;
    stop: (l: Line) => boolean;
    dateCol: string;
    group?: "date" | "nearest";
    amountCol?: RegExp;
  },
): Record<string, string[]>[] {
  if (o.group === "nearest") return extractCentredTable(lines, o);
  const rows: Record<string, string[]>[] = [];
  const pages = [...new Set(lines.map((l) => l.page))];
  for (const p of pages) {
    const pl = lines.filter((l) => l.page === p);
    const hi = pl.findIndex(o.header);
    const headerLine = pl[hi];
    if (!headerLine) continue;
    const cols = headerLine.cells.map((c) => ({ x: c.x, name: c.text.toUpperCase() }));
    const colOf = (x: number): string => {
      for (let i = 0; i < cols.length - 1; i++) {
        const a = cols[i];
        const b = cols[i + 1];
        if (a && b && x < (a.x + b.x) / 2) return a.name;
      }
      return cols.at(-1)?.name ?? "";
    };
    let cur: Record<string, string[]> | null = null;
    for (const l of pl.slice(hi + 1)) {
      if (o.stop(l)) break;
      const byCol: Record<string, string[]> = {};
      for (const c of l.cells) {
        const k = colOf(c.x);
        byCol[k] ??= [];
        byCol[k].push(c.text);
      }
      const dateCell = byCol[o.dateCol]?.[0];
      if (dateCell && /^\d{1,2}[ -/]\w{3,9},?[ -/]\d{2,4}$/.test(dateCell)) {
        cur = {};
        rows.push(cur);
      }
      if (!cur) continue; // lines before the first transaction
      for (const [k, v] of Object.entries(byCol)) {
        cur[k] ??= [];
        cur[k].push(v.join(" "));
      }
    }
  }
  return rows;
}

const DATE_CELL = /^\d{1,2}[ -/]\w{3,9},?[ -/]\d{2,4}$/;

function extractCentredTable(
  lines: Line[],
  o: { header: (l: Line) => boolean; stop: (l: Line) => boolean; dateCol: string; amountCol?: RegExp },
): Record<string, string[]>[] {
  const rows: Record<string, string[]>[] = [];
  const pages = [...new Set(lines.map((l) => l.page))];
  for (const p of pages) {
    const pl = lines.filter((l) => l.page === p);
    const hi = pl.findIndex(o.header);
    const headerLine = pl[hi];
    if (!headerLine) continue;
    const cols = headerLine.cells.map((c) => ({ x: c.x, name: c.text.toUpperCase() }));
    const colOf = (x: number): string => {
      for (let i = 0; i < cols.length - 1; i++) {
        const a = cols[i];
        const b = cols[i + 1];
        if (a && b && x < (a.x + b.x) / 2) return a.name;
      }
      return cols.at(-1)?.name ?? "";
    };
    const body: Line[] = [];
    for (const l of pl.slice(hi + 1)) {
      if (o.stop(l)) break;
      body.push(l);
    }
    const amountCol = o.amountCol ?? /DEBIT|CREDIT|AMOUNT/;
    const hasAmount = (l: Line) => l.cells.some((c) => amountCol.test(colOf(c.x)) && /\d/.test(c.text));
    const dates = body.filter((l) => l.cells.some((c) => colOf(c.x) === o.dateCol && DATE_CELL.test(c.text)));
    const amounts = body.filter(hasAmount);
    // each row's centre: the amount line nearest its date line (falls back to the date line)
    const centres = dates.map((d) => {
      let best: Line | undefined;
      for (const a of amounts) if (!best || Math.abs(a.y - d.y) < Math.abs(best.y - d.y)) best = a;
      return best && Math.abs(best.y - d.y) < 20 ? best.y : d.y;
    });
    const groups: Line[][] = dates.map(() => []);
    for (const l of body) {
      let bi = -1;
      for (let i = 0; i < centres.length; i++) {
        const c = centres[i] ?? 0;
        if (bi < 0 || Math.abs(l.y - c) < Math.abs(l.y - (centres[bi] ?? 0))) bi = i;
      }
      if (bi >= 0) groups[bi]?.push(l);
    }
    for (const g of groups) {
      const row: Record<string, string[]> = {};
      for (const l of [...g].sort((a, b) => b.y - a.y)) {
        const byCol: Record<string, string[]> = {};
        for (const c of l.cells) {
          const k = colOf(c.x);
          byCol[k] = [...(byCol[k] ?? []), c.text];
        }
        for (const [k, v] of Object.entries(byCol)) row[k] = [...(row[k] ?? []), v.join(" ")];
      }
      rows.push(row);
    }
  }
  return rows;
}

const fmt = (paisa: number) => `Rs ${(paisa / 100).toLocaleString("en-PK")}`;

/** `<prefix>:h` + first 10 bytes of sha256 as hex. */
async function hashId(prefix: string, s: string): Promise<string> {
  return `${prefix}:h${(await sha256Hex(s)).slice(0, 20)}`;
}

async function finish(
  bank: AccountId,
  work: WorkRow[],
  m: {
    from: string | null;
    to: string | null;
    opening: number | null;
    closing: number | null;
    holder?: string | null;
  },
): Promise<ParsedStatement> {
  work.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  // stable ids for rows without a bank transaction id (same row → same id on every re-read)
  const seen = new Map<string, number>();
  for (const r of work) {
    if (r.external_id) continue;
    const base = `${r.occurred_at}|${r.amount}|${r.hashText.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    r.external_id = await hashId(bank === "nayapay" ? "naya" : "sada", `${base}|${n}`);
  }
  const rows: ParsedStatementRow[] = work.map(({ hashText: _, ...row }) => row);
  const from = m.from ?? dateOnly(rows[0]?.occurred_at);
  const to = m.to ?? dateOnly(rows.at(-1)?.occurred_at);
  if (!from || !to) throw new StatementError("Couldn't find the statement period.");

  const totalIn = rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const totalOut = rows.filter((r) => r.amount < 0).reduce((s, r) => s - r.amount, 0);
  const checks: Check[] = [];
  const outside = rows.filter((r) => {
    const d = r.occurred_at.slice(0, 10);
    return d < from || d > to;
  }).length;
  if (outside) checks.push({ ok: false, label: `${outside} row(s) dated outside ${from} – ${to}` });
  if (m.opening !== null && m.closing !== null) {
    const fees = rows.reduce((s, r) => s + r.fee, 0);
    const diff = m.opening + totalIn - totalOut - m.closing;
    const ok = diff === 0 || diff === fees;
    checks.push({
      ok,
      label: ok
        ? `Opening ${fmt(m.opening)} + transactions = closing ${fmt(m.closing)}`
        : `Doesn't add up: opening + transactions is off from closing by ${fmt(diff)}`,
    });
  }
  // running-balance chain: each balance = previous balance + amount (− fee)
  let breaks = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const row = rows[i];
    if (!prev || !row) continue;
    const a = prev.balance_after;
    const b = row.balance_after;
    if (a !== null && b !== null && a + row.amount - row.fee !== b && a + row.amount !== b) breaks++;
  }
  if (breaks) checks.push({ ok: false, label: `Running balance jumps unexpectedly in ${breaks} place(s)` });
  const holder = m.holder?.replace(/\s+/g, " ").trim() || null;
  return { bank, from, to, opening: m.opening, closing: m.closing, totalIn, totalOut, rows, checks, holder };
}
