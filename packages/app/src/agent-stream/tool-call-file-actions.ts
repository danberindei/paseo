import { resolveWorkspaceFilePaths } from "@/workspace/file-open";
import type { OpenDesktopTargetInput } from "@/workspace/desktop-open-targets";

/**
 * Resolves the path to copy for a tool call's file action, preferring the absolute
 * host path and falling back to the raw path when it cannot be resolved against
 * the workspace root (e.g. no workspace root, or a `~`-relative path).
 */
export function resolveToolCallCopyPath(filePath: string, workspaceRoot: string): string {
  const resolved = resolveWorkspaceFilePaths({ path: filePath, workspaceRoot });
  return resolved?.absolutePath ?? filePath;
}

/**
 * Builds the input for opening a tool call's file in the preferred editor, or null
 * when there is no preferred editor or the path cannot be resolved to an absolute
 * host path.
 */
export function resolveToolCallEditorOpenInput(input: {
  filePath: string;
  workspaceRoot: string;
  editorId: string | null;
}): OpenDesktopTargetInput | null {
  if (!input.editorId) {
    return null;
  }
  const resolved = resolveWorkspaceFilePaths({
    path: input.filePath,
    workspaceRoot: input.workspaceRoot,
  });
  if (!resolved) {
    return null;
  }
  return {
    editorId: input.editorId,
    workspacePath: input.workspaceRoot,
    filePath: resolved.absolutePath,
  };
}
