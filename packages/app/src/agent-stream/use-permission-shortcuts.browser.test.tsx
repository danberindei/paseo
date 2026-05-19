import React, {
  act,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalProvider } from "@gorhom/portal";
import { Text, View } from "react-native";
import { within } from "@testing-library/dom";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { i18n as testI18n } from "@/i18n/i18next";
import { useOverlayRegistration, usePresentationRegistration } from "@/keyboard";
import { hasPermissionShortcutClaims } from "@/keyboard/internal/permission-shortcut-claims";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import type { createKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import type { PaneHost } from "@/panels/panel-manifest";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import type { PendingPermission } from "@/types/shared";
import { HoverCard, HoverCardTrigger } from "@/components/ui/hover-card";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { QuestionFormCard } from "@/components/question-form-card";
import { PermissionRequestCard } from "./view";
import { ownsPermissionShortcuts, usePermissionShortcuts } from "./use-permission-shortcuts";

// Load translations so the cards render real labels.
void testI18n;

// The Markdown engine is not the subject here; question text only needs to render.
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <span>{text}</span>,
}));

// The toast host imports Android-only React Native exports, which the browser build does not
// have. No card in this suite shows a toast.
vi.mock("@/contexts/toast-context", () => ({
  ToastProvider: ({ children }: { children?: unknown }) => children,
  ToastApiProvider: ({ children }: { children?: unknown }) => children,
  useToast: () => ({ show: () => undefined, dismiss: () => undefined }),
}));

type Dispatcher = ReturnType<typeof createKeyboardActionDispatcher>;

interface PermissionHarnessProps {
  permissions: PendingPermission[];
  handlerId?: string;
  isVisible: boolean;
  onAction: (action: string) => void;
  actionPrefix?: string;
  isResponding?: (key: string) => boolean;
  dispatcherRef: { current: Dispatcher | null };
}

const noop = () => {};
const ignoreOverlayKeyDown = () => false;
const TEST_WORKSPACE_KEY = "server:workspace";

function PaneScope({
  host,
  tabId,
  isPaneFocused,
  isWorkspaceFocused = true,
  children,
}: {
  host: PaneHost;
  tabId: string;
  isPaneFocused: boolean;
  isWorkspaceFocused?: boolean;
  children: ReactNode;
}) {
  const paneValue = useMemo<PaneContextValue>(
    () => ({
      serverId: "server",
      workspaceId: "workspace",
      host,
      tabId,
      target: { kind: "agent", agentId: "agent" },
      openTab: noop,
      openPreferredTarget: noop,
      closeCurrentTab: noop,
      retargetCurrentTab: noop,
      setCurrentTabState: noop,
      openFileInWorkspace: noop,
      openImportSheet: noop,
    }),
    [host, tabId],
  );
  const focusValue = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused, isPaneFocused }),
    [isPaneFocused, isWorkspaceFocused],
  );
  return (
    <PaneProvider value={paneValue}>
      <PaneFocusProvider value={focusValue}>{children}</PaneFocusProvider>
    </PaneProvider>
  );
}

interface TestPresentationProps {
  active?: boolean;
  layer?: number;
  workspaceKey?: string | null;
  hostedTabId?: string | null;
}

/** The same passive registration a bottom sheet or compact sidebar performs. */
function TestPresentation({
  active = true,
  layer = 20,
  workspaceKey = TEST_WORKSPACE_KEY,
  hostedTabId = null,
}: TestPresentationProps) {
  usePresentationRegistration({ active, layer, workspaceKey, hostedTabId });
  return null;
}

interface TestKeyboardOverlayProps {
  active?: boolean;
  layer?: number;
  manageFocus?: boolean;
}

/** A keyboard overlay such as a menu popover or hover card. */
function TestKeyboardOverlay({
  active = true,
  layer = 10,
  manageFocus = true,
}: TestKeyboardOverlayProps) {
  useOverlayRegistration({
    active,
    layer,
    keys: ["Escape"],
    onKeyDown: ignoreOverlayKeyDown,
    manageFocus,
  });
  return null;
}

