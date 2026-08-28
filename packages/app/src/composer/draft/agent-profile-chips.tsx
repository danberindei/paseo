import equal from "fast-deep-equal";
import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@getpaseo/protocol/agent-types";
import type { AgentProviderDefinition } from "@getpaseo/protocol/provider-manifest";
import {
  AgentProfileGlyph,
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type AgentProfileDefaultSelection,
  type AgentProfilePickerRow,
  type MaterializedAgentProfile,
} from "@/agent-profiles";
import { Button } from "@/components/ui/button";
import { useFormPreferences, type ProviderPreferences } from "@/hooks/use-form-preferences";
import type { ProviderSelectorProvider } from "@/hooks/use-agent-form-state";
import { ICON_SIZE } from "@/styles/theme";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";

const ACTIVE_DATASET = { active: "true" } as const;

interface DraftAgentProfileChipsProps {
  serverId: string | null;
  provider: AgentProvider | null;
  effectiveModelId: string;
  selectedMode: string;
  effectiveThinkingOptionId: string;
  featureValues: Record<string, unknown> | undefined;
  providerDefinitionMap: Map<AgentProvider, AgentProviderDefinition>;
  allProviderModels: Map<string, AgentModelDefinition[]>;
  availableModels: AgentModelDefinition[];
  modeOptions: AgentMode[];
  modelSelectorProviders: ProviderSelectorProvider[];
  isModelLoading: boolean;
  isFeaturesLoading: boolean;
  onApplyProfile: (profile: MaterializedAgentProfile) => void;
}

interface AgentProfileProviderGroup {
  provider: string;
  label: string;
  rows: AgentProfilePickerRow[];
}

function isDraftSelectionSettled(
  props: DraftAgentProfileChipsProps,
  isPreferencesLoading: boolean,
): boolean {
  return (
    !props.isModelLoading && !props.isFeaturesLoading && !isPreferencesLoading && !!props.provider
  );
}

function buildAgentProfileDefaultSelection(
  props: DraftAgentProfileChipsProps,
  providerPreferences: Record<string, ProviderPreferences> | undefined,
): AgentProfileDefaultSelection {
  const provider = props.provider as AgentProvider;
  return {
    provider,
    effectiveModelId: props.effectiveModelId,
    selectedModeId: props.selectedMode,
    effectiveThinkingOptionId: props.effectiveThinkingOptionId,
    modeOptions: props.modeOptions,
    availableModels: props.allProviderModels.get(provider) ?? props.availableModels,
    featureValues: props.featureValues ?? {},
    providerDef: props.providerDefinitionMap.get(provider),
    providerPrefs: providerPreferences?.[provider],
  };
}

function agentProfileSelectionChanged(
  prev: AgentProfileDefaultSelection | null,
  next: AgentProfileDefaultSelection,
): boolean {
  if (prev === null) return true;
  return (
    prev.provider !== next.provider ||
    prev.effectiveModelId !== next.effectiveModelId ||
    prev.selectedModeId !== next.selectedModeId ||
    prev.effectiveThinkingOptionId !== next.effectiveThinkingOptionId ||
    prev.modeOptions !== next.modeOptions ||
    prev.availableModels !== next.availableModels ||
    prev.providerDef !== next.providerDef ||
    prev.providerPrefs !== next.providerPrefs ||
    !equal(prev.featureValues, next.featureValues)
  );
}

export function DraftAgentProfileChips(props: DraftAgentProfileChipsProps) {
  const { preferences, isLoading: isPreferencesLoading } = useFormPreferences();
  const snapshotRef = useRef<AgentProfileDefaultSelection | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // Re-capture whenever the live selection changes after the initial load-settle, so the
  // default highlight tracks provider/model/mode/thinking/feature changes made outside a
  // chip click (e.g. the "Select model" dropdown). A click still wins instantly via
  // `selectedProfileId`, cleared here once the re-capture reflects the applied profile.
  if (isDraftSelectionSettled(props, isPreferencesLoading)) {
    const nextSnapshot = buildAgentProfileDefaultSelection(props, preferences?.providerPreferences);
    const prev = snapshotRef.current;
    if (agentProfileSelectionChanged(prev, nextSnapshot)) {
      const isFirstCapture = prev === null;
      snapshotRef.current = nextSnapshot;
      if (!isFirstCapture && selectedProfileId !== null) {
        setSelectedProfileId(null);
      }
    }
  }

  const availableProviders = useMemo(
    () => props.modelSelectorProviders.map((entry) => entry.id),
    [props.modelSelectorProviders],
  );
  const onApplyProfile = props.onApplyProfile;
  const target = useMemo<AgentProfileApplyTarget>(
    () => ({ kind: "draft", controls: { applyProfile: onApplyProfile } }),
    [onApplyProfile],
  );
  const picker = useAgentProfilePicker({
    serverId: props.serverId,
    availableProviders,
    target,
    defaultSelection: snapshotRef.current,
  });

  const groups = useMemo<AgentProfileProviderGroup[]>(() => {
    const rows = picker?.rows ?? [];
    const rowsByProvider = new Map<string, AgentProfilePickerRow[]>();
    for (const row of rows) {
      const providerRows = rowsByProvider.get(row.provider);
      if (providerRows) {
        providerRows.push(row);
      } else {
        rowsByProvider.set(row.provider, [row]);
      }
    }
    return props.modelSelectorProviders
      .flatMap((provider) => {
        const providerRows = rowsByProvider.get(provider.id);
        return providerRows
          ? [{ provider: provider.id, label: provider.label, rows: providerRows }]
          : [];
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [picker, props.modelSelectorProviders]);

  const applyProfile = useCallback(
    (profileId: string) => {
      setSelectedProfileId(profileId);
      picker?.applyProfile(profileId);
    },
    [picker],
  );

  if (groups.length === 0) return null;

  return (
    <View style={styles.row}>
      <View style={styles.content}>
        {groups.map((group) => (
          <View key={group.provider} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.groupChips}>
              {group.rows.map((row) => {
                const isActive =
                  selectedProfileId === null ? row.matchesDefault : row.id === selectedProfileId;
                return (
                  <DraftAgentProfileChip
                    key={row.id}
                    row={row}
                    onApply={applyProfile}
                    isActive={isActive}
                  />
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function DraftAgentProfileChip(input: {
  row: AgentProfilePickerRow;
  onApply: (profileId: string) => void;
  isActive: boolean;
}) {
  const { row, onApply, isActive } = input;
  const handlePress = useCallback(() => onApply(row.id), [onApply, row.id]);
  const glyph = useMemo(
    () => <AgentProfileGlyph icon={row.icon} color={row.color} size={ICON_SIZE.sm} />,
    [row.icon, row.color],
  );
  return (
    <Button
      size="xs"
      variant={isActive ? "secondary" : "ghost"}
      leftIcon={glyph}
      onPress={handlePress}
      testID={`draft-agent-profile-chip-${row.id}`}
      accessibilityLabel={row.name}
      dataSet={isActive ? ACTIVE_DATASET : undefined}
    >
      {row.name}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[2],
    alignItems: "center",
  },
  content: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    flexDirection: "column",
    gap: theme.spacing[3],
  },
  group: {
    flexDirection: "column",
    gap: theme.spacing[1],
  },
  groupLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  groupChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
