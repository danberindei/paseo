/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-clipboard", () => ({
  setStringAsync: vi.fn().mockResolvedValue(undefined),
}));

// The real module builds icon elements at module scope, which the test JSX runtime cannot evaluate.
vi.mock("@/attachments/attachment-pill-content", () => ({
  getAgentAttachmentPillContent: () => ({ icon: null, title: "", subtitle: "" }),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ show: vi.fn(), copied: vi.fn(), error: vi.fn() }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("react-native-markdown-display", () => ({
  __esModule: true,
  default: () => null,
  MarkdownIt: vi.fn(() => ({
    validateLink: () => true,
  })),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
  })),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

vi.mock("@react-native-masked-view/masked-view", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: "div",
  },
  Easing: {
    linear: vi.fn(),
  },
  Keyframe: class {
    duration() {
      return this;
    }
  },
  cancelAnimation: vi.fn(),
  useAnimatedStyle: vi.fn(() => ({})),
  useSharedValue: vi.fn((value) => ({ value })),
  withRepeat: vi.fn((value) => value),
  withTiming: vi.fn((value) => value),
}));

vi.mock("@/styles/markdown-styles", () => ({
  createMarkdownStyles: vi.fn(() => ({})),
}));

vi.mock("@/constants/theme", () => ({
  Fonts: {
    sans: "System",
  },
}));

vi.mock("@/constants/layout", () => ({
  MAX_CONTENT_WIDTH: 960,
  useIsCompactFormFactor: () => false,
}));

vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreviewUrl: vi.fn(() => null),
}));

vi.mock("@/components/highlighted-code-block", () => ({
  HighlightedCodeBlock: () => null,
}));

vi.mock("@/tool-calls/presentation", () => ({
  buildToolCallPresentation: vi.fn(() => ({
    title: "",
    subtitle: "",
    status: "success",
  })),
}));

vi.mock("@/utils/tool-call-icon", () => ({
  resolveToolCallIcon: vi.fn(() => null),
}));

vi.mock("./plan-card", () => ({
  PlanCard: () => null,
}));

vi.mock("./tool-call-details", () => ({
  ToolCallDetailsContent: () => null,
}));

vi.mock("@/assistant-file-links", () => ({
  AssistantInlineCodePathLink: () => null,
  AssistantMarkdownCodeLink: () => null,
  AssistantMarkdownLink: () => null,
  useAssistantFileLinkActions: () => ({
    open: vi.fn(),
    canResolveFile: vi.fn(() => false),
  }),
}));

vi.mock("@/components/attachment-lightbox", () => ({
  AttachmentLightbox: () => null,
}));

vi.mock("@/components/tool-call-sheet", () => ({
  useToolCallSheet: () => ({
    openToolCallSheet: vi.fn(),
  }),
}));

import { UserMessage } from "./message";

describe("UserMessage", () => {
  it("renders the trailing controls inside the same hover wrapper as the bubble", () => {
    render(
      <UserMessage message="Copy me" timestamp={new Date("2026-05-24T10:00:00.000Z").getTime()} />,
    );

    const messageText = screen.getByText("Copy me");
    const copyButton = screen.getByLabelText("Copy message");
    const trailingRow = copyButton.parentElement;
    const bubble = messageText.parentElement;

    expect(trailingRow).not.toBeNull();
    expect(bubble).not.toBeNull();
    expect(trailingRow?.parentElement).toBe(bubble?.parentElement);
  });
});
