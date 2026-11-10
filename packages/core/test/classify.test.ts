import { describe, expect, it } from "vitest";
import {
  classify,
  counterpartyKey,
  describeRule,
  extractCounterparty,
  isHolder,
  merchantName,
  rememberRule,
} from "../src/classify.ts";
import { matchProvisional } from "../src/reconcile.ts";
import { cp, prov, seeded, withRows } from "./builders.ts";

describe("counterpartyKey", () => {
  it.each([
    ["Outgoing fund transfer to Danish Ahmed\nMeezan-0000|Transaction ID 000000", "DANISH AHMED"],
    ["Outgoing fund transfer to Danish Ahmed Meezan-0000|Transaction ID 000000", "DANISH AHMED"],
    ["Incoming fund transfer from Ali Khan", "ALI KHAN"],
    ["To DANISH (SadaPay)", "DANISH"],
    ["From TEST USER (Meezan Bank (MBL))", "TEST USER"],
    ["POS Purchase FOODPANDA*123 KARACHI", "FOODPANDA"],
    ["Card payment 0000 KFC GULBERG", "KFC GULBERG"],
    ["Bill payment K-Electric 0000000", "K ELECTRIC"],
  ])("%s → %s", (d, key) => {
    expect(counterpartyKey(d)).toBe(key);
  });
  it("returns null for fees and empty text", () => {
    expect(counterpartyKey("Service charges")).toBeNull();
    expect(counterpartyKey("")).toBeNull();
  });
  it("tells people from merchants", () => {
    expect(extractCounterparty("To DANISH (SadaPay)")?.person).toBe(true);
    expect(extractCounterparty("POS Purchase FOODPANDA*123 KARACHI")?.person).toBe(false);
    expect(extractCounterparty("Outgoing fund transfer to Danish Ahmed")?.name).toBe("Danish Ahmed");
  });
});

