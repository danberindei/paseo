import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { useActiveSpaceStore } from "@/stores/active-space-store";

export function useInitialSpaceId(): void {
  const setActiveSpaceId = useActiveSpaceStore((state) => state.setActiveSpaceId);

  useEffect(() => {
    if (!getIsElectron()) {
      return;
    }

    setActiveSpaceId(getDesktopHost()?.initialSpaceId ?? null);
  }, [setActiveSpaceId]);
}
