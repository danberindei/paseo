import { describe, expect, test } from "vitest";
import type { AgentMode, AgentModelDefinition } from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import { matchesAgentProfileDefaultSelection } from "./default-match";

const THINKING_OPTIONS = [
  { id: "low", label: "Low", isDefault: true },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const availableModels: AgentModelDefinition[] = [
  {
    provider: "mock",
    id: "ten-second-stream",
    label: "Ten second stream",
    isDefault: false,
    thinkingOptions: THINKING_OPTIONS,
    defaultThinkingOptionId: "low",
  },
  {
    provider: "mock",
    id: "five-minute-stream",
    label: "Five minute stream",
    isDefault: true,
    thinkingOptions: THINKING_OPTIONS,
    defaultThinkingOptionId: "low",
  },
];

const modeOptions: AgentMode[] = [
  { id: "load-test", label: "Load Test" },
  { id: "approval-test", label: "Approval Test" },
];

const providerDef: AgentProviderDefinition = {
  id: "mock",
  label: "Mock",
  description: "Mock load test provider",
  defaultModeId: "load-test",
  modes: [
    { id: "load-test", label: "Load Test", description: "", icon: "Play", colorTier: "safe" },
    {
      id: "approval-test",
      label: "Approval Test",
      description: "",
      icon: "Shield",
      colorTier: "moderate",
    },
  ],
};

const baseSelection = {
  provider: "mock",
  effectiveModelId: "ten-second-stream",
  selectedModeId: "load-test",
  effectiveThinkingOptionId: "low",
  modeOptions,
  availableModels,
  featureValues: {},
  providerDef,
  providerPrefs: { model: "ten-second-stream" },
};

function materialized(input: {
  provider: string;
  modelId?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}) {
  return {
    provider: input.provider,
    modelId: input.modelId ?? "",
    modeId: input.modeId ?? "",
    thinkingOptionId: input.thinkingOptionId ?? "",
    featureValues: input.featureValues ?? {},
  };
}

describe("matchesAgentProfileDefaultSelection", () => {
  test("a profile omitting model, mode, and thinking matches the snapshot", () => {
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock" }),
        selection: baseSelection,
      }),
    ).toBe(true);
  });

  test("a profile naming a different model does not match", () => {
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", modelId: "five-minute-stream" }),
        selection: baseSelection,
      }),
    ).toBe(false);
  });

  test("a profile naming a different mode does not match", () => {
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", modeId: "approval-test" }),
        selection: baseSelection,
      }),
    ).toBe(false);
  });

  test("a profile naming a different thinking option does not match", () => {
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", thinkingOptionId: "high" }),
        selection: baseSelection,
      }),
    ).toBe(false);
  });

  test("a profile naming the snapshot's thinking option matches", () => {
    const selection = { ...baseSelection, effectiveThinkingOptionId: "high" };
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", thinkingOptionId: "high" }),
        selection,
      }),
    ).toBe(true);
  });

  test("a profile for a different provider does not match", () => {
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "claude" }),
        selection: baseSelection,
      }),
    ).toBe(false);
  });

  test("profile feature values are matched as a subset of the selection", () => {
    const selection = { ...baseSelection, featureValues: { fast: true } };
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", featureValues: { fast: true } }),
        selection,
      }),
    ).toBe(true);
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", featureValues: { fast: false } }),
        selection,
      }),
    ).toBe(false);
    expect(
      matchesAgentProfileDefaultSelection({
        profile: materialized({ provider: "mock", featureValues: {} }),
        selection,
      }),
    ).toBe(true);
  });
});
