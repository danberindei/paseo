import { revealWorkspaceTab } from "@/workspace-tabs/navigation";
import { usePanelStore } from "@/stores/panel-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLocalSearchParams, usePathname } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import {
  createLastWorkspaceSelectionStore,
  LAST_WORKSPACE_SELECTION_STORAGE_KEY,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionStorage,
} from "@/stores/last-workspace-selection";
import {
  navigateToLastWorkspace as navigateToLastWorkspacePure,
  navigateToWorkspace as navigateToWorkspacePure,
  parseActiveWorkspaceSelection,
  type NavigateToWorkspaceDeps,
  type NavigateToWorkspaceInput,
} from "./navigation";
import { useSessionStore } from "@/stores/session-store";
import { useActiveSpaceStore } from "@/stores/active-space-store";
import { type Space, useSpaceStore } from "@/stores/space-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit } from "@/utils/host-route-browser";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";

export type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
export type { NavigateToWorkspaceInput } from "./navigation";

const lastWorkspaceSelectionStorage: LastWorkspaceSelectionStorage = {
  read: () => AsyncStorage.getItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY, value),
  clear: () => AsyncStorage.removeItem(LAST_WORKSPACE_SELECTION_STORAGE_KEY),
};

const lastWorkspaceSelectionStore = createLastWorkspaceSelectionStore(
  lastWorkspaceSelectionStorage,
);

function navigateDeps(): NavigateToWorkspaceDeps {
  return {
    revealTab: revealWorkspaceTab,
    revealWorkspace: (workspaceKey, surface) => {
      useWorkspaceLayoutStore.getState().focusWorkspace(workspaceKey);
      const panels = usePanelStore.getState();
      if (surface === "sidebar") panels.showMobileAgentList();
      else panels.showMobileAgent();
    },
    getSessionWorkspaces: (serverId) => useSessionStore.getState().sessions[serverId]?.workspaces,
    isWorkspaceLayoutHydrated: () => useWorkspaceLayoutStore.persist.hasHydrated(),
    deferOpenTab: (input) => useWorkspaceLayoutStore.getState().deferOpenTab(input),
    openTab: (input) => useWorkspaceLayoutStore.getState().openTab(input),
    rememberLastWorkspace: (selection) =>
      lastWorkspaceSelectionStore.remember(
        selection,
        normalizeWorkspaceSelectionScope(useActiveSpaceStore.getState().activeSpaceId) ??
          getCurrentWorkspaceSelectionScope(),
      ),
    navigateToRoute: (route) => {
      navigateToHostWorkspaceRoute(route);
      stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
    },
  };
}

export function hydrateLastWorkspaceSelection(): Promise<void> {
  return lastWorkspaceSelectionStore.hydrate();
}

function normalizeWorkspaceSelectionScope(spaceId: string | null | undefined): string | null {
  if (typeof spaceId !== "string") {
    return null;
  }
  const trimmed = spaceId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getCurrentWorkspaceSelectionScope(): string | null {
  if (!getIsElectron()) {
    return null;
  }
  return normalizeWorkspaceSelectionScope(getDesktopHost()?.initialSpaceId);
}

export function getLastWorkspaceSelection(
  spaceId?: string | null,
): ActiveWorkspaceSelection | null {
  const scope =
    spaceId !== undefined
      ? normalizeWorkspaceSelectionScope(spaceId)
      : getCurrentWorkspaceSelectionScope();
  return lastWorkspaceSelectionStore.getSelection(scope);
}

export function getIsLastWorkspaceSelectionHydrated(): boolean {
  return lastWorkspaceSelectionStore.isHydrated();
}

export function navigateToWorkspace(input: NavigateToWorkspaceInput): string {
  return navigateToWorkspacePure(input, navigateDeps());
}

export function navigateToLastWorkspace(): boolean {
  const scope =
    normalizeWorkspaceSelectionScope(useActiveSpaceStore.getState().activeSpaceId) ??
    getCurrentWorkspaceSelectionScope();
  return navigateToLastWorkspacePure({
    ...navigateDeps(),
    getLastWorkspaceSelection: () => lastWorkspaceSelectionStore.getSelection(scope),
  });
}

export function useActiveWorkspaceSelection(): ActiveWorkspaceSelection | null {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const selection = parseActiveWorkspaceSelection({ pathname: usePathname(), params });
  const serverId = selection?.serverId ?? null;
  const workspaceId = selection?.workspaceId ?? null;
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    lastWorkspaceSelectionStore.remember(
      { serverId, workspaceId },
      normalizeWorkspaceSelectionScope(useActiveSpaceStore.getState().activeSpaceId) ??
        getCurrentWorkspaceSelectionScope(),
    );
  }, [serverId, workspaceId]);
  return selection;
}

export function useLastWorkspaceSelection(
  spaceId?: string | null,
): ActiveWorkspaceSelection | null {
  const activeSpaceId = useActiveSpaceStore((state) => state.activeSpaceId);
  const scope =
    spaceId !== undefined
      ? normalizeWorkspaceSelectionScope(spaceId)
      : (normalizeWorkspaceSelectionScope(activeSpaceId) ?? getCurrentWorkspaceSelectionScope());
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    () => getLastWorkspaceSelection(scope),
    () => getLastWorkspaceSelection(scope),
  );
}

export function useIsLastWorkspaceSelectionHydrated(): boolean {
  return useSyncExternalStore(
    lastWorkspaceSelectionStore.subscribe,
    getIsLastWorkspaceSelectionHydrated,
    getIsLastWorkspaceSelectionHydrated,
  );
}

// Drop per-space selections for spaces that no longer exist. Pruning against the
// full known-id set on every spaces change (rather than only on an explicit
// delete) keeps the stored selections in sync even if a delete event is missed.
function pruneSelectionsForKnownSpaces(spaces: readonly Space[]): void {
  lastWorkspaceSelectionStore.prune(spaces.map((space) => space.id));
}

// Prune once the stored selections are hydrated, so selections loaded from
// storage for already-deleted spaces are dropped immediately. Wait for the space
// store too: before it hydrates, `spaces` is empty and pruning would drop the
// selection for every existing space.
function pruneSelectionsForHydratedSpaces(): void {
  const prune = () => {
    if (useSpaceStore.hydration.getSnapshot() !== "ready") return;
    pruneSelectionsForKnownSpaces(useSpaceStore.getState().spaces);
  };
  useSpaceStore.hydration.subscribe(prune);
  prune();
}

void hydrateLastWorkspaceSelection().then(pruneSelectionsForHydratedSpaces);

let lastKnownSpaces = useSpaceStore.getState().spaces;
useSpaceStore.subscribe((state) => {
  if (state.spaces === lastKnownSpaces) {
    return;
  }
  lastKnownSpaces = state.spaces;
  if (useSpaceStore.hydration.getSnapshot() !== "ready") return;
  pruneSelectionsForKnownSpaces(state.spaces);
});
