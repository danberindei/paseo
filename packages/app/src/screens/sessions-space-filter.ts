/**
 * Active-space filtering for the Sessions history list.
 *
 * A space stores project ids. The same workspace directory can exist on two
 * hosts as different projects, so workspace lookups are keyed by host and
 * workspace id; the directory alone is not a workspace identity.
 */
export interface SpaceFilterAgent {
  serverId: string;
  workspaceId?: string;
  projectPlacement?: { projectKey: string } | null;
}

export interface SpaceFilterWorkspace {
  id: string;
  projectId: string;
}

export type SpaceFilterSessions = Record<
  string,
  { workspaces: ReadonlyMap<string, SpaceFilterWorkspace> } | undefined
>;

function workspaceKey(serverId: string, workspaceId: string): string {
  return `${serverId}\u0000${workspaceId}`;
}

export function buildWorkspaceProjectIdIndex(sessions: SpaceFilterSessions): Map<string, string> {
  const index = new Map<string, string>();
  for (const [serverId, session] of Object.entries(sessions)) {
    if (!session) continue;
    for (const workspace of session.workspaces.values()) {
      index.set(workspaceKey(serverId, workspace.id), workspace.projectId);
    }
  }
  return index;
}

export function resolveAgentProjectId(
  agent: SpaceFilterAgent,
  index: ReadonlyMap<string, string>,
): string | null {
  if (agent.workspaceId) {
    const projectId = index.get(workspaceKey(agent.serverId, agent.workspaceId));
    if (projectId !== undefined) {
      return projectId;
    }
  }
  // History keeps agents whose workspace is no longer in the session store.
  // Their placement still names the project the space was defined with.
  return agent.projectPlacement?.projectKey ?? null;
}

/**
 * `null` means no active space, which keeps every agent visible. An empty id
 * list is an active space with no projects, which hides every agent and matches
 * the sidebar's project filter.
 */
export function filterAgentsBySpaceProjectIds<T extends SpaceFilterAgent>(
  agents: T[],
  spaceProjectIds: readonly string[] | null,
  index: ReadonlyMap<string, string>,
): T[] {
  if (spaceProjectIds === null) {
    return agents;
  }
  const projectIdSet = new Set(spaceProjectIds);
  return agents.filter((agent) => {
    const projectId = resolveAgentProjectId(agent, index);
    return projectId !== null && projectIdSet.has(projectId);
  });
}
