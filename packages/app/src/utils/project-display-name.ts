export function projectDisplayNameFromProjectId(projectId: string): string {
  const githubRemotePrefix = "remote:github.com/";
  if (projectId.startsWith(githubRemotePrefix)) {
    return abbreviateOwnerInDisplayName(projectId.slice(githubRemotePrefix.length)) || projectId;
  }

  const segments = projectId.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] || projectId;
}

// Abbreviates the owner segment of an "owner/repo" display name to its first
// character (e.g. "getpaseo/paseo" -> "g/paseo"). The leading initial keeps
// remote repos visually distinct from local ones, which have no owner segment.
// Idempotent: re-abbreviating "g/paseo" yields "g/paseo".
export function abbreviateOwnerInDisplayName(displayName: string): string {
  const slashIndex = displayName.indexOf("/");
  if (slashIndex <= 0) {
    return displayName;
  }
  const owner = displayName.slice(0, slashIndex);
  const rest = displayName.slice(slashIndex);
  return `${owner.charAt(0)}${rest}`;
}

export function projectIconPlaceholderLabelFromDisplayName(displayName: string): string {
  const trimmedDisplayName = displayName.trim();
  if (!trimmedDisplayName) {
    return "";
  }

  const segments = trimmedDisplayName.split("/").filter(Boolean);
  return segments[segments.length - 1] || trimmedDisplayName;
}
