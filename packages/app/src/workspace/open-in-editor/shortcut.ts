import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import type { WorkspaceOpenInEditorTargets } from "@/workspace/open-in-editor/targets";

export const WORKSPACE_OPEN_IN_EDITOR_ACTIONS: readonly KeyboardActionId[] = [
  "workspace.open-in-editor",
];

interface UseWorkspaceOpenInEditorShortcutInput {
  handlerId: string;
  targets: WorkspaceOpenInEditorTargets;
  /** The focused workspace route owns the action; other routes must not answer it. */
  routeOwned: boolean;
}

/**
 * Registers the open-in-editor shortcut for the workspace screen.
 *
 * The header control must not own this action: desktop focus mode unmounts the header, and the
 * shortcut still has to open the workspace there. The screen mounts this alongside the header, so
 * the key answers from the same plan the control renders.
 */
export function useWorkspaceOpenInEditorShortcut({
  handlerId,
  targets,
  routeOwned,
}: UseWorkspaceOpenInEditorShortcutInput) {
  useKeyboardActionHandler({
    handlerId,
    actions: WORKSPACE_OPEN_IN_EDITOR_ACTIONS,
    enabled: routeOwned && targets.canOpen,
    priority: 100,
    handle: () => targets.openPrimary(),
  });
}
