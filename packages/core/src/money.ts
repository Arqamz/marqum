/** Money helpers. All amounts are integer paisa (Rs 1 = 100 paisa); negative = money left the wallet. */

const MINUS = "−";

const group = (n: string): string => n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * "Rs 1,234", "−Rs 500", "+Rs 33,300" (with `sign`), "Rs 1,234.50" (with `decimals`).
 * Without `decimals`, rounds half away from zero to whole rupees.
 */
export function formatRs(paisa: number, opts: { sign?: boolean; decimals?: boolean } = {}): string {
  const abs = Math.abs(paisa);
  let body: string;
  if (opts.decimals) {
    const rupees = Math.floor(abs / 100);
    const cents = String(abs % 100).padStart(2, "0");
    body = `${group(String(rupees))}.${cents}`;
  } else {
    body = group(String(Math.round(abs / 100)));
  }
  const isZero = body === "0" || body === "0.00";
  if (paisa < 0 && !isZero) return `${MINUS}Rs ${body}`;
  if (opts.sign && paisa > 0 && !isZero) return `+Rs ${body}`;
  return `Rs ${body}`;
}

/** formatRs with an explicit sign: "+Rs 500" / "−Rs 500". */
export const formatRsSigned = (paisa: number): string => formatRs(paisa, { sign: true });

/** Rupees (may have decimals) → integer paisa. */
export const toPaisa = (rupees: number): number => Math.round(rupees * 100);

/**
 * Parse user/bank text such as "Rs 1,234.50", "PKR -500", "−Rs 500", "(500)", "+33,300" into paisa.
 * Returns null when the text does not contain exactly one number.
 */
export function parseRs(text: string): number | null {
  let t = text.trim().replace(/[−–—]/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/^(?:rs\.?|pkr)\s*/i, "").replace(/\s*(?:rs\.?|pkr)$/i, "");
  const m = /^([+-])?\s*(?:rs\.?\s*|pkr\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/i.exec(t);
  if (!m) return null;
  if (m[1] === "-") negative = !negative;
  const whole = Number((m[2] ?? "0").replace(/,/g, ""));
  const frac = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
  const value = whole * 100 + frac;
  return negative ? -value : value;
}
