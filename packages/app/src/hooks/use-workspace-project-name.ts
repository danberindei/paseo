import { useSessionStore } from "@/stores/session-store";

/**
 * The short project name for a workspace, preferring the user's custom name and
 * falling back to the abbreviated display name. Null while the workspace is not
 * yet hydrated or when either identifier is missing.
 */
export function useWorkspaceProjectName(
  serverId: string | null,
  workspaceId: string | null,
): string | null {
  return useSessionStore((state) => {
    if (!serverId || !workspaceId) {
      return null;
    }
    const workspace = state.sessions[serverId]?.workspaces.get(workspaceId);
    if (!workspace) {
      return null;
    }
    return workspace.projectCustomName ?? workspace.projectDisplayName ?? null;
  });
}