function ShortcutSurface({
  permissions,
  handlerId = "permission-shortcuts:test",
  isVisible,
  onAction,
  actionPrefix,
  isResponding,
  dispatcherRef,
}: PermissionHarnessProps) {
  const dispatcher = useKeyboardActionDispatcher();
  const { shortcutTargetKey, registerShortcutTarget, onStartResponding, onStopResponding } =
    usePermissionShortcuts(permissions, { handlerId, isVisible });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dispatcherRef.current = dispatcher;
  }, [dispatcher, dispatcherRef]);

  useEffect(() => {
    const report = (action: string) =>
      onAction(actionPrefix ? `${actionPrefix}:${action}` : action);
    const cleanups = permissions.map((permission) =>
      registerShortcutTarget(permission.key, {
        accept: () => {
          report(`accept ${permission.key}`);
          onStartResponding(permission.key);
        },
        deny: () => {
          report(`deny ${permission.key}`);
          onStartResponding(permission.key);
        },
        focus: () => {
          const button = containerRef.current?.querySelector<HTMLButtonElement>(
            `[data-permission="${permission.key}"]`,
          );
          button?.focus();
        },
        isResponding: () => isResponding?.(permission.key) ?? false,
      }),
    );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [
    permissions,
    registerShortcutTarget,
    onStartResponding,
    onAction,
    actionPrefix,
    isResponding,
  ]);

  const retry = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const key = event.currentTarget.dataset.permission;
      if (key) onStopResponding(key);
    },
    [onStopResponding],
  );

  return (
    <div ref={containerRef}>
      <output>{shortcutTargetKey ?? "none"}</output>
      {permissions.map((permission) => (
        <button type="button" key={permission.key} data-permission={permission.key} onClick={retry}>
          Retry {permission.key}
        </button>
      ))}
    </div>
  );
}

function createPermission(key: string): PendingPermission {
  return {
    key,
    agentId: "agent",
    request: { id: key, provider: "claude", name: "Bash", kind: "tool" },
  };
}

const respondToPermissionAndWait = vi.fn(async () => undefined);
const permissionClient = {
  respondToPermissionAndWait,
} as unknown as DaemonClient;

function createQuestionPermission(): PendingPermission {
  return {
    key: "question-1",
    agentId: "agent",
    request: {
      id: "question-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which provider?",
            header: "Provider",
            options: [{ label: "Claude Code" }, { label: "Codex" }],
            multiSelect: false,
            allowOther: true,
          },
        ],
      },
    },
  };
}

const hoverTriggerStyle = { width: 120, height: 32 } as const;

/** The real hover card, so its overlay registration is exercised rather than emulated. */
function RealHoverCard() {
  return (
    <HoverCard>
      <HoverCardTrigger>
        <View testID="hover-trigger" style={hoverTriggerStyle}>
          <Text>hover target</Text>
        </View>
      </HoverCardTrigger>
    </HoverCard>
  );
}

function RealPermissionCardSurface({
  permission,
  client,
  dispatcherRef,
}: {
  permission: PendingPermission;
  client: DaemonClient;
  dispatcherRef: { current: Dispatcher | null };
}) {
  const dispatcher = useKeyboardActionDispatcher();
  useEffect(() => {
    dispatcherRef.current = dispatcher;
  }, [dispatcher, dispatcherRef]);
  const permissions = useMemo(() => [permission], [permission]);
  const {
    shortcutTargetKey,
    isShortcutOwner,
    registerShortcutTarget,
    onStartResponding,
    onStopResponding,
  } = usePermissionShortcuts(permissions, {
    handlerId: "permission-shortcuts:real-permission",
    isVisible: true,
  });
  return (
    <>
      <output data-testid="shortcut-owner">{isShortcutOwner ? "owner" : "covered"}</output>
      <PermissionRequestCard
        permission={permission}
        client={client}
        isShortcutTarget={permission.key === shortcutTargetKey}
        isShortcutOwner={isShortcutOwner}
        registerShortcutTarget={registerShortcutTarget}
        onStartResponding={onStartResponding}
        onStopResponding={onStopResponding}
      />
    </>
  );
}

