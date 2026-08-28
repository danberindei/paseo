import equal from "fast-deep-equal";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@getpaseo/protocol/agent-types";
import type { ProviderPreferences } from "@/hooks/use-form-preferences";
import {
  resolveEffectiveComposerModelId,
  resolveEffectiveComposerThinkingOptionId,
} from "@/provider-selection/provider-selection";
import {
  INITIAL_AGENT_FORM_RESOLUTION,
  INITIAL_USER_MODIFIED,
  resolveAgentForm,
} from "@/provider-selection/resolve-agent-form";
import type { MaterializedAgentProfile } from "./materialize-profile";

export interface AgentProfileDefaultSelection {
  provider: AgentProvider;
  effectiveModelId: string;
  selectedModeId: string;
  effectiveThinkingOptionId: string;
  modeOptions: AgentMode[];
  availableModels: AgentModelDefinition[];
  featureValues: Record<string, unknown>;
  providerDef: AgentProviderDefinition | undefined;
  providerPrefs: ProviderPreferences | undefined;
}

function reconcileMode(modeOptionIds: readonly string[], modeId: string): string {
  if (modeOptionIds.length === 0) return "";
  return modeOptionIds.includes(modeId) ? modeId : (modeOptionIds[0] ?? "");
}

function featureValuesMatch(
  profileValues: Record<string, unknown>,
  selectionValues: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(profileValues)) {
    if (!Object.hasOwn(selectionValues, key)) return false;
    if (!equal(selectionValues[key], value)) return false;
  }
  return true;
}

// Independent per profile: several profiles that each resolve to the same
// default can all match, so more than one chip may be highlighted at once.
export function matchesAgentProfileDefaultSelection(input: {
  profile: MaterializedAgentProfile;
  selection: AgentProfileDefaultSelection;
}): boolean {
  const { profile, selection } = input;
  if (profile.provider !== selection.provider) return false;

  const resolved = resolveAgentForm(
    {
      form: {
        serverId: null,
        provider: selection.provider,
        modeId: "",
        model: "",
        thinkingOptionId: "",
        workingDir: "",
      },
      userModified: INITIAL_USER_MODIFIED,
      resolution: INITIAL_AGENT_FORM_RESOLUTION,
    },
    {
      type: "APPLY_PROFILE_FROM_USER",
      provider: profile.provider as AgentProvider,
      modelId: profile.modelId,
      modeId: profile.modeId,
      thinkingOptionId: profile.thinkingOptionId,
      providerDef: selection.providerDef,
      providerModels: selection.availableModels,
      providerPrefs: selection.providerPrefs,
    },
  ).form;

  const providerSelection = {
    provider: selection.provider,
    modelId: resolved.model,
    modeId: resolved.modeId,
    thinkingOptionId: resolved.thinkingOptionId,
    availableModels: selection.availableModels,
    modeOptions: selection.modeOptions,
  };

  const appliedModelId = resolveEffectiveComposerModelId(providerSelection);
  if (appliedModelId !== selection.effectiveModelId) return false;

  const appliedThinkingOptionId = resolveEffectiveComposerThinkingOptionId(
    providerSelection,
    appliedModelId,
  );
  if (appliedThinkingOptionId !== selection.effectiveThinkingOptionId) return false;

  const modeOptionIds = selection.modeOptions.map((mode) => mode.id);
  if (
    reconcileMode(modeOptionIds, resolved.modeId) !==
    reconcileMode(modeOptionIds, selection.selectedModeId)
  ) {
    return false;
  }

  return featureValuesMatch(profile.featureValues, selection.featureValues);
}
