// Parses the user's real statements (gitignored, local only) if present. Asserts only that every
// statement check passes — no contents are snapshotted or printed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { detectStatementFile } from "../src/detect.ts";
import { pdfToLines } from "../src/pdf-lines.ts";
import { readCsvStatement, readPdfStatement } from "../src/statements.ts";

const DIR = resolve(import.meta.dirname, "../../../statements");
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.(pdf|csv)$/i.test(f)) : [];

describe.skipIf(files.length === 0)("real statements", () => {
  it.each(files)("%s: all checks pass", async (f) => {
    const data = readFileSync(join(DIR, f));
    const st = /\.csv$/i.test(f)
      ? await readCsvStatement(data.toString("utf8"))
      : await readPdfStatement(await pdfToLines(pdjs(), new Uint8Array(data)));
    const failed = st.checks.filter((c) => !c.ok).map((c) => c.label);
    expect(failed).toEqual([]);
    expect(st.rows.length).toBeGreaterThan(0);
    const detected = detectStatementFile(f);
    if (detected) expect(detected.bank).toBe(st.bank);
    // stable ids across re-reads
    const again = /\.csv$/i.test(f)
      ? await readCsvStatement(data.toString("utf8"))
      : await readPdfStatement(await pdfToLines(pdjs(), new Uint8Array(data)));
    expect(again.rows.map((r) => r.external_id)).toEqual(st.rows.map((r) => r.external_id));
  });
});

function pdjs() {
  return pdfjs as unknown as Parameters<typeof pdfToLines>[0];
}
