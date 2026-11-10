import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SpaceStoreHydrationGate } from "@/components/space-store-hydration-gate";
import { SessionsScreen } from "@/screens/sessions-screen";

export default function SessionsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <SpaceStoreHydrationGate>
        <SessionsScreen />
      </SpaceStoreHydrationGate>
    </HostRouteBootstrapBoundary>
  );
}
