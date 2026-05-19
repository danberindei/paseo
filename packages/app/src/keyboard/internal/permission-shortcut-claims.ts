import { createStore } from "zustand/vanilla";
import type { KeyboardActionId } from "../actions";

export const PERMISSION_SHORTCUT_ACTIONS = [
  "permission.accept",
  "permission.deny",
  "permission.focus",
] as const satisfies readonly KeyboardActionId[];

const claims = createStore(() => 0);

export function registerPermissionShortcutClaims(): () => void {
  claims.setState((count) => count + 1);
  return () => claims.setState((count) => count - 1);
}

export function hasPermissionShortcutClaims(): boolean {
  return claims.getState() > 0;
}

export const subscribePermissionShortcutClaims = claims.subscribe;
