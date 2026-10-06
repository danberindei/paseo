import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";
import { createProviderSnapshotManagerStub } from "../../test-utils/session-stubs.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import { AgentManager } from "../agent-manager.js";
import { AgentStorage } from "../agent-storage.js";
import type { CreatePaseoWorktreeWorkflowResult } from "../../worktree-session.js";
import { createAgentCommand } from "./create.js";
import { ForegroundPromptStart } from "../agent-run-state.js";
import type { ManagedAgent } from "../agent-manager.js";

const logger = createTestLogger();

function createRealAgentManager(storage: AgentStorage): AgentManager {
  return new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
}

async function removeRealAgentManagerWorkdir({
  agentManager,
  storage,
  workdir,
}: {
  agentManager: AgentManager;
  storage: AgentStorage;
  workdir: string;
}): Promise<void> {
  agentManager.prepareForShutdown();
  await Promise.all(agentManager.listAgents().map((agent) => agentManager.closeAgent(agent.id)));
  await agentManager.flushForShutdown();
  await storage.flush();
  rmSync(workdir, { recursive: true, force: true });
}

// Creates a worktree directory under repoRoot and reports it back as a fresh
// workspace so the command can stamp the agent with it (mirrors the production
// worktree service).
function fakeWorktreeCreator(args: { repoRoot: string; createdWorkspaceId: string }) {
  const worktreePath = join(args.repoRoot, "worktree");
  const workspaceCwd = join(worktreePath, "packages", "app");
  mkdirSync(workspaceCwd, { recursive: true });
  const workspace: PersistedWorkspaceRecord = {
    workspaceId: args.createdWorkspaceId,
    projectId: "project-test",
    cwd: workspaceCwd,
    kind: "worktree",
    displayName: "feature",
    title: null,
    branch: "feature",
    worktreeRoot: worktreePath,
    baseBranch: "main",
    isPaseoOwnedWorktree: true,
    mainRepoRoot: args.repoRoot,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    archivedAt: null,
  };
  return async (): Promise<CreatePaseoWorktreeWorkflowResult> => ({
    worktree: { worktreePath },
    intent: { kind: "branch-off", baseBranch: "main", branchName: "feature" },
    workspace,
    repoRoot: args.repoRoot,
    created: true,
  });
}

test("session create forwards clientMessageId to the initial prompt run options", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const streamAgent = vi.fn(() => (async function* noop() {})());
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent: vi.fn(async () => snapshot),
      getAgent: vi.fn(() => snapshot),
      tryRunOutOfBand: vi.fn(() => false),
      hasInFlightRun: vi.fn(() => false),
      reloadStalePluginSession: async () => {},
      streamAgent,
      waitForAgentRunStart: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
  };

  await createAgentCommand(dependencies, {
    kind: "session",
    config: { provider: "codex", cwd: "/tmp/paseo-create-test" },
    workspaceId: "ws-create-test",
    initialPrompt: "hello from create",
    clientMessageId: "msg-create-1",
    labels: {},
    provisionalTitle: null,
    firstAgentContext: { attachments: [] },
  });

  expect(streamAgent).toHaveBeenCalledWith(
    "agent-1",
    "hello from create",
    { clientMessageId: "msg-create-1" },
    expect.any(ForegroundPromptStart),
  );
});

test("session create validates the requested mode against the provider's modes", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "opencode",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const stub = createProviderSnapshotManagerStub();
  stub.resolveCreateConfig.mockRejectedValue(
    new Error("Invalid mode 'plan' for provider 'opencode'. Available modes: build, myplan"),
  );
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: stub.manager,
  };

  await expect(
    createAgentCommand(dependencies, {
      kind: "session",
      config: { provider: "opencode", cwd: "/tmp/paseo-create-test", modeId: "plan" },
      workspaceId: "ws-create-test",
      labels: {},
      provisionalTitle: null,
      firstAgentContext: { attachments: [] },
    }),
  ).rejects.toThrow("Invalid mode 'plan'");

  expect(stub.resolveCreateConfig).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "opencode",
      cwd: "/tmp/paseo-create-test",
      requestedMode: "plan",
    }),
  );
  expect(createAgent).not.toHaveBeenCalled();
});

test("session create applies the resolved mode from the provider create config", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "opencode",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const stub = createProviderSnapshotManagerStub();
  stub.resolveCreateConfig.mockResolvedValue({
    modeId: "build",
    providerOptions: { auto_accept: true },
  });
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
      getAgent: vi.fn(() => snapshot),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: stub.manager,
  };

  await createAgentCommand(dependencies, {
    kind: "session",
    config: { provider: "opencode", cwd: "/tmp/paseo-create-test", modeId: "build" },
    workspaceId: "ws-create-test",
    labels: {},
    provisionalTitle: null,
    firstAgentContext: { attachments: [] },
  });

  expect(createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      modeId: "build",
      providerOptions: { auto_accept: true },
    }),
    undefined,
    expect.anything(),
  );
});

