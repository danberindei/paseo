/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  dismissTo: vi.fn(),
}));
const pathnameState = vi.hoisted(() => ({
  value: "/",
}));
const localParamsState = vi.hoisted(() => ({
  value: {} as { serverId?: string | string[]; workspaceId?: string | string[] },
}));
const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(async () => null),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(async () => undefined),
}));

vi.mock("expo-router", () => ({
  router: routerMock,
  useLocalSearchParams: () => localParamsState.value,
  usePathname: () => pathnameState.value,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: asyncStorageMock,
}));

import {
  navigateToLastWorkspace,
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useSpaceStore } from "@/stores/space-store";

describe("workspace navigation", () => {
  beforeEach(() => {
    routerMock.dismissTo.mockReset();
    asyncStorageMock.setItem.mockClear();
    pathnameState.value = "/";
    localParamsState.value = {};
    useSpaceStore.setState({ spaces: [], activeSpaceId: null });
    delete (window as typeof window & { paseoDesktop?: unknown }).paseoDesktop;
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
    useSpaceStore.setState({ activeSpaceId: "space-a" });
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
    useSpaceStore.setState({ activeSpaceId: "space-a" });
    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-a" });
    useSpaceStore.setState({ activeSpaceId: "space-b" });
    navigateToWorkspace({ serverId: "server-1", workspaceId: "workspace-b" });
    routerMock.dismissTo.mockReset();
    useSpaceStore.setState({ activeSpaceId: "space-a" });

    expect(navigateToLastWorkspace()).toBe(true);
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/h/server-1/workspace/workspace-a");
  });
});
