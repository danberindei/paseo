/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WindowTitleSync } from "@/components/window-title-sync";
import { definePanel, registerPanel } from "@/panels/panel-registry";
import { deriveWorkspacePaneState } from "@/screens/workspace/workspace-pane-state";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

const SERVER_ID = "srv-window-title";
const WORKSPACE_ID = "ws-window-title";
const workspaceKey = `${SERVER_ID}:${WORKSPACE_ID}`;

const pathnameState = vi.hoisted(() => ({
  value: "/h/srv-window-title/workspace/ws-window-title",
}));

vi.mock("expo-router", () => ({
  usePathname: () => pathnameState.value,
}));

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

const terminalRegistration = definePanel("terminal", {
  component: () => null,
  presentation: {
    label: () => "Terminal",
    subtitle: () => "",
    tooltip: () => "",
    icon: () => null,
  },
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<WindowTitleSync />);
  });
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    layoutByWorkspace: {},
    sheetsByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
  });
  document.title = "";
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

describe("window title sync", () => {
  it("shows the tab name once the panels register", async () => {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: { kind: "terminal", terminalId: "terminal-1" },
      intent: "reveal",
    });
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    if (!layout) {
      throw new Error("expected a layout for the open terminal tab");
    }
    const activeTab = deriveWorkspacePaneState({
      layout,
      tabs: collectAllTabs(layout.root),
    }).activeTab;
    expect(activeTab?.descriptor.kind).toBe("terminal");

    // The terminal presentation cannot resolve before the workspace screen mounts, so the first
    // render must not throw and must leave the tab name out of the title.
    mount();
    expect(document.title).toBe("Paseo");

    await act(async () => {
      registerPanel(terminalRegistration);
    });

    expect(document.title).toBe("Terminal - Paseo");
  });
});
