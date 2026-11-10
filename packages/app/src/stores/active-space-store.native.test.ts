import { afterEach, describe, expect, it, vi } from "vitest";

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorage,
}));

describe("native active space store", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("restores the native active space", async () => {
    asyncStorage.getItem.mockImplementation(async (name: string) => {
      if (name !== "active-space-store") {
        return null;
      }
      return JSON.stringify({ state: { activeSpaceId: "space-saved" }, version: 0 });
    });

    const store = await import("./active-space-store.native");
    await vi.waitFor(() => expect(store.getActiveSpaceStoreHydrationStatus()).toBe("ready"));

    expect(store.useActiveSpaceStore.getState().activeSpaceId).toBe("space-saved");
  });
});