test("mcp create accepts provider-only internal input and leaves model undefined", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "claude",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
      getAgent: vi.fn(() => snapshot),
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: {
      resolveCreateConfig: vi.fn(async (input) => {
        expect(input.provider).toBe("claude");
        return {};
      }),
    } as Parameters<typeof createAgentCommand>[0]["providerSnapshotManager"],
  };

  await createAgentCommand(dependencies, {
    kind: "mcp",
    provider: "claude",
    cwd: "/tmp/paseo-create-test",
    workspaceId: "ws-create-test",
    title: "provider default",
    initialPrompt: "hello",
    notifyOnFinish: false,
  });

  expect(createAgent).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: "claude",
      model: undefined,
    }),
    undefined,
    expect.objectContaining({
      workspaceId: "ws-create-test",
    }),
  );
});

test("session create stamps the requested workspaceId when no worktree setup runs", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);

  try {
    const { snapshot } = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-source",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
      },
    );

    const stored = await storage.get(snapshot.id);
    expect(stored?.workspaceId).toBe("ws-source");
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("mcp create stamps the new worktree's workspaceId, not the parent's", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const providerSnapshotManager = createProviderSnapshotManagerStub().manager;

  try {
    const { snapshot: parent } = await createAgentCommand(
      { agentManager, agentStorage: storage, logger, providerSnapshotManager },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-parent",
        labels: {},
        provisionalTitle: null,
        firstAgentContext: { attachments: [] },
      },
    );

    const { snapshot: child } = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager,
        createPaseoWorktree: fakeWorktreeCreator({
          repoRoot: workdir,
          createdWorkspaceId: "ws-new-worktree",
        }),
      },
      {
        kind: "mcp",
        provider: "codex/gpt-5.4",
        title: "child",
        initialPrompt: "do the thing",
        notifyOnFinish: false,
        callerAgentId: parent.id,
        worktree: { worktreeName: "feature", baseBranch: "main" },
      },
    );

    const storedChild = await storage.get(child.id);
    expect(storedChild?.workspaceId).toBe("ws-new-worktree");
    expect(child.cwd).toBe(join(workdir, "worktree", "packages", "app"));
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("mcp create exposes the created worktree before dispatching the initial prompt", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-worktree-callback-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const createdWorktree = await fakeWorktreeCreator({
    repoRoot: workdir,
    createdWorkspaceId: "ws-created-worktree",
  })();
  let observed:
    | {
        createdWorktree: CreatePaseoWorktreeWorkflowResult | null;
        lifecycle: ManagedAgent["lifecycle"] | null;
      }
    | undefined;

  try {
    await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: {
          async resolveCreateConfig() {
            return {};
          },
        },
        createPaseoWorktree: async () => createdWorktree,
      },
      {
        kind: "mcp",
        provider: "codex",
        cwd: workdir,
        title: "worktree callback",
        initialPrompt: "Say done.",
        notifyOnFinish: false,
        worktree: { worktreeName: "feature", baseBranch: "main" },
        onCreated: ({ agentId, createdWorktree: callbackWorktree }) => {
          observed = {
            createdWorktree: callbackWorktree,
            lifecycle: agentManager.getAgent(agentId)?.lifecycle ?? null,
          };
        },
      },
    );

    expect(observed).toEqual({ createdWorktree, lifecycle: "idle" });
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("session create keeps the prompt title after the initial prompt settles", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-title-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const title = "Implement auth retries with backoff";

  try {
    const { snapshot } = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir },
        workspaceId: "ws-title-source",
        initialPrompt: `${title}\n\ninclude tests`,
        labels: {},
        provisionalTitle: title,
        firstAgentContext: { attachments: [] },
      },
    );

    const created = await storage.get(snapshot.id);
    expect(created?.title).toBe(title);

    await agentManager.waitForAgentEvent(snapshot.id, { waitForActive: true });

    const settled = await storage.get(snapshot.id);
    expect(settled?.title).toBe(title);
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("session create keeps an explicit title after the initial prompt settles", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-explicit-title-test-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const title = "Explicit override";

  try {
    const { snapshot } = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
      },
      {
        kind: "session",
        config: { provider: "codex", cwd: workdir, title },
        workspaceId: "ws-explicit-title-source",
        initialPrompt: "Implement auth retries with backoff",
        labels: {},
        provisionalTitle: title,
        firstAgentContext: { attachments: [] },
      },
    );

    const created = await storage.get(snapshot.id);
    expect(created?.title).toBe(title);

    await agentManager.waitForAgentEvent(snapshot.id, { waitForActive: true });

    const settled = await storage.get(snapshot.id);
    expect(settled?.title).toBe(title);
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("session create with an internal config skips provider session persistence", async () => {
  const snapshot = {
    id: "agent-1",
    provider: "codex",
    cwd: "/tmp/paseo-create-test",
    runtimeInfo: null,
  } as ManagedAgent;
  const createAgent = vi.fn(async () => snapshot);
  const dependencies: Parameters<typeof createAgentCommand>[0] = {
    agentManager: {
      createAgent,
    } as unknown as Parameters<typeof createAgentCommand>[0]["agentManager"],
    agentStorage: {} as Parameters<typeof createAgentCommand>[0]["agentStorage"],
    logger: createTestLogger(),
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
  };
  const input = {
    kind: "session" as const,
    workspaceId: "ws-create-test",
    labels: {},
    provisionalTitle: null,
    firstAgentContext: { attachments: [] },
  };

  await createAgentCommand(dependencies, {
    ...input,
    config: { provider: "codex", cwd: "/tmp/paseo-create-test", internal: true },
  });
  await createAgentCommand(dependencies, {
    ...input,
    config: { provider: "codex", cwd: "/tmp/paseo-create-test" },
  });

  expect(createAgent).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ provider: "codex", internal: true }),
    undefined,
    expect.objectContaining({ persistSession: false }),
  );
  expect(createAgent.mock.calls[1]?.[0]).not.toHaveProperty("internal");
  expect(createAgent.mock.calls[1]?.[2]).not.toHaveProperty("persistSession");
});

