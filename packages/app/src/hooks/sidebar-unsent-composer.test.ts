import { describe, expect, it } from "vitest";
import type { DraftRecord } from "@/stores/draft-store/state";
import {
  areStringSetsEqual,
  buildUnsentComposerWorkspaceKeys,
  type UnsentComposerResolvers,
} from "./sidebar-unsent-composer";

function draft(text: string): DraftRecord {
  return {
    input: { text, attachments: [] },
    lifecycle: "active",
    updatedAt: 0,
    version: 1,
  };
}

function draftWithAttachmentOnly(): DraftRecord {
  return {
    input: {
      text: "",
      attachments: [{ kind: "workspace_file", path: "a.ts", selection: { kind: "whole_file" } }],
    },
    lifecycle: "active",
    updatedAt: 0,
    version: 1,
  };
}

function resolvers(overrides: Partial<UnsentComposerResolvers> = {}): UnsentComposerResolvers {
  return {
    serverIds: ["srv"],
    resolveAgentWorkspaceKey: () => null,
    resolveDraftTabWorkspaceKey: () => null,
    ...overrides,
  };
}

describe("buildUnsentComposerWorkspaceKeys", () => {
  it("resolves an agent draft key to its workspace through the agent resolver", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:srv:agent-1": draft("hello") },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: ({ serverId, agentId }) =>
          serverId === "srv" && agentId === "agent-1" ? "srv:ws-1" : null,
      }),
    });

    expect(keys).toEqual(new Set(["srv:ws-1"]));
  });

  it("resolves a draft-tab key to its workspace through the draft-tab resolver", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "draft:srv:draft-1": draft("hello") },
      resolvers: resolvers({
        resolveDraftTabWorkspaceKey: ({ draftId }) => (draftId === "draft-1" ? "srv:ws-2" : null),
      }),
    });

    expect(keys).toEqual(new Set(["srv:ws-2"]));
  });

  it("skips new-workspace draft keys, which have no workspace row", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "new-workspace:srv:pending-1": draft("hello") },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:should-not-resolve",
        resolveDraftTabWorkspaceKey: () => "srv:should-not-resolve",
      }),
    });

    expect(keys.size).toBe(0);
  });

  it("keeps a draft with only whitespace text, matching the composer", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:srv:agent-1": draft("   ") },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:ws-1",
      }),
    });

    expect(keys).toEqual(new Set(["srv:ws-1"]));
  });

  it("skips an empty draft", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:srv:agent-1": draft("") },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:ws-1",
      }),
    });

    expect(keys.size).toBe(0);
  });

  it("counts an attachment-only draft as unsent content", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:srv:agent-1": draftWithAttachmentOnly() },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:ws-1",
      }),
    });

    expect(keys).toEqual(new Set(["srv:ws-1"]));
  });

  it("skips a draft that is not active (sent or abandoned)", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:srv:agent-1": { ...draft("hello"), lifecycle: "sent" } },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:ws-1",
      }),
    });

    expect(keys.size).toBe(0);
  });

  it("skips an agent key whose server id the resolver does not know", () => {
    const keys = buildUnsentComposerWorkspaceKeys({
      drafts: { "agent:other-srv:agent-1": draft("hello") },
      resolvers: resolvers({
        resolveAgentWorkspaceKey: () => "srv:should-not-resolve",
      }),
    });

    expect(keys.size).toBe(0);
  });
});

describe("areStringSetsEqual", () => {
  it("is true for the same reference", () => {
    const set = new Set(["a"]);
    expect(areStringSetsEqual(set, set)).toBe(true);
  });

  it("is true for equal contents in different sets", () => {
    expect(areStringSetsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
  });

  it("is false when sizes differ", () => {
    expect(areStringSetsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });

  it("is false when contents differ", () => {
    expect(areStringSetsEqual(new Set(["a"]), new Set(["b"]))).toBe(false);
  });
});
