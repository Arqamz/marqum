// Table-driven so real notification samples can be added as they arrive (anonymise names/numbers first).
import { describe, expect, it } from "vitest";
import { cleanMerchant, isNonTransaction, parseNotification } from "../src/notifications.ts";

const NAYA = "com.nayapay.app";
const SADA = "com.sadapay.app";
const AT = "2026-11-07T19:40";

type Expect = {
  account_id?: string;
  amount: number;
  counterparty_name?: string | null;
  reason?: string | null;
  balance_after?: number | null;
};
const CASES: [pkg: string, title: string, text: string, expected: Expect | null][] = [
  // ---- real formats (wording kept, merchants/amounts/digits replaced with synthetic ones)
  [
    SADA,
    "Message from SadaPay",
    "You spent PKR 1,234.00 at NetflixX12AB34CD56     Amsterdam     NLD. Your available balance is PKR 20500.50.",
    { account_id: "sadapay", amount: -123400, counterparty_name: "Netflix", balance_after: 2050050 },
  ],
  [
    NAYA,
    "Card Authorization",
    "You have authorized TEST *SERVICE TEMP cc@example.comUS on Visa Physical-0000.",
    null,
  ],
  [
    NAYA,
    "Verify online payment 🔐",
    "Tap to confirm Rs. 1,500 payment to G-9 (TEST BAKERY - ISD-RWP).",
    null,
  ],
  [
    NAYA,
    "Card in action 💳",
    "You spent Rs. 1,500 online at G-9 (Test Bakery - Isd-rwp) Karachi Pk. Zero hesitation, we love it.",
    { account_id: "nayapay", amount: -150000, counterparty_name: "Test Bakery", balance_after: null },
  ],
  // ---- plausible variants
  // money in
  [NAYA, "Approve payment", "Please approve this payment of Rs 900 to Test Shop", null],
  [
    NAYA,
    "Money Received",
    "You have received Rs. 12,300 from Test User. Your new balance is Rs. 12,042.50",
    { account_id: "nayapay", amount: 1230000, counterparty_name: "Test User", balance_after: 1204250 },
  ],
  [
    SADA,
    "Test Friend sent you Rs 500",
    "Tap to view details",
    { account_id: "sadapay", amount: 50000, counterparty_name: "Test Friend" },
  ],
  [
    SADA,
    "Incoming transfer",
    "Rs. 1,450.00 received from TEST via Meezan Bank",
    { amount: 145000, counterparty_name: "TEST" },
  ],
  [
    NAYA,
    "Funds credited",
    "PKR 2,000.50 has been credited to your wallet from Ali Khan.",
    { amount: 200050, counterparty_name: "Ali Khan" },
  ],
  [
    NAYA,
    "Cashback",
    "Rs 25 cashback has been added to your account",
    { amount: 2500, counterparty_name: null },
  ],
  [
    SADA,
    "Refund",
    "Your refund of Rs. 1,200 from Daraz has been processed",
    { amount: 120000, counterparty_name: "Daraz" },
  ],
  [
    NAYA,
    "Money received",
    "Test User sent you Rs. 750. Message: dinner share",
    { amount: 75000, reason: "dinner share" },
  ],
  // money out
  [
    NAYA,
    "Payment Successful",
    "You paid Rs. 2,350 at FOODPANDA KARACHI using your NayaPay card",
    { amount: -235000, counterparty_name: "FOODPANDA KARACHI" },
  ],
  [
    NAYA,
    "Transfer Successful",
    "Rs. 1,000 sent to Test Friend. Purpose: Rent share",
    { amount: -100000, counterparty_name: "Test Friend", reason: "Rent share" },
  ],
  [
    SADA,
    "Card payment",
    "You spent Rs 650.00 at Imtiaz Super Market",
    { account_id: "sadapay", amount: -65000, counterparty_name: "Imtiaz Super Market" },
  ],
  [
    SADA,
    "Money sent",
    "You sent PKR 5,000 to Guard Sahib (HBL)",
    { amount: -500000, counterparty_name: "Guard Sahib" },
  ],
  [
    NAYA,
    "Debit alert",
    "Your account has been debited with Rs 1,500 for K-Electric bill payment",
    { amount: -150000 },
  ],
  [
    NAYA,
    "Transaction alert",
    "Rs.300 transferred to Ahmed on 07 Nov. Available balance Rs. 1,000",
    { amount: -30000, counterparty_name: "Ahmed" },
  ],
  [
    SADA,
    "Purchase",
    "Online purchase of PKR 3,999 at Apple.com/bill was successful",
    { amount: -399900, counterparty_name: "Apple.com/bill" },
  ],
  [
    NAYA,
    "Bill paid",
    "Bill payment of Rs. 2,100 to Jazz successful. Fee Rs. 0",
    { amount: -210000, counterparty_name: "Jazz" },
  ],
  // ignored: OTP, login, promotions, requests, failures, other apps, no amount
  [NAYA, "OTP", "Your OTP for transferring Rs. 1,000 is 000000. Do not share it.", null],
  [SADA, "New login", "You logged in on a new device", null],
  [NAYA, "Limited time offer!", "Get up to Rs. 500 cashback on your next 3 payments. Hurry!", null],
  [SADA, "Weekend deal", "Flat 20% off at Test Cafe — pay with your SadaPay card", null],
  [NAYA, "Payment request", "Test User has requested Rs. 400 from you", null],
  [SADA, "Payment failed", "Your payment of Rs 650 at Test Store was declined", null],
  [NAYA, "Hello", "Your statement for October is ready", null],
  ["com.whatsapp", "Test", "You received Rs 500 from Test", null],
];

describe("parseNotification", () => {
  it.each(CASES)("%s | %s | %s", (pkg, title, text, expected) => {
    const got = parseNotification(pkg, title, text, AT);
    if (expected === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).not.toBeNull();
    expect(got).toMatchObject({ occurred_at: AT, ...expected });
    expect(got?.description.length).toBeGreaterThan(0);
  });
});

describe("cleanMerchant", () => {
  it.each([
    ["NetflixX12AB34CD56     Amsterdam     NLD", "Netflix"],
    ["G-9 (Test Bakery - Isd-rwp) Karachi Pk", "Test Bakery"],
    ["Test Store Lahore PK", "Test Store"],
    ["FOODPANDA KARACHI", "FOODPANDA KARACHI"],
    ["Apple.com/bill", "Apple.com/bill"],
    ["Imtiaz Super Market", "Imtiaz Super Market"],
  ])("%s → %s", (raw, expected) => expect(cleanMerchant(raw)).toBe(expected));
});

it("isNonTransaction flags prompts but not spends", () => {
  expect(
    isNonTransaction(
      "Verify online payment",
      "Tap to confirm Rs. 1,500 payment to G-9 (TEST BAKERY - ISD-RWP).",
    ),
  ).toBe(true);
  expect(
    isNonTransaction(
      "Card in action",
      "You spent Rs. 1,500 online at G-9 (Test Bakery - Isd-rwp) Karachi Pk.",
    ),
  ).toBe(false);
});
