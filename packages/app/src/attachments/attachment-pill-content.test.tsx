import { describe, expect, it, vi } from "vitest";
import React from "react";
import { i18n } from "@/i18n/i18next";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  getAgentAttachmentPillContent,
  getWorkspaceAttachmentPillContent,
} from "./attachment-pill-content";

vi.mock("lucide-react-native", () => ({
  CircleDot: () => null,
  FileText: () => null,
  GitPullRequest: () => null,
  MessageSquareCode: () => null,
  MousePointer2: () => null,
}));

type ChatHistorySource = Extract<WorkspaceComposerAttachment, { kind: "chat_history" }>["source"];

function chatHistoryAttachment(
  source: Partial<ChatHistorySource> = {},
): WorkspaceComposerAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Previous chat.",
    },
    source: {
      serverId: "local",
      agentId: "0123456789abcdef",
      ...source,
    },
  };
}

describe("agent attachment pill content", () => {
  it("presents external resources with their provider identity", () => {
    const content = getAgentAttachmentPillContent(
      {
        type: "text",
        mimeType: "text/plain",
        title: "ENG-123 Plugin attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        externalResource: {
          provider: "linear",
          providerLabel: "Linear issue",
          resourceType: "issue",
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        },
      },
      i18n.t,
    );

    expect(content.title).toBe("Plugin attachments");
    expect(content.subtitle).toBe("Linear issue ENG-123");
  });
});

describe("getWorkspaceAttachmentPillContent", () => {
  it("names the source agent and its short id for chat history", () => {
    const content = getWorkspaceAttachmentPillContent(
      chatHistoryAttachment({ agentTitle: "Fix the sidebar quota" }),
      i18n.t,
    );

    expect(content.title).toBe("Fix the sidebar quota");
    expect(content.subtitle).toBe("Chat history (0123456)");
  });

  it("falls back to the attachment title when the source agent has no title", () => {
    const content = getWorkspaceAttachmentPillContent(
      chatHistoryAttachment({ agentTitle: "   " }),
      i18n.t,
    );

    expect(content.title).toBe("Chat history");
    expect(content.subtitle).toBe("Chat history (0123456)");
  });
});
