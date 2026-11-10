/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaceStore } from "@/stores/space-store";
import { findSpaceIdForProject, openAgentInProjectWindow } from "./open-agent-window";

const SPACES = [
  { id: "space-1", name: "One", projectIds: ["project-1"] },
  { id: "space-2", name: "Two", projectIds: ["project-2", "project-3"] },
];

describe("findSpaceIdForProject", () => {
  it("returns the space that lists the project", () => {
    expect(findSpaceIdForProject(SPACES, "project-3")).toBe("space-2");
  });

  it("returns the first space that lists the project", () => {
    expect(findSpaceIdForProject([...SPACES, { ...SPACES[0]!, id: "space-3" }], "project-1")).toBe(
      "space-1",
    );
  });

  it("returns null for a project outside every space", () => {
    expect(findSpaceIdForProject(SPACES, "project-missing")).toBeNull();
  });

  it("returns null without a resolved project", () => {
    expect(findSpaceIdForProject(SPACES, null)).toBeNull();
  });
});

describe("openAgentInProjectWindow", () => {
  const openAgentInSpace = vi.fn(async () => {});
  const openWithSpace = vi.fn(async () => {});

  beforeEach(() => {
    openAgentInSpace.mockClear();
    openWithSpace.mockClear();
    useSpaceStore.setState({ spaces: SPACES });
  });

  afterEach(() => {
    window.paseoDesktop = undefined;
  });

  it("asks the shell to open the agent in the window bound to the project's space", () => {
    window.paseoDesktop = { windows: { openAgentInSpace, openWithSpace } };

    openAgentInProjectWindow("project-2", { serverId: "server-1", agentId: "agent-1" });

    expect(openAgentInSpace).toHaveBeenCalledWith({
      spaceId: "space-2",
      serverId: "server-1",
      agentId: "agent-1",
    });
    expect(openWithSpace).not.toHaveBeenCalled();
  });

  it("only raises the window when the shell has no agent handoff", () => {
    window.paseoDesktop = { windows: { openWithSpace } };

    openAgentInProjectWindow("project-2", { serverId: "server-1", agentId: "agent-1" });

    expect(openWithSpace).toHaveBeenCalledWith("space-2");
  });

  it("does nothing when no window owns the project", () => {
    window.paseoDesktop = { windows: { openAgentInSpace, openWithSpace } };

    openAgentInProjectWindow("project-missing", { serverId: "server-1", agentId: "agent-1" });

    expect(openAgentInSpace).not.toHaveBeenCalled();
    expect(openWithSpace).not.toHaveBeenCalled();
  });

  it("does nothing outside the desktop shell", () => {
    window.paseoDesktop = undefined;

    openAgentInProjectWindow("project-2", { serverId: "server-1", agentId: "agent-1" });

    expect(openAgentInSpace).not.toHaveBeenCalled();
    expect(openWithSpace).not.toHaveBeenCalled();
  });
});
