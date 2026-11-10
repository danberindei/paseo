import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createActiveSpaceState, type ActiveSpaceStoreState } from "@/stores/active-space-state";
import {
  createPersistHydrationTracker,
  type PersistHydrationStatus,
  usePersistHydrationStatus,
} from "@/stores/persist-hydration";

export type { ActiveSpaceStoreState } from "@/stores/active-space-state";

const ACTIVE_SPACE_STORAGE_KEY = "active-space-store";

const hydrationTracker = createPersistHydrationTracker();

export const useActiveSpaceStore = create<ActiveSpaceStoreState>()(
  persist(createActiveSpaceState, {
    name: ACTIVE_SPACE_STORAGE_KEY,
    storage: createJSONStorage(() => AsyncStorage),
    partialize: (state) => ({ activeSpaceId: state.activeSpaceId }),
    onRehydrateStorage: () => {
      hydrationTracker.begin();
      return (_state, error) => hydrationTracker.complete(error);
    },
  }),
);

export function useActiveSpaceStoreHydrationStatus(): PersistHydrationStatus {
  return usePersistHydrationStatus(hydrationTracker);
}

export function getActiveSpaceStoreHydrationStatus(): PersistHydrationStatus {
  return hydrationTracker.getSnapshot();
}

export async function retryActiveSpaceStoreHydration(): Promise<void> {
  await useActiveSpaceStore.persist.rehydrate();
}
