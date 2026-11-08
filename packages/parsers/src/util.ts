// Shared parsing helpers. Pure functions only.

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "Rs. 1,234.50", "PKR 1234", "(1,200.00)", "-500", "+ 1,635.00" → paisa (integer). null if not a number. */
export function parseAmount(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/(PKR|Rs\.?|₨)/gi, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "");
  if (/(CR)$/i.test(s)) s = s.replace(/CR$/i, "");
  if (/(DR)$/i.test(s)) {
    negative = !negative;
    s = s.replace(/DR$/i, "");
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const paisa = Math.round(Number.parseFloat(s) * 100);
  return negative ? -paisa : paisa;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Date shapes tried in order; the trailing group is the rest of the string (time). */
const DATE_FORMATS: [RegExp, ("y" | "m" | "d")[]][] = [
  [/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/, ["y", "m", "d"]],
  [/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/, ["d", "m", "y"]],
  [/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ,]*(\d{2,4})(.*)$/, ["d", "m", "y"]],
  [/^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})(.*)$/, ["m", "d", "y"]],
];

const monthNum = (name: string | undefined) => (name ? MONTHS[name.slice(0, 3).toLowerCase()] : undefined);

/**
 * Parses common Pakistani bank/wallet date formats into `YYYY-MM-DDTHH:mm`.
 * Ambiguous numeric dates are read as day-first (DD/MM/YYYY), the local convention.
 */
export function parseDate(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/\s+/g, " ");
  if (!s) return null;

  let y: number | undefined;
  let m: number | undefined;
  let d: number | undefined;
  let rest = "";
  for (const [re, order] of DATE_FORMATS) {
    const match = s.match(re);
    if (!match) continue;
    const parts: Record<string, string | undefined> = {};
    order.forEach((k, i) => {
      parts[k] = match[i + 1];
    });
    y = Number(parts.y);
    d = Number(parts.d);
    m = /^\d+$/.test(parts.m ?? "") ? Number(parts.m) : monthNum(parts.m);
    rest = match[order.length + 1] ?? "";
    break;
  }
  if (!y || !m || !d || m > 12 || d > 31) return null;
  if (y < 100) y += 2000;

  let hh = 0;
  let mm = 0;
  const t = rest.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (t) {
    hh = Number(t[1]);
    mm = Number(t[2]);
    const ap = t[3]?.toLowerCase();
    if (ap === "pm" && hh < 12) hh += 12;
    if (ap === "am" && hh === 12) hh = 0;
  }
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
}

/** Hex SHA-256 of bytes or a UTF-8 string (WebCrypto: works in browsers, Workers and Node). */
export async function sha256Hex(input: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