describe("classify", () => {
  const ds = seeded();
  const out = (
    description: string,
    amount: number,
    account_id: "sadapay" | "nayapay" = "nayapay",
    reason: string | null = null,
  ) => classify(ds, { account_id, amount, description, reason, bank_type: null });

  it("applies seed rules by priority (foodpanda pro before foodpanda)", () => {
    expect(out("POS Purchase SHELL 001 KARACHI", -300000)).toMatchObject({
      category_id: "car.petrol",
      flow: "spend",
    });
    expect(out("Card payment PANDAPRO", -50000).category_id).toBe("subscriptions.foodpanda");
    expect(out("POS Purchase FOODPANDA*123", -50000).category_id).toBe("food");
  });
  it("matches the reason too, case-insensitively", () => {
    expect(out("Outgoing fund transfer to Ali", -20000, "nayapay", "PETROL for car").category_id).toBe(
      "car.petrol",
    );
  });
  it("Meezan inflow from you is funding; from someone else at Meezan it's income", () => {
    const me = withRows(ds, { counterparties: [cp("Test User", { kind: "self", aliases: ["TEST USER"] })] });
    const run = (d: typeof ds, description: string, amount: number) =>
      classify(d, { account_id: "sadapay", amount, description, reason: null, bank_type: null });
    expect(run(me, "From TEST USER (Meezan Bank (MBL))", 4000000)).toMatchObject({
      flow: "funding",
      category_id: null,
    });
    expect(run(me, "From OTHER PERSON (Meezan Bank (MBL))", 300000).flow).toBe("income");
    // an unknown named sender isn't assumed to be you
    expect(run(ds, "From OTHER PERSON (Meezan Bank (MBL))", 300000).flow).toBe("income");
    expect(out("Outgoing fund transfer to Ali Meezan-0000", -20000).flow).toBe("spend");
  });
  it("Food Panda card spends are Food by default; Spotify is a subscription", () => {
    expect(out("Food Panda 18th Floor, Office # 1-4, Karachi Si Pak", -278799, "sadapay")).toMatchObject({
      flow: "spend",
      category_id: "food",
      counterparty_name: "Food Panda",
    });
    expect(
      out("Spotify*p48f8f2310 Regeringsgatan 19 Spotify.com 111 53 Ab Swe", -79397, "sadapay"),
    ).toMatchObject({
      category_id: "subscriptions",
      counterparty_name: "Spotify",
    });
    expect(out("Food Panda Pro subscription", -50000, "sadapay").category_id).toBe("subscriptions.foodpanda");
  });
  it("own-account / top-up inflows are funding", () => {
    expect(out("Own account transfer", 100000).flow).toBe("funding");
    expect(out("Wallet top-up", 100000)).toMatchObject({ flow: "funding", category_id: null });
  });
  it("transfers naming the other wallet are internal", () => {
    expect(out("To TEST USER (NayaPay)", -1000000, "sadapay").flow).toBe("internal");
    expect(out("Incoming fund transfer from Test User SadaPay", 1000000, "nayapay").flow).toBe("internal");
  });
  it("a known non-self counterparty on the other wallet is not internal", () => {
    const d2 = withRows(ds, { counterparties: [cp("Danish", { aliases: ["DANISH"] })] });
    expect(
      classify(d2, {
        account_id: "sadapay",
        amount: -50000,
        description: "To DANISH (NayaPay)",
        reason: null,
        bank_type: null,
      }).flow,
    ).toBe("spend");
  });
  it("other inflows are income, outflows spend, service charges fee", () => {
    expect(out("Incoming fund transfer from Ali Khan", 50000).flow).toBe("income");
    expect(out("Outgoing fund transfer to Ali Khan", -50000)).toMatchObject({
      flow: "spend",
      category_id: null,
    });
    expect(out("Service charges", -1000)).toMatchObject({ flow: "fee", category_id: "fees" });
  });
  it("counterparty defaults apply after rules", () => {
    const guard = cp("Guard Sahib", { aliases: ["GUARD SAHIB"], default_category_id: "bills.guard" });
    const d2 = withRows(ds, { counterparties: [guard] });
    const r = classify(d2, {
      account_id: "sadapay",
      amount: -500000,
      description: "To GUARD SAHIB (Meezan Bank)",
      reason: null,
      bank_type: null,
    });
    expect(r).toMatchObject({
      category_id: "bills.guard",
      counterparty_id: guard.id,
      counterparty_key: "GUARD SAHIB",
    });
  });
  it("higher-priority user rules win; invalid regexes are ignored", () => {
    const d2 = withRows(ds, {
      rules: [
        {
          id: "u1",
          pattern: "shell",
          category_id: "misc",
          flow: null,
          counterparty_id: null,
          priority: 1000,
          version: 1,
          deleted: false,
        },
        {
          id: "u2",
          pattern: "([",
          category_id: "gifts",
          flow: null,
          counterparty_id: null,
          priority: 2000,
          version: 1,
          deleted: false,
        },
      ],
    });
    expect(
      classify(d2, {
        account_id: "nayapay",
        amount: -1,
        description: "POS SHELL",
        reason: null,
        bank_type: null,
      }).category_id,
    ).toBe("misc");
  });
});

describe("matchProvisional", () => {
  const row = (external_id: string, occurred_at: string, amount: number, description?: string) => ({
    external_id,
    account_id: "nayapay" as const,
    occurred_at,
    amount,
    ...(description ? { description } : {}),
  });
  it("matches same wallet + amount within ±36h, closest first, one-to-one", () => {
    const a = prov({ id: "pa", occurred_at: "2026-11-06T10:00", amount: -20000 });
    const b = prov({ id: "pb", occurred_at: "2026-11-06T20:00", amount: -20000 });
    const pairs = matchProvisional(
      [row("x1", "2026-11-06T19:00", -20000), row("x2", "2026-11-06T09:00", -20000)],
      [a, b],
    );
    expect(pairs).toEqual(
      expect.arrayContaining([
        { external_id: "x1", txn_id: "pb" },
        { external_id: "x2", txn_id: "pa" },
      ]),
    );
    expect(pairs).toHaveLength(2);
  });
  it("rejects other wallet, other amount, outside the window and verified rows", () => {
    const rows = [row("x1", "2026-11-06T10:00", -20000)];
    expect(
      matchProvisional(rows, [
        prov({ account_id: "sadapay", occurred_at: "2026-11-06T10:00", amount: -20000 }),
      ]),
    ).toEqual([]);
    expect(matchProvisional(rows, [prov({ occurred_at: "2026-11-06T10:00", amount: -20001 })])).toEqual([]);
    expect(matchProvisional(rows, [prov({ occurred_at: "2026-11-07T22:01", amount: -20000 })])).toEqual([]);
    expect(matchProvisional(rows, [prov({ occurred_at: "2026-11-07T22:00", amount: -20000 })])).toHaveLength(
      1,
    );
    expect(
      matchProvisional(rows, [prov({ status: "verified", occurred_at: "2026-11-06T10:00", amount: -20000 })]),
    ).toEqual([]);
  });
  it("breaks time ties by description similarity", () => {
    const a = prov({ id: "pa", occurred_at: "2026-11-06T10:00", amount: -500, reason: "tea" });
    const b = prov({ id: "pb", occurred_at: "2026-11-06T10:00", amount: -500, reason: "danish lunch" });
    expect(
      matchProvisional([row("x1", "2026-11-06T11:00", -500, "Outgoing fund transfer to Danish")], [a, b]),
    ).toEqual([{ external_id: "x1", txn_id: "pb" }]);
  });
});

