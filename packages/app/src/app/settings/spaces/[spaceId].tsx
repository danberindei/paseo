import { Redirect, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import SettingsScreen from "@/screens/settings-screen";
import { buildSpacesSettingsRoute } from "@/utils/host-routes";

export default function SettingsSpaceDetailRoute() {
  const params = useLocalSearchParams<{ spaceId?: string }>();
  const rawSpaceId = Array.isArray(params.spaceId) ? params.spaceId[0] : params.spaceId;
  const spaceId = typeof rawSpaceId === "string" ? decodeURIComponent(rawSpaceId) : "";
  const view = useMemo(() => ({ kind: "space" as const, spaceId }), [spaceId]);

  if (!spaceId) {
    return <Redirect href={buildSpacesSettingsRoute()} />;
  }

  return <SettingsScreen view={view} />;
}
