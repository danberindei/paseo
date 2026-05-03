import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import type { NavigateToWorkspaceInput } from "@/stores/navigation-active-workspace-store";

export interface NavigateToAgentInput {
  serverId: string;
  agentId: string;
  // Used as the workspace target when the agent is not yet in the session store
  // (cold deep-links). Otherwise the workspace is read from the store.
  workspaceId?: string | null;
  // Used to enforce active-space visibility when the caller already resolved the
  // target project but the workspace store is still cold.
  projectId?: string | null;
  pin?: boolean;
}

export interface AgentNavTarget {
  agentWorkspaceId: string | null | undefined;
  projectId: string | null | undefined;
}

export interface NavigateToAgentDeps {
  readAgentNavTarget: (input: { serverId: string; agentId: string }) => AgentNavTarget;
  navigateToHostAgent: (route: string) => void;
  navigateToWorkspace: (input: NavigateToWorkspaceInput) => string;
  isProjectVisibleInWindow: (projectId: string | null) => boolean;
}

export function resolveNavigateToAgent(
  input: NavigateToAgentInput,
  deps: NavigateToAgentDeps,
): string | null {
  const navTarget = deps.readAgentNavTarget({ serverId: input.serverId, agentId: input.agentId });
  const agentWorkspaceId = input.workspaceId ?? navTarget.agentWorkspaceId;
  const projectId = input.projectId ?? navTarget.projectId ?? null;
  const workspaceId = normalizeWorkspaceOpaqueId(agentWorkspaceId);

  if (!deps.isProjectVisibleInWindow(projectId)) {
    return null;
  }

  if (!workspaceId) {
    const route = buildHostAgentDetailRoute(input.serverId, input.agentId);
    deps.navigateToHostAgent(route);
    return route;
  }

  return deps.navigateToWorkspace({
    serverId: input.serverId,
    workspaceId,
    target: { kind: "agent", agentId: input.agentId },
    pin: input.pin,
  });
}
