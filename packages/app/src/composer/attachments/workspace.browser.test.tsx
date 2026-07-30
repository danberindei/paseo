import React, { act, useCallback, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { composerWorkspaceAttachment } from "./workspace";
import { getAttachmentKey } from "./workspace-cleanup";

/**
 * The binding runs react-native-web layout hooks, which need the browser's own matchMedia.
 * This suite runs in Chromium, so no media-query stub is involved.
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  mounted.push({ root, container });
  return container;
}

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  resetWorkspaceAttachmentsStore();
});

interface PillButtonProps {
  attachment: WorkspaceComposerAttachment;
  onOpen: (attachment: WorkspaceComposerAttachment) => void;
}

function PillButton({ attachment, onOpen }: PillButtonProps) {
  const handleClick = useCallback(() => onOpen(attachment), [onOpen, attachment]);
  return (
    <button type="button" data-attachment={attachment.kind} onClick={handleClick}>
      {attachment.kind}
    </button>
  );
}

interface BindingSurfaceProps {
  workspaceAttachments: readonly WorkspaceComposerAttachment[];
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
  onExpandChatHistoryAttachment?: (text: string) => void;
  onOpened: (opened: boolean) => void;
}

function BindingSurface({
  workspaceAttachments,
  onOpenWorkspaceAttachment,
  onExpandChatHistoryAttachment,
  onOpened,
}: BindingSurfaceProps) {
  const binding = composerWorkspaceAttachment.useBinding({
    normalAttachments: [],
    workspaceAttachments,
    onOpenWorkspaceAttachment,
    onExpandChatHistoryAttachment,
  });
  const open = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      onOpened(binding.openAttachment({ attachment }));
    },
    [binding, onOpened],
  );

  return (
    <div>
      {workspaceAttachments.map((attachment) => (
        <PillButton key={getAttachmentKey(attachment)} attachment={attachment} onOpen={open} />
      ))}
    </div>
  );
}

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

function pillFor(container: HTMLElement, kind: WorkspaceComposerAttachment["kind"]): HTMLElement {
  const pill = container.querySelector(`[data-attachment="${kind}"]`);
  if (!(pill instanceof HTMLElement)) {
    throw new Error(`${kind} pill did not render`);
  }
  return pill;
}

describe("workspace composer attachment binding", () => {
  it("expands a tapped chat history pill into composer text and removes the pill", () => {
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory],
    });
    const onExpandChatHistoryAttachment = vi.fn();
    const onOpenWorkspaceAttachment = vi.fn();
    const onOpened = vi.fn();
    const container = mount(
      <BindingSurface
        workspaceAttachments={[chatHistory]}
        onOpenWorkspaceAttachment={onOpenWorkspaceAttachment}
        onExpandChatHistoryAttachment={onExpandChatHistoryAttachment}
        onOpened={onOpened}
      />,
    );

    act(() => {
      pillFor(container, "chat_history").click();
    });

    expect(onOpened.mock.calls).toEqual([[true]]);
    expect(onExpandChatHistoryAttachment).toHaveBeenCalledWith("Previous chat.");
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
    expect(onOpenWorkspaceAttachment).not.toHaveBeenCalled();
  });

  it("leaves browser element pills inert on tap", () => {
    const browserElement = browserElementAttachment();
    const onOpened = vi.fn();
    const container = mount(
      <BindingSurface workspaceAttachments={[browserElement]} onOpened={onOpened} />,
    );

    act(() => {
      pillFor(container, "browser_element").click();
    });

    expect(onOpened.mock.calls).toEqual([[false]]);
  });
});
