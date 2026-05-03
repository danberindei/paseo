import { Redirect, useLocalSearchParams } from "expo-router";
import { buildSpaceSettingsRoute, buildSpacesSettingsRoute } from "@/utils/host-routes";

export default function SpaceProjectsRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spaceId = typeof id === "string" ? decodeURIComponent(id) : "";
  return spaceId ? (
    <Redirect href={buildSpaceSettingsRoute(spaceId)} />
  ) : (
    <Redirect href={buildSpacesSettingsRoute()} />
  );
}
