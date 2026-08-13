import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { type ReactElement, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditorTargetIcon } from "@/components/icons/editor-target-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";
import { ForgeBrandIcon } from "@/git/forge-icon";
import { getForgePresentation } from "@/git/forge";
import { HEADER_CONTROL_HEIGHT } from "@/components/ui/control-geometry";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import type { WorkspaceOpenInEditorTargets } from "@/workspace/open-in-editor/targets";
import type { PlannedWorkspaceOpenTarget } from "@/workspace/open-in-editor/planner";

interface WorkspaceOpenInEditorButtonProps {
  targets: WorkspaceOpenInEditorTargets;
  hideLabels?: boolean;
}

interface OpenTarget {
  id: string;
  label: string;
  icon: ReactElement;
}

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedEditorTargetIcon = withUnistyles(EditorTargetIcon);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedCheckIcon = withUnistyles(Check);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function renderOpenTargetIcon(target: PlannedWorkspaceOpenTarget): ReactElement {
  if (target.source === "forge") {
    return (
      <ForgeBrandIcon
        iconKind={getForgePresentation(target.forge).icon}
        size={16}
        uniProps={mutedColorMapping}
      />
    );
  }
  return <ThemedEditorTargetIcon icon={target.icon} size={16} uniProps={mutedColorMapping} />;
}

interface OpenTargetMenuItemProps {
  target: OpenTarget;
  isPreferred: boolean;
  onSelect: (target: OpenTarget) => void;
}

function OpenTargetMenuItem({ target, isPreferred, onSelect }: OpenTargetMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(target), [onSelect, target]);
  const trailing = useMemo(
    () => (isPreferred ? <ThemedCheckIcon size={16} uniProps={mutedColorMapping} /> : undefined),
    [isPreferred],
  );
  return (
    <DropdownMenuItem
      testID={`workspace-open-in-editor-item-${target.id}`}
      leading={target.icon}
      trailing={trailing}
      onSelect={handleSelect}
    >
      {target.label}
    </DropdownMenuItem>
  );
}

export function WorkspaceOpenInEditorButton({
  targets: controller,
  hideLabels,
}: WorkspaceOpenInEditorButtonProps) {
  const { t } = useTranslation();

  const targets = useMemo<OpenTarget[]>(
    () =>
      controller.targets.map((plan) => ({
        id: plan.id,
        label: plan.label,
        icon: renderOpenTargetIcon(plan),
      })),
    [controller.targets],
  );
  const primaryOption = useMemo(
    () => targets.find((target) => target.id === controller.preferredTargetId) ?? null,
    [controller.preferredTargetId, targets],
  );

  const handleSelectTarget = useCallback(
    (target: OpenTarget) => {
      controller.selectPreferredTarget(target.id);
    },
    [controller],
  );

  const primaryPressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      hideLabels ? styles.splitButtonPrimaryIconOnly : styles.splitButtonPrimary,
      (Boolean(hovered) || pressed) && styles.splitButtonPrimaryHovered,
      controller.isOpening && styles.splitButtonPrimaryDisabled,
    ],
    [controller.isOpening, hideLabels],
  );

  const caretTriggerStyle = useCallback(
    ({ hovered, pressed, open }: { hovered: boolean; pressed: boolean; open: boolean }) => [
      styles.splitButtonCaret,
      (hovered || pressed || open) && styles.splitButtonCaretHovered,
    ],
    [],
  );

  if (!primaryOption) {
    return null;
  }

  return (
    <View style={styles.row}>
      <View style={styles.splitButton}>
        <Pressable
          testID="workspace-open-in-editor-primary"
          style={primaryPressableStyle}
          onPress={controller.openPrimary}
          disabled={controller.isOpening}
          accessibilityRole="button"
          accessibilityLabel={
            controller.activeFileName
              ? t("workspace.git.openInEditor.openFileIn", {
                  fileName: controller.activeFileName,
                  target: primaryOption.label,
                })
              : t("workspace.git.openInEditor.openIn", {
                  target: primaryOption.label,
                })
          }
        >
          {controller.isOpening ? (
            <ThemedLoadingSpinner
              size="small"
              uniProps={foregroundColorMapping}
              style={styles.splitButtonSpinnerOnly}
            />
          ) : (
            <View style={styles.splitButtonContent}>
              {primaryOption.icon}
              {!hideLabels && (
                <Text style={styles.splitButtonText}>{t("workspace.git.openInEditor.open")}</Text>
              )}
            </View>
          )}
        </Pressable>
        {targets.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              testID="workspace-open-in-editor-caret"
              style={caretTriggerStyle}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.git.openInEditor.chooseEditor")}
            >
              <ThemedChevronDown size={16} uniProps={extraMutedIconColorMapping} />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              minWidth={148}
              maxWidth={176}
              testID="workspace-open-in-editor-menu"
            >
              {targets.map((target) => (
                <OpenTargetMenuItem
                  key={target.id}
                  target={target}
                  isPreferred={target.id === controller.preferredTargetId}
                  onSelect={handleSelectTarget}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  splitButton: {
    height: HEADER_CONTROL_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    overflow: "hidden",
  },
  splitButtonPrimary: {
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[2],
    },
    justifyContent: "center",
    position: "relative",
  },
  splitButtonPrimaryIconOnly: {
    width: HEADER_CONTROL_HEIGHT,
    paddingHorizontal: 0,
    justifyContent: "center",
    position: "relative",
  },
  splitButtonPrimaryHovered: {
    backgroundColor: theme.colors.surface2,
  },
  splitButtonPrimaryDisabled: {
    opacity: 0.6,
  },
  splitButtonText: {
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  splitButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    minHeight: theme.fontSize.base * 1.5,
  },
  splitButtonSpinnerOnly: {
    transform: [{ scale: 0.8 }],
  },
  splitButtonCaret: {
    width: HEADER_CONTROL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: theme.borderWidth[1],
    borderLeftColor: theme.colors.borderAccent,
  },
  splitButtonCaretHovered: {
    backgroundColor: theme.colors.surface2,
  },
}));
