function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface WindowTitleInput {
  spaceName?: string | null;
  projectName?: string | null;
  workspaceName?: string | null;
  tabLabel?: string | null;
}

export function formatWindowTitle(input: WindowTitleInput): string {
  const titleParts = [
    trimNonEmpty(input.spaceName),
    trimNonEmpty(input.projectName),
    trimNonEmpty(input.workspaceName),
    trimNonEmpty(input.tabLabel),
  ].filter((value): value is string => Boolean(value));

  if (titleParts.length === 0) {
    return "Paseo";
  }

  return `${titleParts.join(" - ")} - Paseo`;
}
