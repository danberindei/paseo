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
  overrides: { title?: string | null; source?: Partial<ChatHistorySource> } = {},
): WorkspaceComposerAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: overrides.title === undefined ? "Fix the sidebar quota" : overrides.title,
      text: "Previous chat.",
    },
    source: {
      serverId: "local",
      agentId: "0123456789abcdef",
      ...overrides.source,
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
  it("renders the source attachment title and shared previous-conversation subtitle", () => {
    const content = getWorkspaceAttachmentPillContent(chatHistoryAttachment(), i18n.t);

    expect(content.title).toBe("Fix the sidebar quota");
    expect(content.subtitle).toBe("From previous conversation");
  });

  it("falls back to the generic text label when the attachment has no title", () => {
    const content = getWorkspaceAttachmentPillContent(
      chatHistoryAttachment({ title: null }),
      i18n.t,
    );

    expect(content.title).toBe(i18n.t("message.attachments.textAttachment"));
    expect(content.subtitle).toBe("From previous conversation");
  });
});
