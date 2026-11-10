import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";
import { useMemo } from "react";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { openAgentInProjectWindow } from "@/desktop/open-agent-window";
import { openAgentTarget } from "@/navigation/open-agent-target";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { createPluginHostNavigation } from "./host-navigation-model";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

export function usePluginHostNavigation(
  serverId: string,
): NonNullable<PluginSurfaceProps["navigation"]> {
  return useMemo(
    () =>
      createPluginHostNavigation(serverId, {
        browserAvailable: getIsElectron(),
        isHostRegistered: (targetServerId) =>
          getHostRuntimeStore()
            .getHosts()
            .some((host) => host.serverId === targetServerId),
        openAgent: ({ serverId: targetServerId, agentId }) => {
          let route: string | null = null;
          openAgentTarget(
            { serverId: targetServerId, agentId },
            {
              navigateToAgent: (input, target) => (route = navigateToAgent(input, target)),
              openAgentInProjectWindow,
            },
          );
          return route;
        },
        openWorkspace: navigateToWorkspace,
        createBrowser: createWorkspaceBrowser,
        focusHost: (targetServerId) => useSidebarViewStore.getState().focusHost(targetServerId),
        resolveWorkspace: ({ serverId: targetServerId, workspaceId }) =>
          resolveWorkspaceMapKeyByIdentity({
            workspaces: useSessionStore.getState().sessions[targetServerId]?.workspaces,
            workspaceId,
          }),
      }),
    [serverId],
  );
}
