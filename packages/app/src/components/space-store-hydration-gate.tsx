import React, { type ReactNode, useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";
import {
  retryActiveSpaceStoreHydration,
  useActiveSpaceStoreHydrationStatus,
} from "@/stores/active-space-store";
import { retrySpaceStoreHydration, useSpaceStoreHydrationStatus } from "@/stores/space-store";

export function SpaceStoreHydrationGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const spaceStatus = useSpaceStoreHydrationStatus();
  const activeSpaceStatus = useActiveSpaceStoreHydrationStatus();
  const retry = useCallback(() => {
    if (spaceStatus === "error") {
      void retrySpaceStoreHydration();
    }
    if (activeSpaceStatus === "error") {
      void retryActiveSpaceStoreHydration();
    }
  }, [activeSpaceStatus, spaceStatus]);

  if (spaceStatus === "loading" || activeSpaceStatus === "loading") {
    return <StartupSplashScreen />;
  }

  if (spaceStatus === "error" || activeSpaceStatus === "error") {
    return (
      <View style={styles.root}>
        <View style={styles.content}>
          <Text style={styles.title}>{t("startup.spaces.errorTitle")}</Text>
          <Text style={styles.description}>{t("startup.spaces.errorDescription")}</Text>
          <View style={styles.actions}>
            <Button onPress={retry}>{t("startup.spaces.retry")}</Button>
          </View>
        </View>
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[8],
  },
  content: {
    width: "100%",
    maxWidth: 480,
    gap: theme.spacing[4],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  actions: {
    alignItems: "flex-start",
  },
}));
