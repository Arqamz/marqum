import type { Command } from "@marqum/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../src/lib/auth.ts";
import { enqueue } from "../src/lib/commands.ts";
import { loadDataset } from "../src/lib/dataset.ts";
import { db, MarqumDb, setDatabase } from "../src/lib/db.ts";
import { prompts } from "../src/lib/prompts.ts";
import { syncNow, syncState } from "../src/lib/sync.ts";
import { toasts } from "../src/lib/toast.ts";
import { buildWorld } from "./world.ts";

let n = 0;
beforeEach(async () => {
  setDatabase(new MarqumDb(`test-${++n}`));
  toasts.set([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function signedIn() {
  const { server } = buildWorld();
  vi.stubGlobal("fetch", server.fetch);
  await auth.login(server.passcode, "Test");
  return server;
}

describe("sync engine", () => {
  it("pulls the server state into an empty replica", async () => {
    const server = await signedIn();
    await syncNow();
    expect(syncState.get().status).toBe("synced");
    const { dataset } = await loadDataset();
    expect(dataset.transactions.length).toBe(server.dataset().transactions.length);
    expect(dataset.loans[0]?.lender).toBe("Mom");
  });

  it("shows queued commands optimistically, then clears them once the server has them", async () => {
    const server = await signedIn();
    await syncNow();
    const target = server.dataset().transactions.find((t) => t.status === "provisional");
    if (!target) throw new Error("no provisional row");

    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await enqueue("tagTransaction", { txn_id: target.id, category_id: "food" });
    let view = await loadDataset();
    expect(view.dataset.transactions.find((t) => t.id === target.id)?.category_id).toBe("food");
    expect(view.outbox).toHaveLength(1);

    await syncNow();
    expect(syncState.get().status).toBe("offline");
    expect(await db.outbox.count()).toBe(1);

    vi.stubGlobal("fetch", server.fetch);
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    view = await loadDataset();
    expect(view.dataset.transactions.find((t) => t.id === target.id)?.category_id).toBe("food");
    expect(server.log.at(-1)?.name).toBe("tagTransaction");
  });

  it("rolls back a rejected command and says why", async () => {
    await signedIn();
    await syncNow();
    await enqueue("deleteProvisional", { txn_id: "does-not-exist" });
    await syncNow();
    expect(await db.outbox.count()).toBe(0);
    const t = toasts.get().at(-1);
    expect(t?.tone).toBe("error");
    expect(t?.title).toContain("didn't save");
  });

  it("asks for step-up when a closed month is edited, then retries with the token", async () => {
    const server = await signedIn();
    await syncNow();
    const old = server
      .dataset()
      .transactions.find((t) => t.occurred_at.startsWith("2026-06") && t.flow === "spend");
    if (!old) throw new Error("no closed-month row");
    expect(server.dataset().months.some((m) => m.id === "2026-06" && m.status === "closed")).toBe(true);

    const unsubscribe = prompts.subscribe(() => prompts.get()?.resolve(server.passcode));
    await enqueue("tagTransaction", { txn_id: old.id, reason: "Birthday dinner" });
    await syncNow();
    unsubscribe();
    expect(await db.outbox.count()).toBe(0);
    const pushed = server.log.at(-1) as Command;
    expect(pushed.name).toBe("tagTransaction");
    expect(server.dataset().transactions.find((t) => t.id === old.id)?.reason).toBe("Birthday dinner");
  });

  it("drops the replica and reloads when the ledger epoch changes", async () => {
    const server = await signedIn();
    await syncNow();
    expect((await loadDataset()).dataset.transactions.length).toBeGreaterThan(0);
    await db.intake.put({
      sha256: "abc",
      name: "m-10-2026.csv",
      status: "imported",
      statement: null,
      failed: [],
      error: null,
      seen_at: 1,
      base64: null,
    });
    server.resetElsewhere();
    await syncNow();
    const { dataset } = await loadDataset();
    expect(dataset.transactions).toHaveLength(0);
    expect(await db.intake.count()).toBe(0);
    expect(toasts.get().at(-1)?.title).toBe("Ledger was reset — reloaded");
    expect(dataset.loans[0]?.lender).toBe("Mom"); // configuration survives
  });
});
