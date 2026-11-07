import AsyncStorage from "@react-native-async-storage/async-storage";
import { withSpaceStorageLock } from "./storage-lock";
import {
  SpaceSnapshotSchema,
  SpaceStorageError,
  type SpaceMutation,
  type SpaceSnapshot,
  type SpaceStorage,
} from "./types";

/**
 * Durable snapshot key. It is deliberately not the legacy `space-store` key: the
 * zustand persist payload stored there is migrated once through `readLegacy` and
 * then left in place.
 */
export const SPACE_STORAGE_KEY = "space-storage";

export function createAsyncStorageSpaceStorage(
  withLock: typeof withSpaceStorageLock = withSpaceStorageLock,
): SpaceStorage {
  async function read(): Promise<SpaceSnapshot | null> {
    const raw = await AsyncStorage.getItem(SPACE_STORAGE_KEY);
    if (raw === null) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new SpaceStorageError("Space storage holds unreadable data", { cause });
    }
    const result = SpaceSnapshotSchema.safeParse(parsed);
    if (!result.success) {
      throw new SpaceStorageError("Space storage holds an unexpected snapshot", {
        cause: result.error,
      });
    }
    return result.data;
  }

  async function initialize(spaces: SpaceSnapshot["spaces"]): Promise<SpaceSnapshot> {
    return withLock(async () => {
      const existing = await read();
      if (existing) return existing;
      const initial: SpaceSnapshot = { revision: 1, spaces };
      await AsyncStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(initial));
      return initial;
    });
  }

  async function mutate(mutation: SpaceMutation): Promise<SpaceSnapshot> {
    return withLock(async () => {
      const current = await read();
      if (!current) throw new SpaceStorageError("Space storage is missing its initialized state");
      const next: SpaceSnapshot = {
        revision: current.revision + 1,
        spaces: mutation(current.spaces),
      };
      await AsyncStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return { read, initialize, mutate };
}
