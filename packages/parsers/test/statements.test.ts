import { describe, expect, it } from "vitest";
import type { Line } from "../src/pdf-lines.ts";
import { extractReason, readCsvStatement, readPdfStatement, StatementError } from "../src/statements.ts";
import { parseAmount, parseDate, sha256Hex } from "../src/util.ts";

describe("parseAmount", () => {
  it.each([
    ["Rs. 1,234.50", 123450],
    ["+Rs. 12,300", 1230000],
    ["-Rs. 1,250", -125000],
    ["+ 1,450.00", 145000],
    ["- 610.00", -61000],
    ["(1,200.00)", -120000],
    ["PKR 500", 50000],
    ["", null],
    ["abc", null],
  ])("%s → %s", (input, expected) => expect(parseAmount(input)).toBe(expected));
});

describe("parseDate", () => {
  it.each([
    ["07 Nov 2026 07:40 PM", "2026-11-07T19:40"],
    ["3 Nov, 2026 03:15 PM", "2026-11-03T15:15"],
    ["1 November 2026", "2026-11-01T00:00"],
    ["07 Nov 2026 12:10 AM", "2026-11-07T00:10"],
    ["2026-11-05 13:45", "2026-11-05T13:45"],
    ["05/11/2026", "2026-11-05T00:00"],
    ["Closing balance", null],
  ])("%s → %s", (input, expected) => expect(parseDate(input)).toBe(expected));
});

it("sha256Hex", async () => {
  expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(await sha256Hex("abc"));
});

describe("extractReason", () => {
  it("pulls labelled purposes out of the description", () => {
    expect(extractReason(["Outgoing fund transfer to Test Person", "Purpose: Rent share"])).toEqual({
      text: ["Outgoing fund transfer to Test Person"],
      reason: "Rent share",
    });
    expect(extractReason(["Transfer to Test | Message: for dinner"]).reason).toBe("for dinner");
    expect(extractReason(["Imtiaz Super Market"])).toEqual({ text: ["Imtiaz Super Market"], reason: null });
    expect(extractReason(['"petrol money"'], true).reason).toBe("petrol money");
    expect(extractReason(['"petrol money"'], false).reason).toBeNull();
  });
});

// Synthetic statements (made-up data, same layout as the real exports)

const NAYAPAY_CSV = `Customer Name,Test User
NayaPay ID,testuser

Account Statement for:,from 01 Nov 2026 to 07 Nov 2026

Opening Balance,100.00,Closing Balance,"29,750.00",,Total Spent,"3,350",Total Income,"33,000"

TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE
07 Nov 2026 10:00 PM,Raast Out,"Outgoing fund transfer to Test Friend
Bank-0000|Purpose: Dinner split|Transaction ID 900003","-1,000","29,750.00"
07 Nov 2026 09:15 PM,Card Payment,"FOODPANDA KARACHI
|Transaction ID 900002","-2,350","30,750.00"
05 Nov 2026 07:40 PM,IBFT In,"Incoming fund transfer from Test User
Meezan-0000|Transaction ID 900001","+33,000","33,100.00"
`;

