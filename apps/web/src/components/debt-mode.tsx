import { debtStatus } from "@marqum/core";
import { useEffect } from "react";
import { useDataset, useNow } from "./dataset-provider.tsx";

/**
 * When loan payments outrun what you save in a month, the whole app goes black and red (styles/app.css ›
 * html[data-debt]). An affordable payment plan stays calm. Clears itself once it's affordable again.
 */
export function DebtMode() {
  const ds = useDataset();
  const now = useNow();
  // only when the loan payments are more than you save in a month
  const inDebt = ds ? !debtStatus(ds, now).affordable : false;
  useEffect(() => {
    const root = document.documentElement;
    if (inDebt) root.dataset.debt = "1";
    else delete root.dataset.debt;
    return () => {
      delete root.dataset.debt;
    };
  }, [inDebt]);
  return null;
}
