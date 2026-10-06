import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { buildSelectableProviderSelectorProviders } from "@/provider-selection/provider-selection";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { SettingsSwitch } from "@/components/settings";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { useHostFeatureAvailability } from "@/runtime/host-features";

const METADATA_GENERATION_DOCS_URL = "https://paseo.sh/docs/metadata-generation";
type SelectionMode = "automatic" | "preferred";

export function MetadataGenerationPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, isLoading: isConfigLoading, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const configuredProviders = config?.metadataGeneration.providers;
  const configuredProvider = configuredProviders?.[0] ?? null;
  const providers = useMemo(
    () =>
      buildSelectableProviderSelectorProviders(snapshot.entries, {
        selectedProvider: configuredProvider?.provider ?? null,
      }),
    [configuredProvider?.provider, snapshot.entries],
  );
  const savedMode: SelectionMode = configuredProvider ? "preferred" : "automatic";
  const [draftMode, setDraftMode] = useState<SelectionMode | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const mode = draftMode ?? savedMode;

  useEffect(() => {
    setDraftMode(null);
  }, [configuredProvider?.model, configuredProvider?.provider]);

  const modeOptions = useMemo(
    () => [
      { value: "automatic" as const, label: t("settings.metadataGeneration.automatic") },
      { value: "preferred" as const, label: t("settings.metadataGeneration.preferred") },
    ],
    [t],
  );

  const saveProviders = useCallback(
    async (providersPatch: { provider: string; model?: string }[]) => {
      setIsSaving(true);
      try {
        await patchConfig({ metadataGeneration: { providers: providersPatch } });
      } catch (error) {
        setDraftMode(null);
        Alert.alert(
          t("settings.metadataGeneration.saveError"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t],
  );

  const handleModeChange = useCallback(
    (next: SelectionMode) => {
      setDraftMode(next);
      if (next === "automatic") {
        void saveProviders([]);
      }
    },
    [saveProviders],
  );

  const handleModelSelect = useCallback(
    (provider: AgentProvider, model: string) => {
      setDraftMode("preferred");
      void saveProviders([
        { provider, ...(model ? { model } : {}) },
        ...(configuredProviders?.slice(1) ?? []),
      ]);
    },
    [configuredProviders, saveProviders],
  );

  const handleSelectorOpen = useCallback(() => {
    snapshot.refetchIfStale(configuredProvider?.provider);
  }, [configuredProvider?.provider, snapshot]);
  const handleRetryProvider = useCallback(
    (provider: AgentProvider) => snapshot.refresh([provider]),
    [snapshot],
  );
  const docsLink = useMemo(
    () => ({ href: METADATA_GENERATION_DOCS_URL, label: t("settings.metadataGeneration.docs") }),
    [t],
  );

  if (isConfigLoading || !config) {
    return (
      <View style={styles.loading}>
        <LoadingSpinner size="large" color={styles.spinnerColor.color} />
      </View>
    );
  }

  return (
    <SettingsSection
      title={t("settings.metadataGeneration.title")}
      info={t("settings.metadataGeneration.description")}
      link={docsLink}
      testID="metadata-generation-settings"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.metadataGeneration.selection")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {mode === "automatic"
                ? t("settings.metadataGeneration.automaticHint")
                : t("settings.metadataGeneration.preferredHint")}
            </Text>
          </View>
          <SegmentedControl
            options={modeOptions}
            value={mode}
            onValueChange={handleModeChange}
            testID="metadata-generation-mode"
          />
        </View>
        {mode === "preferred" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.metadataGeneration.model")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.metadataGeneration.modelHint")}
              </Text>
            </View>
            <CombinedModelSelector
              providers={providers}
              selectedProvider={configuredProvider?.provider ?? ""}
              selectedModel={configuredProvider?.model ?? ""}
              onSelect={handleModelSelect}
              isLoading={snapshot.isLoading || snapshot.isFetching}
              onOpen={handleSelectorOpen}
              onRetryProvider={handleRetryProvider}
              isRetryingProvider={snapshot.isRefreshing}
              disabled={isSaving}
              serverId={serverId}
              desktopPlacement="bottom-start"
              desktopMinWidth={360}
            />
          </View>
        ) : null}
        <View style={settingsStyles.rowBorder}>
          <AgentTitleGenerationSetting
            serverId={serverId}
            enabled={config.metadataGeneration.generateAgentTitles === true}
            patchConfig={patchConfig}
          />
        </View>
      </View>
    </SettingsSection>
  );
}

function AgentTitleGenerationSetting({
  serverId,
  enabled,
  patchConfig,
}: {
  serverId: string;
  enabled: boolean;
  patchConfig: ReturnType<typeof useDaemonConfig>["patchConfig"];
}) {
  const { t } = useTranslation();
  // COMPAT(agentTitleGeneration): added after v0.16.0-beta.2, remove gate after 2027-05-15.
  const supported = useHostFeatureAvailability(serverId, "agentTitleGeneration");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(
    async (generateAgentTitles: boolean) => {
      setIsSaving(true);
      setError(null);
      try {
        const saved = await patchConfig({ metadataGeneration: { generateAgentTitles } });
        if (!saved) throw new Error(t("workspace.terminal.hostDisconnected"));
      } catch (failure) {
        setError(agentTitleSettingError(failure));
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t],
  );
  const change = useCallback((value: boolean) => void save(value), [save]);
  // The host has not reported its features yet: show nothing rather than claim
  // it is outdated.
  if (supported === null) {
    return null;
  }
  if (!supported) {
    return (
      <InlineAlert
        size="sm"
        variant="warning"
        title={t("settings.metadataGeneration.agentTitlesUpdateHost")}
      />
    );
  }
  return (
    <>
      <SettingsSwitch
        label={t("settings.metadataGeneration.agentTitles")}
        value={enabled}
        onValueChange={change}
        disabled={isSaving}
        error={error ?? undefined}
        testID="metadata-generation-agent-titles"
      />
      {isSaving ? <LoadingSpinner size="small" color={styles.spinnerColor.color} /> : null}
    </>
  );
}

function agentTitleSettingError(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure);
  if (failure.name !== "DaemonRpcError") return failure.message;
  return failure.message.replace(/ requestType=\S+(?: code=\S+)?$/, "");
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
