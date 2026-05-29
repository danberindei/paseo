import { useEffect, useMemo } from "react";
import { usePathname } from "expo-router";
import { getIsElectronRuntime } from "@/constants/layout";
import { getDesktopHost } from "@/desktop/host";
import { isWeb } from "@/constants/platform";
import { useWorkspaceProjectName } from "@/hooks/use-workspace-project-name";
import { selectActiveSpace, useSpaceStore } from "@/stores/space-store";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import { formatWindowTitle, getWorkspaceTabTitleLabel } from "@/utils/window-title";

export function useWindowTitle() {
  const activeSpace = useSpaceStore(selectActiveSpace);
  const pathname = usePathname();
  const workspaceRoute = useMemo(() => parseHostWorkspaceRouteFromPathname(pathname), [pathname]);
  const workspaceKey = workspaceRoute
    ? `${workspaceRoute.serverId}:${workspaceRoute.workspaceId}`
    : null;
  const projectName = useWorkspaceProjectName(
    workspaceRoute?.serverId ?? null,
    workspaceRoute?.workspaceId ?? null,
  );
  const workspaceLayout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? (state.layoutByWorkspace[workspaceKey] ?? null) : null,
  );
  const activeTabLabel = useMemo(() => {
    if (!workspaceLayout) {
      return null;
    }

    const tabs = collectAllTabs(workspaceLayout.root);
    const { activeTab } = deriveWorkspacePaneState({ layout: workspaceLayout, tabs });
    return activeTab ? getWorkspaceTabTitleLabel(activeTab.descriptor.target) : null;
  }, [workspaceLayout]);

  useEffect(() => {
    if (!isWeb || !getIsElectronRuntime()) return;

    const win = getDesktopHost()?.window?.getCurrentWindow?.();
    if (typeof win?.setTitle !== "function") return;

    const title = formatWindowTitle({
      spaceName: activeSpace?.name,
      projectName,
      tabLabel: activeTabLabel,
    });
    void win.setTitle(title);
  }, [activeSpace, projectName, activeTabLabel]);
}
