import { describe, expect, it, vi } from "vitest";
vi.mock("@/constants/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/platform")>()),
  isWeb: true,
}));
import type { StateStorage } from "zustand/middleware";
import {
  createWorkspaceLayoutReconciler,
  installCrossWindowStoreSync,
  mergeExternallyPersistedWorkspaceLayoutState,
} from "@/stores/cross-window-store-sync";
import {
  createWorkspaceLayoutStore,
  WORKSPACE_LAYOUT_STORE_STORAGE_KEY,
  partializeWorkspaceLayoutState,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import type { WorkspaceLayoutIdSource } from "@/stores/workspace-layout-ids";
import { createHydrationSettlement } from "@/stores/hydration-settlement";

it("waits for the latest overlapping hydration attempt", async () => {
  const hydration = createHydrationSettlement();
  hydration.start();
  let settled = false;
  const waiting = hydration.wait().then(() => {
    settled = true;
    return undefined;
  });
  const finishLatest = hydration.start();
  await Promise.resolve();
  expect(settled).toBe(false);
  finishLatest();
  await waiting;
  expect(settled).toBe(true);
});

describe("cross-window listener installation", () => {
  it("runs a queued draft reconciliation after a failure", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectFirst: (error: Error) => void = () => {};
    const reconcile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const remove = installCrossWindowStoreSync({ storageKey: "test-drafts", reconcile });
    try {
      events.dispatchEvent(Object.assign(new Event("storage"), { key: "test-drafts" }));
      rejectFirst(new Error("read failed"));
      await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
      expect(warning).toHaveBeenCalled();
    } finally {
      remove();
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("reconciles missed writes on installation and reinstallation", async () => {
    const events = new EventTarget();
    vi.stubGlobal("window", events);
    const remote = createWorkspaceLayoutStore();
    await Promise.all([remote.persist.rehydrate(), useWorkspaceLayoutStore.persist.rehydrate()]);
    const storage = useWorkspaceLayoutStore.persist.getOptions().storage!;
    const draft = { storageKey: "test-drafts", reconcile: vi.fn(async () => {}) };
    try {
      remote.setState({ explorerSidebarWidthByWorkspace: { startup: 300 } });
      await storage.setItem(WORKSPACE_LAYOUT_STORE_STORAGE_KEY, {
        state: remote.getState().getSyncSnapshot(),
        version: useWorkspaceLayoutStore.persist.getOptions().version,
      });
      const remove = installCrossWindowStoreSync(draft);
      await vi.waitFor(() => {
        expect(useWorkspaceLayoutStore.getState().explorerSidebarWidthByWorkspace.startup).toBe(
          300,
        );
        expect(draft.reconcile).toHaveBeenCalledTimes(1);
      });
      remove();
      remote.setState({ explorerSidebarWidthByWorkspace: { startup: 400 } });
      await storage.setItem(WORKSPACE_LAYOUT_STORE_STORAGE_KEY, {
        state: remote.getState().getSyncSnapshot(),
        version: useWorkspaceLayoutStore.persist.getOptions().version,
      });
      const removeAgain = installCrossWindowStoreSync(draft);
      await vi.waitFor(() => {
        expect(useWorkspaceLayoutStore.getState().explorerSidebarWidthByWorkspace.startup).toBe(
          400,
        );
        expect(draft.reconcile).toHaveBeenCalledTimes(2);
      });
      removeAgain();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("cross-window live workspace layouts", () => {
  it.each([{ kind: "commit_diff", sha: "abc123" } as const, { kind: "new_tab" } as const])(
    "preserves a focused $kind tab when another workspace changes",
    (target) => {
      let nextId = 0;
      const ids: WorkspaceLayoutIdSource = {
        createNodeId: (prefix) => `${prefix}_${nextId++}`,
        createFocusRestorationToken: () => `focus_${nextId++}`,
      };
      const store = createWorkspaceLayoutStore(ids);
      store.getState().openTab({
        workspaceKey: "server:local",
        target: { kind: "agent", agentId: "local-agent" },
        intent: "new",
      });
      const tabId = store.getState().openTab({
        workspaceKey: "server:local",
        target,
        intent: "new",
      });
      const currentState = store.getState();
      const ours = partializeWorkspaceLayoutState(currentState);
      const remote = createWorkspaceLayoutStore(ids);
      remote.getState().openTab({
        workspaceKey: "server:remote",
        target: { kind: "agent", agentId: "remote-agent" },
        intent: "new",
      });
      const theirs = partializeWorkspaceLayoutState(remote.getState());
      const chosen = {
        ...ours,
        layoutByWorkspace: { ...ours.layoutByWorkspace, ...theirs.layoutByWorkspace },
      };

      const merged = mergeExternallyPersistedWorkspaceLayoutState({
        chosen,
        currentState,
        ids,
      });
      const localLayout = merged.layoutByWorkspace["server:local"];

      expect(localLayout).toBe(currentState.layoutByWorkspace["server:local"]);
      expect(collectAllTabs(localLayout.root).find((tab) => tab.tabId === tabId)?.target).toEqual(
        target,
      );
      expect(
        collectAllTabs(merged.layoutByWorkspace["server:remote"].root).map((tab) => tab.target),
      ).toEqual([
        { kind: "agent", agentId: "remote-agent" },
        { kind: "files" },
        { kind: "changes_tree" },
      ]);
    },
  );
});

describe("cross-window workspace layout persistence", () => {
  function setupStorage() {
    const values = new Map<string, string>();
    const storage: StateStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    return { values, storage };
  }

  it("reconciles after initial hydration fails and preserves a local edit", async () => {
    const { storage } = setupStorage();
    let rejectRead: (error: Error) => void = () => {};
    let first = true;
    const failingStorage: StateStorage = {
      ...storage,
      getItem: (key) => {
        if (first) {
          first = false;
          return new Promise((_resolve, reject) => {
            rejectRead = reject;
          });
        }
        return storage.getItem(key);
      },
    };
    const local = createWorkspaceLayoutStore(undefined, failingStorage);
    const remote = createWorkspaceLayoutStore(undefined, storage);
    await remote.persist.rehydrate();
    remote.setState({ explorerSidebarWidthByWorkspace: { remote: 300 } });
    const reconcile = createWorkspaceLayoutReconciler(local);
    const pending = reconcile();
    rejectRead(new Error("initial read failed"));
    await pending;
    local.setState({ pinnedAgentIdsByWorkspace: { local: new Set(["agent"]) } });
    remote.setState({ explorerSidebarWidthByWorkspace: { remote: 400 } });
    await reconcile();
    expect(local.getState().explorerSidebarWidthByWorkspace.remote).toBe(400);
    expect([...local.getState().pinnedAgentIdsByWorkspace.local]).toEqual(["agent"]);
  });

  it.each([false, true])(
    "repairs stale independent changes and propagates later edits (reverse: %s)",
    async (reverse) => {
      const { values, storage } = setupStorage();
      const a = createWorkspaceLayoutStore(undefined, storage);
      const b = createWorkspaceLayoutStore(undefined, storage);
      await Promise.all([a.persist.rehydrate(), b.persist.rehydrate()]);
      const first = reverse ? b : a;
      const second = reverse ? a : b;
      const reconcileFirst = createWorkspaceLayoutReconciler(first);
      const reconcileSecond = createWorkspaceLayoutReconciler(second);

      first.setState({ explorerSidebarWidthByWorkspace: { ws: 300, other: 500 } });
      second.setState({ pinnedAgentIdsByWorkspace: { ws: new Set(["agent"]) } });
      await reconcileFirst();
      await reconcileSecond();
      await reconcileFirst();
      for (const store of [first, second]) {
        expect(store.getState().explorerSidebarWidthByWorkspace).toEqual({ ws: 300, other: 500 });
        expect([...store.getState().pinnedAgentIdsByWorkspace.ws]).toEqual(["agent"]);
      }
      let saved = JSON.parse(values.get(WORKSPACE_LAYOUT_STORE_STORAGE_KEY)!).state;
      expect(saved.explorerSidebarWidthByWorkspace).toEqual({ ws: 300, other: 500 });
      expect(saved.pinnedAgentIdsByWorkspace).toEqual({ ws: ["agent"] });

      second.setState({ explorerSidebarWidthByWorkspace: { ws: 400, other: 500 } });
      await reconcileFirst();
      expect(first.getState().explorerSidebarWidthByWorkspace.ws).toBe(400);

      first.setState({
        explorerSidebarWidthByWorkspace: { ws: 400 },
        explorerSidebarPaneIdByWorkspace: { ws: null },
      });
      second.setState({ pinnedAgentIdsByWorkspace: { ws: new Set(["another"]) } });
      await reconcileFirst();
      await reconcileSecond();
      await reconcileFirst();
      for (const store of [first, second]) {
        expect(store.getState().explorerSidebarWidthByWorkspace).toEqual({ ws: 400 });
        expect(store.getState().explorerSidebarPaneIdByWorkspace).toEqual({ ws: null });
        expect([...store.getState().pinnedAgentIdsByWorkspace.ws]).toEqual(["another"]);
      }
      saved = JSON.parse(values.get(WORKSPACE_LAYOUT_STORE_STORAGE_KEY)!).state;
      expect(saved.explorerSidebarWidthByWorkspace).toEqual({ ws: 400 });
      expect(saved.explorerPaneIdByWorkspace).toEqual({ ws: null });
      expect(saved.pinnedAgentIdsByWorkspace).toEqual({ ws: ["another"] });
      reconcileFirst.dispose();
      reconcileSecond.dispose();
    },
  );
  it("preserves local edits made while a snapshot is being read", async () => {
    const { storage } = setupStorage();
    let release: (() => void) | undefined;
    let delay = false;
    const delayedStorage: StateStorage = {
      ...storage,
      getItem: async (key) => {
        const value = await storage.getItem(key);
        if (delay)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return value;
      },
    };
    const local = createWorkspaceLayoutStore(undefined, delayedStorage);
    const remote = createWorkspaceLayoutStore(undefined, storage);
    await Promise.all([local.persist.rehydrate(), remote.persist.rehydrate()]);
    remote.setState({ explorerSidebarWidthByWorkspace: { remote: 300 } });
    delay = true;
    const pending = createWorkspaceLayoutReconciler(local)();
    await vi.waitFor(() => expect(release).toBeDefined());
    local.setState({ pinnedAgentIdsByWorkspace: { local: new Set(["agent"]) } });
    release!();
    await pending;
    expect(local.getState().explorerSidebarWidthByWorkspace).toEqual({ remote: 300 });
    expect([...local.getState().pinnedAgentIdsByWorkspace.local]).toEqual(["agent"]);
    const saved = JSON.parse((await storage.getItem(WORKSPACE_LAYOUT_STORE_STORAGE_KEY))!);
    expect(saved.state.pinnedAgentIdsByWorkspace).toEqual({ local: ["agent"] });
    expect(saved.state.explorerSidebarWidthByWorkspace).toEqual({ remote: 300 });
  });
  it("converges after restoring a live layout and keeps later edits", async () => {
    const { values, storage } = setupStorage();
    const local = createWorkspaceLayoutStore(undefined, storage);
    const remote = createWorkspaceLayoutStore(undefined, storage);
    await Promise.all([local.persist.rehydrate(), remote.persist.rehydrate()]);
    remote.getState().openTab({
      workspaceKey: "server:remote",
      target: { kind: "agent", agentId: "agent" },
      intent: "new",
    });
    const reconcileLocal = createWorkspaceLayoutReconciler(local);
    const reconcileRemote = createWorkspaceLayoutReconciler(remote);
    await reconcileLocal();
    await reconcileRemote();
    await reconcileLocal();
    await reconcileRemote();
    const settled = values.get(WORKSPACE_LAYOUT_STORE_STORAGE_KEY);
    await reconcileLocal();
    await reconcileRemote();
    expect(values.get(WORKSPACE_LAYOUT_STORE_STORAGE_KEY)).toBe(settled);
    local.setState({ explorerSidebarWidthByWorkspace: { "server:remote": 420 } });
    await reconcileRemote();
    expect(remote.getState().explorerSidebarWidthByWorkspace["server:remote"]).toBe(420);
  });
});
