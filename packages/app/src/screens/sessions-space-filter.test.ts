import { describe, expect, it } from "vitest";
import {
  buildWorkspaceProjectIdIndex,
  filterAgentsBySpaceProjectIds,
  type SpaceFilterAgent,
  type SpaceFilterSessions,
} from "./sessions-space-filter";

interface TestAgent extends SpaceFilterAgent {
  id: string;
}

function makeSessions(
  entries: Record<string, Array<{ id: string; projectId: string }>>,
): SpaceFilterSessions {
  return Object.fromEntries(
    Object.entries(entries).map(([serverId, workspaces]) => [
      serverId,
      {
        workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace] as const)),
      },
    ]),
  );
}

function ids(agents: TestAgent[]): string[] {
  return agents.map((agent) => agent.id);
}

describe("filterAgentsBySpaceProjectIds", () => {
  it("keeps every agent when no space is active", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_a", projectId: "project-a" }],
    });
    const agents: TestAgent[] = [
      { id: "with-workspace", serverId: "srv_a", workspaceId: "ws_a" },
      { id: "without-workspace", serverId: "srv_a", projectPlacement: null },
    ];

    const result = filterAgentsBySpaceProjectIds(
      agents,
      null,
      buildWorkspaceProjectIdIndex(sessions),
    );

    expect(result).toBe(agents);
  });

  it("hides every agent when the active space has no projects", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_a", projectId: "project-a" }],
    });
    const agents: TestAgent[] = [
      { id: "a", serverId: "srv_a", workspaceId: "ws_a" },
      { id: "b", serverId: "srv_b", projectPlacement: { projectKey: "project-b" } },
    ];

    expect(
      filterAgentsBySpaceProjectIds(agents, [], buildWorkspaceProjectIdIndex(sessions)),
    ).toEqual([]);
  });

  it("separates workspaces that share a directory on different hosts", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_1", projectId: "project-a" }],
      srv_b: [{ id: "ws_1", projectId: "project-b" }],
    });
    const agents: TestAgent[] = [
      { id: "host-a", serverId: "srv_a", workspaceId: "ws_1" },
      { id: "host-b", serverId: "srv_b", workspaceId: "ws_1" },
      { id: "host-c", serverId: "srv_c", workspaceId: "ws_1" },
    ];

    const result = filterAgentsBySpaceProjectIds(
      agents,
      ["project-a"],
      buildWorkspaceProjectIdIndex(sessions),
    );

    expect(ids(result)).toEqual(["host-a"]);
  });

  it("filters by the workspace's project instead of the directory project", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_1", projectId: "project-a" }],
    });
    const agents: TestAgent[] = [
      // A stale placement from another checkout of the same directory must not win.
      {
        id: "stale-placement",
        serverId: "srv_a",
        workspaceId: "ws_1",
        projectPlacement: { projectKey: "project-b" },
      },
    ];

    const result = filterAgentsBySpaceProjectIds(
      agents,
      ["project-a"],
      buildWorkspaceProjectIdIndex(sessions),
    );

    expect(ids(result)).toEqual(["stale-placement"]);
  });

  it("falls back to the recorded placement when the workspace is gone", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_1", projectId: "project-a" }],
    });
    const agents: TestAgent[] = [
      {
        id: "archived",
        serverId: "srv_a",
        workspaceId: "ws_removed",
        projectPlacement: { projectKey: "project-a" },
      },
    ];

    const result = filterAgentsBySpaceProjectIds(
      agents,
      ["project-a"],
      buildWorkspaceProjectIdIndex(sessions),
    );

    expect(ids(result)).toEqual(["archived"]);
  });

  it("hides agents with no workspace and no placement", () => {
    const sessions = makeSessions({
      srv_a: [{ id: "ws_1", projectId: "project-a" }],
    });
    const agents: TestAgent[] = [
      { id: "unresolved", serverId: "srv_a", workspaceId: "ws_removed" },
      { id: "out-of-space", serverId: "srv_a", projectPlacement: { projectKey: "project-z" } },
    ];

    expect(
      filterAgentsBySpaceProjectIds(agents, ["project-a"], buildWorkspaceProjectIdIndex(sessions)),
    ).toEqual([]);
  });
});
