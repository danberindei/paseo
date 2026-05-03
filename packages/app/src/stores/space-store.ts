import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { parseFormPreferences } from "@/create-agent-preferences/preferences";
import type { FormPreferences } from "@/hooks/use-form-preferences";

export interface Space {
  id: string;
  name: string;
  projectIds: string[];
  preferences?: FormPreferences;
}

export interface SpaceStoreState {
  spaces: Space[];
  activeSpaceId: string | null;
  setActiveSpaceId: (id: string | null) => void;
  createSpace: (name: string) => string;
  deleteSpace: (id: string) => void;
  renameSpace: (id: string, name: string) => void;
  addProjectToSpace: (spaceId: string, projectId: string) => void;
  removeProjectFromSpace: (spaceId: string, projectId: string) => void;
  setSpaceProjects: (spaceId: string, projectIds: string[]) => void;
}

function normalizeName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : "New space";
}

function normalizeProjectIds(projectIds: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of projectIds) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPersistedProjectIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return normalizeProjectIds(value.filter((entry): entry is string => typeof entry === "string"));
}

function migrateSpaceStoreState(
  persistedState: unknown,
): Pick<SpaceStoreState, "spaces" | "activeSpaceId"> {
  if (!isRecord(persistedState)) {
    return { spaces: [], activeSpaceId: null };
  }

  const spacesInput = Array.isArray(persistedState.spaces) ? persistedState.spaces : [];
  const spaces: Space[] = [];
  for (const entry of spacesInput) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = trimString(entry.id);
    if (!id) {
      continue;
    }

    const projectIds = readPersistedProjectIds(entry.projectIds ?? entry.projectKeys);
    const preferences =
      entry.preferences === undefined ? undefined : parseFormPreferences(entry.preferences);

    spaces.push({
      id,
      name: normalizeName(trimString(entry.name)),
      projectIds,
      ...(preferences ? { preferences } : {}),
    });
  }

  const activeSpaceId = trimString(persistedState.activeSpaceId) || null;
  return { spaces, activeSpaceId };
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
          spaces: [...state.spaces, { id, name: normalizeName(name), projectIds: [] }],
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
      addProjectToSpace: (spaceId, projectId) => {
        const normalizedProjectId = projectId.trim();
        if (!normalizedProjectId) {
          return;
        }
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId && !space.projectIds.includes(normalizedProjectId)
              ? { ...space, projectIds: [...space.projectIds, normalizedProjectId] }
              : space,
          ),
        }));
      },
      removeProjectFromSpace: (spaceId, projectId) => {
        const normalizedProjectId = projectId.trim();
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId
              ? { ...space, projectIds: removeKey(space.projectIds, normalizedProjectId) }
              : space,
          ),
        }));
      },
      setSpaceProjects: (spaceId, projectIds) => {
        const normalizedProjectIds = normalizeProjectIds(projectIds);
        set((state) => ({
          spaces: state.spaces.map((space) =>
            space.id === spaceId ? { ...space, projectIds: normalizedProjectIds } : space,
          ),
        }));
      },
    }),
    {
      name: "space-store",
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: migrateSpaceStoreState,
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
  // Under an active space, a project we cannot resolve is intentionally treated
  // as not-visible so its notifications are suppressed. Do not "fix" this to
  // return true.
  if (!projectId) {
    return false;
  }
  return activeSpace.projectIds.includes(projectId);
}
