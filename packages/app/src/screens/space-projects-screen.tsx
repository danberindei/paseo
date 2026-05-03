import { router } from "expo-router";
import { ArrowLeft, Check } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { SettingsSection } from "@/screens/settings/settings-section";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useProjects } from "@/hooks/use-projects";
import { settingsStyles } from "@/styles/settings";
import { useSpaceStore } from "@/stores/space-store";
import type { Theme } from "@/styles/theme";
import { buildSpacesSettingsRoute } from "@/utils/host-routes";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedCheck = withUnistyles(Check);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export default function SpaceProjectsScreen({ spaceId }: { spaceId: string }) {
  const spaces = useSpaceStore((s) => s.spaces);
  const renameSpace = useSpaceStore((s) => s.renameSpace);
  const addProjectToSpace = useSpaceStore((s) => s.addProjectToSpace);
  const removeProjectFromSpace = useSpaceStore((s) => s.removeProjectFromSpace);
  const { projects, isLoading } = useProjects();

  const space = useMemo(() => spaces.find((s) => s.id === spaceId), [spaces, spaceId]);
  const projectIdSet = useMemo(() => new Set(space?.projectIds ?? []), [space?.projectIds]);
  const [draftName, setDraftName] = useState(space?.name ?? "");
  const nameInputRef = useRef<EditingTextInputHandle>(null);

  useEffect(() => {
    setDraftName(space?.name ?? "");
    nameInputRef.current?.replaceText(space?.name ?? "");
  }, [space?.name]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(buildSpacesSettingsRoute());
    }
  }, []);

  const handleRename = useCallback(() => {
    const nextName = draftName.trim();
    if (!space || !nextName || nextName === space.name) {
      setDraftName(space?.name ?? "");
      nameInputRef.current?.replaceText(space?.name ?? "");
      return;
    }
    renameSpace(space.id, nextName);
  }, [draftName, renameSpace, space]);

  const handleToggle = useCallback(
    (projectIds: string[], isMember: boolean) => {
      for (const projectId of projectIds) {
        if (isMember) {
          removeProjectFromSpace(spaceId, projectId);
        } else {
          addProjectToSpace(spaceId, projectId);
        }
      }
    },
    [spaceId, addProjectToSpace, removeProjectFromSpace],
  );

  const projectsSection = useMemo(() => {
    if (isLoading && projects.length === 0) {
      return (
        <View style={styles.centered}>
          <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} />
        </View>
      );
    }

    if (projects.length > 0) {
      return (
        <SettingsSection title="Projects">
          <View style={settingsStyles.card}>
            {projects.map((project, index) => {
              const projectIds = project.hosts.map((host) => host.projectId);
              const isMember = projectIds.some((id) => projectIdSet.has(id));
              return (
                <ProjectMembershipRow
                  key={project.viewKey}
                  projectName={project.projectName}
                  projectIds={projectIds}
                  isMember={isMember}
                  isFirst={index === 0}
                  onToggle={handleToggle}
                />
              );
            })}
          </View>
        </SettingsSection>
      );
    }

    if (!isLoading) {
      return <Text style={settingsStyles.rowHint}>No projects found.</Text>;
    }

    return null;
  }, [handleToggle, isLoading, projectIdSet, projects]);

  if (!space) {
    return null;
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back">
          <ThemedArrowLeft size={20} uniProps={foregroundColorMapping} />
        </Pressable>
        <Text style={styles.headerTitle}>{space.name}</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <SettingsSection title="Space">
          <View style={settingsStyles.card}>
            <View style={settingsStyles.row}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>Name</Text>
              </View>
              <EditingTextInput
                ref={nameInputRef}
                initialValue={space?.name ?? ""}
                onChangeText={setDraftName}
                onSubmitEditing={handleRename}
                onBlur={handleRename}
                style={styles.nameInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>
          </View>
        </SettingsSection>

        {projectsSection}
      </ScrollView>
    </View>
  );
}

interface ProjectMembershipRowProps {
  projectName: string;
  projectIds: string[];
  isMember: boolean;
  isFirst: boolean;
  onToggle: (projectIds: string[], isMember: boolean) => void;
}

function ProjectMembershipRow({
  projectName,
  projectIds,
  isMember,
  isFirst,
  onToggle,
}: ProjectMembershipRowProps) {
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );

  const handleToggle = useCallback(() => {
    onToggle(projectIds, isMember);
  }, [onToggle, projectIds, isMember]);

  return (
    <Pressable style={rowStyle} onPress={handleToggle}>
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {projectName}
      </Text>
      <View style={styles.checkboxSlot}>
        {isMember ? (
          <ThemedCheck size={16} uniProps={foregroundColorMapping} />
        ) : (
          <View style={styles.checkboxEmpty} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    gap: theme.spacing[3],
  },
  headerTitle: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  backButton: {
    padding: theme.spacing[1],
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  centered: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
  checkboxSlot: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxEmpty: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: theme.borderRadius.sm,
    borderColor: theme.colors.border,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  nameInput: {
    minWidth: 160,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    outlineStyle: "none",
  } as object,
}));
