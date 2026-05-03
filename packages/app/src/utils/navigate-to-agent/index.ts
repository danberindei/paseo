import { router, type Href } from "expo-router";
import { getIsElectronRuntime } from "@/constants/layout";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { isProjectVisibleInActiveSpace } from "@/stores/space-store";
import { resolveNavigateToAgent, type NavigateToAgentInput } from "./resolve";

export type { NavigateToAgentInput } from "./resolve";

export function navigateToAgent(input: NavigateToAgentInput): string | null {
  return resolveNavigateToAgent(input, {
    readAgentNavTarget: ({ serverId, agentId }) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      const workspace = agent?.workspaceId ? session?.workspaces.get(agent.workspaceId) : null;
      return {
        agentWorkspaceId: agent?.workspaceId,
        projectId: workspace?.projectId ?? agent?.projectPlacement?.projectKey ?? null,
      };
    },
    navigateToHostAgent: (route) => {
      router.navigate(route as Href);
    },
    navigateToWorkspace,
    isProjectVisibleInWindow: (projectId) =>
      !getIsElectronRuntime() || isProjectVisibleInActiveSpace(projectId),
  });
}