describe("NayaPay CSV", () => {
  it("reads period, balances, rows and checks", async () => {
    const st = await readCsvStatement(NAYAPAY_CSV);
    expect(st.bank).toBe("nayapay");
    expect(st.from).toBe("2026-11-01");
    expect(st.to).toBe("2026-11-07");
    expect(st.opening).toBe(10000);
    expect(st.closing).toBe(2975000);
    expect(st.totalIn).toBe(3300000);
    expect(st.totalOut).toBe(335000);
    expect(st.rows.map((r) => r.external_id)).toEqual(["naya:900001", "naya:900002", "naya:900003"]); // sorted by date
    expect(st.rows[0]).toMatchObject({
      type: "IBFT In",
      description: "Incoming fund transfer from Test User Meezan-0000",
      reason: null,
      fee: 0,
    });
    expect(st.rows[1]).toMatchObject({
      amount: -235000,
      description: "FOODPANDA KARACHI",
      balance_after: 3075000,
    });
    expect(st.rows[2]).toMatchObject({
      description: "Outgoing fund transfer to Test Friend Bank-0000",
      reason: "Dinner split",
    });
    expect(st.checks.every((c) => c.ok)).toBe(true);
  });

  it("flags a broken balance chain and a total mismatch", async () => {
    const bad = NAYAPAY_CSV.replace('"30,750.00"', '"30,700.00"').replace(
      'Closing Balance,"29,750.00"',
      'Closing Balance,"29,000.00"',
    );
    const st = await readCsvStatement(bad);
    expect(st.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual([
      expect.stringContaining("Doesn't add up"),
      expect.stringContaining("Running balance"),
    ]);
  });

  it("rejects CSVs it doesn't know", async () => {
    await expect(readCsvStatement("a,b\n1,2")).rejects.toBeInstanceOf(StatementError);
  });
});

const L = (page: number, y: number, ...cells: [number, string][]): Line => ({
  page,
  y,
  cells: cells.map(([x, text]) => ({ x, text })),
  text: cells.map((c) => c[1]).join("  "),
});

describe("NayaPay PDF", () => {
  it("gives the same rows (and ids) as the CSV", async () => {
    const lines = [
      L(1, 791, [426, "Account Statement"]),
      L(1, 780, [459, "01 Nov 2026 - 07 Nov 2026"]),
      L(1, 576, [195, "Opening Balance"], [323, "Total Spent"], [450, "Closing Balance"]),
      L(1, 557, [195, "Rs. 100"], [323, "Rs. 3,350"], [450, "Rs. 29,750"]),
      L(1, 515, [40, "TIME"], [113, "TYPE"], [192, "DESCRIPTION"], [433, "AMOUNT"], [505, "BALANCE"]),
      L(
        1,
        498,
        [26, "07 Nov 2026"],
        [110, "Raast Out"],
        [192, "Outgoing fund transfer to Test Friend"],
        [433, "-Rs. 1,000"],
        [505, "Rs. 29,750"],
      ),
      L(1, 492, [26, "10:00 PM"], [192, "Bank-0000"]),
      L(1, 488, [192, "Purpose: Dinner split"]),
      L(1, 486, [192, "Transaction ID 900003"]),
      L(
        1,
        484,
        [26, "07 Nov 2026"],
        [110, "Card Payment"],
        [192, "FOODPANDA KARACHI"],
        [433, "-Rs. 2,350"],
        [505, "Rs. 30,750"],
      ),
      L(1, 471, [26, "09:15 PM"], [192, "Transaction ID 900002"]),
      L(1, 458, [192, "Service Charges Rs. 0"]),
      L(
        1,
        430,
        [26, "05 Nov 2026"],
        [110, "IBFT In"],
        [192, "Incoming fund transfer from Test User"],
        [433, "+Rs. 33,000"],
        [505, "Rs. 33,100"],
      ),
      L(1, 417, [26, "07:40 PM"], [192, "Meezan-0000"]),
      L(1, 404, [192, "Transaction ID 900001"]),
      L(1, 68, [
        56,
        "DISCLAIMER: This is an auto-generated statement and doesn't require a signature. nayapay",
      ]),
    ];
    const st = await readPdfStatement(lines);
    const csv = await readCsvStatement(NAYAPAY_CSV);
    expect(st.bank).toBe("nayapay");
    expect(st.rows).toEqual(csv.rows);
    expect(st.opening).toBe(10000);
    expect(st.closing).toBe(2975000);
    expect(st.checks.every((c) => c.ok)).toBe(true);
  });
});

const SADAPAY_LINES = [
  L(1, 720, [20, "Account Statement"]),
  L(1, 650, [20, "IBAN: PK00 SADA 0000 0000 00000000"]),
  L(1, 596, [40, "Total debit"], [170, "Total credit"]),
  L(1, 573, [40, "1150.00"], [170, "1450.00"]),
  L(1, 506, [20, "Account transactions from 1 November 2026 - 7 November 2026"]),
  L(1, 464, [81, "Date"], [210, "Description"], [500, "Debit/Credit"]),
  L(1, 423, [46, "3 Nov, 2026"], [210, "From TEST (Meezan Bank (MBL))"]),
  L(1, 417, [496, "+ 1,450.00"]),
  L(1, 411, [58, "03:15 PM"], [210, "(Incoming transfer)"]),
  L(1, 34, [20, "Note: This is a system generated statement and does not require a signature."]),
  L(2, 464, [81, "Date"], [210, "Description"], [500, "Debit/Credit"]),
  L(2, 423, [46, "5 Nov, 2026"], [210, "Imtiaz Super Market"]),
  L(2, 417, [506, "- 650.00"]),
  L(2, 411, [58, "07:10 PM"], [210, "(Card payment)"]),
  L(2, 368, [46, "5 Nov, 2026"], [210, "Imtiaz Super Market"]),
  L(2, 362, [506, "- 500.00"]),
  L(2, 356, [60, "07:12 PM"], [210, "(Card payment)"]),
];

describe("SadaPay PDF", () => {
  it("reads multi-page tables, debits and totals", async () => {
    const st = await readPdfStatement(SADAPAY_LINES);
    expect(st.bank).toBe("sadapay");
    expect(st.from).toBe("2026-11-01");
    expect(st.to).toBe("2026-11-07");
    expect(st.opening).toBeNull();
    expect(st.rows.map((r) => r.amount)).toEqual([145000, -65000, -50000]);
    expect(st.rows[1]?.type).toBe("Card payment");
    expect(st.rows[0]?.description).toBe("From TEST (Meezan Bank (MBL))");
    expect(st.rows.every((r) => /^sada:h[0-9a-f]{20}$/.test(r.external_id))).toBe(true);
    expect(new Set(st.rows.map((r) => r.external_id)).size).toBe(3);
    expect(st.checks.every((c) => c.ok)).toBe(true);
  });

  it("keeps external ids identical to the original algorithm and across re-reads", async () => {
    const st = await readPdfStatement(SADAPAY_LINES);
    const expected = `sada:h${(await sha256Hex("2026-11-03T15:15|145000|from test (meezan bank (mbl))|1")).slice(0, 20)}`;
    expect(st.rows[0]?.external_id).toBe(expected);
    expect((await readPdfStatement(SADAPAY_LINES)).rows.map((r) => r.external_id)).toEqual(
      st.rows.map((r) => r.external_id),
    );
  });

  it("separates identical rows with an occurrence counter", async () => {
    const dup = [
      ...SADAPAY_LINES.slice(0, 10),
      L(1, 300, [46, "3 Nov, 2026"], [210, "From TEST (Meezan Bank (MBL))"]),
      L(1, 294, [496, "+ 1,450.00"]),
      L(1, 288, [58, "03:15 PM"], [210, "(Incoming transfer)"]),
    ];
    // move the stop line below the duplicate
    const stop = dup.splice(9, 1);
    const st = await readPdfStatement([...dup, ...stop]);
    const ids = st.rows.filter((r) => r.amount === 145000).map((r) => r.external_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("extracts a message line as the reason without changing the id", async () => {
    const withNote = [
      ...SADAPAY_LINES.slice(0, 7),
      L(1, 414, [210, "Purpose: Monthly funding"]),
      ...SADAPAY_LINES.slice(7),
    ];
    const plain = await readPdfStatement(SADAPAY_LINES);
    const st = await readPdfStatement(withNote);
    expect(st.rows[0]?.reason).toBe("Monthly funding");
    expect(st.rows[0]?.description).toBe("From TEST (Meezan Bank (MBL))");
    expect(st.rows[0]?.type).toBe("Incoming transfer");
    expect(plain.rows[0]?.reason).toBeNull();
  });
});

it("rejects unknown PDFs", async () => {
  await expect(readPdfStatement([L(1, 700, [20, "Some other bank"])])).rejects.toBeInstanceOf(StatementError);
});
