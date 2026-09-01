/** @vitest-environment jsdom */
import { act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { composerWorkspaceAttachment } from "./workspace";
import { removeSentContextAttachments } from "./workspace-cleanup";

// jsdom has no matchMedia; react-native-web's layout hooks read it at import.
vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener: () => {},
      addListener: () => {},
      dispatchEvent: () => false,
      matches: false,
      media: "",
      onchange: null,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
  });
});

// react-native-unistyles does not load under this suite's jsdom graph.
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: <T>(styles: T) => styles },
  withUnistyles: <T>(Component: T) => Component,
  useUnistyles: () => ({ theme: {}, rt: {}, breakpoint: undefined }),
}));
// Neither does lucide-react-native.
vi.mock("lucide-react-native", () => ({
  CircleDot: () => null,
  FileText: () => null,
  GitPullRequest: () => null,
  MessageSquareCode: () => null,
  MousePointer2: () => null,
  X: () => null,
}));

function chatHistoryAttachment(): WorkspaceComposerAttachment {
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
      agentId: "agent-1",
    },
  };
}

function pullRequestContextAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment",
    text: "Please check this.",
  };
}

function browserElementAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com",
      selector: "button.primary",
      tag: "button",
      text: "Click me",
      outerHTML: '<button class="primary">Click me</button>',
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      reactSource: null,
      parentChain: [],
      children: [],
      formatted: "button.primary\nClick me",
    },
  };
}

describe("workspace composer attachment cleanup", () => {
  it("clears sent scoped context attachments from their stores", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    const pullRequestContext = pullRequestContextAttachment();
    const browserElement = browserElementAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory, pullRequestContext, browserElement],
    });

    removeSentContextAttachments([chatHistory, pullRequestContext, browserElement]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });
});

describe("workspace composer attachment binding", () => {
  it("expands a tapped chat history pill into composer text and removes the pill", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory],
    });
    const onExpandChatHistoryAttachment = vi.fn();
    const onOpenWorkspaceAttachment = vi.fn();
    const { result } = renderHook(() =>
      composerWorkspaceAttachment.useBinding({
        normalAttachments: [],
        workspaceAttachments: [chatHistory],
        onOpenWorkspaceAttachment,
        onExpandChatHistoryAttachment,
      }),
    );

    let opened = false;
    act(() => {
      opened = result.current.openAttachment({ attachment: chatHistory });
    });

    expect(opened).toBe(true);
    expect(onExpandChatHistoryAttachment).toHaveBeenCalledWith("Previous chat.");
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
    expect(onOpenWorkspaceAttachment).not.toHaveBeenCalled();
  });

  it("leaves browser element pills inert on tap", () => {
    const browserElement = browserElementAttachment();
    const { result } = renderHook(() =>
      composerWorkspaceAttachment.useBinding({
        normalAttachments: [],
        workspaceAttachments: [browserElement],
      }),
    );

    let opened = true;
    act(() => {
      opened = result.current.openAttachment({ attachment: browserElement });
    });

    expect(opened).toBe(false);
  });
});
