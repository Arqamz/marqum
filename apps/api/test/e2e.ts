// End-to-end smoke test against a running Worker (see test/e2e.sh, which starts `wrangler dev --local`).
// Usage: node --experimental-strip-types test/e2e.ts http://localhost:8789 <passcode>

import type { Line } from "@marqum/parsers";
import { readCsvStatement, readPdfStatement } from "@marqum/parsers";
import type { Command, ParsedStatement } from "@marqum/schema";

const BASE = process.argv[2] ?? "http://localhost:8789";
const PASSCODE = process.argv[3] ?? "e2e-passcode-1234";
let token = "";
let n = 0;

function check(cond: unknown, what: string, extra?: unknown): asserts cond {
  n++;
  if (!cond) {
    process.stderr.write(`✗ ${what}${extra === undefined ? "" : `\n${JSON.stringify(extra, null, 2)}`}\n`);
    process.exit(1);
  }
  process.stdout.write(`✓ ${what}\n`);
}

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json: json as T };
}

type Row = Record<string, unknown> & { id: string };
type Pull = { version: number; changes: Record<string, Row[]>; more: boolean; epoch: string };
type Push = {
  results: { id: string; ok: boolean; error?: string; message?: string; result?: Record<string, unknown> }[];
  version: number;
};

let cursor = 0;
let epoch = "";
let replica: Record<string, Map<string, Row>> = {};
async function pullAll(): Promise<Record<string, Row[]>> {
  let changed: Record<string, Row[]> = {};
  for (;;) {
    const { status, json } = await api<Pull>("GET", `/api/sync/pull?since=${cursor}`);
    check(
      status === 200 && typeof json.epoch === "string" && json.epoch.length > 0,
      `pull since=${cursor}`,
      json,
    );
    if (epoch && json.epoch !== epoch && cursor !== 0) {
      // ledger was reset elsewhere: drop the replica and pull everything again (what clients do)
      epoch = json.epoch;
      replica = {};
      changed = {};
      cursor = 0;
      continue;
    }
    epoch = json.epoch;
    for (const [tbl, rows] of Object.entries(json.changes)) {
      replica[tbl] ??= new Map();
      for (const r of rows) replica[tbl].set(r.id, r);
      changed[tbl] = [...(changed[tbl] ?? []), ...rows];
    }
    cursor = json.version;
    if (!json.more) return changed;
  }
}
const live = (tbl: string) => [...(replica[tbl]?.values() ?? [])].filter((r) => !r.deleted);

let seq = 0;
const cmdId = () => `e2e-${Date.now().toString(36)}-${++seq}`;
const at = "2026-11-08T10:00";
const push = (commands: Command[], headers: Record<string, string> = {}) =>
  api<Push>("POST", "/api/sync/push", { commands }, headers);
const importCmd = (statement: ParsedStatement, file: string): Command => ({
  id: cmdId(),
  name: "importStatement",
  at,
  args: { statement, file_name: file, file_sha256: `${file.length}`.padStart(64, "0") },
});

// ---- synthetic statements (September 2026: complete month for both wallets)
const NAYA_CSV = `Customer Name,Test User
NayaPay ID,testuser
Account Statement for:,from 01 Sep 2026 to 30 Sep 2026
Opening Balance,100.00,Closing Balance,"30,750.00",,Total Spent,"2,350",Total Income,"33,000"
TIMESTAMP,TYPE,DESCRIPTION,AMOUNT,BALANCE
05 Sep 2026 07:40 PM,IBFT In,"Incoming fund transfer from Test User
Meezan-0000|Transaction ID 800001","+33,000","33,100.00"
07 Sep 2026 09:15 PM,Card Payment,"FOODPANDA KARACHI
|Transaction ID 800002","-2,350","30,750.00"
`;
const L = (y: number, ...cells: [number, string][]): Line => ({
  page: 1,
  y,
  cells: cells.map(([x, text]) => ({ x, text })),
  text: cells.map((c) => c[1]).join("  "),
});
const SADA_LINES = [
  L(720, [20, "Account Statement"]),
  L(650, [20, "IBAN: PK00 SADA 0000 0000 00000000"]),
  L(596, [40, "Total debit"], [170, "Total credit"]),
  L(573, [40, "0"], [170, "1450.00"]),
  L(506, [20, "Account transactions from 1 September 2026 - 30 September 2026"]),
  L(464, [81, "Date"], [210, "Description"], [500, "Debit/Credit"]),
  L(423, [46, "3 Sep, 2026"], [210, "From TEST (Meezan Bank (MBL))"]),
  L(417, [496, "+ 1,450.00"]),
  L(411, [58, "03:15 PM"], [210, "(Incoming transfer)"]),
  L(34, [20, "Note: This is a system generated statement and does not require a signature."]),
];
// October: NayaPay only (so October can't be closed)
const NAYA_OCT = NAYA_CSV.replaceAll("Sep", "Oct")
  .replace("30 Oct 2026", "31 Oct 2026")
  .replaceAll("8000", "8100")
  .replace("Opening Balance,100.00", "Opening Balance,30750.00")
  .replace('"30,750.00",,', '"61,400.00",,')
  .replace('"33,100.00"', '"63,750.00"')
  .replace('"30,750.00"\n', '"61,400.00"\n');

