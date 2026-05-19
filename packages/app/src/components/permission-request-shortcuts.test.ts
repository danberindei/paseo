import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  createFocusedPermissionRequestKeydownHandler,
  type PermissionRequestCardKeydownEvent,
} from "./permission-request-shortcuts";

type VoidMock = Mock<() => void>;

function createCardEvent(
  key: string,
  options: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    useCardSurfaceTarget?: boolean;
    target?: unknown;
  } = {},
): PermissionRequestCardKeydownEvent & {
  preventDefault: VoidMock;
  stopPropagation: VoidMock;
  stopImmediatePropagation?: VoidMock;
} {
  const cardSurface = {};
  const childTarget = {};
  return {
    key,
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
    currentTarget: cardSurface,
    target: options.target ?? (options.useCardSurfaceTarget === false ? childTarget : cardSurface),
    preventDefault: vi.fn<() => void>(),
    stopPropagation: vi.fn<() => void>(),
    stopImmediatePropagation: vi.fn<() => void>(),
  };
}

function createHandler(overrides: { isResponding?: boolean; isShortcutOwner?: boolean } = {}) {
  const onAccept = vi.fn<() => void>();
  const onDeny = vi.fn<() => void>();
  const handler = createFocusedPermissionRequestKeydownHandler({
    isResponding: overrides.isResponding ?? false,
    isShortcutOwner: overrides.isShortcutOwner ?? true,
    onAccept,
    onDeny,
  });

  return { handler, onAccept, onDeny };
}

describe("permission-request-shortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when the permission request is already responding", () => {
    const { handler, onAccept, onDeny } = createHandler({ isResponding: true });

    expect(handler(createCardEvent("a", { altKey: true }))).toBe(false);
    expect(handler(createCardEvent("d", { altKey: true }))).toBe(false);
    expect(handler(createCardEvent("Enter"))).toBe(false);
    expect(handler(createCardEvent("Escape"))).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("fires Enter and Escape when the focused card surface handles the event", () => {
    const { handler, onAccept, onDeny } = createHandler();

    const enterEvent = createCardEvent("Enter");
    expect(handler(enterEvent)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(enterEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(enterEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const escapeEvent = createCardEvent("Escape");
    expect(handler(escapeEvent)).toBe(true);
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(escapeEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("handles a focused card event without stopImmediatePropagation", () => {
    const { handler, onAccept } = createHandler();
    const event = createCardEvent("Enter");
    delete event.stopImmediatePropagation;

    expect(handler(event)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("ignores plain Enter and Escape from child controls", () => {
    const { handler, onAccept, onDeny } = createHandler();

    const enterEvent = createCardEvent("Enter", { useCardSurfaceTarget: false });
    expect(handler(enterEvent)).toBe(false);

    const escapeEvent = createCardEvent("Escape", { useCardSurfaceTarget: false });
    expect(handler(escapeEvent)).toBe(false);

    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(enterEvent.preventDefault).not.toHaveBeenCalled();
    expect(escapeEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("fires Alt+A and Alt+D from focused card handler", () => {
    const { handler, onAccept, onDeny } = createHandler();

    const acceptEvent = createCardEvent("a", { altKey: true, useCardSurfaceTarget: false });
    expect(handler(acceptEvent)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);

    const denyEvent = createCardEvent("d", { altKey: true, useCardSurfaceTarget: false });
    expect(handler(denyEvent)).toBe(true);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Alt+A", "a", { altKey: true }],
    ["Alt+D", "d", { altKey: true }],
    ["Enter", "Enter", {}],
    ["Escape", "Escape", {}],
  ] as const)("blocks %s while another surface owns the shortcuts", (_label, key, options) => {
    const { handler, onAccept, onDeny } = createHandler({ isShortcutOwner: false });
    const event = createCardEvent(key, options);

    expect(handler(event)).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("keeps arrow navigation local while another surface owns the shortcuts", () => {
    const onNavigate = vi.fn<() => void>();
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      isShortcutOwner: false,
      onAccept: vi.fn<() => void>(),
      onDeny: vi.fn<() => void>(),
      arrowNavigation: {
        itemCount: () => 2,
        currentIndex: () => 0,
        onNavigate,
      },
    });

    const downEvent = createCardEvent("ArrowDown");
    expect(handler(downEvent)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  const extraModifierCases: Array<
    [string, "a" | "d", { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }]
  > = [
    ["Ctrl+Alt+A", "a", { ctrlKey: true }],
    ["Meta+Alt+A", "a", { metaKey: true }],
    ["Shift+Alt+A", "a", { shiftKey: true }],
    ["Ctrl+Alt+D", "d", { ctrlKey: true }],
    ["Meta+Alt+D", "d", { metaKey: true }],
    ["Shift+Alt+D", "d", { shiftKey: true }],
  ];

  it.each(extraModifierCases)("ignores %s from the focused card handler", (label, key, extra) => {
    const { handler, onAccept, onDeny } = createHandler();
    const event = createCardEvent(key, { altKey: true, ...extra });

    expect(handler(event)).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it.each([["Enter"], ["Escape"]])("ignores %s when Alt is held", (key) => {
    const { handler, onAccept, onDeny } = createHandler();
    const event = createCardEvent(key, { altKey: true });

    expect(handler(event)).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("supports arrow navigation when provided", () => {
    const onNavigate = vi.fn<() => void>();
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      isShortcutOwner: true,
      onAccept: vi.fn<() => void>(),
      onDeny: vi.fn<() => void>(),
      arrowNavigation: {
        itemCount: () => 3,
        currentIndex: () => 0,
        onNavigate,
      },
    });

    const downEvent = createCardEvent("ArrowDown");
    expect(handler(downEvent)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(1);

    const upEvent = createCardEvent("ArrowUp");
    expect(handler(upEvent)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  it("navigates from a registered option target and ignores unrelated child targets", () => {
    const optionTarget = {};
    const onNavigate = vi.fn<() => void>();
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      isShortcutOwner: true,
      onAccept: vi.fn<() => void>(),
      onDeny: vi.fn<() => void>(),
      arrowNavigation: {
        itemCount: () => 3,
        currentIndex: () => 0,
        onNavigate,
        isOptionTarget: (target) => target === optionTarget,
      },
    });

    const downEvent = createCardEvent("ArrowDown", { target: optionTarget });
    expect(handler(downEvent)).toBe(true);
    expect(downEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(1);

    const upEvent = createCardEvent("ArrowUp", { target: optionTarget });
    expect(handler(upEvent)).toBe(true);
    expect(onNavigate).toHaveBeenCalledWith(2);

    const childEvent = createCardEvent("ArrowDown", { useCardSurfaceTarget: false });
    expect(handler(childEvent)).toBe(false);
    expect(childEvent.preventDefault).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it.each(["ArrowUp", "ArrowDown"])("ignores %s from a child control", (key) => {
    const onNavigate = vi.fn<() => void>();
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      isShortcutOwner: true,
      onAccept: vi.fn<() => void>(),
      onDeny: vi.fn<() => void>(),
      arrowNavigation: {
        itemCount: () => 3,
        currentIndex: () => 0,
        onNavigate,
      },
    });
    const event = createCardEvent(key, { useCardSurfaceTarget: false });

    expect(handler(event)).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });
});
