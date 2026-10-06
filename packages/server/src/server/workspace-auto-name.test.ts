import pino from "pino";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentStorage } from "./agent/agent-storage.js";
import { createTestAgentClients } from "./test-utils/fake-agent-client.js";
import type { GeneratedWorkspaceName } from "./worktree-branch-name-generator.js";
import { expect, test } from "vitest";
import { AgentManager } from "./agent/agent-manager.js";
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
import { WorkspaceAutoName } from "./workspace-auto-name.js";
import { createPersistedWorkspaceRecord, type WorkspaceRegistry } from "./workspace-registry.js";
import { WorkspaceGitServiceImpl } from "./workspace-git-service.js";

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

test("auto-name preserves workspace archival that lands during its metadata write", async () => {
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-auto-name",
    projectId: "project-auto-name",
    cwd: "/workspace",
    kind: "directory",
    displayName: "workspace",
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
  });
  const mutationStarted = deferred();
  const allowMutation = deferred();
  const updateEmitted = deferred();
  const workspaceRegistry = {
    get: async () => workspace,
    update: async (_workspaceId, updater) => {
      mutationStarted.resolve();
      await allowMutation.promise;
      workspace = updater(workspace);
      return workspace;
    },
  } satisfies Pick<WorkspaceRegistry, "get" | "update">;
  const autoName = new WorkspaceAutoName({
    agentManager: new AgentManager({ clients: {}, logger: pino({ level: "silent" }) }),
    workspaceRegistry,
    workspaceGitService: new WorkspaceGitServiceImpl({
      logger: pino({ level: "silent" }),
      paseoHome: "/tmp",
    }),
    providerSnapshotManager: new ProviderSnapshotManager({ logger: pino({ level: "silent" }) }),
    readDaemonConfig: () => ({}),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => {},
    emitWorkspaceUpdateForWorkspaceId: async () => updateEmitted.resolve(),
    logger: pino({ level: "silent" }),
    generateWorkspaceName: async () => ({ title: "generated", branch: null }),
  });

  autoName.scheduleForDirectory({
    workspaceId: workspace.workspaceId,
    cwd: workspace.cwd,
    firstAgentContext: { prompt: "Name this workspace" },
  });
  await mutationStarted.promise;
  const archivedAt = "2026-08-08T00:01:00.000Z";
  workspace = { ...workspace, updatedAt: archivedAt, archivedAt };
  allowMutation.resolve();
  await updateEmitted.promise;

  expect(workspace).toMatchObject({
    title: "generated",
    archivedAt,
  });
});

interface TitleTestOptions {
  kind?: "directory" | "worktree";
  untrustedSource?: Parameters<typeof createPersistedWorkspaceRecord>[0]["untrustedSource"];
  generateAgentTitles?: boolean;
  generation: () => Promise<GeneratedWorkspaceName | null>;
}

