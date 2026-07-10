import { useDraftStore } from "@/stores/draft-store";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import {
  collectAllTabs,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";

/**
 * Draft records owned by a workspace's draft tabs. Agent tabs are left out: their key is
 * `agent:<serverId>:<agentId>`, so the text outlives the tab and the workspace archive and
 * comes back when the agent tab is reopened.
 */
export function collectWorkspaceDraftTabKeys(input: {
  serverId: string;
  layout: WorkspaceLayout | null | undefined;
}): string[] {
  if (!input.layout) {
    return [];
  }
  const draftKeys: string[] = [];
  for (const tab of collectAllTabs(input.layout.root)) {
    if (tab.target.kind !== "draft") {
      continue;
    }
    draftKeys.push(
      buildDraftStoreKey({
        serverId: input.serverId,
        agentId: tab.tabId,
        draftId: tab.target.draftId,
      }),
    );
  }
  return draftKeys;
}

export function clearWorkspaceDraftRecords(input: {
  serverId: string;
  workspaceKey: string;
}): void {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[input.workspaceKey];
  for (const draftKey of collectWorkspaceDraftTabKeys({ serverId: input.serverId, layout })) {
    useDraftStore.getState().clearDraftInput({ draftKey, lifecycle: "removed" });
  }
}
