import { describe, expect, it } from "vitest";
import type { DaemonClient, FetchAgentsEntry } from "@getpaseo/client/internal/daemon-client";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { AgentPermissionRequest } from "@getpaseo/protocol/agent-types";
import { useSessionStore } from "@/stores/session-store";
import { isRequestTombstoned } from "@/utils/agent-directory-sync";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { isAgentArchiving, setAgentArchiving } from "@/hooks/use-archive-agent";
import { queryClient } from "@/data/query-client";
import { createUserMessage } from "@/types/stream";
import { AgentStoreProjection } from "@/runtime/directory-sync/internal/agent-store";

function createAgentPayload(
  input: Partial<Omit<AgentSnapshotPayload, "labels">> & {
    id: string;
    labels?: Record<string, string>;
  },
): AgentSnapshotPayload {
  return {
    id: input.id,
    provider: input.provider ?? "codex",
    cwd: input.cwd ?? "/repo",
    model: input.model ?? null,
    createdAt: input.createdAt ?? "2026-04-20T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-04-20T00:01:00.000Z",
    lastUserMessageAt: input.lastUserMessageAt ?? null,
    status: input.status ?? "idle",
    capabilities: input.capabilities ?? {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: input.currentModeId ?? null,
    availableModes: input.availableModes ?? [],
    pendingPermissions: input.pendingPermissions ?? [],
    persistence: input.persistence ?? null,
    title: input.title ?? null,
    labels: input.labels ?? {},
  };
}

function createEntry(agent: AgentSnapshotPayload): FetchAgentsEntry {
  return {
    agent,
    project: {
      projectKey: agent.cwd,
      projectName: "repo",
      checkout: {
        cwd: agent.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isPaseoOwnedWorktree: false,
        mainRepoRoot: null,
      },
    },
  };
}

function permission(id: string): AgentPermissionRequest {
  return { id, provider: "codex", name: id, kind: "tool", title: id };
}

function beginPendingSubmission(serverId: string, agentId: string): string {
  const clientMessageId = `client-${agentId}`;
  useSessionStore.getState().beginAgentMessageSubmission(
    serverId,
    agentId,
    createUserMessage({
      clientMessageId,
      text: "Run this",
      timestamp: new Date("2026-07-27T10:00:00.000Z"),
    }),
  );
  return clientMessageId;
}

describe("message submission authority", () => {
  it("does not settle a submission from an unrelated running transition", () => {
    const serverId = "server-running-is-not-submission-ack";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const clientMessageId = beginPendingSubmission(serverId, agentId);
    const agent = createAgentPayload({ id: agentId, status: "running" });
    new AgentStoreProjection(serverId).applyDelta({
      kind: "upsert",
      agent,
      project: createEntry(agent).project,
    });

    expect(useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)).toEqual([
      {
        clientMessageId,
        providerAcknowledged: false,
        rpcSettled: false,
      },
    ]);
    store.clearSession(serverId);
  });

  it("settles provider acknowledgement only when timeline ingestion reports it", () => {
    const serverId = "server-explicit-provider-ack";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const clientMessageId = beginPendingSubmission(serverId, agentId);
    store.setAgentStreamState(serverId, agentId, {
      tail: [
        createUserMessage({
          id: "provider-message",
          messageId: "provider-message",
          clientMessageId,
          text: "Run this",
          timestamp: new Date("2026-07-27T10:00:01.000Z"),
        }),
      ],
      head: [],
    });

    expect(
      useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)?.[0]
        ?.providerAcknowledged,
    ).toBe(false);

    store.setAgentStreamState(serverId, agentId, {
      acknowledgedClientMessageIds: [clientMessageId],
    });

    expect(
      useSessionStore.getState().sessions[serverId]?.messageSubmissions.get(agentId)?.[0]
        ?.providerAcknowledged,
    ).toBe(true);
    store.clearSession(serverId);
  });
});

