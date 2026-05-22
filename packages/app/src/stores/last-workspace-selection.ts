import { z } from "zod";

export interface ActiveWorkspaceSelection {
  serverId: string;
  workspaceId: string;
}

export const LAST_WORKSPACE_SELECTION_STORAGE_KEY = "paseo:last-workspace-route-selection";

export interface LastWorkspaceSelectionSnapshot {
  defaultSelection: ActiveWorkspaceSelection | null;
  selectionBySpaceId: Record<string, ActiveWorkspaceSelection>;
}

export interface LastWorkspaceSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const ActiveWorkspaceSelectionSchema: z.ZodType<ActiveWorkspaceSelection> = z.strictObject({
  serverId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
});

function normalizeSpaceId(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeWorkspaceSelection(input: unknown): ActiveWorkspaceSelection | null {
  const result = ActiveWorkspaceSelectionSchema.safeParse(input);
  return result.success ? result.data : null;
}

function normalizeWorkspaceSelectionRecord(
  input: unknown,
): Record<string, ActiveWorkspaceSelection> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const next: Record<string, ActiveWorkspaceSelection> = {};
  for (const [rawSpaceId, rawSelection] of Object.entries(input as Record<string, unknown>)) {
    const spaceId = normalizeSpaceId(rawSpaceId);
    const selection = normalizeWorkspaceSelection(rawSelection);
    if (!spaceId || !selection) {
      continue;
    }
    next[spaceId] = selection;
  }
  return next;
}

function parseStoredWorkspaceSelection(stored: string | null): LastWorkspaceSelectionSnapshot {
  if (!stored) {
    return { defaultSelection: null, selectionBySpaceId: {} };
  }
  try {
    const parsed = JSON.parse(stored);
    const legacySelection = normalizeWorkspaceSelection(parsed);
    if (legacySelection) {
      return { defaultSelection: legacySelection, selectionBySpaceId: {} };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { defaultSelection: null, selectionBySpaceId: {} };
    }
    const record = parsed as Record<string, unknown>;
    return {
      defaultSelection: normalizeWorkspaceSelection(record.defaultSelection),
      selectionBySpaceId: normalizeWorkspaceSelectionRecord(record.selectionBySpaceId),
    };
  } catch {
    return { defaultSelection: null, selectionBySpaceId: {} };
  }
}

function serializeWorkspaceSelectionSnapshot(snapshot: LastWorkspaceSelectionSnapshot): string {
  return JSON.stringify({
    ...(snapshot.defaultSelection ? { defaultSelection: snapshot.defaultSelection } : {}),
    ...(Object.keys(snapshot.selectionBySpaceId).length > 0
      ? { selectionBySpaceId: snapshot.selectionBySpaceId }
      : {}),
  });
}

export function createLastWorkspaceSelectionStore(storage: LastWorkspaceSelectionStorage) {
  let snapshot: LastWorkspaceSelectionSnapshot = {
    defaultSelection: null,
    selectionBySpaceId: {},
  };
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  function getSelection(spaceId?: string | null): ActiveWorkspaceSelection | null {
    const normalizedSpaceId = normalizeSpaceId(spaceId);
    if (normalizedSpaceId) {
      return snapshot.selectionBySpaceId[normalizedSpaceId] ?? snapshot.defaultSelection;
    }
    return snapshot.defaultSelection;
  }

  function remember(next: ActiveWorkspaceSelection, spaceId?: string | null) {
    const normalized = normalizeWorkspaceSelection(next);
    if (!normalized) {
      return;
    }
    const normalizedSpaceId = normalizeSpaceId(spaceId);
    const current = normalizedSpaceId
      ? (snapshot.selectionBySpaceId[normalizedSpaceId] ?? null)
      : snapshot.defaultSelection;
    if (
      current?.serverId === normalized.serverId &&
      current.workspaceId === normalized.workspaceId
    ) {
      return;
    }
    snapshot = normalizedSpaceId
      ? {
          ...snapshot,
          selectionBySpaceId: {
            ...snapshot.selectionBySpaceId,
            [normalizedSpaceId]: normalized,
          },
        }
      : {
          ...snapshot,
          defaultSelection: normalized,
        };
    revision += 1;
    notifyListeners();
    void storage.write(serializeWorkspaceSelectionSnapshot(snapshot)).catch(() => {});
  }

  function prune(knownSpaceIds: Iterable<string>) {
    const known = new Set<string>();
    for (const rawSpaceId of knownSpaceIds) {
      const normalizedSpaceId = normalizeSpaceId(rawSpaceId);
      if (normalizedSpaceId) {
        known.add(normalizedSpaceId);
      }
    }
    const nextSelectionBySpaceId: Record<string, ActiveWorkspaceSelection> = {};
    let removed = false;
    for (const [spaceId, selection] of Object.entries(snapshot.selectionBySpaceId)) {
      if (known.has(spaceId)) {
        nextSelectionBySpaceId[spaceId] = selection;
      } else {
        removed = true;
      }
    }
    if (!removed) {
      return;
    }
    snapshot = {
      ...snapshot,
      selectionBySpaceId: nextSelectionBySpaceId,
    };
    revision += 1;
    notifyListeners();
    void storage.write(serializeWorkspaceSelectionSnapshot(snapshot)).catch(() => {});
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision === hydrationRevision) {
          snapshot = parseStoredWorkspaceSelection(stored);
          if (
            stored !== null &&
            snapshot.defaultSelection === null &&
            Object.keys(snapshot.selectionBySpaceId).length === 0
          ) {
            void storage.clear().catch(() => {});
          }
        }
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision) {
          snapshot = { defaultSelection: null, selectionBySpaceId: {} };
        }
      })
      .finally(() => {
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  return {
    getSelection,
    hydrate,
    isHydrated: () => hydrated,
    prune,
    remember,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