function RealQuestionCardSurface({
  permission,
  onRespond,
  dispatcherRef,
}: {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse, actionId: "submit" | "dismiss") => void;
  dispatcherRef: { current: Dispatcher | null };
}) {
  const dispatcher = useKeyboardActionDispatcher();
  useEffect(() => {
    dispatcherRef.current = dispatcher;
  }, [dispatcher, dispatcherRef]);
  const permissions = useMemo(() => [permission], [permission]);
  const { shortcutTargetKey, isShortcutOwner, registerShortcutTarget } = usePermissionShortcuts(
    permissions,
    { handlerId: "permission-shortcuts:real-question", isVisible: true },
  );
  return (
    <>
      <output data-testid="shortcut-owner">{isShortcutOwner ? "owner" : "covered"}</output>
      <QuestionFormCard
        permission={permission}
        onRespond={onRespond}
        isResponding={false}
        responseError={null}
        respondingActionId={null}
        isShortcutTarget={permission.key === shortcutTargetKey}
        isShortcutOwner={isShortcutOwner}
        registerShortcutTarget={registerShortcutTarget}
      />
    </>
  );
}

describe("permission shortcut coordination", () => {
  let root: Root;
  let container: HTMLDivElement;
  let actions: string[];
  let onAction: (action: string) => void;
  let dispatcherRef: { current: Dispatcher | null };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    actions = [];
    onAction = (action) => actions.push(action);
    dispatcherRef = { current: null };
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  interface SurfaceSpec {
    host: PaneHost;
    tabId: string;
    handlerId: string;
    permissions: PendingPermission[];
    isVisible?: boolean;
    isPaneFocused?: boolean;
    isWorkspaceFocused?: boolean;
    actionPrefix?: string;
    isResponding?: (key: string) => boolean;
  }

  function renderSurfaces(specs: readonly SurfaceSpec[], decorations: ReactNode = null) {
    flushSync(() =>
      root.render(
        <KeyboardActionDispatcherProvider>
          {decorations}
          {specs.map((spec) => (
            <PaneScope
              key={`${spec.host}:${spec.tabId}`}
              host={spec.host}
              tabId={spec.tabId}
              isPaneFocused={spec.isPaneFocused ?? true}
              isWorkspaceFocused={spec.isWorkspaceFocused ?? true}
            >
              <ShortcutSurface
                permissions={spec.permissions}
                handlerId={spec.handlerId}
                isVisible={spec.isVisible ?? true}
                isResponding={spec.isResponding}
                onAction={onAction}
                actionPrefix={spec.actionPrefix}
                dispatcherRef={dispatcherRef}
              />
            </PaneScope>
          ))}
        </KeyboardActionDispatcherProvider>,
      ),
    );
  }

  function render(
    permissions: PendingPermission[],
    options: {
      host?: PaneHost;
      tabId?: string;
      isVisible?: boolean;
      isPaneFocused?: boolean;
      isWorkspaceFocused?: boolean;
      isResponding?: (key: string) => boolean;
    } = {},
  ) {
    renderSurfaces([
      {
        host: options.host ?? "main",
        tabId: options.tabId ?? "main",
        handlerId: "permission-shortcuts:test",
        permissions,
        isVisible: options.isVisible,
        isPaneFocused: options.isPaneFocused,
        isWorkspaceFocused: options.isWorkspaceFocused,
        isResponding: options.isResponding,
      },
    ]);
  }

  function renderTwoVisiblePanes(interactivePane: "left" | "right") {
    renderSurfaces([
      {
        host: "main",
        tabId: "left",
        handlerId: "permission-shortcuts:left",
        permissions: [createPermission("left")],
        isPaneFocused: interactivePane === "left",
        actionPrefix: "left",
      },
      {
        host: "main",
        tabId: "right",
        handlerId: "permission-shortcuts:right",
        permissions: [createPermission("right")],
        isPaneFocused: interactivePane === "right",
        actionPrefix: "right",
      },
    ]);
  }

  function dispatch(actionId: "permission.accept" | "permission.deny" | "permission.focus") {
    const dispatcher = dispatcherRef.current;
    if (!dispatcher) throw new Error("Missing keyboard action dispatcher");
    return dispatcher.dispatch({ id: actionId, scope: "workspace" });
  }

  function renderRealCard(node: ReactNode) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    flushSync(() =>
      root.render(
        <KeyboardActionDispatcherProvider>
          <QueryClientProvider client={queryClient}>
            <PortalProvider>
              <PaneScope host="main" tabId="main" isPaneFocused>
                <FloatingPanelPortalHost />
                <RealHoverCard />
                {node}
              </PaneScope>
            </PortalProvider>
          </QueryClientProvider>
        </KeyboardActionDispatcherProvider>,
      ),
    );
  }

  function shortcutOwnerLabel(): string | null | undefined {
    return container.querySelector('[data-testid="shortcut-owner"]')?.textContent;
  }

  async function openHoverCard() {
    const trigger = container.querySelector('[data-testid="hover-trigger"]');
    if (!(trigger instanceof HTMLElement)) throw new Error("Missing hover trigger");
    await userEvent.hover(trigger);
    await vi.waitFor(() => expect(shortcutOwnerLabel()).toBe("covered"));
  }

  async function closeHoverCard() {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await vi.waitFor(() => expect(shortcutOwnerLabel()).toBe("owner"));
  }

  function pressCardKey(element: HTMLElement, key: string, options: { altKey?: boolean } = {}) {
    const event = new KeyboardEvent("keydown", {
      key,
      altKey: options.altKey ?? false,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      element.dispatchEvent(event);
    });
    return event;
  }

  it("skips targets whose card is responding and allows retry after its failure reset", () => {
    const responding = new Set(["first"]);
    render([createPermission("first"), createPermission("second")], {
      isResponding: (key) => responding.has(key),
    });

    expect(dispatch("permission.focus")).toBe(true);
    expect(document.activeElement?.getAttribute("data-permission")).toBe("second");
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["accept second"]);
    expect(dispatch("permission.deny")).toBe(false);

    responding.delete("first");
    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["accept second", "deny first"]);
  });

  it("focuses the target, advances immediately while responding, and restores it after failure", () => {
    render([createPermission("first"), createPermission("second")]);
    expect(container.querySelector("output")?.textContent).toBe("first");
    expect(hasPermissionShortcutClaims()).toBe(true);

    expect(dispatch("permission.focus")).toBe(true);
    expect(document.activeElement?.getAttribute("data-permission")).toBe("first");

    flushSync(() => {
      expect(dispatch("permission.accept")).toBe(true);
      expect(dispatch("permission.deny")).toBe(true);
    });
    expect(actions).toEqual(["accept first", "deny second"]);
    expect(container.querySelector("output")?.textContent).toBe("none");
    expect(hasPermissionShortcutClaims()).toBe(false);
    expect(dispatch("permission.accept")).toBe(false);

    const first = container.querySelector<HTMLButtonElement>('[data-permission="first"]');
    if (!first) throw new Error("Missing first permission button");
    flushSync(() => first.click());
    expect(container.querySelector("output")?.textContent).toBe("first");
    expect(hasPermissionShortcutClaims()).toBe(true);

    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["accept first", "deny second", "deny first"]);
  });

  it("forgets removed requests and stops handling actions when unmounted", () => {
    render([createPermission("first")]);
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    render([]);
    expect(dispatch("permission.accept")).toBe(false);

    render([createPermission("first")]);
    expect(container.querySelector("output")?.textContent).toBe("first");
    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["accept first", "deny first"]);

    render([createPermission("second")]);
    expect(container.querySelector("output")?.textContent).toBe("second");
    flushSync(() => root.render(null));
    expect(dispatch("permission.accept")).toBe(false);
    expect(actions).toEqual(["accept first", "deny first"]);
  });

  it("ignores actions while the panel is mounted but hidden", () => {
    render([createPermission("first")], { isVisible: false });
    expect(container.querySelector("output")?.textContent).toBe("none");
    expect(hasPermissionShortcutClaims()).toBe(false);

    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);
    expect(actions).toEqual([]);

    render([createPermission("first")]);
    expect(container.querySelector("output")?.textContent).toBe("first");
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["accept first"]);
  });

  it("ignores a visible pane that is not the interactive pane", () => {
    render([createPermission("first")], { isPaneFocused: false });
    expect(container.querySelector("output")?.textContent).toBe("none");

    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);
    expect(actions).toEqual([]);

    render([createPermission("first")], { isPaneFocused: true });
    expect(container.querySelector("output")?.textContent).toBe("first");
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["accept first"]);
  });

  it("routes to the interactive pane when two visible panes have pending requests", () => {
    // Left registers first, right last: the dispatcher reaches the later
    // registration first, so visibility-only eligibility would answer right.
    renderTwoVisiblePanes("left");
    expect(dispatch("permission.focus")).toBe(true);
    expect(document.activeElement?.getAttribute("data-permission")).toBe("left");
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["left:accept left"]);

    renderTwoVisiblePanes("right");
    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["left:accept left", "right:deny right"]);
  });

  it("answers from the focused main pane, not Explorer, when both report interactive", () => {
    // Explorer passes isPaneFocused while the main pane has it too. Explorer
    // registers last, so registration order would reach it first if it owned keys.
    renderSurfaces([
      {
        host: "main",
        tabId: "main",
        handlerId: "permission-shortcuts:agent",
        permissions: [createPermission("duplicate")],
        actionPrefix: "main",
      },
      {
        host: "explorer",
        tabId: "explorer",
        handlerId: "permission-shortcuts:agent",
        permissions: [createPermission("duplicate")],
        actionPrefix: "explorer",
      },
    ]);

    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["main:accept duplicate"]);
  });

  it("does not fall through to a pending request in a non-owner pane", () => {
    renderSurfaces([
      {
        host: "main",
        tabId: "main",
        handlerId: "permission-shortcuts:main",
        permissions: [],
        actionPrefix: "main",
      },
      {
        host: "explorer",
        tabId: "explorer",
        handlerId: "permission-shortcuts:explorer",
        permissions: [createPermission("explorer")],
        actionPrefix: "explorer",
      },
    ]);

    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);
    expect(actions).toEqual([]);
  });

  it("answers from the top workspace sheet, not the covered pane or sheet", () => {
    renderSurfaces(
      [
        {
          host: "main",
          tabId: "main",
          handlerId: "permission-shortcuts:main",
          permissions: [createPermission("main")],
          actionPrefix: "main",
        },
        {
          host: "sheet",
          tabId: "covered",
          handlerId: "permission-shortcuts:covered",
          permissions: [createPermission("covered")],
          isPaneFocused: false,
          actionPrefix: "covered",
        },
        {
          host: "sheet",
          tabId: "sheet",
          handlerId: "permission-shortcuts:sheet",
          permissions: [createPermission("sheet")],
          actionPrefix: "sheet",
        },
      ],
      [
        <TestPresentation key="covered" layer={20} hostedTabId="covered" />,
        <TestPresentation key="sheet" layer={30} hostedTabId="sheet" />,
      ],
    );

    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["sheet:accept sheet"]);
  });

  it("answers from a menu fill page through its real sheet presentation, without an overlay", () => {
    renderSurfaces(
      [
        {
          host: "main",
          tabId: "main",
          handlerId: "permission-shortcuts:main",
          permissions: [createPermission("main")],
          actionPrefix: "main",
        },
        {
          host: "sheet",
          tabId: "menu-page",
          handlerId: "permission-shortcuts:menu-page",
          permissions: [createPermission("menu-page")],
          actionPrefix: "menu-page",
        },
      ],
      <TestPresentation layer={20} hostedTabId="menu-page" />,
    );

    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["menu-page:deny menu-page"]);
  });

  it("blocks every covered pane when the top sheet hosts no permission card", () => {
    renderSurfaces(
      [
        {
          host: "main",
          tabId: "main",
          handlerId: "permission-shortcuts:main",
          permissions: [createPermission("main")],
          actionPrefix: "main",
        },
        {
          host: "sheet",
          tabId: "file-sheet",
          handlerId: "permission-shortcuts:file",
          permissions: [createPermission("file")],
          actionPrefix: "file",
        },
      ],
      <TestPresentation layer={20} hostedTabId="other-sheet" />,
    );

    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);
    expect(actions).toEqual([]);
  });

  it("restores the sheet after an overlay above it closes, and ignores an overlay below it", () => {
    const mainSurface: SurfaceSpec = {
      host: "main",
      tabId: "main",
      handlerId: "permission-shortcuts:main",
      permissions: [createPermission("main")],
      actionPrefix: "main",
    };
    const sheetSurface: SurfaceSpec = {
      host: "sheet",
      tabId: "sheet",
      handlerId: "permission-shortcuts:sheet",
      permissions: [createPermission("sheet")],
      actionPrefix: "sheet",
    };
    const sheetPresentation = <TestPresentation key="sheet" layer={20} hostedTabId="sheet" />;

    renderSurfaces(
      [mainSurface, sheetSurface],
      [<TestKeyboardOverlay key="below" layer={10} manageFocus={false} />, sheetPresentation],
    );
    flushSync(() => expect(dispatch("permission.focus")).toBe(true));
    expect(document.activeElement?.getAttribute("data-permission")).toBe("sheet");

    renderSurfaces(
      [mainSurface, sheetSurface],
      [sheetPresentation, <TestKeyboardOverlay key="above" layer={30} manageFocus={false} />],
    );
    expect(dispatch("permission.focus")).toBe(false);

    renderSurfaces([mainSurface, sheetSurface], [sheetPresentation]);
    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["sheet:deny sheet"]);
  });

  it("lets a menu page take ownership from a workspace sheet and return it on dismiss", () => {
    const sheetSurface: SurfaceSpec = {
      host: "sheet",
      tabId: "sheet",
      handlerId: "permission-shortcuts:sheet",
      permissions: [createPermission("sheet")],
      actionPrefix: "sheet",
    };
    const menuSurface: SurfaceSpec = {
      host: "sheet",
      tabId: "menu-page",
      handlerId: "permission-shortcuts:menu-page",
      permissions: [createPermission("menu-page")],
      actionPrefix: "menu-page",
    };
    const sheetPresentation = <TestPresentation key="sheet" layer={20} hostedTabId="sheet" />;
    const menuPresentation = <TestPresentation key="menu" layer={30} hostedTabId="menu-page" />;

    renderSurfaces([sheetSurface], [sheetPresentation]);
    flushSync(() => expect(dispatch("permission.focus")).toBe(true));
    expect(document.activeElement?.getAttribute("data-permission")).toBe("sheet");

    renderSurfaces([sheetSurface, menuSurface], [sheetPresentation, menuPresentation]);
    flushSync(() => expect(dispatch("permission.accept")).toBe(true));
    expect(actions).toEqual(["menu-page:accept menu-page"]);

    renderSurfaces([sheetSurface, menuSurface], [sheetPresentation]);
    flushSync(() => expect(dispatch("permission.deny")).toBe(true));
    expect(actions).toEqual(["menu-page:accept menu-page", "sheet:deny sheet"]);
  });

  it("blocks the focused main pane behind a compact Explorer overlay", () => {
    renderSurfaces(
      [
        {
          host: "main",
          tabId: "main",
          handlerId: "permission-shortcuts:main",
          permissions: [createPermission("main")],
          actionPrefix: "main",
        },
      ],
      <TestPresentation layer={20} hostedTabId={null} />,
    );

    expect(dispatch("permission.accept")).toBe(false);
    expect(actions).toEqual([]);
  });

  it("blocks permission actions while a hover card is open", () => {
    renderSurfaces(
      [
        {
          host: "main",
          tabId: "main",
          handlerId: "permission-shortcuts:main",
          permissions: [createPermission("main")],
          actionPrefix: "main",
        },
      ],
      <TestKeyboardOverlay layer={10} manageFocus={false} />,
    );

    expect(dispatch("permission.accept")).toBe(false);
    expect(actions).toEqual([]);
  });

  it("blocks a focused permission card under a real hover card and answers after it closes", async () => {
    respondToPermissionAndWait.mockClear();
    const permission = createPermission("first");
    renderRealCard(
      <RealPermissionCardSurface
        permission={permission}
        client={permissionClient}
        dispatcherRef={dispatcherRef}
      />,
    );

    await vi.waitFor(() => expect(shortcutOwnerLabel()).toBe("owner"));
    const question = container.querySelector('[data-testid="permission-request-question"]');
    const card = question?.parentElement;
    if (!(card instanceof HTMLElement)) throw new Error("Permission card did not render");
    act(() => card.focus());
    expect(document.activeElement).toBe(card);

    await openHoverCard();
    pressCardKey(card, "a", { altKey: true });
    pressCardKey(card, "d", { altKey: true });
    pressCardKey(card, "Enter");
    expect(respondToPermissionAndWait).not.toHaveBeenCalled();
    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);

    await closeHoverCard();
    pressCardKey(card, "a", { altKey: true });
    await vi.waitFor(() => expect(respondToPermissionAndWait).toHaveBeenCalledTimes(1));
    expect(respondToPermissionAndWait.mock.calls[0]?.slice(0, 3)).toEqual([
      "agent",
      "first",
      { behavior: "allow", selectedActionId: "accept" },
    ]);
  });

  it("blocks a focused question card under a real hover card and submits after it closes", async () => {
    const onRespond =
      vi.fn<(response: AgentPermissionResponse, actionId: "submit" | "dismiss") => void>();
    const permission = createQuestionPermission();
    renderRealCard(
      <RealQuestionCardSurface
        permission={permission}
        onRespond={onRespond}
        dispatcherRef={dispatcherRef}
      />,
    );

    await vi.waitFor(() => expect(shortcutOwnerLabel()).toBe("owner"));
    const card = container.querySelector('[data-testid="question-form-card"]');
    if (!(card instanceof HTMLElement)) throw new Error("Question card did not render");
    act(() => within(card).getByRole("radio", { name: "Codex" }).click());
    act(() => card.focus());
    expect(document.activeElement).toBe(card);

    await openHoverCard();
    pressCardKey(card, "a", { altKey: true });
    pressCardKey(card, "d", { altKey: true });
    pressCardKey(card, "Enter");
    expect(onRespond).not.toHaveBeenCalled();
    expect(dispatch("permission.accept")).toBe(false);
    expect(dispatch("permission.deny")).toBe(false);
    expect(dispatch("permission.focus")).toBe(false);

    await closeHoverCard();
    pressCardKey(card, "a", { altKey: true });
    await vi.waitFor(() => expect(onRespond).toHaveBeenCalledTimes(1));
    const response = onRespond.mock.calls[0]?.[0];
    expect(response?.behavior).toBe("allow");
    if (response?.behavior !== "allow") throw new Error("Question card did not submit");
    expect((response.updatedInput as { answers: Record<string, string> }).answers).toEqual({
      Provider: "Codex",
    });
  });
});

