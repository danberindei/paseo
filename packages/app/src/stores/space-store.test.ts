import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

import type { Space } from "@/stores/space-store";
import { selectActiveSpace, useSpaceStore } from "@/stores/space-store";

function getSpace(id: string): Space | undefined {
  const { spaces } = useSpaceStore.getState();
  for (const s of spaces) {
    if (s.id === id) return s;
  }
  return undefined;
}

const INITIAL_STATE = {
  spaces: [],
  activeSpaceId: null,
};

describe("space-store", () => {
  beforeEach(() => {
    useSpaceStore.setState(INITIAL_STATE);
  });

  describe("createSpace", () => {
    it("creates a space with the given name and empty projectIds", () => {
      const store = useSpaceStore.getState();
      const id = store.createSpace("Backend work");
      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(1);
      expect(spaces[0]).toMatchObject({ id, name: "Backend work", projectIds: [] });
    });

    it("creates multiple spaces with distinct ids", () => {
      const store = useSpaceStore.getState();
      const id1 = store.createSpace("Task A");
      const id2 = store.createSpace("Task B");
      expect(id1).not.toBe(id2);
      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(2);
    });

    it("returns the new space id", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("deleteSpace", () => {
    it("removes the space from the list", () => {
      const id = useSpaceStore.getState().createSpace("Old space");
      useSpaceStore.getState().deleteSpace(id);
      expect(useSpaceStore.getState().spaces).toHaveLength(0);
    });

    it("sets activeSpaceId to null when the active space is deleted", () => {
      const id = useSpaceStore.getState().createSpace("Active space");
      useSpaceStore.getState().setActiveSpaceId(id);
      useSpaceStore.getState().deleteSpace(id);
      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });

    it("preserves activeSpaceId when a non-active space is deleted", () => {
      const id1 = useSpaceStore.getState().createSpace("Space A");
      const id2 = useSpaceStore.getState().createSpace("Space B");
      useSpaceStore.getState().setActiveSpaceId(id1);
      useSpaceStore.getState().deleteSpace(id2);
      expect(useSpaceStore.getState().activeSpaceId).toBe(id1);
    });
  });

  describe("renameSpace", () => {
    it("updates the space name without changing id or projectIds", () => {
      const id = useSpaceStore.getState().createSpace("Old name");
      useSpaceStore.getState().addProjectToSpace(id, "key-a");
      useSpaceStore.getState().renameSpace(id, "New name");
      const space = getSpace(id);
      expect(space?.name).toBe("New name");
      expect(space?.id).toBe(id);
      expect(space?.projectIds).toEqual(["key-a"]);
    });
  });

  describe("addProjectToSpace", () => {
    it("adds a project id to the space", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).toContain("remote:github.com/org/repo");
    });

    it("is a no-op when the project id already exists", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).toHaveLength(1);
    });
  });

  describe("removeProjectFromSpace", () => {
    it("removes a project id from the space", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      useSpaceStore.getState().removeProjectFromSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).not.toContain("remote:github.com/org/repo");
    });

    it("is a no-op when the project id does not exist", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().addProjectToSpace(id, "key-a");
      useSpaceStore.getState().removeProjectFromSpace(id, "key-b");
      const space = getSpace(id);
      expect(space?.projectIds).toEqual(["key-a"]);
    });
  });

  describe("setSpaceProjects", () => {
    it("replaces the entire projectIds array", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().addProjectToSpace(id, "key-old");
      useSpaceStore.getState().setSpaceProjects(id, ["key-a", "key-b"]);
      const space = getSpace(id);
      expect(space?.projectIds).toEqual(["key-a", "key-b"]);
    });
  });

  describe("persist migration", () => {
    it("migrates persisted projectKeys to projectIds", async () => {
      const migrate = useSpaceStore.persist.getOptions().migrate;
      expect(migrate).toBeDefined();

      const migrated = await migrate?.(
        {
          spaces: [{ id: "space-1", name: "Work", projectKeys: ["project-1"] }],
          activeSpaceId: "space-1",
        },
        1,
      );

      expect(migrated).toEqual({
        spaces: [{ id: "space-1", name: "Work", projectIds: ["project-1"] }],
        activeSpaceId: "space-1",
      });
    });
  });

  describe("active space selection", () => {
    it("sets activeSpaceId", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().setActiveSpaceId(id);
      expect(useSpaceStore.getState().activeSpaceId).toBe(id);
    });

    it("clears activeSpaceId when set to null", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().setActiveSpaceId(id);
      useSpaceStore.getState().setActiveSpaceId(null);
      expect(useSpaceStore.getState().activeSpaceId).toBeNull();
    });
  });

  describe("selectActiveSpace", () => {
    it("returns the active space when it exists", () => {
      const id = useSpaceStore.getState().createSpace("Work");
      useSpaceStore.getState().setActiveSpaceId(id);
      const space = selectActiveSpace(useSpaceStore.getState());
      expect(space?.id).toBe(id);
    });

    it("returns null when activeSpaceId is null", () => {
      useSpaceStore.getState().createSpace("Work");
      expect(selectActiveSpace(useSpaceStore.getState())).toBeNull();
    });

    it("returns null when activeSpaceId references a deleted space", () => {
      useSpaceStore.setState({ activeSpaceId: "non-existent-id" });
      expect(selectActiveSpace(useSpaceStore.getState())).toBeNull();
    });
  });
});