// ---------------------------------------------------------------------------------------------
{
  const { status, json } = await api("GET", "/api/health");
  check(status === 200 && json.ok === true, "health is public", json);
}
{
  const { status, json } = await api("GET", "/api/sync/pull?since=0");
  check(status === 401 && json.error === "unauthorized", "pull without a token → 401", json);
}
{
  const { status, json } = await api("POST", "/api/auth/login", {
    passcode: "wrong-pass",
    device_name: "e2e",
  });
  check(status === 401 && json.error === "invalid_passcode", "wrong passcode → 401", json);
}
{
  const { status, json } = await api("POST", "/api/auth/login", { device_name: "e2e" });
  check(status === 400 && json.error === "invalid", "invalid login body → 400 {error,message}", json);
}
{
  const { status, json } = await api<{ token: string; device_id: string }>("POST", "/api/auth/login", {
    passcode: PASSCODE,
    device_name: "e2e runner",
  });
  check(status === 200 && json.token.length > 20 && json.device_id, "login issues a device token", json);
  token = json.token;
}
{
  const { json } = await api("GET", "/api/auth/me");
  check(json.device_name === "e2e runner", "me", json);
}
{
  const res = await fetch(`${BASE}/api/health`, {
    method: "OPTIONS",
    headers: {
      Origin: "capacitor://localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,x-step-up",
    },
  });
  check(
    res.headers.get("access-control-allow-origin") === "capacitor://localhost",
    "CORS allows the Capacitor origin",
  );
  const bad = await fetch(`${BASE}/api/health`, { headers: { Origin: "https://evil.example" } });
  check(!bad.headers.get("access-control-allow-origin"), "CORS rejects other origins");
}

// ---- seed
await pullAll();
check(
  live("accounts")
    .map((a) => a.id)
    .sort()
    .join() === "nayapay,sadapay",
  "seed: both accounts visible",
);
check(live("categories").length > 10 && live("rules").length > 5, "seed: categories and rules visible");

// ---- start tracking in September so a past month can be imported and sealed
{
  const su = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
    passcode: PASSCODE,
  });
  check(su.status === 200 && su.json.step_up_token, "passcode step-up", su.json);
  const r = await push(
    [{ id: cmdId(), name: "resetLedger", at, args: { tracking_start: "2026-09-01", confirm: "RESET" } }],
    { "X-Step-Up": su.json.step_up_token },
  );
  check(r.json.results[0]?.ok === true, "resetLedger → tracking starts 2026-09-01", r.json);
  await pullAll();
}

// ---- import statements
const naya = await readCsvStatement(NAYA_CSV);
const sada = await readPdfStatement(SADA_LINES);
check(naya.checks.every((c) => c.ok) && sada.checks.every((c) => c.ok), "synthetic statements parse cleanly");
const importNaya = importCmd(naya, "m-09-2026.csv");
{
  const { status, json } = await push([
    importNaya,
    importCmd(sada, "sadapay_account_statement_01-09-2026_30-09-2026.pdf"),
  ]);
  check(status === 200 && json.results.every((r) => r.ok), "push importStatement ×2", json);
}
{
  const changed = await pullAll();
  check(
    (changed.transactions?.length ?? 0) >= 3,
    "pull returns the imported transactions",
    changed.transactions,
  );
  check(
    live("transactions").every((t) => t.status === "verified"),
    "imported rows are verified",
  );
  check(live("statements").length === 2, "two statements recorded");
}
const food = live("transactions").find((t) => t.external_id === "naya:800002");
check(food, "food transaction present");

