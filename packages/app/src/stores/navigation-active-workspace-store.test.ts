/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceRouteNavigationRef,
  type WorkspaceRouteNavigationRef,
} from "@/navigation/workspace-route-navigation";
import { useActiveSpaceStore } from "@/stores/active-space-store";
import { LAST_WORKSPACE_SELECTION_STORAGE_KEY } from "@/stores/last-workspace-selection";
import {
  navigateToLastWorkspace,
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { LEGACY_SPACE_STORE_KEY, useSpaceStore } from "@/stores/space-store";

const routerMock = vi.hoisted(() => ({
  dismissTo: vi.fn(),
}));
const pathnameState = vi.hoisted(() => ({
  value: "/",
}));
const localParamsState = vi.hoisted(() => ({
  value: {} as { serverId?: string | string[]; workspaceId?: string | string[] },
}));
const asyncStorageMock = vi.hoisted(() => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn<(key: string) => Promise<string | null>>(async (key) => values.get(key) ?? null),
    setItem: vi.fn<(key: string, value: string) => Promise<void>>(async (key, value) => {
      values.set(key, value);
    }),
  };
});

vi.mock("expo-router", () => ({
  router: routerMock,
  useLocalSearchParams: () => localParamsState.value,
  usePathname: () => pathnameState.value,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorageMock,
}));

// A ready root navigation ref with no host stack mounted, so route intents fall
// through to dismissTo instead of a POP_TO dispatch.
const navigationRefMock: WorkspaceRouteNavigationRef = {
  current: {
    isReady: () => true,
    getRootState: () => ({
      key: "root-stack",
      index: 0,
      routeNames: [],
      routes: [],
      type: "stack",
      stale: false,
    }),
    dispatch: () => undefined,
  },
  addListener: () => () => undefined,
};

async function flushMicrotasks(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve();
  }
}

describe("workspace navigation", () => {
  let unregisterNavigationRef: (() => void) | null = null;

  beforeEach(() => {
    routerMock.dismissTo.mockReset();
    asyncStorageMock.setItem.mockClear();
    pathnameState.value = "/";
    localParamsState.value = {};
    useSpaceStore.setState({ spaces: [] });
    useActiveSpaceStore.setState({ activeSpaceId: null });
    delete (window as typeof window & { paseoDesktop?: unknown }).paseoDesktop;
    unregisterNavigationRef = registerWorkspaceRouteNavigationRef(navigationRefMock);
  });

  afterEach(() => {
    unregisterNavigationRef?.();
    unregisterNavigationRef = null;
    asyncStorageMock.values.clear();
    asyncStorageMock.getItem.mockImplementation(
      async (key) => asyncStorageMock.values.get(key) ?? null,
    );
  });

  it("reports when no last workspace is known", () => {
    expect(navigateToLastWorkspace()).toBe(false);
  });

  it("navigates to a workspace route", () => {
    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" });

    expect(routerMock.dismissTo).toHaveBeenCalledWith("/h/server-1/workspace/workspace-a");
    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      "paseo:last-workspace-route-selection",
      JSON.stringify({
        defaultSelection: { serverId: "server-1", workspaceId: "workspace-a" },
      }),
    );
  });

  it("stores the workspace selection under the current space", () => {
    useActiveSpaceStore.setState({ activeSpaceId: "space-a" });
    (window as typeof window & { paseoDesktop?: { initialSpaceId?: string | null } }).paseoDesktop =
      { initialSpaceId: "space-a" };

    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" });

    const scopedWrite = asyncStorageMock.setItem.mock.calls.find(
      (call): call is [string, string] =>
        call[0] === "paseo:last-workspace-route-selection" && typeof call[1] === "string",
    );
    expect(scopedWrite).toBeDefined();
    const [, persistedSelection] = scopedWrite!;
    expect(JSON.parse(persistedSelection)).toMatchObject({
      selectionBySpaceId: {
        "space-a": { serverId: "server-1", workspaceId: "workspace-a" },
      },
    });
  });

  it("reads the active workspace from the current route", () => {
    pathnameState.value = "/h/server-1/workspace/workspace-a";

    const { result } = renderHook(() => useActiveWorkspaceSelection());

    expect(result.current).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
    });
  });

  it("falls back to workspace route params during cold route mount", () => {
    localParamsState.value = {
      serverId: "server-1",
      workspaceId: "b64_L3RtcC9wYXNlby1taXNzaW5nLXdvcmtzcGFjZQ",
    };

    const { result } = renderHook(() => useActiveWorkspaceSelection());

    expect(result.current).toEqual({
      serverId: "server-1",
      workspaceId: "/tmp/paseo-missing-workspace",
    });
  });

  it("navigates to the last workspace observed by the route reader", () => {
    pathnameState.value = "/h/server-1/workspace/workspace-a";
    renderHook(() => useActiveWorkspaceSelection());

    expect(navigateToLastWorkspace()).toBe(true);
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/h/server-1/workspace/workspace-a");
  });

  it("restores the last workspace for the current space window", () => {
    (window as typeof window & { paseoDesktop?: { initialSpaceId?: string | null } }).paseoDesktop =
      { initialSpaceId: "space-a" };
    useActiveSpaceStore.setState({ activeSpaceId: "space-a" });
    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" });
    useActiveSpaceStore.setState({ activeSpaceId: "space-b" });
    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-b" });
    routerMock.dismissTo.mockReset();
    useActiveSpaceStore.setState({ activeSpaceId: "space-a" });

    expect(navigateToLastWorkspace()).toBe(true);
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/h/server-1/workspace/workspace-a");
  });

  it("keeps persisted space selections while the space store is still hydrating", async () => {
    let finishSpaceRead: (value: string | null) => void = () => {};
    const spaceRead = new Promise<string | null>((resolve) => {
      finishSpaceRead = resolve;
    });
    asyncStorageMock.getItem.mockImplementation((key) => {
      if (key === LEGACY_SPACE_STORE_KEY) {
        return spaceRead;
      }
      if (key === LAST_WORKSPACE_SELECTION_STORAGE_KEY) {
        return Promise.resolve(
          JSON.stringify({
            selectionBySpaceId: {
              "space-a": { serverId: "server-1", workspaceId: "workspace-a" },
            },
          }),
        );
      }
      return Promise.resolve(asyncStorageMock.values.get(key) ?? null);
    });

    vi.resetModules();
    const navigation = await import("@/stores/navigation-active-workspace-store");
    const spaceStore = await import("@/stores/space-store");
    await flushMicrotasks();

    expect(asyncStorageMock.setItem).not.toHaveBeenCalledWith(
      LAST_WORKSPACE_SELECTION_STORAGE_KEY,
      "{}",
    );
    expect(navigation.getLastWorkspaceSelection("space-a")).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
    });

    finishSpaceRead(
      JSON.stringify({
        state: { spaces: [{ id: "space-a", name: "Space A", projectIds: [] }] },
        version: 2,
      }),
    );
    await vi.waitFor(() => expect(spaceStore.getSpaceStoreHydrationStatus()).toBe("ready"));
    await flushMicrotasks();

    expect(navigation.getLastWorkspaceSelection("space-a")).toEqual({
      serverId: "server-1",
      workspaceId: "workspace-a",
    });
  });
});
