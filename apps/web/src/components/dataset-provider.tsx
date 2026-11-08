import type { Dataset } from "@marqum/core";
import { karachiNow } from "@marqum/core";
import { useLiveQuery } from "dexie-react-hooks";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { loadDataset } from "../lib/dataset.ts";

interface DatasetValue {
  dataset: Dataset | undefined;
  pending: number;
}

const DatasetContext = createContext<DatasetValue>({ dataset: undefined, pending: 0 });

export function DatasetProvider({ children }: { children: ReactNode }) {
  const value = useLiveQuery(loadDataset, []);
  return (
    <DatasetContext.Provider value={{ dataset: value?.dataset, pending: value?.outbox.length ?? 0 }}>
      {children}
    </DatasetContext.Provider>
  );
}

/** The local replica + optimistic outbox. `undefined` only for the first few ms (render skeletons). */
export function useDataset(): Dataset | undefined {
  return useContext(DatasetContext).dataset;
}

export function usePendingCount(): number {
  return useContext(DatasetContext).pending;
}

/** Karachi local time, refreshed every minute. */
export function useNow(): string {
  const [now, setNow] = useState(karachiNow);
  useEffect(() => {
    const t = setInterval(() => setNow(karachiNow()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
