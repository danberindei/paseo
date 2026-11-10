import { getDesktopHost } from "@/desktop/host";
import type { OpenAgentTargetRef } from "@/navigation/open-agent-target";
import { useSpaceStore, type Space } from "@/stores/space-store";

export function findSpaceIdForProject(
  spaces: Pick<Space, "id" | "projectIds">[],
  projectId: string | null,
): string | null {
  if (!projectId) return null;
  return spaces.find((space) => space.projectIds.includes(projectId))?.id ?? null;
}

/**
 * Opens or focuses the desktop window bound to the project's space and opens the
 * agent in it.
 *
 * An agent belongs to the window whose space lists its project, so a request
 * arriving from another window's plugin surface or notification is handed to
 * that window instead of opening a foreign project here.
 */
export function openAgentInProjectWindow(projectId: string, target: OpenAgentTargetRef): void {
  const spaceId = findSpaceIdForProject(useSpaceStore.getState().spaces, projectId);
  if (!spaceId) return;
  const windows = getDesktopHost()?.windows;
  if (!windows) return;
  if (windows.openAgentInSpace) {
    void windows.openAgentInSpace({ spaceId, ...target });
    return;
  }
  // A shell without agent handoff can still raise the project's window.
  void windows.openWithSpace?.(spaceId);
}