test.each([false, true])(
  "MCP creation schedules titles only for ordinary agents (internal=%s)",
  async (internal) => {
    const workdir = mkdtempSync(join(tmpdir(), "create-agent-title-callback-"));
    const titleLogger = createTestLogger();
    const storage = new AgentStorage(join(workdir, "agents"), titleLogger);
    const agentManager = createRealAgentManager(storage);
    const scheduled: Array<{ agentId: string; prompt: string | undefined }> = [];
    try {
      const { snapshot } = await createAgentCommand(
        {
          agentManager,
          agentStorage: storage,
          logger: titleLogger,
          providerSnapshotManager: createProviderSnapshotManagerStub().manager,
          scheduleAgentTitle: (agent, context) =>
            scheduled.push({ agentId: agent.id, prompt: context.prompt }),
        },
        {
          kind: "mcp",
          provider: "codex",
          cwd: workdir,
          workspaceId: "ws-source",
          title: "Fix login",
          initialPrompt: "Fix login",
          notifyOnFinish: false,
          internal,
        },
      );
      expect(scheduled).toEqual(internal ? [] : [{ agentId: snapshot.id, prompt: "Fix login" }]);
    } finally {
      await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
    }
  },
);

test.each(["directory", "worktree"])(
  "MCP create in a new %s workspace schedules one title generation after agent creation",
  async (workspaceKind) => {
    const workdir = mkdtempSync(join(tmpdir(), "create-agent-mcp-workspace-title-"));
    const storage = new AgentStorage(join(workdir, "agents"), logger);
    const agentManager = createRealAgentManager(storage);
    const scheduled: Array<{ agentId: string; prompt: string | undefined }> = [];
    const independentTitles: string[] = [];

    try {
      const { snapshot } = await createAgentCommand(
        {
          agentManager,
          agentStorage: storage,
          logger,
          providerSnapshotManager: createProviderSnapshotManagerStub().manager,
          ensureWorkspaceForCreate: async (_cwd, _context, options) => {
            expect(options?.deferAutoName).toBe(true);
            expect(agentManager.listAgents()).toEqual([]);
            expect(scheduled).toEqual([]);
            return "ws-created-directory";
          },
          createPaseoWorktree: async (_input, options) => {
            expect(options?.deferAutoName).toBe(true);
            expect(agentManager.listAgents()).toEqual([]);
            expect(scheduled).toEqual([]);
            return fakeWorktreeCreator({
              repoRoot: workdir,
              createdWorkspaceId: "ws-created-worktree",
            })();
          },
          scheduleWorkspaceTitle: (agent, context) => {
            expect(agentManager.getAgent(agent.id)).toBeDefined();
            scheduled.push({ agentId: agent.id, prompt: context.prompt });
          },
          scheduleAgentTitle: (agent) => independentTitles.push(agent.id),
        },
        {
          kind: "mcp",
          provider: "codex",
          cwd: workdir,
          initialPrompt: "Fix login",
          notifyOnFinish: false,
          worktree:
            workspaceKind === "worktree"
              ? { worktreeName: "feature", baseBranch: "main" }
              : undefined,
        },
      );
      expect(scheduled).toEqual([{ agentId: snapshot.id, prompt: "Fix login" }]);
      expect(independentTitles).toEqual([]);
    } finally {
      await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
    }
  },
);

