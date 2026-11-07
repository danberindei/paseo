/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { useActiveSpaceStore } from "@/stores/active-space-store";
import { useSpaceStore } from "@/stores/space-store";
import ManageSpacesScreen from "./manage-spaces-screen";
import SpaceProjectsScreen from "./space-projects-screen";

const control = vi.hoisted(() => ({
  fail: false,
  pause: false,
  finish: () => {},
}));

vi.mock("@/stores/spaces/storage-async-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/spaces/storage-async-storage")>();
  const { withSpaceStorageLock } = await import("@/stores/spaces/storage-lock-queue");
  function createAsyncStorageSpaceStorage() {
    const storage = actual.createAsyncStorageSpaceStorage(withSpaceStorageLock);
    async function mutate(mutation: Parameters<typeof storage.mutate>[0]) {
      if (control.fail) throw new Error("Disk full");
      if (control.pause)
        await new Promise<void>((resolve) => {
          control.finish = resolve;
        });
      return storage.mutate(mutation);
    }
    return { ...storage, mutate };
  }
  return { ...actual, createAsyncStorageSpaceStorage };
});

vi.mock("@/hooks/use-projects", () => ({
  useProjects: () => ({
    isLoading: false,
    projects: [
      {
        viewKey: "project",
        projectName: "Repository",
        hosts: [{ projectId: "project-a" }, { projectId: "project-b" }],
      },
    ],
  }),
}));

const toast = { show: () => () => {}, error: () => {}, copied: () => {} };

function renderScreen(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ToastApiProvider api={toast}>{children}</ToastApiProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  control.fail = false;
  control.pause = false;
  await useSpaceStore.hydrate();
  for (const space of useSpaceStore.getState().spaces)
    await useSpaceStore.getState().deleteSpace(space.id);
  useActiveSpaceStore.getState().setActiveSpaceId(null);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Space mutation feedback", () => {
  it("waits for creation to commit and prevents duplicate submissions", async () => {
    renderScreen(<ManageSpacesScreen />);
    const input = screen.getByPlaceholderText("Space name...");
    fireEvent.change(input, { target: { value: "Work" } });
    control.pause = true;
    fireEvent.click(screen.getByText("Add"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add" }).getAttribute("aria-disabled")).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByText("Add"));
    expect(useActiveSpaceStore.getState().activeSpaceId).toBeNull();
    expect(useSpaceStore.getState().spaces).toEqual([]);
    await act(async () => {
      control.finish();
    });
    await screen.findByText("Work");
    expect(useSpaceStore.getState().spaces).toHaveLength(1);
    expect(useActiveSpaceStore.getState().activeSpaceId).toBe(
      useSpaceStore.getState().spaces[0].id,
    );
    expect(screen.getByPlaceholderText<HTMLInputElement>("Space name...").value).toBe("");
  });

  it("keeps a failed creation draft and permits retry", async () => {
    renderScreen(<ManageSpacesScreen />);
    fireEvent.change(screen.getByPlaceholderText("Space name..."), { target: { value: "Work" } });
    control.fail = true;
    fireEvent.click(screen.getByText("Add"));
    expect((await screen.findByRole("alert")).textContent).toBe("Unable to save");
    expect(screen.getByPlaceholderText<HTMLInputElement>("Space name...").value).toBe("Work");
    expect(useActiveSpaceStore.getState().activeSpaceId).toBeNull();
    control.fail = false;
    fireEvent.click(screen.getByText("Add"));
    await screen.findByText("Work");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps a failed deletion visible until retry succeeds", async () => {
    await useSpaceStore.getState().createSpace("Work");
    renderScreen(<ManageSpacesScreen />);
    control.fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    await screen.findByRole("alert");
    expect(screen.getByText("Work").textContent).toBe("Work");
    control.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
    await waitFor(() => expect(screen.queryByText("Work")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the original name on failure and saves a rename on retry", async () => {
    const id = await useSpaceStore.getState().createSpace("Work");
    renderScreen(<SpaceProjectsScreen spaceId={id} />);
    const input = screen.getByDisplayValue("Work");
    fireEvent.change(input, { target: { value: "Renamed" } });
    control.fail = true;
    fireEvent.blur(input);
    await screen.findByRole("alert");
    expect(screen.getByText("Work").textContent).toBe("Work");
    control.fail = false;
    fireEvent.blur(input);
    await screen.findByText("Renamed");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retries membership failures and commits all project hosts together", async () => {
    const id = await useSpaceStore.getState().createSpace("Work");
    renderScreen(<SpaceProjectsScreen spaceId={id} />);
    control.fail = true;
    fireEvent.click(screen.getByText("Repository"));
    await screen.findByRole("alert");
    expect(screen.getByRole("checkbox", { name: "Repository" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    control.fail = false;
    fireEvent.click(screen.getByText("Repository"));
    await waitFor(() =>
      expect(useSpaceStore.getState().spaces[0].projectIds).toEqual(["project-a", "project-b"]),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Repository" }).getAttribute("aria-disabled"),
      ).toBeNull(),
    );
    expect(screen.getByRole("checkbox", { name: "Repository" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByText("Repository"));
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Repository" }).getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });
});
