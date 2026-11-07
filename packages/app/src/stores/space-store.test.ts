import { beforeEach, describe, expect, it } from "vitest";

import { useActiveSpaceStore } from "@/stores/active-space-store";
import { readLegacySpaces } from "./spaces/types";
import type { Space } from "@/stores/space-store";
import { getActiveSpace, useSpaceStore } from "@/stores/space-store";

function getSpace(id: string): Space | undefined {
  const { spaces } = useSpaceStore.getState();
  for (const s of spaces) {
    if (s.id === id) return s;
  }
  return undefined;
}

describe("space-store", () => {
  beforeEach(async () => {
    await useSpaceStore.hydrate();
    for (const space of useSpaceStore.getState().spaces)
      await useSpaceStore.getState().deleteSpace(space.id);
    useActiveSpaceStore.setState({ activeSpaceId: null });
  });

  describe("createSpace", () => {
    it("creates a space with the given name and empty projectIds", async () => {
      const store = useSpaceStore.getState();
      const id = await store.createSpace("Backend work");
      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(1);
      expect(spaces[0]).toMatchObject({ id, name: "Backend work", projectIds: [] });
    });

    it("creates multiple spaces with distinct ids", async () => {
      const store = useSpaceStore.getState();
      const id1 = await store.createSpace("Task A");
      const id2 = await store.createSpace("Task B");
      expect(id1).not.toBe(id2);
      const { spaces } = useSpaceStore.getState();
      expect(spaces).toHaveLength(2);
    });

    it("returns the new space id", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("deleteSpace", () => {
    it("removes the space from the list", async () => {
      const id = await useSpaceStore.getState().createSpace("Old space");
      await useSpaceStore.getState().deleteSpace(id);
      expect(useSpaceStore.getState().spaces).toHaveLength(0);
    });

    it("sets activeSpaceId to null when the active space is deleted", async () => {
      const id = await useSpaceStore.getState().createSpace("Active space");
      useActiveSpaceStore.getState().setActiveSpaceId(id);
      await useSpaceStore.getState().deleteSpace(id);
      expect(useActiveSpaceStore.getState().activeSpaceId).toBeNull();
    });

    it("preserves activeSpaceId when a non-active space is deleted", async () => {
      const id1 = await useSpaceStore.getState().createSpace("Space A");
      const id2 = await useSpaceStore.getState().createSpace("Space B");
      useActiveSpaceStore.getState().setActiveSpaceId(id1);
      await useSpaceStore.getState().deleteSpace(id2);
      expect(useActiveSpaceStore.getState().activeSpaceId).toBe(id1);
    });
  });

  describe("renameSpace", () => {
    it("updates the space name without changing id or projectIds", async () => {
      const id = await useSpaceStore.getState().createSpace("Old name");
      await useSpaceStore.getState().addProjectToSpace(id, "key-a");
      await useSpaceStore.getState().renameSpace(id, "New name");
      const space = getSpace(id);
      expect(space?.name).toBe("New name");
      expect(space?.id).toBe(id);
      expect(space?.projectIds).toEqual(["key-a"]);
    });
  });

  describe("addProjectToSpace", () => {
    it("adds a project id to the space", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      await useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).toContain("remote:github.com/org/repo");
    });

    it("is a no-op when the project id already exists", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      await useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      await useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).toHaveLength(1);
    });
  });

  describe("removeProjectFromSpace", () => {
    it("removes a project id from the space", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      await useSpaceStore.getState().addProjectToSpace(id, "remote:github.com/org/repo");
      await useSpaceStore.getState().removeProjectFromSpace(id, "remote:github.com/org/repo");
      const space = getSpace(id);
      expect(space?.projectIds).not.toContain("remote:github.com/org/repo");
    });

    it("is a no-op when the project id does not exist", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      await useSpaceStore.getState().addProjectToSpace(id, "key-a");
      await useSpaceStore.getState().removeProjectFromSpace(id, "key-b");
      const space = getSpace(id);
      expect(space?.projectIds).toEqual(["key-a"]);
    });
  });

  describe("persist migration", () => {
    it("normalizes legacy names and project ids without discarding a space", () => {
      expect(
        readLegacySpaces(
          JSON.stringify({
            state: {
              spaces: [{ id: " work ", name: null, projectKeys: [" a ", 1, "a", "", "b"] }],
            },
          }),
        ),
      ).toEqual([{ id: "work", name: "New space", projectIds: ["a", "b"] }]);
    });

    it("migrates persisted projectKeys to projectIds", async () => {
      const migrated = readLegacySpaces(
        JSON.stringify({
          state: { spaces: [{ id: "space-1", name: "Work", projectKeys: ["project-1"] }] },
          version: 1,
        }),
      );

      expect(migrated).toEqual([{ id: "space-1", name: "Work", projectIds: ["project-1"] }]);
    });
  });

  describe("active space selection", () => {
    it("sets activeSpaceId", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      useActiveSpaceStore.getState().setActiveSpaceId(id);
      expect(useActiveSpaceStore.getState().activeSpaceId).toBe(id);
    });

    it("clears activeSpaceId when set to null", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      useActiveSpaceStore.getState().setActiveSpaceId(id);
      useActiveSpaceStore.getState().setActiveSpaceId(null);
      expect(useActiveSpaceStore.getState().activeSpaceId).toBeNull();
    });
  });

  describe("getActiveSpace", () => {
    it("returns the active space when it exists", async () => {
      const id = await useSpaceStore.getState().createSpace("Work");
      useActiveSpaceStore.getState().setActiveSpaceId(id);
      expect(getActiveSpace()?.id).toBe(id);
    });

    it("returns null when activeSpaceId is null", async () => {
      await useSpaceStore.getState().createSpace("Work");
      expect(getActiveSpace()).toBeNull();
    });

    it("returns null when activeSpaceId references a deleted space", async () => {
      useActiveSpaceStore.setState({ activeSpaceId: "non-existent-id" });
      expect(getActiveSpace()).toBeNull();
    });
  });
});
