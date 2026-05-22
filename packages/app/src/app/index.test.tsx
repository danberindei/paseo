/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostRuntimeBootstrapState } from "./_layout";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

const { redirectMock, state } = vi.hoisted(() => {
  const hoistedState = {
    pathname: "/",
    bootstrapState: {
      splashError: null,
      retry: vi.fn(),
      hasGivenUpWaitingForHost: false,
      storeReady: false,
      startupBlocker: { kind: "none" },
    } as HostRuntimeBootstrapState,
    anyOnlineHostServerId: null as string | null,
    hosts: [] as Array<{ serverId: string }>,
    isWorkspaceSelectionLoaded: true,
    workspaceSelection: null as ActiveWorkspaceSelection | null,
    workspaceSelectionBySpaceId: {} as Record<string, ActiveWorkspaceSelection | null>,
    initialSpaceId: null as string | null,
  };

  return {
    redirectMock: vi.fn(),
    state: hoistedState,
  };
});

vi.mock("expo-router", () => ({
  Redirect: ({ href }: { href: string }) => {
    redirectMock(href);
    return React.createElement("div", { "data-testid": "redirect", "data-href": href });
  },
  usePathname: () => state.pathname,
}));

vi.mock("@/app/_layout", () => ({
  useHostRuntimeBootstrapState: () => state.bootstrapState,
  useEarliestOnlineHostServerId: () => state.anyOnlineHostServerId,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRegistryStatus: () => "ready",
  useHosts: () => state.hosts,
}));

vi.mock("@/stores/session-store-hooks", () => ({
  useHasHydratedWorkspaces: () => false,
  useWorkspaceExists: () => false,
}));

vi.mock("@/desktop/daemon/desktop-daemon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/desktop/daemon/desktop-daemon")>()),
  shouldUseDesktopDaemon: () => false,
}));

vi.mock("@/screens/startup-splash-screen", () => ({
  StartupSplashScreen: () => React.createElement("div", { "data-testid": "startup-splash" }),
}));

vi.mock("@/stores/navigation-active-workspace-store", () => ({
  useIsLastWorkspaceSelectionHydrated: () => state.isWorkspaceSelectionLoaded,
  useLastWorkspaceSelection: (spaceId?: string | null) =>
    spaceId !== undefined
      ? (state.workspaceSelectionBySpaceId[spaceId ?? ""] ?? null)
      : state.workspaceSelection,
}));

vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({ initialSpaceId: state.initialSpaceId }),
}));

describe("Index route startup navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.resetModules();
    state.pathname = "/";
    state.bootstrapState = {
      splashError: null,
      retry: vi.fn(),
      hasGivenUpWaitingForHost: false,
      storeReady: false,
      startupBlocker: { kind: "none" },
    };
    state.anyOnlineHostServerId = null;
    state.hosts = [];
    state.isWorkspaceSelectionLoaded = true;
    state.workspaceSelection = null;
    state.workspaceSelectionBySpaceId = {};
    state.initialSpaceId = null;
    redirectMock.mockReset();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderIndex() {
    const { default: Index } = await import("./index");
    await act(async () => {
      root.render(<Index />);
    });
  }

  it("shows the startup splash while no host is online and the welcome timer has not fired", async () => {
    await renderIndex();

    expect(container.querySelector("[data-testid='startup-splash']")).not.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("shows the startup splash while the persisted workspace selection has not loaded", async () => {
    state.anyOnlineHostServerId = "server-1";
    state.isWorkspaceSelectionLoaded = false;

    await renderIndex();

    expect(container.querySelector("[data-testid='startup-splash']")).not.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("enters the matching host boundary for a persisted workspace", async () => {
    state.anyOnlineHostServerId = "server-1";
    state.hosts = [{ serverId: "server-1" }];
    state.workspaceSelection = { serverId: "server-1", workspaceId: "workspace-a" };

    await renderIndex();

    expect(redirectMock).toHaveBeenCalledWith("/h/server-1");
    expect(container.querySelector("[data-testid='redirect']")).not.toBeNull();
  });

  it("enters the persisted workspace host boundary even when the first online host is different", async () => {
    state.anyOnlineHostServerId = "server-2";
    state.hosts = [{ serverId: "server-1" }, { serverId: "server-2" }];
    state.workspaceSelection = { serverId: "server-1", workspaceId: "workspace-a" };

    await renderIndex();

    expect(redirectMock).toHaveBeenCalledWith("/h/server-1");
  });

  it("enters the persisted workspace host boundary for the current space window", async () => {
    state.anyOnlineHostServerId = "server-2";
    state.hosts = [{ serverId: "server-1" }, { serverId: "server-2" }];
    state.initialSpaceId = "space-a";
    state.workspaceSelectionBySpaceId = {
      "space-a": { serverId: "server-1", workspaceId: "workspace-a" },
      "space-b": { serverId: "server-1", workspaceId: "workspace-b" },
    };

    await renderIndex();

    expect(redirectMock).toHaveBeenCalledWith("/h/server-1");
  });

  it("navigates to the host root when no persisted workspace exists", async () => {
    state.anyOnlineHostServerId = "server-2";
    state.workspaceSelection = null;

    await renderIndex();

    expect(redirectMock).toHaveBeenCalledWith("/h/server-2");
  });

  it("falls back to welcome when the give-up timer fires with no host online", async () => {
    state.bootstrapState = {
      ...state.bootstrapState,
      hasGivenUpWaitingForHost: true,
    };

    await renderIndex();

    expect(redirectMock).toHaveBeenCalledWith("/welcome");
  });
});
