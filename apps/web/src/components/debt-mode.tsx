import { netPosition } from "@marqum/core";
import { useEffect } from "react";
import { useDataset, useNow } from "./dataset-provider.tsx";

/**
 * While any loan is outstanding the whole app goes black and red (styles/app.css › html[data-debt]), so being in
 * debt is impossible to miss. Clears itself when the last loan is repaid.
 */
export function DebtMode() {
  const ds = useDataset();
  const now = useNow();
  const inDebt = ds ? netPosition(ds, now).in_debt : false;
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