// ---- tag + idempotency
const tag: Command = {
  id: cmdId(),
  name: "tagTransaction",
  at,
  args: { txn_id: food.id, category_id: "food.friends", reason: "Dinner with friends" },
};
const first = await push([tag]);
check(first.json.results[0]?.ok === true, "tagTransaction", first.json);
await pullAll();
check(replica.transactions?.get(food.id)?.reason === "Dinner with friends", "tag visible after pull");
const versionAfterTag = cursor;
const again = await push([tag, importNaya]);
check(
  JSON.stringify(again.json.results) === JSON.stringify([first.json.results[0], again.json.results[1]]) &&
    again.json.results.every((r) => r.ok),
  "duplicate commands return their stored results",
  again.json,
);
{
  const changed = await pullAll();
  check(
    Object.keys(changed).length === 0 && cursor === versionAfterTag,
    "duplicate push wrote nothing",
    changed,
  );
}

// ---- notifications
const notif = {
  id: `${"0".repeat(63)}1`,
  package: "com.nayapay.app",
  title: "Payment Successful",
  text: "You paid Rs. 1,250 at Test Cafe using your NayaPay card",
  posted_at: "2026-11-07T21:10",
};
{
  const { status, json } = await api("POST", "/api/ingest/notification", notif);
  check(
    status === 200 && json.status === "parsed" && typeof json.transaction_id === "string",
    "ingest notification → parsed",
    json,
  );
  const dup = await api("POST", "/api/ingest/notification", notif);
  check(
    dup.json.status === "parsed" && dup.json.transaction_id === json.transaction_id,
    "re-ingest is deduped",
    dup.json,
  );
  await pullAll();
  const t = replica.transactions?.get(json.transaction_id as string);
  check(
    t?.status === "provisional" &&
      t.source === "notification" &&
      t.notification_id === notif.id &&
      t.amount === -125000,
    "provisional transaction from the notification",
    t,
  );
  check(replica.notifications?.get(notif.id)?.status === "parsed", "notification row synced");
}
{
  const { json } = await api("POST", "/api/ingest/notification", {
    ...notif,
    id: `${"0".repeat(63)}2`,
    title: "OTP",
    text: "Your OTP is 000000. Do not share it.",
  });
  check(json.status === "ignored" && json.transaction_id === null, "OTP notification ignored", json);
}

// ---- real notification formats (synthetic merchants/amounts/digits)
const nid = (k: number) => `${"0".repeat(60)}${String(k).padStart(4, "0")}`;
const spendText =
  "You spent Rs. 1,500 online at G-9 (Test Bakery - Isd-rwp) Karachi Pk. Zero hesitation, we love it.";
const sadaText =
  "You spent PKR 1,234.00 at NetflixX12AB34CD56     Amsterdam     NLD. Your available balance is PKR 20500.50.";
const SPEND = {
  id: nid(12),
  package: "com.nayapay.app",
  title: "Card in action 💳",
  text: spendText,
  posted_at: "2026-11-08T13:01",
};
const SADA = {
  id: nid(13),
  package: "com.sadapay.app",
  title: "Message from SadaPay",
  text: sadaText,
  posted_at: "2026-11-08T14:00",
};

/** Regression: the response is not enough — pull and require the rows to really exist on the server. */
async function assertIngested(
  what: string,
  res: { status?: unknown; transaction_id?: unknown },
  n: { id: string; posted_at: string },
  amount: number,
  balance: number | null = null,
) {
  check(res.status === "parsed" && typeof res.transaction_id === "string", `${what}: response parsed`, res);
  await pullAll();
  const t = replica.transactions?.get(res.transaction_id as string);
  check(
    t && !t.deleted && t.amount === amount && t.notification_id === n.id && t.source === "notification",
    `${what}: transaction row persisted`,
    t ?? live("transactions"),
  );
  const row = replica.notifications?.get(n.id);
  check(
    row?.status === "parsed" && row.transaction_id === res.transaction_id,
    `${what}: notification row persisted`,
    row,
  );
  if (balance !== null) {
    const b = live("balances").find((x) => x.source === "notification" && x.as_of === n.posted_at);
    check(b?.balance === balance, `${what}: notification balance row persisted`, live("balances"));
  }
}

