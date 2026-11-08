import { render, screen } from "@testing-library/react";
import { LucideProvider } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { DatasetProvider } from "../src/components/dataset-provider.tsx";
import { TxnRow } from "../src/components/txn-list.tsx";
import { MarqumDb, setDatabase } from "../src/lib/db.ts";
import { lookup } from "../src/lib/view.ts";
import { buildWorld } from "./world.ts";

describe("transaction row", () => {
  it("draws warm rows with the unverified treatment and verified rows plainly", () => {
    const ds = buildWorld().server.dataset();
    const l = lookup(ds);
    const warm = ds.transactions.find((t) => t.status === "provisional");
    const verified = ds.transactions.find((t) => t.status === "verified" && t.amount < 0);
    if (!warm || !verified) throw new Error("fixture");
    setDatabase(new MarqumDb("row-test"));
    const onOpen = vi.fn();
    render(
      <LucideProvider size={20} strokeWidth={1.75}>
        <DatasetProvider>
          <ul>
            <TxnRow t={warm} l={l} onOpen={onOpen} />
            <TxnRow t={verified} l={l} onOpen={onOpen} />
          </ul>
        </DatasetProvider>
      </LucideProvider>,
    );
    const rows = screen.getAllByTestId("txn-row");
    expect(rows[0]?.dataset.status).toBe("provisional");
    expect(rows[0]?.textContent).toContain("Unverified");
    expect(rows[0]?.querySelector(".warm-outline")).not.toBeNull();
    expect(rows[1]?.querySelector(".warm-outline")).toBeNull();
    rows[0]?.click();
    expect(onOpen).toHaveBeenCalledWith(warm);
  });
});
