import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { createAsyncStorageSpaceStorage, SPACE_STORAGE_KEY } from "./storage-async-storage";
import { withSpaceStorageLock } from "./storage-lock-queue";
import { requestSpaceStorageLock } from "./storage-lock.web";
import { SpaceStorageError, type Space } from "./types";

function createStorage() {
  return createAsyncStorageSpaceStorage(withSpaceStorageLock);
}

const work: Space = { id: "work", name: "Work", projectIds: ["old"] };

function rename(spaces: Space[]): Space[] {
  return spaces.map((space) => ({ ...space, name: "Renamed" }));
}

function clearProjects(spaces: Space[]): Space[] {
  return spaces.map((space) => ({ ...space, projectIds: [] }));
}

async function readStored(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(SPACE_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("AsyncStorage Space storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("initializes the snapshot once and keeps the first window's import", async () => {
    const first = createStorage();
    const second = createStorage();

    expect(await first.initialize([work])).toEqual({ revision: 1, spaces: [work] });
    expect(await second.initialize([])).toEqual({ revision: 1, spaces: [work] });
  });

  it("returns the same initial snapshot to concurrent initializers", async () => {
    const first = createStorage();
    const second = createStorage();
    const [one, two] = await Promise.all([first.initialize([work]), second.initialize([])]);
    expect(one).toEqual(two);
    expect(await first.read()).toEqual(one);
  });

  it("releases the native queue after an operation fails", async () => {
    await expect(
      withSpaceStorageLock(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(withSpaceStorageLock(async () => "saved")).resolves.toBe("saved");
  });

  it("requires the named Web Lock before writing", async () => {
    const names: string[] = [];
    const locks = {
      request: async (name: string, callback: (lock: Lock) => unknown) => {
        names.push(name);
        return callback({ name, mode: "exclusive" });
      },
    } as Pick<LockManager, "request">;
    await expect(requestSpaceStorageLock(locks, async () => "saved")).resolves.toBe("saved");
    expect(names).toEqual(["space-storage"]);
    await expect(requestSpaceStorageLock(undefined, async () => "saved")).rejects.toThrow(
      "Space storage requires Web Locks",
    );
  });

  it("reads back nothing before initialization", async () => {
    expect(await createStorage().read()).toBeNull();
  });

  it("commits each mutation under a new revision", async () => {
    const storage = createStorage();
    await storage.initialize([work]);

    const first = await storage.mutate(rename);
    const second = await storage.mutate(clearProjects);

    expect(first.revision).toBe(2);
    expect(second.revision).toBe(3);
    expect(await readStored()).toEqual({
      revision: 3,
      spaces: [{ id: "work", name: "Renamed", projectIds: [] }],
    });
  });

  it("keeps both changes when two windows mutate at the same time", async () => {
    const first = createStorage();
    const second = createStorage();
    await first.initialize([work]);
    await second.read();

    await Promise.all([
      first.mutate((spaces) => [...spaces, { id: "first", name: "First", projectIds: [] }]),
      second.mutate((spaces) => [...spaces, { id: "second", name: "Second", projectIds: [] }]),
    ]);

    const stored = await first.read();
    expect(stored?.spaces.map((space) => space.id).sort()).toEqual(["first", "second", "work"]);
  });

  it("refuses to mutate before initialization", async () => {
    await expect(createStorage().mutate((spaces) => spaces)).rejects.toBeInstanceOf(
      SpaceStorageError,
    );
  });

  it("refuses a snapshot it cannot parse", async () => {
    await AsyncStorage.setItem(SPACE_STORAGE_KEY, "not json");
    const storage = createStorage();

    await expect(storage.read()).rejects.toBeInstanceOf(SpaceStorageError);
    await expect(storage.mutate((spaces) => spaces)).rejects.toBeInstanceOf(SpaceStorageError);
  });
});