{
  const ingestN = (k: number, pkg: string, title: string, text: string, posted_at: string) =>
    api<Record<string, unknown>>("POST", "/api/ingest/notification", {
      id: nid(k),
      package: pkg,
      title,
      text,
      posted_at,
    });

  const verify = await ingestN(
    10,
    "com.nayapay.app",
    "Verify online payment 🔐",
    "Tap to confirm Rs. 1,500 payment to G-9 (TEST BAKERY - ISD-RWP).",
    "2026-11-08T13:00",
  );
  check(verify.json.status === "ignored", "verify-payment prompt ignored", verify.json);
  const auth = await ingestN(
    11,
    "com.nayapay.app",
    "Card Authorization",
    "You have authorized TEST *SERVICE TEMP cc@example.comUS on Visa Physical-0000.",
    "2026-11-08T13:00",
  );
  check(auth.json.status === "ignored", "card authorization ignored", auth.json);
  const spend = await api("POST", "/api/ingest/notification", SPEND);
  await assertIngested("ingest card-in-action spend", spend.json, SPEND, -150000);
  const sada = await api("POST", "/api/ingest/notification", SADA);
  await assertIngested("ingest SadaPay spend with balance", sada.json, SADA, -123400, 2050050);
  const dup = await ingestN(14, "com.sadapay.app", "Message from SadaPay", sadaText, "2026-11-08T14:01");
  check(
    dup.json.status === "ignored" && dup.json.duplicate_of === nid(13),
    "same spend within 2 min → ignored duplicate",
    dup.json,
  );

  await pullAll();
  const t = replica.transactions?.get(spend.json.transaction_id as string);
  check(
    t?.amount === -150000 && t.description === spendText && t.status === "provisional",
    "spend transaction keeps the full text",
    t,
  );
  const cp = live("counterparties").find((c) => c.id === t.counterparty_id);
  check(cp?.name === "Test Bakery", "merchant cleaned to Test Bakery", cp);
  const bal = live("balances").find((b) => b.source === "notification");
  check(
    bal?.account_id === "sadapay" && bal.balance === 2050050 && bal.as_of === "2026-11-08T14:00",
    "SadaPay stated balance recorded as a notification BalanceEntry",
    live("balances"),
  );
  check(
    replica.notifications?.get(nid(14))?.status === "ignored",
    "duplicate notification row synced as ignored",
  );

  const re = {
    items: [
      {
        id: nid(15),
        package: "com.nayapay.app",
        title: "Card in action 💳",
        text: spendText.replace("1,500", "1,700"),
        posted_at: "2026-11-08T15:00",
      },
    ],
  };
  const reDenied = await api("POST", "/api/admin/reingest", re);
  check(reDenied.status === 403, "admin reingest without step-up → 403", reDenied.json);
  const su = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
    passcode: PASSCODE,
  });
  const reOk = await api<{ results: { status: string }[] }>("POST", "/api/admin/reingest", re, {
    "X-Step-Up": su.json.step_up_token,
  });
  check(reOk.status === 200, "admin reingest", reOk.json);
  await assertIngested("admin reingest", reOk.json.results[0] ?? {}, re.items[0] as typeof SPEND, -170000);
  const early = await api<{ results: { status: string; reason?: string }[] }>(
    "POST",
    "/api/admin/reingest",
    { items: [{ ...re.items[0], id: nid(16), posted_at: "2026-08-15T10:00" }] },
    { "X-Step-Up": su.json.step_up_token },
  );
  check(
    early.json.results[0]?.status === "ignored" && early.json.results[0]?.reason === "before_tracking_start",
    "reingest respects tracking_start",
    early.json,
  );
}

