import type { StateCreator } from "zustand";

export interface ActiveSpaceStoreState {
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
}

export const createActiveSpaceState: StateCreator<ActiveSpaceStoreState> = (set) => ({
  activeSpaceId: null,
  setActiveSpaceId: (id) => set({ activeSpaceId: id }),
});
