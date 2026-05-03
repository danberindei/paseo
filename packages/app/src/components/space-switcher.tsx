import { router, type Href } from "expo-router";
import { ChevronDown, Layers, LogOut, Plus, Settings } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { type Space, selectActiveSpace, useSpaceStore } from "@/stores/space-store";
import type { Theme } from "@/styles/theme";
import { buildSpacesSettingsRoute } from "@/utils/host-routes";

const ThemedLayers = withUnistyles(Layers);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedPlus = withUnistyles(Plus);
const ThemedSettings = withUnistyles(Settings);
const ThemedLogOut = withUnistyles(LogOut);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const layersLeading = <ThemedLayers size={14} uniProps={foregroundMutedColorMapping} />;
const plusLeading = <ThemedPlus size={14} uniProps={foregroundMutedColorMapping} />;
const settingsLeading = <ThemedSettings size={14} uniProps={foregroundMutedColorMapping} />;
const quitLeading = <ThemedLogOut size={14} uniProps={foregroundMutedColorMapping} />;

interface SpaceDropdownItemProps {
  space: Space;
  isActive: boolean;
  isOpen: boolean;
  onSelect: (id: string) => void;
}

function SpaceDropdownItem({ space, isActive, isOpen, onSelect }: SpaceDropdownItemProps) {
  const handleSelect = useCallback(() => {
    onSelect(space.id);
  }, [onSelect, space.id]);
  const trailing = useMemo(() => (isOpen ? <OpenWindowBadge /> : null), [isOpen]);

  return (
    <DropdownMenuItem
      testID={`space-switcher-${space.id}`}
      onSelect={handleSelect}
      selected={isActive}
      showSelectedCheck
      trailing={trailing}
    >
      {space.name}
    </DropdownMenuItem>
  );
}

function OpenWindowBadge() {
  return (
    <View style={styles.openWindowBadge}>
      <Text style={styles.openWindowBadgeText}>Open</Text>
    </View>
  );
}

export function SpaceSwitcher() {
  const spaces = useSpaceStore((s) => s.spaces);
  const activeSpace = useSpaceStore(selectActiveSpace);
  const setActiveSpaceId = useSpaceStore((s) => s.setActiveSpaceId);
  const windowsApiRef = useRef(getDesktopHost()?.windows ?? null);
  const windowsApi = windowsApiRef.current;
  const isElectron = getIsElectron();
  const [openSpaceIds, setOpenSpaceIds] = useState<Array<string | null>>([]);

  const refreshOpenSpaceIds = useCallback(async () => {
    if (!isElectron || !windowsApi?.getOpenSpaceIds) {
      setOpenSpaceIds([]);
      return;
    }

    setOpenSpaceIds(await windowsApi.getOpenSpaceIds());
  }, [isElectron, windowsApi]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void refreshOpenSpaceIds().catch(() => undefined);

    if (!isElectron || !windowsApi?.onWindowsChanged) {
      return () => {
        cancelled = true;
      };
    }

    void windowsApi
      .onWindowsChanged(() => {
        void refreshOpenSpaceIds().catch(() => undefined);
      })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return undefined;
        }
        unlisten = dispose;
        return undefined;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isElectron, refreshOpenSpaceIds, windowsApi]);

  const openWindowSpaces = useMemo(() => new Set(openSpaceIds), [openSpaceIds]);
  const allWindowBadge = useMemo(
    () => (openWindowSpaces.has(null) ? <OpenWindowBadge /> : null),
    [openWindowSpaces],
  );

  const handleSelectAll = useCallback(() => {
    if (isElectron && windowsApi?.openWithSpace) {
      void windowsApi.openWithSpace(null);
      return;
    }
    setActiveSpaceId(null);
  }, [isElectron, setActiveSpaceId, windowsApi]);

  const handleSelectSpace = useCallback(
    (spaceId: string) => {
      if (isElectron && windowsApi?.openWithSpace) {
        void windowsApi.openWithSpace(spaceId);
        return;
      }
      setActiveSpaceId(spaceId);
    },
    [isElectron, setActiveSpaceId, windowsApi],
  );

  const handleNewSpace = useCallback(() => {
    router.push(`${buildSpacesSettingsRoute()}?focus=new` as Href);
  }, []);

  const handleManageSpaces = useCallback(() => {
    router.push(buildSpacesSettingsRoute() as Href);
  }, []);

  const handleQuit = useCallback(() => {
    void windowsApi?.quit?.();
  }, [windowsApi]);

  const triggerStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.trigger,
      Boolean(hovered) && styles.triggerHovered,
    ],
    [],
  );

  const triggerLabel = activeSpace?.name ?? "All";

  return (
    <View style={styles.container}>
      <DropdownMenu>
        <DropdownMenuTrigger style={triggerStyle} accessibilityLabel="Switch space">
          <ThemedLayers size={14} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.triggerText} numberOfLines={1}>
            {triggerLabel}
          </Text>
          <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" width={220}>
          <DropdownMenuItem
            testID="space-switcher-all"
            leading={layersLeading}
            onSelect={handleSelectAll}
            selected={!activeSpace}
            showSelectedCheck
            trailing={allWindowBadge}
          >
            All
          </DropdownMenuItem>
          {spaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {spaces.map((space) => (
                <SpaceDropdownItem
                  key={space.id}
                  space={space}
                  isActive={activeSpace?.id === space.id}
                  isOpen={openWindowSpaces.has(space.id)}
                  onSelect={handleSelectSpace}
                />
              ))}
              <DropdownMenuSeparator />
            </>
          ) : (
            <DropdownMenuSeparator />
          )}
          <DropdownMenuItem
            testID="space-switcher-new"
            leading={plusLeading}
            onSelect={handleNewSpace}
          >
            New space...
          </DropdownMenuItem>
          <DropdownMenuItem
            testID="space-switcher-manage"
            leading={settingsLeading}
            onSelect={handleManageSpaces}
          >
            Manage spaces
          </DropdownMenuItem>
          {isElectron && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                testID="space-switcher-quit"
                leading={quitLeading}
                onSelect={handleQuit}
              >
                Quit
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flexShrink: 0,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    minWidth: 0,
  },
  triggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  triggerText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  openWindowBadge: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  openWindowBadgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
  },
}));
