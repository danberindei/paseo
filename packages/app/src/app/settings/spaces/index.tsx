import SettingsScreen from "@/screens/settings-screen";

const SPACES_VIEW = { kind: "spaces" as const };

export default function SettingsSpacesIndexRoute() {
  return <SettingsScreen view={SPACES_VIEW} />;
}
