import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/constants/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/platform")>()),
  isWeb: true,
}));

vi.mock("@/attachments/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/attachments/service")>();
  return {
    ...actual,
    garbageCollectAttachments: vi.fn(async () => undefined),
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { garbageCollectAttachments } from "@/attachments/service";
import {
  applyExternallyPersistedDrafts,
  DRAFT_STORE_STORAGE_KEY,
  flushDraftPersistStorage,
  useDraftStore,
} from ".";
import { DRAFT_STORE_VERSION, type DraftRecord } from "./state";
import { installCrossWindowStoreSync } from "@/stores/cross-window-store-sync";

describe("draft store garbage collection and storage repair", () => {
  beforeEach(async () => {
    await vi.waitFor(() => expect(useDraftStore.persist.hasHydrated()).toBe(true));
    await vi.waitFor(() => expect(garbageCollectAttachments).toHaveBeenCalled());
    await flushDraftPersistStorage();
    await AsyncStorage.clear();
    useDraftStore.setState({ drafts: {}, createModalDraft: null });
    await flushDraftPersistStorage();
    vi.mocked(garbageCollectAttachments).mockClear();
  });

  it("retains an old finalized draft through GC and repairs a stale persisted snapshot", async () => {
    const draftKey = "draft:retained-tombstone";
    const oldTombstone: DraftRecord = {
      input: { text: "", attachments: [] },
      lifecycle: "abandoned",
      updatedAt: Date.now() - 5 * 60_000 - 1,
      version: 3,
    };
    const staleActiveDraft: DraftRecord = {
      input: { text: "stale text", attachments: [] },
      lifecycle: "active",
      updatedAt: oldTombstone.updatedAt - 1,
      version: 2,
    };

    useDraftStore.setState({ drafts: { [draftKey]: oldTombstone }, createModalDraft: null });
    await flushDraftPersistStorage();

    useDraftStore.getState().markDraftLifecycle({ draftKey, lifecycle: "abandoned" });
    await vi.waitFor(() => expect(garbageCollectAttachments).toHaveBeenCalledTimes(1));
    await flushDraftPersistStorage();

    expect(useDraftStore.getState().drafts[draftKey]).toEqual(oldTombstone);

    await AsyncStorage.setItem(
      DRAFT_STORE_STORAGE_KEY,
      JSON.stringify({
        state: { drafts: { [draftKey]: staleActiveDraft }, createModalDraft: null },
        version: DRAFT_STORE_VERSION,
      }),
    );

    await applyExternallyPersistedDrafts();
    await flushDraftPersistStorage();

    expect(useDraftStore.getState().drafts[draftKey]).toEqual(oldTombstone);
    const persisted = JSON.parse((await AsyncStorage.getItem(DRAFT_STORE_STORAGE_KEY)) ?? "null");
    expect(persisted.state.drafts[draftKey]).toEqual(oldTombstone);
  });
  it("reconciles the latest persisted draft after hydration fails", async () => {
    const record: DraftRecord = {
      input: { text: "remote", attachments: [] },
      lifecycle: "active",
      updatedAt: 100,
      version: 1,
    };
    await AsyncStorage.setItem(
      DRAFT_STORE_STORAGE_KEY,
      JSON.stringify({
        state: { drafts: { remote: record }, createModalDraft: null },
        version: DRAFT_STORE_VERSION,
      }),
    );
    const original = useDraftStore.persist.getOptions().storage!;
    let rejectRead: (error: Error) => void = () => {};
    let reads = 0;
    useDraftStore.persist.setOptions({
      storage: {
        ...original,
        getItem: (key) => {
          reads++;
          if (reads === 1) {
            return new Promise((_resolve, reject) => {
              rejectRead = reject;
            });
          }
          if (reads === 2) return Promise.reject(new Error("storage unavailable"));
          return original.getItem(key);
        },
      },
    });
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hydration = useDraftStore.persist.rehydrate();
    const remove = installCrossWindowStoreSync({
      storageKey: DRAFT_STORE_STORAGE_KEY,
      reconcile: applyExternallyPersistedDrafts,
    });
    try {
      expect(useDraftStore.getState().drafts.remote).toBeUndefined();
      rejectRead(new Error("initial read failed"));
      await hydration;
      await vi.waitFor(() => expect(warning).toHaveBeenCalled());
      events.dispatchEvent(Object.assign(new Event("storage"), { key: DRAFT_STORE_STORAGE_KEY }));
      await vi.waitFor(() => expect(useDraftStore.getState().drafts.remote).toEqual(record));
    } finally {
      remove();
      warning.mockRestore();
      vi.unstubAllGlobals();
      useDraftStore.persist.setOptions({ storage: original });
    }
  });
});
