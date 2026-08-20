import { useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useDraftStore } from "@/stores/draft-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { areStringSetsEqual, buildUnsentComposerWorkspaceKeys } from "./sidebar-unsent-composer";
import {
  areSidebarWorkspaceSessionsEqual,
  buildSidebarWorkspaceEntries,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

const EMPTY_ENTRIES = new Map<string, SidebarWorkspaceEntry>();
const EMPTY_SESSIONS: SidebarWorkspaceSession[] = [];
const EMPTY_PENDING_CREATE_ATTEMPTS: Record<string, never> = {};
const EMPTY_UNSENT_KEYS: ReadonlySet<string> = new Set<string>();

export function useSidebarWorkspaceEntries(
  placements: readonly SidebarWorkspacePlacement[],
  enabled = true,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  const serverIds = useMemo(
    () => Array.from(new Set(placements.map((placement) => placement.serverId))),
    [placements],
  );
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      enabled ? selectSidebarWorkspaceSessions(state.sessions, serverIds) : EMPTY_SESSIONS,
    areSidebarWorkspaceSessionsEqual,
  );
  const pendingCreateAttempts = useCreateFlowStore((state) =>
    enabled ? state.pendingByDraftId : EMPTY_PENDING_CREATE_ATTEMPTS,
  );
  const drafts = useDraftStore((state) => state.drafts);
  const layoutByWorkspace = useWorkspaceLayoutStore((state) => state.layoutByWorkspace);
  const previousEntriesRef = useRef<ReadonlyMap<string, SidebarWorkspaceEntry>>(EMPTY_ENTRIES);
  const previousUnsentKeysRef = useRef<ReadonlySet<string>>(EMPTY_UNSENT_KEYS);

  const agentWorkspaceIndex = useMemo(() => {
    const index = new Map<string, Map<string, string>>();
    for (const session of sessions) {
      const workspaceIdByAgentId = new Map<string, string>();
      for (const agent of session.agents.values()) {
        if (agent.archivedAt || !agent.workspaceId) continue;
        workspaceIdByAgentId.set(agent.id, agent.workspaceId);
      }
      index.set(session.serverId, workspaceIdByAgentId);
    }
    return index;
  }, [sessions]);

  const draftTabWorkspaceIndex = useMemo(() => {
    const index = new Map<string, string>();
    for (const [workspaceKey, layout] of Object.entries(layoutByWorkspace)) {
      for (const tab of collectAllTabs(layout.root)) {
        if (tab.target.kind === "draft") {
          index.set(tab.target.draftId, workspaceKey);
        }
      }
    }
    return index;
  }, [layoutByWorkspace]);

  const unsentComposerWorkspaceKeys = useMemo(() => {
    if (!enabled) {
      return previousUnsentKeysRef.current;
    }
    const next = buildUnsentComposerWorkspaceKeys({
      drafts,
      resolvers: {
        serverIds,
        resolveAgentWorkspaceKey: ({ serverId, agentId }) => {
          const workspaceId = agentWorkspaceIndex.get(serverId)?.get(agentId);
          return workspaceId ? `${serverId}:${workspaceId}` : null;
        },
        resolveDraftTabWorkspaceKey: ({ draftId }) => draftTabWorkspaceIndex.get(draftId) ?? null,
      },
    });
    // Keystrokes churn the draft store without changing membership; hold the previous set so the
    // entries map below isn't rebuilt until a workspace actually enters or leaves the Unsent bucket.
    const stable = areStringSetsEqual(previousUnsentKeysRef.current, next)
      ? previousUnsentKeysRef.current
      : next;
    previousUnsentKeysRef.current = stable;
    return stable;
  }, [agentWorkspaceIndex, draftTabWorkspaceIndex, drafts, enabled, serverIds]);

  // Collection ownership is intentional: retained sidebars have one cheap
  // subscription to structurally shared indexes, never one session-store
  // subscription per mounted row.
  return useMemo(() => {
    if (!enabled) {
      return previousEntriesRef.current;
    }
    if (placements.length === 0 || sessions.length === 0) {
      previousEntriesRef.current = EMPTY_ENTRIES;
      return EMPTY_ENTRIES;
    }
    const entries = buildSidebarWorkspaceEntries({
      placements,
      sessions,
      pendingCreateAttempts,
      unsentComposerWorkspaceKeys,
      previousEntries: previousEntriesRef.current,
    });
    previousEntriesRef.current = entries;
    return entries;
  }, [enabled, pendingCreateAttempts, placements, sessions, unsentComposerWorkspaceKeys]);
}
