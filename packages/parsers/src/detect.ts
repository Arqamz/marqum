import type { AccountId } from "@marqum/schema";

export interface DetectedFile {
  bank: AccountId;
  kind: "pdf" | "csv";
}

/**
 * Recognises statement files by their default names, for the Android statement inbox:
 * NayaPay `m-MM-YYYY.pdf|csv`, SadaPay `sadapay_account_statement_DD-MM-YYYY_DD-MM-YYYY.pdf`.
 * Only used to pick files up; parsing itself never depends on the name.
 */
export function detectStatementFile(name: string): DetectedFile | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const naya = base.match(/^m-(0?[1-9]|1[0-2])-\d{4}(?: ?\(\d+\))?\.(pdf|csv)$/i);
  if (naya?.[2]) return { bank: "nayapay", kind: naya[2].toLowerCase() as "pdf" | "csv" };
  if (/^sadapay_account_statement_\d{2}-\d{2}-\d{4}_\d{2}-\d{2}-\d{4}(?: ?\(\d+\))?\.pdf$/i.test(base))
    return { bank: "sadapay", kind: "pdf" };
  return null;
}
