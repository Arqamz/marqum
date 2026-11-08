import { describe, expect, it } from "vitest";
import { detectStatementFile } from "../src/detect.ts";

describe("detectStatementFile", () => {
  it.each([
    ["m-11-2026.pdf", { bank: "nayapay", kind: "pdf" }],
    ["m-11-2026.csv", { bank: "nayapay", kind: "csv" }],
    ["m-1-2027.CSV", { bank: "nayapay", kind: "csv" }],
    ["Download/m-03-2026 (1).pdf", { bank: "nayapay", kind: "pdf" }],
    ["sadapay_account_statement_01-11-2026_07-11-2026.pdf", { bank: "sadapay", kind: "pdf" }],
    [
      "/storage/emulated/0/Download/sadapay_account_statement_01-10-2026_31-10-2026.pdf",
      { bank: "sadapay", kind: "pdf" },
    ],
    ["sadapay_account_statement_01-11-2026_07-11-2026.csv", null],
    ["m-13-2026.pdf", null],
    ["statement.pdf", null],
    ["photo.jpg", null],
  ])("%s", (name, expected) => expect(detectStatementFile(name)).toEqual(expected));
});
