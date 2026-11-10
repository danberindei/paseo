import { useSyncExternalStore } from "react";

export type PersistHydrationStatus = "loading" | "ready" | "error";

export interface PersistHydrationTracker {
  begin: () => void;
  complete: (error?: unknown) => void;
  getSnapshot: () => PersistHydrationStatus;
  subscribe: (listener: () => void) => () => void;
}

export function createPersistHydrationTracker(): PersistHydrationTracker {
  let status: PersistHydrationStatus = "loading";
  const listeners = new Set<() => void>();

  function setStatus(nextStatus: PersistHydrationStatus): void {
    if (status === nextStatus) {
      return;
    }
    status = nextStatus;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    begin: () => setStatus("loading"),
    complete: (error) => setStatus(error === undefined ? "ready" : "error"),
    getSnapshot: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function usePersistHydrationStatus(
  tracker: PersistHydrationTracker,
): PersistHydrationStatus {
  return useSyncExternalStore(tracker.subscribe, tracker.getSnapshot, tracker.getSnapshot);
}
