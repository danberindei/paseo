import type { FetchAgentsEntry } from "@getpaseo/client/internal/daemon-client";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProjectPlacement } from "@/utils/project-placement";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

type AgentDirectoryFetchEntry = FetchAgentsEntry;
export type AgentDirectoryDelta = Extract<
  SessionOutboundMessage,
  { type: "agent_update" }
>["payload"];

interface PendingPermissionEntry {
  key: string;
  agentId: string;
  request: Agent["pendingPermissions"][number];
}

function selectAgentTombstones(serverId: string, agentId: string): Set<string> | undefined {
  return useSessionStore.getState().sessions[serverId]?.resolvedPermissionIds.get(agentId);
}

export function filterAgentPendingPermissions(
  serverId: string,
  agentId: string,
  requests: AgentPermissionRequest[],
): AgentPermissionRequest[] {
  const tombstones = selectAgentTombstones(serverId, agentId);
  if (!tombstones || tombstones.size === 0) {
    return requests;
  }
  const filtered = requests.filter((request) => !tombstones.has(request.id));
  return filtered.length === requests.length ? requests : filtered;
}

export function isRequestTombstoned(serverId: string, agentId: string, requestId: string): boolean {
  return selectAgentTombstones(serverId, agentId)?.has(requestId) ?? false;
}

export function buildAgentDirectoryState(input: {
  serverId: string;
  entries: AgentDirectoryFetchEntry[];
}): {
  agents: Map<string, Agent>;
  pendingPermissions: Map<string, PendingPermissionEntry>;
} {
  const agents = new Map<string, Agent>();
  const pendingPermissions = new Map<string, PendingPermissionEntry>();

  for (const entry of input.entries) {
    const normalized = normalizeAgentSnapshot(entry.agent, input.serverId);
    const projectPlacement = resolveProjectPlacement({
      projectPlacement: entry.project,
      cwd: normalized.cwd,
    });
    const agent: Agent = {
      ...normalized,
      projectPlacement,
    };
    agents.set(agent.id, agent);

    for (const request of filterAgentPendingPermissions(
      input.serverId,
      agent.id,
      agent.pendingPermissions,
    )) {
      const key = derivePendingPermissionKey(agent.id, request);
      pendingPermissions.set(key, { key, agentId: agent.id, request });
    }
  }

  return { agents, pendingPermissions };
}
