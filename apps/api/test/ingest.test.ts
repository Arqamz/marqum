import { emptyDataset } from "@marqum/core";
import { parseNotification } from "@marqum/parsers";
import type { Notification } from "@marqum/schema";
import { describe, expect, it } from "vitest";
import { findDuplicate } from "../src/lib/ingest.ts";

const TEXT =
  "You spent PKR 1,234.00 at NetflixX12AB34CD56     Amsterdam     NLD. Your available balance is PKR 20500.50.";
const note = (
  id: string,
  posted_at: string,
  text = TEXT,
  status: Notification["status"] = "parsed",
): Notification => ({
  id,
  package: "com.sadapay.app",
  title: "Message from SadaPay",
  text,
  posted_at,
  status,
  transaction_id: status === "parsed" ? `t-${id}` : null,
  version: 1,
  deleted: false,
});

describe("findDuplicate", () => {
  const ds = { ...emptyDataset(), notifications: [note("a", "2026-11-08T14:00")] };
  const check = (n: Notification) => {
    const p = parseNotification(n.package, n.title, n.text, n.posted_at);
    if (!p) throw new Error("fixture should parse");
    return findDuplicate(ds, n, p);
  };

  it("matches the same spend within 2 minutes", () => {
    expect(check(note("b", "2026-11-08T14:02"))).toBe("a");
    expect(check(note("b", "2026-11-08T13:58"))).toBe("a");
  });
  it("ignores spends further apart, different amounts or merchants", () => {
    expect(check(note("b", "2026-11-08T14:03"))).toBeNull();
    expect(check(note("b", "2026-11-08T14:01", TEXT.replace("1,234.00", "1,235.00")))).toBeNull();
    expect(check(note("b", "2026-11-08T14:01", TEXT.replace("Netflix", "Hulu")))).toBeNull();
  });
  it("only compares against parsed notifications", () => {
    const ignored = { ...emptyDataset(), notifications: [note("a", "2026-11-08T14:00", TEXT, "ignored")] };
    const n = note("b", "2026-11-08T14:01");
    const p = parseNotification(n.package, n.title, n.text, n.posted_at);
    expect(p && findDuplicate(ignored, n, p)).toBeNull();
  });
});
