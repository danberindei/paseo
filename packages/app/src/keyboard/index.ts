export { useOverlayRegistration } from "./internal/overlay-registration";
export { usePresentationRegistration } from "./internal/presentation-registration";
export {
  PERMISSION_SHORTCUT_ACTIONS,
  registerPermissionShortcutClaims,
} from "./internal/permission-shortcut-claims";
export type { KeyboardInputEvent, PresentationOwner } from "./internal/overlays";
export {
  dispatchTopOverlayKeyDown,
  hasActiveOverlay,
  getTopOverlayKeys,
  getTopOverlayLayer,
  getPresentationOwnerSnapshot,
  parsePresentationOwnerSnapshot,
  subscribeOverlays,
} from "./internal/overlay-dispatch";
export { hasFocusedTextInput } from "./internal/focused-text-input";
export { useKeyboardFocusSurface } from "./internal/use-focus-surface";
export { subscribeHardwareKeyboard } from "./internal/sources/hardware";
export type { HardwareKeyboardEvent } from "./internal/sources/hardware";
export { usesDesktopBindings, supportsConfigurableComposerSendKeys } from "./internal/conventions";
export type { BrowserKeyboardPolicy } from "./internal/sources/electron-browser";
export { useHardwareKeyboardPresent } from "./availability";