// ---- month close
await push([importCmd(await readCsvStatement(NAYA_OCT), "m-10-2026.csv")]);
{
  const { json } = await api<{ can_close: boolean; items: { id: string; ok: boolean }[] }>(
    "GET",
    "/api/months/2026-10/check",
  );
  check(
    json.can_close === false && json.items.some((i) => i.id === "statements_sadapay" && !i.ok),
    "October checklist blocks (SadaPay statement missing)",
    json,
  );
  const { json: r } = await push([{ id: cmdId(), name: "closeMonth", at, args: { month: "2026-10" } }]);
  check(r.results[0]?.ok === false, "closeMonth 2026-10 rejected", r);
}
{
  // September: confirm SadaPay's closing balance, then it can be sealed
  await push([
    {
      id: cmdId(),
      name: "recordBalance",
      at,
      args: { entry_id: "e2e-bal-1", account_id: "sadapay", balance: 145000, as_of: "2026-09-30T23:59" },
    },
  ]);
  const { json } = await api<{
    can_close: boolean;
    items: { id: string; ok: boolean; label: string; severity: string }[];
  }>("GET", "/api/months/2026-09/check");
  const blocking = json.items.filter((i) => !i.ok && i.severity === "block").map((i) => i.id);
  check(blocking.length === 0, "no blocking items", blocking);
  {
    check(
      json.can_close === true,
      "September checklist passes",
      json.items.filter((i) => !i.ok),
    );
    const close = await push([{ id: cmdId(), name: "closeMonth", at, args: { month: "2026-09" } }]);
    check(close.json.results[0]?.ok === true, "closeMonth 2026-09", close.json);
    await pullAll();
    const m = replica.months?.get("2026-09");
    check(
      m?.status === "closed" &&
        typeof m.snapshot_key === "string" &&
        /^sealed\/2026-09\/[0-9a-f]{64}\.json$/.test(m.snapshot_key),
      "month sealed with snapshot key",
      m,
    );
    const snap = await fetch(`${BASE}/api/months/2026-09/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await snap.text();
    check(
      snap.status === 200 && body.length > 100 && snap.headers.get("x-snapshot-sha256") === m.snapshot_sha256,
      "snapshot served from R2",
    );
    check(
      body.includes("carry:cf:") && body.includes("carry:bf:"),
      "snapshot includes the c/f and b/f carry rows",
    );

    const retag: Command = {
      id: cmdId(),
      name: "tagTransaction",
      at,
      args: { txn_id: food.id, reason: "Team dinner" },
    };
    const denied = await push([retag]);
    check(
      denied.json.results[0]?.ok === false && denied.json.results[0]?.error === "step_up_required",
      "closed-month edit needs step-up",
      denied.json,
    );
    const su = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
      passcode: PASSCODE,
    });
    check(su.status === 200 && su.json.step_up_token, "passcode step-up", su.json);
    const allowed = await push([retag], { "X-Step-Up": su.json.step_up_token });
    check(
      allowed.json.results[0]?.ok === true,
      "closed-month tag with step-up (retried command id)",
      allowed.json,
    );
  }
}

// ---- ledger reset (step-up only; keeps configuration, wipes ledger, bumps epoch)
{
  await push([
    {
      id: cmdId(),
      name: "upsertRecurring",
      at,
      args: {
        recurring_id: "e2e-rec-1",
        name: "Test VPS",
        account_id: "sadapay",
        category_id: "subscriptions.vps",
        counterparty_id: null,
        amount: 150000,
        day_of_month: 5,
        active: true,
      },
    },
  ]);
  await pullAll();
  const epochBefore = epoch;
  check(
    live("recurring").some((r) => r.id === "e2e-rec-1"),
    "recurring created before reset",
  );
  const resetCmd: Command = {
    id: cmdId(),
    name: "resetLedger",
    at,
    args: { tracking_start: "2026-11-01", confirm: "RESET" },
  };
  const denied = await push([resetCmd]);
  check(
    denied.json.results[0]?.ok === false && denied.json.results[0]?.error === "step_up_required",
    "resetLedger without step-up rejected",
    denied.json,
  );
  const adminDenied = await api("POST", "/api/admin/reset", {
    tracking_start: "2026-11-01",
    confirm: "RESET",
  });
  check(
    adminDenied.status === 403 && adminDenied.json.error === "step_up_required",
    "admin reset without step-up → 403",
    adminDenied.json,
  );

  const su = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
    passcode: PASSCODE,
  });
  const ok = await push([resetCmd], { "X-Step-Up": su.json.step_up_token });
  const r = ok.json.results[0];
  check(
    r?.ok === true && typeof r.result?.backup_key === "string" && r.result.epoch !== epochBefore,
    "resetLedger with step-up",
    ok.json,
  );
  process.stdout.write(`RESET_KEY=${String(r?.result?.backup_key)}\n`);

  const delta = await api<Pull>("GET", `/api/sync/pull?since=${cursor}`);
  check(delta.json.epoch !== epochBefore, "pull reports the new epoch");
  await pullAll(); // sees the epoch change → full re-pull from 0
  check(
    !live("transactions").some((t) => t.flow !== "carry"),
    "ledger wiped (only carry rows remain)",
    live("transactions"),
  );
  check(
    live("statements").length === 0 && live("notifications").length === 0 && live("balances").length === 0,
    "statements/notifications/balances wiped",
  );
  check(
    ![...(replica.transactions?.values() ?? [])].some((t) => t.deleted),
    "no ledger tombstones after reset (hard-deleted)",
  );
  check(
    live("categories").length > 10 && live("recurring").some((x) => x.id === "e2e-rec-1"),
    "categories and recurring kept",
  );
  check(
    live("settings").find((x) => x.id === "tracking_start")?.value === "2026-11-01",
    "tracking_start set",
    live("settings"),
  );

  const ob = await push([
    { id: cmdId(), name: "setOpeningBalance", at, args: { account_id: "sadapay", amount: 500000 } },
  ]);
  check(ob.json.results[0]?.ok === true, "setOpeningBalance", ob.json);
  await pullAll();
  const bf = live("transactions").filter((t) => t.flow === "carry" && t.account_id === "sadapay");
  check(
    bf.some((t) => t.amount === 500000 && t.source === "system"),
    "b/f carry row for SadaPay after reset",
    live("transactions"),
  );

  // Regression (prod bug): notifications ingested before a reset must ingest again afterwards — the command
  // log survives resets, so the ingest command id has to change with the epoch.
  const suR = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
    passcode: PASSCODE,
  });
  const again = await api<{ results: Record<string, unknown>[] }>(
    "POST",
    "/api/admin/reingest",
    { items: [SPEND, SADA] },
    { "X-Step-Up": suR.json.step_up_token },
  );
  await assertIngested("reingest after reset (spend)", again.json.results[0] ?? {}, SPEND, -150000);
  await assertIngested("reingest after reset (SadaPay)", again.json.results[1] ?? {}, SADA, -123400, 2050050);
  const first = await api("POST", "/api/ingest/notification", notif);
  await assertIngested("normal ingest after reset", first.json, notif, -125000);

  const su2 = await api<{ step_up_token: string }>("POST", "/api/auth/step-up/passcode", {
    passcode: PASSCODE,
  });
  const adm = await api(
    "POST",
    "/api/admin/reset",
    { tracking_start: "2026-11-01", confirm: "RESET" },
    { "X-Step-Up": su2.json.step_up_token },
  );
  check(
    adm.status === 200 && adm.json.ok === true && adm.json.epoch !== epoch,
    "admin reset with step-up bumps the epoch",
    adm.json,
  );
  await pullAll();
}

// ---- export, devices, logout
{
  const { status, json } = await api<{ tables: Record<string, Row[]>; commands: unknown[] }>(
    "GET",
    "/api/export",
  );
  check(
    status === 200 && (json.tables.categories?.length ?? 0) > 10 && json.commands.length >= 10,
    "export has rows and the command log (kept across resets)",
  );
}
{
  const { json } = await api<Row[]>("GET", "/api/auth/devices");
  const me = json.find((d) => d.current);
  check(me, "devices list includes this device", json);
  const del = await api("DELETE", `/api/auth/devices/${me.id}`);
  check(del.status === 200, "revoke this device");
  const after = await api("GET", "/api/auth/me");
  check(after.status === 401, "revoked token → 401");
}
process.stdout.write(`\nAll ${n} e2e checks passed.\n`);
