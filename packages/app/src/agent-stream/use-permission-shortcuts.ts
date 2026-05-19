import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  getPresentationOwnerSnapshot,
  parsePresentationOwnerSnapshot,
  PERMISSION_SHORTCUT_ACTIONS,
  registerPermissionShortcutClaims,
  subscribeOverlays,
  type PresentationOwner,
} from "@/keyboard";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { PaneHost } from "@/panels/panel-manifest";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PendingPermission } from "@/types/shared";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

/** Workspace-level priority; no other handler claims these action ids. */
const PERMISSION_SHORTCUT_PRIORITY = 100;

export interface PermissionShortcutActions {
  accept: () => void;
  deny: () => void;
  focus: () => void;
  isResponding: () => boolean;
}

interface PermissionShortcutCoordination {
  shortcutTargetKey: string | null;
  /** Whether this surface is the one that answers permission shortcuts right now. */
  isShortcutOwner: boolean;
  registerShortcutTarget: (key: string, actions: PermissionShortcutActions) => () => void;
  onStartResponding: (key: string) => void;
  onStopResponding: (key: string) => void;
}

interface PermissionShortcutSurface {
  /**
   * Namespaced per agent stream so retained panels in other workspaces or tabs
   * do not evict this surface's handler. The pane host and tab are appended so
   * two mounts of the same agent never share a handler.
   */
  handlerId: string;
  /** False while the panel is mounted but not shown. */
  isVisible: boolean;
}

export interface PermissionShortcutOwnershipInput {
  host: PaneHost;
  tabId: string;
  isVisible: boolean;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  /** The top covering surface for the workspace, or `null` when nothing covers it. */
  topPresentation: PresentationOwner | null;
}

/**
 * Selects the one surface that answers Alt+A/D/Q.
 *
 * The presentation registry reports the top covering surface for the workspace. A sheet that
 * hosts this pane's tab owns the shortcuts; a surface that hosts no permission card blocks the
 * panes under it instead of letting one of them answer. Explorer owns no keyboard shortcuts and
 * never answers even though it reports pane focus. With nothing covering the workspace, the main
 * pane owns it; hidden retained panels and non-interactive split panes are excluded first.
 */
export function ownsPermissionShortcuts({
  host,
  tabId,
  isVisible,
  isWorkspaceFocused,
  isPaneFocused,
  topPresentation,
}: PermissionShortcutOwnershipInput): boolean {
  if (!isVisible || !isWorkspaceFocused || !isPaneFocused) return false;
  if (host === "explorer") return false;
  if (!topPresentation) return host === "main";
  return host === "sheet" && topPresentation.hostedTabId === tabId;
}

export function usePermissionShortcuts(
  pendingPermissionItems: PendingPermission[],
  surface: PermissionShortcutSurface,
): PermissionShortcutCoordination {
  // A visible pane is not necessarily the keyboard owner: split panes keep both
  // tabs mounted, Explorer stays focused alongside the main pane, and a sheet
  // leaves the pane under it interactive.
  const paneContext = usePaneContext();
  const { isWorkspaceFocused, isPaneFocused } = usePaneFocus();
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: paneContext.serverId,
    workspaceId: paneContext.workspaceId,
  });
  const presentationSnapshot = useSyncExternalStore(
    subscribeOverlays,
    () => getPresentationOwnerSnapshot(workspaceKey),
    () => getPresentationOwnerSnapshot(workspaceKey),
  );
  const topPresentation = useMemo(
    () => parsePresentationOwnerSnapshot(presentationSnapshot),
    [presentationSnapshot],
  );
  const isEligible = ownsPermissionShortcuts({
    host: paneContext.host,
    tabId: paneContext.tabId,
    isVisible: surface.isVisible,
    isWorkspaceFocused,
    isPaneFocused,
    topPresentation,
  });
  const handlerId = `${surface.handlerId}:${paneContext.host}:${paneContext.tabId}`;
  const permissionShortcutTargetsRef = useRef(new Map<string, PermissionShortcutActions>());
  const pendingPermissionItemsRef = useRef(pendingPermissionItems);
  pendingPermissionItemsRef.current = pendingPermissionItems;
  const [respondingKeys, setRespondingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const respondingKeysRef = useRef(new Set<string>());
  const shortcutTargetKey = useMemo(
    () =>
      isEligible
        ? (pendingPermissionItems.find((p) => !respondingKeys.has(p.key))?.key ?? null)
        : null,
    [pendingPermissionItems, respondingKeys, isEligible],
  );
  const hasShortcutTarget = shortcutTargetKey !== null;
  useLayoutEffect(() => {
    if (hasShortcutTarget) return registerPermissionShortcutClaims();
  }, [hasShortcutTarget]);

  useEffect(() => {
    const currentKeys = new Set(pendingPermissionItems.map((p) => p.key));
    for (const k of respondingKeysRef.current) {
      if (!currentKeys.has(k)) respondingKeysRef.current.delete(k);
    }
    setRespondingKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (currentKeys.has(k)) next.add(k);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [pendingPermissionItems]);

  const handlePermissionStartResponding = useCallback((key: string) => {
    respondingKeysRef.current.add(key);
    setRespondingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const handlePermissionStopResponding = useCallback((key: string) => {
    respondingKeysRef.current.delete(key);
    setRespondingKeys((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const getEffectiveShortcutTarget = useCallback(() => {
    for (const item of pendingPermissionItemsRef.current) {
      if (respondingKeysRef.current.has(item.key)) continue;
      const target = permissionShortcutTargetsRef.current.get(item.key);
      if (target && !target.isResponding()) return target;
    }
    return null;
  }, []);

  const handlePermissionShortcutAction = useCallback(
    (action: KeyboardActionDefinition): boolean => {
      // Only the owning surface answers: `isEligible` excludes hidden retained
      // panels, Explorer, panes under a covering surface, and panes whose sheet
      // is not the top one.
      if (!isEligible) return false;
      const target = getEffectiveShortcutTarget();
      if (!target) return false;
      switch (action.id) {
        case "permission.accept":
          target.accept();
          return true;
        case "permission.deny":
          target.deny();
          return true;
        case "permission.focus":
          target.focus();
          return true;
        default:
          return false;
      }
    },
    [getEffectiveShortcutTarget, isEligible],
  );

  useKeyboardActionHandler({
    handlerId,
    actions: PERMISSION_SHORTCUT_ACTIONS,
    enabled: true,
    priority: PERMISSION_SHORTCUT_PRIORITY,
    isActive: () => isEligible && getEffectiveShortcutTarget() !== null,
    handle: handlePermissionShortcutAction,
  });

  const registerPermissionShortcutTarget = useCallback(
    (key: string, actions: PermissionShortcutActions) => {
      permissionShortcutTargetsRef.current.set(key, actions);
      return () => {
        const current = permissionShortcutTargetsRef.current.get(key);
        if (current === actions) {
          permissionShortcutTargetsRef.current.delete(key);
        }
      };
    },
    [],
  );

  return {
    shortcutTargetKey,
    isShortcutOwner: isEligible,
    registerShortcutTarget: registerPermissionShortcutTarget,
    onStartResponding: handlePermissionStartResponding,
    onStopResponding: handlePermissionStopResponding,
  };
}
