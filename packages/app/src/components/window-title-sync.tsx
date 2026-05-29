import { useMemo } from "react";
import { usePathname } from "expo-router";
import { useTranslation } from "react-i18next";
import { useWindowTitle } from "@/hooks/use-window-title";
import { useActiveSpace } from "@/stores/space-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import { usePanelRegistration } from "@/panels/panel-registry";
import { parseHostWorkspaceRouteFromPathname } from "@/utils/host-routes";
import type { WindowTitleInput } from "@/utils/window-title";

function WindowTitleEffect(input: WindowTitleInput) {
  useWindowTitle(input);
  return null;
}

export function WindowTitleSync() {
  const { t } = useTranslation();
  const activeSpace = useActiveSpace();
  const pathname = usePathname();
  const route = useMemo(() => parseHostWorkspaceRouteFromPathname(pathname), [pathname]);
  const workspaceKey = route ? `${route.serverId}:${route.workspaceId}` : null;
  const workspace = useWorkspaceFields(
    route?.serverId ?? null,
    route?.workspaceId ?? null,
    (w) => ({
      projectName: w.projectCustomName ?? w.projectDisplayName,
      workspaceName: w.title ?? w.name,
    }),
  );
  const layout = useWorkspaceLayoutStore((state) =>
    workspaceKey ? (state.layoutByWorkspace[workspaceKey] ?? null) : null,
  );
  const activeTab = useMemo(() => {
    if (!layout) return null;
    const tabs = collectAllTabs(layout.root);
    return deriveWorkspacePaneState({ layout, tabs }).activeTab;
  }, [layout]);
  const tabRegistration = usePanelRegistration(activeTab?.descriptor.kind ?? null);
  const input: WindowTitleInput = {
    spaceName: activeSpace?.name,
    projectName: workspace?.projectName,
    workspaceName: workspace?.workspaceName,
  };

  // Panels register when the workspace screen mounts, which can be after this component first
  // renders on a reload with a restored tab. Show the title without a tab name until then rather
  // than resolving a presentation that does not exist yet.
  if (!route || !activeTab || !tabRegistration) {
    return <WindowTitleEffect {...input} />;
  }

  return (
    <WorkspaceTabPresentationResolver
      tab={activeTab.descriptor}
      serverId={route.serverId}
      workspaceId={route.workspaceId}
    >
      {(presentation) => {
        let tabLabel = presentation.label.trim() || t("workspace.tabs.fallback.workspace");
        if (presentation.titleState === "loading") {
          tabLabel = t("workspace.tabs.loading");
        }
        return <WindowTitleEffect {...input} tabLabel={tabLabel} />;
      }}
    </WorkspaceTabPresentationResolver>
  );
}
