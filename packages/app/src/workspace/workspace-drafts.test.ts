import { afterEach, describe, expect, it } from "vitest";
import { useDraftStore } from "@/stores/draft-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  clearWorkspaceDraftRecords,
  collectWorkspaceDraftTabKeys,
} from "@/workspace/workspace-drafts";

const SERVER_ID = "server-1";
const WORKSPACE_KEY = "server-1:ws-main";

function openDraftTab(draftId: string): string | null {
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: WORKSPACE_KEY,
    target: { kind: "draft", draftId },
    intent: "new",
  });
}

function openAgentTab(agentId: string): string | null {
  return useWorkspaceLayoutStore.getState().openTab({
    workspaceKey: WORKSPACE_KEY,
    target: { kind: "agent", agentId },
    intent: "new",
  });
}

function saveDraft(draftKey: string, text: string): void {
  useDraftStore.getState().saveDraftInput({ draftKey, draft: { text, attachments: [] } });
}

function layoutFor(workspaceKey: string) {
  return useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
}

afterEach(() => {
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  useDraftStore.setState({ drafts: {}, createModalDraft: null });
});

describe("collectWorkspaceDraftTabKeys", () => {
  it("collects draft tabs and skips tabs that own no draft record", () => {
    openDraftTab("draft-a");
    openAgentTab("agent-a");
    openDraftTab("draft-b");

    expect(
      collectWorkspaceDraftTabKeys({ serverId: SERVER_ID, layout: layoutFor(WORKSPACE_KEY) }),
    ).toEqual([`draft:${SERVER_ID}:draft-a`, `draft:${SERVER_ID}:draft-b`]);
  });

  it("returns nothing when the workspace has no layout", () => {
    expect(
      collectWorkspaceDraftTabKeys({ serverId: SERVER_ID, layout: layoutFor("server-1:absent") }),
    ).toEqual([]);
  });
});

describe("clearWorkspaceDraftRecords", () => {
  it("clears every draft tab record and keeps agent tab records restorable", () => {
    openDraftTab("draft-a");
    openDraftTab("draft-b");
    openAgentTab("agent-a");

    saveDraft(`draft:${SERVER_ID}:draft-a`, "unsent work");
    saveDraft(`draft:${SERVER_ID}:draft-b`, "more unsent work");
    saveDraft(`agent:${SERVER_ID}:agent-a`, "unsent agent work");

    clearWorkspaceDraftRecords({ serverId: SERVER_ID, workspaceKey: WORKSPACE_KEY });

    const drafts = useDraftStore.getState().drafts;
    expect(drafts[`agent:${SERVER_ID}:agent-a`]?.lifecycle).toBe("active");
    expect(drafts[`agent:${SERVER_ID}:agent-a`]?.input.text).toBe("unsent agent work");
    expect(drafts[`draft:${SERVER_ID}:draft-a`]).toMatchObject({
      lifecycle: "removed",
      input: { text: "", attachments: [] },
    });
    expect(drafts[`draft:${SERVER_ID}:draft-b`]?.lifecycle).toBe("removed");
  });

  it("leaves records untouched when the workspace has no layout", () => {
    saveDraft(`draft:${SERVER_ID}:draft-a`, "unsent work");

    clearWorkspaceDraftRecords({ serverId: SERVER_ID, workspaceKey: "server-1:absent" });

    expect(useDraftStore.getState().drafts[`draft:${SERVER_ID}:draft-a`]?.input.text).toBe(
      "unsent work",
    );
  });
});
