/**
 * A synthetic year of two wallets, built by running real commands through the mock server.
 * Invented names and amounts only — nothing here comes from a real statement.
 */
import { addMonths, daysInMonth, type Mutation } from "@marqum/core";
import type { Command, ParsedStatement, ParsedStatementRow } from "@marqum/schema";
import { MockServer } from "./mock-server.ts";

export const WORLD_NOW = "2026-11-08T12:00";
const pad = (n: number) => String(n).padStart(2, "0");

interface Draft {
  day: number;
  hour: number;
  description: string;
  type: string;
  amount: number; // rupees, signed
  reason?: string;
}

/** Deterministic pseudo-random in [0,1). */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function statement(
  bank: "sadapay" | "nayapay",
  month: string,
  lastDay: number,
  opening: number,
  drafts: Draft[],
  counter: { n: number },
): { statement: ParsedStatement; closing: number } {
  const sorted = [...drafts].filter((d) => d.day <= lastDay).sort((a, b) => a.day - b.day || a.hour - b.hour);
  let bal = opening * 100;
  let totalIn = 0;
  let totalOut = 0;
  const rows: ParsedStatementRow[] = sorted.map((d) => {
    const amount = Math.round(d.amount * 100);
    bal += amount;
    if (amount > 0) totalIn += amount;
    else totalOut += -amount;
    counter.n++;
    return {
      occurred_at: `${month}-${pad(d.day)}T${pad(d.hour)}:${pad((counter.n * 7) % 60)}`,
      type: d.type,
      description: d.description,
      reason: d.reason ?? null,
      amount,
      fee: 0,
      balance_after: bal,
      external_id:
        bank === "nayapay" ? `naya:${900000 + counter.n}` : `sada:h${(1000000 + counter.n).toString(16)}`,
    };
  });
  return {
    statement: {
      bank,
      from: `${month}-01`,
      to: `${month}-${pad(lastDay)}`,
      opening: opening * 100,
      closing: bal,
      totalIn,
      totalOut,
      rows,
      checks: [
        { ok: true, label: "Totals add up" },
        { ok: true, label: "Running balance is continuous" },
      ],
    },
    closing: bal / 100,
  };
}

function nayaMonth(month: string, r: () => number, i: number): Draft[] {
  const big = month === "2026-07"; // one unusual month for food
  const d: Draft[] = [
    {
      day: 1,
      hour: 10,
      type: "IBFT In",
      description: "Incoming fund transfer from Own Account Meezan-0000",
      amount: 35000,
    },
  ];
  const foods = big ? 9 : 4 + Math.floor(r() * 3);
  for (let k = 0; k < foods; k++)
    d.push({
      day: 2 + Math.floor(r() * 26),
      hour: 13 + Math.floor(r() * 9),
      type: "Card Payment",
      description: k % 2 ? "FOODPANDA KARACHI" : "KFC CLIFTON KARACHI",
      amount: -Math.round(900 + r() * 2200),
    });
  for (let k = 0; k < 3; k++)
    d.push({
      day: 3 + k * 9,
      hour: 9,
      type: "Card Payment",
      description: "PSO SERVICE STATION KARACHI",
      amount: -Math.round(3500 + r() * 1500),
    });
  d.push({
    day: 12 + (i % 3),
    hour: 21,
    type: "Raast Out",
    description: "Outgoing fund transfer to Bilal Siddiqui Bank-0000",
    reason: "Dinner split",
    amount: -Math.round(1200 + r() * 1800),
  });
  d.push({
    day: 18,
    hour: 19,
    type: "Raast Out",
    description: "Outgoing fund transfer to Bilal Siddiqui Bank-0000",
    reason: "Cinema",
    amount: -Math.round(800 + r() * 900),
  });
  if (i % 2 === 0)
    d.push({
      day: 20,
      hour: 18,
      type: "IBFT In",
      description: "Incoming fund transfer from Bilal Siddiqui Bank-0000",
      amount: 1500,
    });
  d.push({ day: 22, hour: 17, type: "Card Payment", description: "TONI AND GUY SALON", amount: -2500 });
  d.push({ day: 25, hour: 12, type: "Card Payment", description: "GYMNASIUM FITNESS CLUB", amount: -6000 });
  return d;
}