describe("replaceFetchedAgentDirectory", () => {
  it("preserves timeline initialization while replacing directory state", () => {
    const serverId = "server-initializing";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    store.setInitializingAgents(serverId, new Map([["agent", true]]));

    new AgentStoreProjection(serverId).replaceFetched([
      createEntry(createAgentPayload({ id: "agent" })),
    ]);

    expect(useSessionStore.getState().sessions[serverId]?.initializingAgents.get("agent")).toBe(
      true,
    );
    store.clearSession(serverId);
  });

  it("re-derives parentAgentId every time an agent snapshot is ingested", () => {
    const serverId = "server-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);

    const projection = new AgentStoreProjection(serverId);
    projection.replaceFetched([
      createEntry(
        createAgentPayload({
          id: "child-1",
          labels: { [PARENT_AGENT_ID_LABEL]: "parent-a" },
        }),
      ),
    ]);

    projection.replaceFetched([
      createEntry(
        createAgentPayload({
          id: "child-1",
          labels: { [PARENT_AGENT_ID_LABEL]: "parent-b" },
        }),
      ),
    ]);

    expect(
      useSessionStore.getState().sessions[serverId]?.agents.get("child-1")?.parentAgentId,
    ).toBe("parent-b");

    store.clearSession(serverId);
  });

  it.each(["directory", "entity"] as const)(
    "cleans removed %s state without invalidating an independent transcript",
    (kind) => {
      const serverId = "server-removal";
      const agentId = "removed-agent";
      const store = useSessionStore.getState();
      store.initializeSession(serverId, null as unknown as DaemonClient);
      const agent = {
        ...normalizeAgentSnapshot(createAgentPayload({ id: agentId }), serverId),
        projectPlacement: null,
      };
      store.setAgents(serverId, new Map([[agentId, agent]]));
      store.setAgentDetails(serverId, new Map([[agentId, agent]]));
      store.setQueuedMessages(
        serverId,
        new Map([[agentId, [{ id: "queued", text: "next", attachments: [] }]]]),
      );
      store.setAgentTimelineCursor(
        serverId,
        new Map([[agentId, { epoch: "epoch", startSeq: 1, endSeq: 2 }]]),
      );
      store.setPendingPermissions(
        serverId,
        new Map([["permission", { key: "permission", agentId, request: null as never }]]),
      );
      store.setInitializingAgents(serverId, new Map([[agentId, true]]));
      setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });

      const projection = new AgentStoreProjection(serverId);
      if (kind === "directory") projection.applyDelta({ kind: "remove", agentId });
      else projection.remove(agentId);

      const session = useSessionStore.getState().sessions[serverId];
      expect({
        agents: session?.agents.has(agentId),
        details: session?.agentDetails.has(agentId),
        queued: session?.queuedMessages.has(agentId),
        cursor: session?.agentTimelineCursor.has(agentId),
        permissions: session?.pendingPermissions.size,
        initializing: session?.initializingAgents.has(agentId),
        archivePending: isAgentArchiving({ queryClient, serverId, agentId }),
      }).toEqual({
        agents: false,
        details: false,
        queued: false,
        cursor: kind === "directory",
        permissions: 0,
        initializing: false,
        archivePending: false,
      });

      store.clearSession(serverId);
    },
  );

  it("keeps newer metadata while accepting usage-only updates and legacy workspace ownership", () => {
    const serverId = "server-usage";
    const agentId = "usage-agent";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    store.setWorkspaces(
      serverId,
      new Map([
        [
          "legacy-workspace",
          {
            id: "legacy-workspace",
            projectId: "project",
            projectDisplayName: "Project",
            projectRootPath: "/repo",
            workspaceDirectory: "/repo",
            projectKind: "git",
            workspaceKind: "worktree",
            name: "repo",
            status: "done",
            createdAt: null,
            lastUserMessageAt: null,
            statusEnteredAt: null,
            archivingAt: null,
            diffStat: null,
            scripts: [],
          },
        ],
      ]),
    );
    const current = createAgentPayload({
      id: agentId,
      title: "current",
      status: "running",
      updatedAt: "2026-07-12T11:00:00.000Z",
      lastUsage: { inputTokens: 10, outputTokens: 5 },
      pendingPermissions: [permission("current-permission")],
    });
    const projection = new AgentStoreProjection(serverId);
    projection.applyDelta({
      kind: "upsert",
      agent: current,
      project: createEntry(current).project,
    });
    store.flushAgentLastActivity();
    setAgentArchiving({ queryClient, serverId, agentId, isArchiving: true });

    const staleResult = projection.applyDelta({
      kind: "upsert",
      agent: {
        ...current,
        title: "stale",
        status: "idle",
        updatedAt: "2026-07-12T10:00:00.000Z",
        lastUsage: { inputTokens: 20, outputTokens: 8 },
        pendingPermissions: [permission("stale-permission")],
        archivedAt: "2026-07-12T10:00:00.000Z",
      },
      project: createEntry(current).project,
    });
    store.flushAgentLastActivity();

    const state = useSessionStore.getState();
    const agent = state.sessions[serverId]?.agents.get(agentId);
    expect({
      title: agent?.title,
      status: agent?.status,
      usage: agent?.lastUsage,
      workspaceId: agent?.workspaceId,
      stoppedRunning: staleResult.stoppedRunning,
      permissions: Array.from(state.sessions[serverId]?.pendingPermissions.values() ?? []).map(
        ({ request }) => request.id,
      ),
      archivePending: isAgentArchiving({ queryClient, serverId, agentId }),
      activity: state.agentLastActivity.get(agentId)?.toISOString(),
    }).toEqual({
      title: "current",
      status: "running",
      usage: { inputTokens: 20, outputTokens: 8 },
      workspaceId: "legacy-workspace",
      stoppedRunning: false,
      permissions: ["current-permission"],
      archivePending: true,
      activity: "2026-07-12T11:00:00.000Z",
    });

    store.clearSession(serverId);
  });
});

