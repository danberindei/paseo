import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { readAgentNavTarget } from "@/utils/navigate-to-agent";

const SERVER_ID = "server-1";

function createAgent(input: Partial<Agent> & Pick<Agent, "id">): Agent {
  const { id, ...rest } = input;
  return {
    serverId: SERVER_ID,
    id,
    provider: "codex",
    status: "idle",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-01-01T00:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo/worktree",
    model: null,
    parentAgentId: null,
    labels: {},
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
    ...rest,
    turn: rest.turn ?? { phase: "idle", cancellationRequestId: null },
  };
}

function createWorkspace(input: Partial<WorkspaceDescriptor> & Pick<WorkspaceDescriptor, "id">) {
  const { id, ...rest } = input;
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id,
    projectId: "project-1",
    projectDisplayName: "getpaseo/paseo",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    projectKind: "git" as const,
    workspaceKind: "local_checkout" as const,
    name: id,
    status: "running" as const,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    archivingAt: null,
    ...rest,
  };
}

describe("readAgentNavTarget", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {}, agentLastActivity: new Map() });
    useSessionStore.getState().initializeSession(SERVER_ID, null);
  });

  it("reads the workspace and project from the agent record", () => {
    useSessionStore
      .getState()
      .mergeWorkspaces(SERVER_ID, [createWorkspace({ id: "workspace-1", projectId: "project-1" })]);
    useSessionStore
      .getState()
      .setAgents(
        SERVER_ID,
        new Map([["agent-1", createAgent({ id: "agent-1", workspaceId: "workspace-1" })]]),
      );

    expect(readAgentNavTarget({ serverId: SERVER_ID, agentId: "agent-1" })).toEqual({
      agentWorkspaceId: "workspace-1",
      projectId: "project-1",
    });
  });

  it("resolves the project from the workspace hint while the agent record is missing", () => {
    useSessionStore
      .getState()
      .mergeWorkspaces(SERVER_ID, [createWorkspace({ id: "workspace-1", projectId: "project-1" })]);

    expect(
      readAgentNavTarget({
        serverId: SERVER_ID,
        agentId: "agent-1",
        workspaceHint: "workspace-1",
      }),
    ).toEqual({ agentWorkspaceId: undefined, projectId: "project-1" });
  });

  it("prefers the agent record over a stale workspace hint", () => {
    useSessionStore
      .getState()
      .mergeWorkspaces(SERVER_ID, [
        createWorkspace({ id: "workspace-1", projectId: "project-1" }),
        createWorkspace({ id: "workspace-2", projectId: "project-2" }),
      ]);
    useSessionStore
      .getState()
      .setAgents(
        SERVER_ID,
        new Map([["agent-1", createAgent({ id: "agent-1", workspaceId: "workspace-2" })]]),
      );

    expect(
      readAgentNavTarget({ serverId: SERVER_ID, agentId: "agent-1", workspaceHint: "workspace-1" }),
    ).toEqual({ agentWorkspaceId: "workspace-2", projectId: "project-2" });
  });

  it("returns no project when neither the agent nor the hinted workspace is known", () => {
    expect(
      readAgentNavTarget({ serverId: SERVER_ID, agentId: "agent-1", workspaceHint: "workspace-1" }),
    ).toEqual({ agentWorkspaceId: undefined, projectId: null });
  });
});
