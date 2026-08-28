/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { profileRows, applyProfile, theme } = vi.hoisted(() => {
  const rows = [
    {
      id: "claude-profile",
      provider: "claude",
      modelId: "claude-sonnet",
      icon: "",
      color: "",
      name: "Claude work",
      summary: "Claude",
      matchesDefault: false,
    },
    {
      id: "codex-default",
      provider: "codex",
      modelId: "gpt-5",
      icon: "",
      color: "",
      name: "Codex default",
      summary: "Codex",
      matchesDefault: true,
    },
    {
      id: "codex-review",
      provider: "codex",
      modelId: "gpt-5-mini",
      icon: "",
      color: "",
      name: "Codex review",
      summary: "Codex",
      matchesDefault: true,
    },
  ];
  const testTheme = {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    fontSize: { sm: 13 },
    fontWeight: { medium: "500" },
    colors: { foregroundMuted: "#muted" },
  };
  return { profileRows: rows, applyProfile: vi.fn(), theme: testTheme };
});

vi.mock("react-native", () => ({
  Platform: { select: () => "normal" },
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("div", props, children),
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("span", props, children),
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: (value: typeof theme) => unknown) => factory(theme),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onPress,
    testID,
    accessibilityLabel,
    dataSet,
    leftIcon,
  }: React.PropsWithChildren<{
    onPress?: () => void;
    testID?: string;
    accessibilityLabel?: string;
    dataSet?: Record<string, string>;
    leftIcon?: React.ReactNode;
  }>) =>
    React.createElement(
      "button",
      {
        type: "button",
        onClick: onPress,
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        ...Object.fromEntries(
          Object.entries(dataSet ?? {}).map(([key, value]) => [`data-${key}`, value]),
        ),
      },
      leftIcon,
      children,
    ),
}));

vi.mock("@/agent-profiles", () => ({
  AgentProfileGlyph: () => null,
  useAgentProfilePicker: () => ({
    rows: profileRows,
    applyProfile,
  }),
}));

vi.mock("@/hooks/use-form-preferences", () => ({
  useFormPreferences: () => ({ preferences: null, isLoading: false }),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import type { ProviderSelectorProvider } from "@/hooks/use-agent-form-state";
import { DraftAgentProfileChips } from "./agent-profile-chips";

const modelSelectorProviders: ProviderSelectorProvider[] = [
  { id: "codex", label: "Codex", modelSelection: { kind: "models", rows: [] } },
  { id: "claude", label: "Claude", modelSelection: { kind: "models", rows: [] } },
];

const props = {
  serverId: "host-1",
  provider: "codex" as const,
  effectiveModelId: "gpt-5",
  selectedMode: "auto",
  effectiveThinkingOptionId: "high",
  featureValues: {},
  providerDefinitionMap: new Map(),
  allProviderModels: new Map(),
  availableModels: [],
  modeOptions: [],
  modelSelectorProviders,
  isModelLoading: false,
  isFeaturesLoading: false,
  onApplyProfile: vi.fn(),
};

describe("DraftAgentProfileChips", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    applyProfile.mockClear();
    props.onApplyProfile.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("groups profiles alphabetically by provider label", () => {
    act(() => root.render(<DraftAgentProfileChips {...props} />));

    const labels = Array.from(container.querySelectorAll("span")).map((node) => node.textContent);
    expect(labels).toEqual(["Claude", "Codex"]);

    const chipIds = Array.from(container.querySelectorAll("button"))
      .map((node) => node.getAttribute("data-testid"))
      .filter((value): value is string => value?.startsWith("draft-agent-profile-chip-") === true);
    expect(chipIds).toEqual([
      "draft-agent-profile-chip-claude-profile",
      "draft-agent-profile-chip-codex-default",
      "draft-agent-profile-chip-codex-review",
    ]);
  });

  it("keeps all default matches highlighted until a profile is clicked", () => {
    act(() => root.render(<DraftAgentProfileChips {...props} />));

    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-default"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-review"]')
        ?.getAttribute("data-active"),
    ).toBe("true");

    const reviewChip = container.querySelector<HTMLButtonElement>(
      '[data-testid="draft-agent-profile-chip-codex-review"]',
    );
    expect(reviewChip).not.toBeNull();
    act(() => reviewChip?.click());

    expect(applyProfile).toHaveBeenCalledWith("codex-review");
    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-default"]')
        ?.getAttribute("data-active"),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-review"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("clears the click override once props reflect a change made outside a chip (e.g. the model dropdown)", () => {
    act(() => root.render(<DraftAgentProfileChips {...props} />));

    const reviewChip = container.querySelector<HTMLButtonElement>(
      '[data-testid="draft-agent-profile-chip-codex-review"]',
    );
    act(() => reviewChip?.click());
    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-default"]')
        ?.getAttribute("data-active"),
    ).toBeNull();

    act(() => root.render(<DraftAgentProfileChips {...props} effectiveModelId="gpt-5-turbo" />));

    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-default"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
    expect(
      container
        .querySelector('[data-testid="draft-agent-profile-chip-codex-review"]')
        ?.getAttribute("data-active"),
    ).toBe("true");
  });
});
