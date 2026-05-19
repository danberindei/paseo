export interface PermissionRequestShortcutKeydownEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation?(): void;
}

export interface PermissionRequestCardKeydownEvent extends PermissionRequestShortcutKeydownEvent {
  currentTarget?: unknown;
  target?: unknown;
}

export interface ArrowNavigationOptions {
  itemCount: () => number;
  currentIndex: () => number;
  onNavigate: (index: number) => void;
  isOptionTarget?: (target: unknown) => boolean;
}

export interface FocusedPermissionRequestKeydownOptions {
  isResponding: boolean | (() => boolean);
  /**
   * False while another surface owns the permission shortcuts, for example an open hover card
   * registered above this card. Navigation stays local; answers do not.
   */
  isShortcutOwner: boolean;
  onAccept: () => void;
  onDeny: () => void;
  arrowNavigation?: ArrowNavigationOptions;
}

/**
 * Alt+A and Alt+D match only the bare chord. Windows reports AltGr as Ctrl+Alt,
 * and Ctrl/Meta/Shift+Alt+A belong to other bindings, so an extra modifier must
 * not approve or deny a request.
 */
function isBareAltKey(event: PermissionRequestShortcutKeydownEvent): boolean {
  return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

function triggerShortcut(
  event: PermissionRequestShortcutKeydownEvent,
  action: () => void,
): boolean {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  action();
  return true;
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

function isArrowNavigationTarget(
  event: PermissionRequestCardKeydownEvent,
  arrowNavigation: ArrowNavigationOptions,
): boolean {
  if (event.target == null) return false;
  if (event.currentTarget != null && event.target === event.currentTarget) return true;
  return arrowNavigation.isOptionTarget?.(event.target) === true;
}

export function createFocusedPermissionRequestKeydownHandler({
  isResponding,
  isShortcutOwner,
  onAccept,
  onDeny,
  arrowNavigation,
}: FocusedPermissionRequestKeydownOptions) {
  return (event: PermissionRequestCardKeydownEvent) => {
    const responding = typeof isResponding === "function" ? isResponding() : isResponding;
    if (responding) return false;

    const key = event.key.toLowerCase();

    const isCardSurfaceTarget =
      event.target != null && event.currentTarget != null && event.target === event.currentTarget;

    if (
      arrowNavigation &&
      isArrowNavigationTarget(event, arrowNavigation) &&
      handleArrowNavigation(event, key, arrowNavigation)
    ) {
      return true;
    }

    // A covering surface keeps DOM focus on the card but must block its answers.
    if (!isShortcutOwner) return false;

    if (!event.altKey && isCardSurfaceTarget && key === "enter") {
      return triggerShortcut(event, onAccept);
    }

    if (!event.altKey && isCardSurfaceTarget && key === "escape") {
      return triggerShortcut(event, onDeny);
    }

    if (isBareAltKey(event)) {
      if (key === "a") return triggerShortcut(event, onAccept);
      if (key === "d") return triggerShortcut(event, onDeny);
    }

    return false;
  };
}
