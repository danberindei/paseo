import { hasDraftContent } from "@/composer/draft/input-draft-core";
import { toDraftInputIfReady, type DraftRecord } from "@/stores/draft-store/state";

const AGENT_DRAFT_KEY_PREFIX = "agent:";
const DRAFT_TAB_KEY_PREFIX = "draft:";

export interface UnsentComposerResolvers {
  serverIds: readonly string[];
  resolveAgentWorkspaceKey: (input: { serverId: string; agentId: string }) => string | null;
  resolveDraftTabWorkspaceKey: (input: { draftId: string }) => string | null;
}

// Which workspaces have an unsent composer draft on this client, as `${serverId}:${workspaceId}`
// keys. The draft store is keyed by agent/draft id, not workspace id, so each key is resolved
// back to its workspace through the caller's live agent and draft-tab indexes. `new-workspace`
// keys match neither prefix and are skipped: they have no workspace row yet.
export function buildUnsentComposerWorkspaceKeys(input: {
  drafts: Record<string, DraftRecord>;
  resolvers: UnsentComposerResolvers;
}): Set<string> {
  const workspaceKeys = new Set<string>();
  for (const [draftKey, record] of Object.entries(input.drafts)) {
    const draftInput = toDraftInputIfReady(record);
    if (!draftInput || !hasDraftContent(draftInput)) {
      continue;
    }
    const workspaceKey = resolveComposerWorkspaceKey(draftKey, input.resolvers);
    if (workspaceKey) {
      workspaceKeys.add(workspaceKey);
    }
  }
  return workspaceKeys;
}

function resolveComposerWorkspaceKey(
  draftKey: string,
  resolvers: UnsentComposerResolvers,
): string | null {
  if (draftKey.startsWith(AGENT_DRAFT_KEY_PREFIX)) {
    for (const serverId of resolvers.serverIds) {
      const prefix = `${AGENT_DRAFT_KEY_PREFIX}${serverId}:`;
      if (draftKey.startsWith(prefix)) {
        const agentId = draftKey.slice(prefix.length);
        return agentId ? resolvers.resolveAgentWorkspaceKey({ serverId, agentId }) : null;
      }
    }
    return null;
  }
  if (draftKey.startsWith(DRAFT_TAB_KEY_PREFIX)) {
    for (const serverId of resolvers.serverIds) {
      const prefix = `${DRAFT_TAB_KEY_PREFIX}${serverId}:`;
      if (draftKey.startsWith(prefix)) {
        const draftId = draftKey.slice(prefix.length);
        return draftId ? resolvers.resolveDraftTabWorkspaceKey({ draftId }) : null;
      }
    }
    return null;
  }
  return null;
}

export function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
