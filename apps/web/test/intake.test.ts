import { beforeEach, describe, expect, it } from "vitest";
import { db, MarqumDb, setDatabase } from "../src/lib/db.ts";
import { discardIntake, importAnyway, ingestFile, statementLabel } from "../src/lib/intake.ts";
import { toasts } from "../src/lib/toast.ts";
import { novemberCsv } from "./world.ts";

const enc = (s: string) => new TextEncoder().encode(s);
let n = 0;
beforeEach(() => {
  setDatabase(new MarqumDb(`intake-${++n}`));
  toasts.set([]);
});

describe("statement intake", () => {
  it("imports a statement whose checks pass, once", async () => {
    const file = { name: "m-11-2026.csv", bytes: enc(novemberCsv(20000)) };
    const first = await ingestFile(file);
    expect(first.kind).toBe("imported");
    expect(toasts.get().at(-1)?.title).toBe("Imported NayaPay 6–7 Nov · 3 new");
    const queued = await db.outbox.toArray();
    expect(queued.map((q) => q.command.name)).toEqual(["importStatement"]);
    expect((await ingestFile(file)).kind).toBe("duplicate");
    expect(await db.outbox.count()).toBe(1);
  });

  it("parks a statement with a failed check under Needs a look", async () => {
    const broken = novemberCsv(20000).replace(/Closing Balance,"[^"]+"/, 'Closing Balance,"1.00"');
    const res = await ingestFile({ name: "m-11-2026.csv", bytes: enc(broken) });
    expect(res.kind).toBe("needs_look");
    expect(await db.outbox.count()).toBe(0);
    const [entry] = await db.intake.toArray();
    expect(entry?.status).toBe("needs_look");
    expect(entry?.failed.length).toBeGreaterThan(0);

    await importAnyway(entry?.sha256 ?? "");
    expect(await db.outbox.count()).toBe(1);
  });

  it("remembers discarded files", async () => {
    const broken = novemberCsv(20000).replace(/Closing Balance,"[^"]+"/, 'Closing Balance,"1.00"');
    const file = { name: "m-11-2026.csv", bytes: enc(broken) };
    await ingestFile(file);
    const [entry] = await db.intake.toArray();
    await discardIntake(entry?.sha256 ?? "");
    expect((await ingestFile(file)).kind).toBe("duplicate");
  });

  it("reports unreadable files", async () => {
    const res = await ingestFile({ name: "notes.csv", bytes: enc("hello,world") });
    expect(res.kind).toBe("unreadable");
    expect(toasts.get().at(-1)?.tone).toBe("error");
  });

  it("labels periods the way people say them", () => {
    expect(statementLabel({ bank: "nayapay", from: "2026-11-01", to: "2026-11-07" })).toBe("NayaPay 1–7 Nov");
    expect(statementLabel({ bank: "sadapay", from: "2026-10-28", to: "2026-11-03" })).toBe(
      "SadaPay 28 Oct – 3 Nov",
    );
  });
});
