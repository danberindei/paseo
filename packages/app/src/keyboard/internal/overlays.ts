import type { KeyboardShortcutInput } from "../keyboard-shortcuts";

export interface KeyboardInputEvent extends KeyboardShortcutInput {
  isComposing?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}
/**
 * A surface that covers a pane. Every keyboard overlay is also a presentation, so menus,
 * modals, and hover cards take part in the same order as bottom sheets.
 */
export interface PresentationEntry {
  getLayer(): number;
  /** The workspace this surface covers. `null` covers every workspace. */
  getWorkspaceKey?(): string | null;
  /** The workspace tab whose pane this surface hosts. `null` hosts no permission card. */
  getHostedTabId?(): string | null;
}
export interface OverlayEntry extends PresentationEntry {
  getKeys(): readonly string[];
  onKeyDown(event: KeyboardInputEvent): boolean;
}
interface StoredEntry {
  id: number;
  entry: PresentationEntry;
  handlesKeys: boolean;
}
export interface PresentationOwner {
  /** The workspace tab whose pane is hosted by the top covering surface, if any. */
  hostedTabId: string | null;
}

const OWNER_SEPARATOR = "\u0000";

export function createOverlayRegistry() {
  const entries: StoredEntry[] = [];
  const listeners = new Set<() => void>();
  let nextId = 0;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  /**
   * The highest layer wins, and the newest registration wins a tie. Entries are kept in
   * registration order, so iterating with `>=` implements that rule for both key dispatch and
   * presentation ownership.
   */
  function topMatching(predicate: (item: StoredEntry) => boolean): StoredEntry | undefined {
    return entries.reduce<StoredEntry | undefined>((top, item) => {
      if (!predicate(item)) return top;
      return !top || item.entry.getLayer() >= top.entry.getLayer() ? item : top;
    }, undefined);
  }
  function topPresentationForWorkspace(workspaceKey: string | null): StoredEntry | undefined {
    return topMatching((item) => {
      const entryWorkspaceKey = item.entry.getWorkspaceKey?.() ?? null;
      return entryWorkspaceKey === null || entryWorkspaceKey === workspaceKey;
    });
  }
  function add(entry: PresentationEntry, handlesKeys: boolean) {
    const stored: StoredEntry = { id: ++nextId, entry, handlesKeys };
    entries.push(stored);
    notify();
    return () => {
      const index = entries.indexOf(stored);
      if (index < 0) return;
      entries.splice(index, 1);
      notify();
    };
  }
  return {
    getTop(): OverlayEntry | undefined {
      return topMatching((item) => item.handlesKeys)?.entry as OverlayEntry | undefined;
    },
    getKeys: () =>
      (topMatching((item) => item.handlesKeys)?.entry as OverlayEntry | undefined)?.getKeys() ?? [],
    hasActive: () => entries.some((item) => item.handlesKeys),
    /** The top covering surface, keyboard-handling or not. */
    getTopPresentationLayer: () => topMatching(() => true)?.entry.getLayer() ?? 0,
    /**
     * The surface that owns permission shortcuts for a workspace. A covering surface with no
     * hosted tab blocks the panes under it instead of letting one of them fall back.
     */
    getPresentationOwner(workspaceKey: string | null): PresentationOwner | null {
      const top = topPresentationForWorkspace(workspaceKey);
      return top ? { hostedTabId: top.entry.getHostedTabId?.() ?? null } : null;
    },
    getPresentationOwnerSnapshot(workspaceKey: string | null): string {
      const top = topPresentationForWorkspace(workspaceKey);
      return top ? `${top.id}${OWNER_SEPARATOR}${top.entry.getHostedTabId?.() ?? ""}` : "";
    },
    parsePresentationOwnerSnapshot(snapshot: string): PresentationOwner | null {
      if (!snapshot) return null;
      const separator = snapshot.indexOf(OWNER_SEPARATOR);
      const hostedTabId = separator >= 0 ? snapshot.slice(separator + 1) : "";
      return { hostedTabId: hostedTabId === "" ? null : hostedTabId };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(entry: OverlayEntry) {
      return add(entry, true);
    },
    /** Registers presentation ownership without taking part in key dispatch. */
    registerPresentation(entry: PresentationEntry) {
      return add(entry, false);
    },
    dispatch(event: KeyboardInputEvent): boolean {
      if (event.isComposing || event.key === "Process") return false;
      const top = topMatching((item) => item.handlesKeys)?.entry as OverlayEntry | undefined;
      if (!top?.onKeyDown(event)) return false;
      event.stopPropagation();
      return true;
    },
  };
}
export const overlays = createOverlayRegistry();
