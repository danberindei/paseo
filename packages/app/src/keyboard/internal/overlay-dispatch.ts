import { overlays } from "./overlays";
export const dispatchTopOverlayKeyDown = overlays.dispatch;
export const hasActiveOverlay = overlays.hasActive;
export const getTopOverlayKeys = overlays.getKeys;
export const subscribeOverlays = overlays.subscribe;
export const getPresentationOwnerSnapshot = overlays.getPresentationOwnerSnapshot;
export const parsePresentationOwnerSnapshot = overlays.parsePresentationOwnerSnapshot;
export function getTopOverlayLayer(): number {
  return overlays.getTopPresentationLayer();
}
