import { afterEach, describe, expect, it, vi } from "vitest";

const asyncStorage = vi.hoisted(() => {
  const values = new Map<string, string>();
  const control: {
    delayNextRead: ((resolve: (value: string | null) => void) => void) | null;
    failNextRead: boolean;
  } = { delayNextRead: null, failNextRead: false };
  return {
    control,
    api: {
      getItem: (key: string): Promise<string | null> => {
        if (control.failNextRead) {
          control.failNextRead = false;
          return Promise.reject(new Error("read failed"));
        }
        const delay = control.delayNextRead;
        if (delay) {
          control.delayNextRead = null;
          return new Promise<string | null>((resolve) => delay(resolve));
        }
        return Promise.resolve(values.get(key) ?? null);
      },
      setItem: (key: string, value: string): Promise<void> => {
        values.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string): Promise<void> => {
        values.delete(key);
        return Promise.resolve();
      },
      clear: (): Promise<void> => {
        values.clear();
        return Promise.resolve();
      },
    },
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorage.api,
}));

describe("space store hydration", () => {
  afterEach(() => {
    vi.resetModules();
    void asyncStorage.api.clear();
    asyncStorage.control.delayNextRead = null;
    asyncStorage.control.failNextRead = false;
  });

  it("does not become available before persisted spaces load", async () => {
    let finishRead: (value: string | null) => void = () => {};
    asyncStorage.control.delayNextRead = (resolve) => {
      finishRead = resolve;
    };

    const store = await import("./space-store");

    expect(store.getSpaceStoreHydrationStatus()).toBe("loading");

    finishRead(null);
    await vi.waitFor(() => expect(store.getSpaceStoreHydrationStatus()).toBe("ready"));
  });

  it("reports a failed read and becomes available after retry", async () => {
    asyncStorage.control.failNextRead = true;
    const store = await import("./space-store");

    await vi.waitFor(() => expect(store.getSpaceStoreHydrationStatus()).toBe("error"));

    await store.retrySpaceStoreHydration();

    expect(store.getSpaceStoreHydrationStatus()).toBe("ready");
  });
});
