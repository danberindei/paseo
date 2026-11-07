import { SpaceStorageError } from "./types";

export function requestSpaceStorageLock<T>(
  locks: Pick<LockManager, "request"> | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!locks) {
    return Promise.reject(new SpaceStorageError("Space storage requires Web Locks"));
  }
  return locks.request("space-storage", operation);
}

export function withSpaceStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  return requestSpaceStorageLock(
    typeof navigator === "undefined" ? undefined : navigator.locks,
    operation,
  );
}
