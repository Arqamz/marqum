import { categoryCards, closeChecklist, netPosition, unverifiedSummary } from "@marqum/core";
import { describe, expect, it } from "vitest";
import { buildWorld, WORLD_NOW } from "./world.ts";

describe("synthetic world", () => {
  it("builds a believable dataset through real commands", () => {
    const { server } = buildWorld();
    const ds = server.dataset();
    const np = netPosition(ds, WORLD_NOW);
    expect(np.in_debt).toBe(true);
    expect(np.debt).toBe(6_000_000);
    expect(unverifiedSummary(ds).count).toBe(2);
    expect(categoryCards(ds, "2026-11", WORLD_NOW).length).toBeGreaterThan(3);
    expect(ds.months.filter((m) => m.status === "closed").length).toBeGreaterThan(0);
    expect(closeChecklist(ds, "2026-10", WORLD_NOW).items.length).toBeGreaterThan(3);
  });
});