async function createTitleTest(options: TitleTestOptions) {
  const directory = await mkdtemp(join(tmpdir(), "workspace-auto-name-title-"));
  const logger = pino({ level: "silent" });
  const storage = new AgentStorage(join(directory, "agents"), logger);
  const agentManager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const workspaceGitService = new WorkspaceGitServiceImpl({ logger, paseoHome: directory });
  const providerSnapshotManager = new ProviderSnapshotManager({ logger });
  let workspace = createPersistedWorkspaceRecord({
    workspaceId: "workspace-title-test",
    projectId: "project-title-test",
    cwd: directory,
    kind: options.kind ?? "directory",
    untrustedSource: options.untrustedSource,
    displayName: "workspace",
    title: "Fix login",
    createdAt: "2026-10-05T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  });
  const emitted = deferred();
  const autoName = new WorkspaceAutoName({
    agentManager,
    workspaceRegistry: {
      get: async () => workspace,
      update: async (_id, update) => {
        workspace = update(workspace);
        return workspace;
      },
    },
    workspaceGitService,
    providerSnapshotManager,
    readDaemonConfig: () => ({
      metadataGeneration: { generateAgentTitles: options.generateAgentTitles },
    }),
    gitMutation: { notifyGitMutation: async () => {} },
    emitWorkspaceUpdateForCwd: async () => emitted.resolve(),
    emitWorkspaceUpdateForWorkspaceId: async () => emitted.resolve(),
    logger,
    generateWorkspaceName: options.generation,
  });
  return {
    autoName,
    agentManager,
    storage,
    directory,
    emitted,
    workspace: () => workspace,
    createAgent: (title = "Fix login") =>
      agentManager.createAgent({ provider: "codex", cwd: directory }, undefined, {
        workspaceId: workspace.workspaceId,
        initialTitle: title,
      }),
    async close() {
      agentManager.prepareForShutdown();
      await Promise.all(
        agentManager.listAgents().map((agent) => agentManager.closeAgent(agent.id)),
      );
      await agentManager.flushForShutdown();
      await storage.flush();
      await workspaceGitService.dispose();
      await providerSnapshotManager.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function scheduleTitle(testCase: Awaited<ReturnType<typeof createTitleTest>>, agentId: string) {
  return testCase.autoName.scheduleForCreatedWorkspace({
    workspaceId: testCase.workspace().workspaceId,
    agentId,
    firstAgentContext: { prompt: "Fix login" },
  });
}

test("created workspaces from untrusted sources skip workspace and agent naming", async () => {
  let generationCount = 0;
  const testCase = await createTitleTest({
    kind: "worktree",
    untrustedSource: {
      kind: "change_request",
      forge: "github",
      number: 42,
      headRepository: "contributor/paseo",
    },
    generation: async () => {
      generationCount++;
      return { title: "Generated", branch: "generated" };
    },
  });
  try {
    const agent = await testCase.createAgent();
    await scheduleTitle(testCase, agent.id);
    expect(generationCount).toBe(0);
    expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
    expect(testCase.workspace().title).toBe("Fix login");
  } finally {
    await testCase.close();
  }
});

test("disabling agent titles while workspace metadata is generated preserves its title", async () => {
  const started = deferred();
  const generate = deferred();
  const options: TitleTestOptions = {
    generateAgentTitles: true,
    generation: async () => {
      started.resolve();
      await generate.promise;
      return { title: "Generated", branch: null };
    },
  };
  const testCase = await createTitleTest(options);
  try {
    const agent = await testCase.createAgent();
    const scheduled = scheduleTitle(testCase, agent.id);
    await started.promise;
    options.generateAgentTitles = false;
    generate.resolve();
    await scheduled;
    expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
    expect(testCase.workspace().title).toBe("Generated");
  } finally {
    generate.resolve();
    await testCase.close();
  }
});

test.each([
  { generateAgentTitles: undefined, expectedTitle: "Generated", generations: 1 },
  { generateAgentTitles: true, expectedTitle: "Generated", generations: 1 },
  { generateAgentTitles: false, expectedTitle: "Fix login", generations: 0 },
])(
  "agent title generation enabled=$generateAgentTitles leaves the workspace title alone",
  async ({ generateAgentTitles, expectedTitle, generations }) => {
    let generationCount = 0;
    const testCase = await createTitleTest({
      generateAgentTitles,
      generation: async () => {
        generationCount++;
        return { title: "Generated", branch: null };
      },
    });
    try {
      const agent = await testCase.createAgent();
      await testCase.autoName.scheduleForAgent({
        agentId: agent.id,
        cwd: testCase.directory,
        firstAgentContext: { prompt: "Fix login" },
      });
      expect((await testCase.storage.get(agent.id))?.title).toBe(expectedTitle);
      expect(testCase.workspace().title).toBe("Fix login");
      expect(generationCount).toBe(generations);
    } finally {
      await testCase.close();
    }
  },
);

test.each(["directory", "worktree"] as const)(
  "disabling agent titles preserves workspace naming for %s",
  async (kind) => {
    const testCase = await createTitleTest({
      kind,
      generateAgentTitles: false,
      generation: async () => ({ title: "Generated", branch: null }),
    });
    try {
      const agent = await testCase.createAgent();
      await scheduleTitle(testCase, agent.id);
      expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
      expect(testCase.workspace().title).toBe("Generated");
    } finally {
      await testCase.close();
    }
  },
);

test.each(["directory", "worktree"] as const)(
  "reuses one generated title for the created agent and its %s workspace",
  async (kind) => {
    let generationCount = 0;
    const testCase = await createTitleTest({
      kind,
      generation: async () => {
        generationCount++;
        expect(testCase.agentManager.listAgents()).toHaveLength(1);
        return { title: "Fix login retries", branch: null };
      },
    });
    try {
      const agent = await testCase.createAgent();
      expect(generationCount).toBe(0);
      await scheduleTitle(testCase, agent.id);
      expect(testCase.workspace().title).toBe("Fix login retries");
      expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login retries");
      expect(generationCount).toBe(1);
    } finally {
      await testCase.close();
    }
  },
);

test.each(["directory", "worktree"] as const)(
  "keeps the prompt title while workspace metadata is generated in a %s workspace",
  async (kind) => {
    const generate = deferred();
    let generationCount = 0;
    const testCase = await createTitleTest({
      kind,
      generation: async () => {
        generationCount++;
        await generate.promise;
        return { title: "Fix login retries", branch: null };
      },
    });
    try {
      const agent = await testCase.createAgent();
      const scheduled = scheduleTitle(testCase, agent.id);
      expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
      generate.resolve();
      await scheduled;
      expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login retries");
      expect(testCase.workspace().title).toBe("Fix login retries");
      expect(generationCount).toBe(1);
    } finally {
      generate.resolve();
      await testCase.close();
    }
  },
);

test.each([
  { title: "Fix login", expectedTitle: "Generated" },
  { title: "Custom title", expectedTitle: "Custom title" },
])(
  "compares the persisted title $title with the prompt title",
  async ({ title, expectedTitle }) => {
    const testCase = await createTitleTest({
      generation: async () => ({ title: "Generated", branch: null }),
    });
    try {
      const agent = await testCase.createAgent(title);
      const scheduled = scheduleTitle(testCase, agent.id);
      await scheduled;
      expect((await testCase.storage.get(agent.id))?.title).toBe(expectedTitle);
    } finally {
      await testCase.close();
    }
  },
);

test.each(["workspace", "agent"] as const)(
  "preserves an agent rename made while %s metadata generation runs",
  async (target) => {
    const generate = deferred();
    const started = deferred();
    const testCase = await createTitleTest({
      generation: async () => {
        started.resolve();
        await generate.promise;
        return { title: "Generated", branch: null };
      },
    });
    try {
      const agent = await testCase.createAgent();
      const scheduled =
        target === "workspace"
          ? scheduleTitle(testCase, agent.id)
          : testCase.autoName.scheduleForAgent({
              agentId: agent.id,
              cwd: testCase.directory,
              firstAgentContext: { prompt: "Fix login" },
            });
      await started.promise;
      await testCase.agentManager.updateAgentMetadata(agent.id, { title: "Manual rename" });
      generate.resolve();
      await scheduled;
      expect((await testCase.storage.get(agent.id))?.title).toBe("Manual rename");
    } finally {
      generate.resolve();
      await testCase.close();
    }
  },
);

test.each([
  { target: "workspace", generations: 1, workspaceTitle: "Generated" },
  { target: "agent", generations: 0, workspaceTitle: "Fix login" },
])(
  "an explicit agent title preserves $target naming eligibility",
  async ({ target, generations, workspaceTitle }) => {
    let generationCount = 0;
    const testCase = await createTitleTest({
      generation: async () => {
        generationCount++;
        return { title: "Generated", branch: null };
      },
    });
    try {
      const agent = await testCase.createAgent("Custom title");
      if (target === "workspace") {
        await scheduleTitle(testCase, agent.id);
      } else {
        await testCase.autoName.scheduleForAgent({
          agentId: agent.id,
          cwd: testCase.directory,
          firstAgentContext: { prompt: "Fix login" },
        });
      }
      expect(generationCount).toBe(generations);
      expect((await testCase.storage.get(agent.id))?.title).toBe("Custom title");
      expect(testCase.workspace().title).toBe(workspaceTitle);
    } finally {
      await testCase.close();
    }
  },
);

test.each([null, { title: null, branch: "fix-login" }])(
  "keeps the prompt title when generation produces %j",
  async (result) => {
    const completed = deferred();
    const testCase = await createTitleTest({
      generation: async () => {
        completed.resolve();
        return result;
      },
    });
    try {
      const agent = await testCase.createAgent();
      const scheduled = scheduleTitle(testCase, agent.id);
      await completed.promise;
      await scheduled;
      expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
      expect(testCase.workspace().title).toBe("Fix login");
    } finally {
      await testCase.close();
    }
  },
);

test("keeps the prompt title when metadata generation throws", async () => {
  const testCase = await createTitleTest({
    generation: async () => {
      throw new Error("Generation failed");
    },
  });
  try {
    const agent = await testCase.createAgent();
    await scheduleTitle(testCase, agent.id);
    expect((await testCase.storage.get(agent.id))?.title).toBe("Fix login");
    expect(testCase.workspace().title).toBe("Fix login");
  } finally {
    await testCase.close();
  }
});
