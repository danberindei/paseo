import type { WorkspaceDescriptor } from "@/stores/session-store";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeWorkspaceOpaqueId(value: string | null | undefined): string | null {
  return trimNonEmpty(value);
}

export function normalizeWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = trimNonEmpty(value);
  if (!trimmed) {
    return null;
  }
  const withUnixSeparators = trimmed.replace(/\\/g, "/");
  if (withUnixSeparators === "/") {
    return withUnixSeparators;
  }
  const withoutTrailingSlash = withUnixSeparators.replace(/\/+$/, "");
  return withoutTrailingSlash.length > 0 ? withoutTrailingSlash : "/";
}

export function resolveWorkspaceRouteId(input: {
  routeWorkspaceId: string | null | undefined;
}): string | null {
  return normalizeWorkspaceOpaqueId(input.routeWorkspaceId);
}

export function resolveWorkspaceIdByExecutionDirectory(input: {
  workspaces: Iterable<WorkspaceDescriptor> | null | undefined;
  workspaceDirectory: string | null | undefined;
}): string | null {
  const normalizedWorkspaceDirectory = normalizeWorkspacePath(input.workspaceDirectory);
  if (!normalizedWorkspaceDirectory) {
    return null;
  }

  let bestMatchId: string | null = null;
  let bestMatchLength = -1;

  for (const workspace of input.workspaces ?? []) {
    const normalizedDir = normalizeWorkspacePath(workspace.workspaceDirectory);
    if (!normalizedDir) {
      continue;
    }
    if (normalizedWorkspaceDirectory === normalizedDir) {
      return workspace.id;
    }
    if (
      normalizedWorkspaceDirectory.startsWith(normalizedDir + "/") &&
      normalizedDir.length > bestMatchLength
    ) {
      bestMatchId = workspace.id;
      bestMatchLength = normalizedDir.length;
    }
  }

  return bestMatchId;
}

export function resolveWorkspaceMapKeyByIdentity(input: {
  workspaces: Map<string, WorkspaceDescriptor> | null | undefined;
  workspaceId: string | null | undefined;
}): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!normalizedWorkspaceId) {
    return null;
  }

  const workspaces = input.workspaces;
  if (!workspaces) {
    return null;
  }

  if (workspaces.has(normalizedWorkspaceId)) {
    return normalizedWorkspaceId;
  }

  for (const [workspaceKey, workspace] of workspaces) {
    if (normalizeWorkspaceOpaqueId(workspace.id) === normalizedWorkspaceId) {
      return workspaceKey;
    }
  }

  return null;
}
