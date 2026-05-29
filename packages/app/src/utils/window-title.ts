import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function formatWindowTitle(input: {
  spaceName?: string | null;
  projectName?: string | null;
  tabLabel?: string | null;
}): string {
  const titleParts = [
    trimNonEmpty(input.spaceName),
    trimNonEmpty(input.projectName),
    trimNonEmpty(input.tabLabel),
  ].filter((value): value is string => Boolean(value));

  if (titleParts.length === 0) {
    return "Paseo";
  }

  return `${titleParts.join(" - ")} - Paseo`;
}

export function getWorkspaceTabTitleLabel(target: WorkspaceTabTarget): string {
  if (target.kind === "draft") {
    return "New Agent";
  }
  if (target.kind === "setup") {
    return "Setup";
  }
  if (target.kind === "terminal") {
    return "Terminal";
  }
  if (target.kind === "browser") {
    return "Browser";
  }
  if (target.kind === "file") {
    return target.path.split("/").findLast(Boolean) ?? target.path;
  }
  return "Agent";
}
