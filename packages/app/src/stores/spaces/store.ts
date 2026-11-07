import { create } from "zustand";
import { createPersistHydrationTracker } from "@/stores/persist-hydration";
import {
  normalizeName,
  readLegacySpaces,
  SpaceStorageError,
  type Space,
  type SpaceMutation,
  type SpaceSnapshot,
  type SpaceStorage,
} from "./types";

export interface SpaceStoreState {
  spaces: Space[];
  createSpace(name: string): Promise<string>;
  deleteSpace(id: string): Promise<void>;
  renameSpace(id: string, name: string): Promise<void>;
  addProjectToSpace(spaceId: string, projectIds: string | string[]): Promise<void>;
  removeProjectFromSpace(spaceId: string, projectIds: string | string[]): Promise<void>;
}

interface SpaceStoreOptions {
  storage: SpaceStorage;
  readLegacy(): Promise<string | null>;
  onDeleted(id: string): void;
}

export function createSpaceStore(options: SpaceStoreOptions) {
  const hydration = createPersistHydrationTracker();
  let initialization: Promise<SpaceSnapshot> | null = null;
  let revision = -1;

  async function initialize(): Promise<SpaceSnapshot> {
    initialization ??= (async () => {
      const current = await options.storage.read();
      if (current) return current;
      const legacy = readLegacySpaces(await options.readLegacy());
      // Initialization and its marker commit together, including an empty import.
      return options.storage.initialize(legacy);
    })();
    try {
      return await initialization;
    } catch (error) {
      initialization = null;
      throw error;
    }
  }

  function apply(snapshot: SpaceSnapshot): void {
    // A refresh started before a mutation can finish after that mutation commits.
    if (snapshot.revision <= revision) return;
    revision = snapshot.revision;
    const previous = store.getState().spaces;
    store.setState({ spaces: snapshot.spaces });
    for (const space of previous) {
      if (!snapshot.spaces.some((current) => current.id === space.id)) options.onDeleted(space.id);
    }
  }

  async function hydrate(): Promise<void> {
    if (hydration.getSnapshot() !== "ready") hydration.begin();
    try {
      await initialize();
      const snapshot = await options.storage.read();
      if (!snapshot) throw new SpaceStorageError("Space storage is missing its initialized state");
      apply(snapshot);
      hydration.complete();
    } catch (error) {
      // A usable snapshot must stay available when a background refresh fails.
      if (hydration.getSnapshot() !== "ready") hydration.complete(error);
    }
  }

  async function mutate(mutation: SpaceMutation): Promise<void> {
    let snapshot: SpaceSnapshot;
    try {
      await initialize();
      snapshot = await options.storage.mutate(mutation);
    } catch (error) {
      throw new SpaceStorageError("Could not save Space changes", { cause: error });
    }
    apply(snapshot);
    hydration.complete();
  }

  async function updateSpace(id: string, update: (space: Space) => Space): Promise<void> {
    await mutate((spaces) => {
      if (!spaces.some((space) => space.id === id))
        throw new SpaceStorageError(`Space ${id} no longer exists`);
      return spaces.map((space) => (space.id === id ? update(space) : space));
    });
  }

  function projectIds(input: string | string[]): string[] {
    const values = typeof input === "string" ? [input] : input;
    return values.map((id) => id.trim()).filter(Boolean);
  }

  const store = create<SpaceStoreState>(() => ({
    spaces: [],
    createSpace: async (name) => {
      const id =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await mutate((spaces) => [...spaces, { id, name: normalizeName(name), projectIds: [] }]);
      return id;
    },
    deleteSpace: async (id) => {
      await mutate((spaces) => spaces.filter((space) => space.id !== id));
    },
    renameSpace: (id, name) =>
      updateSpace(id, (space) => ({ ...space, name: normalizeName(name) })),
    addProjectToSpace: (id, input) =>
      updateSpace(id, (space) => ({
        ...space,
        projectIds: [...new Set([...space.projectIds, ...projectIds(input)])],
      })),
    removeProjectFromSpace: (id, input) =>
      updateSpace(id, (space) => ({
        ...space,
        projectIds: space.projectIds.filter((projectId) => !projectIds(input).includes(projectId)),
      })),
  }));
  return Object.assign(store, { hydration, hydrate });
}
