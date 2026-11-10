import { router, type Href } from "expo-router";
import { getIsElectronRuntime } from "@/constants/layout";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { isProjectVisibleInActiveSpace } from "@/stores/space-store";
import { resolveNavigateToAgent, type AgentNavTarget, type NavigateToAgentInput } from "./resolve";

export type { AgentNavTarget, NavigateToAgentInput } from "./resolve";

/**
 * Resolves the workspace and project an agent navigation belongs to.
 *
 * `workspaceHint` is the workspace named by the caller (a notification payload,
 * a deep link) and is only read when the session store has no agent record yet,
 * because the agent can move after that name was written. It keeps the project
 * resolvable, and therefore the active-space visibility check meaningful, during
 * a cold launch.
 */
export function readAgentNavTarget(input: {
  serverId: string;
  agentId: string;
  workspaceHint?: string | null;
}): AgentNavTarget {
  const session = useSessionStore.getState().sessions[input.serverId];
  const agent = session?.agents.get(input.agentId) ?? session?.agentDetails.get(input.agentId);
  const workspaceId = agent?.workspaceId ?? input.workspaceHint ?? null;
  const workspace = workspaceId ? session?.workspaces.get(workspaceId) : null;
  return {
    agentWorkspaceId: agent?.workspaceId,
    projectId: workspace?.projectId ?? agent?.projectPlacement?.projectKey ?? null,
  };
}

export function navigateToAgent(
  input: NavigateToAgentInput,
  navTarget?: AgentNavTarget,
): string | null {
  return resolveNavigateToAgent(
    input,
    {
      readAgentNavTarget: ({ serverId, agentId }) =>
        readAgentNavTarget({ serverId, agentId, workspaceHint: input.workspaceId }),
      navigateToHostAgent: (route) => {
        router.navigate(route as Href);
      },
      navigateToWorkspace,
      isProjectVisibleInWindow: (projectId) =>
        !getIsElectronRuntime() || isProjectVisibleInActiveSpace(projectId),
    },
    navTarget,
  );
}