test("MCP create into a workspace minted by the caller schedules one shared title generation", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-mcp-caller-workspace-title-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const agentManager = createRealAgentManager(storage);
  const workspaceTitles: Array<{ agentId: string; prompt: string | undefined }> = [];
  const agentTitles: string[] = [];

  try {
    const { snapshot } = await createAgentCommand(
      {
        agentManager,
        agentStorage: storage,
        logger,
        providerSnapshotManager: createProviderSnapshotManagerStub().manager,
        scheduleWorkspaceTitle: (agent, context) =>
          workspaceTitles.push({ agentId: agent.id, prompt: context.prompt }),
        scheduleAgentTitle: (agent) => agentTitles.push(agent.id),
      },
      {
        kind: "mcp",
        provider: "codex",
        cwd: workdir,
        workspaceId: "ws-minted-by-caller",
        workspaceCreatedForAgent: true,
        title: "Fix login",
        initialPrompt: "Fix login",
        notifyOnFinish: false,
      },
    );
    expect(workspaceTitles).toEqual([{ agentId: snapshot.id, prompt: "Fix login" }]);
    expect(agentTitles).toEqual([]);
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test("MCP create does not schedule workspace naming when agent creation fails", async () => {
  const workdir = mkdtempSync(join(tmpdir(), "create-agent-mcp-title-failure-"));
  const storage = new AgentStorage(join(workdir, "agents"), logger);
  const failure = new Error("agent creation failed");
  const agentManager = new AgentManager({
    clients: createTestAgentClients({
      beforeCreateSession: async () => {
        throw failure;
      },
    }),
    registry: storage,
    logger,
  });
  const scheduled: string[] = [];

  try {
    await expect(
      createAgentCommand(
        {
          agentManager,
          agentStorage: storage,
          logger,
          providerSnapshotManager: createProviderSnapshotManagerStub().manager,
          ensureWorkspaceForCreate: async (_cwd, _context, options) => {
            expect(options?.deferAutoName).toBe(true);
            return "ws-created-directory";
          },
          scheduleWorkspaceTitle: (agent) => scheduled.push(agent.id),
        },
        {
          kind: "mcp",
          provider: "codex",
          cwd: workdir,
          initialPrompt: "Fix login",
          notifyOnFinish: false,
        },
      ),
    ).rejects.toThrow(failure);
    expect(scheduled).toEqual([]);
  } finally {
    await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
  }
});

test.each(["directory", "worktree"])(
  "MCP create in a new %s workspace skips naming when provider configuration fails",
  async (workspaceKind) => {
    const workdir = mkdtempSync(join(tmpdir(), "create-agent-mcp-config-failure-"));
    const storage = new AgentStorage(join(workdir, "agents"), logger);
    const agentManager = createRealAgentManager(storage);
    const scheduled: string[] = [];
    const failure = new Error("provider configuration failed");

    try {
      await expect(
        createAgentCommand(
          {
            agentManager,
            agentStorage: storage,
            logger,
            providerSnapshotManager: {
              async resolveCreateConfig() {
                throw failure;
              },
            },
            ensureWorkspaceForCreate: async (_cwd, _context, options) => {
              expect(options?.deferAutoName).toBe(true);
              return "ws-created-directory";
            },
            createPaseoWorktree: async (_input, options) => {
              expect(options?.deferAutoName).toBe(true);
              return fakeWorktreeCreator({
                repoRoot: workdir,
                createdWorkspaceId: "ws-created-worktree",
              })();
            },
            scheduleWorkspaceTitle: (agent) => scheduled.push(agent.id),
          },
          {
            kind: "mcp",
            provider: "codex",
            cwd: workdir,
            initialPrompt: "Fix login",
            notifyOnFinish: false,
            worktree:
              workspaceKind === "worktree"
                ? { worktreeName: "feature", baseBranch: "main" }
                : undefined,
          },
        ),
      ).rejects.toThrow(failure);
      expect(scheduled).toEqual([]);
      expect(agentManager.listAgents()).toEqual([]);
    } finally {
      await removeRealAgentManagerWorkdir({ agentManager, storage, workdir });
    }
  },
);
