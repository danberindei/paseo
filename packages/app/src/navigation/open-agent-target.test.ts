import { describe, expect, it } from "vitest";
import type { AgentNavTarget, NavigateToAgentInput } from "@/utils/navigate-to-agent";
import { openAgentTarget, type OpenAgentTargetRef } from "./open-agent-target";

interface RecordedNavigation {
  input: NavigateToAgentInput;
  navTarget: AgentNavTarget;
}

interface RecordedHandoff {
  projectId: string;
  target: OpenAgentTargetRef;
}

function createStubDeps(route: string | null) {
  const navigations: RecordedNavigation[] = [];
  const handoffs: RecordedHandoff[] = [];
  const deps = {
    navigateToAgent: (input: NavigateToAgentInput, navTarget: AgentNavTarget) => {
      navigations.push({ input, navTarget });
      return route;
    },
    openAgentInProjectWindow: (projectId: string, target: OpenAgentTargetRef) => {
      handoffs.push({ projectId, target });
    },
  };
  return { deps, navigations, handoffs };
}

describe("openAgentTarget", () => {
  const navTarget: AgentNavTarget = { agentWorkspaceId: "workspace-1", projectId: "project-1" };

  it("navigates in this window with the snapshot it was given", () => {
    const { deps, navigations, handoffs } = createStubDeps("/h/server-1/workspace/workspace-1");

    openAgentTarget({ serverId: "server-1", agentId: "agent-1", pin: true }, deps, navTarget);

    expect(navigations).toEqual([
      { input: { serverId: "server-1", agentId: "agent-1", pin: true }, navTarget },
    ]);
    expect(handoffs).toEqual([]);
  });

  it("hands the agent to the window bound to its project when this window refuses", () => {
    const { deps, navigations, handoffs } = createStubDeps(null);

    openAgentTarget({ serverId: "server-1", agentId: "agent-1" }, deps, navTarget);

    expect(navigations).toHaveLength(1);
    expect(handoffs).toEqual([
      { projectId: "project-1", target: { serverId: "server-1", agentId: "agent-1" } },
    ]);
  });

  it("preserves notification pinning when handing off to another window", () => {
    const { deps, handoffs } = createStubDeps(null);
    openAgentTarget({ serverId: "server-1", agentId: "agent-1", pin: true }, deps, navTarget);
    expect(handoffs).toEqual([
      { projectId: "project-1", target: { serverId: "server-1", agentId: "agent-1", pin: true } },
    ]);
  });

  it("drops a request whose agent has no resolvable project", () => {
    const { deps, navigations, handoffs } = createStubDeps(null);

    openAgentTarget({ serverId: "server-1", agentId: "agent-missing" }, deps, {
      agentWorkspaceId: null,
      projectId: null,
    });

    expect(navigations).toEqual([
      {
        input: { serverId: "server-1", agentId: "agent-missing" },
        navTarget: { agentWorkspaceId: null, projectId: null },
      },
    ]);
    expect(handoffs).toEqual([]);
  });
});
