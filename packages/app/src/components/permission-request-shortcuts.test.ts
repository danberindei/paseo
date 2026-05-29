import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFocusedPermissionRequestKeydownHandler,
  createPermissionRequestShortcutHandler,
  type PermissionRequestCardKeydownEvent,
  registerPermissionRequestShortcuts,
  type PermissionRequestShortcutKeydownEvent,
} from "./permission-request-shortcuts";

type VoidMock = ReturnType<typeof vi.fn> & (() => void);

function createEvent(
  key: string,
  altKey = false,
): PermissionRequestShortcutKeydownEvent & {
  preventDefault: VoidMock;
  stopPropagation: VoidMock;
  stopImmediatePropagation: VoidMock;
} {
  return {
    key,
    altKey,
    preventDefault: vi.fn() as unknown as VoidMock,
    stopPropagation: vi.fn() as unknown as VoidMock,
    stopImmediatePropagation: vi.fn() as unknown as VoidMock,
  };
}

function createCardEvent(
  key: string,
  options: {
    altKey?: boolean;
    useCardSurfaceTarget?: boolean;
  } = {},
): PermissionRequestCardKeydownEvent & {
  preventDefault: VoidMock;
  stopPropagation: VoidMock;
  stopImmediatePropagation: VoidMock;
} {
  const cardSurface = {};
  const childTarget = {};
  return {
    key,
    altKey: options.altKey ?? false,
    currentTarget: cardSurface,
    target: options.useCardSurfaceTarget === false ? childTarget : cardSurface,
    preventDefault: vi.fn() as unknown as VoidMock,
    stopPropagation: vi.fn() as unknown as VoidMock,
    stopImmediatePropagation: vi.fn() as unknown as VoidMock,
  };
}

function createHandler(
  overrides: {
    isResponding?: boolean;
    onAccept?: VoidMock;
    onDeny?: VoidMock;
    onFocus?: VoidMock;
  } = {},
) {
  const onAccept = overrides.onAccept ?? (vi.fn() as unknown as VoidMock);
  const onDeny = overrides.onDeny ?? (vi.fn() as unknown as VoidMock);
  const onFocus = overrides.onFocus ?? (vi.fn() as unknown as VoidMock);
  const handler = createPermissionRequestShortcutHandler({
    isResponding: overrides.isResponding ?? false,
    onAccept,
    onDeny,
    onFocus,
  });

  return {
    handler,
    onAccept,
    onDeny,
    onFocus,
  };
}

describe("permission-request-shortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers and cleans up the keydown listener in capture phase", () => {
    const listeners = new Map<string, (event: PermissionRequestShortcutKeydownEvent) => void>();
    const windowLike = {
      addEventListener: vi.fn(
        (
          type: "keydown",
          listener: (event: PermissionRequestShortcutKeydownEvent) => void,
          capture?: boolean,
        ) => {
          expect(type).toBe("keydown");
          expect(capture).toBe(true);
          listeners.set(type, listener);
        },
      ),
      removeEventListener: vi.fn(
        (
          type: "keydown",
          listener: (event: PermissionRequestShortcutKeydownEvent) => void,
          capture?: boolean,
        ) => {
          expect(type).toBe("keydown");
          expect(capture).toBe(true);
          expect(listeners.get(type)).toBe(listener);
          listeners.delete(type);
        },
      ),
    };

    const handler = vi.fn();
    const cleanup = registerPermissionRequestShortcuts({
      windowLike,
      handler,
    });

    expect(windowLike.addEventListener).toHaveBeenCalledTimes(1);
    expect(windowLike.addEventListener).toHaveBeenCalledWith("keydown", handler, true);

    cleanup();

    expect(windowLike.removeEventListener).toHaveBeenCalledTimes(1);
    expect(windowLike.removeEventListener).toHaveBeenCalledWith("keydown", handler, true);
  });

  it("fires accept on Alt+A and deny on Alt+D", () => {
    const { handler, onAccept, onDeny } = createHandler();

    const acceptEvent = createEvent("a", true);
    expect(handler(acceptEvent)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
    expect(acceptEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(acceptEvent.stopPropagation).toHaveBeenCalledTimes(1);

    const denyEvent = createEvent("d", true);
    expect(handler(denyEvent)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(denyEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(denyEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("fires focus on Alt+Q", () => {
    const { handler, onFocus, onAccept, onDeny } = createHandler();

    const event = createEvent("q", true);
    expect(handler(event)).toBe(true);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Enter", "enter"],
    ["Escape", "escape"],
    ["a", "a"],
  ])("ignores %s when Alt is not held", (_label, key) => {
    const { handler, onAccept, onDeny } = createHandler();
    const event = createEvent(key, false);

    expect(handler(event)).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it.each([
    ["Enter", "enter"],
    ["Escape", "escape"],
  ])("ignores %s when Alt is held", (_label, key) => {
    const { handler, onAccept, onDeny } = createHandler();
    const event = createEvent(key, true);

    expect(handler(event)).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("does nothing when the permission request is already responding", () => {
    const { handler, onAccept, onDeny } = createHandler({
      isResponding: true,
    });

    expect(handler(createEvent("a", true))).toBe(false);
    expect(handler(createEvent("d", true))).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("reads responding state lazily when provided as a getter", () => {
    const onAccept = vi.fn() as unknown as VoidMock;
    let responding = false;
    const handler = createPermissionRequestShortcutHandler({
      isResponding: () => responding,
      onAccept,
      onDeny: vi.fn() as unknown as VoidMock,
      onFocus: vi.fn() as unknown as VoidMock,
    });

    expect(handler(createEvent("a", true))).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);

    responding = true;
    expect(handler(createEvent("a", true))).toBe(false);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("fires Enter and Escape when the focused card surface handles the event", () => {
    const onAccept = vi.fn() as unknown as VoidMock;
    const onDeny = vi.fn() as unknown as VoidMock;
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      onAccept,
      onDeny,
    });

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

  it("ignores plain Enter and Escape from child controls", () => {
    const onAccept = vi.fn() as unknown as VoidMock;
    const onDeny = vi.fn() as unknown as VoidMock;
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      onAccept,
      onDeny,
    });

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
    const onAccept = vi.fn() as unknown as VoidMock;
    const onDeny = vi.fn() as unknown as VoidMock;
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      onAccept,
      onDeny,
    });

    const acceptEvent = createCardEvent("a", { altKey: true, useCardSurfaceTarget: false });
    expect(handler(acceptEvent)).toBe(true);
    expect(onAccept).toHaveBeenCalledTimes(1);

    const denyEvent = createCardEvent("d", { altKey: true, useCardSurfaceTarget: false });
    expect(handler(denyEvent)).toBe(true);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it("supports arrow navigation when provided", () => {
    const onNavigate = vi.fn() as unknown as VoidMock;
    const handler = createFocusedPermissionRequestKeydownHandler({
      isResponding: false,
      onAccept: vi.fn() as unknown as VoidMock,
      onDeny: vi.fn() as unknown as VoidMock,
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
});
