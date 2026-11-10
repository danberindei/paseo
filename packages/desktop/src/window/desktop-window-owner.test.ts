import { describe, expect, it } from "vitest";
import { createDesktopWindowOwner, type OwnedDesktopWindow } from "./desktop-window-owner.js";

interface Target {
  id: string;
}

function harness(beforeCreate: () => Promise<void> = async () => {}) {
  const windows: OwnedDesktopWindow<Target>[] = [];
  const launches: Array<{
    initialRoute: string | null;
    restoreWindowState: boolean;
    spaceId: string | null;
  }> = [];
  const sent: Target[] = [];
  let nextId = 1;
  let focused: OwnedDesktopWindow<Target> | null = null;
  let closeWindow = (_id: number) => {};
  const owner = createDesktopWindowOwner<Target>({
    async create(input) {
      launches.push({
        initialRoute: input.initialRoute,
        restoreWindowState: input.restoreWindowState,
        spaceId: input.spaceId ?? null,
      });
      await beforeCreate();
      const id = nextId++;
      closeWindow = input.onClosed;
      const window: OwnedDesktopWindow<Target> = {
        webContentsId: id,
        spaceId: input.spaceId ?? null,
        isDestroyed: () => false,
        isVisible: () => true,
        isMinimized: () => false,
        restore: () => {},
        show: () => {},
        focus: () => {},
        sendAgent: (target) => sent.push(target),
      };
      windows.push(window);
      input.onCreated(id);
      return window;
    },
    windows: () => windows,
    focusedWindow: () => focused,
    agentRoute: (target) => `/agent/${target.id}`,
    deliverAgent: (_id, target) => target,
  });
  return {
    owner,
    launches,
    sent,
    windows,
    setFocused: (window: OwnedDesktopWindow<Target>) => {
      focused = window;
    },
    close: (id: number) => closeWindow(id),
  };
}

describe("desktop window owner", () => {
  it("restores only primary launches and routes pending projects per window", async () => {
    const h = harness();
    await h.owner.openPrimary({ pendingProjectPath: " /project/a " });
    await h.owner.openAdditional({ pendingProjectPath: "/project/b" });
    expect(h.launches).toEqual([
      { initialRoute: null, restoreWindowState: true, spaceId: null },
      { initialRoute: null, restoreWindowState: false, spaceId: null },
    ]);
    expect(h.owner.takePendingProject(1)).toBe("/project/a");
    expect(h.owner.takePendingProject(2)).toBe("/project/b");
  });

  it("focuses an existing window and delivers agent routing through its inbox", async () => {
    const h = harness();
    await h.owner.openPrimary();
    h.setFocused(h.windows[0]);
    await h.owner.openOrFocusAgent({ id: "agent-7" });
    expect(h.launches).toHaveLength(1);
    expect(h.sent).toEqual([{ id: "agent-7" }]);
  });

  it("removes pending routing state when a window closes", async () => {
    const h = harness();
    await h.owner.openAdditional({ pendingProjectPath: "/project/a" });
    h.close(1);
    expect(h.owner.takePendingProject(1)).toBeNull();
  });

  it("routes an agent to the window bound to its space", async () => {
    const h = harness();
    await h.owner.openAdditional({ spaceId: "space-other" });
    await h.owner.openAdditional({ spaceId: "space-third" });

    await h.owner.openOrFocusAgentInSpace("space-other", { id: "agent-7" });

    expect(h.launches).toHaveLength(2);
    expect(h.sent).toEqual([{ id: "agent-7" }]);
  });

  it("opens a window bound to the space when no window is bound to it", async () => {
    const h = harness();
    await h.owner.openAdditional({ spaceId: "space-current" });

    await h.owner.openOrFocusAgentInSpace("space-other", { id: "agent-7" });

    expect(h.launches).toEqual([
      { initialRoute: null, restoreWindowState: false, spaceId: "space-current" },
      { initialRoute: "/agent/agent-7", restoreWindowState: false, spaceId: "space-other" },
    ]);
    expect(h.sent).toEqual([]);
  });

  it("delivers concurrent requests to one new window for the space", async () => {
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness(() => ready);

    const first = h.owner.openOrFocusAgentInSpace("space-other", { id: "agent-7" });
    const second = h.owner.openOrFocusAgentInSpace("space-other", { id: "agent-8" });
    release();
    await Promise.all([first, second]);

    expect(h.launches).toEqual([
      { initialRoute: "/agent/agent-7", restoreWindowState: false, spaceId: "space-other" },
    ]);
    expect(h.sent).toEqual([{ id: "agent-8" }]);
  });
});
