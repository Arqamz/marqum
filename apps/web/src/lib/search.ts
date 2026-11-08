export interface ActivitySearch {
  month?: string;
  wallet?: "sadapay" | "nayapay";
  category?: string;
  filter?: "untagged" | "unverified" | "noreason";
  cp?: string;
  q?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export function validateActivitySearch(raw: Record<string, unknown>): ActivitySearch {
  const out: ActivitySearch = {};
  const month = str(raw.month);
  if (month && /^\d{4}-\d{2}$/.test(month)) out.month = month;
  const wallet = str(raw.wallet);
  if (wallet === "sadapay" || wallet === "nayapay") out.wallet = wallet;
  const category = str(raw.category);
  if (category) out.category = category;
  const filter = str(raw.filter);
  if (filter === "untagged" || filter === "unverified" || filter === "noreason") out.filter = filter;
  const cp = str(raw.cp);
  if (cp) out.cp = cp;
  const q = str(raw.q);
  if (q) out.q = q;
  return out;
}
