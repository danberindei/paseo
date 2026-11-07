import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsyncStorageSpaceStorage } from "./storage-async-storage";
import { withSpaceStorageLock } from "./storage-lock-queue";
import { createSpaceStore } from "./store";
import type { Space, SpaceSnapshot, SpaceStorage } from "./types";

const legacy = JSON.stringify({
  state: { spaces: [{ id: "work", name: "Work", projectKeys: ["old"] }] },
  version: 1,
});

function byId(spaces: readonly Space[]): Space[] {
  return [...spaces].sort((left, right) => left.id.localeCompare(right.id));
}

function createWindows() {
  const deleted: string[] = [];
  // Two stores over one AsyncStorage key behave like two windows on the same origin:
  // they share the stored snapshot and only ever touch it through a read and write.
  const storage = createAsyncStorageSpaceStorage(withSpaceStorageLock);
  const first = createSpaceStore({
    storage: createAsyncStorageSpaceStorage(withSpaceStorageLock),
    readLegacy: async () => legacy,
    onDeleted: (id) => deleted.push(id),
  });
  const second = createSpaceStore({
    storage: createAsyncStorageSpaceStorage(withSpaceStorageLock),
    readLegacy: async () => legacy,
    onDeleted: (id) => deleted.push(id),
  });
  return { first, second, storage, deleted };
}

describe("Space mutations across windows", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("preserves concurrent creates, renames and memberships from stale windows", async () => {
    const { first, second } = createWindows();
    await Promise.all([first.hydrate(), second.hydrate()]);
    const [firstId, secondId] = await Promise.all([
      first.getState().createSpace("First"),
      second.getState().createSpace("Second"),
    ]);
    await Promise.all([
      first.getState().renameSpace("work", "Renamed"),
      second.getState().addProjectToSpace("work", ["new", "other", "new"]),
    ]);
    await Promise.all([first.hydrate(), second.hydrate()]);
    const expected = [
      { id: "work", name: "Renamed", projectIds: ["old", "new", "other"] },
      { id: firstId, name: "First", projectIds: [] },
      { id: secondId, name: "Second", projectIds: [] },
    ];
    // Concurrent creates commit in whichever order wins the write, so only the set is fixed.
    expect(byId(first.getState().spaces)).toEqual(byId(expected));
    expect(byId(second.getState().spaces)).toEqual(byId(expected));
  });

  it("does not resurrect a deleted space when another window edits it", async () => {
    const { first, second, deleted } = createWindows();
    await Promise.all([first.hydrate(), second.hydrate()]);
    await first.getState().deleteSpace("work");
    await expect(second.getState().renameSpace("work", "Stale rename")).rejects.toThrow(
      "Could not save Space changes",
    );
    await second.hydrate();
    expect(second.getState().spaces).toEqual([]);
    expect(deleted).toContain("work");
  });

  it("does not apply a failed mutation and can retry it", async () => {
    const { storage } = createWindows();
    let fail = true;
    const fallible: SpaceStorage = {
      read: storage.read,
      initialize: storage.initialize,
      mutate: (mutation) => {
        if (fail) return Promise.reject(new Error("Disk full"));
        return storage.mutate(mutation);
      },
    };
    const store = createSpaceStore({
      storage: fallible,
      readLegacy: async () => null,
      onDeleted: () => {},
    });
    await store.hydrate();
    await expect(store.getState().createSpace("Work")).rejects.toThrow(
      "Could not save Space changes",
    );
    expect(store.getState().spaces).toEqual([]);
    fail = false;
    const id = await store.getState().createSpace("Work");
    expect(store.getState().spaces).toEqual([{ id, name: "Work", projectIds: [] }]);
  });

  it("ignores a delayed refresh that predates a committed mutation", async () => {
    const { storage } = createWindows();
    let finishRead: ((snapshot: SpaceSnapshot | null) => void) | null = null;
    let delayRead = false;
    const delayed: SpaceStorage = {
      ...storage,
      read: () => {
        if (!delayRead) return storage.read();
        return new Promise((resolve) => {
          finishRead = resolve;
        });
      },
    };
    const store = createSpaceStore({
      storage: delayed,
      readLegacy: async () => null,
      onDeleted: () => {},
    });
    await store.hydrate();
    delayRead = true;
    const refresh = store.hydrate();
    const id = await store.getState().createSpace("Committed");
    if (!finishRead) throw new Error("Refresh did not start");
    const finish: (snapshot: SpaceSnapshot | null) => void = finishRead;
    finish({ revision: 0, spaces: [] });
    await refresh;
    expect(store.getState().spaces).toEqual([{ id, name: "Committed", projectIds: [] }]);
  });

  it("keeps loaded spaces available after a refresh fails and applies the next refresh", async () => {
    const { storage } = createWindows();
    let failRead = false;
    const store = createSpaceStore({
      storage: {
        ...storage,
        read: () => {
          if (failRead) return Promise.reject(new Error("Read failed"));
          return storage.read();
        },
      },
      readLegacy: async () => null,
      onDeleted: () => {},
    });
    await store.hydrate();
    const id = await store.getState().createSpace("Work");

    failRead = true;
    await store.hydrate();

    expect(store.hydration.getSnapshot()).toBe("ready");
    expect(store.getState().spaces).toEqual([{ id, name: "Work", projectIds: [] }]);

    failRead = false;
    await storage.mutate(() => [{ id, name: "Renamed", projectIds: [] }]);
    await store.hydrate();

    expect(store.hydration.getSnapshot()).toBe("ready");
    expect(store.getState().spaces).toEqual([{ id, name: "Renamed", projectIds: [] }]);
  });
});
