import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { resolvePreferredEditorId, usePreferredEditor } from "@/hooks/use-preferred-editor";
import { openExternalUrl } from "@/utils/open-external-url";
import { isAbsolutePath } from "@/utils/path";
import { isWeb } from "@/constants/platform";
import { openDesktopTarget, useDesktopOpenTargets } from "@/workspace/desktop-open-targets";
import { resolveWorkspaceFilePaths, type WorkspaceFileLocation } from "@/workspace/file-open";
import {
  planWorkspaceOpenTargets,
  type PlannedWorkspaceOpenTarget,
} from "@/workspace/open-in-editor/planner";

export interface WorkspaceOpenInEditorTargetsInput {
  serverId: string;
  /** Null while the route has no usable workspace directory. */
  workspaceDirectory: string | null;
  /**
   * Only the project id is read, for the preferred-editor scope. Callers pass the descriptor they
   * already hold instead of unpacking it.
   */
  project: { projectId: string | null } | null;
  activeFile?: WorkspaceFileLocation | null;
}

/**
 * Plan, execution and availability for the workspace open-in-editor targets.
 */
export interface WorkspaceOpenInEditorTargets {
  targets: PlannedWorkspaceOpenTarget[];
  primaryTarget: PlannedWorkspaceOpenTarget | null;
  preferredTargetId: string | null;
  activeFileName: string | null;
  isOpening: boolean;
  /** False when there is nothing to open or an open is already in flight. */
  canOpen: boolean;
  openTarget: (target: PlannedWorkspaceOpenTarget) => void;
  openPrimary: () => boolean;
  selectPreferredTarget: (targetId: string) => void;
}

/**
 * The screen calls this once and hands the result to both the header control and the shortcut, so
 * they share one plan, one preferred target and one in-flight mutation. Letting the header control
 * own it would tie the shortcut to that control being mounted, and desktop focus mode unmounts the
 * header.
 */
export function useWorkspaceOpenInEditorTargets({
  serverId,
  workspaceDirectory,
  project,
  activeFile,
}: WorkspaceOpenInEditorTargetsInput): WorkspaceOpenInEditorTargets {
  const { t } = useTranslation();
  const toast = useToast();
  const cwd = workspaceDirectory ?? "";
  const projectId = project?.projectId ?? null;
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const { preferredEditorId, updatePreferredEditor } = usePreferredEditor({ serverId, projectId });
  const { targets: desktopOpenTargets, isAvailable: isDesktopOpenAvailable } =
    useDesktopOpenTargets({
      isLocalExecution: isLocalDaemon,
      workspacePath: cwd,
    });

  const resolvedFile = useMemo(
    () =>
      activeFile ? resolveWorkspaceFilePaths({ path: activeFile.path, workspaceRoot: cwd }) : null,
    [activeFile, cwd],
  );
  const activeFileName = useMemo(
    () => resolvedFile?.absolutePath.split("/").findLast(Boolean) ?? null,
    [resolvedFile],
  );

  const canResolveWorkspace = isWeb && cwd.trim().length > 0 && isAbsolutePath(cwd);
  const shouldQueryCheckout = canResolveWorkspace && isConnected;

  const { status: checkoutStatus } = useCheckoutStatusQuery({
    serverId,
    cwd: shouldQueryCheckout ? cwd : "",
  });
  const { resolvedForge } = useCheckoutPrStatusQuery({
    serverId,
    cwd: shouldQueryCheckout ? cwd : "",
  });

  const targets = useMemo(
    () =>
      canResolveWorkspace
        ? planWorkspaceOpenTargets({
            workspaceDirectory: cwd,
            activeFile,
            resolvedActiveFile: resolvedFile,
            desktopTargets: desktopOpenTargets,
            canUseDesktopBridge: isDesktopOpenAvailable,
            isLocalExecution: isLocalDaemon,
            checkoutStatus,
            forge: resolvedForge,
          })
        : [],
    [
      activeFile,
      canResolveWorkspace,
      checkoutStatus,
      cwd,
      desktopOpenTargets,
      resolvedForge,
      isDesktopOpenAvailable,
      isLocalDaemon,
      resolvedFile,
    ],
  );

  const targetIds = useMemo(() => targets.map((target) => target.id), [targets]);
  const preferredTargetId = useMemo(
    () => resolvePreferredEditorId(targetIds, preferredEditorId),
    [targetIds, preferredEditorId],
  );
  const primaryTarget = targets.find((target) => target.id === preferredTargetId) ?? null;

  const openMutation = useMutation({
    mutationFn: (target: PlannedWorkspaceOpenTarget): Promise<void> =>
      target.source === "forge" ? openExternalUrl(target.url) : openDesktopTarget(target.openInput),
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : t("workspace.git.openInEditor.failedOpen"),
      );
    },
  });

  const openTarget = useCallback(
    (target: PlannedWorkspaceOpenTarget) => {
      openMutation.mutate(target);
    },
    [openMutation],
  );

  const isOpening = openMutation.isPending;
  const canOpen = canResolveWorkspace && primaryTarget !== null && !isOpening;

  const openPrimary = useCallback(() => {
    if (!canOpen || !primaryTarget) {
      return false;
    }
    openTarget(primaryTarget);
    return true;
  }, [canOpen, openTarget, primaryTarget]);

  const selectPreferredTarget = useCallback(
    (targetId: string) => {
      void updatePreferredEditor(targetId).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("common.errors.unableToSave"));
      });
    },
    [updatePreferredEditor, toast, t],
  );

  return useMemo(
    () => ({
      targets,
      primaryTarget,
      preferredTargetId,
      activeFileName,
      isOpening,
      canOpen,
      openTarget,
      openPrimary,
      selectPreferredTarget,
    }),
    [
      activeFileName,
      canOpen,
      isOpening,
      openPrimary,
      openTarget,
      preferredTargetId,
      primaryTarget,
      selectPreferredTarget,
      targets,
    ],
  );
}