function sadaMonth(month: string, r: () => number, i: number): Draft[] {
  const d: Draft[] = [
    {
      day: 1,
      hour: 10,
      type: "Incoming",
      description: "From Own Account (Meezan Bank (MBL))",
      amount: 50000,
    },
    {
      day: 4,
      hour: 11,
      type: "Bill payment",
      description: "Bill payment K-Electric",
      amount: -Math.round(5200 + r() * 2600),
    },
    { day: 5, hour: 9, type: "Outgoing", description: "To Guard Akbar (SadaPay)", amount: -5000 },
    { day: 7, hour: 3, type: "Card payment", description: "Card payment APPLE.COM/BILL", amount: -950 },
    { day: 9, hour: 14, type: "Bill payment", description: "Bill payment Jazz Postpaid", amount: -1500 },
    {
      day: 15,
      hour: 20,
      type: "Outgoing",
      description: "To Edhi Foundation (Meezan Bank (MBL))",
      amount: -2000,
    },
  ];
  if (month >= "2026-09")
    d.push({ day: 10, hour: 18, type: "Outgoing", description: "To Mom (SadaPay)", amount: -15000 });
  if (month === "2026-08")
    d.push({ day: 15, hour: 16, type: "Incoming", description: "From Mom (SadaPay)", amount: 90000 });
  if (month === "2026-08")
    d.push({
      day: 16,
      hour: 12,
      type: "Card payment",
      description: "Card payment CYCLE HUB",
      amount: -88000,
    });
  if (i % 3 === 0)
    d.push({
      day: 21,
      hour: 15,
      type: "Card payment",
      description: "Card payment HETZNER ONLINE",
      amount: -1800,
    });
  return d;
}

export interface World {
  server: MockServer;
  nayaClosing: number; // rupees at end of last NayaPay statement
}

