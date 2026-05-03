import { describe, expect, it } from "vitest";
import {
  resolveNavigateToAgent,
  type AgentNavTarget,
  type NavigateToAgentDeps,
} from "@/utils/navigate-to-agent/resolve";
import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-1";
const AGENT_ID = "agent-1";

interface RecordedHostNav {
  route: string;
}

interface RecordedTabNav extends NavigateToWorkspaceInput {}

function createFakeNavigators(
  target: AgentNavTarget,
  options: { isProjectVisibleInWindow?: (projectId: string | null) => boolean } = {},
): {
  deps: NavigateToAgentDeps;
  hostNavigations: RecordedHostNav[];
  tabNavigations: RecordedTabNav[];
  visibilityChecks: (string | null)[];
} {
  const hostNavigations: RecordedHostNav[] = [];
  const tabNavigations: RecordedTabNav[] = [];
  const visibilityChecks: (string | null)[] = [];
  return {
    hostNavigations,
    tabNavigations,
    visibilityChecks,
    deps: {
      readAgentNavTarget: () => target,
      navigateToHostAgent: (route) => {
        hostNavigations.push({ route });
      },
      navigateToWorkspace: (input) => {
        tabNavigations.push(input);
        return `/h/${input.serverId}/workspace/${input.workspaceId}`;
      },
      isProjectVisibleInWindow: (projectId) => {
        visibilityChecks.push(projectId);
        return options.isProjectVisibleInWindow?.(projectId) ?? true;
      },
    },
  };
}

describe("resolveNavigateToAgent", () => {
  it("opens the workspace tab carried by the agent's workspaceId", () => {
    const { deps, hostNavigations, tabNavigations } = createFakeNavigators({
      agentWorkspaceId: WORKSPACE_ID,
      projectId: null,
    });

    const route = resolveNavigateToAgent(
      { serverId: SERVER_ID, agentId: AGENT_ID, pin: true },
      deps,
    );

    expect(route).toBe("/h/server-1/workspace/workspace-1");
    expect(hostNavigations).toEqual([]);
    expect(tabNavigations).toEqual([
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
        pin: true,
      },
    ]);
  });

  it("uses the input workspaceId without using the nav target's workspaceId", () => {
    const readTargets: { serverId: string; agentId: string }[] = [];
    const { deps, tabNavigations } = createFakeNavigators({
      agentWorkspaceId: null,
      projectId: null,
    });
    deps.readAgentNavTarget = (input) => {
      readTargets.push(input);
      return { agentWorkspaceId: null, projectId: null };
    };

    resolveNavigateToAgent(
      { serverId: SERVER_ID, agentId: AGENT_ID, workspaceId: WORKSPACE_ID },
      deps,
    );

    expect(readTargets).toEqual([{ serverId: SERVER_ID, agentId: AGENT_ID }]);
    expect(tabNavigations).toEqual([
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
        pin: undefined,
      },
    ]);
  });

  it("uses the input projectId to evaluate visibility when the nav target is unresolved", () => {
    const { deps, tabNavigations, visibilityChecks } = createFakeNavigators({
      agentWorkspaceId: null,
      projectId: null,
    });

    resolveNavigateToAgent(
      {
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: "project-1",
      },
      deps,
    );

    expect(visibilityChecks).toEqual(["project-1"]);
    expect(tabNavigations).toEqual([
      {
        serverId: SERVER_ID,
        workspaceId: WORKSPACE_ID,
        target: { kind: "agent", agentId: AGENT_ID },
        pin: undefined,
      },
    ]);
  });

  it("suppresses explicit workspace navigation when the input project is not visible", () => {
    const { deps, hostNavigations, tabNavigations, visibilityChecks } = createFakeNavigators(
      {
        agentWorkspaceId: null,
        projectId: null,
      },
      { isProjectVisibleInWindow: () => false },
    );

    const route = resolveNavigateToAgent(
      {
        serverId: SERVER_ID,
        agentId: AGENT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: "project-1",
      },
      deps,
    );

    expect(route).toBeNull();
    expect(visibilityChecks).toEqual(["project-1"]);
    expect(hostNavigations).toEqual([]);
    expect(tabNavigations).toEqual([]);
  });

  it("falls back to the host agent route when the agent has no workspaceId", () => {
    const { deps, hostNavigations, tabNavigations } = createFakeNavigators({
      agentWorkspaceId: null,
      projectId: null,
    });

    const route = resolveNavigateToAgent({ serverId: SERVER_ID, agentId: "missing-agent" }, deps);

    expect(route).toBe("/h/server-1/agent/missing-agent");
    expect(hostNavigations).toEqual([{ route: "/h/server-1/agent/missing-agent" }]);
    expect(tabNavigations).toEqual([]);
  });

  it("suppresses navigation when the resolved project is not visible in the window", () => {
    const { deps, hostNavigations, tabNavigations, visibilityChecks } = createFakeNavigators(
      {
        agentWorkspaceId: WORKSPACE_ID,
        projectId: "project-1",
      },
      { isProjectVisibleInWindow: () => false },
    );

    const route = resolveNavigateToAgent(
      { serverId: SERVER_ID, agentId: AGENT_ID, pin: true },
      deps,
    );

    expect(route).toBeNull();
    expect(visibilityChecks).toEqual(["project-1"]);
    expect(hostNavigations).toEqual([]);
    expect(tabNavigations).toEqual([]);
  });

  it("suppresses the host fallback when the unresolved project is not visible", () => {
    const { deps, hostNavigations, tabNavigations, visibilityChecks } = createFakeNavigators(
      {
        agentWorkspaceId: null,
        projectId: null,
      },
      { isProjectVisibleInWindow: () => false },
    );

    const route = resolveNavigateToAgent({ serverId: SERVER_ID, agentId: "missing-agent" }, deps);

    expect(route).toBeNull();
    expect(visibilityChecks).toEqual([null]);
    expect(hostNavigations).toEqual([]);
    expect(tabNavigations).toEqual([]);
  });
});