describe("resolved permission tombstones", () => {
  function pendingRequestIds(serverId: string): string[] {
    const pending = useSessionStore.getState().sessions[serverId]?.pendingPermissions;
    return Array.from(pending?.values() ?? [], (entry) => entry.request.id);
  }

  // Mirrors what the session context does on agent_permission_resolved before the daemon's
  // directory catches up: the request is tombstoned and its pending entry is removed.
  function resolvePermission(serverId: string, agentId: string, requestId: string): void {
    const store = useSessionStore.getState();
    store.addResolvedPermissionIds(serverId, agentId, [requestId]);
    store.setPendingPermissions(serverId, (previous) => {
      const next = new Map(previous);
      for (const [key, entry] of next) {
        if (entry.agentId === agentId && entry.request.id === requestId) next.delete(key);
      }
      return next;
    });
  }

  it("does not restore a resolved permission from a stale directory update", () => {
    const serverId = "server-stale-resolved-permission";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const projection = new AgentStoreProjection(serverId);
    const current = createAgentPayload({
      id: agentId,
      updatedAt: "2026-04-20T00:02:00.000Z",
      pendingPermissions: [permission("req-1")],
    });
    projection.applyDelta({
      kind: "upsert",
      agent: current,
      project: createEntry(current).project,
    });
    expect(pendingRequestIds(serverId)).toEqual(["req-1"]);

    resolvePermission(serverId, agentId, "req-1");
    expect(pendingRequestIds(serverId)).toEqual([]);

    projection.applyDelta({
      kind: "upsert",
      agent: { ...current, updatedAt: "2026-04-20T00:01:00.000Z" },
      project: createEntry(current).project,
    });

    expect(pendingRequestIds(serverId)).toEqual([]);
    expect(isRequestTombstoned(serverId, agentId, "req-1")).toBe(true);
    store.clearSession(serverId);
  });

  it("keeps an unresolved request from the same update and drops the tombstoned one", () => {
    const serverId = "server-mixed-resolved-permission";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const projection = new AgentStoreProjection(serverId);
    const first = createAgentPayload({
      id: agentId,
      updatedAt: "2026-04-20T00:01:00.000Z",
      pendingPermissions: [permission("req-1")],
    });
    projection.applyDelta({ kind: "upsert", agent: first, project: createEntry(first).project });
    resolvePermission(serverId, agentId, "req-1");

    const next = createAgentPayload({
      id: agentId,
      updatedAt: "2026-04-20T00:03:00.000Z",
      pendingPermissions: [permission("req-1"), permission("req-2")],
    });
    projection.applyDelta({ kind: "upsert", agent: next, project: createEntry(next).project });

    expect(pendingRequestIds(serverId)).toEqual(["req-2"]);
    expect(isRequestTombstoned(serverId, agentId, "req-1")).toBe(true);
    expect(isRequestTombstoned(serverId, agentId, "req-2")).toBe(false);
    store.clearSession(serverId);
  });

  it("does not restore a resolved permission from a fetched directory snapshot", () => {
    const serverId = "server-snapshot-resolved-permission";
    const agentId = "agent-1";
    const store = useSessionStore.getState();
    store.initializeSession(serverId, null as unknown as DaemonClient);
    const projection = new AgentStoreProjection(serverId);
    const first = createAgentPayload({
      id: agentId,
      updatedAt: "2026-04-20T00:01:00.000Z",
      pendingPermissions: [permission("req-1")],
    });
    projection.replaceFetched([createEntry(first)]);
    resolvePermission(serverId, agentId, "req-1");

    projection.replaceFetched([
      createEntry(
        createAgentPayload({
          id: agentId,
          updatedAt: "2026-04-20T00:03:00.000Z",
          pendingPermissions: [permission("req-1"), permission("req-2")],
        }),
      ),
    ]);

    expect(pendingRequestIds(serverId)).toEqual(["req-2"]);
    expect(isRequestTombstoned(serverId, agentId, "req-1")).toBe(true);
    store.clearSession(serverId);
  });
});
