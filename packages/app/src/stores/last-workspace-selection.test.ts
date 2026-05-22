import { describe, expect, it } from "vitest";
import {
  createLastWorkspaceSelectionStore,
  type ActiveWorkspaceSelection,
  type LastWorkspaceSelectionSnapshot,
  type LastWorkspaceSelectionStorage,
} from "./last-workspace-selection";

class DelayedWorkspaceSelectionStorage implements LastWorkspaceSelectionStorage {
  private finishRead: (value: string | null) => void = () => {};
  private readonly pendingRead = new Promise<string | null>((resolve) => {
    this.finishRead = resolve;
  });
  private saved: string | null = null;

  read(): Promise<string | null> {
    return this.pendingRead;
  }

  async write(value: string): Promise<void> {
    this.saved = value;
  }

  async clear(): Promise<void> {
    this.saved = null;
  }

  finishHydrationWith(selection: ActiveWorkspaceSelection | LastWorkspaceSelectionSnapshot | null) {
    this.finishRead(selection ? JSON.stringify(selection) : null);
  }

  getSavedSnapshot(): LastWorkspaceSelectionSnapshot | ActiveWorkspaceSelection | null {
    return this.saved ? JSON.parse(this.saved) : null;
  }
}

describe("last workspace selection", () => {
  it("hydrates the saved workspace selection", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    storage.finishHydrationWith({ serverId: "server-saved", workspaceId: "workspace-saved" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
    expect(store.getSelection("space-a")).toEqual({
      serverId: "server-saved",
      workspaceId: "workspace-saved",
    });
    expect(store.isHydrated()).toBe(true);
  });

  it("keeps a newer workspace selection when storage hydration finishes late", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    const hydration = store.hydrate();

    store.remember({ serverId: "server-new", workspaceId: "workspace-new" });
    storage.finishHydrationWith({ serverId: "server-old", workspaceId: "workspace-old" });
    await hydration;

    expect(store.getSelection()).toEqual({
      serverId: "server-new",
      workspaceId: "workspace-new",
    });
    expect(storage.getSavedSnapshot()).toEqual({
      defaultSelection: {
        serverId: "server-new",
        workspaceId: "workspace-new",
      },
    });
  });

  it("stores independent workspace selections per space", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    storage.finishHydrationWith(null);
    await store.hydrate();

    store.remember({ serverId: "server-a", workspaceId: "workspace-a" }, "space-a");
    store.remember({ serverId: "server-b", workspaceId: "workspace-b" }, "space-b");

    expect(store.getSelection("space-a")).toEqual({
      serverId: "server-a",
      workspaceId: "workspace-a",
    });
    expect(store.getSelection("space-b")).toEqual({
      serverId: "server-b",
      workspaceId: "workspace-b",
    });
    expect(store.getSelection()).toBeNull();
    expect(storage.getSavedSnapshot()).toEqual({
      selectionBySpaceId: {
        "space-a": { serverId: "server-a", workspaceId: "workspace-a" },
        "space-b": { serverId: "server-b", workspaceId: "workspace-b" },
      },
    });
  });

  it("writes a scoped selection even when it matches the legacy default selection", async () => {
    const storage = new DelayedWorkspaceSelectionStorage();
    const store = createLastWorkspaceSelectionStore(storage);
    storage.finishHydrationWith({ serverId: "server-a", workspaceId: "workspace-a" });
    await store.hydrate();

    store.remember({ serverId: "server-a", workspaceId: "workspace-a" }, "space-a");

    expect(store.getSelection("space-a")).toEqual({
      serverId: "server-a",
      workspaceId: "workspace-a",
    });
    expect(storage.getSavedSnapshot()).toEqual({
      defaultSelection: { serverId: "server-a", workspaceId: "workspace-a" },
      selectionBySpaceId: {
        "space-a": { serverId: "server-a", workspaceId: "workspace-a" },
      },
    });
  });
});