/** Builds May 2026 → 7 Nov 2026 for both wallets, a loan from Mom, a goal, and warm rows after the statements. */
export function buildWorld(): World {
  const server = new MockServer(WORLD_NOW);
  const r = rng(42);
  const counter = { n: 0 };
  let cmdN = 0;
  const run = (name: Command["name"], args: unknown) => {
    const res = server.run(
      { id: `seed${String(++cmdN).padStart(5, "0")}`, name, at: WORLD_NOW, args } as Command,
      true,
    );
    if (!res.ok) throw new Error(`${name} failed: ${res.message}`);
    return res;
  };

  // History starts in May for the synthetic world (the real default is 1 Nov 2026).
  run("resetLedger", { tracking_start: "2026-05-01", confirm: "RESET" });

  let naya = 12000;
  let sada = 40000;
  const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];
  months.forEach((m, i) => {
    const last = m === "2026-11" ? 5 : daysInMonth(m);
    const n = statement("nayapay", m, last, naya, nayaMonth(m, r, i), counter);
    naya = n.closing;
    run("importStatement", {
      statement: n.statement,
      file_name: `m-${m.slice(5)}-${m.slice(0, 4)}.csv`,
      file_sha256: `syn-n-${m}`,
    });
    const sLast = m === "2026-11" ? 7 : daysInMonth(m);
    const s = statement("sadapay", m, sLast, sada, sadaMonth(m, r, i), counter);
    sada = s.closing;
    run("importStatement", {
      statement: s.statement,
      file_name: `sadapay_account_statement_01-${m.slice(5)}-${m.slice(0, 4)}.pdf`,
      file_sha256: `syn-s-${m}`,
    });
  });

  // Rules so the synthetic merchants land in categories.
  const rule = (id: string, pattern: string, category_id: string) =>
    run("upsertRule", {
      rule_id: id,
      pattern,
      category_id,
      flow: null,
      counterparty_id: null,
      priority: 1000,
    });
  rule("r-bilal", "bilal siddiqui", "enjoyments.friends");
  rule("r-cycle", "cycle hub", "self.indulgences");

  // Loan from Mom: Rs 90,000 for a bicycle, Rs 15,000/month from September.
  run("upsertLoan", {
    loan_id: "loan-mom",
    lender: "Mom",
    counterparty_id: null,
    principal: 9_000_000,
    started_on: "2026-08-15",
    purpose: "Bicycle",
    installment: 1_500_000,
    note: null,
    manual_repaid: 0,
    closed_on: null,
  });
  const ds = server.dataset();
  for (const t of ds.transactions) {
    if (t.description === "To Mom (SadaPay)")
      run("tagTransaction", { txn_id: t.id, flow: "loan_repay", loan_id: "loan-mom", category_id: null });
    if (t.description === "From Mom (SadaPay)")
      run("tagTransaction", { txn_id: t.id, flow: "loan_in", loan_id: "loan-mom", category_id: null });
    // Everything else untagged before November gets a category, so only this month has work to do.
    if (t.category_id === null && t.flow === "spend" && t.occurred_at < "2026-11-01") {
      const cat = /SALON|GYM/.test(t.description) ? "self.routine" : "misc";
      run("tagTransaction", { txn_id: t.id, category_id: cat });
    }
  }

  run("upsertGoal", {
    goal_id: "goal-laptop",
    name: "Laptop",
    icon: "briefcase",
    target: 25_000_000,
    monthly: 1_000_000,
    priority: 1,
    achieved_on: null,
  });
  run("moveGoal", {
    move_id: "move-1",
    goal_id: "goal-laptop",
    amount: 3_000_000,
    on: "2026-10-02",
    note: null,
  });

  // Warm rows after the NayaPay statement (6–7 Nov) — a statement import later verifies them.
  const warm = [
    { id: "warm-1", at: "2026-11-06T13:20", amount: -145000, reason: "Lunch at Kolachi" },
    { id: "warm-2", at: "2026-11-07T09:05", amount: -100000, reason: "Petrol" },
  ];
  for (const w of warm)
    run("addProvisional", {
      txn_id: w.id,
      account_id: "nayapay",
      occurred_at: w.at,
      amount: w.amount,
      reason: w.reason,
      category_id: null,
      flow: null,
      counterparty_name: null,
    });

  // Close the older months so the Close screen has history.
  for (const m of ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    const res = server.run(
      { id: `close-${m}`, name: "closeMonth", at: WORLD_NOW, args: { month: m } } as Command,
      true,
    );
    if (!res.ok) break;
  }
  return { server, nayaClosing: naya };
}

/** A synthetic NayaPay CSV for 6–7 Nov that verifies the two warm rows and adds one new row. */
export function novemberCsv(opening: number): string {
  const fmt = (rs: number) =>
    rs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const b1 = opening - 1450;
  const b2 = b1 - 1000;
  const b3 = b2 - 650;
  return `Customer Name,Test User
NayaPay ID,testuser

Account Statement for:,from 06 Nov 2026 to 07 Nov 2026

Opening Balance,"${fmt(opening)}",Closing Balance,"${fmt(b3)}",,Total Spent,"3,100",Total Income,"0"

TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE
07 Nov 2026 08:30 PM,Card Payment,"CHAAYE KHANA KARACHI
|Transaction ID 990003","-650","${fmt(b3)}"
07 Nov 2026 09:10 AM,Card Payment,"PSO SERVICE STATION KARACHI
|Transaction ID 990002","-1,000","${fmt(b2)}"
06 Nov 2026 01:25 PM,Card Payment,"KOLACHI RESTAURANT KARACHI
|Transaction ID 990001","-1,450","${fmt(b1)}"
`;
}

export type { Mutation };
export const nextMonth = (m: string) => addMonths(m, 1);
