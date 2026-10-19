/**
 * Datasets Hook
 * Live list of saved datasets (most recently changed first), kept in sync
 * with IndexedDB — including changes made in other tabs.
 */

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

import { listDatasets } from "@/core/storage/repositories/dataset.repository";
import type { Dataset } from "@/types/processing";

type DatasetsState = { status: "loading" } | { status: "ready"; datasets: Dataset[] } | { status: "error" };

export function useDatasets(): DatasetsState {
  const [state, setState] = useState<DatasetsState>({ status: "loading" });
  useEffect(() => {
    const subscription = liveQuery(listDatasets).subscribe({
      next: (datasets) => setState({ status: "ready", datasets }),
      error: (error) => {
        console.error(error);
        setState({ status: "error" });
      },
    });
    return () => subscription.unsubscribe();
  }, []);
  return state;
}
