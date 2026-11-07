import {
  defaultWorkspaceLayoutIds,
  type WorkspaceLayoutIdSource,
} from "@/stores/workspace-layout-ids";
import {
  type createWorkspaceLayoutStore,
  partializeWorkspaceLayoutState,
  mergeWorkspaceLayoutPersistedState,
  useWorkspaceLayoutStore,
  WORKSPACE_LAYOUT_STORE_STORAGE_KEY,
  type WorkspaceLayoutPersistedState,
} from "@/stores/workspace-layout-store";
import { mergeWorkspaceLayoutSnapshots, stableStringify } from "@/stores/workspace-layout-sync";
import { isWeb } from "@/constants/platform";
import { SPACE_STORAGE_KEY, useSpaceStore } from "@/stores/space-store";

export interface DraftStoreSyncAdapter {
  storageKey: string;
  reconcile: () => Promise<void>;
}

type WorkspaceLayoutStore = ReturnType<typeof createWorkspaceLayoutStore>;

export interface WorkspaceLayoutReconciler {
  (): Promise<void>;
  dispose: () => void;
}

export function mergeExternallyPersistedWorkspaceLayoutState(input: {
  chosen: WorkspaceLayoutPersistedState;
  currentState: ReturnType<typeof useWorkspaceLayoutStore.getState>;
  ids: WorkspaceLayoutIdSource;
}): ReturnType<typeof useWorkspaceLayoutStore.getState> {
  const ours = partializeWorkspaceLayoutState(input.currentState);
  const layoutsToRestore: WorkspaceLayoutPersistedState["layoutByWorkspace"] = {};
  const unchangedKeys: string[] = [];
  for (const [workspaceKey, layout] of Object.entries(input.chosen.layoutByWorkspace)) {
    if (stableStringify(layout) === stableStringify(ours.layoutByWorkspace[workspaceKey])) {
      unchangedKeys.push(workspaceKey);
    } else {
      layoutsToRestore[workspaceKey] = layout;
    }
  }
  const merged = mergeWorkspaceLayoutPersistedState(
    { ...input.chosen, layoutByWorkspace: layoutsToRestore },
    input.currentState,
    input.ids,
  );
  for (const workspaceKey of unchangedKeys) {
    merged.layoutByWorkspace[workspaceKey] = input.currentState.layoutByWorkspace[workspaceKey];
  }
  return merged;
}

/**
 * Runs one reconciliation at a time and coalesces triggers that arrive while one is in flight.
 * Storage events burst during startup, and the handlers mutate shared merge bases across awaits.
 */
function createSerialTask(run: () => Promise<void>, label: string): () => void {
  let running = false;
  let queued = false;
  const schedule = (): void => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    void run()
      .catch((error) => {
        console.warn(`[cross-window-sync] ${label} failed`, error);
      })
      .finally(() => {
        running = false;
        if (queued) {
          queued = false;
          schedule();
        }
      });
  };
  return schedule;
}

export function createWorkspaceLayoutReconciler(
  store: WorkspaceLayoutStore,
  ids: WorkspaceLayoutIdSource = defaultWorkspaceLayoutIds,
): WorkspaceLayoutReconciler {
  const reconcile = async (): Promise<void> => {
    await store.waitForHydration();
    const theirs = await store.getState().readSyncSnapshot();
    if (!theirs) return;

    const currentState = store.getState();
    const ours = currentState.getSyncSnapshot();
    const chosen = mergeWorkspaceLayoutSnapshots(ours, theirs);
    const { syncRevisions: _oursRevisions, ...ourFields } = ours;
    const { syncRevisions: _chosenRevisions, ...chosenFields } = chosen;
    const merged =
      stableStringify(ourFields) === stableStringify(chosenFields)
        ? currentState
        : mergeExternallyPersistedWorkspaceLayoutState({ chosen, currentState, ids });
    store.getState().applyExternallyPersistedState(merged, chosen);
    const normalized = store.getState().getSyncSnapshot();
    if (stableStringify(normalized) !== stableStringify(theirs)) {
      const storage = store.persist.getOptions().storage;
      await storage?.setItem(WORKSPACE_LAYOUT_STORE_STORAGE_KEY, {
        state: normalized,
        version: store.persist.getOptions().version,
      });
    }
  };
  return Object.assign(reconcile, { dispose: () => {} });
}

/**
 * Keeps workspace layouts and drafts aligned across browser windows.
 * Returns a function that removes the storage listener.
 */
export function installCrossWindowStoreSync(
  draftStore: DraftStoreSyncAdapter,
  ids: WorkspaceLayoutIdSource = defaultWorkspaceLayoutIds,
): () => void {
  if (!isWeb) {
    return () => {};
  }

  const workspaceLayoutReconciler = createWorkspaceLayoutReconciler(useWorkspaceLayoutStore, ids);

  const handleDraftsWrite = () => draftStore.reconcile();

  const scheduleWorkspaceLayoutWrite = createSerialTask(
    workspaceLayoutReconciler,
    "Workspace layout reconciliation",
  );
  const scheduleDraftsWrite = createSerialTask(handleDraftsWrite, "Draft reconciliation");

  const onStorage = (event: StorageEvent) => {
    if (event.key === draftStore.storageKey) {
      scheduleDraftsWrite();
      return;
    }
    if (event.key === SPACE_STORAGE_KEY) {
      // Space mutations carry their own revision, so re-reading the snapshot is
      // enough; `apply` drops a read that lost a race with a local mutation.
      void useSpaceStore.hydrate();
      return;
    }
    if (event.key === WORKSPACE_LAYOUT_STORE_STORAGE_KEY) {
      scheduleWorkspaceLayoutWrite();
    }
  };

  window.addEventListener("storage", onStorage);
  void useSpaceStore.hydrate();
  scheduleWorkspaceLayoutWrite();
  scheduleDraftsWrite();
  return () => {
    window.removeEventListener("storage", onStorage);
    workspaceLayoutReconciler.dispose();
  };
}
