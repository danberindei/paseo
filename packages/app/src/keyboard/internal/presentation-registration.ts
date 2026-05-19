import { useLayoutEffect, useRef } from "react";
import { overlays, type PresentationEntry } from "./overlays";

export interface PresentationRegistrationInput {
  /** True only while the surface is actually presented. */
  active: boolean;
  /** The surface's layer relative to other presentations. */
  layer: number;
  /** The workspace this surface covers. `null` covers every workspace. */
  workspaceKey?: string | null;
  /** The workspace tab whose pane this surface hosts, or `null` when it hosts none. */
  hostedTabId?: string | null;
}

/**
 * Registers presentation ownership without taking part in key dispatch. Keyboard overlays
 * already register through `useOverlayRegistration`; this hook is for surfaces that are not
 * keyboard overlays, such as bottom sheets and compact sidebars.
 */
export function usePresentationRegistration(input: PresentationRegistrationInput) {
  const current = useRef(input);
  current.current = input;
  const { active, layer, workspaceKey, hostedTabId } = input;
  useLayoutEffect(() => {
    if (!active) return;
    const entry: PresentationEntry = {
      getLayer: () => current.current.layer,
      getWorkspaceKey: () => current.current.workspaceKey ?? null,
      getHostedTabId: () => current.current.hostedTabId ?? null,
    };
    return overlays.registerPresentation(entry);
  }, [active, layer, workspaceKey, hostedTabId]);
}
