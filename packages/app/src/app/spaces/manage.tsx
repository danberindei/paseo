import { Redirect } from "expo-router";
import { buildSpacesSettingsRoute } from "@/utils/host-routes";

export default function ManageSpacesRoute() {
  return <Redirect href={buildSpacesSettingsRoute()} />;
}