describe("permission shortcut ownership", () => {
  const focused = {
    tabId: "surface",
    isVisible: true,
    isWorkspaceFocused: true,
    isPaneFocused: true,
    topPresentation: null,
  };

  it("keeps the focused main pane owning the shortcuts only while nothing covers it", () => {
    expect(ownsPermissionShortcuts({ ...focused, host: "main" })).toBe(true);
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "main",
        topPresentation: { hostedTabId: null },
      }),
    ).toBe(false);
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "main",
        topPresentation: { hostedTabId: "sheet" },
      }),
    ).toBe(false);
  });

  it("lets a sheet take the shortcuts only when it hosts the top surface's tab", () => {
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "sheet",
        tabId: "sheet",
        topPresentation: { hostedTabId: "sheet" },
      }),
    ).toBe(true);
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "sheet",
        tabId: "covered",
        topPresentation: { hostedTabId: "sheet" },
      }),
    ).toBe(false);
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "sheet",
        tabId: "sheet",
        topPresentation: { hostedTabId: null },
      }),
    ).toBe(false);
  });

  it("never gives Explorer keyboard ownership", () => {
    expect(ownsPermissionShortcuts({ ...focused, host: "explorer" })).toBe(false);
    expect(
      ownsPermissionShortcuts({
        ...focused,
        host: "explorer",
        topPresentation: { hostedTabId: "explorer" },
      }),
    ).toBe(false);
  });

  it("requires a visible, focused surface", () => {
    expect(ownsPermissionShortcuts({ ...focused, host: "main", isVisible: false })).toBe(false);
    expect(ownsPermissionShortcuts({ ...focused, host: "main", isWorkspaceFocused: false })).toBe(
      false,
    );
    expect(ownsPermissionShortcuts({ ...focused, host: "main", isPaneFocused: false })).toBe(false);
  });
});
