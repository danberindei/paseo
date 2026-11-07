import AsyncStorage from "@react-native-async-storage/async-storage";
import { useActiveSpaceStore } from "@/stores/active-space-store";
import { type PersistHydrationStatus, usePersistHydrationStatus } from "@/stores/persist-hydration";
import { createAsyncStorageSpaceStorage, SPACE_STORAGE_KEY } from "./spaces/storage-async-storage";
import { createSpaceStore } from "./spaces/store";
import type { Space } from "./spaces/types";

/** Key written by the zustand persist middleware before spaces moved to `SPACE_STORAGE_KEY`. */
export const LEGACY_SPACE_STORE_KEY = "space-store";

export { SPACE_STORAGE_KEY };
export type { Space } from "./spaces/types";
export type { SpaceStoreState } from "./spaces/store";

export const useSpaceStore = createSpaceStore({
  storage: createAsyncStorageSpaceStorage(),
  readLegacy: () => AsyncStorage.getItem(LEGACY_SPACE_STORE_KEY),
  onDeleted: (id) => {
    const active = useActiveSpaceStore.getState();
    if (active.activeSpaceId === id) active.setActiveSpaceId(null);
  },
});

void useSpaceStore.hydrate();

export function useSpaceStoreHydrationStatus(): PersistHydrationStatus {
  return usePersistHydrationStatus(useSpaceStore.hydration);
}

export function getSpaceStoreHydrationStatus(): PersistHydrationStatus {
  return useSpaceStore.hydration.getSnapshot();
}

export async function retrySpaceStoreHydration(): Promise<void> {
  await useSpaceStore.hydrate();
}

function findActiveSpace(spaces: Space[], activeSpaceId: string | null): Space | null {
  if (!activeSpaceId) {
    return null;
  }
  return spaces.find((space) => space.id === activeSpaceId) ?? null;
}

export function useActiveSpace(): Space | null {
  const spaces = useSpaceStore((state) => state.spaces);
  const activeSpaceId = useActiveSpaceStore((state) => state.activeSpaceId);
  return findActiveSpace(spaces, activeSpaceId);
}

export function getActiveSpace(): Space | null {
  return findActiveSpace(
    useSpaceStore.getState().spaces,
    useActiveSpaceStore.getState().activeSpaceId,
  );
}

export function isProjectVisibleInActiveSpace(projectId: string | null): boolean {
  const { activeSpaceId } = useActiveSpaceStore.getState();
  if (activeSpaceId === null) {
    return true;
  }
  const activeSpace = useSpaceStore.getState().spaces.find((space) => space.id === activeSpaceId);
  if (!activeSpace) {
    return false;
  }
  // Under an active space, a project we cannot resolve is intentionally treated
  // as not-visible so its notifications are suppressed. Do not "fix" this to
  // return true.
  if (!projectId) {
    return false;
  }
  return activeSpace.projectIds.includes(projectId);
}
