import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ChevronRight, Trash2 } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { useToast } from "@/contexts/toast-context";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { type Space, useSpaceStore } from "@/stores/space-store";
import { buildSpaceSettingsRoute, buildSettingsRoute } from "@/utils/host-routes";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
}));

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });

export default function ManageSpacesScreen() {
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const spaces = useSpaceStore((s) => s.spaces);
  const createSpace = useSpaceStore((s) => s.createSpace);
  const deleteSpace = useSpaceStore((s) => s.deleteSpace);
  const setActiveSpaceId = useSpaceStore((s) => s.setActiveSpaceId);
  const toast = useToast();

  const [newSpaceName, setNewSpaceName] = useState("");
  const newSpaceInputRef = useRef<EditingTextInputHandle>(null);
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(buildSettingsRoute());
    }
  }, []);

  const handleCreateSpace = useCallback(() => {
    const trimmed = newSpaceName.trim();
    if (!trimmed) return;
    const id = createSpace(trimmed);
    setActiveSpaceId(id);
    setNewSpaceName("");
    newSpaceInputRef.current?.replaceText("");
  }, [newSpaceName, createSpace, setActiveSpaceId]);

  const handleDeleteSpace = useCallback(
    async (space: Space) => {
      const confirmed = await confirmDialog({
        title: "Delete space",
        message: `Delete "${space.name}"? This won't affect your projects.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (confirmed) {
        if (getIsElectron()) {
          const isSpaceInUse = getDesktopHost()?.windows?.isSpaceInUse;
          if (typeof isSpaceInUse === "function" && (await isSpaceInUse(space.id))) {
            toast.error("Close the window showing this space before deleting it.");
            return;
          }
        }
        deleteSpace(space.id);
      }
    },
    [deleteSpace, toast],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel="Go back">
          <ThemedArrowLeft size={20} uniProps={foregroundColorMapping} />
        </Pressable>
        <Text style={styles.headerTitle}>Manage spaces</Text>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {spaces.length === 0 ? (
          <Text style={settingsStyles.rowHint}>
            No spaces yet. Create one to filter the sidebar to a subset of projects.
          </Text>
        ) : null}

        {spaces.length > 0 ? (
          <View style={settingsStyles.section}>
            <Text style={settingsStyles.sectionTitle}>SPACES</Text>
            <View style={settingsStyles.card}>
              {spaces.map((space, index) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  isFirst={index === 0}
                  onDelete={handleDeleteSpace}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={settingsStyles.section}>
          <Text style={settingsStyles.sectionTitle}>NEW SPACE</Text>
          <View style={styles.newSpaceRow}>
            <ThemedTextInput
              ref={newSpaceInputRef}
              onChangeText={setNewSpaceName}
              onSubmitEditing={handleCreateSpace}
              placeholder="Space name..."
              style={styles.newSpaceInput}
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus={focus === "new"}
            />
            <Button
              onPress={handleCreateSpace}
              disabled={!newSpaceName.trim()}
              size="sm"
              variant="secondary"
            >
              Add
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

interface SpaceRowProps {
  space: Space;
  isFirst: boolean;
  onDelete: (space: Space) => void;
}

function SpaceRow({ space, isFirst, onDelete }: SpaceRowProps) {
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );

  const handlePress = useCallback(() => {
    router.push(buildSpaceSettingsRoute(space.id) as Parameters<typeof router.push>[0]);
  }, [space.id]);

  const handleDelete = useCallback(() => {
    void onDelete(space);
  }, [onDelete, space]);

  return (
    <Pressable style={rowStyle} onPress={handlePress}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {space.name}
        </Text>
      </View>
      <View style={styles.spaceRowActions}>
        <Pressable
          onPress={handleDelete}
          accessibilityLabel={`Delete ${space.name}`}
          style={styles.actionButton}
          hitSlop={4}
        >
          <ThemedTrash2 size={14} uniProps={redColorMapping} />
        </Pressable>
        <ThemedChevronRight size={16} uniProps={mutedColorMapping} />
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
  spaceRowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  editInput: {
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderWidth: 1,
    borderRadius: theme.borderRadius.md,
    outlineStyle: "none",
  } as object,
  actionButton: {
    padding: theme.spacing[1],
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  newSpaceRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
    alignItems: "center",
  },
  newSpaceInput: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    outlineStyle: "none",
  } as object,
}));
