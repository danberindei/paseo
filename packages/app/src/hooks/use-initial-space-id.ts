import { useEffect } from "react";
import { getIsElectron } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { useSpaceStore } from "@/stores/space-store";

export function useInitialSpaceId(): void {
  const setActiveSpaceId = useSpaceStore((state) => state.setActiveSpaceId);

  useEffect(() => {
    if (!getIsElectron()) {
      return;
    }

    setActiveSpaceId(getDesktopHost()?.initialSpaceId ?? null);
  }, [setActiveSpaceId]);
}