describe("merchant names", () => {
  it.each([
    ["Food Panda 18th Floor, Office # 1-4, Karachi Si Pak", "Food Panda"],
    ["Spotify*p48f8f2310 Regeringsgatan", "Spotify"],
    ["19 Spotify.com 111 53 Ab Swe", "Spotify"],
    ["F-11 (CRUMBLE - ISD-RWP) KARACHI PK Visa x0000", "CRUMBLE"],
    ["DWatson Pharmacy And GrocIslamabad PK Visa x0000", "DWatson Pharmacy And Groc Islamabad"],
    ["Imtiaz Super Market Stockholm SWE", "Imtiaz Super Market Stockholm"],
  ])("%s → %s", (raw, name) => {
    expect(merchantName(raw)).toBe(name);
  });
});

describe("counterparty names", () => {
  it("keeps the whole merchant name (city split from a glued word) while the key stays short", () => {
    expect(extractCounterparty("Paid to DWatson Pharmacy And GrocIslamabad PK Visa x0000")).toEqual({
      key: "DWATSON PHARMACY AND GROC",
      name: "DWatson Pharmacy And Groc Islamabad",
      person: false,
    });
  });
});

describe("rememberRule (Always tag … like this)", () => {
  const all = [
    "From ARQAM (Meezan Bank (MBL))",
    "Incoming fund transfer from Arqam Meezan-0000",
    "From ARQAM (NayaPay)",
    "To ARQAM (NayaPay)",
    "From NISAR FATIMA (Meezan Bank (MBL))",
  ];
  const hits = (d: string) => {
    const r = rememberRule(d);
    if (!r) throw new Error(`no rule for ${d}`);
    return all.filter((x) => new RegExp(r.pattern, "i").test(x));
  };
  it("keeps the bank/wallet and direction, so your Meezan and NayaPay transfers never share a rule", () => {
    expect(hits("From ARQAM (Meezan Bank (MBL))")).toEqual(all.slice(0, 2));
    expect(hits("From ARQAM (NayaPay)")).toEqual(["From ARQAM (NayaPay)"]);
    expect(hits("To ARQAM (NayaPay)")).toEqual(["To ARQAM (NayaPay)"]);
    expect(hits("From NISAR FATIMA (Meezan Bank (MBL))")).toEqual(["From NISAR FATIMA (Meezan Bank (MBL))"]);
  });
  it("labels the rule in words, and describeRule reads it back", () => {
    const r = rememberRule("From ARQAM (Meezan Bank (MBL))");
    expect(r?.label).toBe("From Arqam · Meezan");
    expect(describeRule(r?.pattern ?? "")).toBe("From Arqam · Meezan");
    expect(rememberRule("Food Panda 18th Floor, Office # 1-4")?.label).toBe("Food Panda");
  });
  it("isHolder matches part of the statement holder's name", () => {
    expect(isHolder("ARQAM", "Arqam Zia")).toBe(true);
    expect(isHolder("NISAR FATIMA", "Arqam Zia")).toBe(false);
    expect(isHolder("ARQAM", null)).toBe(false);
  });
});
