let pending: Promise<void> = Promise.resolve();

export function withSpaceStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
