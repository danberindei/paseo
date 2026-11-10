import { afterEach, describe, expect, it, vi } from "vitest";

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorage,
}));

describe("space store hydration", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not become available before persisted spaces load", async () => {
    let finishRead: (value: string | null) => void = () => {};
    asyncStorage.getItem.mockReturnValue(
      new Promise<string | null>((resolve) => {
        finishRead = resolve;
      }),
    );

    const store = await import("./space-store");

    expect(store.getSpaceStoreHydrationStatus()).toBe("loading");

    finishRead(null);
    await vi.waitFor(() => expect(store.getSpaceStoreHydrationStatus()).toBe("ready"));
  });

  it("reports a failed read and becomes available after retry", async () => {
    asyncStorage.getItem.mockRejectedValueOnce(new Error("read failed"));
    const store = await import("./space-store");

    await vi.waitFor(() => expect(store.getSpaceStoreHydrationStatus()).toBe("error"));

    asyncStorage.getItem.mockResolvedValueOnce(null);
    await store.retrySpaceStoreHydration();

    expect(store.getSpaceStoreHydrationStatus()).toBe("ready");
  });
});
