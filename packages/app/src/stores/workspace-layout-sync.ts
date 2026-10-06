import type { WorkspaceLayoutPersistedState } from "./workspace-layout-store";

const fields = [
  "layoutByWorkspace",
  "pinnedAgentIdsByWorkspace",
  "splitSizesByWorkspace",
  "explorerSidebarWidthByWorkspace",
  "explorerPaneIdByWorkspace",
  "sidePaneIdByWorkspace",
  "pullRequestTabAutoOpenedByWorkspace",
] as const;

type Field = (typeof fields)[number];
interface Revision {
  counter: number;
  actor: string;
}
type Revisions = NonNullable<WorkspaceLayoutPersistedState["syncRevisions"]>;

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function fieldValue(state: WorkspaceLayoutPersistedState, field: Field, key: string): string {
  const map = state[field];
  return map && Object.hasOwn(map, key) ? stableStringify({ value: map[key] }) : "missing";
}

function keys(states: WorkspaceLayoutPersistedState[], field: Field): Set<string> {
  return new Set(
    states.flatMap((state) => [
      ...Object.keys(state[field] ?? {}),
      ...Object.keys(state.syncRevisions?.[field] ?? {}),
    ]),
  );
}

function compareRevision(a?: Revision, b?: Revision): number {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  return a.counter - b.counter || compareStrings(a.actor, b.actor);
}

export function mergeWorkspaceLayoutSnapshots(
  ours: WorkspaceLayoutPersistedState,
  theirs: WorkspaceLayoutPersistedState,
): WorkspaceLayoutPersistedState {
  const merged: WorkspaceLayoutPersistedState = { ...theirs, syncRevisions: {} };
  for (const field of fields) {
    const result: Record<string, unknown> = { ...theirs[field] };
    const revisions: Record<string, Revision> = {};
    for (const key of keys([ours, theirs], field)) {
      const ourRevision = ours.syncRevisions?.[field]?.[key];
      const theirRevision = theirs.syncRevisions?.[field]?.[key];
      const order = compareRevision(ourRevision, theirRevision);
      // Unversioned values can occur in saved layouts created before revision tracking.
      const takeOurs =
        order > 0 || (order === 0 && fieldValue(ours, field, key) > fieldValue(theirs, field, key));
      const source = takeOurs ? ours : theirs;
      const selected = source[field];
      if (selected && Object.hasOwn(selected, key)) result[key] = selected[key];
      else delete result[key];
      const revision = takeOurs ? ourRevision : theirRevision;
      if (revision) revisions[key] = revision;
    }
    Object.assign(merged, { [field]: result });
    if (Object.keys(revisions).length) merged.syncRevisions![field] = revisions;
  }
  return merged;
}

export function createWorkspaceLayoutSyncTracker() {
  const actor = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let counter = 0;
  let previous: WorkspaceLayoutPersistedState | undefined;
  let revisions: Revisions = {};

  const accept = (state: WorkspaceLayoutPersistedState) => {
    revisions = JSON.parse(JSON.stringify(state.syncRevisions ?? {})) as Revisions;
    for (const map of Object.values(revisions)) {
      for (const revision of Object.values(map)) counter = Math.max(counter, revision.counter);
    }
    previous = JSON.parse(JSON.stringify(state)) as WorkspaceLayoutPersistedState;
  };

  const project = (state: WorkspaceLayoutPersistedState): WorkspaceLayoutPersistedState => {
    if (previous) {
      for (const field of fields) {
        for (const key of keys([previous, state], field)) {
          if (fieldValue(previous, field, key) !== fieldValue(state, field, key)) {
            revisions[field] ??= {};
            revisions[field][key] = { counter: ++counter, actor };
          }
        }
      }
    }
    const snapshot = {
      ...state,
      syncRevisions: JSON.parse(JSON.stringify(revisions)) as Revisions,
    };
    previous = JSON.parse(JSON.stringify(snapshot)) as WorkspaceLayoutPersistedState;
    return snapshot;
  };

  return { accept, project };
}
