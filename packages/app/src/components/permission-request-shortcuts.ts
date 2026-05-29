export interface PermissionRequestShortcutKeydownEvent {
  key: string;
  altKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

export interface PermissionRequestCardKeydownEvent extends PermissionRequestShortcutKeydownEvent {
  currentTarget?: unknown;
  target?: unknown;
}

export interface PermissionRequestShortcutWindowLike {
  addEventListener(
    type: "keydown",
    listener: (event: PermissionRequestShortcutKeydownEvent) => void,
    options?: boolean,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: PermissionRequestShortcutKeydownEvent) => void,
    options?: boolean,
  ): void;
}

export interface ArrowNavigationOptions {
  itemCount: () => number;
  currentIndex: () => number;
  onNavigate: (index: number) => void;
}

export interface PermissionRequestGlobalShortcutHandlerOptions {
  isResponding: boolean | (() => boolean);
  onAccept: () => void;
  onDeny: () => void;
  onFocus: () => void;
}

function triggerShortcut(
  event: PermissionRequestShortcutKeydownEvent,
  action: () => void,
): boolean {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  action();
  return true;
}

export function createPermissionRequestShortcutHandler({
  isResponding,
  onAccept,
  onDeny,
  onFocus,
}: PermissionRequestGlobalShortcutHandlerOptions) {
  return (event: PermissionRequestShortcutKeydownEvent) => {
    if (!event.altKey) return false;

    const responding = typeof isResponding === "function" ? isResponding() : isResponding;
    if (responding) return false;

    const key = event.key.toLowerCase();

    if (key === "a") return triggerShortcut(event, onAccept);
    if (key === "d") return triggerShortcut(event, onDeny);
    if (key === "q") return triggerShortcut(event, onFocus);

    return false;
  };
}

export interface FocusedPermissionRequestKeydownOptions {
  isResponding: boolean | (() => boolean);
  onAccept: () => void;
  onDeny: () => void;
  arrowNavigation?: ArrowNavigationOptions;
}

function handleArrowNavigation(
  event: PermissionRequestCardKeydownEvent,
  key: string,
  arrowNavigation: ArrowNavigationOptions,
): boolean {
  if (event.altKey || (key !== "arrowup" && key !== "arrowdown")) return false;
  const count = arrowNavigation.itemCount();
  if (count <= 0) return false;
  const current = arrowNavigation.currentIndex();
  const delta = key === "arrowup" ? -1 : 1;
  let next = current + delta;
  if (next < 0) next = count - 1;
  if (next >= count) next = 0;
  return triggerShortcut(event, () => arrowNavigation.onNavigate(next));
}

export function createFocusedPermissionRequestKeydownHandler({
  isResponding,
  onAccept,
  onDeny,
  arrowNavigation,
}: FocusedPermissionRequestKeydownOptions) {
  return (event: PermissionRequestCardKeydownEvent) => {
    const responding = typeof isResponding === "function" ? isResponding() : isResponding;
    if (responding) return false;

    const key = event.key.toLowerCase();

    if (arrowNavigation && handleArrowNavigation(event, key, arrowNavigation)) {
      return true;
    }

    const isCardSurfaceTarget =
      event.target != null && event.currentTarget != null && event.target === event.currentTarget;

    if (!event.altKey && isCardSurfaceTarget && key === "enter") {
      return triggerShortcut(event, onAccept);
    }

    if (!event.altKey && isCardSurfaceTarget && key === "escape") {
      return triggerShortcut(event, onDeny);
    }

    if (event.altKey) {
      if (key === "a") return triggerShortcut(event, onAccept);
      if (key === "d") return triggerShortcut(event, onDeny);
    }

    return false;
  };
}

export function registerPermissionRequestShortcuts({
  windowLike,
  handler,
}: {
  windowLike: PermissionRequestShortcutWindowLike;
  handler: (event: PermissionRequestShortcutKeydownEvent) => void;
}) {
  windowLike.addEventListener("keydown", handler, true);
  return () => windowLike.removeEventListener("keydown", handler, true);
}
