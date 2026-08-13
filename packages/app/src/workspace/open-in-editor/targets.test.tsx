/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceOpenInEditorTargets } from "./targets";

void testI18n;

const { openDesktopTargetMock, openExternalUrlMock, toastErrorMock, desktopTargets } = vi.hoisted(
  () => ({
    openDesktopTargetMock: vi.fn(),
    openExternalUrlMock: vi.fn(),
    toastErrorMock: vi.fn(),
    desktopTargets: [
      {
        id: "vscode",
        label: "VS Code",
        kind: "editor" as const,
        icon: { kind: "symbol" as const, name: "terminal" as const },
      },
    ],
  }),
);

vi.mock("@/constants/platform", () => ({ isWeb: true, isNative: false }));

vi.mock("@/runtime/host-runtime", () => ({ useHostRuntimeIsConnected: () => true }));

vi.mock("@/hooks/use-is-local-daemon", () => ({ useIsLocalDaemon: () => true }));

vi.mock("@/hooks/use-preferred-editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-preferred-editor")>();
  return {
    ...actual,
    usePreferredEditor: () => ({
      preferredEditorId: "vscode",
      isLoading: false,
      updatePreferredEditor: vi.fn(async () => undefined),
    }),
  };
});

vi.mock("@/workspace/desktop-open-targets", () => ({
  useDesktopOpenTargets: () => ({ targets: desktopTargets, isAvailable: true }),
  openDesktopTarget: openDesktopTargetMock,
}));

vi.mock("@/git/use-status-query", () => ({
  useCheckoutStatusQuery: () => ({
    status: {
      isGit: true,
      remoteUrl: "git@github.com:getpaseo/paseo.git",
      currentBranch: "main",
    },
  }),
}));

vi.mock("@/git/use-pr-status-query", () => ({
  useCheckoutPrStatusQuery: () => ({ resolvedForge: null }),
}));

vi.mock("@/utils/open-external-url", () => ({ openExternalUrl: openExternalUrlMock }));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: vi.fn(), error: toastErrorMock }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderTargets(input: {
  workspaceDirectory?: string | null;
  activeFile?: { path: string; lineStart?: number };
}) {
  const workspaceDirectory =
    input.workspaceDirectory === undefined ? "/repo" : input.workspaceDirectory;
  return renderHook(
    () =>
      useWorkspaceOpenInEditorTargets({
        serverId: "srv",
        workspaceDirectory,
        project: { projectId: "project-1" },
        activeFile: input.activeFile ?? null,
      }),
    { wrapper: createWrapper() },
  );
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("useWorkspaceOpenInEditorTargets", () => {
  beforeEach(() => {
    openDesktopTargetMock.mockReset();
    openDesktopTargetMock.mockResolvedValue(undefined);
    openExternalUrlMock.mockReset();
    openExternalUrlMock.mockResolvedValue(undefined);
  });
  it("plans the preferred target with the active file", () => {
    const { result } = renderTargets({ activeFile: { path: "src/app.ts", lineStart: 3 } });

    expect(result.current.targets.map((target) => target.id)).toEqual(["vscode", "github"]);
    expect(result.current.primaryTarget).toMatchObject({
      id: "vscode",
      openInput: {
        editorId: "vscode",
        workspacePath: "/repo",
        filePath: "/repo/src/app.ts",
        line: 3,
      },
    });
    expect(result.current.activeFileName).toBe("app.ts");
    expect(result.current.canOpen).toBe(true);
  });

  it("offers no target when the workspace directory cannot be resolved", () => {
    const { result } = renderTargets({ workspaceDirectory: null });

    expect(result.current.targets).toEqual([]);
    expect(result.current.primaryTarget).toBeNull();
    expect(result.current.canOpen).toBe(false);
    expect(result.current.openPrimary()).toBe(false);
    expect(openDesktopTargetMock).not.toHaveBeenCalled();
  });

  it("refuses a second open while the first is in flight", async () => {
    const deferred = createDeferred();
    openDesktopTargetMock.mockReturnValueOnce(deferred.promise);
    const { result } = renderTargets({ activeFile: { path: "src/app.ts" } });

    act(() => {
      expect(result.current.openPrimary()).toBe(true);
    });
    await waitFor(() => expect(result.current.isOpening).toBe(true));

    expect(result.current.canOpen).toBe(false);
    expect(result.current.openPrimary()).toBe(false);
    expect(openDesktopTargetMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });
    await waitFor(() => expect(result.current.canOpen).toBe(true));
  });

  it("opens the forge page for a forge target", async () => {
    const { result } = renderTargets({ activeFile: { path: "src/app.ts", lineStart: 3 } });

    const forgeTarget = result.current.targets.find((target) => target.source === "forge");
    expect(forgeTarget).toBeDefined();
    act(() => {
      result.current.openTarget(forgeTarget!);
    });

    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalled());
    expect(openExternalUrlMock.mock.calls[0]?.[0]).toContain("/blob/main/src/app.ts#L3");
    expect(openDesktopTargetMock).not.toHaveBeenCalled();
  });
});
