import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FormPreferences } from "@/hooks/use-form-preferences";

export interface Space {
  id: string;
  name: string;
  projectKeys: string[];
  preferences?: FormPreferences;
}

export interface SpaceStoreState {
  spaces: Space[];
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
  createSpace: (name: string) => string;
  deleteSpace: (id: string) => void;
  renameSpace: (id: string, name: string) => void;
  addProjectToSpace: (spaceId: string, projectKey: string) => void;
  removeProjectFromSpace: (spaceId: string, projectKey: string) => void;
  setSpaceProjects: (spaceId: string, projectKeys: string[]) => void;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "New space";
}

function normalizeProjectKeys(projectKeys: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of projectKeys) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function removeKey(keys: string[], key: string): string[] {
  return keys.filter((candidate) => candidate !== key);
}

function generateSpaceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useSpaceStore = create<SpaceStoreState>()(
  persist(
    (set) => ({
      spaces: [],
      activeSpaceId: null,
      setActiveSpaceId: (id) => set({ activeSpaceId: id }),
      createSpace: (name) => {
        const id = generateSpaceId();
        set((state) => ({
          spaces: [...state.spaces, { id, name: normalizeName(name), projectKeys: [] }],
        }));
        return id;
      },
      deleteSpace: (id) =>
        set((state) => ({
          spaces: state.spaces.filter((space) => space.id !== id),
          activeSpaceId: state.activeSpaceId === id ? null : state.activeSpaceId,
        })),
      renameSpace: (id, name) =>
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === id ? { ...space, name: normalizeName(name) } : space,
          ),
        })),
      addProjectToSpace: (spaceId, projectKey) => {
        const normalizedProjectKey = projectKey.trim();
        if (!normalizedProjectKey) {
          return;
        }
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId && !space.projectKeys.includes(normalizedProjectKey)
              ? { ...space, projectKeys: [...space.projectKeys, normalizedProjectKey] }
              : space,
          ),
        }));
      },
      removeProjectFromSpace: (spaceId, projectKey) => {
        const normalizedProjectKey = projectKey.trim();
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId
              ? { ...space, projectKeys: removeKey(space.projectKeys, normalizedProjectKey) }
              : space,
          ),
        }));
      },
      setSpaceProjects: (spaceId, projectKeys) => {
        const normalizedProjectKeys = normalizeProjectKeys(projectKeys);
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId ? { ...space, projectKeys: normalizedProjectKeys } : space,
          ),
        }));
      },
    }),
    {
      name: "space-store",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        spaces: state.spaces,
        activeSpaceId: state.activeSpaceId,
      }),
    },
  ),
);

export function selectActiveSpace(
  state: Pick<SpaceStoreState, "spaces" | "activeSpaceId">,
): Space | null {
  if (!state.activeSpaceId) {
    return null;
  }
  return state.spaces.find((space) => space.id === state.activeSpaceId) ?? null;
}

export function isProjectVisibleInActiveSpace(projectId: string | null): boolean {
  const { spaces, activeSpaceId } = useSpaceStore.getState();
  if (activeSpaceId === null) {
    return true;
  }
  const activeSpace = spaces.find((space) => space.id === activeSpaceId);
  if (!activeSpace) {
    return false;
  }
  if (!projectId) {
    return false;
  }
  return activeSpace.projectKeys.includes(projectId);
}
