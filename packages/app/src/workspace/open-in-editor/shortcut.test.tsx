/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import type { PlannedWorkspaceOpenTarget } from "@/workspace/open-in-editor/planner";
import { useWorkspaceOpenInEditorShortcut } from "@/workspace/open-in-editor/shortcut";
import type { WorkspaceOpenInEditorTargets } from "@/workspace/open-in-editor/targets";

const OPEN_IN_EDITOR: KeyboardActionDefinition = {
  id: "workspace.open-in-editor",
  scope: "workspace",
};

const PRIMARY_TARGET: PlannedWorkspaceOpenTarget = {
  source: "desktop",
  id: "vscode",
  label: "VS Code",
  editorId: "vscode",
  icon: { kind: "symbol", name: "terminal" },
  openInput: { editorId: "vscode", workspacePath: "/repo" },
};

function createTargets(
  overrides: Partial<WorkspaceOpenInEditorTargets> = {},
): WorkspaceOpenInEditorTargets {
  return {
    targets: [PRIMARY_TARGET],
    primaryTarget: PRIMARY_TARGET,
    preferredTargetId: "vscode",
    activeFileName: "app.ts",
    isOpening: false,
    canOpen: true,
    openTarget: vi.fn(),
    openPrimary: vi.fn(() => true),
    selectPreferredTarget: vi.fn(),
    ...overrides,
  };
}

// Nothing here renders the open-in-editor control. Desktop focus mode unmounts the header that
// hosts it, so the registration must answer the key on its own.
function renderShortcut(initial: { targets: WorkspaceOpenInEditorTargets; routeOwned?: boolean }) {
  return renderHook(
    (props: { targets: WorkspaceOpenInEditorTargets; routeOwned: boolean }) => {
      useWorkspaceOpenInEditorShortcut({
        handlerId: "workspace-open-in-editor:srv:ws",
        targets: props.targets,
        routeOwned: props.routeOwned,
      });
      return useKeyboardActionDispatcher();
    },
    {
      wrapper: KeyboardActionDispatcherProvider,
      initialProps: { targets: initial.targets, routeOwned: initial.routeOwned ?? true },
    },
  );
}

function dispatch(dispatcher: ReturnType<typeof useKeyboardActionDispatcher>): boolean {
  let handled = false;
  act(() => {
    handled = dispatcher.dispatch(OPEN_IN_EDITOR);
  });
  return handled;
}

describe("useWorkspaceOpenInEditorShortcut", () => {
  it("opens the primary target without a mounted header control", () => {
    const targets = createTargets();
    const { result } = renderShortcut({ targets });

    expect(dispatch(result.current)).toBe(true);
    expect(targets.openPrimary).toHaveBeenCalledTimes(1);
  });

  it("reads the latest controller instead of a captured action", () => {
    const first = createTargets();
    const second = createTargets({ activeFileName: "other.ts" });
    const { result, rerender } = renderShortcut({ targets: first });

    rerender({ targets: second, routeOwned: true });
    expect(dispatch(result.current)).toBe(true);

    expect(first.openPrimary).not.toHaveBeenCalled();
    expect(second.openPrimary).toHaveBeenCalledTimes(1);
  });

  it("releases the key when the workspace has no open target", () => {
    const targets = createTargets({
      targets: [],
      primaryTarget: null,
      preferredTargetId: null,
      canOpen: false,
    });
    const { result } = renderShortcut({ targets });

    expect(dispatch(result.current)).toBe(false);
    expect(targets.openPrimary).not.toHaveBeenCalled();
  });

  it("releases the key while an open is already in flight", () => {
    const targets = createTargets({ canOpen: false, isOpening: true });
    const { result } = renderShortcut({ targets });

    expect(dispatch(result.current)).toBe(false);
    expect(targets.openPrimary).not.toHaveBeenCalled();
  });

  it("releases the key when another route owns the workspace", () => {
    const targets = createTargets();
    const { result } = renderShortcut({ targets, routeOwned: false });

    expect(dispatch(result.current)).toBe(false);
    expect(targets.openPrimary).not.toHaveBeenCalled();
  });
});
