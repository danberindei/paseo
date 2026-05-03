/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useSidebarWorkspacesList } from "@/hooks/use-sidebar-workspaces-list";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import {
  useSessionStore,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSpaceStore } from "@/stores/space-store";
import { defaultHostAppearance } from "@/hosts/appearance";
import type { HostProfile } from "@/types/host-connection";

const SERVER_ID = "sidebar-space-filter";

function workspace(input: { id: string; projectId: string }): WorkspaceDescriptor {
  return {
    id: input.id,
    projectId: input.projectId,
    projectDisplayName: input.projectId,
    projectRootPath: `/repo/${input.projectId}`,
    workspaceDirectory: `/repo/${input.projectId}/${input.id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name: input.id,
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

function makeProject(input: { projectId: string }): ProjectDescriptor {
  return {
    projectId: input.projectId,
    projectKey: input.projectId,
    projectDisplayName: input.projectId,
    projectCustomName: null,
    projectCustomIconRevision: null,
    projectRootPath: `/repo/${input.projectId}`,
    projectKind: "git",
  };
}

function makeHost(): HostProfile {
  const now = "2026-04-19T00:00:00.000Z";
  return {
    serverId: SERVER_ID,
    label: "Space Filter Host",
    appearance: defaultHostAppearance(),
    lifecycle: {},
    connections: [],
    preferredConnectionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function initializeSidebarState(): void {
  act(() => {
    (
      getHostRuntimeStore() as unknown as { setHostsAndSync: (hosts: HostProfile[]) => void }
    ).setHostsAndSync([makeHost()]);
    useSessionStore.getState().initializeSession(SERVER_ID, null as unknown as DaemonClient);
    useSessionStore
      .getState()
      .setProjects(SERVER_ID, [
        makeProject({ projectId: "project-a" }),
        makeProject({ projectId: "project-b" }),
      ]);
    useSessionStore
      .getState()
      .setWorkspaces(
        SERVER_ID,
        new Map(
          [
            workspace({ id: "a-one", projectId: "project-a" }),
            workspace({ id: "b-one", projectId: "project-b" }),
          ].map((entry) => [entry.id, entry]),
        ),
      );
    useSessionStore.getState().setHasHydratedWorkspaces(SERVER_ID, true);
  });
}

describe("useSidebarWorkspacesList space filtering", () => {
  beforeEach(() => {
    useSpaceStore.setState({ spaces: [], activeSpaceId: null });
    useSidebarOrderStore.setState({ projectOrder: [], workspaceOrderByProject: {} });
    initializeSidebarState();
  });

  afterEach(() => {
    useSpaceStore.setState({ spaces: [], activeSpaceId: null });
  });

  it("returns every project and placement when no space is active", () => {
    const { result } = renderHook(() => useSidebarWorkspacesList({ hostFilters: [SERVER_ID] }));

    expect(result.current.projects.map((project) => project.viewKey)).toEqual([
      "project-a",
      "project-b",
    ]);
    expect(result.current.workspacePlacements.map((placement) => placement.workspaceId)).toEqual([
      "a-one",
      "b-one",
    ]);
  });

  it("filters placements by the active space so status grouping stays scoped", () => {
    act(() => {
      useSpaceStore.setState({
        spaces: [{ id: "space-a", name: "Space A", projectIds: ["project-a"] }],
        activeSpaceId: "space-a",
      });
    });

    const { result } = renderHook(() => useSidebarWorkspacesList({ hostFilters: [SERVER_ID] }));

    expect(result.current.projects.map((project) => project.viewKey)).toEqual(["project-a"]);
    expect(result.current.workspacePlacements.map((placement) => placement.workspaceId)).toEqual([
      "a-one",
    ]);
  });
});
