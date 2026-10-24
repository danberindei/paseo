/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamItem } from "@/types/stream";

// Mirrors AssistantTurnFooter's copy gating: the control renders only when getContent is supplied.
vi.mock("@/components/message", () => ({
  AssistantTurnFooter: ({ getContent }: { getContent?: () => string }) =>
    React.createElement(
      "span",
      { "data-testid": "assistant-turn-footer" },
      getContent ? getContent() : "copy-hidden",
    ),
  LiveElapsed: () => null,
  STREAM_METADATA_FONT_SIZE: 12,
}));

vi.mock("@/components/assistant-fork-menu", () => ({ AssistantForkMenu: () => null }));
vi.mock("@/components/synced-loader", () => ({ SyncedLoader: () => null }));
vi.mock("@/components/retained-panel", () => ({ useRetainedPanelActive: () => true }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { resolveStreamRenderStrategy } from "./strategy-resolver";
import { formatMessageTimestamp } from "@/utils/time";
import { CompletedTurnFooterRow, TurnFooter } from "./turn-footer";

const strategy = resolveStreamRenderStrategy({ platform: "web", isMobileBreakpoint: false });
const timestamp = new Date("2026-01-01T00:00:00.000Z");

function assistantItem(text: string): Extract<StreamItem, { kind: "assistant_message" }> {
  return {
    kind: "assistant_message",
    id: "assistant-1",
    messageId: "message-1",
    text,
    timestamp,
  };
}

function pluginReplacement(
  assistant: Extract<StreamItem, { kind: "assistant_message" }>,
): Extract<StreamItem, { kind: "plugin" }> {
  return {
    kind: "plugin",
    id: "probe-plugin/assistant-1/1",
    sourceId: assistant.id,
    sourceAssistantMessage: assistant,
    timestamp: assistant.timestamp,
    pluginId: "probe-plugin",
    pluginItemId: "assistant-1",
    itemKind: "assistant_message",
    version: 1,
    data: { text: assistant.text },
  };
}

function toolOnlyItem(): Extract<StreamItem, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    id: "tool-1",
    timestamp,
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: "call-1",
        name: "bash",
        status: "completed",
        error: null,
        detail: { type: "unknown", input: {}, output: {} },
      },
    },
  };
}

describe("CompletedTurnFooterRow", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  function renderFooter(items: StreamItem[], startIndex: number): string | null | undefined {
    act(() => {
      root?.render(
        <CompletedTurnFooterRow
          strategy={strategy}
          items={items}
          startIndex={startIndex}
          supportsTimelineCursor={false}
        />,
      );
    });
    return container?.querySelector('[data-testid="assistant-turn-footer"]')?.textContent;
  }

  it("renders copy for an assistant message footer", () => {
    const assistant = assistantItem("Assistant answer");
    expect(renderFooter([assistant], 0)).toBe("Assistant answer");
  });

  it("renders copy when the footer source is a plugin replacement with an assistant source", () => {
    const assistant = assistantItem("Replaced answer");
    expect(renderFooter([pluginReplacement(assistant)], 0)).toBe("Replaced answer");
  });

  it("hides copy for a tool-only footer without an assistant source", () => {
    expect(renderFooter([toolOnlyItem()], 0)).toBe("copy-hidden");
  });

  it("updates the displayed last activity time while a turn is running", () => {
    const updated = new Date("2026-01-01T12:34:00.000Z");
    function renderRunning(lastUpdateAt: Date) {
      act(() => {
        root?.render(
          <TurnFooter
            isRunning
            inFlightTurnStartedAt={null}
            lastUpdateAt={lastUpdateAt}
            host={null}
            strategy={strategy}
            supportsTimelineCursor={false}
          />,
        );
      });
    }
    renderRunning(timestamp);
    expect(container?.textContent).toContain(formatMessageTimestamp(timestamp));
    renderRunning(updated);
    expect(container?.textContent).toContain(formatMessageTimestamp(updated));
  });
});
