/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openAgentInProjectWindow } from "@/desktop/open-agent-window";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { usePluginHostNavigation } from "./host-navigation";

vi.mock("@/utils/navigate-to-agent", () => ({
  navigateToAgent: vi.fn(),
  readAgentNavTarget: vi.fn(() => ({ agentWorkspaceId: "workspace-1", projectId: "project-1" })),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: vi.fn(),
}));
vi.mock("@/desktop/open-agent-window", () => ({
  openAgentInProjectWindow: vi.fn(),
}));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ getHosts: () => [{ serverId: "host-1" }, { serverId: "host-2" }] }),
}));

const navigateToAgentMock = vi.mocked(navigateToAgent);
const navigateToWorkspaceMock = vi.mocked(navigateToWorkspace);
const openAgentInProjectWindowMock = vi.mocked(openAgentInProjectWindow);

const NAV_TARGET = { agentWorkspaceId: "workspace-1", projectId: "project-1" };
const SIDEBAR_FILTERS = {
  groupMode: "status" as const,
  hostFilters: ["host-1"],
  projectFilters: ["project-1"],
  labelFilter: { labels: ["urgent"] },
};

describe("usePluginHostNavigation", () => {
  beforeEach(() => {
    navigateToAgentMock.mockReset();
    navigateToAgentMock.mockReturnValue("/h/host-1/workspace/workspace-1");
    navigateToWorkspaceMock.mockReset();
    openAgentInProjectWindowMock.mockReset();
    useSidebarViewStore.setState(SIDEBAR_FILTERS);
  });

  it("opens agents and workspaces on the rendering host", () => {
    const { result } = renderHook(() => usePluginHostNavigation("host-1"));

    act(() => result.current.openAgent({ agentId: "agent-1" }));
    act(() => result.current.openWorkspace({ workspaceId: "workspace-1" }));

    expect(navigateToAgentMock).toHaveBeenCalledWith(
      { serverId: "host-1", agentId: "agent-1" },
      NAV_TARGET,
    );
    expect(openAgentInProjectWindowMock).not.toHaveBeenCalled();
    expect(navigateToWorkspaceMock).toHaveBeenCalledWith({
      serverId: "host-1",
      workspaceId: "workspace-1",
    });
  });

  it("hands an agent from another window's space to the window bound to its project", () => {
    navigateToAgentMock.mockReturnValue(null);
    const { result } = renderHook(() => usePluginHostNavigation("host-1"));

    act(() => result.current.openAgent({ agentId: "agent-1" }));

    expect(openAgentInProjectWindowMock).toHaveBeenCalledWith("project-1", {
      serverId: "host-1",
      agentId: "agent-1",
    });
  });

  it("opens the requested agent on the host the surface named, not the rendering host", () => {
    const { result } = renderHook(() => usePluginHostNavigation("host-1"));

    act(() => result.current.openAgent({ agentId: "agent-2", serverId: "host-2" }));

    expect(navigateToAgentMock).toHaveBeenCalledWith(
      { serverId: "host-2", agentId: "agent-2" },
      NAV_TARGET,
    );
  });

  it("focuses the registered host returned by agent navigation in this space", () => {
    navigateToAgentMock.mockReturnValue("/h/host-2/workspace/workspace-1");
    const { result } = renderHook(() => usePluginHostNavigation("host-1"));

    act(() => result.current.openAgent({ agentId: "agent-1", focusHost: true }));

    expect(navigateToAgentMock).toHaveBeenCalledWith(
      { serverId: "host-1", agentId: "agent-1" },
      NAV_TARGET,
    );
    expect(openAgentInProjectWindowMock).not.toHaveBeenCalled();
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      hostFilters: ["host-2"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("opens the destination space without changing this window's filters", () => {
    navigateToAgentMock.mockReturnValue(null);
    const { result } = renderHook(() => usePluginHostNavigation("host-1"));

    act(() =>
      result.current.openAgent({ serverId: "host-2", agentId: "agent-2", focusHost: true }),
    );

    expect(navigateToAgentMock).toHaveBeenCalledWith(
      { serverId: "host-2", agentId: "agent-2" },
      NAV_TARGET,
    );
    expect(openAgentInProjectWindowMock).toHaveBeenCalledWith("project-1", {
      serverId: "host-2",
      agentId: "agent-2",
    });
    expect(useSidebarViewStore.getState()).toMatchObject(SIDEBAR_FILTERS);
  });

  it("keeps the capability stable until the rendering host changes", () => {
    const { result, rerender } = renderHook(({ serverId }) => usePluginHostNavigation(serverId), {
      initialProps: { serverId: "host-1" },
    });
    const initialNavigation = result.current;

    rerender({ serverId: "host-1" });
    expect(result.current).toBe(initialNavigation);

    rerender({ serverId: "host-2" });
    expect(result.current).not.toBe(initialNavigation);

    act(() => result.current.openAgent({ agentId: "agent-2" }));
    act(() => result.current.openWorkspace({ workspaceId: "workspace-2" }));
    expect(navigateToAgentMock).toHaveBeenCalledWith(
      { serverId: "host-2", agentId: "agent-2" },
      NAV_TARGET,
    );
    expect(navigateToWorkspaceMock).toHaveBeenCalledWith({
      serverId: "host-2",
      workspaceId: "workspace-2",
    });
  });
});
