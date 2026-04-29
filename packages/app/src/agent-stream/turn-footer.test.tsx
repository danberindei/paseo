/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { TurnFooter } from "./turn-footer";

const strategy = resolveStreamRenderStrategy({ platform: "web", isMobileBreakpoint: false });
const timestamp = new Date("2026-01-01T00:00:00.000Z");

describe("TurnFooter", () => {
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
