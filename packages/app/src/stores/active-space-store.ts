import { create } from "zustand";
import { createActiveSpaceState, type ActiveSpaceStoreState } from "@/stores/active-space-state";
import type { PersistHydrationStatus } from "@/stores/persist-hydration";

export type { ActiveSpaceStoreState } from "@/stores/active-space-state";

// Per-window (Electron) / per-tab (web) value, intentionally not persisted.
// On desktop each window is seeded from its launch arg (useInitialSpaceId).
// On web it starts null on every load and only changes through user selection.
export const useActiveSpaceStore = create<ActiveSpaceStoreState>()(createActiveSpaceState);

export function useActiveSpaceStoreHydrationStatus(): PersistHydrationStatus {
  return "ready";
}

export function retryActiveSpaceStoreHydration(): Promise<void> {
  return Promise.resolve();
}
